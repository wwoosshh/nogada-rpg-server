import { describe, expect, it } from 'vitest'
import type { NodeDef } from '../types.js'
import { calcGatherChance, canGather } from './gather.js'

const copperVein: NodeDef = {
  id: 'copper_vein',
  name: '구리 광맥',
  skill: 'mining',
  tier: 1,
  requiredLevel: 1,
  yieldItem: 'copper_ore',
  yieldMin: 1,
  yieldMax: 3,
  respawnMs: 5000,
}

const ironVein: NodeDef = { ...copperVein, id: 'iron_vein', tier: 2, requiredLevel: 10 }

describe('canGather', () => {
  it('도구 등급과 숙련도를 모두 충족하면 채집할 수 있다', () => {
    expect(canGather({ skillLevel: 1, toolTier: 1, node: copperVein })).toBe(true)
  })

  it('도구 등급이 모자라면 채집할 수 없다', () => {
    expect(canGather({ skillLevel: 99, toolTier: 1, node: ironVein })).toBe(false)
  })

  it('숙련도가 모자라면 채집할 수 없다', () => {
    expect(canGather({ skillLevel: 1, toolTier: 9, node: ironVein })).toBe(false)
  })
})

describe('calcGatherChance', () => {
  it('채집 불가 조건에서는 0 을 반환한다', () => {
    expect(calcGatherChance({ skillLevel: 1, toolTier: 1, node: ironVein })).toBe(0)
  })

  it('요구 조건을 정확히 만족하면 기본 확률이다', () => {
    expect(calcGatherChance({ skillLevel: 1, toolTier: 1, node: copperVein })).toBeCloseTo(0.5)
  })

  it('숙련도가 높을수록 확률이 오른다', () => {
    const low = calcGatherChance({ skillLevel: 1, toolTier: 1, node: copperVein })
    const high = calcGatherChance({ skillLevel: 10, toolTier: 1, node: copperVein })
    expect(high).toBeGreaterThan(low)
  })

  it('도구 등급이 높을수록 확률이 오른다', () => {
    const low = calcGatherChance({ skillLevel: 1, toolTier: 1, node: copperVein })
    const high = calcGatherChance({ skillLevel: 1, toolTier: 3, node: copperVein })
    expect(high).toBeGreaterThan(low)
  })

  it('0.95 를 넘지 않는다', () => {
    expect(calcGatherChance({ skillLevel: 999, toolTier: 99, node: copperVein })).toBe(0.95)
  })
})
