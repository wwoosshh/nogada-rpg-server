import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from '../dialogue.js'
import { defaultCombatState } from '../combatState.js'
import { testItem, testTool } from '../testing/items.js'
import type { ItemDef, PlayerState } from '../types.js'
import { TOKEN_SIGHT_FACTOR, TOKEN_SPEED_FACTOR, gatherHandOf } from './gatherHand.js'
import { ENHANCE_CAP, effectiveIntervalFactor, gatherToolProfile } from './toolProfile.js'

const copper: ItemDef = testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' })
const mithril: ItemDef = { ...copper, id: 'mithril_pickaxe', toolTier: 3 }

/** 출하 데이터의 증표와 같은 모양 — 재료이고, 증표임은 tokenEffect 한 칸으로만 드러난다(§6-앞 11). */
const token = (id: string, skill: 'ice' | 'mineral', tokenEffect: 'speed' | 'sight'): ItemDef =>
  testItem(id, { skill, tokenEffect, price: 360_000 })

const 광물속도 = token('mineral_speed_token', 'mineral', 'speed')
const 광물선별 = token('mineral_sight_token', 'mineral', 'sight')
const 얼음속도 = token('ice_speed_token', 'ice', 'speed')
const 얼음선별 = token('ice_sight_token', 'ice', 'sight')

const items: Record<string, ItemDef> = {
  copper_pickaxe: copper,
  mithril_pickaxe: mithril,
  mineral_speed_token: 광물속도,
  mineral_sight_token: 광물선별,
  ice_speed_token: 얼음속도,
  ice_sight_token: 얼음선별,
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    // 손을 만드는 데 돈은 쓰이지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    // 사슬은 이 스위트가 보는 판정이 아니다 — PlayerState 의 필수 칸이라 채워만 둔다.
    story: 0,
    storyCount: 0,
    startVillage: '',
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: 'world', x: 0, y: 0 },
    ...overrides,
  }
}

/** 그 도구를 그 강화 수치로 착용한 사람. */
const holding = (def: ItemDef, enhanceLevel = 0, over: Partial<PlayerState> = {}): PlayerState =>
  player({
    instances: [{ instanceId: 'i1', itemId: def.id, enhanceLevel }],
    equipped: { mineral: 'i1' },
    ...over,
  })

