import { describe, expect, it } from 'vitest'
import type {
  BakedLeg,
  GameData,
  MapDef,
  NodePlacement,
  PlaceDef,
  ScheduleDef,
  SpeakerDef,
  TransitionDef,
} from '@nogada/shared'
import type { MapTerrain } from './placements.js'
import { bakeRoutes } from './routeBake.js'
import { parseSchedule } from './schedule.js'

/** 글자 그림에서 지형을 짓는다 — `#` 이 벽이다. parseTerrain 이 맵에서 뽑는 것과 같은 모양이다. */
function terrain(rows: readonly string[]): MapTerrain {
  const walls = new Set<string>()
  rows.forEach((row, y) => {
    ;[...row].forEach((c, x) => {
      if (c === '#') walls.add(`${x},${y}`)
    })
  })
  return { width: rows[0]?.length ?? 0, height: rows.length, walls }
}

function mapDef(id: string, t: MapTerrain): MapDef {
  return { id, name: id, file: `${id}.tmx`, width: t.width, height: t.height, spawn: { x: 0, y: 0 } }
}

function place(id: string, mapId: string, x: number, y: number): PlaceDef {
  return { id, mapId, x, y, indoor: false, facing: null }
}

function speaker(id: string, mapId: string, x: number, y: number): SpeakerDef {
  return { id, name: id, kind: 'npc', mapId, x, y, sprite: 'npc', facing: 'down' }
}

function node(instanceId: string, mapId: string, x: number, y: number): NodePlacement {
  return { instanceId, nodeId: 'ice_vein', mapId, x, y }
}

interface WorldSpec {
  /** 맵 id → 글자 그림 */
  maps: Record<string, readonly string[]>
  places: readonly PlaceDef[]
  /** 화자 id → `.sched` 줄들 */
  schedules: Record<string, readonly string[]>
  transitions?: readonly TransitionDef[]
  speakers?: readonly SpeakerDef[]
  placements?: readonly NodePlacement[]
}

function world(spec: WorldSpec): { data: GameData; terrains: Record<string, MapTerrain> } {
  const terrains: Record<string, MapTerrain> = {}
  const maps: Record<string, MapDef> = {}
  for (const [id, rows] of Object.entries(spec.maps)) {
    terrains[id] = terrain(rows)
    maps[id] = mapDef(id, terrains[id]!)
  }

  const places: Record<string, PlaceDef> = {}
  for (const p of spec.places) places[p.id] = p

  const schedules: Record<string, ScheduleDef> = {}
  for (const [speakerId, lines] of Object.entries(spec.schedules)) {
    schedules[speakerId] = parseSchedule(lines.join('\n'), `${speakerId}.sched`)
  }

  const speakers: Record<string, SpeakerDef> = {}
  for (const s of spec.speakers ?? []) speakers[s.id] = s

  const placements: Record<string, NodePlacement> = {}
  for (const p of spec.placements ?? []) placements[p.instanceId] = p

  return {
    terrains,
    data: {
      shops: {}, masters: [], enhanceCosts: [], collection: {},
      items: {}, nodes: {}, recipes: {}, milestones: [], dialogue: [], routes: [],
      maps, transitions: [...(spec.transitions ?? [])], placements, speakers, places, schedules,
    },
  }
}

function bake(spec: WorldSpec): ReturnType<typeof bakeRoutes> {
  const { data, terrains } = world(spec)
  return bakeRoutes(data, terrains)
}

function legOf(routes: readonly BakedLeg[], from: string, to: string): BakedLeg | undefined {
  return routes.find((r) => r.fromPlace === from && r.toPlace === to)
}

