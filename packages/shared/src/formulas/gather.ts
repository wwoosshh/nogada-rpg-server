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
 * 도구가 채집을 열 수 있는 등급인지 — "그 기술의 도구가 있다(> 0)" 가 전부다.
 *
 * 노드 등급 게이트는 폐지됐다(설계 §3.3: 노드에 tier 가 없어졌다). 도구 등급은
 * 이제 접근이 아니라 roll 보정(gatherFactor)의 재료다. // G3 이 판정을 교체한다
 */
export function toolCoversNode(toolTier: number): boolean {
  return toolTier > 0
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
 * 아이템이 이 노드를 채집할 수 있는 도구인지 — 도구 종류이고 숙련 종류가 노드와
 * 같으면 된다. 등급 조건이 사라진 것은 노드 tier 게이트의 폐지(설계 §7-앞 8)다.
 * `packages/data`의 도달 가능성 검사가 이 정의를 공유한다.
 */
export function toolAppliesTo(tool: ItemDef, node: NodeDef): boolean {
  return toolMatchesSkill(tool, node.skill) && toolCoversNode(tool.toolTier ?? 0)
}

/**
 * 맨손 거부 — "그 기술의 도구가 착용됨(equippedToolTier > 0)" 이 유일한 접근
 * 게이트다(설계 §7-앞 8). 예전에는 tier 비교의 부수효과였는데, 노드 tier 가
 * 사라진 지금은 이것이 명시 조건이다.
 */
export function canGather(ctx: GatherContext): boolean {
  return toolCoversNode(ctx.toolTier)
}

/**
 * 임시 채집 성공률. 노드가 baseChance 를 잃어(설계 §3.2) 옛 일반 노드의 값
 * 0.5 를 상수로 쓴다 — 표 기반 티어 판정(gatherOutcome)이 이 함수를 통째로
 * 은퇴시킨다. // G3 이 판정을 교체한다
 */
const LEGACY_BASE_CHANCE = 0.5

export function calcGatherChance(ctx: GatherContext): number {
  if (!canGather(ctx)) return 0
  const t = proficiencyProgress(ctx.proficiency, CHANCE_DECADES)
  return clamp(
    LEGACY_BASE_CHANCE + (MAX_SUCCESS_CHANCE - LEGACY_BASE_CHANCE) * t,
    MIN_SUCCESS_CHANCE,
    MAX_SUCCESS_CHANCE,
  )
}
