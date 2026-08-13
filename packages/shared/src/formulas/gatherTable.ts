import type { GatherBracketDef, GatherTableDef } from '../types.js'
import type { GatherHand } from './gatherHand.js'
import type { GatherToolProfile } from './toolProfile.js'

/**
 * 표 기반 채집 판정 — 성공률이 아니라 **무엇이 나오는가**가 숙련의 함수다(설계 §2).
 *
 * 서버만 표(GatherTableDef)를 가진 채 이 함수를 부른다. 클라이언트는 표 자체를
 * 받지 못하므로(§7-앞 9) 이 판정을 미리 계산해 보여줄 수 없다 — 결과 표시만 한다.
 */

/**
 * roll 의 정의역 상한. roll ∈ 0~100000(밴드 안은 평감산, 밖은 도구 배수 — 아래).
 * 맨손(rollFactor 1.45)은 곱이 이 상한을 넘길 수 있고, 넘긴 몫은 어느 누적에도
 * 안 걸려 실패다 — 최종 브라켓(실패 0%)에서도 맨손만은 실패가 남는 이유(§3).
 */
export const GATHER_ROLL_MAX = 100000

/**
 * 잭팟 밴드의 상한 — **원 roll**(rawRoll = floor(rng × 100001), 도구 보정 전) 기준.
 * 이 안(rawRoll ≤ 10)에서는 도구 보정이 곱이 아니라 평감산이고, 밖에서는 곱만
 * 적용된다 — 둘은 배타적이다(gatherOutcome 참고). 곱 ×0.8 은 roll 3 을 2.4→2 로
 * 겨우 낮추지만, 평감산 −3 은 0 으로 만든다 — 원작의 "상급 도구가 잭팟을 크게
 * 띄우는" 감각의 보존이다(§7-앞 13). 맨손도 이 배타성의 수혜자다: 평감산 0 이라
 * 밴드 안 rawRoll 이 그대로 판정돼 잭팟은 원확률로 열려 있다(원작 정신, §3).
 * 밴드 판정을 곱 적용 후의 roll 로 하면(즉 두 보정을 스택하면) 이 배타성이
 * 깨진다 — 그 회귀를 막으려고 export 해서 시뮬레이터(gatherSimulation.test.ts)가
 * 같은 상수로 정확한 확률을 셀 수 있게 한다.
 */
export const JACKPOT_BAND_MAX = 10

// toolGatherFactor·jackpotFlatBonus 는 gatherToolProfile(toolProfile.ts) 하나로
// 합쳐져 은퇴했다(§6-앞 9) — 티어 0 을 조용히 ×1.0 으로 접던 기본값이 사고
// 유형이었다. 효과 3축의 숫자는 이제 그 함수에서만 산다.

