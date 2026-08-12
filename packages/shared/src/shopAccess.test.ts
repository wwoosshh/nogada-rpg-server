import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { NPC_STEP_MS } from './npcSchedule.js'
import { shopAccess, speakerPresence } from './shopAccess.js'
import { GAME_EPOCH_MS, REAL_MS_PER_GAME_DAY, REAL_MS_PER_GAME_MINUTE } from './time.js'
import type { BakedLeg, GameData, PlaceDef, PlayerState, RouteStep, ScheduleDef, ShopDef } from './types.js'

// ---------------------------------------------------------------------------
// 픽스처 — talkService.test.ts 의 일과 픽스처와 같은 모양이다. 그쪽이 증명하는
// 것과 이쪽이 증명하는 것이 **같은 판정**이어야 하기 때문이다(§6-앞 3): 화자
// 현장 판정을 두 벌로 적으면 "말은 걸리는데 못 파는" 화면이 온다.
// ---------------------------------------------------------------------------

const 마을 = '눈의마을'
const 채집장 = '얼음채집장'

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

/** 일과 없는 화자의 상점(채집장 노인) — 24시간 그 자리다. */
const 얼음상점 = shop({ id: '얼음상점', speakerId: '노인' })
/** 일과 있는 화자의 상점 — 시각에 따라 자리도 맵도 바뀐다. */
const 여관상점 = shop({ id: '여관상점', speakerId: '여관안주인', skill: 'herb', unlockSkill: 0 })
/** 화자가 실재하지 않는 상점. 빌드 검증이 막지만 술어는 총체적이어야 한다. */
const 유령상점 = shop({ id: '유령상점', speakerId: '유령', unlockSkill: 0 })

const data: GameData = {
  items: {},
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
  shops: { 얼음상점, 여관상점, 유령상점 },
  masters: [],
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

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: 채집장, x: 0, y: 0 },
    ...overrides,
  }
}

/** 게임 세계의 그 날 그 시각에 해당하는 실측 ms — 라우트가 넣어 주는 `now` 와 같은 축이다. */
const at = (hour: number, minute = 0): number =>
  GAME_EPOCH_MS + 5 * REAL_MS_PER_GAME_DAY + (hour * 60 + minute) * REAL_MS_PER_GAME_MINUTE

const 채집장에 = (over: Partial<PlayerState> = {}) => player({ location: { mapId: 채집장, x: 0, y: 0 }, ...over })
const 마을에 = (over: Partial<PlayerState> = {}) => player({ location: { mapId: 마을, x: 0, y: 0 }, ...over })

describe('speakerPresence — talk·sell·buy 가 나눠 쓰는 현장 판정(§6-앞 3)', () => {
  it('없는 화자는 unknown_speaker 다', () => {
    expect(speakerPresence(data, '유령', 채집장에(), at(7))).toBe('unknown_speaker')
  })

  it('상속된 키(constructor)를 화자로 물어도 unknown_speaker 다 — 프로토타입 체인이 화자 행세를 하면 안 된다', () => {
    expect(speakerPresence(data, 'constructor', 채집장에(), at(7))).toBe('unknown_speaker')
  })

  it('일과가 없는 화자는 시각과 무관하게 좌표로 판정한다 — 밤이라고 사라지지 않는다', () => {
    for (const hour of [0, 7, 13, 23]) {
      expect(speakerPresence(data, '노인', 채집장에(), at(hour))).toBe('ok')
      expect(speakerPresence(data, '노인', 마을에(), at(hour))).toBe('wrong_map')
    }
  })

  it('일과가 있는 화자는 그 시각에 서 있는 맵이 판정이다 — speakers.csv 좌표가 아니다', () => {
    // 07시 여관 앞(마을), 13시 초소(채집장). 등록부의 좌표는 언제나 마을이다.
    expect(data.speakers['여관안주인']!.mapId).toBe(마을)
    expect(speakerPresence(data, '여관안주인', 마을에(), at(7))).toBe('ok')
    expect(speakerPresence(data, '여관안주인', 마을에(), at(13))).toBe('wrong_map')
    expect(speakerPresence(data, '여관안주인', 채집장에(), at(13))).toBe('ok')
  })

  it('실내로 들어간 시각은 not_here 다 — 맵에 없는 사람과 말이 걸리면 안 된다(§6-앞 4)', () => {
    expect(speakerPresence(data, '여관안주인', 마을에(), at(23))).toBe('not_here')
  })

  it('걷는 중은 맵이 맞아도 not_here 다 — 통과 장식에는 몸이 없다', () => {
    // 09:00 도착, 열 칸 앞에서 출발 — 출발 순간부터 도착 직전까지는 길 위다.
    const departure = at(9) - 10 * NPC_STEP_MS
    expect(speakerPresence(data, '여관안주인', 마을에(), departure - 1)).toBe('ok')
    expect(speakerPresence(data, '여관안주인', 마을에(), departure)).toBe('not_here')
    expect(speakerPresence(data, '여관안주인', 마을에(), at(9) - 1)).toBe('not_here')
    expect(speakerPresence(data, '여관안주인', 마을에(), at(9))).toBe('ok')
  })
})

