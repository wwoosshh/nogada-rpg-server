import {
  DIRECTIONS,
  type BarrierRegions,
  type Direction,
  type GameData,
  type TransitionDef,
} from '@nogada/shared'
import { START_MAP_ID } from './maps.js'
import { optionalCell, readGate, requireCell, toInt } from './parse.js'
import type { MapTerrain } from './placements.js'

type Row = Record<string, string>

/** `gateTide` 칸에 적는 유일한 값. 시각이 아니라 표시라 1 하나뿐이다(TransitionDef 주석). */
const TIDE_MARK = '1'

/**
 * `gateTide` 칸을 읽는다 — 빈 칸은 아니다, `"1"` 은 맞다, 나머지는 던진다.
 *
 * 다른 값을 조용히 false 로 접지 않는 이유는 `gather_tables.csv` 의 `equity` 와
 * 같다: `true`·`y`·`O` 를 적은 작가는 물때를 걸었다고 믿는데, 접어 버리면 그
 * 문은 하루 종일 열려 있고 그 어긋남은 화면 어디에도 흔적을 안 남긴다.
 * 오히려 **물때가 걸렸어야 할 문이 안 걸린 것**이라, 플레이해 봐도 "잘 되네"로
 * 보인다.
 */
function readTideGate(row: Row, ctx: string): boolean {
  const raw = optionalCell(row, 'gateTide')
  if (raw === undefined) return false
  if (raw !== TIDE_MARK) {
    throw new Error(
      `${ctx}: gateTide "${raw}" 는 알 수 없다 — 물때를 지는 문에만 "${TIDE_MARK}" 을 적고 나머지는 비운다 ` +
        `(물이 빠지는 시각은 여기가 아니라 packages/shared/src/time.ts 의 TIDE_WINDOWS 가 정한다)`,
    )
  }
  return true
}

/**
 * 이 문에 게이트가 하나라도 걸렸는가 — 갇힘 방지 검사가 "게이트 없는 문"을 고를 때 쓴다.
 *
 * **`gateSkill` 만 보면 안 되는 이유:** 물때만 걸린 문도 못 지나가는 문이다.
 * 그것을 게이트 없는 문으로 세면, 나오는 문에 물때가 걸린 데이터가 검사를
 * 그대로 통과한다 — 숙련은 캐면 오르지만 시각은 플레이어가 올릴 수 있는
 * 숫자가 아니라, 그 감옥이 더 나쁘다(§9-앞 17).
 */
function isGated(t: TransitionDef): boolean {
  return t.gateSkill !== undefined || t.gateTide === true
}

function toFacing(value: string, ctx: string): Direction | null {
  if (value === '') return null
  if ((DIRECTIONS as readonly string[]).includes(value)) return value as Direction
  throw new Error(`${ctx}: facing "${value}" 는 알 수 없다 (허용값: ${DIRECTIONS.join(', ')}, 또는 빈 칸)`)
}

export function parseTransitions(rows: Row[]): TransitionDef[] {
  return rows.map((row, i) => {
    const ctx = `transitions.csv[${i + 1}행]`
    const def: TransitionDef = {
      fromMap: requireCell(row, 'fromMap', ctx),
      fromX: toInt(requireCell(row, 'fromX', ctx), ctx, 'fromX', 0),
      fromY: toInt(requireCell(row, 'fromY', ctx), ctx, 'fromY', 0),
      toMap: requireCell(row, 'toMap', ctx),
      toX: toInt(requireCell(row, 'toX', ctx), ctx, 'toX', 0),
      toY: toInt(requireCell(row, 'toY', ctx), ctx, 'toY', 0),
      facing: toFacing(row['facing'] ?? '', ctx),
    }
    // 결계다(설계 §2). 레시피의 계열 문턱과 **같은 두 칸·같은 규칙**이라 읽는
    // 함수도 하나다 — 둘 다 적거나 둘 다 비운다. `crafting` 을 막지 않는 것은
    // 레시피와 다른 점이다: 저쪽은 requiredSkill 이 이미 조합의 문이라 두 번째
    // 조합 문턱이 뜻을 잃지만, 문에는 그런 이유가 없다.
    const gate = readGate(row, ctx)
    if (gate) {
      def.gateSkill = gate.skill
      def.gateValue = gate.value
    }
    // 물때는 숙련과 **독립된 조건**이라 짝 규칙에 묶지 않는다(설계 §6). 지금은
    // 허브 결계 하나가 둘을 함께 지지만, 둘 다 적어야 한다고 강제하면 "물때만
    // 지는 문"이 데이터로 표현 불가능해진다 — 그럴 이유가 없다.
    if (readTideGate(row, ctx)) def.gateTide = true
    return def
  })
}

