import { describe, expect, it } from 'vitest'
import { equippedToolTier } from './equipment.js'
import type { GameData, PlayerState } from './types.js'

const data: GameData = {
  items: {
    copper_pickaxe: {
      id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
      toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
    },
    iron_hammer: {
      id: 'iron_hammer', name: '철 망치', kind: 'tool',
      toolSkill: 'crafting', toolTier: 2, icon: 'hammer_iron',
    },
    copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
  },
  nodes: {},
  recipes: {},
  placements: {},
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    ...overrides,
  }
}

describe('equippedToolTier', () => {
  it('착용한 도구의 등급을 반환한다', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolTier(p, data, 'mineral')).toBe(1)
  })

  it('아무것도 착용하지 않으면 0 이다', () => {
    expect(equippedToolTier(player(), data, 'mineral')).toBe(0)
  })

  it('착용 기록이 가리키는 인스턴스가 없으면 0 이다', () => {
    expect(equippedToolTier(player({ equipped: { mineral: 'ghost' } }), data, 'mineral')).toBe(0)
  })

  it('데이터에 없는 아이템을 착용했으면 0 이다', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'ghost_item', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolTier(p, data, 'mineral')).toBe(0)
  })

  it('다른 생활기술용 도구는 세지 않는다', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'iron_hammer', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolTier(p, data, 'mineral')).toBe(0)
  })

  it('도구가 아닌 아이템을 착용했으면 0 이다', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'copper_ore', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolTier(p, data, 'mineral')).toBe(0)
  })

  it('생활기술마다 각자 착용한 도구를 본다', () => {
    const p = player({
      instances: [
        { instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 },
        { instanceId: 'i2', itemId: 'iron_hammer', enhanceLevel: 0 },
      ],
      equipped: { mineral: 'i1', crafting: 'i2' },
    })
    expect(equippedToolTier(p, data, 'mineral')).toBe(1)
    expect(equippedToolTier(p, data, 'crafting')).toBe(2)
  })
})