describe('shopAccess — 다섯 결과(§6-앞 3)', () => {
  it('ok — 해금된 상점의 화자가 같은 맵에 서 있다', () => {
    expect(shopAccess(data, '얼음상점', 채집장에({ skills: { ice: 5_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }), at(7))).toBe('ok')
  })

  it('unknown_shop — 등록부에 없는 상점 id', () => {
    expect(shopAccess(data, '없는상점', 채집장에(), at(7))).toBe('unknown_shop')
  })

  it('상속된 키(constructor)를 상점 id 로 보내도 unknown_shop 이다', () => {
    expect(shopAccess(data, 'constructor', 채집장에(), at(7))).toBe('unknown_shop')
  })

  it('화자가 실재하지 않는 상점도 unknown_shop 이다 — 닿을 수 없는 상점은 없는 상점이다', () => {
    expect(shopAccess(data, '유령상점', 채집장에(), at(7))).toBe('unknown_shop')
  })

  it('shop_locked — 그 상점 계열의 숙련도가 요구치 미만이다. 경계값은 열린다', () => {
    const 미달 = 채집장에({ skills: { ice: 4_999, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const 딱 = 채집장에({ skills: { ice: 5_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    expect(shopAccess(data, '얼음상점', 미달, at(7))).toBe('shop_locked')
    expect(shopAccess(data, '얼음상점', 딱, at(7))).toBe('ok')
  })

  it('재는 것은 언제나 그 상점의 계열이다 — 남의 기술이 아무리 높아도 안 열린다', () => {
    const 나무만 = 채집장에({ skills: { ice: 0, wood: 1_000_000, mineral: 0, herb: 0, crafting: 0 } })
    expect(shopAccess(data, '얼음상점', 나무만, at(7))).toBe('shop_locked')
  })

  it('wrong_map — 열려 있어도 그 화자가 다른 맵이면 못 연다', () => {
    const 해금 = 마을에({ skills: { ice: 5_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    expect(shopAccess(data, '얼음상점', 해금, at(7))).toBe('wrong_map')
  })

  it('not_here — 밤에 화자가 실내로 들어가면 상점도 닫힌다(§6-앞 4, 세계가 살아 있다는 증거)', () => {
    expect(shopAccess(data, '여관상점', 마을에(), at(23))).toBe('not_here')
    expect(shopAccess(data, '여관상점', 마을에(), at(7))).toBe('ok')
  })

  it('판정 순서는 존재 → 해금 → 현장이다 — 잠긴 상점은 화자가 자리에 없어도 shop_locked 로 답한다', () => {
    // 왜 순서가 규범인가: "지금 여기 없다"는 기다리면 되는 안내이고 "숙련이
    // 모자라다"는 숫자를 올려야 하는 안내다. 순서가 뒤집히면 요구치를 채우기
    // 전까지 플레이어는 영원히 "조금 있다 다시 오라"는 말만 듣는다.
    expect(shopAccess(data, '얼음상점', 마을에(), at(7))).toBe('shop_locked')
  })

  it('난수도 이력도 부작용도 없다 — 같은 인자면 몇 번을 불러도 같은 답이고 아무것도 안 바뀐다', () => {
    const p = 채집장에({ skills: { ice: 5_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const before = structuredClone(p)
    const answers = [1, 2, 3].map(() => shopAccess(data, '얼음상점', p, at(7)))
    expect(answers).toEqual(['ok', 'ok', 'ok'])
    expect(p).toEqual(before)
  })
})
