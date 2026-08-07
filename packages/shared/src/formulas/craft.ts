import type { RecipeDef } from '../types.js'
import { clamp } from './clamp.js'

export interface CraftContext {
  /** 조합 숙련도 */
  proficiency: number
  /** 착용한 망치의 등급. 없으면 0 — 맨손으로도 제작은 가능하되 성공률이 낮다. */
  toolTier: number
  recipe: RecipeDef
}

/** 제작은 도구 게이트가 없다. 조합 숙련도가 레시피를 연다. */
export function canCraft(ctx: CraftContext): boolean {
  return ctx.proficiency >= ctx.recipe.requiredLevel
}

/** 제작 성공률. canCraft 가 false 면 0. Task 3 에서 로그 곡선으로 바뀐다. */
export function calcCraftSuccess(ctx: CraftContext): number {
  if (!canCraft(ctx)) return 0
  return clamp(0.6 + ctx.toolTier * 0.05, 0.1, 1)
}
