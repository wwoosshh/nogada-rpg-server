import {
  GAME_EPOCH_MS,
  NPC_STEP_MS,
  REAL_MS_PER_GAME_DAY,
  REAL_MS_PER_GAME_MINUTE,
  type BakedLeg,
  type GameData,
  type PlaceDef,
  type RouteStep,
  type ScheduleDef,
  type SpeakerDef,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import {
  diffPresence,
  NpcScheduler,
  presenceOnMap,
  schedulesForMap,
  speakersForMap,
  type NpcPresence,
  type NpcStance,
} from './npcScheduler.js'

const 마을 = '눈의마을'
const 채집장 = '얼음채집장'

function presence(stance: NpcStance, x: number, y: number, facing: NpcPresence['facing'] = null): NpcPresence {
  return { stance, tile: { x, y }, facing }
}

const AWAY = presence('away', -1, -1)

// ---- diffPresence — 처지 하나가 다음 처지로 바뀔 때 씬이 할 일 ----

describe('diffPresence', () => {
  it('맵 밖에서 서 있는 자리로 오면 스프라이트를 놓고 그 칸을 잡는다', () => {
    expect(diffPresence('여관안주인', AWAY, presence('standing', 9, 14, 'down'))).toEqual([
      { kind: 'spawn', speakerId: '여관안주인', tile: { x: 9, y: 14 }, facing: 'down', walking: false },
      { kind: 'claim', speakerId: '여관안주인', tile: { x: 9, y: 14 } },
    ])
  })

  it('서 있는 동안 방향이 달라져도 아무 명령도 내지 않는다 — 그 방향은 미세 동작의 것이다', () => {
    const before = presence('standing', 9, 14, 'down')
    const after = presence('standing', 9, 14, 'left')
    expect(diffPresence('여관안주인', before, after)).toEqual([])
  })

  it('걷기 시작하면 막았던 칸을 놓는다 — 걷는 NPC 는 통과 장식이다', () => {
    const before = presence('standing', 9, 14, 'down')
    const after = presence('walking', 9, 15, 'down')
    expect(diffPresence('여관안주인', before, after)).toEqual([
      { kind: 'release', speakerId: '여관안주인', tile: { x: 9, y: 14 } },
      { kind: 'move', speakerId: '여관안주인', tile: { x: 9, y: 15 }, facing: 'down', walking: true },
    ])
  })

  it('걷는 동안에는 방향만 꺾여도 알린다 — 걷는 방향은 스케줄러의 것이다', () => {
    const before = presence('walking', 10, 18, 'down')
    const after = presence('walking', 10, 18, 'right')
    expect(diffPresence('여관안주인', before, after)).toEqual([
      { kind: 'move', speakerId: '여관안주인', tile: { x: 10, y: 18 }, facing: 'right', walking: true },
    ])
  })

  it('같은 칸을 같은 방향으로 계속 걷는 틱에는 아무 일도 하지 않는다', () => {
    const walking = presence('walking', 10, 18, 'right')
    expect(diffPresence('여관안주인', walking, { ...walking, tile: { x: 10, y: 18 } })).toEqual([])
  })

  it('도착해 서면 지점의 방향으로 돌아서고 그 칸을 막는다', () => {
    const before = presence('walking', 13, 18, 'right')
    const after = presence('standing', 13, 18, 'left')
    expect(diffPresence('여관안주인', before, after)).toEqual([
      { kind: 'move', speakerId: '여관안주인', tile: { x: 13, y: 18 }, facing: 'left', walking: false },
      { kind: 'claim', speakerId: '여관안주인', tile: { x: 13, y: 18 } },
    ])
  })

  it('실내로 들어가면 그림은 사라지지만 문 칸은 그 사람의 것으로 남는다 — 밤에 두드릴 문이 있어야 한다', () => {
    const before = presence('walking', 10, 14, 'up')
    const after = presence('indoor', 10, 14, 'up')
    expect(diffPresence('여관안주인', before, after)).toEqual([
      { kind: 'despawn', speakerId: '여관안주인' },
      { kind: 'claim', speakerId: '여관안주인', tile: { x: 10, y: 14 } },
    ])
  })

  it('실내에서 나오면 문 칸을 놓고 다시 나타난다', () => {
    const before = presence('indoor', 10, 14, 'up')
    const after = presence('walking', 10, 15, 'down')
    expect(diffPresence('여관안주인', before, after)).toEqual([
      { kind: 'release', speakerId: '여관안주인', tile: { x: 10, y: 14 } },
      { kind: 'spawn', speakerId: '여관안주인', tile: { x: 10, y: 15 }, facing: 'down', walking: true },
    ])
  })

  it('다른 맵으로 넘어가면 칸을 놓고 사라진다', () => {
    const before = presence('standing', 16, 23, 'down')
    expect(diffPresence('채집장노인', before, AWAY)).toEqual([
      { kind: 'release', speakerId: '채집장노인', tile: { x: 16, y: 23 } },
      { kind: 'despawn', speakerId: '채집장노인' },
    ])
  })

  it('길 위에서는 어떤 칸도 잡지 않는다 — 잡히지 않은 칸은 앞칸에서 바라볼 수도 없다', () => {
    // 이 게임에서 방향키는 갈 수 있는 칸이면 곧바로 한 걸음을 시작한다(TileMover).
    // 그래서 "막지 않으면서 말만 걸리는 칸" 은 게임 안에서 도달할 수 없다 —
    // 잡느냐 마느냐 하나로 두 규칙이 함께 정해지는 것이 그 때문이다.
    const commands = [
      diffPresence('여관안주인', AWAY, presence('walking', 10, 15, 'down')),
      diffPresence('여관안주인', presence('walking', 10, 15, 'down'), presence('walking', 10, 16, 'down')),
    ].flat()
    expect(commands.filter((c) => c.kind === 'claim')).toEqual([])
  })

  it('막은 칸을 먼저 놓고 새 칸을 잡는다 — 순서가 뒤집히면 옛 칸이 영영 막힌다', () => {
    const before = presence('standing', 9, 14, 'down')
    const after = presence('standing', 13, 18, 'left')
    const kinds = diffPresence('여관안주인', before, after).map((c) => c.kind)
    expect(kinds).toEqual(['release', 'move', 'claim'])
  })
})

// ---- presenceOnMap ----

describe('presenceOnMap', () => {
  it('다른 맵에 있으면 활동이 무엇이든 이 맵에서는 없는 것이다', () => {
    // placeId 는 화면이 쓰지 않는다(대화 사실 place 의 출처다) — 그래도 NpcState
    // 의 필드라 여기서도 채운다. 선택 필드로 두면 진짜로 빠진 자리를 못 잡는다.
    const state = { mapId: 채집장, tile: { x: 4, y: 2 }, facing: 'up' as const, activity: 'standing' as const, placeId: '초소' }
    expect(presenceOnMap(state, 마을).stance).toBe('away')
  })

  it('같은 맵이면 활동과 자리를 그대로 옮긴다', () => {
    const state = { mapId: 마을, tile: { x: 9, y: 14 }, facing: 'down' as const, activity: 'standing' as const, placeId: '여관앞' }
    expect(presenceOnMap(state, 마을)).toEqual({ stance: 'standing', tile: { x: 9, y: 14 }, facing: 'down' })
  })
})

// ---- 하루를 걸어 다니는 스케줄러 ----

function place(id: string, x: number, over: Partial<PlaceDef> = {}): PlaceDef {
  return { id, mapId: 마을, x, y: 0, indoor: false, facing: null, ...over }
}

/** 한 줄을 따라 곧게 잇는 구간. 빌드와 같은 규약이다 — 양 끝 칸을 다 담는다. */
function straightLeg(from: PlaceDef, to: PlaceDef): BakedLeg {
  const steps: RouteStep[] = [{ mapId: from.mapId, x: from.x, y: from.y }]
  const dx = Math.sign(to.x - from.x)
  for (let x = from.x; x !== to.x; x += dx) steps.push({ mapId: from.mapId, x: x + dx, y: 0 })
  return { fromPlace: from.id, toPlace: to.id, steps }
}

const 문앞 = place('문앞', 0, { facing: 'down' })
const 광장 = place('광장', 4, { facing: 'left' })
const 여관안 = place('여관안', 1, { indoor: true })

const places: Record<string, PlaceDef> = { 문앞, 광장, 여관안 }
const routes: BakedLeg[] = [문앞, 광장, 여관안].flatMap((a) => [문앞, 광장, 여관안].map((b) => straightLeg(a, b)))

const schedule: ScheduleDef = {
  speakerId: '여관안주인',
  entries: [
    { arriveMinute: 6 * 60, placeIds: ['문앞'] },
    { arriveMinute: 9 * 60, placeIds: ['광장'] },
    { arriveMinute: 22 * 60, placeIds: ['여관안'] },
  ],
}

/** 그 날 그 시각의 실측 ms. 게임 하루는 실측 한 시간이다. */
const at = (dayIndex: number, hour: number, minute = 0): number =>
  GAME_EPOCH_MS + dayIndex * REAL_MS_PER_GAME_DAY + (hour * 60 + minute) * REAL_MS_PER_GAME_MINUTE

function scheduler(): NpcScheduler {
  return new NpcScheduler({ mapId: 마을, schedules: [schedule], places, routes })
}

describe('NpcScheduler.tick', () => {
  it('첫 틱은 지금 서 있는 자리에 바로 세운다 — 새로고침해도 제자리다', () => {
    expect(scheduler().tick(at(0, 7))).toEqual([
      { kind: 'spawn', speakerId: '여관안주인', tile: { x: 0, y: 0 }, facing: 'down', walking: false },
      { kind: 'claim', speakerId: '여관안주인', tile: { x: 0, y: 0 } },
    ])
  })

  it('서 있는 동안 계속 틱을 돌려도 두 번째부터는 아무 명령도 없다', () => {
    const s = scheduler()
    s.tick(at(0, 7))
    expect(s.tick(at(0, 7) + 5_000)).toEqual([])
    expect(s.tick(at(0, 8))).toEqual([])
  })

  it('걸음마다 한 칸씩 옮기고, 그 사이 틱에는 아무 일도 하지 않는다', () => {
    const s = scheduler()
    // 09:00 광장 도착, 네 칸이라 출발은 4 × NPC_STEP_MS 전이다.
    const depart = at(0, 9) - 4 * NPC_STEP_MS
    s.tick(depart - 1)
    // 출발 직후: 막았던 칸을 놓고 걷기 시작한다.
    expect(s.tick(depart).map((c) => c.kind)).toEqual(['release', 'move'])
    expect(s.tick(depart + NPC_STEP_MS / 2)).toEqual([])
    expect(s.tick(depart + NPC_STEP_MS)).toEqual([
      { kind: 'move', speakerId: '여관안주인', tile: { x: 1, y: 0 }, facing: 'right', walking: true },
    ])
  })

  it('도착 순간 지점의 방향으로 서고 그 칸을 막는다', () => {
    const s = scheduler()
    s.tick(at(0, 9) - 1)
    expect(s.tick(at(0, 9))).toEqual([
      { kind: 'move', speakerId: '여관안주인', tile: { x: 4, y: 0 }, facing: 'left', walking: false },
      { kind: 'claim', speakerId: '여관안주인', tile: { x: 4, y: 0 } },
    ])
  })

  it('실내 지점에 도착하면 사라지되 그 문 칸에는 말이 걸린다 — 밤의 "지금 여기 없다"가 거기서 나온다', () => {
    const s = scheduler()
    s.tick(at(0, 21))
    const commands = s.tick(at(0, 22))
    expect(commands).toContainEqual({ kind: 'despawn', speakerId: '여관안주인' })
    expect(commands).toContainEqual({ kind: 'claim', speakerId: '여관안주인', tile: { x: 1, y: 0 } })
  })

  it('맵을 넘나들어 스케줄러를 새로 만들어도 그 시각의 제자리에서 다시 시작한다', () => {
    const before = scheduler()
    before.tick(at(0, 12))
    // 씬 재시작 = 새 스케줄러. 이전 기억이 없으므로 첫 틱이 지금 자리를 통째로 낸다.
    expect(scheduler().tick(at(0, 12))).toEqual([
      { kind: 'spawn', speakerId: '여관안주인', tile: { x: 4, y: 0 }, facing: 'left', walking: false },
      { kind: 'claim', speakerId: '여관안주인', tile: { x: 4, y: 0 } },
    ])
  })

  it('다른 맵의 일과는 이 맵에서 아무 명령도 내지 않는다', () => {
    const 초소 = { ...place('초소', 3), mapId: 채집장 }
    const 노인: ScheduleDef = { speakerId: '채집장노인', entries: [{ arriveMinute: 6 * 60, placeIds: ['초소'] }] }
    const s = new NpcScheduler({
      mapId: 마을,
      schedules: [노인],
      places: { 초소 },
      routes: [straightLeg(초소, 초소)],
    })
    expect(s.tick(at(0, 12))).toEqual([])
  })
})

// ---- 어느 화자를 이 맵이 실어야 하는가 ----

function gameData(over: Partial<GameData>): GameData {
  return {
    items: {},
    nodes: {},
    recipes: {},
    maps: {},
    transitions: [],
    placements: {},
    milestones: [],
    speakers: {},
    places: {},
    schedules: {},
    routes: [],
    dialogue: [],
    ...over,
  }
}

function speaker(id: string, mapId: string): SpeakerDef {
  return { id, name: id, kind: 'npc', mapId, x: 0, y: 0, sprite: 'npc_child', facing: 'down' }
}

const 초소: PlaceDef = { id: '초소', mapId: 채집장, x: 16, y: 23, indoor: false, facing: 'down' }

const data = gameData({
  speakers: {
    여관안주인: speaker('여관안주인', 마을),
    눈마을아이: speaker('눈마을아이', 마을),
    채집장노인: speaker('채집장노인', 채집장),
  },
  places: { 문앞, 광장, 여관안, 초소 },
  schedules: {
    여관안주인: schedule,
    채집장노인: { speakerId: '채집장노인', entries: [{ arriveMinute: 6 * 60, placeIds: ['초소'] }] },
  },
})

describe('schedulesForMap · speakersForMap', () => {
  it('지금 어디 있는가가 아니라 하루 중 올 수 있는가로 고른다 — 프리로드가 이것을 본다', () => {
    expect(schedulesForMap(data, 마을).map((s) => s.speakerId)).toEqual(['여관안주인'])
    expect(schedulesForMap(data, 채집장).map((s) => s.speakerId)).toEqual(['채집장노인'])
  })

  it('일과가 있는 화자는 speakers.csv 의 맵이 아니라 지점이 정한다', () => {
    // 노인의 speakers.csv 맵은 채집장이지만 일과가 마을에 데려오지 않으므로 마을에는 없다.
    expect(speakersForMap(data, 마을).map((s) => s.id)).toEqual(['눈마을아이', '여관안주인'])
    expect(speakersForMap(data, 채집장).map((s) => s.id)).toEqual(['채집장노인'])
  })

  it('일과가 있는 화자를 그 맵에서 빼면 시트도 스프라이트도 만들지 않는다', () => {
    const 떠난이 = gameData({
      speakers: { 여관안주인: speaker('여관안주인', 마을) },
      places: { 초소 },
      schedules: { 여관안주인: { speakerId: '여관안주인', entries: [{ arriveMinute: 360, placeIds: ['초소'] }] } },
    })
    expect(speakersForMap(떠난이, 마을)).toEqual([])
    expect(speakersForMap(떠난이, 채집장).map((s) => s.id)).toEqual(['여관안주인'])
  })
})
