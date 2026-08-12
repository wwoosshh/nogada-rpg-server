import type { GatherBracketDef, GatherTableDef } from '../types.js'
import type { GatherHand } from './gatherHand.js'

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
 *   2. rawRoll ≤ 10(잭팟 밴드) 이면 그 안에서 **평감산만** 적용한다:
 *      roll = max(0, rawRoll − jackpotFlat). 밴드 밖이면 **곱만** 적용한다:
 *      roll = floor(rawRoll × rollFactor). 곱과 평감산은 배타적이다 — 둘을
 *      스택하면(곱을 먼저 적용한 뒤 그 결과로 밴드를 판정하면) 상급 도구가
 *      잭팟을 크게 띄우는 감각이 희석되고, 맨손의 원확률 잭팟도 사라진다(§7-앞 13).
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
  const profile = hand.profile
  const rawRoll = Math.floor(rng() * (GATHER_ROLL_MAX + 1))
  const roll =
    rawRoll <= JACKPOT_BAND_MAX
      ? Math.max(0, rawRoll - profile.jackpotFlat)
      : Math.floor(rawRoll * profile.rollFactor)

  const bracket = gatherBracketFor(table, proficiency)
  for (let i = 0; i < bracket.cumulative.length; i++) {
    if (roll <= bracket.cumulative[i]!) return { itemId: table.tiers[i]?.itemId ?? null, roll }
  }
  return { itemId: null, roll }
}
