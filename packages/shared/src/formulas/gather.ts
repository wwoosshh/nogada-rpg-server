import type { ItemDef, NodeDef, SkillId } from '../types.js'
import { clamp } from './clamp.js'
import { CHANCE_DECADES, MAX_SUCCESS_CHANCE, MIN_SUCCESS_CHANCE, proficiencyProgress } from './proficiency.js'

export interface GatherContext {
  /** 그 기술의 누적 숙련도 */
  proficiency: number
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

/**
 * 아이템이 이 생활기술의 도구인지. 등급은 보지 않는다 — 노드가 없는 자리에서도
 * 물어야 하는 질문이라 등급 게이트와 분리한다.
 *
 * `toolAppliesTo`(노드 기준)와 `equippedToolTier`(착용 기준)가 이 하나의 정의를
 * 공유한다. 양쪽에 따로 적으면 "도구로 인정하는 조건"이 두 벌이 되어 어긋난다.
 */
export function toolMatchesSkill(tool: ItemDef, skill: SkillId): boolean {
  return tool.kind === 'tool' && tool.toolSkill === skill
}

/**
 * 아이템이 이 노드를 채집할 수 있는 도구인지 — "이 도구가 이 노드에 적용되는가"
 * 라는 질문 전체에 답한다: 도구 종류이고, 숙련 종류가 노드와 같고, 등급이
 * 노드를 충족해야 true. `packages/data`의 도달 가능성 검사와 `equippedToolTier`
 * 가 이 하나의 정의를 공유한다 — 절반만 여기 두면 반드시 어긋난다.
 */
export function toolAppliesTo(tool: ItemDef, node: NodeDef): boolean {
  return toolMatchesSkill(tool, node.skill) && toolCoversNode(tool.toolTier ?? 0, node)
}

/** 도구 등급이 모자라면 시도 자체가 불가능하다. 숙련도는 노드를 막지 않는다. */
export function canGather(ctx: GatherContext): boolean {
  return toolCoversNode(ctx.toolTier, ctx.node)
}

/**
 * 채집 성공률. canGather 가 false 면 0.
 *
 * 숙련도 10만에서 상한에 닿는다. 상한을 1 이 아니라 0.98 로 두어 판정이 살아 있게
 * 하되, 영구 실패율을 크게 두지는 않는다 — 초당 20회를 누르는 게임에서 잦은 실패는
 * 난이도가 아니라 소음이다.
 */
export function calcGatherChance(ctx: GatherContext): number {
  if (!canGather(ctx)) return 0
  const t = proficiencyProgress(ctx.proficiency, CHANCE_DECADES)
  const base = ctx.node.baseChance
  return clamp(base + (MAX_SUCCESS_CHANCE - base) * t, MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE)
}
