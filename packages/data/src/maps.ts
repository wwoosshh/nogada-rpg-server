import type { MapDef, NodeDef, NodePlacement } from '@nogada/shared'
import { addUnique, requireCell } from './parse.js'
import { type MapTerrain, parsePlacements, parseTerrain } from './placements.js'
import { parseTmx } from './tmx.js'

type Row = Record<string, string>

export interface ParsedMaps {
  maps: Record<string, MapDef>
  /** 맵별 지형. 빌드 시점의 검증에만 쓰고 GameData 로 넘기지 않는다. */
  terrains: Record<string, MapTerrain>
  /** 모든 맵의 배치를 합친 것. instanceId 는 맵을 넘어 유일하다. */
  placements: Record<string, NodePlacement>
}

/**
 * maps.csv 와 그것이 가리키는 맵 파일들을 읽는다.
 *
 * 맵 파일 읽기를 인자로 받는 것은 테스트가 파일 시스템 없이 돌기 위해서다 —
 * 이 파일의 책임은 "여러 맵을 하나로 모으는 것" 이지 파일을 찾는 것이 아니다.
 */
export function parseMaps(
  rows: Row[],
  readMapFile: (file: string) => string,
  nodes: Record<string, NodeDef>,
): ParsedMaps {
  const maps: Record<string, MapDef> = {}
  const terrains: Record<string, MapTerrain> = {}
  const placements: Record<string, NodePlacement> = {}

  for (const row of rows) {
    const id = requireCell(row, 'id', 'maps.csv')
    const ctx = `maps.csv[${id}]`
    const file = requireCell(row, 'file', ctx)

    const xml = readMapFile(file)
    if (!xml) throw new Error(`${ctx}: 맵 파일 "${file}" 을 읽지 못했다`)

    const mapJson = parseTmx(xml)
    const terrain = parseTerrain(mapJson)

    addUnique(maps, id, {
      id,
      name: requireCell(row, 'name', ctx),
      file,
      width: terrain.width,
      height: terrain.height,
    }, 'maps.csv')
    terrains[id] = terrain

    for (const [instanceId, placement] of Object.entries(parsePlacements(mapJson, nodes, id))) {
      // instanceId 는 맵을 넘어 유일해야 한다 — 서버는 그것 하나로 노드를 찾는다.
      if (placements[instanceId]) {
        throw new Error(`maps.csv: instanceId "${instanceId}" 가 여러 맵에 있다`)
      }
      placements[instanceId] = placement
    }
  }

  return { maps, terrains, placements }
}
