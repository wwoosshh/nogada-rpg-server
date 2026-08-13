import {
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_DAY,
  REAL_MS_PER_GAME_MINUTE,
  buyPrice,
  emptyDialogueHistory,
  isSellTarget,
  sellPrice,
  type BakedLeg,
  type GameData,
  type ItemDef,
  type PlaceDef,
  type PlayerState,
  type RouteStep,
  type ScheduleDef,
  type ShopDef,
  type SkillId,
} from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { performBuy, performSell } from './tradeService.js'

// ---------------------------------------------------------------------------
// 픽스처 — shopAccess.test.ts 의 무대를 그대로 쓴다. 거래가 부르는 현장 판정이
// 그쪽이 증명한 그 판정이어야 하기 때문이다(§6-앞 3).
// ---------------------------------------------------------------------------

const 마을 = '눈의마을'
const 채집장 = '얼음채집장'

const items: Record<string, ItemDef> = {}

/** 정의를 카탈로그에 넣으면서 돌려준다 — 픽스처가 한 줄씩 읽히게 하는 손잡이다. */
function add(def: ItemDef): ItemDef {
  items[def.id] = def
  return def
}

/** 얼음 사다리의 재료 둘 — 하나는 팔고, 다른 하나는 "건드리지 않았음"의 증인이다. */
add(testItem('ice_shard', { name: '얼음 조각', price: 50, skill: 'ice' }))
add(testItem('clear_ice', { name: '맑은 얼음', price: 150, skill: 'ice' }))
/**
 * 되사기 진열에 오르는 재료(§6-앞 7) — **총점이 여는 칸**의 증인이다.
 *
 * 숙련으로 열리는 재료(ice_shard)와 따로 두는 이유: 한 물건에 두 문을 번갈아
 * 걸면 "이 거절이 어느 문 때문인가"를 테스트가 스스로 구별하지 못한다.
 */
add(testItem('ice_bead', { name: '얼음 구슬', price: 220, skill: 'ice' }))
/** 남의 계열. 값은 있지만 얼음상점은 사 주지 않는다 — 그 마을에 가야 판다(§4). */
add(testItem('copper_ore', { name: '구리 원석', price: 80, skill: 'mineral' }))
/** 값이 0 인 재료. price=0 은 "0원에 팔린다"가 아니라 **팔 수 없다**는 뜻이다. */
add(testItem('ice_dust', { name: '얼음 먼지', price: 0, skill: 'ice' }))
/** 증표 — 계열도 맞고 값도 크지만 매도 대상이 아니다(§6-앞 13 의 정의). */
add(testItem('ice_speed_token', { name: '얼음 속도증표', price: 480_000, skill: 'ice', tokenEffect: 'speed' }))
add(testItem('ice_sight_token', { name: '얼음 선별증표', price: 240_000, skill: 'ice', tokenEffect: 'sight' }))
/** 도구는 값이 0 이라 팔 수 없다(설계 §4 — 강화 재료를 실수로 파는 사고가 크다). */
add(testTool('ice_pick', 'ice', 1, { name: '얼음 정' }))

function place(id: string, mapId: string, x: number, over: Partial<PlaceDef> = {}): PlaceDef {
  return { id, mapId, x, y: 0, indoor: false, facing: null, ...over }
}

const 여관앞 = place('여관앞', 마을, 1)
const 눈광장 = place('눈광장', 마을, 20)
const 여관안 = place('여관안', 마을, 2, { indoor: true })
const 초소 = place('초소', 채집장, 5)

/** 양 끝 칸을 다 담는 구운 구간 — 걸음 수는 `steps.length - 1` 이다(빌드의 규약). */
function walkLeg(from: PlaceDef, to: PlaceDef, steps: number): BakedLeg {
  const tiles: RouteStep[] = [{ mapId: from.mapId, x: from.x, y: 0 }]
  for (let i = 1; i < steps; i++) tiles.push({ mapId: from.mapId, x: from.x + i, y: 0 })
  tiles.push({ mapId: to.mapId, x: to.x, y: 0 })
  return { fromPlace: from.id, toPlace: to.id, steps: tiles }
}