/** 걸어서 서로 오갈 수 있는 칸들의 덩어리 하나. 맵 하나가 여러 개일 수 있다. */
interface Region {
  mapId: string
  /** 그 덩어리를 사람이 짚어 볼 수 있게 하는 칸 하나 — 행 우선 첫 칸이라 늘 같다. */
  sample: { x: number; y: number }
}

const NEIGHBOR_DELTAS: readonly [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]]

/**
 * 맵들을 "걸어서 서로 닿는 칸 덩어리"로 나눈다 — 갇힘 방지 검사의 바탕이다.
 *
 * **왜 맵이 아니라 덩어리인가:** 결계 전환은 `fromMap === toMap` 이다(설계 §3 —
 * 새 맵을 짓지 않고 같은 맵 안에 벽으로 안쪽을 만든다). 맵 단위로만 세면 결계
 * 안팎이 같은 이름 하나로 뭉쳐서, 나오는 문에 게이트가 걸려도 "얼음채집장은
 * 여전히 눈의마을에 닿는다"고 말한다 — 정작 막으려던 사건만 못 본다.
 *
 * **벽만 본다.** 노드·화자·지점이 차지한 칸은 세지 않는다(routeBake 의 걷기
 * 판정과 여기서 갈린다). 몸은 지형이 아니고 일과에 따라 시각마다 움직이므로,
 * 그것까지 세면 "이 세이브가 갇히는가" 라는 빌드의 답이 시계에 따라 달라진다.
 * 이 검사가 묻는 것은 지형과 문이 사람을 가두는가다.
 */
function walkableRegions(terrains: Record<string, MapTerrain>): {
  regions: Region[]
  regionOf: Map<string, number>
} {
  const regions: Region[] = []
  const regionOf = new Map<string, number>()

  // 맵 순서를 정렬해 둔다 — 위반 문구의 차례가 파일 읽기 순서에 흔들리지 않게.
  for (const mapId of Object.keys(terrains).sort()) {
    const terrain = terrains[mapId]!
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        if (terrain.walls.has(`${x},${y}`)) continue
        const start = `${mapId}:${x},${y}`
        if (regionOf.has(start)) continue

        const index = regions.length
        regions.push({ mapId, sample: { x, y } })
        regionOf.set(start, index)

        const stack = [[x, y] as [number, number]]
        while (stack.length > 0) {
          const [cx, cy] = stack.pop()!
          for (const [dx, dy] of NEIGHBOR_DELTAS) {
            const nx = cx + dx
            const ny = cy + dy
            if (nx < 0 || ny < 0 || nx >= terrain.width || ny >= terrain.height) continue
            if (terrain.walls.has(`${nx},${ny}`)) continue
            const key = `${mapId}:${nx},${ny}`
            if (regionOf.has(key)) continue
            regionOf.set(key, index)
            stack.push([nx, ny])
          }
        }
      }
    }
  }

  return { regions, regionOf }
}

/** 문 하나를 CSV 작가가 찾아갈 수 있는 꼴로 적는다. 같은 맵 안이면 맵 이름은 한 번만. */
function doorLabel(t: TransitionDef): string {
  const to = t.fromMap === t.toMap ? `(${t.toX}, ${t.toY})` : `${t.toMap} (${t.toX}, ${t.toY})`
  // 걸린 조건을 전부 적는다 — 하나만 적으면 작가가 지운 게이트 옆에 남은
  // 다른 게이트를 못 보고 같은 위반을 두 번 고치게 된다.
  const conditions: string[] = []
  if (t.gateSkill !== undefined) conditions.push(`${t.gateSkill} ${t.gateValue}`)
  if (t.gateTide === true) conditions.push('물때')
  const gate = conditions.length > 0 ? ` [게이트 ${conditions.join(' + ')}]` : ''
  return `${t.fromMap} (${t.fromX}, ${t.fromY})→${to}${gate}`
}

function push(m: Map<number, number[]>, from: number, to: number): void {
  const list = m.get(from)
  if (list) list.push(to)
  else m.set(from, [to])
}

function grow(seeds: Iterable<number>, edges: ReadonlyMap<number, number[]>): Set<number> {
  const seen = new Set<number>(seeds)
  const stack = [...seen]
  while (stack.length > 0) {
    const cur = stack.pop()!
    for (const next of edges.get(cur) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(next)
    }
  }
  return seen
}

