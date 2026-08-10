import { DIRECTIONS, type Direction, type GameData, type PlaceDef } from '@nogada/shared'
import type { MapTerrain } from './placements.js'
import type { TiledMapJson, TiledObjectJson } from './tmx.js'

/**
 * 지점을 적어 두는 오브젝트 레이어. `spawn`·`nodes` 와 같은 문법이다 —
 * 오브젝트 이름이 지점 id 이고, 속성으로 `indoor`·`facing` 을 단다.
 *
 * 이 레이어가 없는 맵은 정상이다. 일과를 사는 NPC 가 있는 맵에만 있으면 된다.
 */
const PLACES_LAYER = 'places'

function propOf(obj: TiledObjectJson, name: string): string | undefined {
  return obj.properties?.find((p) => p.name === name)?.value
}

/**
 * Tiled 의 bool 속성을 읽는다. Tiled 는 그것을 "true"/"false" 글자로 적는다 —
 * 그대로 Boolean() 에 넣으면 "false" 가 참이 되어 밤에도 안 사라지는 NPC 가 된다.
 */
function toIndoor(raw: string | undefined, ctx: string): boolean {
  if (raw === undefined) return false
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  throw new Error(`${ctx}: indoor "${raw}" 를 알 수 없다 — Tiled 에서 bool 속성으로 두면 true/false 가 된다`)
}

function toFacing(raw: string | undefined, ctx: string): Direction | null {
  if (raw === undefined || raw === '') return null
  if ((DIRECTIONS as readonly string[]).includes(raw)) return raw as Direction
  throw new Error(
    `${ctx}: facing "${raw}" 를 알 수 없다 (허용값: ${DIRECTIONS.join(', ')}, 또는 속성을 아예 두지 않는다)`,
  )
}

/**
 * 맵의 `places` 오브젝트 레이어에서 지점을 뽑는다.
 *
 * 좌표 계산은 parseSpawn·parsePlacements 와 같다(반올림이 아니라 내림) —
 * 오브젝트 중심이 타일 안에 있으므로 내림이 항상 그 타일을 준다.
 *
 * 어느 맵인지는 메시지에 적지 않는다. parseMaps 가 맵마다 그것을 앞에 붙인다.
 */
export function parsePlaces(map: TiledMapJson, mapId: string): Record<string, PlaceDef> {
  const layer = map.layers.find((l) => l.name === PLACES_LAYER && l.type === 'objectgroup')
  const objects = layer?.objects ?? []

  const places: Record<string, PlaceDef> = {}

  for (const obj of objects) {
    const x = Math.floor(obj.x / map.tilewidth)
    const y = Math.floor(obj.y / map.tileheight)

    const id = obj.name ?? ''
    if (id === '') {
      throw new Error(
        `${PLACES_LAYER} 레이어의 (${x}, ${y}) 오브젝트에 이름이 없다 — 오브젝트 이름이 곧 지점 id 이고, ` +
          `일과(.sched)가 그 이름으로 이 자리를 부른다`,
      )
    }
    const ctx = `지점 "${id}"`

    if (places[id]) {
      throw new Error(`${ctx} 가 한 맵에 두 번 있다 — 뒤엣것이 앞엣것을 덮어써서 일과가 어느 자리를 뜻하는지 알 수 없다`)
    }
    // 같은 **칸**에 둘인 것은 여기서 보지 않는다 — 벽·노드·전환 칸과 함께
    // validatePlaces 가 한 목록으로 모아 보고한다. 파싱 오류는 한 건만 말하고
    // 멈추므로, 자리 문제를 여기서 던지면 나머지 자리 문제를 다음 빌드에서야 만난다.

    places[id] = {
      id,
      mapId,
      x,
      y,
      indoor: toIndoor(propOf(obj, 'indoor'), ctx),
      facing: toFacing(propOf(obj, 'facing'), ctx),
    }
  }

  return places
}