describe('bakeRoutes', () => {
  // 왜: 런타임은 보간만 한다. 길찾기를 실행 중에 돌리면 서버와 클라이언트가
  //     같은 길이의 다른 길을 골라 NPC 가 두 화면에서 다른 골목으로 간다.
  it('한 맵 안의 두 지점을 잇는 최단 경로를 굽는다', () => {
    const { routes, violations } = bake({
      maps: { 마을: ['.....'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 4, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(violations).toEqual([])
    const leg = legOf(routes, '집', '밭')
    expect(leg?.steps).toEqual([
      { mapId: '마을', x: 0, y: 0 },
      { mapId: '마을', x: 1, y: 0 },
      { mapId: '마을', x: 2, y: 0 },
      { mapId: '마을', x: 3, y: 0 },
      { mapId: '마을', x: 4, y: 0 },
    ])
  })

  // 왜: A* 의 걷기 판정은 클라이언트와 같아야 한다 — 벽만 보면 빌드는
  //     통과하는데 실제로는 못 가는 길을 NPC 가 걷는다.
  it('벽을 뚫지 않고 돌아간다', () => {
    const { routes } = bake({
      maps: { 마을: ['..#..', '.....'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 4, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    const steps = legOf(routes, '집', '밭')?.steps ?? []
    expect(steps).not.toContainEqual({ mapId: '마을', x: 2, y: 0 })
    expect(steps.at(-1)).toEqual({ mapId: '마을', x: 4, y: 0 })
  })

  // 왜: 노드 칸은 클라이언트가 걸을 수 없는 칸으로 센다(WorldScene 의 blocked).
  it('노드 칸을 지나가지 않는다', () => {
    const { routes } = bake({
      maps: { 마을: ['..X..', '.....'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 4, 0)],
      placements: [node('ice-1', '마을', 2, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(legOf(routes, '집', '밭')?.steps).not.toContainEqual({ mapId: '마을', x: 2, y: 0 })
  })

  // 왜: 정적 화자도 몸이 있다 — 그 칸으로 걸어 들어가면 겹쳐 선다.
  it('정적 화자 칸을 지나가지 않는다', () => {
    const { routes } = bake({
      maps: { 마을: ['.....', '.....'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 4, 0)],
      speakers: [speaker('간판', '마을', 2, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(legOf(routes, '집', '밭')?.steps).not.toContainEqual({ mapId: '마을', x: 2, y: 0 })
  })

  // 왜: 지점은 다른 NPC 가 서 있는 자리다 — standing 은 칸을 차지한다(설계 §1).
  //     길 한복판의 지점이 길을 막는 것은 사실이고, 그것이 보여야 한다.
  it('다른 지점 칸을 지나가지 않는다', () => {
    const { routes } = bake({
      maps: { 마을: ['.....', '.....'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 4, 0), place('초소', '마을', 2, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(legOf(routes, '집', '밭')?.steps).not.toContainEqual({ mapId: '마을', x: 2, y: 0 })
  })

  // 왜: 통근하는 NPC 는 플레이어와 같은 문으로 넘어간다. 그 칸을 밟는 순간
  //     다른 맵의 도착 칸에 서고, 경로의 mapId 가 거기서 바뀐다.
  it('전환 칸으로 맵을 넘는 경로를 굽는다', () => {
    const { routes, violations } = bake({
      maps: { 가: ['....'], 나: ['....'] },
      places: [place('집', '가', 0, 0), place('밭', '나', 3, 0)],
      transitions: [
        { fromMap: '가', fromX: 3, fromY: 0, toMap: '나', toX: 1, toY: 0, facing: null },
        { fromMap: '나', fromX: 0, fromY: 0, toMap: '가', toX: 2, toY: 0, facing: null },
      ],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(violations).toEqual([])
    expect(legOf(routes, '집', '밭')?.steps).toEqual([
      { mapId: '가', x: 0, y: 0 },
      { mapId: '가', x: 1, y: 0 },
      { mapId: '가', x: 2, y: 0 },
      { mapId: '가', x: 3, y: 0 },
      { mapId: '나', x: 1, y: 0 },
      { mapId: '나', x: 2, y: 0 },
      { mapId: '나', x: 3, y: 0 },
    ])
  })

  // 왜: 한쪽 문만 있으면 갈 수는 있는데 못 돌아온다 — 그 NPC 는 다음 날
  //     첫 줄의 자리로 영영 못 간다(설계 §3).
  it('돌아오는 길이 없으면 막는다', () => {
    const { violations } = bake({
      maps: { 가: ['....'], 나: ['....'] },
      places: [place('집', '가', 0, 0), place('밭', '나', 3, 0)],
      transitions: [{ fromMap: '가', fromX: 3, fromY: 0, toMap: '나', toX: 1, toY: 0, facing: null }],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(violations.some((v) => /돌아오는/.test(v))).toBe(true)
  })

  // 왜: 맵을 고쳐 그려 길이 끊기면 그 자리에서 알아야 한다 — 안 그러면
  //     NPC 가 그 시각에 그냥 사라지거나 벽 속을 걷는다(설계 §9.5).
  it('길이 아예 없으면 막는다', () => {
    const { violations, routes } = bake({
      maps: { 마을: ['.#.', '.#.'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 2, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(routes).toEqual([])
    expect(violations[0]).toMatch(/집.*밭/)
  })

  // 왜: 도착 시각을 지키려면 그 전에 출발해야 한다. 역산한 출발이 앞 줄의
  //     도착보다 이르면 그 NPC 는 앞 줄 자리에 서 보지도 못하고 떠난다.
  it('걷는 시간이 두 줄 사이보다 길면 막는다', () => {
    const { violations } = bake({
      maps: { 마을: ['....................'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 19, 0)],
      schedules: { 갑: ['06:00 집', '06:02 밭'] },
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/06:02/)
    expect(violations[0]).toMatch(/06:00/)
  })

  it('시간이 넉넉하면 통과한다', () => {
    const { violations } = bake({
      maps: { 마을: ['....................'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 19, 0)],
      schedules: { 갑: ['06:00 집', '06:10 밭'] },
    })
    expect(violations).toEqual([])
  })

  // 왜: 되감기 구간(마지막 줄 → 다음 날 첫 줄)도 같은 도착 규칙을 지켜야
  //     한다. 그 구간만 검사에서 빠지면 자정 언저리에 NPC 가 순간이동한다.
  it('되감기 구간의 시간도 검사한다', () => {
    const { violations } = bake({
      maps: { 마을: ['....................'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 19, 0)],
      schedules: { 갑: ['00:00 집', '23:59 밭'] },
    })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/다음 날/)
  })

  // 왜: 한 줄짜리 일과의 되감기는 자기 자신으로의 0길이 걸음이다 —
  //     "하루 종일 그 지점" 으로 정의하고 0 으로 나누지 않는다(설계 §3).
  it('한 줄짜리 일과는 자기 자신으로의 0길이 걸음이 된다', () => {
    const { routes, violations } = bake({
      maps: { 마을: ['...'] },
      places: [place('초소', '마을', 1, 0)],
      schedules: { 노인: ['06:00 초소'] },
    })
    expect(violations).toEqual([])
    expect(routes).toHaveLength(1)
    expect(routes[0]?.steps).toEqual([{ mapId: '마을', x: 1, y: 0 }])
  })

  // 왜: 어느 날 어느 후보가 뽑힐지 미리 알 수 없다 — 하나라도 안 구워 두면
  //     그날 NPC 가 갈 길이 없다.
  it('변주 후보로 갈 수 있는 모든 구간을 굽는다', () => {
    const { routes } = bake({
      maps: { 마을: ['.....', '.....'] },
      places: [
        place('집', '마을', 0, 0),
        place('밭', '마을', 4, 0),
        place('샘', '마을', 4, 1),
      ],
      schedules: { 갑: ['06:00 집', '12:00 밭 | 샘'] },
    })
    const pairs = routes.map((r) => `${r.fromPlace}→${r.toPlace}`).sort()
    expect(pairs).toEqual(['밭→집', '샘→집', '집→밭', '집→샘'])
  })

  // 왜: 개발맵은 시작 마을 성벽에 붙어 있지만 개발 전용이다 — 경로 그래프에
  //     넣으면 주민이 시험장을 가로질러 다니는 지름길이 생긴다(설계 §3).
  it('개발맵을 지나는 지름길은 없는 것으로 친다', () => {
    const { violations } = bake({
      maps: { 가: ['..'], 나: ['..'], 개발맵: ['..'] },
      places: [place('집', '가', 0, 0), place('밭', '나', 1, 0)],
      transitions: [
        { fromMap: '가', fromX: 1, fromY: 0, toMap: '개발맵', toX: 0, toY: 0, facing: null },
        { fromMap: '개발맵', fromX: 1, fromY: 0, toMap: '나', toX: 0, toY: 0, facing: null },
        { fromMap: '나', fromX: 0, fromY: 0, toMap: '개발맵', toX: 1, toY: 0, facing: null },
        { fromMap: '개발맵', fromX: 0, fromY: 0, toMap: '가', toX: 1, toY: 0, facing: null },
      ],
      schedules: { 갑: ['06:00 집', '12:00 밭'] },
    })
    expect(violations.some((v) => /길이 없다/.test(v))).toBe(true)
  })

  // 왜: 두 NPC 가 같은 구간을 걸으면 같은 길이다. 두 번 실으면 생성물이
  //     쓸데없이 커지고, 런타임이 어느 쪽을 고를지 정해지지 않는다.
  it('같은 구간을 두 번 싣지 않는다', () => {
    const { routes } = bake({
      maps: { 마을: ['...'] },
      places: [place('집', '마을', 0, 0), place('밭', '마을', 2, 0)],
      schedules: { 갑: ['06:00 집', '12:00 밭'], 을: ['07:00 집', '13:00 밭'] },
    })
    expect(routes).toHaveLength(2) // 집→밭 과 되감기 밭→집
  })

  it('일과가 하나도 없으면 아무 길도 굽지 않는다', () => {
    const { routes, violations } = bake({ maps: { 마을: ['...'] }, places: [], schedules: {} })
    expect(routes).toEqual([])
    expect(violations).toEqual([])
  })
})
