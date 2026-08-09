import type { NodeDef, NodePlacement, TilePos } from '@nogada/shared'

/**
 * 클라이언트가 맵마다 이름으로 찾는 타일 레이어. 없으면 `WorldScene.create` 가
 * 그 자리에서 던진다 — 그래서 빌드도 같은 것을 요구한다.
 *
 * `decor`·`overhead` 는 여기 없다. 장식이 없는 맵도 정상이라 클라이언트가
 * 있으면 그리고 없으면 넘어간다.
 */
export const GROUND_LAYER = 'ground'
export const WALLS_LAYER = 'walls'

/** 맵의 시작 칸을 적어 두는 오브젝트 레이어와 그 안의 오브젝트 이름. */
const SPAWN_LAYER = 'spawn'
const SPAWN_OBJECT = 'player'

interface TiledProperty {
  name: string
  value: unknown
}

interface TiledObject {
  name?: string
  x?: number
  y?: number
  properties?: TiledProperty[]
}

interface TiledLayer {
  name?: string
  type?: string
  objects?: TiledObject[]
  /** 타일 레이어의 타일 id 를 행 우선으로 늘어놓은 배열. 0 은 "타일 없음"이다. */
  data?: number[]
}

interface TiledMap {
  width?: number
  height?: number
  tilewidth?: number
  tileheight?: number
  layers?: TiledLayer[]
}

/**
 * 맵에서 "칸이 있는가·그 칸이 벽인가"만 뽑아낸 것.
 *
 * 배치 데이터(speakers.csv)는 맵 파일과 따로 있어서, 좌표가 벽 속이나 맵 밖을
 * 가리켜도 두 파일 중 어느 쪽도 혼자서는 그것을 알 수 없다 — 검증이 둘을
 * 맞대 보려면 이 최소한의 지형 정보가 필요하다.
 */
export interface MapTerrain {
  width: number
  height: number
  /** 벽이 있는 칸의 `"x,y"` 키. */
  walls: ReadonlySet<string>
}

/**
 * Tiled 맵에서 크기와 벽 칸을 뽑는다.
 *
 * 벽의 기준은 클라이언트의 걷기 판정과 같아야 한다 — `walls` 레이어의 비어
 * 있지 않은 타일이 벽이다(apps/client 의 WorldScene 참고). 여기서 다른 기준을
 * 쓰면 빌드는 통과하는데 실제로는 못 가는 자리가 생긴다.
 *
 * **없는 레이어를 빈 것으로 넘기지 않는다.** `walls` 가 없을 때 빈 집합을
 * 돌려주면 그 맵을 향한 벽 검사가 **전부 통과한다** — "도착 칸이 벽이다",
 * "화자가 벽 칸에 놓였다" 가 조용히 참이 되어, 안전망이 하필 작가가 실수한
 * 맵에서만 사라진다. 레이어 하나가 없는 것보다 그쪽이 나쁘다.
 */
export function parseTerrain(mapJson: unknown): MapTerrain {
  const map = mapJson as TiledMap
  const width = map.width ?? 0
  const height = map.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new Error('맵에 칸 수(width·height)가 없다')
  }

  const ground = map.layers?.find((l) => l.name === GROUND_LAYER && l.type === 'tilelayer')
  if (!ground) {
    throw new Error(
      `맵에 "${GROUND_LAYER}" 타일 레이어가 없다 — 바닥을 그리는 레이어다. ` +
        `Tiled 에서 Tile Layer 를 만들고 이름을 "${GROUND_LAYER}" 으로 둔다`,
    )
  }

  const layer = map.layers?.find((l) => l.name === WALLS_LAYER && l.type === 'tilelayer')
  if (!layer) {
    throw new Error(
      `맵에 "${WALLS_LAYER}" 타일 레이어가 없다 — 못 지나가는 칸을 그리는 레이어다. ` +
        `비어 있어도 되지만 레이어 자체는 있어야 한다: 없으면 이 맵의 벽 검사가 ` +
        `("도착 칸이 벽이다", "화자가 벽 칸에 놓였다") 전부 통과해 버린다. ` +
        `Tiled 에서 Tile Layer 를 만들고 이름을 "${WALLS_LAYER}" 으로 둔다`,
    )
  }
  const tiles = layer.data ?? []

  const walls = new Set<string>()
  tiles.forEach((tile, index) => {
    if (!tile) return // 0 은 "타일 없음" — 여기까지 벽으로 세면 맵 전체가 벽이 된다
    walls.add(`${index % width},${Math.floor(index / width)}`)
  })

  return { width, height, walls }
}

