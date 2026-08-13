import {
  EFFICIENCY_MULTIPLIER,
  gatherHandOf,
  gatherIntervalMs,
  gatherOutcome,
  newlyAchieved,
  rollInt,
  type GameData,
  type GatherTables,
  type MilestoneDef,
  type PlayerState,
} from '@nogada/shared'

export interface PerformGatherArgs {
  player: PlayerState
  data: GameData
  /**
   * 확률표. GameData 에는 없다 — 브라켓 경계·잭팟 확률이 곧 숨은 문턱이라
   * 클라이언트 번들에 실으면 F12 로 스포일된다(설계 §7-앞 9). 서버만 아는
   * 별도 진입(`@nogada/data/gather-tables`)에서 앱 조립 시점에 주입받는다.
   */
  tables: GatherTables
  instanceId: string
  /** 서버가 시드를 독점한다. 클라이언트는 이 인자를 만들 수 없다. */
  rng: () => number
  now: number
}

export interface GatherOutcome {
  success: boolean
  /** 성공 시 뽑힌 아이템 1개. 수량은 항상 1 이다(설계 §3.2 — 표 모델에는 수량 스케일링이 없다). */
  gained: { itemId: string; count: 1 } | null
  skillGained: number
  /**
   * 이번 행동으로 새로 달성된 이정표. **실패한 손질도 문턱을 넘길 수 있다**
   * (설계 §7-앞 7 — 숙련 증가가 성패 무관 무조건이므로). 거부(요청 자체가
   * ok: false 인) 경로에서만 이 필드 자체가 존재하지 않는다.
   */
  achieved: MilestoneDef[]
  player: PlayerState
}

// cannot_gather 는 은퇴했다(§2 — 맨손 채집 허용): 도구는 접근 게이트가 아니라
// 페널티의 부재이고, 맨손의 숫자(roll ×1.45·간격 ×1.5)는 gatherToolProfile 이 진다.
export type GatherErrorCode = 'unknown_node' | 'wrong_map' | 'too_fast'

export type GatherResult = { ok: true; outcome: GatherOutcome } | { ok: false; code: GatherErrorCode }

/**
 * 채집 판정. 표 기반 티어 판정(gatherOutcome, packages/shared)이 유일한 판정
 * 주체다(설계 §2) — 성공률이 아니라 **무엇이 나오는가**가 숙련의 함수다.
 *
 * 판정 순서(설계 §7-앞 7 — 이 순서 자체가 규범이다):
 *   ① gatherOutcome 이 표에서 티어(또는 실패)를 굴린다.
 *   ② 숙련 증가는 **성패 무관 무조건**이다 — 표 메타(skillGainMin~Max)가 정한
 *      범위에서 항상 오른다. 실패한 손질도 숙련이다.
 *   ③ newlyAchieved 재판정도 **무조건**이다 — 실패한 손질이 문턱을 넘겨도
 *      축하가 침묵하면 안 된다.
 *   ④ 아이템 지급은 성공 시에만.
 */
export function performGather(args: PerformGatherArgs): GatherResult {
  const { data, tables, instanceId, rng, now } = args
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
  // 이 기술로 캐는 지금 이 손 — 착용한 도구(없거나 엉뚱한 기술이면 맨손, §6-앞 9)와
  // 가지고 있는 그 계열 증표(설계 §5)가 여기서 한 번 합쳐진다. 게이트는 없다(§2):
  // 맨손도 캐되 프로필(roll ×1.45·간격 ×1.5)이 페널티를 진다. 판정(gatherOutcome)과
  // 간격 스탬프(gatherIntervalMs)가 **같은 손**을 본다 — 각자 조회하면 한쪽만
  // 증표를 세는 날이 온다.
  const hand = gatherHandOf(player, node.skill, data.items)

  // 검사 순서: 대상 존재 → 같은 맵 → 간격 → 난수. (도구 자격 검사는 은퇴했다.)
  //
  // 맵 검사가 간격보다 앞인 이유는, 맵이 다르면 언제 두드려도 닿을 수 없기
  // 때문이다 — too_fast 로 답하면 "조금 있다 다시 두드리면 된다"로 읽힌다.
  //
  // 간격 검사가 난수보다 앞인 이유는, 거부된 요청이 시드를 소비하면 연타로 판정
  // 결과를 흔들 수 있기 때문이다.
  if (now < player.nextActionAt) return { ok: false, code: 'too_fast' }

  const table = tables[node.tableId]
  // 노드가 존재하지 않는 표를 가리키는 것은 데이터 검증(validateGatherTables)이
  // 막으므로 여기 오면 데이터가 깨진 것이다 — unknown_node 와 같은 성격의 방어다.
  if (!table) return { ok: false, code: 'unknown_node' }

  const { itemId } = gatherOutcome(table, proficiency, hand, rng)
  const success = itemId !== null

  // 성패와 무관하게 간격은 걸린다. 실패도 한 번의 행동이다. 채집 간격은 손 전체의
  // 몫(티어 배수 × 0.97^강화 × 속도증표)이다 — 서버의 이 스탬프와 클라의 표시가
  // 같은 함수(gatherIntervalMs) 하나를 부른다(§6-앞 10). 제작 스탬프도 이제
  // 자기 함수(craftIntervalMs)를 갖지만 그쪽이 곱하는 것은 **강화뿐**이다:
  // 망치의 티어는 성공률을 사므로 간격까지 사면 이중 계산이다(제작 확장 §6-앞 14).
  player.nextActionAt = now + gatherIntervalMs(proficiency, hand)

  // ② 숙련 증가 — 성패 무관 무조건. 표 메타가 범위를 정한다(노드가 아니라
  // 표가 소유한다, 설계 §7-앞 3).
  const skillGained = rollInt(rng, table.skillGainMin, table.skillGainMax) * EFFICIENCY_MULTIPLIER
  player.skills[node.skill] += skillGained

  // ③ 달성 재판정 — 역시 무조건. 실패한 손질이 숙련을 올려 문턱을 넘겨도
  // 이번 응답에 그 사실이 실려야 플레이어가 "그 행동 때문에 열렸다" 를 느낀다.
  const achieved = newlyAchieved(data.milestones, player, player.celebrated)
  for (const m of achieved) player.celebrated.push(m.id)

  if (!success) {
    return { ok: true, outcome: { success: false, gained: null, skillGained, achieved, player } }
  }

  // ④ 지급 — 성공 시에만. 수량은 항상 1(설계 §3.2).
  player.stacks[itemId] = (player.stacks[itemId] ?? 0) + 1

  return {
    ok: true,
    outcome: { success: true, gained: { itemId, count: 1 }, skillGained, achieved, player },
  }
}