/** 06:00 여관 앞, 09:00 광장, 12:00 채집장 초소, 22:00 여관 안(실내). */
const 안주인일과: ScheduleDef = {
  speakerId: '여관안주인',
  entries: [
    { arriveMinute: 6 * 60, placeIds: ['여관앞'] },
    { arriveMinute: 9 * 60, placeIds: ['눈광장'] },
    { arriveMinute: 12 * 60, placeIds: ['초소'] },
    { arriveMinute: 22 * 60, placeIds: ['여관안'] },
  ],
}

function shop(over: Partial<ShopDef> & Pick<ShopDef, 'id' | 'speakerId'>): ShopDef {
  return { name: over.id, skill: 'ice', unlockSkill: 5_000, stock: [], ...over }
}

/**
 * 얼음상점. 진열에 증표 둘 **과 재료 둘**이 있고, 재료 둘은 **문이 서로 다르다**.
 *
 * `ice_shard` 는 숙련으로(요구치 0), `ice_bead` 는 수집 총점으로 열린다 — 되사기
 * 진열(§6-앞 7)이 생기면서 한 상점의 진열에 두 종류의 문이 섞였고, 이 픽스처가
 * 그 섞인 상태다. 재료를 진열에 두는 이유는 예나 지금이나 **왕복 단조성**(§6-앞
 * 19 ③)이다: 증표는 매도 대상이 아니라 사고 되팔 수가 없으므로 증표만으로는
 * "사고 즉시 팔면 손해"를 코드로 지나갈 방법이 없다. 이제 출하 데이터에도 되팔
 * 수 있는 진열이 생겼고(아래 출하 데이터 판), 그래서 이 왕복은 가정이 아니다.
 */
const 얼음상점 = shop({
  id: '얼음상점',
  speakerId: '노인',
  stock: [
    { itemId: 'ice_shard', unlockBy: 'skill', unlockAt: 0 },
    { itemId: 'ice_speed_token', unlockBy: 'skill', unlockAt: 10_000 },
    { itemId: 'ice_sight_token', unlockBy: 'skill', unlockAt: 25_000 },
    // 되사기 칸 — 숙련이 아니라 방의 총점 4 가 연다(§6-앞 7).
    { itemId: 'ice_bead', unlockBy: 'collection', unlockAt: 4 },
  ],
})

/** 일과가 있는 화자의 상점 — 시각에 따라 자리도 맵도 바뀐다(밤에는 닫힌다). */
const 여관상점 = shop({
  id: '여관상점',
  speakerId: '여관안주인',
  unlockSkill: 0,
  stock: [{ itemId: 'ice_shard', unlockBy: 'skill', unlockAt: 0 }],
})

