import { describe, expect, it } from 'vitest'
import { NPC_STEP_MS, npcStateAt, pickVariant, type NpcState } from './npcSchedule.js'
import {
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_DAY,
  REAL_MS_PER_GAME_MINUTE,
  gameTimeAt,
} from './time.js'
import type { BakedLeg, PlaceDef, RouteStep, ScheduleDef } from './types.js'

const 마을 = '눈의마을'
const 채집장 = '얼음채집장'

function place(id: string, x: number, over: Partial<PlaceDef> = {}): PlaceDef {
  return { id, mapId: 마을, x, y: 0, indoor: false, facing: null, ...over }
}

/**
 * 한 맵의 한 줄을 따라 곧게 잇는 구간. 빌드(routeBake)와 같은 규약이다 —
 * 양 끝 칸을 다 담으므로 걸음 수는 `steps.length - 1` 이고, 같은 자리로의
 * 0길이 걸음도 칸 하나로 표현된다.
 */
function straightLeg(from: PlaceDef, to: PlaceDef): BakedLeg {
  const steps: RouteStep[] = [{ mapId: from.mapId, x: from.x, y: from.y }]
  const dx = Math.sign(to.x - from.x)
  for (let x = from.x; x !== to.x; x += dx) steps.push({ mapId: from.mapId, x: x + dx, y: 0 })
  return { fromPlace: from.id, toPlace: to.id, steps }
}

/**
 * 모든 (지점→지점) 쌍을 굽는다.
 *
 * 빌드는 일과가 요구하는 쌍만 굽지만, 테스트에서 그것을 손으로 추리면 변주가
 * 어느 후보를 고르느냐에 따라 "구운 적 없는 구간"이 생겨 실패의 원인이
 * 흐려진다. 여기서는 전부 굽는 것이 싸고 정확하다.
 */
function allLegs(...places: PlaceDef[]): BakedLeg[] {
  return places.flatMap((a) => places.map((b) => straightLeg(a, b)))
}

function placesOf(...places: PlaceDef[]): Record<string, PlaceDef> {
  return Object.fromEntries(places.map((p) => [p.id, p]))
}

/** 그 날(게임 날짜 index)의 자정에 해당하는 실측 ms */
const dayStart = (dayIndex: number): number => GAME_EPOCH_MS + dayIndex * REAL_MS_PER_GAME_DAY
/** 그 날 그 시각의 실측 ms */
const at = (dayIndex: number, hour: number, minute = 0): number =>
  dayStart(dayIndex) + (hour * 60 + minute) * REAL_MS_PER_GAME_MINUTE

const tileKey = (s: NpcState): string => `${s.mapId}:${s.tile.x},${s.tile.y}`
const stepKey = (s: RouteStep): string => `${s.mapId}:${s.x},${s.y}`

/** 그 상태가 구운 경로의 몇 번째 칸인가. 경로 위가 아니면 -1. */
function indexOnLeg(leg: BakedLeg, state: NpcState): number {
  return leg.steps.findIndex((s) => stepKey(s) === tileKey(state))
}