/**
 * 갇힘 방지 — **게이트가 걸린 문 뒤에서 되돌아 나올 수 있는가**(설계 §9-앞 16).
 *
 * 도달 가능성을 두 번 센다. 한 번은 **모든** 전환으로(플레이어가 실제로 설 수
 * 있는 자리가 어디까지인가), 한 번은 **게이트 없는 전환만**으로 거꾸로(그 자리에서
 * 시작 칸까지 문턱 없이 걸어 나올 수 있는가). 앞의 것에 있고 뒤의 것에 없는
 * 덩어리가 곧 감옥이다.
 *
 * **왜 이것이 없으면 안 되는가:** `resolvePlayerLocation`(shared/location.ts)은
 * 맵이 실재하는지와 좌표가 범위 안인지만 본다 — 결계 안에 서 있는 세이브는
 * 그 두 검사를 멀쩡히 통과하므로 아무도 구제해 주지 않는다. 오늘의 데이터는
 * 나오는 문이 열려 있어 괜찮지만, 밸런스를 잡느라 `gateValue` 를 85,000 →
 * 200,000 으로 올리는 날 그 사이 숙련의 플레이어는 자기 세이브 안에 영구히
 * 갇힌다. 그 날을 빌드가 대신 기억한다.
 */
function collectTrapViolations(
  data: GameData,
  terrains: Record<string, MapTerrain>,
): string[] {
  const { regions, regionOf } = walkableRegions(terrains)
  const regionAt = (mapId: string, x: number, y: number): number | undefined =>
    regionOf.get(`${mapId}:${x},${y}`)

  // 시작 맵이 등록부에 없으면 부르는 쪽이 이미 거기서 멈췄다 — 그래도 여기서
  // 다시 보는 이유는 이 함수가 그 순서에 기대어 서 있다는 사실을 타입으로
  // 적어 두기 위해서다.
  const startMap = data.maps[START_MAP_ID]
  if (!startMap) return []
  // 시작 칸이 벽이거나 맵 밖이면 validateMapSpawns 가 그것 하나를 말한다.
  // 여기서 또 말하면 같은 실수로 위반이 둘 생기고, 이 검사의 답은 어차피 없다.
  const home = regionAt(START_MAP_ID, startMap.spawn.x, startMap.spawn.y)
  if (home === undefined) return []

  const forward = new Map<number, number[]>()
  const backwardUngated = new Map<number, number[]>()
  /** 덩어리별로 그것에 드나드는 문 — 위반 문구가 작가에게 짚어 줄 자리다. */
  const entering = new Map<number, TransitionDef[]>()
  const leaving = new Map<number, TransitionDef[]>()

  for (const t of data.transitions) {
    const from = regionAt(t.fromMap, t.fromX, t.fromY)
    const to = regionAt(t.toMap, t.toX, t.toY)
    // 벽이거나 맵 밖인 칸을 가리키는 전환은 위에서 이미 말했다.
    if (from === undefined || to === undefined || from === to) continue

    push(forward, from, to)
    if (!isGated(t)) push(backwardUngated, to, from)

    const enters = entering.get(to)
    if (enters) enters.push(t)
    else entering.set(to, [t])
    const leaves = leaving.get(from)
    if (leaves) leaves.push(t)
    else leaving.set(from, [t])
  }

  const reachable = grow([home], forward)
  const canReturn = grow([home], backwardUngated)

  const violations: string[] = []
  for (const index of [...reachable].sort((a, b) => a - b)) {
    if (canReturn.has(index)) continue
    const region = regions[index]!
    const inDoors = entering.get(index) ?? []
    const outDoors = leaving.get(index) ?? []
    violations.push(
      `maps[${region.mapId}] (${region.sample.x}, ${region.sample.y}) 구역: 여기 들어온 플레이어는 ` +
        `게이트 없는 문만으로는 시작 맵 "${START_MAP_ID}" 로 돌아올 수 없다 — 그 사이 숙련의 세이브가 갇힌다 ` +
        `(resolvePlayerLocation 은 맵과 좌표 범위만 보므로 구제하지 못한다). ` +
        `들어가는 문: ${inDoors.map(doorLabel).join(' / ') || '없다'}. ` +
        `나가는 문: ${outDoors.map(doorLabel).join(' / ') || '없다'}. ` +
        `게이트는 들어가는 문에만 걸고 나오는 문은 gateSkill·gateValue·gateTide 를 모두 비운다`,
    )
  }
  return violations
}

