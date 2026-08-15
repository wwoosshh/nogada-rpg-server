import { MONSTER_RESPAWN_MS, type MonsterDef, type MonsterPlacements } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { actionTarget, combatTargetAt } from './combatTarget.js'

/*
 * A 버튼의 전투 술어(설계 §7·§12-앞 21).
 *
 * 현행 A 는 앞칸 고정(interactableAt(frontTile))이고, 전투만 사거리(맨해튼 1,
 * shared 의 withinAttackRange — 서버 판정과 같은 술어)다. 둘이 동시에 성립하면
 * **앞칸(노드)이 우선**이다 — 채집 조작이 한 톨도 안 달라지는 쪽을 고른 결정이고,
 * 그 우선순위를 여기 순수 함수로 못박아 화면(WorldScene)이 분기를 따로 짓지
 * 않게 한다.
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

describe('combatTargetAt — 사거리는 맨해튼 1, 죽은 배치는 부재다', () => {
  // 왜: C5 의 범위 그 자체다 — 몬스터 데이터가 오기 전(C6)의 세계에서 이
  //     술어는 조용히 null 이어야 A 가 채집·대화와 한 톨도 다르지 않게 돈다.
  it('배치가 비어 있으면 null 이다', () => {
    expect(
      combatTargetAt({ defs: {}, placements: {}, mapId: '사냥터', slain: {}, tile: { x: 0, y: 0 }, now: 0 }),
    ).toBeNull()
  })

  it('맨해튼 1 이내의 살아 있는 몬스터를 고른다', () => {
    const world = placementsOf([stillWolf('wolf', 3, 3)])
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 3, y: 4 }, now: 0 })).toBe('wolf-1')
  })

  // 왜: 거리가 체비쇼프로 재지면 대각 칸(맨해튼 2)이 사거리에 들어와, 서버
  //     (withinAttackRange — 맨해튼)가 헛스윙으로 판정할 자리를 화면이 "닿는다"
  //     고 말하게 된다 — §12-앞 6 의 대각 픽스처를 화면 쪽에서도 문다.
  it('대각 한 칸(맨해튼 2)은 사거리 밖이다', () => {
    const world = placementsOf([stillWolf('wolf', 3, 3)])
    expect(combatTargetAt({ ...world, mapId: '사냥터', slain: {}, tile: { x: 4, y: 4 }, now: 0 })).toBeNull()
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
