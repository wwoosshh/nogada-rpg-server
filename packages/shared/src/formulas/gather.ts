import type { ItemDef, SkillId } from '../types.js'

/**
 * 아이템이 이 생활기술의 도구인지. 등급은 보지 않는다 — 노드가 없는 자리에서도
 * 물어야 하는 질문이라 접근 판정(canGather)과 분리한다.
 *
 * `equippedToolTier`(착용 기준)와 `packages/data` 의 도달 가능성 검사(노드 기준)가
 * 이 하나의 정의를 공유한다. 양쪽에 따로 적으면 "도구로 인정하는 조건"이 두 벌이
 * 되어 어긋난다.
 */
export function toolMatchesSkill(tool: ItemDef, skill: SkillId): boolean {
  return tool.kind === 'tool' && tool.toolSkill === skill
}

/**
 * 맨손 거부 — "그 기술의 도구가 착용됨(equippedToolTier > 0)" 이 채집의 유일한
 * 접근 게이트다(설계 §7-앞 8).
 *
 * 예전에는 노드 tier 와의 비교(toolCoversNode)가 이 거부를 부수효과로 만들어
 * 냈는데, 노드 tier 게이트가 폐지되면서(§3.3) 그 비교를 순진하게 지우면 맨손
 * 채집이 열린다 — 그래서 명시 조건으로 다시 적는다. 등급은 접근이 아니라
 * roll 보정(gatherTable.ts 의 toolGatherFactor)의 재료다.
 */
export function canGather(equippedTier: number): boolean {
  return equippedTier > 0
}
