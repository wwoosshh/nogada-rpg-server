import type { RecipeDef } from '../types.js'
import { clamp } from './clamp.js'
import {
  CHANCE_DECADES,
  CRAFT_TOOL_TIER_CHANCE_BONUS,
  MAX_SUCCESS_CHANCE,
  MIN_SUCCESS_CHANCE,
  proficiencyProgress,
} from './proficiency.js'

export interface CraftContext {
  /** 조합 숙련도 */
  proficiency: number
  /** 착용한 망치의 등급. 없으면 0 — 맨손으로도 제작은 가능하되 성공률이 낮다. */
  toolTier: number
  recipe: RecipeDef
}

/** 제작은 도구 게이트가 없다. 조합 숙련도가 레시피를 연다. */
export function canCraft(ctx: CraftContext): boolean {
  return ctx.proficiency >= ctx.recipe.requiredSkill
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
  const withToolBonus = base + (MAX_SUCCESS_CHANCE - base) * t + ctx.toolTier * CRAFT_TOOL_TIER_CHANCE_BONUS
  return clamp(withToolBonus, MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE)
}