/**
 * 원 roll 하나를 그 손의 roll 로 옮긴다 — **판정의 유일한 보정 식**이다.
 *
 * 세 갈래이고 서로 배타적이다:
 *   1. 잭팟 밴드(rawRoll ≤ 10): 곱이 아니라 평감산만(§7-앞 13, JACKPOT_BAND_MAX).
 *   2. 밴드 밖: 곱(rollFactor)만.
 *   3. 밴드 밖에서 rawRoll 이 **그 손의 도달 상한**을 넘긴 몫: 넘긴 만큼을 그대로
 *      더해 되편다(아래).
 *
 * ## 왜 3번이 있는가 — 출하된 버그(설계 §6-앞 14)
 *
 * 배수가 1 보다 작은 손은 원 roll 의 정의역 [0, 100000] 을 [0, F] 로 접는다
 * (F = floor(100000 × 배수)). 그런데 표의 눈금은 [0, 100000] 위에 매겨져 있다 —
 * 접힌 손은 F 위쪽 눈금을 **영원히 못 밟는다**. 미스릴(0.8) + 선별증표(0.95) =
 * 0.76 이라 F = 76,000 인데 광물 ∞ 브라켓의 꼬리는 78,065 부터 시작하므로,
 * 그 손으로는 은·철·구리 원석의 확률이 **정확히 0** 이었다(허브의 흔한 약초,
 * 광물 ≤500000 의 구리 원석도 같은 모양 — 전수로 416 조합 중 14 조합).
 * 최고 장비를 낀 사람이 가장 흔한 재료를 못 캐고, 도감은 그 손으로 못 채우는
 * 칸에 "다음 문턱까지 N개"를 적게 된다.
 *
 * ## 왜 이 고침인가 — 표를 안 건드리는 길
 *
 * 계획서의 두 안 중 (a)는 ∞ 브라켓의 누적 꼬리를 76,000 아래로 접는 **데이터**
 * 수정이다. 그러려면 광물 ∞ 의 71,800 위 눈금 셋을 (71800, 76000) 안에 욱여넣어야
 * 해서 사파이어·은·철의 폭이 1/6 로 줄고 구리가 6.2% → 24% 가 된다 — 원작에서
 * 그대로 옮겨 온 수치가 알아볼 수 없게 되고, 멀쩡히 굴러가던 구리 손(배수 1.0)의
 * 분포까지 같이 바뀐다. 이 저장소는 원작 수치 보존을 반복해서 규범으로 삼아 왔다.
 *
 * (b)는 "표를 넘어선 roll 을 가장 흔한 티어로 떨어뜨린다"인데, **이 버그를 하나도
 * 못 고친다**: 배수 < 1 인 손의 roll 은 표를 넘어서는 일이 아예 없다(76,000 <
 * 100,000). 전수로 확인했더니 깨진 14 조합이 그대로 14 조합이고, 대신 표가 실패라고
 * 적어 둔 꼬리(맨손 ×1.45 의 존재 이유 §3, 맨손 페널티 §6-앞 3)를 294 조합에서
 * 지워 버린다 — 방향이 반대인 안이다.
 *
 * 그래서 (c): 접은 만큼을 **위쪽에서 다시 편다**. rawRoll 이 F 를 넘어선 몫
 * (rawRoll − F)을 곱한 값에 더하면 rawRoll 100000 은 언제나 roll 100000 에 닿는다
 * (F + 100000 − F). 표의 어느 눈금도 손 때문에 사라지지 않는다.
 *
 * 이 식이 지키는 성질(전수로 확인했고 아래 스위트·시뮬 스위트가 못박는다):
 *   - **배수 ≥ 1 인 손은 한 톨도 안 바뀐다.** F ≥ 100000 이라 3번 항이 항상 0 이다 —
 *     맨손(1.45)·맨손+증표(1.3775)·구리(1.0)의 확률이 글자 그대로 보존되고,
 *     그래서 맨손의 실패도(§6-앞 3 의 13.8%) 그대로 남는다.
 *   - **희귀 티어가 몰래 흔해지지 않는다.** 더하기만 하므로 roll 은 예전보다 작아질
 *     수 없고, 따라서 어떤 누적 문턱의 도달 확률도 늘지 않는다.
 *   - **실패는 표가 실패라고 적은 자리에만 남는다.** 마지막 누적이 100000 인
 *     브라켓은 여전히 실패 0% 이고(도구 손), 90000 인 브라켓은 접힌 손에게도
 *     실패가 돌아온다 — 그 실패가 사라져 있던 것 자체가 같은 버그였다.
 *
 * 대가 하나는 적어 둔다: 꼭짓점(rawRoll = 100000)에서 모든 손이 만나므로 **가장
 * 흔한 티어와 실패 근처에서는 도구 사다리가 완벽히 단조롭지 않다**(예: 광물
 * ≤500000 에서 미스릴 5.56% · 미스릴+선별 5.68% 실패). 표를 그대로 두고 전 티어를
 * 살리려면 곡선들이 위에서 만날 수밖에 없다. 값어치가 걸린 희귀 쪽은 완전히
 * 단조로우니(위 둘째 성질) 이 흔들림은 잡재료 쪽 소수점에 갇힌다.
 *
 * export 하는 이유: 시뮬레이터(gatherSimulation.test.ts)가 100001 가지를 전수로 세어
 * "정확한" 확률을 낼 때 같은 식을 써야 한다. 그 파일이 식을 베껴 두면 판정과 증명이
 * 언젠가 다른 식을 보게 된다.
 */
