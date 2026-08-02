import { toolMatchesSkill } from './formulas/gather.js'
import type { GameData, PlayerState, SkillId } from './types.js'

/**
 * 해당 생활기술에 착용 중인 도구의 등급. 없거나 부적합하면 0.
 *
 * 서버는 판정에, 클라이언트는 예상 성공률 표시에 같은 함수를 쓴다.
 * 도구로 인정하는 조건은 `toolMatchesSkill` 하나에서 온다.
 */
export function equippedToolTier(player: PlayerState, data: GameData, skill: SkillId): number {
  const instanceId = player.equipped[skill]
  if (!instanceId) return 0

  const instance = player.instances.find((i) => i.instanceId === instanceId)
  if (!instance) return 0

  const def = data.items[instance.itemId]
  if (!def || !toolMatchesSkill(def, skill)) return 0

  return def.toolTier ?? 0
}
