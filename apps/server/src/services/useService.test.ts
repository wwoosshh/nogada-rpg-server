import { REAL_MS_PER_GAME_MINUTE, defaultCombatState, emptyDialogueHistory, type ItemDef, type PlayerState } from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { performUse } from './useService.js'

/** 사용 판정도 카탈로그에서 items 만 본다 — 착용·강화와 같은 계약이라 픽스처도 지도만 만든다. */
const items: Record<string, ItemDef> = {
  rain_powder: testItem('rain_powder', {
    name: '비 가루', icon: 'cloud_rain', price: 100, skill: 'ice',
    useEffect: { kind: 'weather', weather: 'rain', minutes: 60 },
  }),
  heavy_snow_powder: testItem('heavy_snow_powder', {
    name: '함박눈 가루', icon: 'snowflake', price: 400, skill: 'ice',
    useEffect: { kind: 'weather', weather: 'snow', minutes: 180 },
  }),
  ice_shard: testItem('ice_shard', { name: '얼음 조각', icon: 'shard_ice', price: 50, skill: 'ice' }),
  copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' }),
}

const NOW = 1_767_225_600_000

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: { rain_powder: 3, heavy_snow_powder: 1, ice_shard: 10 },
    // 이 판정은 수집의 방을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    donated: {},
    // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
    instances: [],
    equipped: {},
    // 행동 간격은 이 판정이 보지도 쓰지도 않는다 — 아래 그 검사가 따로 있다.
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    // 이 판정은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
    weather: null,
    combat: defaultCombatState(),
    ...overrides,
  }
}

describe('performUse', () => {
  it('가루를 쓰면 그 종류의 날씨가 지속 시간만큼 걸린다 — 게임 분을 실측으로 옮기는 것은 시간 상수다', () => {
    const r = performUse({ player: player(), items, itemId: 'rain_powder', now: NOW })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.weather).toEqual({
      kind: 'rain',
      untilMs: NOW + 60 * REAL_MS_PER_GAME_MINUTE,
    })
  })

  it('정확히 하나만 소모한다 — 나머지는 가방에 남는다', () => {
    const r = performUse({ player: player(), items, itemId: 'rain_powder', now: NOW })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.rain_powder).toBe(2)
    // 다른 스택은 손대지 않는다.
    expect(r.outcome.player.stacks.ice_shard).toBe(10)
  })

  it('마지막 하나를 쓰면 그 칸이 사라진다 — 0개짜리 칸으로 가방이 늘어나지 않는다', () => {
    const r = performUse({ player: player(), items, itemId: 'heavy_snow_powder', now: NOW })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(Object.hasOwn(r.outcome.player.stacks, 'heavy_snow_powder')).toBe(false)
  })

  // 왜: 남은 시간을 더하면 가루를 쌓아 두었다가 한꺼번에 써서 하루 종일 비를
  //     묶어 둘 수 있고, 반대로 "이미 비가 온다"고 거절하면 눈으로 바꾸려는
  //     사람이 비가 그칠 때까지 기다려야 한다. 덮어쓰기는 그 둘을 다 피한다.
  it('이미 날씨가 있으면 덮어쓴다 — 종류가 바뀌고 남은 시간은 버려진다', () => {
    const p = player({ weather: { kind: 'rain', untilMs: NOW + 999_999 } })
    const r = performUse({ player: p, items, itemId: 'heavy_snow_powder', now: NOW })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.weather).toEqual({
      kind: 'snow',
      untilMs: NOW + 180 * REAL_MS_PER_GAME_MINUTE,
    })
  })

  it('같은 가루를 다시 쓰면 지속이 그 시점부터 다시 시작한다 — 이어 붙이지 않는다', () => {
    const p = player({ weather: { kind: 'rain', untilMs: NOW + 10 } })
    const r = performUse({ player: p, items, itemId: 'rain_powder', now: NOW })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.weather?.untilMs).toBe(NOW + 60 * REAL_MS_PER_GAME_MINUTE)
  })

  it('카탈로그에 없는 아이템은 unknown_item 으로 거부한다', () => {
    const r = performUse({ player: player(), items, itemId: 'ghost_powder', now: NOW })
    expect(r).toEqual({ ok: false, code: 'unknown_item' })
  })

  it('사용 효과가 없는 재료는 not_usable 로 거부한다 — 가진다고 쓸 수 있는 것이 아니다', () => {
    const r = performUse({ player: player(), items, itemId: 'ice_shard', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_usable' })
  })

  it('도구도 not_usable 이다 — 스택이 아니라 소모할 개수가 없다', () => {
    const r = performUse({ player: player(), items, itemId: 'copper_pickaxe', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_usable' })
  })

  it('가지고 있지 않으면 missing_items 로 거부한다', () => {
    const p = player({ stacks: { ice_shard: 10 } })
    const r = performUse({ player: p, items, itemId: 'rain_powder', now: NOW })
    expect(r).toEqual({ ok: false, code: 'missing_items' })
  })

  it('거절할 때는 아무것도 바꾸지 않는다 — 검사 사이에 상태를 고치면 반쯤 바뀐 플레이어가 남는다', () => {
    const p = player()
    performUse({ player: p, items, itemId: 'ice_shard', now: NOW })
    expect(p.stacks.ice_shard).toBe(10)
    expect(p.weather).toBeNull()
  })

  it('원본 플레이어를 건드리지 않는다 — 낙관 잠금이 재시도할 때 같은 입력이어야 한다', () => {
    const p = player()
    performUse({ player: p, items, itemId: 'rain_powder', now: NOW })
    expect(p.stacks.rain_powder).toBe(3)
    expect(p.weather).toBeNull()
  })

  // 왜: 정리·사용은 행동이 아니다(착용·강화·거래와 같은 이유). 여기에 세금을
  //     붙이면 가루를 쓰는 것만으로 채집이 느려진다.
  it('행동 간격을 보지도 소비하지도 않는다', () => {
    const p = player({ nextActionAt: NOW + 100_000 })
    const r = performUse({ player: p, items, itemId: 'rain_powder', now: NOW })
    if (!r.ok) throw new Error('간격이 남아 있어도 쓸 수 있어야 한다')
    expect(r.outcome.player.nextActionAt).toBe(NOW + 100_000)
  })
})