/**
 * 결계 뒤 칸들을 굽는다 — 서버가 "지금 그 안에 있는가"에 답할 재료다(설계 §9-앞 18).
 *
 * **갇힘 방지 검사(collectTrapViolations)와 같은 두 계산의 앞뒤 짝이다.** 저쪽은
 * 게이트 없는 문만으로 **거꾸로** 넓혀 "여기서 나올 수 있는가"를 묻고, 여기는
 * 같은 문들로 **앞으로** 넓혀 "여기 들어오는 데 게이트가 필요했는가"를 묻는다.
 * 그래서 결계 뒤의 정의는 좌표를 손으로 적은 목록이 아니라 지형과 문이 함께
 * 만든 사실이고, 벽이나 게이트를 옮기면 이 산출물이 따라 움직인다 — CSV 에
 * 결계를 하나 더 그리는 날 아무도 이 함수를 고치러 오지 않아도 된다.
 *
 * **왜 배치가 아니라 칸을 굽는가:** 서버가 물어야 하는 것은 노드 쪽만이 아니다.
 * "이 노드가 결계 뒤인가" 와 "이 사람이 그 안에 있는가" 는 같은 구역 목록에
 * 물어야 하고, 사람이 서는 자리는 노드가 놓인 칸이 아니다(전환 도착 칸이다).
 *
 * 시작 맵이나 시작 칸이 성립하지 않으면 **빈 목록**이다 — 그 한 줄은
 * validateTransitions·validateMapSpawns 가 이미 말하므로 여기서 또 말하지
 * 않는다. 빌드는 어차피 그 위반에서 멈춘다.
 */
export function bakeBarrierRegions(
  data: GameData,
  terrains: Record<string, MapTerrain>,
): BarrierRegions {
  const { regions, regionOf } = walkableRegions(terrains)

  const startMap = data.maps[START_MAP_ID]
  if (!startMap) return []
  const home = regionOf.get(`${START_MAP_ID}:${startMap.spawn.x},${startMap.spawn.y}`)
  if (home === undefined) return []

  // 게이트 없는 문만 잇는다. 게이트가 걸린 문은 아예 간선으로 놓지 않으므로,
  // 그 문 하나로만 닿는 덩어리는 아래 `free` 에 들어오지 못한다.
  const ungated = new Map<number, number[]>()
  for (const t of data.transitions) {
    if (isGated(t)) continue
    const from = regionOf.get(`${t.fromMap}:${t.fromX},${t.fromY}`)
    const to = regionOf.get(`${t.toMap}:${t.toX},${t.toY}`)
    if (from === undefined || to === undefined || from === to) continue
    push(ungated, from, to)
  }
  const free = grow([home], ungated)

  // 칸은 덩어리 번호에서 되짚는다 — walkableRegions 가 칸마다 번호를 이미
  // 적어 두었으므로, 그것을 뒤집는 것이 같은 순회를 한 번 더 도는 것보다 싸다.
  const cellsOf = new Map<number, string[]>()
  for (const [key, index] of regionOf) {
    if (free.has(index)) continue
    // key 는 `mapId:x,y` 다. 맵 이름에 콜론이 없다는 보장이 없으므로 **뒤에서**
    // 자른다 — 좌표 쪽에는 콜론이 못 들어간다.
    const cut = key.lastIndexOf(':')
    const list = cellsOf.get(index)
    if (list) list.push(key.slice(cut + 1))
    else cellsOf.set(index, [key.slice(cut + 1)])
  }

  // 덩어리 번호 순으로 낸다 — walkableRegions 가 맵 이름을 정렬해 도므로,
  // 같은 데이터에서 같은 파일이 나온다(diff 가 흔들리지 않는다).
  return [...cellsOf.keys()]
    .sort((a, b) => a - b)
    .map((index) => ({ mapId: regions[index]!.mapId, cells: cellsOf.get(index)! }))
}

/**
 * 전환을 검증한다. 지형이 필요해서 validateGameData 와 나뉜다 —
 * validateSpeakerPlacements 와 같은 이유다.
 */
