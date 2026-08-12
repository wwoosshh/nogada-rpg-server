import type { RecipeDef } from '../types.js'
import { clamp } from './clamp.js'
import {
  CHANCE_DECADES,
  CRAFT_TOOL_TIER_CHANCE_BONUS,
  MAX_SUCCESS_CHANCE,
  MIN_SUCCESS_CHANCE,
  proficiencyProgress,
} from './proficiency.js'
import { HAMMER_ENHANCE_CHANCE_BONUS } from './toolProfile.js'

export interface CraftContext {
  /** 조합 숙련도 */
  proficiency: number
  /** 착용한 망치의 등급. 없으면 0 — 맨손으로도 제작은 가능하되 성공률이 낮다. */
  toolTier: number
  /**
   * 착용한 망치의 강화 수치. 없으면 0. 보너스(+0.5%p/레벨)가 이 함수 밖이 아니라
   * calcCraftSuccess 안에 사는 이유: 서버 판정과 클라 예상치(craftCardModel)가
   * 같은 함수라는 규범(§6-앞 10) — 밖에서 더하면 언젠가 둘이 갈라진다.
   */
  enhanceLevel: number
  recipe: RecipeDef
}

/** 제작은 도구 게이트가 없다. 조합 숙련도가 레시피를 연다. */
export function canCraft(ctx: CraftContext): boolean {
  return ctx.proficiency >= ctx.recipe.requiredSkill
}

/**
 * 망치의 유효 성공률 보너스 — 등급과 강화가 한 숫자로 합쳐지는 유일한 자리.
 *
 * 판정(calcCraftSuccess)과 제작 후 자동 착용 비교(craftService)가 이 식 하나를
 * 나눠 읽는다. 두 벌로 적으면 판정과 비교가 서로 다른 망치를 "낫다"고 말할 수
 * 있다 — 채집 도구의 effectiveIntervalFactor 와 정확히 같은 이유다(§6-앞 2).
 */
export function hammerChanceBonus(toolTier: number, enhanceLevel: number): number {
  return toolTier * CRAFT_TOOL_TIER_CHANCE_BONUS + enhanceLevel * HAMMER_ENHANCE_CHANCE_BONUS
}

/**
 * 제작 성공률. canCraft 가 false 면 0.
 *
 * 요구 숙련도를 넘어선 만큼으로 계산한다 — 갓 열린 레시피는 기본값이고,
 * 숙련도가 자릿수만큼 더 쌓이면 상한에 닿는다. 망치는 접근 게이트가 아니라
 * 성공률 보조다.
 */
export function calcCraftSuccess(ctx: CraftContext): number {
  if (!canCraft(ctx)) return 0
  const over = ctx.proficiency - ctx.recipe.requiredSkill
  const t = proficiencyProgress(over, CHANCE_DECADES)
  const base = ctx.recipe.baseChance
  const withToolBonus =
    base + (MAX_SUCCESS_CHANCE - base) * t + hammerChanceBonus(ctx.toolTier, ctx.enhanceLevel)
  return clamp(withToolBonus, MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE)
}
