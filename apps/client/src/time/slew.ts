/**
 * 세계 시각을 뒤로 튀지 않게 만드는 순수 계산.
 *
 * **왜 필요한가:** 재동기는 앵커를 새 왕복 추정치로 통째로 갈아끼운다. 새
 * 추정치가 이전보다 과거이면 `worldNow()` 가 그 자리에서 뒤로 튄다 — 최대
 * `RESYNC_THRESHOLD_MS`(2초). 시각을 판정에 쓰는 것이 서버뿐이던 동안에는
 * 무해했지만, NPC 위치가 시각의 함수가 되면(일과 설계 §1) 그 2초가 화면에서
 * NPC 다섯 칸의 되감기로 보인다.
 *
 * **어떻게:** 뒤로 간 목표를 따라 값을 내리지 않고, 앞선 만큼(`aheadMs`)을
 * 빚으로 들고 있다가 실측 1초당 `SLEW_RATE_MS_PER_SECOND` 씩 갚는다. 갚는
 * 동안에도 목표는 실제 시간과 같은 속도로 흐르므로, 내놓는 값은 조금 느리게
 * 흐를 뿐 결코 뒤로 가지 않는다. 앞으로 간 목표는 빚이 아니라서 즉시 따라간다.
 *
 * 상태를 안에 두지 않고 주고받는 것은 이 계산을 테스트가 시계 없이 돌리기
 * 위해서다 — `clock.ts` 가 유일한 소유자이고, 여기는 산수만 한다.
 */

/**
 * 실측 1초에 갚는 빚의 최대치.
 *
 * 200ms 면 `RESYNC_THRESHOLD_MS`(2초) 만큼 뒤로 밀려도 10초 안에 따라잡고,
 * 그동안 세계가 20% 느리게 흐른다 — 눈에 띄지 않는 정도다. 더 크게 잡으면
 * 되감기 대신 "잠깐 멈칫함"이 보이고, 더 작게 잡으면 어긋난 채로 오래 간다.
 */
export const SLEW_RATE_MS_PER_SECOND = 200

export interface SlewState {
  /** 마지막으로 내놓은 세계 시각. 다음 값이 이보다 작아지지 않는다. */
  worldMs: number
  /** 그 값이 목표보다 얼마나 앞서 있는가 — 아직 갚지 못한 빚. 항상 0 이상이다. */
  aheadMs: number
  /** 그 계산을 한 순간의 단조 시계(performance.now()). 갚는 양은 그 뒤 흐른 실측 시간에 비례한다. */
  atMs: number
}

/**
 * 목표 시각(앵커가 말하는 지금)을 향해 한 걸음 기울인다.
 *
 * `prev` 가 null 이면 갚을 빚도 지킬 약속도 없으므로 목표를 그대로 내놓는다 —
 * 첫 동기화 직후와 `resetClock()` 뒤가 그 자리다.
 */
export function slewWorldTime(
  prev: SlewState | null,
  targetMs: number,
  monotonicMs: number,
): SlewState {
  if (!prev) return { worldMs: targetMs, aheadMs: 0, atMs: monotonicMs }

  // 단조 시계가 뒤로 간 것처럼 보이면 안 흐른 것으로 본다. 음수 경과를 그대로
  // 곱하면 갚기는커녕 빚이 늘어난다.
  const elapsedMs = Math.max(0, monotonicMs - prev.atMs)
  const repaid = (elapsedMs * SLEW_RATE_MS_PER_SECOND) / 1000
  const ahead = Math.max(0, prev.aheadMs - repaid)

  // 목표가 뒤로 갔으면 그만큼 빚이 늘어난다 — 값 자체는 이전 값에 머문다.
  const worldMs = Math.max(prev.worldMs, targetMs + ahead)
  return { worldMs, aheadMs: worldMs - targetMs, atMs: monotonicMs }
}
