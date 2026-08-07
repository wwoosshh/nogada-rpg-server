import { describe, expect, it } from 'vitest'
import type { RecipeDef } from '../types.js'
import { calcCraftSuccess, canCraft } from './craft.js'

const copperIngot: RecipeDef = {
  id: 'copper_ingot',
  name: '구리 주괴',
  skill: 'crafting',
  requiredSkill: 1,
  baseChance: 0.6,
  inputs: [{ item: 'copper_ore', count: 2 }],
  output: { item: 'copper_ingot', count: 1 },
  skillGainMin: 10,
  skillGainMax: 20,
}

// 실제 카탈로그에 없는 합성 픽스처 — 배포된 CSV의 어떤 아이템도 가리키지 않도록
// 이름을 일부러 가짜스럽게 짓는다 (요구 숙련도가 높은 레시피를 흉내 낼 뿐).
const fixtureHighRequiredSkillRecipe: RecipeDef = {
  ...copperIngot,
  id: 'fixture_high_required_skill_recipe',
  requiredSkill: 500,
}

describe('canCraft', () => {
  it('숙련도를 충족하면 제작할 수 있다', () => {
    expect(canCraft({ proficiency: 1, toolTier: 0, recipe: copperIngot })).toBe(true)
  })

  it('숙련도가 모자라면 제작할 수 없다', () => {
    expect(canCraft({ proficiency: 499, toolTier: 3, recipe: fixtureHighRequiredSkillRecipe })).toBe(false)
  })
})

describe('calcCraftSuccess', () => {
  it('제작 불가 조건에서는 0 을 반환한다', () => {
    expect(calcCraftSuccess({ proficiency: 499, toolTier: 3, recipe: fixtureHighRequiredSkillRecipe })).toBe(0)
  })

  it('망치 없이 요구 숙련도만 만족하면 기본 확률이다', () => {
    expect(calcCraftSuccess({ proficiency: 1, toolTier: 0, recipe: copperIngot })).toBeCloseTo(0.6)
  })

  it('요구 숙련도를 넘어서면 성공률이 오른다', () => {
    const low = calcCraftSuccess({ proficiency: 1, toolTier: 0, recipe: copperIngot })
    const high = calcCraftSuccess({ proficiency: 10_001, toolTier: 0, recipe: copperIngot })
    expect(high).toBeGreaterThan(low)
  })

  it('망치 등급이 높을수록 확률이 오른다', () => {
    const bare = calcCraftSuccess({ proficiency: 1, toolTier: 0, recipe: copperIngot })
    const armed = calcCraftSuccess({ proficiency: 1, toolTier: 2, recipe: copperIngot })
    expect(armed).toBeGreaterThan(bare)
  })

  it('요구 숙련도보다 10만 쌓이면 상한에 닿는다', () => {
    expect(calcCraftSuccess({ proficiency: 100_000, toolTier: 0, recipe: copperIngot })).toBeCloseTo(0.98)
  })

  it('상한을 넘지 않는다', () => {
    expect(calcCraftSuccess({ proficiency: 100_000_000, toolTier: 99, recipe: copperIngot })).toBeCloseTo(0.98)
  })
})