describe('npcStateAt — 활성 줄 고르기', () => {
  const 여관앞 = place('여관앞', 0, { facing: 'down' })
  const 눈광장 = place('눈광장', 10)
  const places = placesOf(여관앞, 눈광장)
  const routes = allLegs(여관앞, 눈광장)

  /** 아침에 문 앞, 밤에 광장. 되감기(광장→다음 날 문 앞)는 10칸 = 4초다. */
  const schedule: ScheduleDef = {
    speakerId: '여관안주인',
    entries: [
      { arriveMinute: 6 * 60, placeIds: ['여관앞'] },
      { arriveMinute: 22 * 60, placeIds: ['눈광장'] },
    ],
  }
  const state = (nowMs: number): NpcState => npcStateAt(schedule, places, routes, nowMs)

  it('도착 시각에는 그 줄의 지점에 서 있다', () => {
    const s = state(at(3, 6))
    expect(s).toEqual({ mapId: 마을, tile: { x: 0, y: 0 }, facing: 'down', activity: 'standing', placeId: '여관앞' })
  })

  it('두 도착 사이에는 앞 줄의 지점에 그대로 서 있다', () => {
    expect(tileKey(state(at(3, 12)))).toBe(`${마을}:0,0`)
  })

  // 왜: 하루가 자정에 끊기면 새벽의 NPC 는 "아직 첫 줄이 오지 않았다"는
  //     이유로 아무 데도 없게 된다. 어제의 마지막 줄이 살아 있어야 한다.
  it('자정을 넘긴 새벽에는 어제의 마지막 줄이 활성이다', () => {
    const s = state(at(3, 2))
    expect(s.activity).toBe('standing')
    expect(tileKey(s)).toBe(`${마을}:10,0`)
  })

  it('어제의 마지막 줄은 오늘 첫 줄이 도착할 때까지 활성이다', () => {
    // 05:59:59 쯤 — 되감기 걸음(4초)이 시작된 뒤라 이미 길 위다.
    expect(state(at(3, 5, 59)).activity).toBe('walking')
    // 그 전에는 어제 자리에 서 있다.
    expect(tileKey(state(at(3, 5, 58)))).toBe(`${마을}:10,0`)
  })

  it('세계 시계와 같은 시간 축을 쓴다 — 06:00 은 게임 시계의 06:00 이다', () => {
    // 빌드가 역산에 쓴 환산(REAL_MS_PER_GAME_MINUTE)과 이 함수의 환산이
    // 갈라지면 NPC 는 시간표가 말하는 시각과 다른 때에 도착한다.
    const t = gameTimeAt(at(3, 6))
    expect([t.hour, t.minute]).toEqual([6, 0])
    expect(tileKey(state(at(3, 6)))).toBe(`${마을}:0,0`)
  })

  it('epoch 이전(음수 날짜)에도 답이 있다', () => {
    expect(state(at(-2, 12)).activity).toBe('standing')
  })
})

describe('npcStateAt — 출발과 도착의 경계', () => {
  const 여관앞 = place('여관앞', 0)
  const 눈광장 = place('눈광장', 10, { facing: 'up' })
  const places = placesOf(여관앞, 눈광장)
  const routes = allLegs(여관앞, 눈광장)
  const schedule: ScheduleDef = {
    speakerId: '여관안주인',
    entries: [
      { arriveMinute: 6 * 60, placeIds: ['여관앞'] },
      { arriveMinute: 9 * 60, placeIds: ['눈광장'] },
    ],
  }
  const state = (nowMs: number): NpcState => npcStateAt(schedule, places, routes, nowMs)

  const arrival = at(3, 9)
  const walkMs = 10 * NPC_STEP_MS
  const departure = arrival - walkMs

  it('출발 직전에는 아직 앞 지점에 서 있다', () => {
    const s = state(departure - 1)
    expect(s.activity).toBe('standing')
    expect(tileKey(s)).toBe(`${마을}:0,0`)
  })

  it('출발 순간에는 이미 걷는 중이다 — 첫 칸은 출발 지점이다', () => {
    const s = state(departure)
    expect(s.activity).toBe('walking')
    expect(tileKey(s)).toBe(`${마을}:0,0`)
    expect(s.facing).toBe('right')
  })

  it('한 걸음이 지나면 한 칸 간다', () => {
    expect(tileKey(state(departure + NPC_STEP_MS))).toBe(`${마을}:1,0`)
    expect(tileKey(state(departure + NPC_STEP_MS * 2 - 1))).toBe(`${마을}:1,0`)
  })

  // 왜: 도착 시각에 아직 길 위에 있으면 시간표가 거짓말이 된다("09:00 눈광장").
  it('도착 순간에는 걷기가 끝나고 지점에 서 있다', () => {
    const s = state(arrival)
    expect(s).toEqual({ mapId: 마을, tile: { x: 10, y: 0 }, facing: 'up', activity: 'standing', placeId: '눈광장' })
  })

  it('도착 직전에는 마지막 한 칸을 남기고 걷는 중이다', () => {
    const s = state(arrival - 1)
    expect(s.activity).toBe('walking')
    expect(tileKey(s)).toBe(`${마을}:9,0`)
  })

  // 왜: 구운 경로의 첫 칸과 끝 칸은 출발·도착 지점의 칸 그 자체다. placeId 를
  //     칸으로 되찾는 방식이었다면 출발 순간과 도착 직전에 걷는 사람이 "그
  //     지점에 있다"고 보고됐을 것이고, 그 값이 대화 사실 place 로 나간다.
  it('걷는 동안에는 어느 지점도 아니다 — 출발 칸에 서 있는 첫 순간까지도', () => {
    expect(state(departure).placeId).toBeNull()
    expect(state(arrival - 1).placeId).toBeNull()
    expect(state(departure - 1).placeId).toBe('여관앞')
    expect(state(arrival).placeId).toBe('눈광장')
  })
})

