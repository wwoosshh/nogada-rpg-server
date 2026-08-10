import {
  GAME_MINUTES_PER_DAY,
  NPC_STEP_MS,
  REAL_MS_PER_GAME_MINUTE,
  type BakedLeg,
  type GameData,
  type PlaceDef,
  type RouteStep,
} from '@nogada/shared'
import type { MapTerrain } from './placements.js'
import { formatMinute } from './schedule.js'

/**
 * 경로 그래프에서 빼는 맵.
 *
 * 개발맵은 눈의마을 서문에 문이 하나 붙어 있지만 개발 전용 시험장이다 —
 * 그래프에 넣으면 주민이 시험장을 가로지르는 지름길이 생기고, 그 맵을 고칠
 * 때마다 마을 사람들의 하루가 흔들린다.
 *
 * 맵 이름을 바꾸면 이 목록도 함께 바꾼다. 여기 없는 이름을 적어 두어도
 * 조용히 아무 일도 일어나지 않으므로(그런 맵은 애초에 그래프에 없다) 검사할
 * 것이 없다.
 */
const EXCLUDED_MAP_IDS: readonly string[] = ['개발맵']

function keyOf(step: RouteStep): string {
  return `${step.mapId}:${step.x},${step.y}`
}

function stepOf(place: PlaceDef): RouteStep {
  return { mapId: place.mapId, x: place.x, y: place.y }
}

interface Graph {
  terrains: Record<string, MapTerrain>
  /** 몸이 차지한 칸 — 노드, 정적 화자, 지점. 벽은 지형에서 따로 본다. */
  occupied: ReadonlySet<string>
  /** 전환 칸 → 그 문이 데려다 놓는 칸. */
  doors: ReadonlyMap<string, RouteStep>
}

const DELTAS: readonly RouteStep[] = [
  { mapId: '', x: 0, y: -1 },
  { mapId: '', x: 0, y: 1 },
  { mapId: '', x: -1, y: 0 },
  { mapId: '', x: 1, y: 0 },
]

/**
 * 걷기 판정을 클라이언트와 같은 것으로 맞춘다.
 *
 * `MapTerrain.walls` 만 보면 빌드는 통과하는데 실제로는 못 가는 길이 나온다 —
 * 클라이언트는 노드 칸과 화자 칸도 걸을 수 없는 칸으로 센다(WorldScene 의
 * blocked). 지점 칸도 같다: 서 있는 NPC 는 몸이 있다(설계 §1).
 *
 * 일과가 있는 화자의 speakers.csv 좌표는 세지 않는다 — 그 사람은 이제 그
 * 칸에 서 있지 않고, 진짜 자리는 시각이 정한다.
 */
function buildGraph(data: GameData, terrains: Record<string, MapTerrain>): Graph {
  const occupied = new Set<string>()
  for (const p of Object.values(data.placements)) occupied.add(keyOf(p))
  for (const s of Object.values(data.speakers)) {
    if (data.schedules[s.id]) continue
    occupied.add(`${s.mapId}:${s.x},${s.y}`)
  }
  for (const p of Object.values(data.places)) occupied.add(keyOf(p))

  const doors = new Map<string, RouteStep>()
  for (const t of data.transitions) {
    if (EXCLUDED_MAP_IDS.includes(t.fromMap) || EXCLUDED_MAP_IDS.includes(t.toMap)) continue
    doors.set(`${t.fromMap}:${t.fromX},${t.fromY}`, { mapId: t.toMap, x: t.toX, y: t.toY })
  }

  return { terrains, occupied, doors }
}

/**
 * 그 칸에서 한 걸음에 갈 수 있는 칸들.
 *
 * 전환 칸에서는 **문 너머 한 곳뿐이다.** 그 칸을 밟는 순간 넘어가 버리므로
 * 거기서 옆으로 걸어 나가는 길은 실제로 없다 — 그것을 허용하면 빌드가 굽는
 * 길과 플레이어가 걷는 세계가 갈라진다.
 */
