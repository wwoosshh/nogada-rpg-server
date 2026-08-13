import {
  collectionGrade,
  emptyDialogueHistory,
  type CollectionTable,
  type GameData,
  type ItemDef,
  type MilestoneDef,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { performDonate } from './donateService.js'

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const items: Record<string, ItemDef> = {}

/** 정의를 카탈로그에 넣으면서 돌려준다 — tradeService.test.ts 와 같은 손잡이다. */
function add(def: ItemDef): ItemDef {
  items[def.id] = def
  return def
}

/** 칸이다 — 문턱 [5, 10, 20, 40]. */
add(testItem('ice_shard', { name: '얼음 조각', price: 50, skill: 'ice' }))
/** 칸이 아니다(대조군) — 방에 자리가 없는 평범한 재료. */
add(testItem('clear_ice', { name: '맑은 얼음', price: 150, skill: 'ice' }))
/** 도구 — 애초에 stacks 에 살지 않지만, 정의가 있어도 칸이 아님을 보이는 데 쓴다. */
add(testTool('ice_pick', 'ice', 1, { name: '얼음 정' }))
/** 증표 — 계열이 맞고 값이 커도 칸이 아니다. */
add(testItem('ice_speed_token', { name: '얼음 속도증표', price: 480_000, skill: 'ice', tokenEffect: 'speed' }))

const collection: CollectionTable = {
  ice_shard: { itemId: 'ice_shard', steps: [5, 10, 20, 40] },
}

const data: GameData = {
  items,
  nodes: {},
  recipes: {},
  maps: {},
  transitions: [],
  placements: {},
  milestones: [],
  speakers: {},
  shops: {},
  masters: [],
  enhanceCosts: [],
  collection,
  places: {},
  schedules: {},
  routes: [],
  dialogue: [],
}

function skills(over: Partial<Record<SkillId, number>> = {}): Record<SkillId, number> {
  return { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...over }
}

/** 방 앞에 선 사람. 기본값은 얼음 조각 10개를 든, 아직 아무것도 안 바친 사람이다. */
function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: skills(),
    stacks: { ice_shard: 10 },
    donated: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: '', x: 0, y: 0 },
    weather: null,
    ...overrides,
  }
}

function donate(p: PlayerState, itemId: string, count: number, over: { data?: GameData } = {}) {
  return performDonate({ player: p, data: over.data ?? data, itemId, count })
}

// ---------------------------------------------------------------------------
// performDonate — 거절
// ---------------------------------------------------------------------------

