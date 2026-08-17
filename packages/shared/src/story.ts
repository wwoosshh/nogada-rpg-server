import { isAchieved, metricValueOf, type MilestoneMetric, type MilestoneWorld } from './milestones.js'
import type { PlayerState, SkillId } from './types.js'

/**
 * 스토리 사슬 — **세계에 정확히 하나**이고 `PlayerState.story` 정수 하나로 돈다
 * (설계 ②의 표).
 *
 * 이정표와 무엇이 다른가: 이정표는 지표가 전부 단조 증가라 달성 여부를 저장할
 * 필요가 없지만(`milestones.ts:8-9`), 스토리는 "지금 몇 번째 마디인가" 가
 * 유도되지 않는 진짜 상태다. 그래서 옆에 세운다 — 한 표에 섞으면 `isAchieved`
 * 가 순수 함수가 아니게 되고, 서버·클라가 같은 함수로 같은 답을 낸다는 지금의
 * 보장이 무너진다(설계 ②).
 */

/**
 * 마디를 끝내는 조건의 종류. 다섯이 전부다.
 *
 * `arrive`·`reach` 만 세지 않는다:
 * - `arrive` 는 한 번 넘어가면 끝이라 셀 것이 없다.
 * - `reach` 는 **단조 지표**를 본다(그 이정표를 달성했는가). 델타로 세려면 마디를
 *   시작한 순간의 숙련도를 어딘가 저장해야 하는데, 이 아크가 쓰기로 한 상태는
 *   `story`·`storyCount` 둘뿐이다(설계 ⑦). 이정표는 이미 그 질문에 답할 수 있으므로
 *   빌려 쓴다.
 *
 * 나머지 셋(`gather`·`donate`·`craft`)은 **마디 시작부터의 델타**를 센다(설계 ②) —
 * 그 수가 `storyCount` 다.
 */
export type StoryGoalKind = 'arrive' | 'gather' | 'donate' | 'craft' | 'reach'

/** 델타를 세는 종류 — `count` 를 갖는 것과 갖지 않는 것의 유일한 목록이다. */
export const COUNTED_GOAL_KINDS: readonly StoryGoalKind[] = ['gather', 'donate', 'craft'] as const

/**
 * 마디를 끝내는 조건.
 *
 * `arg` 가 어느 등록부의 id 인지는 `kind` 가 정한다 — arrive→맵, gather→계열,
 * donate→아이템, craft→레시피, reach→이정표. 그 id 가 실재하는지는 빌드 검증이
 * 마을 넷 전부에서 본다(`validateStory` 의 참조 무결성).
 */
export interface StoryGoal {
  kind: StoryGoalKind
  arg: string
  /** 마디 시작부터 몇 번인가. 세는 종류(COUNTED_GOAL_KINDS)만 갖는다. */
  count?: number
}

