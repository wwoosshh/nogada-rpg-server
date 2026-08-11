import { describe, expect, it } from 'vitest'
import { FailureBackoff } from './rateLimit.js'

const options = { freeAttempts: 2, baseDelayMs: 1000, maxDelayMs: 8000, maxKeys: 3 }
const NOW = 1_000_000

describe('FailureBackoff', () => {
  // 왜: 사람은 비밀번호를 두어 번 틀린다. 첫 실패부터 기다리게 하면 막는 것은
  //     공격이 아니라 오타다.
  it('자유 횟수까지는 기다리게 하지 않는다', () => {
    const backoff = new FailureBackoff(options)

    backoff.fail('열쇠', NOW)
    backoff.fail('열쇠', NOW)

    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(0)
  })

  // 왜: 대기가 늘지 않으면 초당 수천 번을 두드리는 쪽에게 고정된 값 하나는
  //     아무 저항이 아니다. 두 배씩 늘어야 몇 번 만에 실질적으로 멈춘다.
  it('자유 횟수를 넘기면 실패마다 대기가 두 배가 된다', () => {
    const backoff = new FailureBackoff(options)
    for (let i = 0; i < 3; i += 1) backoff.fail('열쇠', NOW)

    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(1000)

    backoff.fail('열쇠', NOW)
    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(2000)

    backoff.fail('열쇠', NOW)
    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(4000)
  })

  // 왜: 무한히 늘리면 공유기 하나 뒤의 사람이 영영 못 들어온다 — 막는 것과
  //     쫓아내는 것은 다르다.
  it('대기에는 상한이 있다', () => {
    const backoff = new FailureBackoff(options)
    for (let i = 0; i < 20; i += 1) backoff.fail('열쇠', NOW)

    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(options.maxDelayMs)
  })

  it('기다린 만큼 지나면 다시 시도할 수 있다', () => {
    const backoff = new FailureBackoff(options)
    for (let i = 0; i < 3; i += 1) backoff.fail('열쇠', NOW)

    expect(backoff.retryAfterMs('열쇠', NOW + 999)).toBe(1)
    expect(backoff.retryAfterMs('열쇠', NOW + 1000)).toBe(0)
  })

  // 왜: 지우지 않으면 어제 두어 번 틀린 사람이 오늘 성공하고도 다음 실패에서
  //     곧장 긴 대기를 받는다. 세는 것은 "지금 두드리고 있는가"다.
  it('성공하면 기록이 지워져 처음부터 다시 센다', () => {
    const backoff = new FailureBackoff(options)
    for (let i = 0; i < 3; i += 1) backoff.fail('열쇠', NOW)

    backoff.clear('열쇠')

    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(0)
    backoff.fail('열쇠', NOW)
    expect(backoff.retryAfterMs('열쇠', NOW)).toBe(0)
  })

  it('열쇠끼리 서로 영향을 주지 않는다', () => {
    const backoff = new FailureBackoff(options)
    for (let i = 0; i < 3; i += 1) backoff.fail('가', NOW)

    expect(backoff.retryAfterMs('나', NOW)).toBe(0)
  })

  // 왜: 유계가 아니면 실패 기록 자체가 공격 수단이다 — 아이디를 매번 새로
  //     지어 실패하면 표가 요청 수만큼 자라고, 그것만으로 서버가 죽는다
  //     (설계 규범 6).
  it('표는 유계다 — 새 열쇠로 아무리 두드려도 크기가 넘지 않는다', () => {
    const backoff = new FailureBackoff(options)

    for (let i = 0; i < 100; i += 1) backoff.fail(`열쇠${i}`, NOW)

    expect(backoff.size).toBeLessThanOrEqual(options.maxKeys)
  })

  // 왜: 자리가 모자랄 때 무엇을 버리는가가 중요하다. 지금 막고 있는 것을 먼저
  //     버리면 새 열쇠 몇 개로 남의 대기를 풀어 줄 수 있다.
  it('자리가 모자라면 이미 풀린 기록부터 버린다', () => {
    const backoff = new FailureBackoff(options)
    for (let i = 0; i < 3; i += 1) backoff.fail('지금막힌열쇠', NOW)
    backoff.fail('오래된열쇠', NOW - 60_000)

    // 표를 넘치게 만든다. 풀린 것(자유 횟수 안이라 막히지 않은 열쇠)이 먼저 나간다.
    for (let i = 0; i < 5; i += 1) backoff.fail(`새열쇠${i}`, NOW)

    expect(backoff.retryAfterMs('지금막힌열쇠', NOW)).toBe(1000)
    expect(backoff.size).toBeLessThanOrEqual(options.maxKeys)
  })
})
