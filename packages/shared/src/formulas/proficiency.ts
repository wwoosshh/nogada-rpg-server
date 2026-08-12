import { clamp } from './clamp.js'

/**
 * 숙련도가 정하는 것들.
 *
 * 숙련도의 실용 범위는 8자릿수다(초보 10⁵~10⁶, 오래 한 사람 10⁷~10⁸).
 * 선형식은 두 자릿수 안에서 상한에 닿아버리므로 전부 로그로 잡는다.
 */

/** 행동 간격이 자릿수 몇 개에 걸쳐 줄어드는가 */
export const SPEED_DECADES = 6
/** 성공률이 자릿수 몇 개에 걸쳐 오르는가 */
export const CHANCE_DECADES = 5

/** 숙련도 0 일 때의 행동 간격 — 초당 2회 */
export const ACTION_INTERVAL_MAX_MS = 500
/**
 * 최고속 — 초당 20회.
 *
 * 원작보다 두 배 빠르다. 원작의 최속은 `Wait(2)` = 4프레임 = 40fps 기준 100ms 였다
 * (`Wait` 는 파라미터의 두 배를 프레임 수로 쓴다). 원작은 그 속도를 과금으로 팔았고
 * 우리는 숙련도로 주기 때문에, 도달에 수백 시간이 드는 값을 원작의 상한에 묶어 둘
 * 이유가 없다고 판단해 한 단계 더 열어 두었다.
 */
export const ACTION_INTERVAL_MIN_MS = 50

export const MAX_SUCCESS_CHANCE = 0.98
/** 성공률 하한. 판정이 살아 있다는 느낌을 유지하려고 0 이 아니라 여기까지만 떨어진다 */
export const MIN_SUCCESS_CHANCE = 0.05
/** 제작 성공률에 망치 등급 1 당 더해지는 보너스. 채집 도구의 등급은 성공률이 아니라 roll 보정(toolGatherFactor)이라 이런 보너스가 없다 */
export const CRAFT_TOOL_TIER_CHANCE_BONUS = 0.02

/**
 * 효율 배수. 이번 범위에서는 항상 1 이고, 올리는 수단은 아직 없다. 자리를 미리
 * 만들어 두는 이유는, 나중에 배수를 도입할 때 저장된 숙련도의 의미나 증가 경로를
 * 다시 손대지 않기 위해서다.
 */
export const EFFICIENCY_MULTIPLIER = 1

/**
 * 숙련도를 0~1 진행도로 바꾼다.
 *
 * `decades` 자릿수만큼 올라가면 1 에 닿는다 — 예컨대 6 이면 숙련도 100만에서 1 이다.
 * 자릿수마다 같은 폭으로 오르므로, 1 → 10 의 성장과 10만 → 100만 의 성장이
 * 같은 크기로 느껴진다. 8자릿수를 다루면서 초반이 밋밋해지지 않게 하는 것이 목적이다.
 */
export function proficiencyProgress(proficiency: number, decades: number): number {
  const safe = Math.max(0, proficiency)
  return clamp(Math.log10(safe + 1) / decades, 0, 1)
}

/**
 * 다음 행동까지 기다려야 하는 시간.
 *
 * 이것이 이 게임의 핵심 축이다. 원작에서 이 값을 정한 것은 과금 등급과 광고 버프였고
 * 숙련도가 아니었지만, 이 프로젝트는 과금을 만들지 않으므로 축을 숙련도로 옮겼다.
 * "오래 할수록 빨라진다" 는 체감은 유지되고 수단만 바뀐다.
 *
 * 이 가속이 복리로 작용해야 8자릿수가 현실적인 시간 안에 도달 가능해진다.
 */
export function actionIntervalMs(proficiency: number): number {
  const t = proficiencyProgress(proficiency, SPEED_DECADES)
  return Math.round(ACTION_INTERVAL_MAX_MS - (ACTION_INTERVAL_MAX_MS - ACTION_INTERVAL_MIN_MS) * t)
}

// yieldBonus·MAX_YIELD_BONUS·YIELD_DECADES 는 은퇴했다(설계 §7-앞 2) — 표 모델에서
// 살려두면 고숙련 잭팟이 3개씩 나와 표의 질량 설계가 ×3 된다. 수량은 항상 1 이다(§3.2).
