import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { equippedToolInfo, equippedToolTier, starterToolCandidates, starterToolFor } from './equipment.js'
import { testItem, testTool } from './testing/items.js'
import type { GameData, ItemDef, PlayerState } from './types.js'

const data: GameData = {
  items: {
    copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' }),
    iron_hammer: testTool('iron_hammer', 'crafting', 2, { name: '철 망치', icon: 'hammer_iron' }),
    copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
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
    // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
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

describe('starterToolFor — 시작 도구는 상수가 아니라 유도다(§6-앞 8)', () => {
  // 구 STARTING_TOOL_IDS 는 아이템 id 를 글자로 들고 있어서, CSV 에서 도구를
  // 개명하면 상수만 낡았다. 유도("kind=tool ∧ toolTier=1 ∧ toolSkill=기술")는
  // 카탈로그가 바뀌면 답도 함께 바뀐다 — 유도가 성립하지 않는 카탈로그는
  // packages/data 의 빌드 검증이 막는다.

  it('그 기술의 1티어 도구 하나를 유도한다', () => {
    expect(starterToolFor('mineral', data.items)).toBe(data.items['copper_pickaxe'])
  })

  it('2티어 도구는 후보가 아니다 — 시작 지급은 언제나 가장 낮은 계단이다', () => {
    // data.items 의 crafting 도구는 iron_hammer(2티어)뿐이라 후보가 0개다.
    expect(() => starterToolFor('crafting', data.items)).toThrow('crafting')
  })

  it('그 기술의 1티어 도구가 없으면 던진다 — 조용히 맨손 캐릭터를 만들지 않는다', () => {
    expect(() => starterToolFor('ice', data.items)).toThrow('ice')
  })

  it('1티어 도구가 둘이면 던진다 — 어느 것을 줄지 코드가 몰래 정하면 안 된다', () => {
    const bronze: ItemDef = testTool('bronze_pickaxe', 'mineral', 1, { name: '청동 곡괭이', icon: 'pickaxe_copper' })
    expect(() => starterToolFor('mineral', { ...data.items, bronze_pickaxe: bronze })).toThrow('2개')
  })

  it('starterToolCandidates 는 후보 전부를 돌려준다 — 빌드 검증이 이 목록으로 개수를 센다', () => {
    const bronze: ItemDef = testTool('bronze_pickaxe', 'mineral', 1, { name: '청동 곡괭이', icon: 'pickaxe_copper' })
    const items = { ...data.items, bronze_pickaxe: bronze }
    expect(starterToolCandidates('mineral', items).map((t) => t.id)).toEqual(['copper_pickaxe', 'bronze_pickaxe'])
    expect(starterToolCandidates('ice', items)).toEqual([])
  })
})
