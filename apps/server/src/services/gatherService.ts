import {
  calcGatherChance,
  canGather,
  equippedToolTier,
  rollInt,
  yieldBonus,
  type GameData,
  type PlayerState,
  type RecipeInput,
} from '@nogada/shared'

/** 효율 배수. 이번 범위에서는 항상 1 이고, 올리는 수단은 아직 없다. */
const EFFICIENCY_MULTIPLIER = 1

export interface PerformGatherArgs {
  player: PlayerState
  data: GameData
  nodeId: string
  /** 서버가 시드를 독점한다. 클라이언트는 이 인자를 만들 수 없다. */
  rng: () => number
  now: number
}

export interface GatherOutcome {
  success: boolean
  chance: number
  gained: RecipeInput | null
  skillGained: number
  player: PlayerState
  cooldownUntil: number
}

export type GatherErrorCode = 'unknown_node' | 'cannot_gather' | 'on_cooldown'

export type GatherResult =
  | { ok: true; outcome: GatherOutcome }
  | { ok: false; code: GatherErrorCode; availableAt?: number }

/**
 * 채집 판정. 성패와 산출 수량을 여기서 확정하고 결과만 내려보낸다.
 *
 * 확률은 `calcGatherChance` 하나에서 나온다 — 클라이언트가 툴팁에 그리는
 * 예상치와 실제 판정이 같은 함수라서 표시값과 결과가 어긋날 수 없다.
 */
export function performGather(args: PerformGatherArgs): GatherResult {
  const { data, nodeId, rng, now } = args
  const node = data.nodes[nodeId]
  if (!node) return { ok: false, code: 'unknown_node' }

  const player = structuredClone(args.player)
  const proficiency = player.skills[node.skill]
  const toolTier = equippedToolTier(player, data, node.skill)
  const ctx = { proficiency, toolTier, node }

  if (!canGather(ctx)) return { ok: false, code: 'cannot_gather' }

  const availableAt = player.nodeCooldowns[nodeId] ?? 0
  if (now < availableAt) return { ok: false, code: 'on_cooldown', availableAt }

  const chance = calcGatherChance(ctx)
  const success = rng() < chance

  // 성패와 무관하게 쿨다운은 건다. 실패해도 노드는 소진된다.
  const cooldownUntil = now + node.respawnMs
  player.nodeCooldowns[nodeId] = cooldownUntil

  if (!success) {
    return {
      ok: true,
      outcome: { success: false, chance, gained: null, skillGained: 0, player, cooldownUntil },
    }
  }

  const count = rollInt(rng, node.yieldMin, node.yieldMax) + yieldBonus(proficiency)
  player.stacks[node.yieldItem] = (player.stacks[node.yieldItem] ?? 0) + count

  // 효율 배수는 아직 항상 1 이다. 식에 자리를 두는 이유는, 나중에 배수를 도입할 때
  // 저장된 숙련도의 의미나 증가 경로를 다시 손대지 않기 위해서다.
  const skillGained = rollInt(rng, node.skillGainMin, node.skillGainMax) * EFFICIENCY_MULTIPLIER
  player.skills[node.skill] += skillGained

  return {
    ok: true,
    outcome: {
      success: true,
      chance,
      gained: { item: node.yieldItem, count },
      skillGained,
      player,
      cooldownUntil,
    },
  }
}