describe('npcStateAt — 자정을 걸치는 걸음의 변주', () => {
  const 여관앞 = place('여관앞', 0)
  const 광장A = place('광장A', 30)
  const 광장B = place('광장B', 40)
  const places = placesOf(여관앞, 광장A, 광장B)
  const routes = allLegs(여관앞, 광장A, 광장B)

  /** 00:02 도착 — 어느 후보로 가든 걸음(12초·16초)이 자정 전에 시작된다. */
  const schedule: ScheduleDef = {
    speakerId: '여관안주인',
    entries: [
      { arriveMinute: 2, placeIds: ['광장A', '광장B'] },
      { arriveMinute: 12 * 60, placeIds: ['여관앞'] },
    ],
  }

  /**
   * 어제와 오늘의 변주가 갈리는 날을 고른다.
   *
   * 이런 날이라야 "지금의 날짜로 다시 뽑는" 구현이 드러난다 — 자정을 넘는
   * 순간 목적지가 바뀌어 NPC 가 길 한복판에서 순간이동한다. 두 날의 선택이
   * 같은 날을 고르면 그런 구현도 조용히 통과한다.
   */
  function dayWhereVariantFlips(): number {
    for (let d = 0; d < 200; d++) {
      if (pickVariant('여관안주인', d, 0, 2) !== pickVariant('여관안주인', d + 1, 0, 2)) return d
    }
    throw new Error('200일 안에 변주가 갈리는 날이 없다 — pickVariant 가 날짜를 안 보고 있다')
  }

  const day = dayWhereVariantFlips()
  const arrival = at(day + 1, 0, 2)
  const state = (nowMs: number): NpcState => npcStateAt(schedule, places, routes, nowMs)

  it('자정을 걸쳐 걷는 동안 목적지를 다시 뽑지 않는다', () => {
    const arrived = state(arrival)
    expect(arrived.activity).toBe('standing')

    const destination = [광장A, 광장B].find((p) => p.x === arrived.tile.x)
    if (!destination) throw new Error(`도착 칸 ${tileKey(arrived)} 이 두 후보 어느 쪽도 아니다`)

    const leg = straightLeg(여관앞, destination)
    const departure = arrival - (leg.steps.length - 1) * NPC_STEP_MS
    // 이 테스트의 전제: 걸음이 실제로 자정을 걸친다.
    expect(departure).toBeLessThan(dayStart(day + 1))

    let previous = -1
    for (let t = departure; t < arrival; t += NPC_STEP_MS / 2) {
      const s = state(t)
      expect(s.activity).toBe('walking')
      const index = indexOnLeg(leg, s)
      expect(index).toBeGreaterThanOrEqual(previous)
      if (index < 0) throw new Error(`${t} 의 칸 ${tileKey(s)} 이 그 구간 위에 없다 — 목적지가 바뀌었다`)
      previous = index
    }
    expect(previous).toBe(leg.steps.length - 2)
  })

  it('자정 직전과 직후가 같은 구간의 이어지는 칸이다', () => {
    const midnight = dayStart(day + 1)
    const before = state(midnight - 1)
    const after = state(midnight + NPC_STEP_MS)
    expect(before.activity).toBe('walking')
    expect(after.activity).toBe('walking')
    // 순간이동하면 x 가 한 칸이 아니라 열 칸씩 뛴다.
    expect(after.tile.x - before.tile.x).toBeLessThanOrEqual(2)
    expect(after.tile.x).toBeGreaterThan(before.tile.x)
  })
})