/**
 * 이 마디를 **이미 지나쳤다고 볼 수 있는** 단조 지표 문턱(설계 ⑦).
 *
 * 게임은 이미 공개돼 돌고 있고 친구들 계정이 살아 있다 — 그대로 두면 얼음
 * 200,000 인 테스터에게 「마을 북문으로 나가라」가 뜬다. 첫 판정 훅이 돌 때 이
 * 문턱을 넘은 마디를 한 번에 밀어 올린다.
 *
 * **자유 문법을 쓰지 않는 이유**(설계 ⑦): 대사 조건 문법(`사실 연산자 값`)을
 * 빌려 오려면 `buildFacts` 를 불러야 하는데 그 함수는 `speaker` 를 필수로 받아
 * 화자 없는 자리에서 못 부른다. 그래서 **이정표의 지표 그대로**로 제한한다 —
 * 지표 셋(skill·every·collection)이 전부 단조 증가라는 것은 이정표가 이미 지고
 * 있는 약속이고(`milestones.ts` 의 MilestoneMetric), 값을 읽는 함수도
 * `metricValueOf` 하나를 그대로 쓴다. 단조가 아닌 문턱은 **적을 방법 자체가 없다.**
 *
 * **재는 것은 이 행동 앞의 상태다**(`AdvanceStoryArgs.before`). 「이미 지나쳤다」의
 * "이미" 가 그 뜻이고, 그래서 방금 문을 넘은 것·방금 바친 200개는 이 판정에
 * 안 들어간다.
 *
 * **그래도 문턱은 그 마디가 스스로 만드는 값보다 위여야 한다.** `before` 가 막는
 * 것은 **한 행동 안**의 혼동뿐이고, 델타 방어(`caughtUp` 의 `delta > 0`)가 막는
 * 것은 그 마디를 이미 걷기 시작한 사람뿐이다. 둘 다 못 막는 자리가 하나 남는다:
 * **아직 델타가 0 인데 그 마디의 행동이 이미 문턱을 넘겨 놓은 경우.** `gather ×1`
 * 마디에 `skill.{계열}>=1` 을 걸면 첫 **헛손질**이 정확히 그것이다 — 실패는 델타를
 * 안 올리지만 숙련은 올리므로, 두 번째 손질의 `before` 가 이미 문턱 위다. 문턱이
 * 얼마여야 하는지는 계열마다 다르고 그 답은 서버만 아는 확률표 안에 있으므로,
 * 여기서 막지 않고 표를 쓰는 쪽의 규칙으로 둔다.
 */
export interface StoryCatchUp {
  metric: MilestoneMetric
  threshold: number
}

/**
 * 마디 하나 — **마을이 정해진 뒤의 것**.
 *
 * 날것(`StoryStepDef`)의 슬롯이 전부 펴져 있다: `objective`·`announce` 에는
 * 이름이, `goal.arg` 에는 id 가 들어가 있다.
 *
 * 펴는 것은 `storyChainOf`(packages/data — 마을을 알아야 슬롯이 서므로 거기
 * 있다), 받아서 판정하는 것은 아래 `advanceStory` 다. 띠(설계 ⑧-6)도 같은
 * 모양을 받는다.
 */
export interface StoryStep {
  step: number
  /**
   * 띠에 뜨는 글.
   *
   * **적을지 말지를 정하는 것은 이 칸이 아니라 `discoverable` 이다.** 파서는
   * `discoverable` 인데 이 칸이 비면 던지지만(빈 띠가 선다), 반대는 강제하지
   * 않는다 — 설계 ⑥ 방어①이 남긴 손잡이가 "칸 하나를 비우면 유도등이 꺼진다"라
   * 짝까지 강제하면 그 손잡이가 두 칸이 된다(packages/data 의 parseStory).
   * 그래서 `discoverable` 이 아닌 마디에도 글이 남아 있을 수 있다. 화면(띠·앞으로
   * 미니맵 깃발)이 `objective === ''` 로 판단하면 손잡이를 내려도 유도등이 안 꺼진다.
   */
  objective: string
  goal: StoryGoal
  /** 달성한 뒤 한 줄. 보상 문장은 여기에만 있고 `objective` 에는 없다(설계 ⑥ 방어②). */
  announce: string
  /**
   * 이 마디의 목적을 띠에 **적는가**(설계 ⑥ 방어①).
   *
   * 아크 1의 여섯 마디만 참이고 그 뒤는 전부 거짓이다. 거짓인 마디는 조건만 재다가
   * 달성했을 때 `announce` 만 낸다 — 3.5분 이후의 스토리는 "할 일 목록" 이 아니라
   * **지나고 나서야 알게 되는 사건**이고, 그것이 원작이 노가다 사이사이에 숨겨 둔
   * 것과 같은 모양이다. "3.5분이 옳은 길이인가" 는 재지 못했으므로, 되돌리는
   * 손잡이가 이 칸 하나로 남는다.
   */
  discoverable: boolean
  catchUp?: StoryCatchUp
}

