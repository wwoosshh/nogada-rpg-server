import { toolMatchesSkill } from './formulas/gather.js'
import type { GameData, ItemDef, ItemInstance, PlayerState, SkillId } from './types.js'

/**
 * 착용 중인 도구의 정의와 인스턴스 한 쌍 — 효과는 정의(toolTier)에, 강화 수치는
 * 인스턴스(enhanceLevel)에 있어서 간격 계산(gatherIntervalMs)은 둘 다 필요하다.
 */
export interface EquippedToolInfo {
  def: ItemDef
  instance: ItemInstance
}

/**
 * 해당 생활기술에 착용 중인 도구. 없거나 **엉뚱한 기술의 도구면 null** — 이
 * null 이 곧 맨손이고, 판정자는 이것을 gatherToolProfile(null)·gatherIntervalMs
 * 에 그대로 넘긴다(§6-앞 9 — "엉뚱한 도구 = 맨손" 규범은 프로필이 아니라 이
 * 조회가 지킨다). 서버 판정과 클라 표시가 같은 함수를 쓴다.
 */
export function equippedToolInfo(
  player: PlayerState,
  skill: SkillId,
  items: Record<string, ItemDef>,
): EquippedToolInfo | null {
  const instanceId = player.equipped[skill]
  if (!instanceId) return null

  const instance = player.instances.find((i) => i.instanceId === instanceId)
  if (!instance) return null

  const def = items[instance.itemId]
  if (!def || !toolMatchesSkill(def, skill)) return null

  return { def, instance }
}

/**
 * 해당 생활기술에 착용 중인 도구의 등급. 없거나 부적합하면 0.
 *
 * 제작 판정(망치 등급 보너스)이 쓴다 — 채집 쪽 효과는 등급 숫자가 아니라
 * gatherToolProfile 이 말하므로, 채집 판정자는 equippedToolInfo 를 직접 쓴다.
 */
export function equippedToolTier(player: PlayerState, data: GameData, skill: SkillId): number {
  return equippedToolInfo(player, skill, data.items)?.def.toolTier ?? 0
}