const data: GameData = {
  items,
  nodes: {},
  recipes: {},
  maps: {
    [마을]: { id: 마을, name: '눈의 마을', file: '눈의마을.tmx', width: 40, height: 40, spawn: { x: 1, y: 1 } },
    [채집장]: { id: 채집장, name: '얼음 채집장', file: '얼음채집장.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } },
  },
  transitions: [],
  placements: {},
  milestones: [],
  speakers: {
    노인: { id: '노인', name: '채집장 노인', kind: 'npc', mapId: 채집장, x: 1, y: 1, sprite: 'npc_elder', facing: 'down' },
    여관안주인: { id: '여관안주인', name: '여관 안주인', kind: 'npc', mapId: 마을, x: 1, y: 0, sprite: 'npc_inn', facing: 'down' },
  },
  shops: { 얼음상점, 여관상점 },
  masters: [],
  enhanceCosts: [],
  // 칸 둘짜리 작은 방 — 만점은 2칸 × 4등급 = 8 이다. 되사기 문턱 4 는 그 절반이다.
  collection: {
    ice_shard: { itemId: 'ice_shard', steps: [1, 10, 100, 1000] },
    clear_ice: { itemId: 'clear_ice', steps: [1, 10, 100, 1000] },
  },
  places: Object.fromEntries([여관앞, 눈광장, 여관안, 초소].map((p) => [p.id, p])),
  schedules: { 여관안주인: 안주인일과 },
  routes: [
    walkLeg(여관앞, 눈광장, 10),
    walkLeg(눈광장, 초소, 4),
    walkLeg(초소, 여관안, 4),
    walkLeg(여관안, 여관앞, 2),
  ],
  dialogue: [],
}

function skills(over: Partial<Record<SkillId, number>> = {}): Record<SkillId, number> {
  return { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...over }
}

/**
 * 상점 앞에 선 사람. 기본값은 **거래가 열리는 최소 조건**이다 — 얼음 5,000,
 * 채집장에 서 있음. 그래야 거절을 보는 테스트가 무엇을 일부러 어겼는지 한 줄에 드러난다.
 */
function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: skills({ ice: 5_000 }),
    stacks: { ice_shard: 10, clear_ice: 4, copper_ore: 7 },
    // 아직 아무것도 바치지 않은 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    donated: {},
    gold: 1_000,
    instances: [{ instanceId: 'pick-1', itemId: 'ice_pick', enhanceLevel: 0 }],
    equipped: { ice: 'pick-1' },
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: 채집장, x: 0, y: 0 },
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    ...overrides,
  }
}

/** 게임 세계 5일차 그 시각의 실측 ms — 라우트가 넣어 주는 `now` 와 같은 축이다. */
const at = (hour: number, minute = 0): number =>
  GAME_EPOCH_MS + 5 * REAL_MS_PER_GAME_DAY + (hour * 60 + minute) * REAL_MS_PER_GAME_MINUTE

function sell(p: PlayerState, itemId: string, count: number, over: { shopId?: string; now?: number } = {}) {
  return performSell({ player: p, data, shopId: over.shopId ?? '얼음상점', itemId, count, now: over.now ?? at(7) })
}

function buy(p: PlayerState, itemId: string, count: number, over: { shopId?: string; now?: number } = {}) {
  return performBuy({ player: p, data, shopId: over.shopId ?? '얼음상점', itemId, count, now: over.now ?? at(7) })
}

