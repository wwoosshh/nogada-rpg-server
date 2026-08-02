import { describe, expect, it } from 'vitest'
import { applyXp, xpGainForCraft, xpGainForGather, xpToNext } from './skill.js'

describe('xpToNext', () => {
  it('레벨이 오를수록 필요 경험치가 증가한다', () => {
    for (let level = 1; level < 20; level += 1) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level))
    }
  })

  it('공식대로 정확한 값을 반환한다', () => {
    expect(xpToNext(1)).toBe(60)
    expect(xpToNext(2)).toBe(90)
    expect(xpToNext(10)).toBe(1050)
  })
})

describe('applyXp', () => {
  it('레벨업에 못 미치면 경험치만 쌓인다', () => {
    expect(applyXp({ level: 1, xp: 0 }, 30)).toEqual({ level: 1, xp: 30 })
  })

  it('필요 경험치를 채우면 레벨이 오르고 나머지가 이월된다', () => {
    expect(applyXp({ level: 1, xp: 50 }, 20)).toEqual({ level: 2, xp: 10 })
  })

  it('한 번에 여러 레벨이 오를 수 있다', () => {
    // level1 필요 60, level2 필요 90 → 총 150 소비 후 잔여 10
    expect(applyXp({ level: 1, xp: 0 }, 160)).toEqual({ level: 3, xp: 10 })
  })

  it('원본 상태를 변경하지 않는다', () => {
    const original = { level: 1, xp: 0 }
    applyXp(original, 100)
    expect(original).toEqual({ level: 1, xp: 0 })
  })
})

describe('xpGainForGather', () => {
  it('노드 등급이 높을수록 경험치가 많다', () => {
    expect(xpGainForGather(2, 1)).toBeGreaterThan(xpGainForGather(1, 1))
  })

  it('숙련도가 노드 수준을 크게 넘으면 경험치가 감소한다', () => {
    expect(xpGainForGather(1, 50)).toBeLessThan(xpGainForGather(1, 1))
  })

  it('아무리 감소해도 최소 1 은 준다', () => {
    expect(xpGainForGather(1, 999)).toBeGreaterThanOrEqual(1)
  })
})

describe('xpGainForCraft', () => {
  it('요구 레벨이 높은 레시피가 경험치를 더 준다', () => {
    expect(xpGainForCraft(20, 20)).toBeGreaterThan(xpGainForCraft(1, 1))
  })

  it('숙련도가 레시피 수준을 크게 넘으면 경험치가 감소한다', () => {
    expect(xpGainForCraft(1, 40)).toBeLessThan(xpGainForCraft(1, 1))
  })

  it('요구 레벨과 숙련도가 같으면 감소가 없다', () => {
    expect(xpGainForCraft(10, 10)).toBe(70)
  })

  it('아무리 감소해도 최소 1 은 준다', () => {
    expect(xpGainForCraft(1, 999)).toBeGreaterThanOrEqual(1)
  })
})
