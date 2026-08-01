import type { NodeDef } from '../types.js'
import { clamp } from './clamp.js'

export interface GatherContext {
  skillLevel: number
  toolTier: number
  node: NodeDef
}

/** 도구 등급이나 숙련도가 모자라면 시도 자체가 불가능하다. */
export function canGather(ctx: GatherContext): boolean {
  return ctx.toolTier >= ctx.node.tier && ctx.skillLevel >= ctx.node.requiredLevel
}

/** 채집 성공률. canGather 가 false 면 0. */
export function calcGatherChance(ctx: GatherContext): number {
  if (!canGather(ctx)) return 0
  const overLevel = ctx.skillLevel - ctx.node.requiredLevel
  const overTool = ctx.toolTier - ctx.node.tier
  return clamp(0.5 + overLevel * 0.02 + overTool * 0.1, 0.05, 0.95)
}