/**
 * 마디 하나 — **슬롯이 아직 남아 있는 날것**. `story.csv` 한 행이 이것이다.
 *
 * 왜 두 단계인가: 사슬은 한 벌만 쓰고 값은 **시작 마을에서 유도된다**(설계 ①).
 * 세 설계안이 전부 사슬을 눈의마을·얼음에 못박아 뒀고, 그대로 지었으면 새 계정
 * 넷 중 셋이 안내를 한 글자도 못 받았다. 그래서 표는 계열을 모른 채 서고, 값은
 * `villageField` 가 마을마다 채운다.
 */
export interface StoryStepDef {
  /** 0부터 빈틈없이 연속이다 — 사슬은 건너뛰지 않는다. */
  step: number
  /**
   * 이 마디가 어느 계열의 사슬에 속하는가. **비어 있으면 네 계열 전부**다.
   *
   * 마디 0~3 은 슬롯만으로 네 마을을 다 태우지만 마디 4·5 는 그럴 수 없다 —
   * 광물에는 1,000 짜리 문이 없어서(gateSkill 붙은 레시피 10개가 wood·herb·ice
   * 뿐이다) 그 계열만 다른 것을 가리켜야 한다(설계 ③).
   */
  field?: SkillId
  objective: string
  goal: StoryGoalDef
  announce: string
  discoverable: boolean
  catchUp?: StoryCatchUpDef
}

/** 날것의 조건. `arg`·`count` 에 슬롯이 남아 있어 아직 id 도 수도 아니다. */
export interface StoryGoalDef {
  kind: StoryGoalKind
  arg: string
  /** 슬롯(`{t1}`)이 들어갈 수 있어 수가 아니라 글이다. 세는 종류만 갖는다. */
  count?: string
}

/** 날것의 밀어올림 문턱. `arg` 에 슬롯이 남아 있다. */
export interface StoryCatchUpDef {
  /** `milestones.csv` 의 `metricKind` 와 **같은 값 공간** — 그것이 곧 단조 제한이다. */
  kind: MilestoneMetric['kind']
  /** `collection` 은 빈 글이다(방은 하나뿐이라 고를 인자가 없다). */
  arg: string
  threshold: number
}

/**
 * 슬롯 하나가 가리키는 것 — **얼굴이 둘이다**.
 *
 * 같은 슬롯이 글에서는 이름으로, 인자에서는 id 로 펴진다: 「{채집장}으로 나가라」
 * 는 "얼음 채집장" 이고 `arrive {채집장}` 은 `얼음채집장` 이다.
 *
 * 슬롯 이름을 둘로 나누지 않는 이유(`{채집장}` 과 `{채집장id}`): 작가가 두 이름을
 * 나란히 적다가 한쪽을 틀리는데, 그 어긋남은 **글로는 안 보인다** — 띠는 멀쩡한
 * 이름을 적고 조건만 없는 맵을 가리킨다. 자리가 뜻을 정하면 틀릴 자리가 없다.
 */
export interface StorySlot {
  /** `goal.arg`·`catchUp.arg`·`goal.count` 가 쓰는 값. */
  id: string
  /** `objective`·`announce` 가 쓰는 글. */
  name: string
}

export type StorySlots = Record<string, StorySlot>

const SLOT_PATTERN = /\{([^{}]*)\}/g

/** 그 글이 쓰는 슬롯 이름들. 같은 이름을 두 번 써도 한 번만 센다. */
export function slotsUsedBy(template: string): string[] {
  return [...new Set([...template.matchAll(SLOT_PATTERN)].map((m) => m[1] ?? ''))]
}

/**
 * 슬롯을 편다. 모르는 슬롯이면 **던진다**.
 *
 * 조용히 `{계열}` 을 그대로 남기지 않는 이유: 띠는 화면의 한 줄이라 남은 중괄호가
 * 곧 플레이어가 읽는 글이 되고, 그것은 "안내가 없다" 보다 나쁜 상태다. 빌드 검증이
 * 네 시작 마을 전부에서 이 함수를 돌리므로(`validateStory`) 런타임은 모르는 슬롯을
 * 만날 수 없다 — 여기 닿았다면 데이터가 아니라 부르는 쪽이 어긋난 것이다.
 *
 * `face` 가 두 얼굴 중 어느 쪽을 펼지 정한다(StorySlot 참고).
 */
