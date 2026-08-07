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
}

interface TiledMap {
  tilewidth?: number
  tileheight?: number
  layers?: TiledLayer[]
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
 */
export function parsePlacements(
  mapJson: unknown,
  nodes: Record<string, NodeDef>,
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
      throw new Error(`${other} 와 ${instanceId} 이 같은 칸에 있다: (${x}, ${y})`)
    }
    occupied.set(key, instanceId)

    placements[instanceId] = { instanceId, nodeId, x, y }
  }

  return placements
}
