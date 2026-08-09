import type { NodeDef, NodePlacement } from '@nogada/shared'

interface TiledProperty {
  name: string
  value: unknown
}

interface TiledObject {
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
 */
export function parseTerrain(mapJson: unknown): MapTerrain {
  const map = mapJson as TiledMap
  const width = map.width ?? 0
  const height = map.height ?? 0
  if (width <= 0 || height <= 0) {
    throw new Error('맵에 칸 수(width·height)가 없다')
  }

  const layer = map.layers?.find((l) => l.name === 'walls' && l.type === 'tilelayer')
  const tiles = layer?.data ?? []

  const walls = new Set<string>()
  tiles.forEach((tile, index) => {
    if (!tile) return // 0 은 "타일 없음" — 여기까지 벽으로 세면 맵 전체가 벽이 된다
    walls.add(`${index % width},${Math.floor(index / width)}`)
  })

  return { width, height, walls }
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