/**
 * 맵의 시작 칸을 뽑는다 — `spawn` 오브젝트 레이어의 `player` 오브젝트.
 *
 * **왜 이것이 시작 칸의 유일한 출처인가:** 예전엔 (15, 16) 이 서버·프로토콜·
 * 시뮬레이터 세 곳에 글자로 박혀 있었다. 셋을 서로 묶는 테스트는 있었지만
 * **맵에 묶는 것은 아무것도 없어서**, 그 칸에 벽을 그리면 새 플레이어가 전부
 * 벽 속에서 시작했다. 맵 옆에 있고 Tiled 에서 눈에 보이는 이 오브젝트가 그
 * 사실이 있어야 할 자리다 — 맵을 고쳐 그리면 시작 칸이 따라 움직인다.
 *
 * 좌표 계산은 parsePlacements 와 같다(반올림이 아니라 내림). 어느 맵인지는
 * 메시지에 적지 않는다 — parseMaps 가 맵마다 그것을 앞에 붙인다.
 */
export function parseSpawn(mapJson: unknown): TilePos {
  const map = mapJson as TiledMap
  const tileWidth = map.tilewidth ?? 0
  const tileHeight = map.tileheight ?? 0
  if (tileWidth <= 0 || tileHeight <= 0) {
    throw new Error('맵에 타일 크기가 없다')
  }

  const layer = map.layers?.find((l) => l.name === SPAWN_LAYER && l.type === 'objectgroup')
  const spawn = layer?.objects?.find((o) => o.name === SPAWN_OBJECT)
  if (!spawn) {
    throw new Error(
      `맵에 시작 칸이 없다 — Tiled 에서 "${SPAWN_LAYER}" 오브젝트 레이어를 만들고, ` +
        `그 안에 이름이 "${SPAWN_OBJECT}" 인 오브젝트를 시작할 칸에 하나 찍는다. ` +
        `새 플레이어가 서는 자리이고, 세이브가 없어진 맵을 가리킬 때 돌아오는 자리다`,
    )
  }

  return {
    x: Math.floor((spawn.x ?? 0) / tileWidth),
    y: Math.floor((spawn.y ?? 0) / tileHeight),
  }
}

function propOf(obj: TiledObject, name: string): string | undefined {
  const found = obj.properties?.find((p) => p.name === name)
  return typeof found?.value === 'string' ? found.value : undefined
}

/**
 * Tiled 맵의 `nodes` 오브젝트 레이어에서 노드 배치를 뽑는다.
 *
 * 오브젝트는 타일 중심의 픽셀 좌표를 갖는다. 나누기로 타일 좌표를 얻는데,
 * 반올림이 아니라 내림을 쓴다 — 중심이 정확히 타일 안에 있으므로 내림이
 * 항상 그 타일을 준다.
 *
 * `mapId` 를 받는 것은 배치마다 "어느 맵의 칸인가"를 새기기 위해서다. 겹침
 * 검사는 **이 맵 안에서만** 한다 — `occupied` 가 호출마다 새로 만들어지므로
 * 그 자체로 맵별 검사다. 맵을 넘어선 instanceId 유일성은 parseMaps 의 몫이다:
 * 서버는 instanceId 하나로 노드를 찾으므로(gatherService) 그쪽은 전역이어야 한다.
 */
export function parsePlacements(
  mapJson: unknown,
  nodes: Record<string, NodeDef>,
  mapId: string,
): Record<string, NodePlacement> {
  const map = mapJson as TiledMap
  const tileWidth = map.tilewidth ?? 0
  const tileHeight = map.tileheight ?? 0
  if (tileWidth <= 0 || tileHeight <= 0) {
    throw new Error('맵에 타일 크기가 없다')
  }

  const layer = map.layers?.find((l) => l.name === 'nodes' && l.type === 'objectgroup')
  const objects = layer?.objects ?? []

  const placements: Record<string, NodePlacement> = {}
  const occupied = new Map<string, string>()

  for (const obj of objects) {
    const nodeId = propOf(obj, 'nodeId')
    if (!nodeId) continue

    const instanceId = propOf(obj, 'instanceId')
    if (!instanceId) {
      throw new Error(`노드 ${nodeId} 에 instanceId 가 없다`)
    }
    if (placements[instanceId]) {
      throw new Error(`instanceId 가 겹친다: ${instanceId}`)
    }
    if (!nodes[nodeId]) {
      throw new Error(`${instanceId} 이 없는 노드를 가리킨다: ${nodeId}`)
    }

    const x = Math.floor((obj.x ?? 0) / tileWidth)
    const y = Math.floor((obj.y ?? 0) / tileHeight)

    const key = `${x},${y}`
    const other = occupied.get(key)
    if (other) {
      throw new Error(`${other} 와 ${instanceId} 이 맵 ${mapId} 의 같은 칸에 있다: (${x}, ${y})`)
    }
    occupied.set(key, instanceId)

    placements[instanceId] = { instanceId, nodeId, mapId, x, y }
  }

  return placements
}