describe('npcStateAt — 한 줄 일과', () => {
  const 초소 = place('초소', 5, { facing: 'left' })
  const places = placesOf(초소)
  const routes = allLegs(초소)
  const schedule: ScheduleDef = {
    speakerId: '채집장노인',
    entries: [{ arriveMinute: 6 * 60, placeIds: ['초소'] }],
  }

  // 왜: 되감기가 자기 자신으로의 0길이 걸음이라, 여기서 0 으로 나누거나
  //     "다음 줄이 없다"로 빠지면 유일한 화자가 하루 종일 사라진다.
  it('종일 그 지점에 서 있다', () => {
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const s = npcStateAt(schedule, places, routes, at(4, 0, minute))
      expect(s).toEqual({ mapId: 마을, tile: { x: 5, y: 0 }, facing: 'left', activity: 'standing', placeId: '초소' })
    }
  })
})

describe('npcStateAt — indoor', () => {
  const 여관앞 = place('여관앞', 0)
  const 여관안 = place('여관안', 2, { indoor: true })
  const places = placesOf(여관앞, 여관안)
  const routes = allLegs(여관앞, 여관안)
  const schedule: ScheduleDef = {
    speakerId: '여관안주인',
    entries: [
      { arriveMinute: 6 * 60, placeIds: ['여관앞'] },
      { arriveMinute: 22 * 60, placeIds: ['여관안'] },
    ],
  }
  const state = (nowMs: number): NpcState => npcStateAt(schedule, places, routes, nowMs)

  it('실내 지점에 서 있으면 indoor 다', () => {
    expect(state(at(3, 23)).activity).toBe('indoor')
  })

  it('실내 지점으로 걸어가는 동안은 아직 walking 이다 — 문 앞까지는 길 위에 있다', () => {
    const departure = at(3, 22) - 2 * NPC_STEP_MS
    expect(state(departure).activity).toBe('walking')
  })

  it('실내에서 나오면 다시 standing 이다', () => {
    expect(state(at(3, 6)).activity).toBe('standing')
  })
})

describe('npcStateAt — 맵을 넘는 걸음', () => {
  const 초소 = place('초소', 2)
  const 심층 = { ...place('심층', 3), mapId: 채집장 }
  const places = placesOf(초소, 심층)
  /** 마을 (2,0) → 문 (3,0) → 채집장 (1,0) → (2,0) → (3,0). 가운데 걸음이 맵을 넘는다. */
  const crossing: BakedLeg = {
    fromPlace: '초소',
    toPlace: '심층',
    steps: [
      { mapId: 마을, x: 2, y: 0 },
      { mapId: 마을, x: 3, y: 0 },
      { mapId: 채집장, x: 1, y: 0 },
      { mapId: 채집장, x: 2, y: 0 },
      { mapId: 채집장, x: 3, y: 0 },
    ],
  }
  const back: BakedLeg = {
    fromPlace: '심층',
    toPlace: '초소',
    steps: [...crossing.steps].reverse(),
  }
  const routes = [crossing, back]
  const schedule: ScheduleDef = {
    speakerId: '채집장노인',
    entries: [
      { arriveMinute: 6 * 60, placeIds: ['초소'] },
      { arriveMinute: 12 * 60, placeIds: ['심층'] },
    ],
  }
  const state = (nowMs: number): NpcState => npcStateAt(schedule, places, routes, nowMs)

  const arrival = at(3, 12)
  const departure = arrival - 4 * NPC_STEP_MS

  it('걷는 도중에 mapId 가 바뀐다', () => {
    expect(state(departure).mapId).toBe(마을)
    expect(state(departure + NPC_STEP_MS).mapId).toBe(마을)
    expect(state(departure + NPC_STEP_MS * 2).mapId).toBe(채집장)
    expect(state(arrival - 1).mapId).toBe(채집장)
  })

  // 왜: 문 칸에서 다음 칸은 다른 맵이라 좌표 차이가 방향이 아니다. 거기서
  //     방향을 계산하면 말도 안 되는 값이 나오거나 undefined 가 샌다.
  it('문 칸에서는 들어온 방향을 그대로 본다', () => {
    expect(state(departure + NPC_STEP_MS).facing).toBe('right')
  })
})

