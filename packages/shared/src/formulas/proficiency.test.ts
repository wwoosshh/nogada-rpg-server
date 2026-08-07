import { describe, expect, it } from 'vitest'
import {
  ACTION_INTERVAL_MAX_MS,
  ACTION_INTERVAL_MIN_MS,
  MAX_YIELD_BONUS,
  actionIntervalMs,
  proficiencyProgress,
  yieldBonus,
} from './proficiency.js'

describe('proficiencyProgress', () => {
  it('숙련도 0 이면 0 이다', () => {
    expect(proficiencyProgress(0, 6)).toBe(0)
  })

  it('10의 D 제곱에서 1 에 닿는다', () => {
    // log10(999999 + 1) = 6
    expect(proficiencyProgress(999_999, 6)).toBeCloseTo(1)
    expect(proficiencyProgress(99_999, 5)).toBeCloseTo(1)
  })

  it('자릿수마다 같은 폭으로 올라간다', () => {
    expect(proficiencyProgress(9, 6)).toBeCloseTo(1 / 6)
    expect(proficiencyProgress(999, 6)).toBeCloseTo(3 / 6)
    expect(proficiencyProgress(99_999, 6)).toBeCloseTo(5 / 6)
  })

  it('1 을 넘지 않는다', () => {
    expect(proficiencyProgress(100_000_000, 6)).toBe(1)
  })

  it('단조 증가한다', () => {
    let prev = -1
    for (const s of [0, 1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]) {
      const t = proficiencyProgress(s, 6)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })

  it('음수 숙련도는 0 으로 본다', () => {
    expect(proficiencyProgress(-5, 6)).toBe(0)
  })
})

describe('actionIntervalMs', () => {
  it('숙련도 0 이면 초당 2회다', () => {
    expect(actionIntervalMs(0)).toBe(ACTION_INTERVAL_MAX_MS)
    expect(ACTION_INTERVAL_MAX_MS).toBe(500)
  })

  it('설계 문서의 곡선표와 일치한다', () => {
    expect(actionIntervalMs(999)).toBe(275)
    expect(actionIntervalMs(9_999)).toBe(200)
    expect(actionIntervalMs(99_999)).toBe(125)
    expect(actionIntervalMs(999_999)).toBe(50)
  })

  it('100만을 넘어도 더 빨라지지 않는다', () => {
    expect(actionIntervalMs(10_000_000)).toBe(ACTION_INTERVAL_MIN_MS)
    expect(actionIntervalMs(100_000_000)).toBe(ACTION_INTERVAL_MIN_MS)
  })

  it('단조 감소한다', () => {
    let prev = Number.POSITIVE_INFINITY
    for (const s of [0, 10, 100, 1_000, 10_000, 100_000, 1_000_000]) {
      const ms = actionIntervalMs(s)
      expect(ms).toBeLessThanOrEqual(prev)
      prev = ms
    }
  })

  it('항상 최소·최대 사이의 정수다', () => {
    for (const s of [0, 7, 77, 777, 7_777, 77_777, 777_777, 7_777_777]) {
      const ms = actionIntervalMs(s)
      expect(Number.isInteger(ms)).toBe(true)
      expect(ms).toBeGreaterThanOrEqual(ACTION_INTERVAL_MIN_MS)
      expect(ms).toBeLessThanOrEqual(ACTION_INTERVAL_MAX_MS)
    }
  })
})

describe('yieldBonus', () => {
  it('초반에는 보너스가 없다', () => {
    expect(yieldBonus(0)).toBe(0)
    expect(yieldBonus(99)).toBe(0)
  })

  it('자릿수가 오르면 늘어난다', () => {
    expect(yieldBonus(999)).toBe(1)
    expect(yieldBonus(99_999)).toBe(MAX_YIELD_BONUS)
  })

  it('상한을 넘지 않는다', () => {
    expect(yieldBonus(100_000_000)).toBe(MAX_YIELD_BONUS)
    expect(MAX_YIELD_BONUS).toBe(2)
  })

  it('항상 0 이상의 정수다', () => {
    for (const s of [0, 5, 50, 5_000, 5_000_000]) {
      const b = yieldBonus(s)
      expect(Number.isInteger(b)).toBe(true)
      expect(b).toBeGreaterThanOrEqual(0)
    }
  })
})
