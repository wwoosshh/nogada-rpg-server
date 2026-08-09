import type { DialogueHistory, DialogueRule } from './dialogue.js'
import type { MilestoneDef } from './milestones.js'
import type { Direction } from './movement.js'

export type SkillId = 'ice' | 'wood' | 'mineral' | 'herb' | 'crafting'

export const SKILL_IDS: readonly SkillId[] = ['ice', 'wood', 'mineral', 'herb', 'crafting'] as const

export const SKILL_LABELS: Record<SkillId, string> = {
  ice: '얼음',
  wood: '나무',
  mineral: '광물',
  herb: '허브',
  crafting: '조합',
}

/**
 * 신규 플레이어가 지급받는 시작 도구 ID.
 * 게임 규칙이므로 여기 한 곳에 둔다 — `packages/data`의 도달 가능성 검증과
 * `createInitialPlayer` 가 같은 상수를 참조해 시작 장비를 정한다.
 *
 * 채집 4종은 도구가 없으면 아무것도 못 하므로 1등급 도구를 준다. 조합은 도구가
 * 접근 게이트가 아니라 성공률 보조라 시작 도구가 없다.
 */
export const STARTING_TOOL_IDS: readonly string[] = [
  'copper_chisel',
  'copper_axe',
  'copper_pickaxe',
  'copper_sickle',
] as const

/**
 * 강화 수치가 붙는 순간 개별 정체성이 생겨 스택이 불가능하다.
 * 지금 enhanceLevel 은 항상 0 이지만 구조는 처음부터 분리해 둔다.
 */
export interface ItemInstance {
  instanceId: string
  itemId: string
  enhanceLevel: number
}

/**
 * 플레이어가 있는 곳.
 *
 * `x`·`y` 는 픽셀이 아니라 **타일 좌표**다 — NodePlacement·SpeakerDef 의 x·y 와
 * 같은 값 공간이라 "이 노드가 내 맵에 있는가" 를 변환 없이 바로 비교할 수 있다.
 */
export interface PlayerLocation {
  mapId: string
  x: number
  y: number
}

export interface PlayerState {
  id: string
  /**
   * 기술별 숙련도. 그 행동을 성공한 누적량이며 상한이 없다.
   * 레벨도 경험치도 없다 — 이 숫자 하나가 속도·성공률·수량을 전부 정한다.
   */
  skills: Record<SkillId, number>
  /** 재료·소모품 — itemId 를 키로 개수만 센다 */
  stacks: Record<string, number>
  /** 장비·도구 — 개별 행 */
  instances: ItemInstance[]
  /** 생활기술별 착용 도구의 instanceId */
  equipped: Partial<Record<SkillId, string>>
  /**
   * 다음 행동이 가능한 시각 (epoch ms, 서버 시계 기준).
   *
   * 노드별 쿨다운이 아니라 플레이어당 하나다. 원작에 노드 리스폰 개념이 없고,
   * 속도를 정하는 것은 노드가 아니라 행동 간격이다. 기술별로 나누면 여러 기술을
   * 번갈아 눌러 실질 속도를 배로 올릴 수 있다.
   */
  nextActionAt: number
  /**
   * 이미 축하한 이정표 id.
   *
   * 달성 여부 자체는 저장하지 않는다 — 지표가 전부 단조 증가라 PlayerState 로부터
   * 계산되고, 저장하면 계산값과 어긋날 수 있다. 여기 남기는 것은 "두 번 축하하지
   * 않기" 뿐이고 그건 틀려도 피해가 없다.
   */
  celebrated: string[]
  /**
   * 대화 이력.
   *
   * 이정표의 celebrated 와 달리 이것은 유도할 수 없는 진짜 상태다 — 대화는
   * 단조 증가하는 지표가 아니라서 PlayerState 로부터 계산할 수 없다.
   * recent 는 상대마다 최근 몇 개로 묶어 무한히 자라지 않게 한다.
   */
  dialogueHistory: DialogueHistory
  /**
   * 어느 맵 어느 칸에 있는가.
   *
   * 걸음마다 서버에 보내지 않는다 — 전투도 PvP 도 없어서 칸 단위 동기화가
   * 필요 없고, 노가다 루프에 왕복 지연을 얹게 된다. 맵을 넘을 때만 갱신하며,
   * 그때 도착 칸은 서버가 정한다(moveService).
   *
   * 그래서 맵 **안**의 x·y 는 마지막 전환 직후의 값이라 지금 서 있는 칸과
   * 다를 수 있다. 판정에 쓰는 것은 mapId 뿐이고, x·y 는 새로고침했을 때
   * 어디에 세울지에만 쓴다.
   */
  location: PlayerLocation
}

export interface ItemDef {
  id: string
  name: string
  kind: 'material' | 'tool'
  toolSkill?: SkillId
  toolTier?: number
  icon: string
}

export interface NodeDef {
  id: string
  name: string
  skill: SkillId
  /** 채집에 필요한 최소 도구 등급. 이 노드의 유일한 접근 게이트다. */
  tier: number
  /** 숙련도 0 일 때의 성공률 */
  baseChance: number
  yieldItem: string
  yieldMin: number
  yieldMax: number
  /** 채집 1회당 숙련도 증가량의 범위. 원작은 등급과 무관하게 1~2 다. */
  skillGainMin: number
  skillGainMax: number
}

