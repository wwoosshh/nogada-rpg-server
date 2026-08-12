import { describe, expect, it } from 'vitest'
import type { ItemDef, NodeDef } from '../types.js'
import { calcGatherChance, canGather, toolAppliesTo, toolCoversNode } from './gather.js'

const copperVein: NodeDef = {
  id: 'copper_vein',
  name: '구리 광맥',
  skill: 'mineral',
  tableId: 'mineral',
  variant: 'normal',
}

// 옛 "심층 노드" — 표 모델에서는 같은 표의 다른 외형일 뿐, 접근 게이트가 아니다.
const ironVein: NodeDef = { ...copperVein, id: 'iron_vein', variant: 'deep' }

const copperPickaxe: ItemDef = {
  id: 'copper_pickaxe',
  name: '구리 곡괭이',
  kind: 'tool',
  toolSkill: 'mineral',
  toolTier: 1,
  icon: 'pickaxe_copper',
}

describe('toolCoversNode', () => {
  // 노드 tier 게이트는 폐지됐다(설계 §7-앞 8) — 남은 질문은 "도구가 있는가(>0)" 뿐이다.
  // G3 이 판정을 교체하면서 이 함수를 은퇴시킨다.
  it('도구가 있으면(등급 > 0) true 다', () => {
    expect(toolCoversNode(1)).toBe(true)
  })

  it('맨손(등급 0)이면 false 다', () => {
    expect(toolCoversNode(0)).toBe(false)
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

  it('1등급 도구도 심층 외형(deep) 노드에 적용된다 — variant 는 표시일 뿐 게이트가 아니다', () => {
    expect(toolAppliesTo(copperPickaxe, ironVein)).toBe(true)
  })

  it('숙련 종류가 같으면 true 다', () => {
    expect(toolAppliesTo(copperPickaxe, copperVein)).toBe(true)
  })
})

describe('canGather', () => {
  it('그 기술의 도구를 착용했으면 채집할 수 있다', () => {
    expect(canGather({ proficiency: 1, toolTier: 1, node: copperVein })).toBe(true)
  })

  it('맨손(toolTier 0)이면 채집할 수 없다 — 숙련도가 아무리 높아도', () => {
    expect(canGather({ proficiency: 999_999, toolTier: 0, node: copperVein })).toBe(false)
  })

  it('숙련도가 0 이어도 도구만 있으면 채집할 수 있다', () => {
    expect(canGather({ proficiency: 0, toolTier: 1, node: copperVein })).toBe(true)
  })
})

// calcGatherChance 는 임시다 — 노드가 baseChance 를 잃어 상수 0.5 에서 출발한다.
// G3 이 표 기반 gatherOutcome 으로 교체하면서 이 함수와 테스트를 함께 은퇴시킨다.
describe('calcGatherChance', () => {
  it('맨손이면 0 이다', () => {
    expect(calcGatherChance({ proficiency: 999_999, toolTier: 0, node: copperVein })).toBe(0)
  })

  it('숙련도 0 이면 기본 성공률 0.5 다', () => {
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