export function gatherRoll(rawRoll: number, profile: GatherToolProfile): number {
  if (rawRoll <= JACKPOT_BAND_MAX) return Math.max(0, rawRoll - profile.jackpotFlat)
  const reach = Math.floor(GATHER_ROLL_MAX * profile.rollFactor)
  return Math.floor(rawRoll * profile.rollFactor) + Math.max(0, rawRoll - reach)
}

/**
 * 이 숙련도가 굴리는 브라켓 — `proficiency ≤ bracketMax` 인 첫 번째. null(∞)은
 * 항상 매치한다. 빌드 검증이 "∞ 브라켓은 정확히 하나, 마지막"을 강제하므로
 * (§7-앞 4) 유효한 표에서는 반드시 하나가 잡힌다.
 *
 * export 하는 이유: 작가용 시뮬레이터(content-cli 의 gather 명령)가 "지금 어느
 * 브라켓인가"를 보여줘야 하는데, 브라켓 선택을 거기서 다시 적으면 판정이 두 벌이 된다.
 */
export function gatherBracketFor(table: GatherTableDef, proficiency: number): GatherBracketDef {
  const bracket = table.brackets.find((b) => b.bracketMax === null || proficiency <= b.bracketMax)
  // 검증을 거치지 않은 표(테스트 픽스처 등)가 ∞ 브라켓을 빠뜨렸을 때만 온다.
  if (!bracket) throw new Error(`표 "${table.id}" 에 숙련 ${proficiency} 를 받는 브라켓이 없다 — ∞ 브라켓이 빠졌다`)
  return bracket
}

export interface GatherRollResult {
  /** 나온 아이템. null = 실패(어느 티어의 누적에도 안 걸렸다). */
  itemId: string | null
  /** 보정까지 끝난 최종 roll. 서버 로그·시뮬레이터가 "왜 이 티어인가"를 설명하는 데 쓴다. */
  roll: number
}

/**
 * 채집 판정 한 번. rng 를 정확히 한 번 소비한다 — 소비 횟수가 흔들리면 같은
 * 시드의 재현이 무너진다(테스트·시뮬레이터가 그 성질에 기댄다).
 *
 * `hand` 는 그 기술로 캐는 지금 이 손이다(gatherHandOf) — 도구와 증표가 이미
 * 합쳐진 프로필로 도착하고, 이 함수는 `hand.profile` 만 읽는다. 보정 숫자를 여기서
 * 다시 조회하지 않는 것이 요점이다: "착용한 도구가 이 채집의 기술과 맞는가"
 * (equippedToolInfo)도 "그 기술의 선별증표를 가졌는가"(§5)도 손을 만드는 자리의
 * 몫이고, 판정은 만들어진 손을 굴리기만 한다. 도구가 없으면 손의 프로필이 맨손
 * 프로필(roll ×1.45)이다 — 게이트가 아니라 페널티다(§6-앞 9).
 *
 * 판정 순서:
 *   1. rawRoll = floor(rng × 100001) — 손 보정 **전**의 원 roll. 밴드 소속은
 *      항상 이 값으로 가른다.
 *   2. `gatherRoll` 이 그 손의 roll 로 옮긴다 — 밴드 안은 평감산만, 밖은 곱만,
 *      그리고 접힌 손이 표의 꼬리를 못 밟는 몫은 되편다(그 함수의 주석이 왜를 적는다).
 *   3. 숙련 브라켓의 누적표에서 첫 번째 roll ≤ cumulative[i] 가 티어를 정한다.
 *      어디에도 안 걸리면 실패 — 맨손 ×1.45 는 표 끝(100000)을 넘겨 최종
 *      브라켓에서도 실패를 만들 수 있다. 성패 무관 숙련 증가는 호출자(서버)의
 *      몫이다(§7-앞 7).
 */
export function gatherOutcome(
  table: GatherTableDef,
  proficiency: number,
  hand: GatherHand,
  rng: () => number,
): GatherRollResult {
  const rawRoll = Math.floor(rng() * (GATHER_ROLL_MAX + 1))
  const roll = gatherRoll(rawRoll, hand.profile)

  const bracket = gatherBracketFor(table, proficiency)
  for (let i = 0; i < bracket.cumulative.length; i++) {
    if (roll <= bracket.cumulative[i]!) return { itemId: table.tiers[i]?.itemId ?? null, roll }
  }
  return { itemId: null, roll }
}
