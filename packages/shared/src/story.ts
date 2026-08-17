import type { MilestoneMetric } from './milestones.js'
import type { SkillId } from './types.js'

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
 * `metricValue` 하나를 그대로 쓴다. 단조가 아닌 문턱은 **적을 방법 자체가 없다.**
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
 */
export interface StoryStep {
  step: number
  /** 띠에 뜨는 글. `discoverable` 이 아니면 빈 글이다 — 목적을 적지 않는다(설계 ⑥). */
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