/**
 * 지점이 정말로 설 수 있는 칸에 있는지 검사한다.
 *
 * 지형이 필요해서 validateGameData 와 나뉜다 — validateSpeakerPlacements 와
 * 같은 이유이고 같은 모양이다. 파서와 나란히 두는 것은 transitions.ts 의
 * 선례를 따른 것이다: 같은 데이터를 읽는 두 가지 일(파싱·검증)이 갈라져
 * 있으면 한쪽만 고치기 쉽다.
 *
 * 서 있는 NPC 는 몸이 있다(설계 §1) — 그래서 이 검사는 화자·시작 칸에
 * 걸던 것과 정확히 같은 것을 묻는다: 그 칸을 차지해도 되는가.
 */
export function validatePlaces(data: GameData, terrains: Record<string, MapTerrain>): string[] {
  const violations: string[] = []

  const nodeAt = new Map<string, string>()
  for (const p of Object.values(data.placements)) {
    nodeAt.set(`${p.mapId}:${p.x},${p.y}`, p.instanceId)
  }

  // 일과가 있는 화자는 speakers.csv 의 칸에 서 있지 않다 — 그 좌표는 이제
  // 스프라이트의 첫 자리일 뿐이고, 진짜 자리는 시각이 정한다. 그 칸을
  // "화자가 차지한 칸"으로 세면 자기 지점을 자기가 막았다고 말하게 된다.
  const speakerAt = new Map<string, string>()
  for (const s of Object.values(data.speakers)) {
    if (data.schedules[s.id]) continue
    speakerAt.set(`${s.mapId}:${s.x},${s.y}`, s.id)
  }

  const placeAt = new Map<string, string>()
  const transitionFrom = new Map<string, string>()
  const transitionTo = new Map<string, string>()
  for (const t of data.transitions) {
    transitionFrom.set(`${t.fromMap}:${t.fromX},${t.fromY}`, t.toMap)
    transitionTo.set(`${t.toMap}:${t.toX},${t.toY}`, t.fromMap)
  }

  for (const place of Object.values(data.places)) {
    const at = `places[${place.id}]`
    const where = `${place.mapId} 의 (${place.x}, ${place.y})`
    const move = `맵 파일의 ${PLACES_LAYER} 레이어에서 이 오브젝트를 빈 칸으로 옮긴다`
    const terrain = terrains[place.mapId]
    if (!terrain) continue // 지점은 맵에서 나오므로 맵이 없을 수 없다

    const key = `${place.mapId}:${place.x},${place.y}`

    if (place.x < 0 || place.y < 0 || place.x >= terrain.width || place.y >= terrain.height) {
      violations.push(
        `${at}: ${where} 은 맵 밖이다 — ${place.mapId} 은 가로 ${terrain.width}, 세로 ${terrain.height} 칸이다. ${move}`,
      )
      continue // 맵 밖이면 벽인지 노드인지 따질 칸 자체가 없다
    }

    if (terrain.walls.has(`${place.x},${place.y}`)) {
      violations.push(`${at}: ${where} 이 벽이다 — 벽 속에 서 있는 셈이라 말을 걸 수도 없다. ${move}`)
    }

    const node = nodeAt.get(key)
    if (node) {
      violations.push(`${at}: ${where} 에 노드 ${node} 이 있다 — 노드 칸에는 설 수 없고, 그 칸을 향했을 때 어느 쪽이 반응할지 정해지지 않는다. ${move}`)
    }

    const speaker = speakerAt.get(key)
    if (speaker) {
      violations.push(`${at}: ${where} 에 화자 ${speaker} 가 서 있다 — 둘이 겹치면 말을 걸었을 때 누가 답할지 정해지지 않는다. ${move}`)
    }

    const other = placeAt.get(key)
    if (other) {
      violations.push(`${at}: 지점 ${other} 와 같은 칸 ${where} 에 있다 — 한 칸에는 한 명만 설 수 있다. ${move}`)
    }
    placeAt.set(key, place.id)

    const doorTo = transitionFrom.get(key)
    if (doorTo) {
      violations.push(
        `${at}: ${where} 은 ${doorTo} 으로 넘어가는 전환 칸이다 — 여기 서 있는 NPC 가 문을 봉쇄한다. ${move}`,
      )
    }

    const doorFrom = transitionTo.get(key)
    if (doorFrom) {
      violations.push(
        `${at}: ${where} 은 ${doorFrom} 에서 넘어오는 도착 칸이다 — 넘어온 사람이 NPC 위에 서게 된다. ${move}`,
      )
    }
  }

  return violations
}
