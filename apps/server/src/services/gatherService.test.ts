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
      yieldItem: 'copper_ore', yieldMin: 2, yieldMax: 2, respawnMs: 5000,
      skillGainMin: 1, skillGainMax: 2,
    },
    iron_vein: {
      id: 'iron_vein', name: '철 광맥', skill: 'mineral', tier: 2, baseChance: 0.4,
      yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 1, respawnMs: 9000,
      skillGainMin: 1, skillGainMax: 2,
    },
  },
  recipes: {},
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'i1' },
    nodeCooldowns: {},
    ...overrides,
  }
}

/** 항상 성공시키는 난수 — 0 은 어떤 확률보다도 작다 */
const alwaysSucceed = () => 0
/** 항상 실패시키는 난수 — 0.999 는 상한 0.98 보다 크다 */
const alwaysFail = () => 0.999

describe('performGather', () => {
  it('없는 노드는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, nodeId: 'ghost', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })

  it('도구 등급이 모자라면 cannot_gather 로 거부한다', () => {
    const r = performGather({ player: player(), data, nodeId: 'iron_vein', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'cannot_gather' })
  })

  it('맨손이면 cannot_gather 로 거부한다', () => {
    const p = player({ instances: [], equipped: {} })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'cannot_gather' })
  })

  it('쿨다운 중이면 on_cooldown 과 해제 시각을 반환한다', () => {
    const p = player({ nodeCooldowns: { copper_vein: 8000 } })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'on_cooldown', availableAt: 8000 })
  })

  it('쿨다운이 지났으면 채집할 수 있다', () => {
    const p = player({ nodeCooldowns: { copper_vein: 5000 } })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 5000 })
    expect(r.ok).toBe(true)
  })

  it('성공하면 산출물이 스택에 쌓이고 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.success).toBe(true)
    expect(r.outcome.gained).toEqual({ item: 'copper_ore', count: 2 })
    expect(r.outcome.player.stacks.copper_ore).toBe(2)
    expect(r.outcome.skillGained).toBeGreaterThan(0)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
  })

  it('실패하면 산출물이 없고 숙련도도 오르지 않는다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysFail, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.gained).toBeNull()
    expect(r.outcome.skillGained).toBe(0)
    expect(r.outcome.player.stacks).toEqual({})
  })

  it('실패해도 쿨다운은 걸린다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysFail, now: 1000 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.cooldownUntil).toBe(6000)
    expect(r.outcome.player.nodeCooldowns.copper_vein).toBe(6000)
  })

  it('이미 가진 재료에 누적한다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.copper_ore).toBe(7)
  })

  it('다른 생활기술의 숙련도는 건드리지 않는다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.skills.ice).toBe(0)
    expect(r.outcome.player.skills.wood).toBe(0)
    expect(r.outcome.player.skills.herb).toBe(0)
    expect(r.outcome.player.skills.crafting).toBe(0)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    expect(p.stacks).toEqual({})
    expect(p.nodeCooldowns).toEqual({})
  })

  it('반환한 확률이 표시용 계산과 일치한다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.chance).toBeCloseTo(0.5)
  })

  it('성공하면 노드가 정한 만큼 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.skillGained).toBeGreaterThanOrEqual(1)
    expect(r.outcome.skillGained).toBeLessThanOrEqual(2)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
  })

  it('숙련도가 높으면 수량 보너스가 붙는다', () => {
    const low = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    const high = performGather({
      player: player({ skills: { ice: 0, wood: 0, mineral: 99_999, herb: 0, crafting: 0 } }),
      data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0,
    })
    if (!low.ok || !high.ok) throw new Error('둘 다 성공해야 한다')
    expect(high.outcome.gained!.count).toBeGreaterThan(low.outcome.gained!.count)
  })

  it('실패하면 숙련도가 오르지 않는다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysFail, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.skillGained).toBe(0)
    expect(r.outcome.player.skills.mineral).toBe(0)
  })
})