export function fillSlots(template: string, slots: StorySlots, face: keyof StorySlot): string {
  return template.replace(SLOT_PATTERN, (_, name: string) => {
    const slot = slots[name]
    if (!slot) {
      const known = Object.keys(slots).join(', ')
      throw new Error(`슬롯 "{${name}}" 을 모른다 (아는 것: ${known})`)
    }
    return slot[face]
  })
}

/** 사람이 읽는 자리(`objective`·`announce`)의 슬롯을 편다. */
export function fillText(template: string, slots: StorySlots): string {
  return fillSlots(template, slots, 'name')
}

/** 기계가 가리키는 자리(`goal.arg`·`goal.count`·`catchUp.arg`)의 슬롯을 편다. */
export function fillArg(template: string, slots: StorySlots): string {
  return fillSlots(template, slots, 'id')
}

/**
 * 판정 훅이 사슬에게 알리는 사건 — **방금 무엇을 했는가**(설계 ⑧-4).
 *
 * `reach` 가 없는 것이 이 목록의 요점이다: 이정표 도달은 사건이 아니라
 * **상태**다(단조 지표라 지나간 순간을 다시 물을 필요가 없다). 그래서 훅이
 * 전할 것이 없고, 아래 `advanceStory` 가 매번 세계에서 직접 읽는다 — 실패한
 * 손질도 숙련을 올려 문턱을 넘길 수 있으므로(gatherService 의 ③), 사건이
 * 없어도 사슬은 나아갈 수 있어야 한다. 그것이 `event: null` 의 뜻이다.
 */
export type StoryEvent =
  | { kind: 'arrive'; mapId: string }
  | { kind: 'gather'; skill: SkillId }
  | { kind: 'donate'; itemId: string; count: number }
  | { kind: 'craft'; recipeId: string }

/**
 * 이번 훅에서 사슬이 지나간 마디들.
 *
 * **둘을 나누는 이유는 화면이다**(설계 ⑥ 방어②): `completed` 는 플레이어가
 * 방금 해낸 것이라 `announce` 를 말해야 하고, `skipped` 는 "이미 지나쳤다고
 * 본 것"이라 말하면 안 된다 — 얼음 200,000 인 테스터에게 여섯 줄이 한꺼번에
 * 쏟아지는 것은 안내가 아니라 소음이다.
 */
export interface StoryAdvance {
  /** 이번 훅으로 **실제로 끝낸** 마디들. 순서는 지나간 순서다. */
  completed: StoryStep[]
  /** `catchUp` 이 이미 지나쳤다고 판정해 건너뛴 마디들. */
  skipped: StoryStep[]
}

export interface AdvanceStoryArgs {
  /** 이 플레이어의 사슬 — 슬롯이 펴진 뒤의 것(`storyChainOf`). 비면 아무 일도 없다. */
  chain: readonly StoryStep[]
  /**
   * **제자리에서 고친다**(`story`·`storyCount` 둘뿐이다).
   *
   * 부르는 쪽이 전부 `structuredClone` 뒤의 사본을 들고 있는 서비스라(채집·제작·
   * 헌납·이동) 새 객체를 하나 더 만들어 돌려주면 서비스마다 "어느 쪽을 응답에
   * 실을 것인가" 를 다시 정해야 한다. 이정표 재판정이 `celebrated` 에 직접
   * push 하는 그 자리, 그 자세다.
   */
  player: PlayerState
  /**
   * 이 훅의 행동 **앞**의 플레이어 — 서비스가 `structuredClone` 하기 전의 그것이다.
   *
   * **밀어올림만 이쪽을 읽는다.** 훅은 행동이 상태를 이미 바꾼 뒤에 돌아서
   * (헌납은 `donated` 를, 채집은 숙련을 먼저 올린다) `player` 로 밀어올림을 재면
   * 방금 그 행동이 만든 값을 「예전부터 그랬다」로 읽는다 — 처음 얼음 조각 200개를
   * 바친 신규가 `collection>=1` 에 걸려 첫 별을 **끝낸** 것이 아니라 **지나친** 것이
   * 되고, 문을 나선 고인물이 마디 0 을 **끝낸** 것이 된다. 둘 다 같은 원인이고,
   * 그 원인은 판정 순서가 아니라 **어느 상태를 재는가** 였다.
   *
   * 읽는 것은 단조 지표뿐이라(StoryCatchUp) 이 객체에서 쓰이는 칸은 `skills`·
   * `donated` 다. 자리(`location`)는 안 본다 — 사슬을 그 사람의 것으로 펴는
   * 유도(`storyVillage`)는 **도착한 뒤**를 봐야 하므로 `player` 쪽 몫이다.
   */
  before: PlayerState
  /** `reach` 와 `catchUp` 이 읽는 세계. `GameData` 가 그대로 이 모양이다. */
  world: MilestoneWorld
  /** 방금 한 것. 없으면(실패한 손질처럼) 상태에서 유도되는 것만 다시 본다. */
  event: StoryEvent | null
}