describe('npcStateAt — 결정성', () => {
  const 여관앞 = place('여관앞', 0)
  const 눈광장 = place('눈광장', 10)
  const 여관안 = place('여관안', 2, { indoor: true })
  const places = placesOf(여관앞, 눈광장, 여관안)
  const routes = allLegs(여관앞, 눈광장, 여관안)
  const schedule: ScheduleDef = {
    speakerId: '여관안주인',
    entries: [
      { arriveMinute: 6 * 60, placeIds: ['여관앞'] },
      { arriveMinute: 9 * 60, placeIds: ['눈광장', '여관앞'] },
      { arriveMinute: 22 * 60, placeIds: ['여관안'] },
    ],
  }
  const state = (nowMs: number): NpcState => npcStateAt(schedule, places, routes, nowMs)

  it('같은 입력은 몇 번을 물어도 같은 답이다', () => {
    const when = at(5, 8, 58)
    const first = state(when)
    for (let i = 0; i < 1000; i++) expect(state(when)).toEqual(first)
  })

  it('돌려준 tile 은 매번 새 객체다 — 부르는 쪽이 고쳐도 지점이 움직이지 않는다', () => {
    const s = state(at(5, 12))
    s.tile.x = 999
    expect(state(at(5, 12)).tile.x).toBe(0)
  })

  // 왜: 시각이 조금 앞으로 갈 때 칸이 뒤로 가면 NPC 가 되감긴다. 이 함수가
  //     그것을 보장해야 clock.ts 의 단조화가 화면까지 이어진다.
  it('시각이 앞으로 갈 때 칸이 뒤로 가지 않는다', () => {
    const arrival = at(5, 9)
    const leg = straightLeg(여관앞, 눈광장)
    const legToSelf = straightLeg(여관앞, 여관앞)
    let previous = -1
    let seen: BakedLeg | null = null

    for (let t = arrival - 10 * NPC_STEP_MS - 1000; t <= arrival; t += 37) {
      const s = state(t)
      if (s.activity === 'standing' && tileKey(s) === `${마을}:0,0` && seen === null) continue
      seen ??= indexOnLeg(leg, s) >= 0 ? leg : legToSelf
      const index = indexOnLeg(seen, s)
      expect(index).toBeGreaterThanOrEqual(previous)
      previous = index
    }
  })

  it('하루를 통째로 훑어도 답이 없는 순간이 없다', () => {
    for (let t = dayStart(6); t < dayStart(7); t += 997) {
      const s = state(t)
      expect(['standing', 'walking', 'indoor']).toContain(s.activity)
      expect(Number.isFinite(s.tile.x) && Number.isFinite(s.tile.y)).toBe(true)
    }
  })
})

describe('pickVariant', () => {
  it('같은 화자·날·줄이면 언제나 같은 후보다', () => {
    const first = pickVariant('여관안주인', 12, 1, 3)
    for (let i = 0; i < 100; i++) expect(pickVariant('여관안주인', 12, 1, 3)).toBe(first)
  })

  it('후보가 하나면 언제나 그 하나다', () => {
    for (let d = 0; d < 50; d++) expect(pickVariant('여관안주인', d, 0, 1)).toBe(0)
  })

  it('고른 값은 언제나 후보 범위 안이다', () => {
    for (let d = -30; d < 30; d++) {
      const v = pickVariant('여관안주인', d, 2, 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(3)
    }
  })

  it('날이 바뀌면 후보가 갈린다 — 변주가 변주다', () => {
    const picks = new Set<number>()
    for (let d = 0; d < 60; d++) picks.add(pickVariant('여관안주인', d, 0, 2))
    expect(picks.size).toBe(2)
  })

  // 왜: 시드가 날짜만 보면 마을 사람 전원이 같은 날 같은 쪽을 고른다 —
  //     변주가 있는데도 마을이 한 몸처럼 움직인다.
  it('화자가 다르면 같은 날에도 따로 고른다', () => {
    const a = Array.from({ length: 40 }, (_, d) => pickVariant('여관안주인', d, 0, 2))
    const b = Array.from({ length: 40 }, (_, d) => pickVariant('채집장노인', d, 0, 2))
    expect(a).not.toEqual(b)
  })

  it('줄이 다르면 같은 날에도 따로 고른다', () => {
    const a = Array.from({ length: 40 }, (_, d) => pickVariant('여관안주인', d, 0, 2))
    const b = Array.from({ length: 40 }, (_, d) => pickVariant('여관안주인', d, 1, 2))
    expect(a).not.toEqual(b)
  })
})