function neighbors(graph: Graph, tile: RouteStep): RouteStep[] {
  const door = graph.doors.get(keyOf(tile))
  if (door) return [door]

  const terrain = graph.terrains[tile.mapId]
  if (!terrain) return []

  const out: RouteStep[] = []
  for (const d of DELTAS) {
    const x = tile.x + d.x
    const y = tile.y + d.y
    if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) continue
    if (terrain.walls.has(`${x},${y}`)) continue
    out.push({ mapId: tile.mapId, x, y })
  }
  return out
}

/**
 * 지점에서 지점까지 최단 경로. 없으면 null.
 *
 * 너비 우선 탐색이다 — 간선 비용이 전부 한 걸음이라 A\* 의 휴리스틱을 0 으로
 * 둔 것과 같고, 그 경우 최단 경로가 보장된다. 맨해튼 거리를 휴리스틱으로 쓰지
 * 않는 것은 맵을 넘는 간선 때문이다: 다른 맵의 칸까지의 거리를 좌표로는 알 수
 * 없어서 허용 휴리스틱이 아니고, 그대로 쓰면 최단이 아닌 길을 굽는다.
 *
 * 출발·도착 지점 칸은 몸이 차지한 칸이지만 지나갈 수 있는 것으로 본다 —
 * 그 자리에 서는 것이 이 걸음의 목적이다. 나머지 지점 칸은 막힌 채다.
 */
function findPath(graph: Graph, from: PlaceDef, to: PlaceDef): RouteStep[] | null {
  const start = stepOf(from)
  const goalKey = keyOf(to)
  if (keyOf(start) === goalKey) return [start]

  const cameFrom = new Map<string, RouteStep>()
  const seen = new Set<string>([keyOf(start)])
  let frontier: RouteStep[] = [start]

  while (frontier.length > 0) {
    const next: RouteStep[] = []
    for (const tile of frontier) {
      for (const n of neighbors(graph, tile)) {
        const k = keyOf(n)
        if (seen.has(k)) continue
        if (k !== goalKey && graph.occupied.has(k)) continue
        seen.add(k)
        cameFrom.set(k, tile)

        if (k === goalKey) {
          const steps: RouteStep[] = [n]
          let cursor = tile
          while (keyOf(cursor) !== keyOf(start)) {
            steps.unshift(cursor)
            cursor = cameFrom.get(keyOf(cursor))!
          }
          steps.unshift(start)
          return steps
        }
        next.push(n)
      }
    }
    frontier = next
  }

  return null
}

export interface BakeResult {
  /** 일과가 요구하는 모든 (지점→지점) 구간. 같은 구간은 한 번만 들어간다. */
  routes: BakedLeg[]
  violations: string[]
}

/** 걸음 수 × 400ms. steps 는 양 끝 칸을 다 담으므로 걸음은 하나 적다. */
function durationMsOf(leg: BakedLeg): number {
  return (leg.steps.length - 1) * NPC_STEP_MS
}

/**
 * 일과가 요구하는 길을 전부 굽고, 그 길로 시간표를 지킬 수 있는지 본다.
 *
 * `pnpm data:build` 가 지점 사이 길을 여기서 계산해 생성물에 싣는다(설계 §3).
 * 런타임은 보간뿐이라, 여기서 막지 못한 것은 화면에서 "NPC 가 벽 속을 걷는다"
 * 나 "그 시각에 아무 데도 없다"로만 드러난다.
 *
 * 검증(참조 무결성)이 끝난 뒤에 부른다 — 없는 지점을 가리키는 일과에 길찾기를
 * 돌리면 "길이 없다" 는 그림자 위반만 잔뜩 나온다.
 */