describe('performSell', () => {
  it('그 계열의 재료를 팔면 골드가 sellPrice × 수량만큼 늘고 스택이 그만큼 준다', () => {
    const r = sell(player(), 'ice_shard', 3)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    // 얼음 조각 정가 50 → 매도가 25. 셋이면 75.
    expect(r.outcome.player.gold).toBe(1_075)
    expect(r.outcome.player.stacks['ice_shard']).toBe(7)
  })

  it('스택을 전부 팔면 그 키가 사라진다 — 0 개는 "가진 적 없음"과 같은 모양이다', () => {
    const r = sell(player(), 'ice_shard', 10)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(Object.hasOwn(r.outcome.player.stacks, 'ice_shard')).toBe(false)
    expect(r.outcome.player.gold).toBe(1_250)
  })

  it('입력 플레이어 객체를 변경하지 않는다 — 판정은 사본 위에서 한다', () => {
    const p = player()
    const before = structuredClone(p)
    sell(p, 'ice_shard', 3)
    expect(p).toEqual(before)
  })

  it('없는 상점은 unknown_shop 이다 — shopAccess 의 코드를 그대로 낸다', () => {
    expect(sell(player(), 'ice_shard', 1, { shopId: '없는상점' })).toEqual({ ok: false, code: 'unknown_shop' })
  })

  it('상속된 키(constructor)를 상점 id 로 보내도 unknown_shop 이다', () => {
    expect(sell(player(), 'ice_shard', 1, { shopId: 'constructor' })).toEqual({ ok: false, code: 'unknown_shop' })
  })

  it('숙련이 요구치에 못 미치면 shop_locked 다 — 팔 물건을 들고 있어도 문이 안 열린다', () => {
    const 미달 = player({ skills: skills({ ice: 4_999 }) })
    expect(sell(미달, 'ice_shard', 1)).toEqual({ ok: false, code: 'shop_locked' })
  })

  it('다른 맵에서는 wrong_map 이다 — 상점은 그 자리에 있다', () => {
    const 마을에 = player({ location: { mapId: 마을, x: 0, y: 0 } })
    expect(sell(마을에, 'ice_shard', 1)).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('화자가 실내로 들어간 시각에는 not_here 다 — 밤에는 못 판다(§6-앞 4)', () => {
    const 마을에 = player({ location: { mapId: 마을, x: 0, y: 0 } })
    expect(sell(마을에, 'ice_shard', 1, { shopId: '여관상점', now: at(23) })).toEqual({ ok: false, code: 'not_here' })
    // 대조: 같은 사람, 같은 상점, 낮에는 팔린다. 이 줄이 없으면 위 단정은
    // "여관상점에서는 아무것도 못 판다"로도 통과한다.
    expect(sell(마을에, 'ice_shard', 1, { shopId: '여관상점', now: at(7) }).ok).toBe(true)
  })

  it('등록부에 없는 아이템 id 는 unknown_item 이다', () => {
    expect(sell(player(), '없는물건', 1)).toEqual({ ok: false, code: 'unknown_item' })
    expect(sell(player(), 'constructor', 1)).toEqual({ ok: false, code: 'unknown_item' })
  })

  it('남의 계열 재료는 not_sellable 이다 — 값이 있어도 이 상점은 사 주지 않는다', () => {
    expect(sell(player(), 'copper_ore', 1)).toEqual({ ok: false, code: 'not_sellable' })
  })

  it('price 가 0 인 재료는 not_sellable 이다 — 0원에 팔리는 것이 아니라 팔 수 없다', () => {
    const p = player({ stacks: { ice_dust: 5 } })
    expect(sell(p, 'ice_dust', 1)).toEqual({ ok: false, code: 'not_sellable' })
  })

  it('도구는 not_sellable 이다 — 강화 재료를 실수로 파는 사고가 크다(설계 §4)', () => {
    const p = player({ stacks: { ice_pick: 1 } })
    expect(sell(p, 'ice_pick', 1)).toEqual({ ok: false, code: 'not_sellable' })
  })

  it('증표는 계열이 맞고 값이 커도 not_sellable 이다 — 매도 대상의 정의가 증표를 뺀다(§6-앞 13)', () => {
    const p = player({ stacks: { ice_speed_token: 1 } })
    expect(sell(p, 'ice_speed_token', 1)).toEqual({ ok: false, code: 'not_sellable' })
  })

  it('가진 것보다 많이 팔려 하면 missing_items 다. 딱 맞는 수량은 팔린다', () => {
    expect(sell(player(), 'ice_shard', 11)).toEqual({ ok: false, code: 'missing_items' })
    expect(sell(player(), 'ice_shard', 10).ok).toBe(true)
  })

  it('한 번도 가져 본 적 없는 것도 missing_items 다 — 팔 수 있는 물건이지만 없다', () => {
    const p = player({ stacks: {} })
    expect(sell(p, 'ice_shard', 1)).toEqual({ ok: false, code: 'missing_items' })
  })

  it('행동 간격을 검사도 소비도 하지 않는다(§6-앞 18) — 정리·거래는 행동이 아니다', () => {
    const p = player({ nextActionAt: 9_000_000 })
    const r = sell(p, 'ice_shard', 1, { now: 0 })
    if (!r.ok) throw new Error(`쿨다운 중에도 팔려야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.nextActionAt).toBe(9_000_000)
  })
})

describe('performBuy', () => {
  it('진열된 물건을 사면 골드가 buyPrice × 수량만큼 줄고 스택이 그만큼 는다', () => {
    const p = player({ stacks: {} })
    const r = buy(p, 'ice_shard', 4)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.gold).toBe(1_000 - 200)
    expect(r.outcome.player.stacks['ice_shard']).toBe(4)
  })

  it('이미 가진 것을 더 사면 스택에 더해진다', () => {
    const r = buy(player(), 'ice_shard', 1)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.stacks['ice_shard']).toBe(11)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    const before = structuredClone(p)
    buy(p, 'ice_shard', 1)
    expect(p).toEqual(before)
  })

  it('상점 접근 코드를 그대로 낸다 — 문이 닫혀 있으면 진열도 없다', () => {
    expect(buy(player(), 'ice_shard', 1, { shopId: '없는상점' })).toEqual({ ok: false, code: 'unknown_shop' })
    expect(buy(player({ skills: skills({ ice: 4_999 }) }), 'ice_shard', 1)).toEqual({ ok: false, code: 'shop_locked' })
    expect(buy(player({ location: { mapId: 마을, x: 0, y: 0 } }), 'ice_shard', 1)).toEqual({ ok: false, code: 'wrong_map' })
    const 마을에 = player({ location: { mapId: 마을, x: 0, y: 0 } })
    expect(buy(마을에, 'ice_shard', 1, { shopId: '여관상점', now: at(23) })).toEqual({ ok: false, code: 'not_here' })
  })

  it('등록부에 없는 아이템 id 는 unknown_item 이다', () => {
    expect(buy(player(), '없는물건', 1)).toEqual({ ok: false, code: 'unknown_item' })
    expect(buy(player(), 'constructor', 1)).toEqual({ ok: false, code: 'unknown_item' })
  })

  it('진열 요구치에 못 미치면 item_locked 다. 경계값은 살 수 있다', () => {
    const 미달 = player({ skills: skills({ ice: 9_999 }), gold: 1_000_000 })
    const 딱 = player({ skills: skills({ ice: 10_000 }), gold: 1_000_000 })
    expect(buy(미달, 'ice_speed_token', 1)).toEqual({ ok: false, code: 'item_locked' })
    expect(buy(딱, 'ice_speed_token', 1).ok).toBe(true)
  })

  it('이 상점이 진열하지 않은 물건도 item_locked 다 — 실재하는 아이템이지만 여기서는 못 산다', () => {
    const p = player({ gold: 1_000_000 })
    expect(buy(p, 'clear_ice', 1)).toEqual({ ok: false, code: 'item_locked' })
  })

  it('돈이 모자라면 not_enough_gold 다. 딱 맞는 잔고는 산다', () => {
    const 모자람 = player({ gold: 149, stacks: {} })
    const 딱 = player({ gold: 150, stacks: {} })
    expect(buy(모자람, 'ice_shard', 3)).toEqual({ ok: false, code: 'not_enough_gold' })
    expect(buy(딱, 'ice_shard', 3).ok).toBe(true)
  })

  it('이미 가진 증표는 already_owned 다 — 하나로 충분하다는 것이 서버 규칙이다(§6-앞 14)', () => {
    const p = player({ skills: skills({ ice: 10_000 }), gold: 1_000_000, stacks: { ice_speed_token: 1 } })
    expect(buy(p, 'ice_speed_token', 1)).toEqual({ ok: false, code: 'already_owned' })
  })

  it('증표를 한 번에 둘 이상 사려 해도 already_owned 다 — 둘째부터는 이미 가진 것을 또 사는 셈이다', () => {
    // 이 줄이 없으면 위 규칙에 구멍이 난다: 요청 하나로 count=5 를 보내면
    // 효과는 그대로인데 돈만 다섯 배 나간다(증표는 개수를 보지 않는다, §6-앞 16).
    const p = player({ skills: skills({ ice: 10_000 }), gold: 10_000_000 })
    expect(buy(p, 'ice_speed_token', 2)).toEqual({ ok: false, code: 'already_owned' })
    expect(buy(p, 'ice_speed_token', 1).ok).toBe(true)
  })

  it('증표가 아닌 물건은 여러 개 사도 막히지 않는다 — already_owned 는 증표의 규칙이다', () => {
    const p = player({ gold: 1_000_000 })
    expect(buy(p, 'ice_shard', 99).ok).toBe(true)
  })

  // 왜: 총점이 진열을 여는 것이 이 아크의 게이트다(§6-앞 7 — "칭호는 장식이고
  //     게이트가 콘텐츠다"). 숙련도가 아무리 높아도 바치지 않은 사람에게는
  //     그 칸이 열리지 않아야, 헌납이 실제로 무언가를 여는 행동이 된다.
  it('총점이 문턱에 못 미치면 되사기 칸은 item_locked 다 — 숙련도가 만렙이어도 마찬가지다', () => {
    const 만렙 = player({ skills: skills({ ice: 1_000_000 }), gold: 100_000 })
    const r = buy(만렙, 'ice_bead', 1)
    expect(r.ok ? 'ok' : r.code).toBe('item_locked')
  })

  it('총점이 문턱에 닿으면 살 수 있다 — 경계값이 열린다', () => {
    // 얼음 조각 100개(3등급) + 맑은 얼음 1개(1등급) = 총점 4 = 문턱.
    const 헌납자 = player({ donated: { ice_shard: 100, clear_ice: 1 }, gold: 100_000 })
    const r = buy(헌납자, 'ice_bead', 2)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.gold).toBe(100_000 - 220 * 2)
    expect(r.outcome.player.stacks['ice_bead']).toBe(2)

    // 한 등급만 모자라면 닫혀 있다 — 경계가 진짜 경계인지 양쪽에서 묻는다.
    const 하나모자란 = player({ donated: { ice_shard: 100 }, gold: 100_000 })
    const blocked = buy(하나모자란, 'ice_bead', 1)
    expect(blocked.ok ? 'ok' : blocked.code).toBe('item_locked')
  })

  it('행동 간격을 검사도 소비도 하지 않는다(§6-앞 18)', () => {
    const p = player({ nextActionAt: 9_000_000 })
    const r = buy(p, 'ice_shard', 1, { now: 0 })
    if (!r.ok) throw new Error(`쿨다운 중에도 사져야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.nextActionAt).toBe(9_000_000)
  })
})

/**
 * 불변식 셋(§6-앞 19).
 *
 * "거래 전후로 총량이 보존된다"는 문장 그대로는 거짓이다 — 매도는 아이템을 지우고
 * 골드를 만든다. 실제로 복제를 잡는 것은 아래 셋이고, 특히 ③ 한 줄이 무한 골드
 * 루프를 잡는다. 위의 코드별 테스트들이 "무엇을 거절하는가"를 지킨다면, 여기는
 * **거절하지 않은 것이 정확히 얼마만큼을 바꾸는가**를 지킨다.
 */
describe('거래 불변식', () => {
  it('① 매도 정확성 — 골드는 정확히 sellPrice×count 만큼 늘고, 그 스택 말고는 아무것도 변하지 않는다', () => {
    const p = player()
    // 기대 상태를 통째로 지어 놓고 통째로 견준다. 필드를 하나씩 단정하면 새
    // 필드가 생겼을 때 그것이 조용히 변해도 테스트가 초록이다 — 복제 버그는
    // 정확히 그렇게 들어온다(누구도 안 보는 칸이 늘어난다).
    const expected = structuredClone(p)
    expected.gold = p.gold + sellPrice(items['ice_shard']!) * 3
    expected.stacks['ice_shard'] = 7

    const r = sell(p, 'ice_shard', 3)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player).toEqual(expected)
  })

  it('② 매수 원자성 — 골드가 모자라면 상태가 전혀 바뀌지 않는다', () => {
    const p = player({ gold: 10 })
    const before = structuredClone(p)

    const r = buy(p, 'ice_shard', 3)
    expect(r).toEqual({ ok: false, code: 'not_enough_gold' })
    // 거절은 outcome 자체가 없으므로 바뀐 상태를 실을 자리가 없다. 그래도
    // 입력 객체까지 함께 보는 이유: 서비스가 사본이 아니라 원본 위에서 계산하기
    // 시작하면(스택을 먼저 깎고 잔고를 나중에 보는 순서 실수) 거절 경로가
    // 조용히 상태를 반쯤 바꿔 놓는다.
    expect(p).toEqual(before)
  })

  it('수량이 수량이 아니면 예외로 터진다 — 조용한 거절이 아니라 시끄러운 버그다', () => {
    // 라우트 스키마가 1..999 를 이미 막으므로 여기 닿을 요청은 없다. 그래도
    // 새는 것이 값이라 못 박는다: 음수 매도는 스택을 늘리며 골드를 깎고, 음수
    // 매수는 스택을 음수로 만들어 그 세이브를 다음 파싱에서 못 읽게 한다.
    for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => sell(player(), 'ice_shard', count)).toThrow(RangeError)
      expect(() => buy(player(), 'ice_shard', count)).toThrow(RangeError)
    }
  })

  it('③ 왕복 단조성 — 사고 즉시 되팔면 골드는 반드시 준다(무한 골드 루프가 산술적으로 성립하지 않는다)', () => {
    // 얼음 조각은 정가 50, 매도 25 — 왕복 한 번에 개당 25 가 사라진다.
    // 수량을 바꿔 가며 확인한다: 어느 한 수량에서만 손해인 것으로는 부족하다
    // (내림이 끼는 계산이라 수량에 따라 부호가 뒤집힐 여지가 원리적으로 있다).
    for (const count of [1, 2, 3, 10, 99]) {
      const start = player({ gold: 1_000_000, stacks: {} })
      const bought = buy(start, 'ice_shard', count)
      if (!bought.ok) throw new Error(`${count}개 매수가 ${bought.code} 로 막혔다`)
      const sold = sell(bought.outcome.player, 'ice_shard', count)
      if (!sold.ok) throw new Error(`${count}개 매도가 ${sold.code} 로 막혔다`)

      expect(sold.outcome.player.gold).toBeLessThan(start.gold)
      // 물건도 그대로 돌아왔다 — 손해는 오직 골드다.
      expect(sold.outcome.player.stacks).toEqual(start.stacks)
    }
  })

  // 왜: 되사기 진열은 **바친 사람에게 물건을 살 길을 여는 것**이지 환전소가
  //     아니다(§6-앞 7). 매수가가 정가이고 매도가가 그 절반이라 왕복은 언제나
  //     손해여야 하고, 그래야 "바치면 이득인가"라는 계산이 생기지 않는다.
  //     ③ 과 같은 자리에서 묻는 이유: 되사기가 열리기 전에는 이 왕복 자체가
  //     성립하지 않았다(진열은 증표뿐이었고 증표는 매도 대상이 아니다).
  it('③ 왕복 단조성 — 총점으로 열린 되사기 칸도 사고 되팔면 골드가 준다', () => {
    for (const count of [1, 2, 3, 10, 99]) {
      const start = player({ gold: 1_000_000, stacks: {}, donated: { ice_shard: 1000, clear_ice: 1000 } })
      const bought = buy(start, 'ice_bead', count)
      if (!bought.ok) throw new Error(`${count}개 매수가 ${bought.code} 로 막혔다`)
      const sold = sell(bought.outcome.player, 'ice_bead', count)
      if (!sold.ok) throw new Error(`${count}개 매도가 ${sold.code} 로 막혔다`)

      // 정가 220, 매도 110 — 왕복 한 번에 개당 110 이 사라진다.
      expect(sold.outcome.player.gold).toBe(start.gold - 110 * count)
      expect(sold.outcome.player.stacks).toEqual(start.stacks)
      // 바친 것은 되돌아오지 않는다 — 되사기는 헌납의 취소가 아니다(§7 훅).
      expect(sold.outcome.player.donated).toEqual(start.donated)
    }
  })
})