/**
 * 이 마디를 이미 지나쳤다고 볼 수 있는가 — 단조 지표 문턱을 넘었는가.
 *
 * **`before` 를 받는다**(지금이 아니다). 「이미」의 뜻이 그것이고, 그 한 글자가
 * 「방금 그것을 해낸 사람」과 「예전에 지나쳐 온 사람」을 가른다.
 *
 * **델타가 이미 오른 마디는 안 민다**(`delta > 0`). 그 수는 이 사람이 **지금 이
 * 마디를 걷고 있다**는 증거이고, 걷고 있는 사람은 정의상 아직 지나친 사람이 아니다.
 * 이 한 줄이 없으면 나눠 바치는 사람의 별이 사라진다: 마디 2 의 문턱은
 * `collection>=1` 인데 그 지표에서는 「마디가 만드는 값보다 위」로 적을 수가 없다 —
 * 마디를 끝내는 것(t1 개를 바친다)과 첫 단이 채워지는 것이 **같은 순간**이라서다.
 * 그래서 가방이 한 번에 t1 을 못 채운 사람은 두 번째 [바치기] 에서 `before` 로도
 * 이미 문턱 위에 서 있고, 그 사람을 가려내는 정보는 델타뿐이다.
 */
function caughtUp(step: StoryStep, before: PlayerState, world: MilestoneWorld, delta: number): boolean {
  const at = step.catchUp
  if (at === undefined || delta > 0) return false
  return metricValueOf(at.metric, before, world) >= at.threshold
}

/**
 * 사건 없이 **상태만 보고** 끝나는 마디인가 — `reach` 하나뿐이다.
 *
 * 가리키는 이정표가 지금 데이터에 없으면 거짓이다. 빌드가 막지만(참조 무결성),
 * 막지 못했을 때 조용히 달성되는 것보다 조용히 안 되는 편이 낫다 —
 * `metricValue` 의 `every` 가 없는 이정표를 세지 않는 그 원칙이다.
 */
function metByState(step: StoryStep, player: PlayerState, world: MilestoneWorld): boolean {
  if (step.goal.kind !== 'reach') return false
  const def = world.milestones.find((m) => m.id === step.goal.arg)
  return def !== undefined && isAchieved(def, player, world)
}

/** 이 사건이 이 마디의 델타에 몇을 더하는가. 안 세는 마디·엉뚱한 사건은 0 이다. */
function countedBy(step: StoryStep, event: StoryEvent | null): number {
  if (!event) return 0
  const goal = step.goal
  // 계열·아이템·레시피가 정확히 같을 때만 센다. 남의 계열을 캐거나 다른 것을
  // 바치는 것은 이 마디가 시킨 일이 아니다.
  if (goal.kind === 'gather') return event.kind === 'gather' && event.skill === goal.arg ? 1 : 0
  if (goal.kind === 'craft') return event.kind === 'craft' && event.recipeId === goal.arg ? 1 : 0
  if (goal.kind === 'donate') {
    return event.kind === 'donate' && event.itemId === goal.arg ? event.count : 0
  }
  return 0
}

