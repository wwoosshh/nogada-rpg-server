import type { RecipeDef } from '../types.js'
import { clamp } from './clamp.js'

export interface CraftContext {
  skillLevel: number
  /** 착용한 망치의 등급. 없으면 0 — 맨손으로도 제작은 가능하되 성공률이 낮다. */
  toolTier: number
  recipe: RecipeDef
}

export function canCraft(ctx: CraftContext): boolean {
  return ctx.skillLevel >= ctx.recipe.requiredLevel
}

/** 제작 성공률. canCraft 가 false 면 0. */
export function calcCraftSuccess(ctx: CraftContext): number {
  if (!canCraft(ctx)) return 0
  const over = ctx.skillLevel - ctx.recipe.requiredLevel
  return clamp(0.6 + over * 0.03 + ctx.toolTier * 0.05, 0.1, 1)
}
