import type { GameData, PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { performCraft } from './craftService.js'

const data: GameData = {
  items: {
    copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
    copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
    copper_pickaxe: {
      id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
      toolSkill: 'mining', toolTier: 1, icon: 'pickaxe_copper',
    },
    iron_pickaxe: {
      id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool',
      toolSkill: 'mining', toolTier: 2, icon: 'pickaxe_iron',
    },
  },
  nodes: {},
  recipes: {
    copper_ingot: {
      id: 'copper_ingot', name: '구리 주괴', skill: 'smithing', requiredLevel: 1,
      inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
    },
    iron_pickaxe: {
      id: 'iron_pickaxe', name: '철 곡괭이', skill: 'smithing', requiredLevel: 12,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'iron_pickaxe', count: 1 },
    },
  },
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { mining: { level: 1, xp: 0 }, smithing: { level: 1, xp: 0 } },
    stacks: {},
    instances: [{ instanceId: 'pick1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mining: 'pick1' },
    nodeCooldowns: {},
    ...overrides,
  }
}

/** 대장 12레벨 + 구리 주괴 3개 — 철 곡괭이를 만들 수 있는 상태 */
function smithReadyForIronPickaxe(overrides: Partial<PlayerState> = {}): PlayerState {
  return player({
    skills: { mining: { level: 1, xp: 0 }, smithing: { level: 12, xp: 0 } },
    stacks: { copper_ingot: 3 },
    ...overrides,
  })
}

const alwaysSucceed = () => 0
const alwaysFail = () => 0.999

let idCounter = 0
const nextId = () => `id${++idCounter}`

describe('performCraft', () => {
  it('없는 레시피는 unknown_recipe 로 거부한다', () => {
    const r = performCraft({ player: player(), data, recipeId: 'ghost', rng: alwaysSucceed, newId: nextId })
    expect(r).toEqual({ ok: false, code: 'unknown_recipe' })
  })

  it('숙련도가 모자라면 level_too_low 로 거부한다', () => {
    const p = player({ stacks: { copper_ingot: 3 } })
    const r = performCraft({ player: p, data, recipeId: 'iron_pickaxe', rng: alwaysSucceed, newId: nextId })
    expect(r).toEqual({ ok: false, code: 'level_too_low' })
  })

  it('재료가 모자라면 missing_materials 로 거부한다', () => {
    const p = player({ stacks: { copper_ore: 1 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    expect(r).toEqual({ ok: false, code: 'missing_materials' })
  })

  it('재료가 하나도 없으면 missing_materials 로 거부한다', () => {
    const r = performCraft({ player: player(), data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    expect(r).toEqual({ ok: false, code: 'missing_materials' })
  })

  it('거부당하면 재료를 소모하지 않는다', () => {
    const p = player({ stacks: { copper_ore: 1 } })
    performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    expect(p.stacks.copper_ore).toBe(1)
  })

  it('성공하면 재료를 전량 소모하고 산출물을 스택에 넣는다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.success).toBe(true)
    expect(r.outcome.consumed).toEqual([{ item: 'copper_ore', count: 2 }])
    expect(r.outcome.player.stacks.copper_ore).toBe(3)
    expect(r.outcome.player.stacks.copper_ingot).toBe(1)
    expect(r.outcome.xpGained).toBeGreaterThan(0)
  })

  it('실패하면 재료를 절반만 소모하고 산출물이 없다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysFail, newId: nextId })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.consumed).toEqual([{ item: 'copper_ore', count: 1 }])
    expect(r.outcome.player.stacks.copper_ore).toBe(4)
    expect(r.outcome.player.stacks.copper_ingot).toBeUndefined()
    expect(r.outcome.xpGained).toBe(0)
  })

  it('도구를 만들면 스택이 아니라 인스턴스로 들어간다', () => {
    const r = performCraft({
      player: smithReadyForIronPickaxe(), data, recipeId: 'iron_pickaxe',
      rng: alwaysSucceed, newId: () => 'newpick',
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.stacks.iron_pickaxe).toBeUndefined()
    expect(r.outcome.player.instances).toContainEqual({
      instanceId: 'newpick',
      itemId: 'iron_pickaxe',
      enhanceLevel: 0,
    })
  })

  it('더 좋은 도구를 만들면 자동으로 착용한다', () => {
    const r = performCraft({
      player: smithReadyForIronPickaxe(), data, recipeId: 'iron_pickaxe',
      rng: alwaysSucceed, newId: () => 'newpick',
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(true)
    expect(r.outcome.player.equipped.mining).toBe('newpick')
  })

  it('이미 더 좋은 도구를 착용 중이면 자동 착용하지 않는다', () => {
    const p = smithReadyForIronPickaxe({
      stacks: { copper_ingot: 6 },
      instances: [{ instanceId: 'good', itemId: 'iron_pickaxe', enhanceLevel: 0 }],
      equipped: { mining: 'good' },
    })
    const r = performCraft({ player: p, data, recipeId: 'iron_pickaxe', rng: alwaysSucceed, newId: () => 'another' })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(false)
    expect(r.outcome.player.equipped.mining).toBe('good')
  })

  it('제작에 실패하면 도구를 만들지도 착용하지도 않는다', () => {
    const r = performCraft({
      player: smithReadyForIronPickaxe(), data, recipeId: 'iron_pickaxe',
      rng: alwaysFail, newId: () => 'newpick',
    })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(false)
    expect(r.outcome.player.instances).toHaveLength(1)
    expect(r.outcome.player.equipped.mining).toBe('pick1')
  })

  it('소모해서 0 이 된 재료는 스택에서 제거한다', () => {
    const p = player({ stacks: { copper_ore: 2 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.copper_ore).toBeUndefined()
  })

  it('제작 경험치로 레벨이 오를 수 있다', () => {
    // xpToNext(1) = 60. 구리 주괴 제작 경험치는 그보다 작으므로 직전까지 채워 둔다.
    const p = player({
      skills: { mining: { level: 1, xp: 0 }, smithing: { level: 1, xp: 59 } },
      stacks: { copper_ore: 2 },
    })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.skills.smithing.level).toBe(2)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    expect(p.stacks.copper_ore).toBe(5)
  })
})