describe('gatherHandOf — 도구와 증표를 합친 "그 기술의 손"', () => {
  it('아무것도 없으면 맨손이다 — 도구 null, 맨손 프로필, 간격배수 ×1.5', () => {
    const hand = gatherHandOf(player(), 'mineral', items)
    expect(hand.tool).toBeNull()
    expect(hand.profile).toEqual(gatherToolProfile(null))
    expect(hand.intervalFactor).toBe(1.5)
  })

  it('도구만 있으면 손의 간격배수는 가방 칩이 찍는 그 숫자와 정확히 같다(§6-앞 16)', () => {
    // 왜 이 등식이 규범인가: 가방 칩은 effectiveIntervalFactor(도구, 강화) 를
    // "간격 −20%" 로 찍는다. 증표가 없는 손에서 두 숫자가 갈라지면 칩은 그
    // 순간부터 거짓말이 된다.
    for (const enhanceLevel of [0, 1, ENHANCE_CAP]) {
      const hand = gatherHandOf(holding(mithril, enhanceLevel), 'mineral', items)
      expect(hand.intervalFactor).toBe(effectiveIntervalFactor(mithril, enhanceLevel))
      expect(hand.profile).toEqual(gatherToolProfile(mithril))
      expect(hand.tool?.instance.enhanceLevel).toBe(enhanceLevel)
    }
  })

  it('속도증표를 가지고만 있으면 간격배수에 ×0.9 가 붙는다 — 슬롯을 먹지 않는다(설계 §5)', () => {
    const hand = gatherHandOf(holding(copper, 0, { stacks: { mineral_speed_token: 1 } }), 'mineral', items)
    expect(hand.intervalFactor).toBe(effectiveIntervalFactor(copper, 0) * TOKEN_SPEED_FACTOR)
    // 속도는 roll 을 건드리지 않는다 — 두 증표는 서로 다른 축이다.
    expect(hand.profile).toEqual(gatherToolProfile(copper))
  })

  it('선별증표는 roll 배수에 ×0.95 가 붙는다 — 간격은 그대로다', () => {
    const hand = gatherHandOf(holding(copper, 0, { stacks: { mineral_sight_token: 1 } }), 'mineral', items)
    expect(hand.profile.rollFactor).toBe(gatherToolProfile(copper).rollFactor * TOKEN_SIGHT_FACTOR)
    expect(hand.intervalFactor).toBe(effectiveIntervalFactor(copper, 0))
  })

  it('선별증표는 잭팟 평감산을 건드리지 않는다 — 밴드 안의 배타 규칙은 증표의 축이 아니다(§7-앞 13)', () => {
    const hand = gatherHandOf(holding(mithril, 0, { stacks: { mineral_sight_token: 1 } }), 'mineral', items)
    expect(hand.profile.jackpotFlat).toBe(gatherToolProfile(mithril).jackpotFlat)
  })

  it('둘 다 가지면 둘 다 붙는다 — 도구와 별개의 곱셈 축이라 서로 경합하지 않는다(설계 §5)', () => {
    const p = holding(mithril, ENHANCE_CAP, { stacks: { mineral_speed_token: 1, mineral_sight_token: 1 } })
    const hand = gatherHandOf(p, 'mineral', items)
    expect(hand.intervalFactor).toBe(effectiveIntervalFactor(mithril, ENHANCE_CAP) * TOKEN_SPEED_FACTOR)
    expect(hand.profile.rollFactor).toBe(gatherToolProfile(mithril).rollFactor * TOKEN_SIGHT_FACTOR)
  })

  it('맨손에도 증표는 붙는다 — 증표는 도구의 부속이 아니다', () => {
    const hand = gatherHandOf(player({ stacks: { mineral_speed_token: 1, mineral_sight_token: 1 } }), 'mineral', items)
    expect(hand.tool).toBeNull()
    expect(hand.intervalFactor).toBe(1.5 * TOKEN_SPEED_FACTOR)
    expect(hand.profile.rollFactor).toBe(1.45 * TOKEN_SIGHT_FACTOR)
  })

  it('개수는 무관하다 — 하나든 아흔아홉이든 한 번만 적용된다(설계 §5)', () => {
    const one = gatherHandOf(holding(copper, 0, { stacks: { mineral_speed_token: 1 } }), 'mineral', items)
    const many = gatherHandOf(holding(copper, 0, { stacks: { mineral_speed_token: 99 } }), 'mineral', items)
    expect(many).toEqual(one)
  })

  it('0 개는 미보유다 — 스택은 0 으로 남을 수 있다(판 뒤의 칸)', () => {
    const hand = gatherHandOf(holding(copper, 0, { stacks: { mineral_speed_token: 0 } }), 'mineral', items)
    expect(hand).toEqual(gatherHandOf(holding(copper), 'mineral', items))
  })

  it('다른 기술의 증표는 아무것도 하지 않는다 — 얼음 증표를 들고 광물을 캐도 손은 그대로다', () => {
    const p = holding(copper, 0, { stacks: { ice_speed_token: 5, ice_sight_token: 5 } })
    expect(gatherHandOf(p, 'mineral', items)).toEqual(gatherHandOf(holding(copper), 'mineral', items))
    // 같은 사람이 얼음을 캘 때는 그 증표들이 그대로 일한다 — 계열이 다를 뿐이다.
    const 얼음손 = gatherHandOf(p, 'ice', items)
    expect(얼음손.intervalFactor).toBe(1.5 * TOKEN_SPEED_FACTOR)
    expect(얼음손.profile.rollFactor).toBe(1.45 * TOKEN_SIGHT_FACTOR)
  })

  it('엉뚱한 기술의 도구는 맨손이다 — 그 규범은 equippedToolInfo 가 지킨다(§6-앞 9)', () => {
    const p = player({
      instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
      equipped: { herb: 'i1' },
    })
    const hand = gatherHandOf(p, 'herb', items)
    expect(hand.tool).toBeNull()
    expect(hand.intervalFactor).toBe(1.5)
  })

  it('스택의 상속된 키(constructor)는 증표가 아니다 — 프로토타입 체인이 효과를 내면 안 된다', () => {
    const p = holding(copper, 0, { stacks: { constructor: 3, toString: 1 } })
    expect(gatherHandOf(p, 'mineral', items)).toEqual(gatherHandOf(holding(copper), 'mineral', items))
  })

  it('증표 배수는 §6-앞 7 이 가격을 유도한 그 숫자다 — 속도 ×0.9, 선별 ×0.95', () => {
    expect(TOKEN_SPEED_FACTOR).toBe(0.9)
    expect(TOKEN_SIGHT_FACTOR).toBe(0.95)
  })
})
