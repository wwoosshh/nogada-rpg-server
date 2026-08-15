import type { EquipSlot, ItemDef } from '../types.js'

/**
 * 아이템이 이 슬롯의 도구인지. 등급은 보지 않는다 — 등급은 접근이 아니라
 * 효과 프로필(gatherToolProfile)의 재료다.
 *
 * `equippedToolInfo`(착용 기준)와 `packages/data` 의 검증(카탈로그 기준)이
 * 이 하나의 정의를 공유한다. 양쪽에 따로 적으면 "도구로 인정하는 조건"이 두 벌이
 * 되어 어긋난다.
 *
 * 인자가 SkillId 가 아니라 EquipSlot 인 것은 무기('combat', 전투 §12-앞 8) 때문
 * 이다 — 술어를 무기용으로 하나 더 만들면 위 두 벌 문제가 슬롯 축에서 재현된다.
 */
export function toolMatchesSkill(tool: ItemDef, skill: EquipSlot): boolean {
  return tool.kind === 'tool' && tool.toolSkill === skill
}

// canGather 는 은퇴했다(설계 §2 — 맨손 채집 허용). 도구는 이제 접근 게이트가
// 아니라 페널티의 부재다: 맨손도 캐되 느리고(간격 ×1.5) 실패가 잦다(roll ×1.45).
// 그 숫자들은 gatherToolProfile(toolProfile.ts)이 말한다.
