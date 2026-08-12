import type { GatherBracketDef, GatherTableDef, ItemDef } from '../types.js'

/**
 * 표 기반 채집 판정 — 성공률이 아니라 **무엇이 나오는가**가 숙련의 함수다(설계 §2).
 *
 * 서버만 표(GatherTableDef)를 가진 채 이 함수를 부른다. 클라이언트는 표 자체를
 * 받지 못하므로(§7-앞 9) 이 판정을 미리 계산해 보여줄 수 없다 — 결과 표시만 한다.
 */

/** roll 의 정의역 상한. roll = floor(rng × 100001 × factor) ∈ 0~100000. */
export const GATHER_ROLL_MAX = 100000

/**
 * 잭팟 밴드의 상한. 이 안(roll ≤ 10)에서는 도구 보정이 곱이 아니라 평감산이다 —
 * 곱 ×0.8 은 roll 3 을 2.4→2 로 겨우 낮추지만, 평감산 −3 은 0 으로 만든다.
 * 원작의 "상급 도구가 잭팟을 크게 띄우는" 감각의 보존이다(§7-앞 13).
 */
const JACKPOT_BAND_MAX = 10

/**
 * 도구 등급의 roll 보정 배수 — 구리(1) ×1.0 / 철(2) ×0.9 / 미스릴(3) ×0.8.
 *
 * 낮은 roll 일수록 상위 티어이므로 곱이 작을수록 희귀 티어 확률이 오른다.
 * 등급은 이제 접근 게이트가 아니라 이 보정의 재료다(설계 §3.3).
 */
export function toolGatherFactor(def: ItemDef): number {
  const tier = def.toolTier ?? 0
  if (tier >= 3) return 0.8
  if (tier === 2) return 0.9
  return 1.0
}

/**
 * 잭팟 밴드(roll ≤ 10) 안에서 roll 에서 빼는 평감산 — 구리 0 / 철 2 / 미스릴 3.
 * 결과가 음수가 되지는 않는다(gatherOutcome 이 0 으로 막는다).
 */
export function jackpotFlatBonus(def: ItemDef): number {
  const tier = def.toolTier ?? 0
  if (tier >= 3) return 3
  if (tier === 2) return 2
  return 0
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
 * 판정 순서:
 *   1. roll = floor(rng × 100001 × factor) — 도구가 좋을수록 roll 이 낮아진다.
 *   2. roll ≤ 10(잭팟 밴드)이면 평감산을 더 빼고 0 아래로는 내려가지 않는다.
 *   3. 숙련 브라켓의 누적표에서 첫 번째 roll ≤ cumulative[i] 가 티어를 정한다.
 *      어디에도 안 걸리면 실패 — 성패 무관 숙련 증가는 호출자(서버)의 몫이다(§7-앞 7).
 */
export function gatherOutcome(
  table: GatherTableDef,
  proficiency: number,
  tool: ItemDef,
  rng: () => number,
): GatherRollResult {
  let roll = Math.floor(rng() * (GATHER_ROLL_MAX + 1) * toolGatherFactor(tool))
  if (roll <= JACKPOT_BAND_MAX) roll = Math.max(0, roll - jackpotFlatBonus(tool))

  const bracket = gatherBracketFor(table, proficiency)
  for (let i = 0; i < bracket.cumulative.length; i++) {
    if (roll <= bracket.cumulative[i]!) return { itemId: table.tiers[i]?.itemId ?? null, roll }
  }
  return { itemId: null, roll }
}
