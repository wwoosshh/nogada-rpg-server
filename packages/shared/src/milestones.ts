import { collectionScore, type CollectionTable } from './collection.js'
import { clamp } from './formulas/clamp.js'
import type { PlayerState, SkillId, TransitionDef } from './types.js'

/**
 * 이정표가 무엇을 보는가.
 *
 * 모든 지표는 단조 증가해야 한다 — 그래야 달성이 되돌려지지 않고,
 * 달성 여부를 저장할 필요가 없어진다.
 */
export type MilestoneMetric =
  | { kind: 'skill'; skill: SkillId }
  /** 나열한 이정표 중 몇 개를 달성했는가. threshold 가 개수다 */
  | { kind: 'every'; of: string[] }
  /**
   * 수집의 방 총점(설계 §6-앞 8). 인자가 없다 — 방은 하나뿐이고 그 총점도 하나다.
   *
   * 단조인가: `donated` 는 헌납으로만 늘고 줄어드는 길이 없으며(§7 훅: 헌납 취소
   * 없음) `collectionGrade` 는 그 누적치의 비감소 함수다. 문턱표가 바뀌면 총점이
   * 내려갈 수는 있지만, 그것은 지표가 아니라 데이터를 고친 것이고 `celebrated`
   * 가 이미 축하한 것을 지우지 않는다는 기존 원칙이 그 경우를 받아 준다.
   */
  | { kind: 'collection' }

/**
 * 달성했을 때 무엇이 열리는가.
 *
 * `recipes` 는 새 게이트를 만드는 것이 아니라 이미 데이터가 강제하는 게이트를
 * 선언하는 것이다. 그래야 목록에 "칭호를 받는다" 와 "철 곡괭이를 만들 수 있게
 * 된다" 가 섞이고, 그 차이가 이 시스템의 값어치다.
 *
 * `nodes` 는 은퇴했다(설계 §7-앞 2) — 노드 tier 게이트가 폐지되어(§3.3) 선언할
 * 게이트 자체가 없다. 노드는 이제 잠기지 않고, 숙련은 접근이 아니라 분포를 바꾼다.
 *
 * `title` 은 효과가 없다는 뜻이고, 그 사실을 숨기지 않는다.
 *
 * `stock` 도 `recipes` 와 같은 종류의 선언이다 — 새 게이트를 만드는 것이 아니라
 * `shop_stock.csv` 의 `unlockCollection` 이 이미 강제하는 게이트를 목록에 적는
 * 것이다(설계 §6-앞 7). 인자가 없는 이유: 무엇이 열리는지는 그 문턱과 같은
 * 총점을 요구하는 진열 행들이고, 그 목록은 `GameData.shops` 에서 유도된다 —
 * CSV 에 한 번 더 적으면 두 벌이 갈라진다.
 *
 * `barrier` 는 `stock` 의 전환판이다 — `transitions.csv` 의 `gateSkill`·`gateValue`
 * 가 이미 강제하는 문을 목록에 적는다(결계 설계 §2). 인자가 없는 이유도 같다:
 * 무엇이 열리는지는 그 계열·그 숫자를 요구하는 전환 행들이고, 그 목록은
 * `GameData.transitions` 에서 유도된다(`barrierDoorsOf`).
 *
 * **이 종류가 생긴 이유는 그것이 없어서 생긴 거짓말이다.** 85,000 결계 넷을
 * 목록에 실을 때 맞는 종류가 없어 `title` 로 뒀더니, 이정표 탭이 "얼음 결계를
 * 넘을 수 있다" 바로 아래에 "칭호 — 효과는 없다" 를 적었다. 두 줄이 서로를
 * 부정했고, 이정표 설계 §2.3("칭호는 장식이고, 게이트가 콘텐츠다")과도 어긋났다.
 */
export type MilestoneEffect =
  | { kind: 'repeat'; skill: SkillId }
  | { kind: 'recipes'; ids: string[] }
  | { kind: 'stock' }
  | { kind: 'barrier' }
  | { kind: 'title' }

