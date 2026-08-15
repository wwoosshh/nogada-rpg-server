import { MONSTER_RESPAWN_MS, type MonsterDef, type MonsterPlacements } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { actionTarget, combatTargetAt } from './combatTarget.js'

/*
 * A 버튼의 전투 술어(설계 §7·§12-앞 21).
 *
 * 현행 A 는 앞칸 고정(interactableAt(frontTile))이고, 전투는 **맵의 최근접
 * 생존 배치를 사거리 무관하게** 겨냥한다 — 사거리 밖이면 서버가 헛스윙으로
 * 판정하고 그것이 의도다(§2-2 갱신본: 헛스윙도 간격을 내고 피격은 판정된다).
 * 사거리 게이트가 클라에 있던 첫 판은 C7 이 재현한 무위험 DPS 칸을 낳았다
 * (combatTargetAt 본문 주석). 둘이 동시에 성립하면 **앞칸(노드)이 우선**이다 —
 * 채집 조작이 한 톨도 안 달라지는 쪽을 고른 결정이고, 그 우선순위를 여기 순수
 * 함수로 못박아 화면(WorldScene)이 분기를 따로 짓지 않게 한다.
 */

/** 제자리 몬스터 — 사거리 검사는 몬스터의 "지금 칸"을 보므로 칸을 고정하면 읽기 쉽다. */
function stillWolf(id: string, x: number, y: number): MonsterDef {
  return { id, name: '들늑대', periodMs: 400, patrol: [{ x, y }], attacks: [] }
}

function placementsOf(defs: MonsterDef[], mapId = '사냥터'): {
  defs: Record<string, MonsterDef>
  placements: MonsterPlacements
} {
  return {
    defs: Object.fromEntries(defs.map((d) => [d.id, d])),
    placements: Object.fromEntries(
      defs.map((d) => [
        `${d.id}-1`,
        { instanceId: `${d.id}-1`, monsterId: d.id, mapId, phaseOffsetMs: 0, maxHp: 30, sweepDamage: 5 },
      ]),
    ),
  }
}

describe('combatTargetAt — 맵의 최근접 생존 배치, 사거리 무관', () => {
  // 왜: 몬스터 없는 맵에서 이 술어는 조용히 null 이어야 A 가 채집·대화와
  //     한 톨도 다르지 않게 돈다.
  it('배치가 비어 있으면 null 이다', () => {
    expect(
      combatTargetAt({ defs: {}, placements: {}, mapId: '사냥터', slain: {}, tile: { x: 0, y: 0 }, now: 0 }),
    ).toBeNull()
  })

  it('맨해튼 1 이내의 살아 있는 몬스터를 고른다', () => {
    const world = placementsOf([stillWolf('wolf', 3, 3)])
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 3, y: 4 }, now: 0 })).toBe('wolf-1')
  })

  // 왜: 사거리 밖도 겨냥해야 홀드가 헛스윙을 계속 흘린다 — 클라가 사거리로
  //     스윙을 거르면 "위험 창이 몬스터가 멀 때 오는 칸"(늑대 순찰 옆칸의
  //     반대편 부채꼴)이 무위험 DPS 자리가 된다(C7 재현). 명중이냐 헛스윙이냐는
  //     서버(attackConnects)의 몫이고 화면은 표적만 고른다.
  it('사거리 밖(맨해튼 2)이어도 겨냥한다 — 헛스윙은 서버가 판정한다', () => {
    const world = placementsOf([stillWolf('wolf', 3, 3)])
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 4, y: 4 }, now: 0 })).toBe('wolf-1')
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 9, y: 9 }, now: 0 })).toBe('wolf-1')
  })

  // 왜: 리스폰 대기 중의 배치는 부재다(shared 의 monsterAlive — 서버와 같은
  //     술어). 화면이 죽은 늑대를 계속 겨냥하면 홀드가 허공에 요청을 쏟는다.
  it('처치된 배치는 리스폰 대기가 끝나기 전까지 겨냥하지 않는다', () => {
    const world = placementsOf([stillWolf('wolf', 3, 3)])
    const slain = { 'wolf-1': 1_000 }
    const during = 1_000 + MONSTER_RESPAWN_MS - 1
    const after = 1_000 + MONSTER_RESPAWN_MS
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain, tile: { x: 3, y: 4 }, now: during })).toBeNull()
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain, tile: { x: 3, y: 4 }, now: after })).toBe('wolf-1')
  })

  it('다른 맵의 배치는 겨냥하지 않는다', () => {
    const world = placementsOf([stillWolf('wolf', 3, 3)], '눈의마을')
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 3, y: 4 }, now: 0 })).toBeNull()
  })

  // 왜: 둘이 동시에 사거리 안이면 가까운 쪽이다 — 겹쳐 선 늑대(거리 0)를 두고
  //     옆 칸 늑대를 때리면 화면의 겨냥과 몸의 감각이 어긋난다.
  it('여럿이 사거리 안이면 가장 가까운 배치를 고른다', () => {
    const world = placementsOf([stillWolf('near', 3, 3), stillWolf('far', 3, 2)])
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 3, y: 3 }, now: 0 })).toBe('near-1')
  })
})

describe('actionTarget — 노드(앞칸)가 우선이다(§12-앞 21)', () => {
  // 왜: 앞칸에 노드가 있고 옆에 늑대가 있을 때 A 가 늑대를 때리면 채집 조작이
  //     달라진다 — "채집이 한 톨도 안 달라진다"가 이 우선순위의 전부다.
  //     우선순위를 뒤집는 돌연변이가 이 단언에서 빨개진다.
  it('앞칸 대상과 사거리 몬스터가 겹치면 앞칸이 이긴다', () => {
    const front = { kind: 'node' as const, instanceId: 'vein-1', nodeId: 'vein' }
    expect(actionTarget(front, 'wolf-1')).toEqual({ kind: 'front', target: front })
  })

  it('앞칸이 비었으면 사거리 몬스터가 대상이 된다', () => {
    expect(actionTarget(null, 'wolf-1')).toEqual({ kind: 'fight', instanceId: 'wolf-1' })
  })

  it('둘 다 없으면 null 이다', () => {
    expect(actionTarget(null, null)).toBeNull()
  })
})