/**
 * 사슬을 판정해 나아간다 — **서버만 부른다**(설계 ②: 진행 판정이 도는 곳은
 * gather·craft·donate·move 넷이고, 클라이언트는 결과를 받을 뿐이다).
 *
 * ## `storyCount` 가 세는 것
 *
 * **지금 걸린 마디가 시작된 뒤부터의 델타**다(설계 ②의 "세는 방식" 줄). 마디가
 * 넘어갈 때마다 0 으로 돌아가고, 그래서 평생 누적을 보는 이정표와 겹치지 않는다.
 * 저장하는 수가 하나뿐이므로 **지금 마디의 것만** 셀 수 있다 — 마디마다 따로
 * 세려면 `Record<step, number>` 가 되어야 하는데, 그것은 서브 퀘스트의 모양이고
 * 이 아크는 그것을 안 짓는다(설계 ⑨).
 *
 * 무엇이 1인가는 종류마다 다르다:
 * - `gather` — **손에 든 것**(성공한 채집) 하나가 1이다. 실패한 손질은 안 센다.
 *   설계 ③ 이 마디 1을 「첫 채집 · 얼음 조각이 가방에 들어온다」로 적었기
 *   때문이고, 그래야 띠의 `n / 40` 이 가방에 쌓인 수와 같은 수가 된다. 대가는
 *   실패가 이어지는 동안 띠가 멈춰 보이는 것인데, 대신 "40번 눌렀는데 아무것도
 *   없다" 는 화면이 사라진다.
 * - `donate` — **개수**다. 한 번에 200개를 바치면 200이 오른다.
 * - `craft` — 성공한 제작 하나가 1이다.
 *
 * **한 사건은 한 마디만 민다.** 400개를 바쳐 200짜리 마디를 끝내도 남는 200은
 * 버린다 — 이어 붙이려면 "남은 사건" 이라는 개념이 생기고, 그것을 들고 다닐
 * 자리는 세 번째 상태 필드다.
 *
 * ## 순서 — **밀어올림이 먼저다**(설계 ⑦)
 *
 * ① 밀어올림(`catchUp`)과 상태로 끝나는 마디(`reach`)를 지나갈 수 있는 만큼
 * 지나간다 → ② 남은 지금 마디 하나에 사건을 적용한다 → ③ 끝냈으면 다시 ①.
 *
 * **사건보다 앞에 두어야 하는 이유**: 뒤에 두면 「고인물이 자기 마을 문을 나서는
 * 순간」이 `completed` 가 된다 — 얼음 200,000 인 사람의 마디 0 은 「{마을}
 * {방향}문으로 나가라」이고, 그 사람이 오늘도 채집장에 나가는 그 한 걸음이 마침
 * 그 조건을 만족시킨다. 사건이 먼저 닿으면 밀어올림은 그 마디를 볼 기회가 없고,
 * 그 사람은 초보 안내 한 줄을 축하로 받는다(설계 ⑦, 실기 확인 1번).
 *
 * **그런데도 신규가 자기 마디를 지나치지 않는 이유는 순서가 아니라 `before` 다.**
 * 한때 이 순서를 뒤집어 막으려 했던 사고(처음 200개를 바친 신규가 `collection>=1`
 * 에 걸려 첫 별을 지나친다)는 순서 탓이 아니었다 — 훅이 돌 때 `donated` 에는 방금
 * 바친 200 개가 **이미 들어 있어서**, 사건을 먼저 쓰든 나중에 쓰든 `player` 로
 * 재는 한 그 값은 문턱을 넘긴다(나눠 바치면 실제로 그대로 샜다). 밀어올림이
 * **행동 앞의 상태**를 재는 지금은 순서를 되돌려도 그 사람의 마디가 자기 손으로
 * 끝난다(AdvanceStoryArgs.before).
 *
 * ③이 필요한 이유: 끝낸 마디 뒤에 **이미 넘긴 이정표**가 걸려 있을 수 있다
 * (마지막 얼음 조각을 바치는 순간 이미 숙련 1,000 인 사람).
 *
 * ①의 두 갈래 순서 — **밀어올림이 `reach` 판정보다 앞이다.** 고인물은 `reach`
 * 마디에서 둘 다 참이다(얼음 200,000 이면 문턱을 넘겼고, 지나쳤다고도 볼 수 있다).
 * 뒤집으면 그 사람이 「얼음에 익숙해졌다」를 오늘 처음 달성한 것처럼 받는다.
 *
 * **매 훅마다 미는 것이 "첫 판정 훅이 돌 때 한 번"과 같은 뜻인 이유**: 문턱이
 * 전부 단조 지표라(StoryCatchUp) 한 번 밀리고 나면 그 뒤의 훅은 같은 답을 보고
 * 아무것도 안 한다. "이번이 첫 훅인가" 를 기억하려면 세 번째 상태 필드가 필요한데,
 * 그 필드가 사는 값은 이미 단조가 공짜로 주고 있다. 그리고 이 자리는 **읽기
 * 전용 라우트가 아니다** — 설계가 기각한 「접속 시 재판정」이 안 되는 이유는
 * `GET /api/state` 가 세이브를 쓰게 되기 때문이지, 미는 횟수 때문이 아니다.
 */
