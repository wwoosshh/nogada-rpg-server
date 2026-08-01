import { describe, expect, it } from 'vitest'
import { createRng, rollInt } from './rng.js'

describe('createRng', () => {
  it('같은 시드는 같은 수열을 만든다', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = [a(), a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
  })

  it('다른 시드는 다른 수열을 만든다', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a()).not.toBe(b())
  })

  it('0 이상 1 미만을 반환한다', () => {
    const rng = createRng(999)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('rollInt', () => {
  it('min 과 max 를 포함하는 범위를 반환한다', () => {
    const rng = createRng(42)
    const seen = new Set<number>()
    for (let i = 0; i < 500; i++) seen.add(rollInt(rng, 1, 3))
    expect([...seen].sort()).toEqual([1, 2, 3])
  })

  it('min 과 max 가 같으면 그 값만 반환한다', () => {
    const rng = createRng(7)
    expect(rollInt(rng, 5, 5)).toBe(5)
  })
})
