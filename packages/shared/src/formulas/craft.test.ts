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

// 계열 문턱이 걸린 합성 픽스처 — 조합 500 과 얼음 채집 1,000 을 **둘 다** 요구한다.
// 출하 CSV 17행은 전부 문턱 칸이 비어 있으므로(C1), 두 문을 가진 레시피는
// 여기서 지어내야만 그릴 수 있다.
const fixtureIceGatedRecipe: RecipeDef = {
  ...fixtureHighRequiredSkillRecipe,
  id: 'fixture_ice_gated_recipe',
  gateSkill: 'ice',
  gateValue: 1000,
}

describe('canCraft', () => {
  it('숙련도를 충족하면 제작할 수 있다', () => {
    expect(canCraft({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })).toBe(true)
  })

  it('숙련도가 모자라면 제작할 수 없다', () => {
    expect(canCraft({ proficiency: 499, toolTier: 3, enhanceLevel: 0, recipe: fixtureHighRequiredSkillRecipe })).toBe(false)
  })

  // 왜: 조합 25,000 인 사람이 얼음을 오늘 처음 캐면 그 재료는 0.01% 드랍이다 —
  //     조합만 보면 "열렸다"고 말해 놓고 11시간짜리 벽을 숨기게 된다(§6-앞 9).
  it('조합은 넘었어도 계열 채집 숙련이 모자라면 열리지 않는다', () => {
    expect(
      canCraft({ proficiency: 25_000, toolTier: 0, enhanceLevel: 0, gateProficiency: 999, recipe: fixtureIceGatedRecipe }),
    ).toBe(false)
  })

  // 왜: 두 번째 숫자가 첫 번째를 대신하는 것이 아니다 — 계열을 아무리 캤어도
  //     조합 요구치는 그대로 남는다.
  it('계열은 넘었어도 조합이 모자라면 열리지 않는다', () => {
    expect(
      canCraft({ proficiency: 499, toolTier: 0, enhanceLevel: 0, gateProficiency: 50_000, recipe: fixtureIceGatedRecipe }),
    ).toBe(false)
  })

  it('둘 다 넘으면 열린다', () => {
    expect(
      canCraft({ proficiency: 500, toolTier: 0, enhanceLevel: 0, gateProficiency: 1000, recipe: fixtureIceGatedRecipe }),
    ).toBe(true)
  })

  // 왜(회귀): 출하된 17행은 문턱 칸이 비어 있다 — 계열 숙련이 0 이든 뭐든
  //     예전과 똑같이 조합 하나만이 문이어야 한다.
  it('문턱이 없는 레시피는 계열 숙련을 아예 보지 않는다', () => {
    expect(canCraft({ proficiency: 1, toolTier: 0, enhanceLevel: 0, gateProficiency: 0, recipe: copperIngot })).toBe(true)
    expect(canCraft({ proficiency: 1, toolTier: 0, enhanceLevel: 0, recipe: copperIngot })).toBe(true)
  })

  // 왜: 문턱 있는 레시피를 판정하면서 계열 숙련을 안 넘긴 호출자는 버그다.
  //     그 버그가 문을 **여는** 쪽으로 기울면 서버가 못 막은 제작이 통과한다 —
  //     닫는 쪽으로 기울면 화면이 이상해질 뿐이라, 안전한 쪽을 고른다.
  it('계열 숙련을 빠뜨린 호출은 문을 닫는다', () => {
    expect(canCraft({ proficiency: 25_000, toolTier: 0, enhanceLevel: 0, recipe: fixtureIceGatedRecipe })).toBe(false)
  })
})

describe('calcCraftSuccess', () => {
  it('제작 불가 조건에서는 0 을 반환한다', () => {
    expect(calcCraftSuccess({ proficiency: 499, toolTier: 3, enhanceLevel: 0, recipe: fixtureHighRequiredSkillRecipe })).toBe(0)
  })

  // 왜: 화면의 예상치와 서버 판정이 같은 함수라, 계열로 잠긴 카드도 "0%" 라고
  //     말해야 한다 — 조합만 넘겼다고 성공률을 그리면 못 만드는 문에 숫자가 붙는다.
  it('계열 문턱으로 잠긴 레시피도 0 을 반환한다', () => {
    expect(
      calcCraftSuccess({ proficiency: 25_000, toolTier: 3, enhanceLevel: 5, gateProficiency: 0, recipe: fixtureIceGatedRecipe }),
    ).toBe(0)
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
