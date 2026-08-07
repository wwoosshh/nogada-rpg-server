import {
  actionIntervalMs,
  calcGatherChance,
  canGather,
  EFFICIENCY_MULTIPLIER,
  equippedToolTier,
  rollInt,
  yieldBonus,
  type GameData,
  type PlayerState,
  type RecipeInput,
} from '@nogada/shared'

export interface PerformGatherArgs {
  player: PlayerState
  data: GameData
  instanceId: string
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
}

export type GatherErrorCode = 'unknown_node' | 'cannot_gather' | 'too_fast'

export type GatherResult = { ok: true; outcome: GatherOutcome } | { ok: false; code: GatherErrorCode }

/**
 * 채집 판정. 성패와 산출 수량을 여기서 확정하고 결과만 내려보낸다.
 *
 * 확률은 `calcGatherChance` 하나에서 나온다 — 클라이언트가 툴팁에 그리는
 * 예상치와 실제 판정이 같은 함수라서 표시값과 결과가 어긋날 수 없다.
 */
export function performGather(args: PerformGatherArgs): GatherResult {
  const { data, instanceId, rng, now } = args
  const placement = data.placements[instanceId]
  if (!placement) return { ok: false, code: 'unknown_node' }
  const node = data.nodes[placement.nodeId]
  // 배치가 없는 노드를 가리키는 것은 데이터 검증이 막으므로 여기 오면 데이터가 깨진 것이다.
  if (!node) return { ok: false, code: 'unknown_node' }

  const player = structuredClone(args.player)
  const proficiency = player.skills[node.skill]
  const toolTier = equippedToolTier(player, data, node.skill)
  const ctx = { proficiency, toolTier, node }

  if (!canGather(ctx)) return { ok: false, code: 'cannot_gather' }

  // 검사 순서: 대상 존재 → 접근 자격 → 간격 → 난수.
  //
  // 간격 검사가 난수보다 앞인 이유는, 거부된 요청이 시드를 소비하면 연타로 판정
  // 결과를 흔들 수 있기 때문이다. 자격 검사보다 뒤인 이유는, 캘 수 없는 노드를
  // 두드리는 것이 간격까지 잡아먹으면 안 되기 때문이다 — 자격 미달은 조작
  // 실수이지 속도 위반이 아니다.
  if (now < player.nextActionAt) return { ok: false, code: 'too_fast' }

  const chance = calcGatherChance(ctx)
  const success = rng() < chance

  // 성패와 무관하게 간격은 걸린다. 실패도 한 번의 행동이다.
  player.nextActionAt = now + actionIntervalMs(proficiency)

  if (!success) {
    return {
      ok: true,
      outcome: { success: false, chance, gained: null, skillGained: 0, player },
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
    },
  }
}
