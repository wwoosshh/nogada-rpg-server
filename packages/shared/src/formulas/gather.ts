import type { NodeDef } from '../types.js'
import { clamp } from './clamp.js'

export interface GatherContext {
  skillLevel: number
  toolTier: number
  node: NodeDef
}

/**
 * 도구 등급이 노드 등급을 충족하는지. 숙련도와 무관한 순수 등급 게이트라
 * `canGather`(실행 가능 여부)와 `packages/data`의 도달 가능성 검사가 이 하나의
 * 정의를 공유한다 — 여기서만 바뀌면 둘 다 같이 바뀐다.
 */
export function toolCoversNode(toolTier: number, node: NodeDef): boolean {
  return toolTier >= node.tier
}

/** 도구 등급이나 숙련도가 모자라면 시도 자체가 불가능하다. */
export function canGather(ctx: GatherContext): boolean {
  return toolCoversNode(ctx.toolTier, ctx.node) && ctx.skillLevel >= ctx.node.requiredLevel
}

/** 채집 성공률. canGather 가 false 면 0. */
export function calcGatherChance(ctx: GatherContext): number {
  if (!canGather(ctx)) return 0
  const overLevel = ctx.skillLevel - ctx.node.requiredLevel
  const overTool = ctx.toolTier - ctx.node.tier
  return clamp(0.5 + overLevel * 0.02 + overTool * 0.1, 0.05, 0.95)
}