export function advanceStory({ chain, player, before, world, event }: AdvanceStoryArgs): StoryAdvance {
  const out: StoryAdvance = { completed: [], skipped: [] }

  /** 마디를 넘긴다 — 델타는 새 마디의 것이므로 0 으로 돌아간다. */
  const pass = (step: StoryStep, into: StoryStep[]): void => {
    into.push(step)
    player.story += 1
    player.storyCount = 0
  }

  /** 사건 없이 지나갈 수 있는 만큼 — 이미 지나친 것(`before`)과 이미 넘긴 것(`player`). */
  const drift = (): void => {
    while (player.story < chain.length) {
      const next = chain[player.story]!
      if (caughtUp(next, before, world, player.storyCount)) pass(next, out.skipped)
      else if (metByState(next, player, world)) pass(next, out.completed)
      else break
    }
  }

  // ① 밀어올림이 먼저다 — 고인물의 마디를 사건이 먼저 집어 가지 않게.
  drift()

  // ② 사건 — **지금 마디 하나에만** 닿는다.
  //
  // 세이브의 `story` 가 사슬 길이를 넘으면(마디를 지운 날의 옛 세이브) 여기서
  // undefined 가 나와 사슬이 끝난 것으로 본다 — celebrated 가 없는 이정표를
  // 무시하는 그 자세다. 길이를 따로 재지 않는 것은 색인 하나가 이미 그 답이라서다.
  const step = chain[player.story]
  if (step && appliesTo(step, player, event)) {
    pass(step, out.completed)
    // ③ 끝낸 마디 뒤에 남은 것.
    drift()
  }

  return out
}

/**
 * 이 사건이 이 마디를 끝내는가. 세는 마디면 **델타를 먼저 올리고** 답한다.
 *
 * 델타를 여기서 올리는 이유: "몇이 올랐는가" 와 "그래서 끝났는가" 는 같은 판정의
 * 앞뒤라, 나누면 부르는 쪽이 둘의 순서를 다시 정해야 한다.
 */
function appliesTo(step: StoryStep, player: PlayerState, event: StoryEvent | null): boolean {
  if (step.goal.kind === 'arrive') {
    return event?.kind === 'arrive' && event.mapId === step.goal.arg
  }
  const gained = countedBy(step, event)
  if (gained === 0) return false
  player.storyCount += gained
  // `count` 는 세는 종류에 반드시 있다(parseStory 의 짝 강제). 없는 데이터가
  // 여기까지 오면 **영원히 안 끝나는 마디**로 두는 편이 낫다 — 0 으로 접으면
  // 사슬이 첫 채집 한 번에 끝까지 굴러가고, 그 사고는 화면에 흔적을 안 남긴다.
  return step.goal.count !== undefined && player.storyCount >= step.goal.count
}