export function validateTransitions(
  data: GameData,
  terrains: Record<string, MapTerrain>,
): string[] {
  const violations: string[] = []
  const at = (t: TransitionDef): string => `transitions[${t.fromMap} (${t.fromX}, ${t.fromY})]`

  const seen = new Map<string, TransitionDef>()

  for (const t of data.transitions) {
    for (const [role, mapId] of [['출발', t.fromMap], ['도착', t.toMap]] as const) {
      if (!data.maps[mapId]) {
        violations.push(`${at(t)}: ${role} 맵 "${mapId}" 이 maps.csv 에 없다`)
      }
    }
    if (!data.maps[t.fromMap] || !data.maps[t.toMap]) continue

    const fromKey = `${t.fromMap}:${t.fromX},${t.fromY}`
    if (seen.has(fromKey)) {
      violations.push(`${at(t)}: 같은 칸에서 출발하는 전환이 둘이다 — 무엇이 이길지 정해지지 않는다`)
    }
    seen.set(fromKey, t)

    const from = terrains[t.fromMap]
    const to = terrains[t.toMap]
    if (!from || !to) continue

    if (t.fromX < 0 || t.fromY < 0 || t.fromX >= from.width || t.fromY >= from.height) {
      violations.push(`${at(t)}: 출발 칸이 맵 밖이다 — ${t.fromMap} 은 ${from.width}×${from.height} 칸이다`)
    } else if (from.walls.has(`${t.fromX},${t.fromY}`)) {
      // 맵 안이어도 벽이면 결과는 맵 밖과 같다 — 그 칸에 설 수 없으니 아무도
      // 밟을 수 없고, 전환은 검증을 통과한 채 조용히 죽어 있는다. 도착 칸만
      // 보던 시절엔 이 데이터가 그냥 통과했다. 실제로 이 계획의 첫 예시 좌표가
      // 그런 칸이었고, 도착 칸 검사에 우연히 걸려서야 드러났다.
      violations.push(
        `${at(t)}: 출발 칸 (${t.fromX}, ${t.fromY}) 이 벽이다 — 아무도 그 칸에 설 수 없어 이 전환은 밟히지 않는다. ${t.fromMap} 의 빈 칸으로 옮긴다`,
      )
    }
    if (t.toX < 0 || t.toY < 0 || t.toX >= to.width || t.toY >= to.height) {
      violations.push(`${at(t)}: 도착 칸 (${t.toX}, ${t.toY}) 이 맵 밖이다 — ${t.toMap} 은 ${to.width}×${to.height} 칸이다`)
      continue
    }
    if (to.walls.has(`${t.toX},${t.toY}`)) {
      violations.push(
        `${at(t)}: 도착 칸 (${t.toX}, ${t.toY}) 이 벽이다 — 넘어가자마자 벽 속에 낀다. ${t.toMap} 의 빈 칸으로 옮긴다`,
      )
    }
    const node = Object.values(data.placements).find(
      (p) => p.mapId === t.toMap && p.x === t.toX && p.y === t.toY,
    )
    if (node) {
      violations.push(`${at(t)}: 도착 칸에 노드 ${node.instanceId} 이 있다 — 노드 칸에는 설 수 없다`)
    }
  }

  // 시작 맵이 실재하는지가 먼저다. START_MAP_ID 는 코드 상수이고 maps.csv 는
  // 데이터라, 맵 id 를 개명하면 둘이 갈라진다. 그때 아래 도달 가능성 검사를
  // 그대로 돌리면 **모든 맵**이 "시작 맵 world 에서 걸어서 닿을 수 없다" 라고
  // 말한다 — 있지도 않은 맵의 이름을 대면서. 진짜 원인은 한 줄이고 나머지는
  // 전부 그 한 줄의 그림자라, validate.ts 가 참조 위반이 있으면 도달 가능성
  // 계산을 미루는 것과 같은 저울로 여기서 멈춘다.
  if (!data.maps[START_MAP_ID]) {
    violations.push(
      `maps: 시작 맵 "${START_MAP_ID}" 가 maps.csv 에 없다 — 새 플레이어가 시작하고 도달 가능성 ` +
        `검사가 출발하는 맵이다. maps.csv 에 id 가 "${START_MAP_ID}" 인 행을 두거나, ` +
        `맵 이름을 바꿨다면 packages/data/src/maps.ts 의 START_MAP_ID 도 함께 바꾼다`,
    )
    return violations
  }

  // 시작 맵에서 걸어서 닿는 맵을 넓혀 간다. 못 닿는 맵은 만들어도 아무도 못 본다.
  const reachable = new Set<string>([START_MAP_ID])
  let grew = true
  while (grew) {
    grew = false
    for (const t of data.transitions) {
      if (reachable.has(t.fromMap) && !reachable.has(t.toMap)) {
        reachable.add(t.toMap)
        grew = true
      }
    }
  }
  for (const mapId of Object.keys(data.maps)) {
    if (!reachable.has(mapId)) {
      violations.push(
        `maps[${mapId}]: 시작 맵 "${START_MAP_ID}" 에서 걸어서 닿을 수 없다 — transitions.csv 에 길을 낸다`,
      )
    }
  }

  // 그리고 같은 것을 한 번 더, **게이트를 아는 채로** 센다. 위의 것은 맵 단위라
  // 결계(fromMap === toMap)를 아예 보지 못한다.
  violations.push(...collectTrapViolations(data, terrains))

  return violations
}
