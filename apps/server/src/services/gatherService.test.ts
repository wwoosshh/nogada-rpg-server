import type { GameData, PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { performGather } from './gatherService.js'

const data: GameData = {
  items: {
    copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
    copper_pickaxe: {
      id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
      toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
    },
  },
  nodes: {
    copper_vein: {
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1, baseChance: 0.5,
      yieldItem: 'copper_ore', yieldMin: 2, yieldMax: 2,
      skillGainMin: 1, skillGainMax: 2,
    },
    iron_vein: {
      id: 'iron_vein', name: '철 광맥', skill: 'mineral', tier: 2, baseChance: 0.4,
      yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 1,
      skillGainMin: 1, skillGainMax: 2,
    },
    // 숙련도 증가가 데이터에서 오는지 확인용. 증가량이 의도적으로 1이 아니므로
    // gatherService.ts 를 hardcoded +1 로 되돌린 경우를 감지한다.
    mithril_vein: {
      id: 'mithril_vein', name: '미스릴 광맥', skill: 'mineral', tier: 1, baseChance: 0.5,
      yieldItem: 'copper_ore', yieldMin: 2, yieldMax: 2,
      skillGainMin: 7, skillGainMax: 7,
    },
  },
  recipes: {},
  placements: {
    'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 3, y: 3 },
    'iron_vein-1': { instanceId: 'iron_vein-1', nodeId: 'iron_vein', x: 5, y: 3 },
    'mithril_vein-1': { instanceId: 'mithril_vein-1', nodeId: 'mithril_vein', x: 7, y: 3 },
  },
  milestones: [],
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'i1' },
    nextActionAt: 0,
    celebrated: [],
    ...overrides,
  }
}

/** 항상 성공시키는 난수 — 0 은 어떤 확률보다도 작다 */
const alwaysSucceed = () => 0
/** 항상 실패시키는 난수 — 0.999 는 상한 0.98 보다 크다 */
const alwaysFail = () => 0.999

describe('performGather', () => {
  it('없는 노드는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, instanceId: 'ghost-1', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })

  it('같은 종류의 다른 인스턴스를 각각 지목할 수 있다', () => {
    // 종류 id 만 보내던 때에는 불가능했던 일이다. 이 테스트가 인스턴스 해석이
    // 실제로 일어나는지 지킨다 — 종류로 되돌리면 두 인스턴스가 구분되지 않는다.
    const d: GameData = {
      ...data,
      placements: {
        ...data.placements,
        'copper_vein-2': { instanceId: 'copper_vein-2', nodeId: 'copper_vein', x: 9, y: 3 },
      },
    }
    const a = performGather({ player: player(), data: d, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    const b = performGather({ player: player(), data: d, instanceId: 'copper_vein-2', rng: alwaysSucceed, now: 0 })
    if (!a.ok || !b.ok) throw new Error('둘 다 성공해야 한다')
    expect(a.outcome.gained).toEqual(b.outcome.gained)
  })

  it('없는 인스턴스는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, instanceId: 'nope-9', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })

  it('도구 등급이 모자라면 cannot_gather 로 거부한다', () => {
    const r = performGather({ player: player(), data, instanceId: 'iron_vein-1', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'cannot_gather' })
  })

  it('맨손이면 cannot_gather 로 거부한다', () => {
    const p = player({ instances: [], equipped: {} })
    const r = performGather({ player: p, data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'cannot_gather' })
  })

  it('간격이 지나지 않았으면 too_fast 로 거부한다', () => {
    const p = player({ nextActionAt: 8000 })
    const r = performGather({ player: p, data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  it('간격이 지났으면 채집할 수 있다', () => {
    const p = player({ nextActionAt: 5000 })
    const r = performGather({ player: p, data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 5000 })
    expect(r.ok).toBe(true)
  })

  it('숙련도 0 이면 다음 행동까지 500ms 를 기다린다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('숙련도가 높으면 간격이 짧아진다', () => {
    const p = player({ skills: { ice: 0, wood: 0, mineral: 999_999, herb: 0, crafting: 0 } })
    const r = performGather({ player: p, data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 50)
  })

  it('실패해도 간격은 걸린다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysFail, now: 1000 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  // 검사 순서 자체를 못 박는다: 간격도 안 지나고 접근 자격도 없는 상황에서
  // cannot_gather 가 나와야 접근 자격이 간격보다 먼저 검사된다는 것이 증명된다.
  // 이 시나리오 없이는 개별 거부 테스트만으로 순서를 구분할 수 없다.
  it('간격도 남아 있고 접근 자격도 없으면 cannot_gather 를 우선한다', () => {
    const p = player({ nextActionAt: 8000 })
    const r = performGather({ player: p, data, instanceId: 'iron_vein-1', rng: alwaysSucceed, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'cannot_gather' })
  })

  it('성공하면 산출물이 스택에 쌓이고 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.success).toBe(true)
    expect(r.outcome.gained).toEqual({ item: 'copper_ore', count: 2 })
    expect(r.outcome.player.stacks.copper_ore).toBe(2)
    expect(r.outcome.skillGained).toBeGreaterThan(0)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
  })

  it('실패하면 산출물이 없고 숙련도도 오르지 않는다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysFail, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.gained).toBeNull()
    expect(r.outcome.skillGained).toBe(0)
    expect(r.outcome.player.stacks).toEqual({})
  })

  it('이미 가진 재료에 누적한다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performGather({ player: p, data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.copper_ore).toBe(7)
  })

  it('다른 생활기술의 숙련도는 건드리지 않는다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.skills.ice).toBe(0)
    expect(r.outcome.player.skills.wood).toBe(0)
    expect(r.outcome.player.skills.herb).toBe(0)
    expect(r.outcome.player.skills.crafting).toBe(0)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    performGather({ player: p, data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    expect(p.stacks).toEqual({})
    expect(p.nextActionAt).toBe(0)
  })

  it('반환한 확률이 표시용 계산과 일치한다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.chance).toBeCloseTo(0.5)
  })

  it('성공하면 노드가 정한 만큼 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.skillGained).toBeGreaterThanOrEqual(1)
    expect(r.outcome.skillGained).toBeLessThanOrEqual(2)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
  })

  it('데이터 정의 숙련도 증가를 적용한다', () => {
    const r = performGather({ player: player(), data, instanceId: 'mithril_vein-1', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.skillGained).toBe(7)
    expect(r.outcome.player.skills.mineral).toBe(7)
  })

  it('숙련도가 높으면 수량 보너스가 붙는다', () => {
    const low = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    const high = performGather({
      player: player({ skills: { ice: 0, wood: 0, mineral: 99_999, herb: 0, crafting: 0 } }),
      data, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0,
    })
    if (!low.ok || !high.ok) throw new Error('둘 다 성공해야 한다')
    expect(high.outcome.gained!.count).toBeGreaterThan(low.outcome.gained!.count)
  })

  it('실패하면 숙련도가 오르지 않는다', () => {
    const r = performGather({ player: player(), data, instanceId: 'copper_vein-1', rng: alwaysFail, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.skillGained).toBe(0)
    expect(r.outcome.player.skills.mineral).toBe(0)
  })
})
