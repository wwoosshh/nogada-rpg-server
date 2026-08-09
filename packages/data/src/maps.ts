import type { GameData, MapDef, NodeDef, NodePlacement, PlayerLocation } from '@nogada/shared'
import { addUnique, requireCell } from './parse.js'
import { type MapTerrain, parsePlacements, parseSpawn, parseTerrain } from './placements.js'
import { type TiledMapJson, parseTmx } from './tmx.js'

type Row = Record<string, string>

/**
 * 시작 맵. 새 플레이어가 시작하는 곳이고, 도달 가능성 검사의 출발점이며,
 * 세이브가 없어진 맵을 가리킬 때 돌아오는 곳이다.
 *
 * 맵 등록부와 같은 파일에 둔다 — 이 상수가 뜻을 갖는 것은 오직 `maps.csv` 에
 * 같은 id 의 행이 있을 때뿐이라서다. 둘이 갈라지면(맵 id 개명) 빌드가
 * validateTransitions 에서 그것 하나를 짚어 말한다.
 */
export const START_MAP_ID = 'world'

/**
 * 새 플레이어가 시작하는 자리 — 시작 맵의 `spawn` 오브젝트가 가리키는 칸.
 *
 * 좌표를 코드에 적지 않는 이유는 이 함수의 존재 이유 그 자체다: 시작 칸은
 * 맵 파일에 그려져 있고, 맵을 고쳐 그리면 여기가 자동으로 따라간다. 예전엔
 * (15, 16) 이 서버·프로토콜·시뮬레이터 세 곳에 박혀 있어서, 그 칸에 벽을
 * 그리면 새 플레이어가 전부 벽 속에서 시작했다.
 */
export function startLocation(data: GameData): PlayerLocation {
  const map = data.maps[START_MAP_ID]
  // 빌드가 이미 막았다(validateTransitions) — 여기 닿았다면 데이터가 어긋난 것이다.
  if (!map) throw new Error(`시작 맵 "${START_MAP_ID}" 이 등록부에 없다`)
  return { mapId: START_MAP_ID, x: map.spawn.x, y: map.spawn.y }
}

export interface ParsedMaps {
  maps: Record<string, MapDef>
  /** 맵별 지형. 빌드 시점의 검증에만 쓰고 GameData 로 넘기지 않는다. */
  terrains: Record<string, MapTerrain>
  /**
   * 맵별로 파싱해 둔 Tiled JSON. 빌드가 이것을 그대로 파일로 쓴다 —
   * 예전엔 같은 `.tmx` 를 두 번 읽어 두 번 파싱했다(한 번은 검증하려고,
   * 한 번은 JSON 을 쓰려고). 맵이 수십 장이 되면 그 낭비가 맵 수만큼이다.
   */
  mapJson: Record<string, TiledMapJson>
  /** 모든 맵의 배치를 합친 것. instanceId 는 맵을 넘어 유일하다. */
  placements: Record<string, NodePlacement>
}

/**
 * 맵 파일 하나를 읽다 난 실패에 **어느 맵인가**를 붙인다.
 *
 * parseTmx·parseTerrain·parseSpawn 은 맵 파일 하나만 보므로 자기가 어느 맵인지
 * 모른다. 맵이 두 장일 땐 "타일셋이 없다"만 들어도 짐작할 수 있지만, 맵이
 * 수십 장이 되면 짐작할 수 없다 — 그리고 다음 스펙이 정확히 그 세계다.
 *
 * 프로그래밍 오류는 그대로 다시 던진다. 우리가 고칠 것이고, 여기서 새 Error 로
 * 갈아치우면 스택이 이 줄을 가리키게 되어 진짜 자리를 잃는다.
 */
function inMap<T>(ctx: string, file: string, step: () => T): T {
  try {
    return step()
  } catch (err) {
    if (!(err instanceof Error) || err instanceof TypeError || err instanceof RangeError) throw err
    throw new Error(`${ctx} (${file}): ${err.message}`)
  }
}

/**
 * maps.csv 와 그것이 가리키는 맵 파일들을 읽는다.
 *
 * 맵 파일 읽기를 인자로 받는 것은 테스트가 파일 시스템 없이 돌기 위해서다 —
 * 이 파일의 책임은 "여러 맵을 하나로 모으는 것" 이지 파일을 찾는 것이 아니다.
 * 읽지 못한 파일은 빈 문자열로 온다(build.ts): 그래야 ENOENT 스택 트레이스가
 * 아니라 아래의 안내가 나온다.
 */
export function parseMaps(
  rows: Row[],
  readMapFile: (file: string) => string,
  nodes: Record<string, NodeDef>,
): ParsedMaps {
  const maps: Record<string, MapDef> = {}
  const terrains: Record<string, MapTerrain> = {}
  const mapJson: Record<string, TiledMapJson> = {}
  const placements: Record<string, NodePlacement> = {}

  for (const row of rows) {
    const id = requireCell(row, 'id', 'maps.csv')
    const ctx = `maps.csv[${id}]`
    const file = requireCell(row, 'file', ctx)

    const xml = readMapFile(file)
    if (!xml) {
      throw new Error(
        `${ctx}: 맵 파일 "${file}" 을 읽지 못했다 — packages/data/maps/ 안에 그 이름의 파일이 ` +
          `있는지, 그리고 maps.csv 의 file 칸에 오타가 없는지 확인한다`,
      )
    }

    const json = inMap(ctx, file, () => parseTmx(xml))
    const terrain = inMap(ctx, file, () => parseTerrain(json))

    addUnique(maps, id, {
      id,
      name: requireCell(row, 'name', ctx),
      file,
      width: terrain.width,
      height: terrain.height,
      // 시작 칸은 맵 파일이 갖는다 — 그 자리가 왜 여기인지는 parseSpawn 참고.
      spawn: inMap(ctx, file, () => parseSpawn(json)),
    }, 'maps.csv')
    terrains[id] = terrain
    mapJson[id] = json

    const own = inMap(ctx, file, () => parsePlacements(json, nodes, id))
    for (const [instanceId, placement] of Object.entries(own)) {
      // instanceId 는 맵을 넘어 유일해야 한다 — 서버는 그것 하나로 노드를 찾는다.
      if (placements[instanceId]) {
        throw new Error(`maps.csv: instanceId "${instanceId}" 가 여러 맵에 있다`)
      }
      placements[instanceId] = placement
    }
  }

  return { maps, terrains, mapJson, placements }
}