export interface RecipeInput {
  item: string
  count: number
}

export interface RecipeDef {
  id: string
  name: string
  skill: SkillId
  /** 이 레시피를 여는 데 필요한 조합 숙련도 */
  requiredSkill: number
  /** 숙련도가 요구치와 같을 때의 성공률 */
  baseChance: number
  inputs: RecipeInput[]
  output: RecipeInput
  /**
   * 제작 1회당 숙련도 증가량의 범위. 요구 숙련도와 함께 증가하지만 비례하지는 않으므로
   * 필요도가 높을수록 요구치 대비 증가 비율이 낮아진다. 설계 문서의 기준점 표를 참조한다.
   */
  skillGainMin: number
  skillGainMax: number
}

/**
 * 맵 한 장. `file` 은 `packages/data/maps/` 안의 `.tmx` 이름이다.
 *
 * width·height 를 여기 싣는 이유는 검증과 서버가 "그 칸이 맵 안인가"를 물어야
 * 하는데, 맵 파일 전체를 GameData 에 싣는 것은 낭비이기 때문이다 — 지형(벽)은
 * 빌드 시점에만 필요하므로 GameData 로 넘어오지 않는다.
 */
export interface MapDef {
  id: string
  name: string
  file: string
  width: number
  height: number
}

/**
 * 맵과 맵을 잇는 칸 하나. 그 칸을 밟으면 넘어간다.
 *
 * 왜 맵 파일이 아니라 별도 표인가: 전환은 맵 두 개에 걸친 사실이라, 한쪽
 * 맵에 적으면 반대쪽과 어긋나도 알 방법이 없다. 한곳에 모으면 빌드가 양쪽을
 * 같이 본다.
 *
 * `facing` 이 null 이면 들어온 방향을 그대로 유지한다.
 */
export interface TransitionDef {
  fromMap: string
  fromX: number
  fromY: number
  toMap: string
  toX: number
  toY: number
  facing: Direction | null
}

/**
 * 맵 위에 놓인 노드 하나. `nodeId` 는 종류이고 `instanceId` 가 그 칸이다.
 *
 * 같은 종류가 여러 칸에 있으므로 종류만으로는 어느 것인지 알 수 없다.
 * 서버가 앞칸 판정을 검증하려면, 그리고 나중에 고갈을 넣으려면 칸을 지목해야 한다.
 *
 * `x`·`y` 는 픽셀이 아니라 **타일 좌표**다.
 */
export interface NodePlacement {
  instanceId: string
  nodeId: string
  /** 어느 맵의 칸인가. SpeakerDef.mapId 와 같은 값 공간이다. */
  mapId: string
  x: number
  y: number
}

/**
 * 대화 상대 하나 — NPC 이거나 말하는 사물(간판·잠긴 문·기념비 등)이다.
 *
 * 사물을 NPC 와 같은 타입으로 두는 이유는 설계 문서 2장에 있다: 규칙도
 * 대사창도 서버 경로도 같고, 다른 것은 `kind` 뿐이라 굳이 타입을 나누면
 * 화자를 다루는 모든 코드가 두 갈래로 갈라진다.
 *
 * `mapId`·`x`·`y` 는 NodePlacement 와 같은 성격이다 — 지금 맵은 `world`
 * 하나뿐이지만 처음부터 맵 id 를 넣어 둔다(설계 문서 9장). 맵이 하나뿐인
 * 지금 넣는 비용은 필드 하나이고, 나중에 맵이 늘 때 넣으면 이미 나간
 * speakers.csv 전체를 마이그레이션해야 한다.
 */
export interface SpeakerDef {
  id: string
  name: string
  /** 'sign' 은 간판처럼 서서 안내만 하는 사물이다. 사람처럼 움직이지 않는다. */
  kind: 'npc' | 'sign'
  mapId: string
  /** 타일 좌표. NodePlacement 의 x·y 와 같다. */
  x: number
  y: number
  sprite: string
}

export interface GameData {
  items: Record<string, ItemDef>
  nodes: Record<string, NodeDef>
  recipes: Record<string, RecipeDef>
  /** 맵 등록부. 키는 mapId 다. */
  maps: Record<string, MapDef>
  /** 맵과 맵을 잇는 칸들. 순서에 의미는 없다. */
  transitions: TransitionDef[]
  placements: Record<string, NodePlacement>
  /** 정의 순서를 유지한다 — nextMilestone 의 동점 처리가 이 순서를 쓴다 */
  milestones: MilestoneDef[]
  speakers: Record<string, SpeakerDef>
  /**
   * 모든 화자의 모든 대사 규칙이 화자 구분 없이 한 배열에 담긴다.
   *
   * speaker 별로 미리 나누지 않는 것은 selectDialogue 자체가 `speaker`
   * 매개변수로 걸러 받도록 설계됐기 때문이다(dialogue.ts 참고) — 여기서
   * 미리 나누면 "이미 걸러서 넘겨야 한다"는 관례가 하나 더 생기고, 그건
   * 정확히 Task 1 리뷰가 지적하고 없앤 종류의 함정이다.
   */
  dialogue: DialogueRule[]
}
