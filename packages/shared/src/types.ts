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
  x: number
  y: number
}

export interface GameData {
  items: Record<string, ItemDef>
  nodes: Record<string, NodeDef>
  recipes: Record<string, RecipeDef>
  placements: Record<string, NodePlacement>
}
