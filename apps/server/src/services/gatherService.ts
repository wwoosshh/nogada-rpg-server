import {
  actionIntervalMs,
  calcGatherChance,
  canGather,
  EFFICIENCY_MULTIPLIER,
  equippedToolTier,
  newlyAchieved,
  rollInt,
  yieldBonus,
  type GameData,
  type MilestoneDef,
  type NodeDef,
  type PlayerState,
  type RecipeInput,
} from '@nogada/shared'

/**
 * 임시 산출물 — 노드가 yieldItem 을 잃고 표(tableId)를 가리키게 됐지만, 표를
 * 읽는 판정(gatherOutcome)과 서버의 표 주입은 다음 태스크의 것이다. 그때까지
 * 옛 nodes.csv 가 노드마다 갖던 산출물을 기술·외형별로 보존해 행동이 변하지
 * 않게 한다. // G4 가 표 판정으로 교체한다
 */
const LEGACY_YIELD: Record<string, string> = {
  'ice:normal': 'ice_shard',
  'ice:deep': 'pure_ice',
  'wood:normal': 'soft_log',
  'wood:deep': 'hard_log',
  'mineral:normal': 'copper_ore',
  'mineral:deep': 'iron_ore',
  'herb:normal': 'common_herb',
  'herb:deep': 'rare_herb',
}

function legacyYieldItem(node: NodeDef): string | undefined {
  return LEGACY_YIELD[`${node.skill}:${node.variant}`]
}

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
  /** 이번 행동으로 새로 달성된 이정표. 실패·거부 경로에서는 항상 빈 배열이다. */
  achieved: MilestoneDef[]
  player: PlayerState
}

export type GatherErrorCode = 'unknown_node' | 'wrong_map' | 'cannot_gather' | 'too_fast'

export type GatherResult = { ok: true; outcome: GatherOutcome } | { ok: false; code: GatherErrorCode }

/**
 * 채집 판정. 성패와 산출 수량을 여기서 확정하고 결과만 내려보낸다.
 *
 * 확률은 `calcGatherChance` 하나에서 나온다 — 클라이언트가 툴팁에 그리는
 * 예상치와 실제 판정이 같은 함수라서 표시값과 결과가 어긋날 수 없다.
 */
export function performGather(args: PerformGatherArgs): GatherResult {
  const { data, instanceId, rng, now } = args
  // instanceId 는 클라이언트가 그대로 보낸 문자열이다. Object.hasOwn 없이
  // data.placements[instanceId] 로 바로 읽으면 "constructor" 같은 상속 키가
  // 프로토타입 체인에서 값을 찾아 truthy 를 반환한다 — 그 값이 Placement
  // 모양이 아니라서 지금은 아래 node 조회에서 결국 걸러지지만, 그건 우연이지
  // 의도가 아니다. packages/data/src/validate.ts 의 hasItem 과 같은 방식으로
  // 자기 소유 키인지부터 확인한다.
  const placement = Object.hasOwn(data.placements, instanceId) ? data.placements[instanceId] : undefined
  if (!placement) return { ok: false, code: 'unknown_node' }
  const node = data.nodes[placement.nodeId]
  // 배치가 없는 노드를 가리키는 것은 데이터 검증이 막으므로 여기 오면 데이터가 깨진 것이다.
  if (!node) return { ok: false, code: 'unknown_node' }

  const player = structuredClone(args.player)

  // 맵이 여럿이 되면 요청만으로는 그 노드가 플레이어 앞칸에 있는지 알 수 없다.
  // 앞칸 판정 자체는 클라이언트에 있고 서버는 걸음마다 위치를 받지 않지만,
  // **맵이 다르면 앞칸일 수가 없다** — 그것만은 서버가 확실히 안다. 이 검사가
  // 없으면 인스턴스 id 하나로 맵 너머의 노드를 캘 수 있다.
  if (placement.mapId !== player.location.mapId) return { ok: false, code: 'wrong_map' }

  const proficiency = player.skills[node.skill]
  const toolTier = equippedToolTier(player, data, node.skill)
  const ctx = { proficiency, toolTier, node }

  if (!canGather(ctx)) return { ok: false, code: 'cannot_gather' }

  // 검사 순서: 대상 존재 → 같은 맵 → 접근 자격 → 간격 → 난수.
  //
  // 맵 검사가 자격보다 앞인 이유는, 맵이 다르면 도구를 아무리 갖춰도 닿을 수
  // 없기 때문이다 — cannot_gather 로 답하면 "도구가 모자라구나" 로 읽힌다.
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
      outcome: { success: false, chance, gained: null, skillGained: 0, achieved: [], player },
    }
  }

  // 임시 산출 — 옛 nodes.csv 의 수량(일반 1~3, 심층 1~2)과 증가치(전 노드 1~2)를
  // 상수로 보존한다. 표가 정하는 진짜 판정은 G4 가 넣는다.
  const yieldItem = legacyYieldItem(node)
  if (!yieldItem) return { ok: false, code: 'unknown_node' }
  const count = rollInt(rng, 1, node.variant === 'deep' ? 2 : 3) + yieldBonus(proficiency)
  player.stacks[yieldItem] = (player.stacks[yieldItem] ?? 0) + count

  // 효율 배수는 아직 항상 1 이다. 식에 자리를 두는 이유는, 나중에 배수를 도입할 때
  // 저장된 숙련도의 의미나 증가 경로를 다시 손대지 않기 위해서다.
  const skillGained = rollInt(rng, 1, 2) * EFFICIENCY_MULTIPLIER
  player.skills[node.skill] += skillGained

  // 달성 판정은 숙련도가 오른 뒤에 한다. 이번 행동으로 넘긴 것을 이번 응답에 실어야
  // 플레이어가 "그 행동 때문에 열렸다" 를 느낀다.
  const achieved = newlyAchieved(data.milestones, player, player.celebrated)
  for (const m of achieved) player.celebrated.push(m.id)

  return {
    ok: true,
    outcome: {
      success: true,
      chance,
      gained: { item: yieldItem, count },
      skillGained,
      achieved,
      player,
    },
  }
}
