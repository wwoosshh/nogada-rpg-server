import { describe, expect, it } from 'vitest'
import type { ItemDef, NodeDef } from '../types.js'
import { calcGatherChance, canGather, toolAppliesTo, toolCoversNode } from './gather.js'

const copperVein: NodeDef = {
  id: 'copper_vein',
  name: '구리 광맥',
  skill: 'mineral',
  tier: 1,
  baseChance: 0.5,
  yieldItem: 'copper_ore',
  yieldMin: 1,
  yieldMax: 3,
  respawnMs: 5000,
  skillGainMin: 1,
  skillGainMax: 2,
}

const ironVein: NodeDef = { ...copperVein, id: 'iron_vein', tier: 2 }

const copperPickaxe: ItemDef = {
  id: 'copper_pickaxe',
  name: '구리 곡괭이',
  kind: 'tool',
  toolSkill: 'mineral',
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
    const craftingHammer: ItemDef = { ...copperPickaxe, id: 'copper_hammer', toolSkill: 'crafting' }
    expect(toolAppliesTo(craftingHammer, copperVein)).toBe(false)
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
    expect(canGather({ proficiency: 1, toolTier: 1, node: copperVein })).toBe(true)
  })

  it('도구 등급이 모자라면 채집할 수 없다', () => {
    expect(canGather({ proficiency: 99, toolTier: 1, node: ironVein })).toBe(false)
  })

  it('숙련도가 0 이어도 도구 등급만 맞으면 채집할 수 있다', () => {
    expect(canGather({ proficiency: 0, toolTier: 1, node: copperVein })).toBe(true)
  })
})

describe('calcGatherChance', () => {
  it('도구 등급이 모자라면 0 이다', () => {
    expect(calcGatherChance({ proficiency: 999_999, toolTier: 1, node: ironVein })).toBe(0)
  })

  it('숙련도 0 이면 노드의 기본 성공률이다', () => {
    expect(calcGatherChance({ proficiency: 0, toolTier: 1, node: copperVein })).toBeCloseTo(0.5)
  })

  it('숙련도가 오르면 성공률이 오른다', () => {
    const low = calcGatherChance({ proficiency: 0, toolTier: 1, node: copperVein })
    const high = calcGatherChance({ proficiency: 10_000, toolTier: 1, node: copperVein })
    expect(high).toBeGreaterThan(low)
  })

  it('숙련도 10만에서 상한에 닿는다', () => {
    expect(calcGatherChance({ proficiency: 99_999, toolTier: 1, node: copperVein })).toBeCloseTo(0.98)
  })

  it('상한을 넘지 않는다', () => {
    expect(calcGatherChance({ proficiency: 100_000_000, toolTier: 9, node: copperVein })).toBeCloseTo(0.98)
  })
})
