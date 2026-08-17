import { collectionScore, type CollectionTable } from './collection.js'
import { clamp } from './formulas/clamp.js'
import type { PlayerState, RecipeDef, SkillId, TransitionDef } from './types.js'

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
 * 그 이정표의 계열·문턱이 여는 **레시피** — 그 짝의 유일한 정의.
 *
 * `barrierDoorsOf` 와 같은 자리, 같은 자세다. 다른 것은 짝의 상대뿐이다: 저쪽은
 * `transitions.csv` 의 `gateSkill`·`gateValue`, 이쪽은 `recipes.csv` 의 같은 이름
 * 두 칸이다. 같은 질문을 하는 곳도 똑같이 둘이다 — 이정표 탭(무엇이 열리는지 한
 * 줄로 적는다)과 빌드 검증(선언과 실물이 맞물리는지 본다).
 *
 * **왜 `effect` 를 안 보는가 — 이것이 이 함수가 생긴 이유다.** 오늘 `ice_1000` 의
 * effectKind 는 `title` 이고, 그래서 이정표 탭은 그 줄에 「칭호 — 효과는 없다」를
 * 적는다. 그런데 얼음 1,000 은 실제로 비 가루·눈 가루의 문이다(`rain_powder`·
 * `snow_powder` 의 `gateSkill=ice`·`gateValue=1000`). 목록방이 문을 장식이라고
 * 부르고 있는 것이다.
 *
 * 그렇다고 CSV 의 effectKind 를 `recipes` 로 고치면 **빌드가 깨진다**:
 * `validate.ts` 의 recipes 검사가 `recipe.requiredSkill === milestone.threshold` 를
 * 요구하는데 `rain_powder` 의 requiredSkill 은 0 이다(조합 숙련은 필요 없다).
 * 두 숫자는 애초에 다른 것을 재고 있다 — `requiredSkill` 은 **조합** 문턱이고
 * `gateValue` 는 **채집** 문턱이다(`RecipeDef.gateSkill` 문서: "문을 여는 두 번째
 * 숫자"). 그래서 데이터를 비트는 대신 **표시 계층에서 둘을 합쳐 읽는다.**
 *
 * 지표가 숙련도가 아니면 빈 목록이다 — 짝지을 계열이 없다(`barrierDoorsOf` 와
 * 같은 이유). `every`·`collection` 이정표가 여기 걸리는 일은 없다.
 */
export function gatedRecipesOf(
  def: MilestoneDef,
  recipes: Record<string, RecipeDef>,
): RecipeDef[] {
  if (def.metric.kind !== 'skill') return []
  const { skill } = def.metric
  return Object.values(recipes).filter(
    (r) => r.gateSkill === skill && r.gateValue === def.threshold,
  )
}

/**
 * 이 이정표가 **아무것도 안 여는 순수 칭호인가** — 이정표 탭이 접을 것을 고르는 자.
 *
 * `effect.kind === 'title'` 하나로 묻지 않는 이유가 바로 위 함수다: 오늘 title 22개
 * 중 다섯(`ice_1000`·`wood_1000`·`wood_50000`·`herb_1000`·`herb_50000`)은 레시피
 * 문을 실제로 연다. 그 다섯을 칭호로 세어 접으면 신규 플레이어가 첫 3분에 만날
 * 문 다섯이 통째로 접힌 자루 안으로 들어간다.
 */
export function isPureTitle(def: MilestoneDef, recipes: Record<string, RecipeDef>): boolean {
  return def.effect.kind === 'title' && gatedRecipesOf(def, recipes).length === 0
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

/**
 * 그 **지표**가 지금 얼마인가 — 이정표를 거치지 않고 지표만 묻는 문.
 *
 * 아래 `metricValue` 에서 갈라 나온 이유: 스토리 사슬의 밀어올림 문턱
 * (`StoryCatchUp`)은 지표와 문턱만 있고 이정표가 아니다(설계 ⑦ — 자유 문법 대신
 * **이정표의 지표 그대로**로 제한한 것이 곧 단조 제한이다). 그쪽에서 읽으려고
 * `MilestoneDef` 모양의 가짜를 하나 지어 넘기면, 그 가짜의 id·name·effect 가
 * 무엇이든 상관없다는 사실이 부르는 자리마다 다시 설명되어야 한다 — 그리고
 * 언젠가 그 가짜가 `world.milestones` 에 섞여 든다.
 */
export function metricValueOf(
  m: MilestoneMetric,
  player: PlayerState,
  world: MilestoneWorld,
): number {
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

/** 그 이정표의 지표가 지금 얼마인가. */
export function metricValue(
  def: MilestoneDef,
  player: PlayerState,
  world: MilestoneWorld,
): number {
  return metricValueOf(def.metric, player, world)
}

export function isAchieved(
  def: MilestoneDef,
  player: PlayerState,
  world: MilestoneWorld,
): boolean {
  return metricValue(def, player, world) >= def.threshold
}

/**
 * 이정표 하나가 얼마나 왔는가. 0 에서 1 사이로 잘린다.
 *
 * **이정표 탭은 더 이상 이것으로 정렬하지 않는다.** 한동안 그랬는데, 신규
 * 캐릭터는 40개가 **전부 0.000** 이라 정렬이 통째로 무효가 되고 화면 순서가
 * 문자 그대로 CSV 행 순서였다 — 그래서 첫 화면 다섯 줄이 전부 「칭호 — 효과는
 * 없다」였다. 지금 그 탭이 쓰는 것은 계열 묶음 + 문턱 오름차순이다(설계 ④,
 * detailMenuTabs.ts 의 buildMilestoneLines). 계열 묶음은 40개 전부에 정의되고,
 * 진척 비율은 아무것도 안 한 사람에게 아무 말도 못 한다.
 *
 * 그래도 이 함수를 지우지 않는 이유는 아래 `every` 규칙이다 — 합산 이정표가
 * "얼마나 왔는가"에 답하는 유일한 방법이고, 그 답은 개수가 아니라 병목이다.
 *
 * `every` 는 metricValue(달성 개수)를 threshold 로 나누지 않는다. 그렇게 하면
 * 이미 달성한 항목 하나가 비율을 개수 단위(1/2, 1/3 …)로 크게 밀어올려, 실제로는
 * 한참 남은 나머지 항목이 있는데도 "가깝다" 고 말하게 된다 — 둘 중 하나를 이미
 * 달성하고 나머지가 10% 남았을 때, 개수 비율은 0.5 를 보고하지만 진짜 병목은
 * 0.1 이다. 그 합산은 병목이 끝나기 전까지는 논리적으로 달성될 수도 없다.
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
