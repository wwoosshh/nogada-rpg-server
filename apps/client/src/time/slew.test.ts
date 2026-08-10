import { describe, expect, it } from 'vitest'
import { SLEW_RATE_MS_PER_SECOND, type SlewState, slewWorldTime } from './slew.js'

/**
 * 목표 시각을 실제 시간과 같은 속도로 흘려보내는 도우미.
 *
 * 앵커가 그대로면 목표는 단조 시계와 나란히 간다(clock.ts 의 worldNow) —
 * 재동기가 목표를 통째로 옮기는 순간만 그 나란함이 깨진다. 테스트가 그
 * 흐름을 손으로 적으면 매번 두 숫자를 함께 더해야 해서, 정작 보려는 것
 * (재동기 뒤 값이 어떻게 움직이는가)이 산수에 묻힌다.
 */
function run(
  start: { worldMs: number; monotonicMs: number },
  steps: readonly { advanceMs: number; jumpMs?: number }[],
): { state: SlewState; samples: { worldMs: number; advanceMs: number }[] } {
  let monotonicMs = start.monotonicMs
  let targetMs = start.worldMs
  let state = slewWorldTime(null, targetMs, monotonicMs)
  const samples = [{ worldMs: state.worldMs, advanceMs: 0 }]

  for (const step of steps) {
    monotonicMs += step.advanceMs
    targetMs += step.advanceMs + (step.jumpMs ?? 0)
    state = slewWorldTime(state, targetMs, monotonicMs)
    samples.push({ worldMs: state.worldMs, advanceMs: step.advanceMs })
  }
  return { state, samples }
}

/** 100ms 마다 샘플링하는 걸음들 — 화면이 실제로 시계를 읽는 간격에 가깝다. */
function ticks(count: number): { advanceMs: number }[] {
  return Array.from({ length: count }, () => ({ advanceMs: 100 }))
}