/**
 * ③ 을 출하 데이터에서도 묻는다.
 *
 * **이제 출하 데이터에도 사고 되팔 수 있는 물건이 있다** — 되사기 진열(§6-앞 7)이
 * 그 계열 채집물을 정가에 되팔기 때문이다. 한때 이 자리에는 "진열은 증표뿐이라
 * 왕복이 성립하지 않는다"는 줄이 있었고, 되사기가 그 문장을 낡게 만들었다.
 * 그래서 여기서 묻는 것이 바뀐다: 왕복이 성립하게 된 지금, 그 왕복이 **반드시
 * 손해인가**. 가격 수준의 성질(price ≥ 1 이면 언제나 매수가 > 매도가)이 그
 * 답이고, 이것이 깨지는 순간(누가 sellPrice 를 반올림으로 고치는 날) 되사기
 * 진열은 그대로 무한 골드 루프가 된다.
 */
describe('거래 불변식 ③ — 출하 데이터', () => {
  const shipped = loadGameData()

  /** 총점으로 열리는 진열 — 되사기 칸 전부. */
  const buybackStock = Object.values(shipped.shops).flatMap((s) =>
    s.stock.filter((e) => e.unlockBy === 'collection').map((entry) => ({ shop: s, def: shipped.items[entry.itemId]! })),
  )

  it('되사기 칸은 그 상점이 되사 주는 물건이다 — 사고 파는 문이 같은 자리에 있다', () => {
    // 매수만 되고 매도가 안 되면 "되사기"라는 이름이 거짓이 되고, 왕복 손해라는
    // 안전장치도 성립하지 않는다(팔 수 없는 물건은 왕복 자체가 없다).
    expect(buybackStock.length).toBeGreaterThan(0)
    for (const { shop: s, def } of buybackStock) {
      expect({ item: def.id, sellable: isSellTarget(def, s) }).toEqual({ item: def.id, sellable: true })
    }
  })

  it('되사기 칸은 전부 채집물이다 — 방의 칸인 것만 되산다(정제품·주괴는 아니다)', () => {
    for (const { def } of buybackStock) {
      expect({ item: def.id, slot: Object.hasOwn(shipped.collection, def.id) }).toEqual({ item: def.id, slot: true })
    }
  })

  it('되사기 왕복은 개당 정가의 절반이 사라진다 — 바치는 것이 이득인가를 계산하게 만들지 않는다', () => {
    for (const { def } of buybackStock) {
      expect({ item: def.id, loss: buyPrice(def) - sellPrice(def) }).toEqual({
        item: def.id,
        loss: def.price - Math.floor(def.price / 2),
      })
      expect(buyPrice(def)).toBeGreaterThan(sellPrice(def))
    }
  })

  it('값이 있는 모든 아이템에서 매수가가 매도가보다 크다 — 어떤 왕복도 손해다', () => {
    const priced = Object.values(shipped.items).filter((def) => def.price >= 1)
    expect(priced.length).toBeGreaterThan(0)
    for (const def of priced) {
      expect({ item: def.id, lossy: buyPrice(def) > sellPrice(def) }).toEqual({ item: def.id, lossy: true })
    }
  })

  it('출하 데이터의 상점 넷은 각자 자기 계열 재료를 사 준다 — 죽은 재료 13종이 값을 갖는 이유다', () => {
    for (const s of Object.values(shipped.shops)) {
      const buys = Object.values(shipped.items).filter((def) => isSellTarget(def, s))
      expect({ shop: s.id, buysSomething: buys.length > 0 }).toEqual({ shop: s.id, buysSomething: true })
    }
  })
})
