import { describe, expect, it } from 'vitest'
import type { RecipeDef } from '../types.js'
import { calcCraftSuccess, canCraft, hammerChanceBonus } from './craft.js'
import { CRAFT_TOOL_TIER_CHANCE_BONUS } from './proficiency.js'
import { ENHANCE_CAP, HAMMER_ENHANCE_CHANCE_BONUS } from './toolProfile.js'

const copperIngot: RecipeDef = {
  id: 'copper_ingot',
  name: '구리 주괴',
  category: '제련',
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
    expect(canCraft({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })).toBe(true)
  })

  it('숙련도가 모자라면 제작할 수 없다', () => {
    expect(canCraft({ proficiency: 499, toolTier: 3, enhanceLevel: 0, recipe: fixtureHighRequiredSkillRecipe })).toBe(false)
  })
})

describe('calcCraftSuccess', () => {
  it('제작 불가 조건에서는 0 을 반환한다', () => {
    expect(calcCraftSuccess({ proficiency: 499, toolTier: 3, enhanceLevel: 0, recipe: fixtureHighRequiredSkillRecipe })).toBe(0)
  })

  it('망치 없이 요구 숙련도만 만족하면 기본 확률이다', () => {
    expect(calcCraftSuccess({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })).toBeCloseTo(0.6)
  })

  it('요구 숙련도를 넘어서면 성공률이 오른다', () => {
    const low = calcCraftSuccess({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })
    const high = calcCraftSuccess({ proficiency: 10_001, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })
    expect(high).toBeGreaterThan(low)
  })

  it('망치 등급이 높을수록 확률이 오른다', () => {
    const bare = calcCraftSuccess({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })
    const armed = calcCraftSuccess({ proficiency: 1, toolTier: 2, enhanceLevel: 0, recipe: copperIngot })
    expect(armed).toBeGreaterThan(bare)
  })

  it('망치 강화 +1당 성공률이 0.3%p 씩 오른다 — 망치의 강화 축은 간격이 아니라 조합이다(§5·§6-앞 10)', () => {
    // 서버 판정과 클라 예상치(craftCardModel)가 같은 함수라는 규범을 지키려고
    // 보너스가 calcCraftSuccess **안**에 산다 — 밖에서 더하면 언젠가 둘이 갈라진다.
    const plain = calcCraftSuccess({ proficiency: 1, toolTier: 2, enhanceLevel: 0, recipe: copperIngot })
    const enhanced = calcCraftSuccess({ proficiency: 1, toolTier: 2, enhanceLevel: ENHANCE_CAP, recipe: copperIngot })
    expect(enhanced - plain).toBeCloseTo(ENHANCE_CAP * HAMMER_ENHANCE_CHANCE_BONUS)
  })

  it('hammerChanceBonus 와 같은 보너스를 더한다 — 판정과 자동 착용 비교(craftService)가 식 하나를 나눠 읽는다', () => {
    const bare = calcCraftSuccess({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })
    const armed = calcCraftSuccess({ proficiency: 1, toolTier: 2, enhanceLevel: 3, recipe: copperIngot })
    expect(armed - bare).toBeCloseTo(hammerChanceBonus(2, 3))
  })

  it('요구 숙련도보다 10만 쌓이면 상한에 닿는다', () => {
    expect(calcCraftSuccess({ proficiency: 100_000, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })).toBeCloseTo(0.98)
  })

  it('상한을 넘지 않는다 — 등급도 강화도 0.98 벽을 못 뚫는다', () => {
    expect(calcCraftSuccess({ proficiency: 100_000_000, toolTier: 99, enhanceLevel: 99, recipe: copperIngot })).toBeCloseTo(0.98)
  })
})

describe('hammerChanceBonus — 망치의 유효 성공률 보너스', () => {
  it('등급 ×2%p + 강화 ×0.3%p — 등급과 강화가 한 숫자로 합쳐지는 유일한 자리다', () => {
    expect(hammerChanceBonus(0, 0)).toBe(0)
    expect(hammerChanceBonus(2, 0)).toBeCloseTo(2 * CRAFT_TOOL_TIER_CHANCE_BONUS)
    expect(hammerChanceBonus(1, ENHANCE_CAP)).toBeCloseTo(
      CRAFT_TOOL_TIER_CHANCE_BONUS + ENHANCE_CAP * HAMMER_ENHANCE_CHANCE_BONUS,
    )
  })

  // 티어와 강화의 크기 관계(상위 티어 기본 > 하위 티어 만강, §6-앞 18)는 채집
  // 축의 같은 불변식 바로 옆(toolProfile.test.ts)에서 강제한다 — 두 축이 한
  // 규범을 나눠 가지므로 부등식도 한자리에 모아 둔다. 여기는 식의 모양만 본다.
})