export interface MilestoneDef {
  id: string
  metric: MilestoneMetric
  threshold: number
  name: string
  announce: string
  effect: MilestoneEffect
}

/**
 * `barrier` 이정표가 여는 문들 — **그 짝의 유일한 정의**.
 *
 * 이 술어를 shared 에 두는 이유는 같은 질문을 하는 곳이 둘이기 때문이다:
 * 이정표 탭(무엇이 열리는지 한 줄로 적는다)과 빌드 검증(선언과 실물이 양방향으로
 * 맞물리는지 본다). 양쪽이 `gateSkill === … && gateValue === …` 를 각자 옮겨
 * 적으면 짝짓는 규칙이 바뀌는 날 한쪽만 따라가고, 그 어긋남은 "빌드는 초록인데
 * 목록이 딴소리를 한다" 로만 드러난다 — `transitionGate` 를 shared 하나로 둔 것과
 * 같은 자리, 같은 이유다.
 *
 * **`gateTide` 는 짝의 조건이 아니다.** 물때는 숙련 문턱 위에 얹힌 두 번째 조건이고
 * (허브 결계 하나뿐이다), 이정표가 선언하는 것은 **숙련 쪽 문턱**이다. 물때까지
 * 짝의 열쇠로 삼으면 같은 85,000 문이 물때 유무로 둘로 갈라진다.
 *
 * 지표가 숙련도가 아니면 빈 목록이다 — 문이 요구하는 것은 계열 숙련도라 총점·합산
 * 지표로는 어느 계열인지 말할 수 없다. 그 조합 자체를 빌드가 위반으로 잡지만,
 * 여기서도 조용히 엉뚱한 문을 붙이지는 않는다.
 */
export function barrierDoorsOf(
  def: MilestoneDef,
  transitions: readonly TransitionDef[],
): TransitionDef[] {
  if (def.effect.kind !== 'barrier') return []
  if (def.metric.kind !== 'skill') return []
  const { skill } = def.metric
  return transitions.filter((t) => t.gateSkill === skill && t.gateValue === def.threshold)
}

/**
 * 지표가 세상에서 읽는 것 — 이정표 목록과 수집 문턱표.
 *
 * **왜 인자를 하나 더 늘리지 않고 이 객체인가**(§6-앞 8): `metricKind='collection'`
 * 이 필요로 하는 것은 `player.donated` 만이 아니라 그것을 등급으로 옮기는
 * 문턱표다. 네 번째 위치 인자로 받으면 지표가 하나 늘 때마다 다섯 함수의 시그니처와
 * 모든 호출부가 다시 흔들리고, 자리만 다른 두 배열(`milestones`·다음 무엇)이
 * 나란히 놓여 호출부에서 순서를 헷갈리기 좋아진다.
 *
 * 반대로 `GameData` 를 통째로 받지 않는 이유: 규칙 모듈이 데이터 뭉치 전체에
 * 매이면 테스트가 이정표 하나를 물으려고 스무 칸짜리 세계를 지어야 하고,
 * `types.ts` 가 이미 `MilestoneDef` 를 import 하므로 값 차원의 순환이 된다.
 *
 * 이름 붙인 구조 타입이라 **`GameData` 가 그대로 이것이다** — 서버·클라 호출부는
 * 손에 든 `data` 를 그냥 넘기고, 테스트는 두 칸짜리 리터럴을 짓는다.
 */
export interface MilestoneWorld {
  milestones: readonly MilestoneDef[]
  collection: CollectionTable
}

function byId(all: readonly MilestoneDef[], id: string): MilestoneDef | undefined {
  return all.find((m) => m.id === id)
}

