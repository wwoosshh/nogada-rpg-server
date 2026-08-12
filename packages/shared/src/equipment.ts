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

/**
 * 그 기술의 시작 도구 **후보** — "kind=tool ∧ toolTier=1 ∧ toolSkill=그 기술"
 * 유도(§6-앞 8)의 술어가 여기 한 번만 적힌다. 지급(starterToolFor)과
 * packages/data 의 빌드 검증("채집 기술마다 정확히 하나")이 이 목록 하나를
 * 나눠 읽는다 — 술어를 두 벌로 적으면 지급과 검증이 서로 다른 도구를 셀 수 있다.
 */
export function starterToolCandidates(skill: SkillId, items: Record<string, ItemDef>): ItemDef[] {
  return Object.values(items).filter((item) => item.toolTier === 1 && toolMatchesSkill(item, skill))
}

/**
 * 신규 캐릭터가 받는 그 기술의 시작 도구.
 *
 * 아이템 id 를 상수로 들고 있던 구 STARTING_TOOL_IDS 는 CSV 에서 도구를 개명하는
 * 날 상수만 낡았다 — 유도는 카탈로그가 바뀌면 답도 함께 바뀐다. 후보가 정확히
 * 하나가 아니면 던진다: 빌드 검증이 먼저 막아 주므로 여기 닿았다면 검증을
 * 거치지 않은 데이터다. 조용히 첫 후보를 집으면 도구 둘이 경합하는 날에도
 * 아무도 모른 채 어느 쪽이 지급될지 순서 운에 걸린다.
 */
export function starterToolFor(skill: SkillId, items: Record<string, ItemDef>): ItemDef {
  const candidates = starterToolCandidates(skill, items)
  if (candidates.length !== 1) {
    const ids = candidates.map((tool) => tool.id).join(', ')
    throw new Error(
      `기술 "${skill}" 의 1티어 도구가 정확히 하나여야 하는데 [${ids}](${candidates.length}개)다 — items.csv 의 toolTier·toolSkill 을 정리한다`,
    )
  }
  return candidates[0]!
}
