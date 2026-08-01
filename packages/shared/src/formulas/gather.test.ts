import { describe, expect, it } from 'vitest'
import type { ItemDef, NodeDef } from '../types.js'
import { calcGatherChance, canGather, toolAppliesTo, toolCoversNode } from './gather.js'

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

const copperPickaxe: ItemDef = {
  id: 'copper_pickaxe',
  name: '구리 곡괭이',
  kind: 'tool',
  toolSkill: 'mining',
  toolTier: 1,
  icon: 'pickaxe_copper',
}

describe('toolCoversNode', () => {
  it('도구 등급이 노드 등급보다 높으면 true 다', () => {
    expect(toolCoversNode(2, copperVein)).toBe(true)
  })

  it('도구 등급이 노드 등급과 정확히 같으면 true 다', () => {
    expect(toolCoversNode(1, copperVein)).toBe(true)
  })

  it('도구 등급이 노드 등급보다 낮으면 false 다', () => {
    expect(toolCoversNode(1, ironVein)).toBe(false)
  })
})

describe('toolAppliesTo', () => {
  it('숙련 종류가 다르면 false 다', () => {
    const smithingHammer: ItemDef = { ...copperPickaxe, id: 'copper_hammer', toolSkill: 'smithing' }
    expect(toolAppliesTo(smithingHammer, copperVein)).toBe(false)
  })

  it('도구가 아닌 아이템이면 false 다', () => {
    const oreItem: ItemDef = { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' }
    expect(toolAppliesTo(oreItem, copperVein)).toBe(false)
  })

  it('등급이 노드에 못 미치면 false 다', () => {
    expect(toolAppliesTo(copperPickaxe, ironVein)).toBe(false)
  })

  it('숙련 종류가 같고 등급이 정확히 일치하면 true 다', () => {
    expect(toolAppliesTo(copperPickaxe, copperVein)).toBe(true)
  })
})

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