/** 그 이정표의 지표가 지금 얼마인가. */
export function metricValue(
  def: MilestoneDef,
  player: PlayerState,
  world: MilestoneWorld,
): number {
  const m = def.metric
  if (m.kind === 'skill') return player.skills[m.skill]
  // 방의 총점은 세이브에 저장된 값이 아니라 계산이다 — 서버 판정도 화면도
  // 같은 `collectionScore` 를 부른다(§6-앞 11).
  if (m.kind === 'collection') return collectionScore(player.donated, world.collection)

  let count = 0
  for (const id of m.of) {
    const other = byId(world.milestones, id)
    // 없는 이정표를 가리키면 세지 않는다. 데이터 검증이 막지만, 막지 못했을 때
    // 조용히 달성되는 것보다 조용히 달성 안 되는 편이 낫다.
    if (other && isAchieved(other, player, world)) count += 1
  }
  return count
}

export function isAchieved(
  def: MilestoneDef,
  player: PlayerState,
  world: MilestoneWorld,
): boolean {
  return metricValue(def, player, world) >= def.threshold
}

/**
 * 이정표 탭(목록)이 쓰는 진척 비율. 0 에서 1 사이로 잘린다.
 *
 * `every` 는 metricValue(달성 개수)를 threshold 로 나누지 않는다. 그렇게 하면
 * 이미 달성한 항목 하나가 비율을 개수 단위(1/2, 1/3 …)로 크게 밀어올려, 실제로는
 * 한참 남은 나머지 항목이 있는데도 "가깝다" 고 말하게 된다 — 둘 중 하나를 이미
 * 달성하고 나머지가 10% 남았을 때, 개수 비율은 0.5 를 보고하지만 진짜 병목은
 * 0.1 이다. 이정표 탭은 이 비율로 못한 것을 정렬하므로(detailMenuTabs.ts 의
 * buildMilestoneRows), 그 병목의 정체가 다른 이정표(여기서는 나머지 하나 그
 * 자체)일 때 합산 쪽을 앞자리로 잘못 고르게 된다 — 심지어 그 합산은 병목이
 * 끝나기 전까지는 논리적으로 달성될 수도 없다.
 *
 * 그래서 참조한 이정표들의 비율 중 threshold 번째로 큰 값을 쓴다. 전부를
 * 요구하는 지금 데이터(threshold === of.length)에서는 곧 최솟값이고, 가장 덜
 * 된 것이 전체 진척을 정한다는 뜻이다.
 */
export function milestoneRatio(
  def: MilestoneDef,
  player: PlayerState,
  world: MilestoneWorld,
): number {
  if (def.threshold <= 0) return 1

  const m = def.metric
  if (m.kind === 'every') {
    const ratios = m.of
      .map((id) => {
        const other = byId(world.milestones, id)
        // metricValue 와 같은 원칙이다 — 없는 이정표는 진척 0 으로 친다.
        return other ? milestoneRatio(other, player, world) : 0
      })
      .sort((a, b) => b - a)
    const rank = clamp(def.threshold, 1, ratios.length) - 1
    return ratios[rank] ?? 0
  }

  // 총점은 숙련도와 같은 갈래로 내려온다 — 지표 하나에 문턱 하나라 나누면 그대로
  // 비율이다. `every` 만 특별한 것은 그것이 **다른 이정표의 진척**을 합치기
  // 때문이고, 총점은 합칠 남이 없다.
  return clamp(metricValue(def, player, world) / def.threshold, 0, 1)
}

export function achievedIds(
  world: MilestoneWorld,
  player: PlayerState,
): Set<string> {
  const ids = new Set<string>()
  for (const def of world.milestones) {
    if (isAchieved(def, player, world)) ids.add(def.id)
  }
  return ids
}

/**
 * 달성했지만 아직 축하하지 않은 것들.
 *
 * 축하 이력에 지금 없는 id 가 들어 있어도 무시한다 — 이정표를 지운 뒤에도
 * 옛 세이브가 그대로 살아 있어야 한다.
 */
export function newlyAchieved(
  world: MilestoneWorld,
  player: PlayerState,
  celebrated: readonly string[],
): MilestoneDef[] {
  const seen = new Set(celebrated)
  return world.milestones.filter((def) => !seen.has(def.id) && isAchieved(def, player, world))
}
