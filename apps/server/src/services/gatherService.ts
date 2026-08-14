import {
  barrierSeparates,
  EFFICIENCY_MULTIPLIER,
  gatherHandOf,
  gatherIntervalMs,
  gatherOutcome,
  newlyAchieved,
  nodeAvailable,
  rollInt,
  type BarrierRegions,
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
  /**
   * 결계 뒤 칸들. 확률표와 같은 자세로 앱 조립 시점에 주입받는다 — 서버 전용
   * 산출물이고(`@nogada/data/barriers`) 클라이언트 번들에 실리지 않는다.
   *
   * **선택 인자가 아니다.** 비워 두면 이 아크가 막은 구멍이 조용히 다시 열리고,
   * 그 사실은 화면 어디에도 흔적을 안 남긴다(심층이 그냥 캐질 뿐이다). 필수로
   * 두면 배선을 잊는 날 컴파일러가 먼저 말한다.
   */
  barriers: BarrierRegions
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
//
// `node_closed` 는 "그 노드는 있고 당신은 그 앞에 서 있는데 지금은 안 열린다" 다 —
// 날씨·시각 조건이다(노드 종류 설계 §3). **다른 거절과 뭉치지 않는 이유**는
// `MoveErrorCode` 가 `no_transition` 과 `locked` 를 나눈 그 이유와 같다: 플레이어가
// 할 일이 다르다. `wrong_side` 는 화면이 말할 것이 없는(정상 조작으로 도달할 수
// 없는) 거절이지만, 이쪽은 **가루를 쓰거나 기다리면 열리는** 노드라 화면이 무엇이
// 필요한지 말해야 한다. 그 문구를 짓는 것은 화면의 몫이고(gameStore), 여기서는
// 코드만 나눠 준다 — 조건 자체는 응답에 싣지 않는다. 화면이 GameData 로 이미
// 그 노드를 알고 있어 같은 술어를 부를 수 있기 때문이다(결계와 같은 자세).
export type GatherErrorCode =
  | 'unknown_node'
  | 'wrong_map'
  | 'wrong_side'
  | 'node_closed'
  | 'too_fast'

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
  const { data, tables, barriers, instanceId, rng, now } = args
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

  // 그리고 **같은 맵 안의 벽 반대편**도 앞칸일 수가 없다 — 그것도 서버가 확실히 안다.
  //
  // 위 검사만으로 부족한 이유: 결계는 맵 안 전환이라(`fromMap === toMap`, 설계 §3
  // — 새 맵을 짓지 않고 같은 맵 안에 벽으로 안쪽을 만든다) 저 줄에게 결계 안과
  // 밖은 같은 맵이다. 심층 노드의 instanceId 는 맵 JSON 을 받는 클라이언트의
  // 손에 이미 있으므로, 이 줄이 없으면 벽 바깥에 선 사람이 요청 하나로 심층
  // 표(B2 가 준 ×2.5 분포)를 굴린다 — 결계가 이 아크의 전부인데 devtools 로
  // 우회된다. **이 아크가 만든 구멍이고, 여기서 닫는다.**
  //
  // 서버가 답을 아는 이유: 결계도 전환이라 넘은 사람의 저장된 위치는 벽 안쪽
  // 도착 칸이다(moveThroughTransition 이 갱신한다). 저장된 x·y 가 지금 실제로
  // 서 있는 칸이 아니어도(마지막 전환 도착 칸이다) **어느 벽 구역인가**는
  // 틀리지 않는다 — 구역을 바꾸는 유일한 방법이 전환이기 때문이다.
  //
  // **게이트를 다시 재지 않는다.** 묻는 것은 "조건을 만족하는가"가 아니라
  // "지금 그 안에 있는가" 뿐이다(barrierSeparates 의 문서). 허브 결계는 물이
  // 빠졌을 때만 들어갈 수 있지만 안내판이 "나오는 길은 막지 않았다"고 약속했고
  // (설계 §6), 들어간 뒤에는 물이 차도 안에서 계속 캘 수 있어야 한다.
  //
  // **"노드는 잠기지 않고, 숙련은 접근이 아니라 분포를 바꾼다"(milestones.ts)를
  // 되살리는 것이 아니다.** 그 규범이 금지한 것은 노드 **앞에 선** 사람을 게임이
  // 못 캔다고 거절하는 일인데, 여기서 거절당하는 사람은 애초에 그 앞에 설 수
  // 없다 — 벽이 막는다. 게임플레이 게이트가 아니라 **위조된 요청에만 걸리는
  // 검사**이고, 정상 조작으로는 도달할 수 없는 코드다.
  if (barrierSeparates(barriers, placement, player.location)) {
    return { ok: false, code: 'wrong_side' }
  }

  // 그리고 **지금 이 노드가 열려 있는가** — 날씨·시각 조건이다(설계 §3).
  //
  // **판정을 여기서 짓지 않는다.** 부등호는 shared 의 nodeAvailable 하나뿐이고
  // 화면도 같은 함수를 부른다 — 결계가 transitionGate 에 모인 그 자리, 그 이유다.
  // 여기서 노드의 조건 칸과 `player.weather` 를 직접 견주는 줄을 한 줄 적는 순간
  // 화면이 열린 노드로 그려 놓고 서버만 거절하는 날이 온다. 조건 없는 노드는
  // null 이라 그대로 지나간다 — 출하 열두 노드 중 보통·심층 여덟이 그쪽이다.
  // (그 칸 이름이 이 파일에 없는 것 자체를 nodeAvailability.test.ts 가 문다.)
  //
  // **자리 검사 둘 다음, 간격 검사 앞이다.** 맵·벽과 같은 이유다: 눈이 와야
  // 열리는 노드 앞에서 too_fast 를 받으면 "조금 있다 다시 두드리면 된다"로
  // 읽히는데, 몇 초를 기다려도 답이 안 바뀐다.
  //
  // **그래서 이 거절은 `nextActionAt` 을 읽지도 쓰지도 않는다**(moveService 가
  // 결계에 부딪힌 요청을 쿨다운으로 벌하지 않는 그 이유). 닫힌 노드를 한 번
  // 두드린 것만으로 그 사람의 노가다가 느려지면 안 된다 — 거절에는 player 가
  // 실리지 않으므로 저장될 것 자체가 없다.
  const gate = nodeAvailable(node, player.weather, now)
  if (gate && !gate.open) return { ok: false, code: 'node_closed' }

  const proficiency = player.skills[node.skill]
  // 이 기술로 캐는 지금 이 손 — 착용한 도구(없거나 엉뚱한 기술이면 맨손, §6-앞 9)와
  // 가지고 있는 그 계열 증표(설계 §5)가 여기서 한 번 합쳐진다. 게이트는 없다(§2):
  // 맨손도 캐되 프로필(roll ×1.45·간격 ×1.5)이 페널티를 진다. 판정(gatherOutcome)과
  // 간격 스탬프(gatherIntervalMs)가 **같은 손**을 본다 — 각자 조회하면 한쪽만
  // 증표를 세는 날이 온다.
  const hand = gatherHandOf(player, node.skill, data.items)

  // 검사 순서: 대상 존재 → 같은 맵 → 같은 벽 구역 → 노드 조건 → 간격 → 난수.
  // (도구 자격 검사는 은퇴했다.)
  //
  // 자리 검사 둘과 조건 검사가 간격보다 앞인 이유는 같다: 맵이 다르거나 벽
  // 반대편이면 언제 두드려도 닿을 수 없고, 눈이 안 오면 몇 초를 기다려도 답이
  // 안 바뀐다 — too_fast 로 답하면 셋 다 "조금 있다 다시 두드리면 된다"로 읽힌다.
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
  const achieved = newlyAchieved(data, player, player.celebrated)
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