describe('slewWorldTime', () => {
  // 왜: 재동기가 없는 동안에는 이 함수가 아무 일도 하지 않아야 한다. 여기서
  //     조금이라도 늦추면 시계 표시와 대사 조건이 늘 뒤처진 시각을 본다.
  it('목표가 흐르는 대로 따라간다 — 재동기가 없으면 손대지 않는다', () => {
    const { samples } = run({ worldMs: 1_000_000, monotonicMs: 5_000 }, ticks(10))
    expect(samples[0]?.worldMs).toBe(1_000_000)
    expect(samples[10]?.worldMs).toBe(1_001_000)
  })

  // 왜: 이 함수의 존재 이유다. 재동기가 앵커를 새 왕복 추정치로 갈아끼우면
  //     목표가 최대 RESYNC_THRESHOLD_MS(2초) 뒤로 옮겨 갈 수 있는데, 그대로
  //     내놓으면 NPC 가 5칸을 되감는다. 값은 뒤로 가지 않고 기울여 갚는다.
  it('목표가 2초 뒤로 가도 내놓는 값은 뒤로 가지 않는다', () => {
    const { samples } = run({ worldMs: 1_000_000, monotonicMs: 5_000 }, [
      { advanceMs: 100, jumpMs: -2000 },
      ...ticks(20),
    ])
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.worldMs).toBeGreaterThanOrEqual(samples[i - 1]!.worldMs)
    }
  })

  // 왜: 단조이기만 하면 멈춰 있어도 된다 — 그건 시계가 아니다. 뒤로 간 목표를
  //     실측 10초(2000ms ÷ 200ms/초) 안에 따라잡고 다시 나란히 흘러야 한다.
  it('뒤로 간 2초를 10초 안에 다 갚고 목표와 다시 만난다', () => {
    const start = { worldMs: 1_000_000, monotonicMs: 5_000 }
    const { state } = run(start, [{ advanceMs: 0, jumpMs: -2000 }, ...ticks(100)])
    // 목표는 시작값 − 2000 에서 실측 10초만큼 흘렀다.
    expect(state.worldMs).toBe(1_000_000 - 2000 + 10_000)
    expect(state.aheadMs).toBe(0)
  })

  // 왜: 기울이는 동안 값이 뒤로 가지 않는다는 것만으로는 부족하다 — 보정 속도가
  //     너무 크면 세계가 눈에 띄게 느려지고, 극단적으로는 멈춰 선다. 갚는 동안에도
  //     실측 흐름의 80% 아래로는 느려지지 않는다.
  //     (재동기 자체는 한순간이라 그 걸음의 advanceMs 는 0 이다 — 그 걸음에서
  //      값이 제자리인 것은 느려진 것이 아니라 시간이 안 흐른 것이다.)
  it('갚는 동안에도 세계는 실측의 80% 속도로 계속 흐른다', () => {
    const { samples } = run({ worldMs: 1_000_000, monotonicMs: 5_000 }, [
      { advanceMs: 0, jumpMs: -2000 },
      ...ticks(20),
    ])
    for (let i = 1; i < samples.length; i++) {
      const advanced = samples[i]!.worldMs - samples[i - 1]!.worldMs
      const slowest = samples[i]!.advanceMs * (1 - SLEW_RATE_MS_PER_SECOND / 1000)
      expect(advanced).toBeGreaterThanOrEqual(slowest)
    }
  })

  // 왜: 앞으로 가는 어긋남은 기울일 이유가 없다. 화면이 뒤처진 것을 알면서도
  //     10초를 더 뒤처져 있는 것이 되고, 되감기가 아니라서 해로울 것도 없다.
  it('앞으로 점프한 목표는 그 자리에서 따라간다', () => {
    const { state } = run({ worldMs: 1_000_000, monotonicMs: 5_000 }, [
      { advanceMs: 100, jumpMs: 5000 },
    ])
    expect(state.worldMs).toBe(1_005_100)
    expect(state.aheadMs).toBe(0)
  })

  // 왜: 재동기는 5분마다·화면 복귀마다 다시 온다. 아직 다 갚지 못한 상태에서
  //     또 뒤로 밀려도 값이 되감기면 안 된다 — 갚을 빚이 늘어날 뿐이다.
  it('갚는 도중에 또 뒤로 밀려도 되감기지 않는다', () => {
    const { state, samples } = run({ worldMs: 1_000_000, monotonicMs: 5_000 }, [
      { advanceMs: 0, jumpMs: -1000 },
      ...ticks(10),
      { advanceMs: 0, jumpMs: -1500 },
      ...ticks(120),
    ])
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.worldMs).toBeGreaterThanOrEqual(samples[i - 1]!.worldMs)
    }
    // 두 번째 재동기 시점의 빚은 남은 800ms 에 1500ms 를 더한 2300ms —
    // 실측 12초면 다 갚고도 남는다.
    expect(state.aheadMs).toBe(0)
  })

  // 왜: 같은 순간에 두 번 물어보면 같은 답이 나와야 한다. 한 프레임 안에서
  //     worldNow() 를 여러 번 부르는 곳(스케줄러·시계 표시)이 서로 다른
  //     시각을 보면 같은 프레임에 NPC 와 시계가 어긋난다.
  it('같은 순간에 다시 물으면 같은 값을 준다', () => {
    const first = slewWorldTime(null, 1_000_000, 5_000)
    const backward = slewWorldTime(first, 998_000, 5_000)
    const again = slewWorldTime(backward, 998_000, 5_000)
    expect(again.worldMs).toBe(backward.worldMs)
  })

  // 왜: performance.now() 가 뒤로 가는 일은 없어야 하지만, 그것을 믿고 음수
  //     경과를 그대로 곱하면 보정이 거꾸로 붙어 빚이 늘어난다. 안 흐른 것으로 본다.
  it('단조 시계가 뒤로 간 것처럼 보여도 빚이 늘지 않는다', () => {
    const first = slewWorldTime(null, 1_000_000, 5_000)
    const backward = slewWorldTime(first, 998_000, 5_000)
    const rewound = slewWorldTime(backward, 998_000, 4_000)
    expect(rewound.aheadMs).toBe(backward.aheadMs)
    expect(rewound.worldMs).toBe(backward.worldMs)
  })
})