describe('performDonate', () => {
  it('바치면 stacks 가 count 만큼 줄고 donated 가 그만큼 는다', () => {
    const r = donate(player(), 'ice_shard', 3)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.stacks['ice_shard']).toBe(7)
    expect(r.outcome.player.donated['ice_shard']).toBe(3)
  })

  it('스택을 전부 바치면 그 키가 사라진다 — 0 개는 "가진 적 없음"과 같은 모양이다', () => {
    const r = donate(player(), 'ice_shard', 10)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(Object.hasOwn(r.outcome.player.stacks, 'ice_shard')).toBe(false)
    expect(r.outcome.player.donated['ice_shard']).toBe(10)
  })

  it('입력 플레이어 객체를 변경하지 않는다 — 판정은 사본 위에서 한다', () => {
    const p = player()
    const before = structuredClone(p)
    donate(p, 'ice_shard', 3)
    expect(p).toEqual(before)
  })

  it('등록부에 없는 아이템 id 는 unknown_item 이다', () => {
    expect(donate(player(), '없는물건', 1)).toEqual({ ok: false, code: 'unknown_item' })
    expect(donate(player(), 'constructor', 1)).toEqual({ ok: false, code: 'unknown_item' })
  })

  it('실재하지만 칸이 아닌 재료는 not_collectable 이다', () => {
    const p = player({ stacks: { clear_ice: 5 } })
    expect(donate(p, 'clear_ice', 1)).toEqual({ ok: false, code: 'not_collectable' })
  })

  it('도구는 not_collectable 이다 — 가진 개수와 무관하게(도구는 애초에 stacks 에 없다)', () => {
    expect(donate(player(), 'ice_pick', 1)).toEqual({ ok: false, code: 'not_collectable' })
  })

  it('증표는 계열이 맞고 값이 커도 not_collectable 이다', () => {
    const p = player({ stacks: { ice_speed_token: 1 } })
    expect(donate(p, 'ice_speed_token', 1)).toEqual({ ok: false, code: 'not_collectable' })
  })

  it('칸이 아닌 것은 못 가지고 있어도 not_collectable 이 먼저다 — missing_items 가 아니다', () => {
    // 순서가 안내의 순서다: 애초에 바칠 수 없는 물건에게 "모자라다"고 답하면
    // 플레이어는 그 물건을 더 캐러 가는데, 그것으로는 영원히 해결되지 않는다.
    const p = player({ stacks: {} })
    expect(donate(p, 'clear_ice', 1)).toEqual({ ok: false, code: 'not_collectable' })
  })

  it('가진 것보다 많이 바치려 하면 missing_items 다. 딱 맞는 수량은 바쳐진다', () => {
    expect(donate(player(), 'ice_shard', 11)).toEqual({ ok: false, code: 'missing_items' })
    expect(donate(player(), 'ice_shard', 10).ok).toBe(true)
  })

  it('한 번도 가져 본 적 없는 칸도 missing_items 다 — 바칠 수 있는 물건이지만 없다', () => {
    const p = player({ stacks: {} })
    expect(donate(p, 'ice_shard', 1)).toEqual({ ok: false, code: 'missing_items' })
  })

  it('행동 간격을 검사도 소비도 하지 않는다(§6-앞 12) — 방문은 행동이 아니다', () => {
    const p = player({ nextActionAt: 9_000_000 })
    const r = donate(p, 'ice_shard', 1)
    if (!r.ok) throw new Error(`쿨다운 중에도 바쳐져야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player.nextActionAt).toBe(9_000_000)
  })

  it('수량이 수량이 아니면 예외로 터진다 — 조용한 거절이 아니라 시끄러운 버그다', () => {
    // 라우트 스키마가 1..100000 을 이미 막으므로 여기 닿을 요청은 없다. 그래도
    // 새는 것이 값이라 못 박는다(tradeService.test.ts 와 같은 이유).
    for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => donate(player(), 'ice_shard', count)).toThrow(RangeError)
    }
  })
})

// ---------------------------------------------------------------------------
// 등급 — collectionGrade 를 실제로 불러 확인한다(§6-앞 5·11)
// ---------------------------------------------------------------------------

describe('헌납이 등급을 바꾼다', () => {
  it('문턱(5)을 넘기면 등급이 0 에서 1 로 오른다', () => {
    const before = collectionGrade(0, collection['ice_shard']!)
    const r = donate(player(), 'ice_shard', 5)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    const after = collectionGrade(r.outcome.player.donated['ice_shard']!, collection['ice_shard']!)
    expect(before).toBe(0)
    expect(after).toBe(1)
  })

  it('문턱에 못 미치면 등급이 오르지 않는다', () => {
    const r = donate(player(), 'ice_shard', 4)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(collectionGrade(r.outcome.player.donated['ice_shard']!, collection['ice_shard']!)).toBe(0)
  })

  it('같은 헌납을 두 번 하면 donated 가 누적된다 — 등급도 그만큼 더 오른다', () => {
    const first = donate(player(), 'ice_shard', 3)
    if (!first.ok) throw new Error(`첫 헌납이 ${first.code} 로 막혔다`)
    expect(first.outcome.player.donated['ice_shard']).toBe(3)

    const second = donate(first.outcome.player, 'ice_shard', 3)
    if (!second.ok) throw new Error(`둘째 헌납이 ${second.code} 로 막혔다`)
    expect(second.outcome.player.donated['ice_shard']).toBe(6)
    expect(collectionGrade(6, collection['ice_shard']!)).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 이정표 재판정(§6-앞 9) — 지금 헌납 경로에 newlyAchieved 가 없으면 칭호가 안 붙는다
// ---------------------------------------------------------------------------

describe('헌납이 이정표를 재판정한다', () => {
  const milestone: MilestoneDef = {
    id: 'ice-basics',
    metric: { kind: 'skill', skill: 'ice' },
    threshold: 0,
    name: '얼음을 알다',
    announce: '얼음의 기초를 알게 되었다',
    effect: { kind: 'title' },
  }
  const dataWithMilestone: GameData = { ...data, milestones: [milestone] }

  it('헌납이 성공하면 outcome.achieved 에 새로 달성한 이정표가 담긴다', () => {
    const r = donate(player({ celebrated: [] }), 'ice_shard', 1, { data: dataWithMilestone })
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.achieved.map((m) => m.id)).toEqual(['ice-basics'])
    expect(r.outcome.player.celebrated).toEqual(['ice-basics'])
  })

  it('이미 축하한 이정표는 다시 담기지 않는다', () => {
    const r = donate(player({ celebrated: ['ice-basics'] }), 'ice_shard', 1, { data: dataWithMilestone })
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.achieved).toEqual([])
    expect(r.outcome.player.celebrated).toEqual(['ice-basics'])
  })

  it('거절된 요청은 celebrated 를 건드리지 않는다 — outcome 자체가 없다', () => {
    const p = player({ celebrated: [], stacks: {} })
    const r = donate(p, 'ice_shard', 1, { data: dataWithMilestone })
    expect(r).toEqual({ ok: false, code: 'missing_items' })
  })
})

// ---------------------------------------------------------------------------
// 헌납 불변식(§6-앞 13) — 이것이 이 태스크의 요점이다
// ---------------------------------------------------------------------------

describe('헌납 불변식', () => {
  it('① 정확성 — donated 가 정확히 count 만큼 늘고 stacks 가 그만큼만 줄며, 다른 상태는 전부 불변이다', () => {
    const p = player()
    // 기대 상태를 통째로 지어 놓고 통째로 견준다. 필드를 하나씩 단정하면 새
    // 필드가 생겼을 때 그것이 조용히 변해도 테스트가 초록이다(tradeService.test.ts 와 같은 자세).
    const expected = structuredClone(p)
    expected.stacks['ice_shard'] = 7
    expected.donated['ice_shard'] = 3

    const r = donate(p, 'ice_shard', 3)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player).toEqual(expected)
  })

  it('① 골드·숙련·장비 등 헌납과 무관한 칸은 값이 있어도 손대지 않는다', () => {
    const p = player({
      gold: 12_345,
      skills: skills({ ice: 999, mineral: 42 }),
      instances: [{ instanceId: 'pick-1', itemId: 'ice_pick', enhanceLevel: 3 }],
      equipped: { ice: 'pick-1' },
      stacks: { ice_shard: 10, clear_ice: 4 },
    })
    const expected = structuredClone(p)
    expected.stacks['ice_shard'] = 8
    expected.donated['ice_shard'] = 2

    const r = donate(p, 'ice_shard', 2)
    if (!r.ok) throw new Error(`성공해야 하는데 ${r.code} 로 막혔다`)
    expect(r.outcome.player).toEqual(expected)
  })

  it('② 부족하면 원자성 — 상태가 전혀 안 바뀐다', () => {
    const p = player()
    const before = structuredClone(p)

    const r = donate(p, 'ice_shard', 11)
    expect(r).toEqual({ ok: false, code: 'missing_items' })
    // 거절은 outcome 자체가 없으므로 바뀐 상태를 실을 자리가 없다. 그래도 입력
    // 객체까지 함께 보는 이유: 서비스가 사본이 아니라 원본 위에서 계산하기
    // 시작하면 거절 경로가 조용히 상태를 반쯤 바꿔 놓는다.
    expect(p).toEqual(before)
  })

  it('② not_collectable 로 거절되어도 상태가 전혀 안 바뀐다', () => {
    const p = player({ stacks: { ice_shard: 10, clear_ice: 4 } })
    const before = structuredClone(p)

    const r = donate(p, 'clear_ice', 1)
    expect(r).toEqual({ ok: false, code: 'not_collectable' })
    expect(p).toEqual(before)
  })
})

/**
 * ③ 을 출하 데이터에서도 묻는다 — 픽스처가 아니라 **실제 카탈로그**로.
 *
 * `data.collection` 은 `gather_tiers.csv` 의 25종에서 유도되고 빌드 검증
 * (`validateCollection`)이 그 일치를 지킨다(§6-앞 4). 그래서 "칸이 아니다" 를
 * 픽스처로 못박으면 데이터가 바뀌어도 테스트는 그대로 초록일 수 있다 — 여기서는
 * 실제 아이템 목록에서 술어(kind='tool', tokenEffect 존재, 칸 목록에 없음)로
 * 골라 물어야 규칙이 데이터를 따라간다.
 */
describe('헌납 불변식 ③ — 출하 데이터: 도구·증표·주괴·정제품은 칸이 아니다', () => {
  const shipped = loadGameData()

  function emptyRealPlayer(): PlayerState {
    return player({ stacks: {}, skills: skills(), celebrated: [] })
  }

  function expectAllNotCollectable(defs: readonly ItemDef[]) {
    expect(defs.length).toBeGreaterThan(0)
    for (const def of defs) {
      const r = performDonate({ player: emptyRealPlayer(), data: shipped, itemId: def.id, count: 1 })
      expect({ item: def.id, result: r }).toEqual({
        item: def.id,
        result: { ok: false, code: 'not_collectable' },
      })
    }
  }

  it('도구(kind=tool)는 전부 not_collectable 이다', () => {
    expectAllNotCollectable(Object.values(shipped.items).filter((d) => d.kind === 'tool'))
  })

  it('증표(tokenEffect 있음)는 전부 not_collectable 이다', () => {
    expectAllNotCollectable(Object.values(shipped.items).filter((d) => d.tokenEffect !== undefined))
  })

  it('주괴·정제품 — 재료이지만 채집물이 아닌 것은 전부 not_collectable 이다', () => {
    // 캔 것이 아니라 만든 것(주괴·압축 목재·농축액·가루 등)의 공통점은 하나뿐이다:
    // gather_tiers.csv 유래 칸 목록(data.collection)에 없다는 것. 이름 패턴으로
    // "주괴"·"정제품"을 따로 가르지 않는 이유는 그 구분이 이름에만 있고 규칙에는
    // 없기 때문이다 — 새 정제품이 추가돼도 이 술어가 그대로 잡는다.
    const collectible = new Set(Object.keys(shipped.collection))
    const madeNotGathered = Object.values(shipped.items).filter(
      (d) => d.kind === 'material' && d.tokenEffect === undefined && !collectible.has(d.id),
    )
    expectAllNotCollectable(madeNotGathered)
  })

  it('반대로 칸 목록(25종)은 전부 바칠 수 있다 — not_collectable 오탐이 없다', () => {
    const collectibleIds = Object.keys(shipped.collection)
    expect(collectibleIds.length).toBe(25)
    for (const itemId of collectibleIds) {
      const p = emptyRealPlayer()
      p.stacks[itemId] = 1
      const r = performDonate({ player: p, data: shipped, itemId, count: 1 })
      expect({ item: itemId, ok: r.ok }).toEqual({ item: itemId, ok: true })
    }
  })
})
