import {
  manhattanDistance,
  monsterAlive,
  monsterStateAt,
  type MonsterDef,
  type MonsterPlacements,
  type TilePos,
} from '@nogada/shared'

/**
 * A 버튼의 전투 술어(설계 §7·§12-앞 21) — WorldScene 이 매 프레임 부른다.
 *
 * 현행 A 는 앞칸 고정(interactableAt(frontTile))이고 전투만 사거리다. 부등호는
 * 서버 판정과 **같은 shared 술어**(withinAttackRange — 맨해튼 1)를 부른다:
 * 화면이 제 비교를 한 줄 더 적는 순간, 서버가 헛스윙으로 판정할 자리를 화면만
 * "닿는다"고 말하는 날이 온다(transitionGate·nodeAvailable 규범).
 */

export interface CombatTargetArgs {
  defs: Record<string, MonsterDef>
  placements: MonsterPlacements
  mapId: string
  /** 처치 기록(combat.slain) — 리스폰 대기 중의 배치는 부재라 겨냥하지 않는다. */
  slain: Record<string, number>
  /** 플레이어가 지금 서 있는 칸 — 서버에 보낼 주장 칸과 같은 값이다. */
  tile: TilePos
  now: number
}

/**
 * 지금 A 가 겨냥할 몬스터 배치 — **이 맵의 살아 있는 배치 중 가장 가까운 것.
 * 사거리 밖이어도 겨냥한다**(헛스윙). 배치가 없으면 null — 몬스터 없는 맵에서는
 * A 가 채집·대화와 한 톨도 다르지 않게 돈다.
 *
 * 사거리 안만 겨냥하던 첫 구현은 방치자 모형(검사 3: 홀드하면 헛스윙이 계속
 * 흐른다)을 클라이언트에서 끊었다 — C7 이 재현했다: 어떤 공격 칸은 위험 창이
 * "몬스터가 그 칸에서 멀 때" 오는데(늑대 순찰 옆칸의 C-왼쪽 부채꼴), 사거리
 * 게이트는 정확히 그 순간의 스윙을 삼켜 그 칸을 무위험 DPS 자리로 만들었다.
 * 홀드가 사거리 무관하게 스윙을 흘려야 "허공에 휘두른 대가로 간격을 내고
 * 피격은 판정된다"(§2-2 갱신본)가 화면에서도 참이 된다.
 *
 * 몬스터의 "지금 칸"은 `monsterStateAt(def, now + 위상)` 의 tile 이다 — 서버가
 * 판정 순간에 읽는 그 칸(fightService 의 attackConnects)이고, 여기서 ε 를 흉내
 * 내지 않는 것은 의도다: 화면의 겨냥은 낙관이고 판정은 서버의 몫이다.
 */
export function combatTargetAt(args: CombatTargetArgs): string | null {
  let best: { instanceId: string; distance: number } | null = null
  for (const placement of Object.values(args.placements)) {
    if (placement.mapId !== args.mapId) continue
    const def = args.defs[placement.monsterId]
    if (!def) continue
    if (!monsterAlive(args.slain, placement.instanceId, args.now)) continue

    // 가까운 쪽 — 겹쳐 선 늑대(거리 0)를 두고 옆 칸을 때리면 화면의 겨냥과
    // 몸의 감각이 어긋난다. 동점이면 등록 순서의 첫 것이다.
    const monsterTile = monsterStateAt(def, args.now + placement.phaseOffsetMs).tile
    const distance = manhattanDistance(args.tile, monsterTile)
    if (!best || distance < best.distance) best = { instanceId: placement.instanceId, distance }
  }
  return best?.instanceId ?? null
}

/**
 * 앞칸 대상과 사거리 몬스터가 겹치면 **앞칸(노드)이 우선이다**(§12-앞 21).
 *
 * 이 한 줄이 "채집 조작이 한 톨도 안 달라진다"의 전부라, WorldScene 의 분기가
 * 아니라 순수 함수로 못박아 우선순위를 테스트가 물게 한다.
 */
export function actionTarget<T>(
  front: T | null,
  fightInstanceId: string | null,
): { kind: 'front'; target: T } | { kind: 'fight'; instanceId: string } | null {
  if (front !== null) return { kind: 'front', target: front }
  if (fightInstanceId !== null) return { kind: 'fight', instanceId: fightInstanceId }
  return null
}