export function bakeRoutes(data: GameData, terrains: Record<string, MapTerrain>): BakeResult {
  const graph = buildGraph(data, terrains)
  const routes: BakedLeg[] = []
  const violations: string[] = []

  /** 이미 구운 구간. null 은 "길이 없더라" 는 결과까지 기억해 두 번 찾지 않는다. */
  const baked = new Map<string, BakedLeg | null>()

  const legFor = (from: PlaceDef, to: PlaceDef): BakedLeg | null => {
    const key = `${from.id}→${to.id}`
    const known = baked.get(key)
    if (known !== undefined) return known

    const steps = findPath(graph, from, to)
    const leg = steps ? { fromPlace: from.id, toPlace: to.id, steps } : null
    baked.set(key, leg)
    return leg
  }

  // 화자 순서를 정렬해 두는 것은 생성물이 파일 시스템의 읽기 순서에 따라
  // 달라지지 않게 하기 위해서다 — 같은 데이터면 같은 gamedata.json 이어야
  // 무엇이 바뀌었는지 diff 로 볼 수 있다.
  for (const speakerId of Object.keys(data.schedules).sort()) {
    const schedule = data.schedules[speakerId]!
    const entries = schedule.entries

    for (let i = 0; i < entries.length; i++) {
      const cur = entries[i]!
      const isWrap = i === entries.length - 1
      const next = isWrap ? entries[0]! : entries[i + 1]!

      // 되감기 구간은 마지막 줄에서 **다음 날** 첫 줄까지다. 한 줄짜리 일과는
      // 자기 자신으로 돌아오는 하루짜리 구간이 되어(0길이 걸음) 늘 넉넉하다.
      const gapMinutes = isWrap
        ? GAME_MINUTES_PER_DAY - cur.arriveMinute + next.arriveMinute
        : next.arriveMinute - cur.arriveMinute
      const availableMs = gapMinutes * REAL_MS_PER_GAME_MINUTE

      for (const fromId of cur.placeIds) {
        for (const toId of next.placeIds) {
          const from = data.places[fromId]
          const to = data.places[toId]
          // 없는 지점은 validateSchedules 가 이미 말했다. 여기서 또 말하면
          // 같은 오타로 위반이 둘 생긴다.
          if (!from || !to) continue

          const at = `schedules[${speakerId}]`
          const legLabel = isWrap
            ? `마지막 줄(${formatMinute(cur.arriveMinute)} ${fromId})에서 다음 날 첫 줄(${formatMinute(next.arriveMinute)} ${toId})`
            : `${formatMinute(cur.arriveMinute)} ${fromId} 에서 ${formatMinute(next.arriveMinute)} ${toId}`

          const excluded = [from, to].find((p) => EXCLUDED_MAP_IDS.includes(p.mapId))
          if (excluded) {
            violations.push(
              `${at}: 지점 "${excluded.id}" 가 ${excluded.mapId} 에 있다 — 그 맵은 경로 그래프에서 빠져 있어 일과에 쓸 수 없다`,
            )
            continue
          }

          const leg = legFor(from, to)
          if (!leg) {
            violations.push(
              `${at}: ${legLabel} 로 가는 길이 없다 — 벽·노드·화자·다른 지점이 길을 막고 있거나 두 맵이 이어져 있지 않다. ` +
                `맵을 고쳐 길을 내거나 지점을 옮긴다`,
            )
            continue
          }

          // 갈 수 있으면 돌아올 수 있어야 한다. 한쪽 문만 뚫려 있으면 그 NPC 는
          // 다음 날 첫 줄의 자리로 영영 못 간다(설계 §3).
          if (!legFor(to, from)) {
            violations.push(
              `${at}: "${fromId}" 에서 "${toId}" 로는 가는데 돌아오는 길이 없다 — ` +
                `transitions.csv 에 한쪽 방향의 문만 있는지 본다. 갈 수 있으면 돌아올 수 있어야 한다`,
            )
          }

          if (!routes.includes(leg)) routes.push(leg)

          const walkMs = durationMsOf(leg)
          if (walkMs > availableMs) {
            const walkMinutes = Math.ceil(walkMs / REAL_MS_PER_GAME_MINUTE)
            violations.push(
              `${at}: ${legLabel} 까지 ${leg.steps.length - 1}칸을 걷는데 시간이 모자란다 — ` +
                `걷는 데 게임 시간으로 ${walkMinutes}분이 필요한데 두 줄 사이는 ${gapMinutes}분이다. ` +
                `시각을 벌리거나 더 가까운 지점을 고른다`,
            )
          }
        }
      }
    }
  }

  // 같은 문장이 두 번 나오는 것은 같은 구간을 여러 줄이 함께 쓰는 경우뿐이다 —
  // 고칠 곳이 한 군데인데 목록만 길어진다.
  return { routes, violations: [...new Set(violations)] }
}
