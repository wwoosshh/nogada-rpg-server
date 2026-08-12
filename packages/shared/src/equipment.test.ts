import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { equippedToolInfo, equippedToolTier } from './equipment.js'
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
  // 장비 판정은 맵을 보지 않는다 — 등록부와 전환이 GameData 의 필수 칸이라 비운 채로 둔다.
  maps: {},
  transitions: [],
  placements: {},
  milestones: [],
  speakers: {},
  places: {},
  schedules: {},
  routes: [],
  dialogue: [],
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
    // 이 판정들은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
    ...overrides,
  }
}

describe('equippedToolInfo', () => {
  it('착용한 도구의 정의와 인스턴스를 한 쌍으로 돌려준다 — 간격 계산은 티어(def)와 강화 수치(instance)가 둘 다 필요하다', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 2 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolInfo(p, 'mineral', data.items)).toEqual({
      def: data.items['copper_pickaxe'],
      instance: { instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 2 },
    })
  })

  it('아무것도 착용하지 않으면 null — 판정자는 이 null 을 맨손으로 읽는다(§6-앞 9)', () => {
    expect(equippedToolInfo(player(), 'mineral', data.items)).toBeNull()
  })

  it('착용 기록이 가리키는 인스턴스가 없으면 null 이다', () => {
    expect(equippedToolInfo(player({ equipped: { mineral: 'ghost' } }), 'mineral', data.items)).toBeNull()
  })

  it('엉뚱한 기술의 도구는 null — "엉뚱한 도구 = 맨손" 규범은 프로필이 아니라 이 조회가 지킨다(§6-앞 9)', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'iron_hammer', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolInfo(p, 'mineral', data.items)).toBeNull()
  })

  it('도구가 아닌 아이템을 착용했으면 null 이다', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'copper_ore', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
    })
    expect(equippedToolInfo(p, 'mineral', data.items)).toBeNull()
  })
})

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
