import { describe, expect, it } from 'vitest'
import type { RecipeDef } from '../types.js'
import { calcCraftSuccess, canCraft } from './craft.js'

const copperIngot: RecipeDef = {
  id: 'copper_ingot',
  name: '구리 주괴',
  skill: 'smithing',
  requiredLevel: 1,
  inputs: [{ item: 'copper_ore', count: 2 }],
  output: { item: 'copper_ingot', count: 1 },
}

const mithrilPickaxe: RecipeDef = { ...copperIngot, id: 'mithril_pickaxe', requiredLevel: 28 }

describe('canCraft', () => {
  it('숙련도를 충족하면 제작할 수 있다', () => {
    expect(canCraft({ skillLevel: 1, toolTier: 0, recipe: copperIngot })).toBe(true)
  })

  it('숙련도가 모자라면 제작할 수 없다', () => {
    expect(canCraft({ skillLevel: 27, toolTier: 3, recipe: mithrilPickaxe })).toBe(false)
  })
})

describe('calcCraftSuccess', () => {
  it('제작 불가 조건에서는 0 을 반환한다', () => {
    expect(calcCraftSuccess({ skillLevel: 1, toolTier: 3, recipe: mithrilPickaxe })).toBe(0)
  })

  it('망치 없이 요구 숙련도만 만족하면 기본 확률이다', () => {
    expect(calcCraftSuccess({ skillLevel: 1, toolTier: 0, recipe: copperIngot })).toBeCloseTo(0.6)
  })

  it('숙련도가 높을수록 확률이 오른다', () => {
    const low = calcCraftSuccess({ skillLevel: 1, toolTier: 0, recipe: copperIngot })
    const high = calcCraftSuccess({ skillLevel: 5, toolTier: 0, recipe: copperIngot })
    expect(high).toBeGreaterThan(low)
  })

  it('망치 등급이 높을수록 확률이 오른다', () => {
    const bare = calcCraftSuccess({ skillLevel: 1, toolTier: 0, recipe: copperIngot })
    const armed = calcCraftSuccess({ skillLevel: 1, toolTier: 2, recipe: copperIngot })
    expect(armed).toBeGreaterThan(bare)
  })

  it('1.0 을 넘지 않는다', () => {
    expect(calcCraftSuccess({ skillLevel: 999, toolTier: 3, recipe: copperIngot })).toBe(1)
  })
})
