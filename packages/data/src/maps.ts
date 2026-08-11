import type {
  GameData,
  MapDef,
  NodeDef,
  NodePlacement,
  PlaceDef,
  PlayerLocation,
  SkillId,
} from '@nogada/shared'
import { addUnique, requireCell } from './parse.js'
import { parsePlaces } from './places.js'
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
export const START_MAP_ID = '눈의마을'

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

/**
 * 바깥 세계 — 마을과 마을 사이를 잇는 맵.
 *
 * `START_MAP_ID` 와 같은 성격의 상수다: 등록부의 어떤 행이 특별한가를 이름
 * 하나로 가리키고, 그 행이 사라지면 아래 유도가 빈 목록을 내며 즉시 말한다.
 */
export const WORLD_MAP_ID = '월드맵'

/**
 * 캐릭터를 만들 때 고를 수 있는 시작 마을 — **월드맵에서 바로 들어가는 맵이
 * 마을이다.**
 *
 * 왜 목록을 어디에도 적지 않는가: 마을 이름을 코드에 적으면 마을을 하나 더
 * 그리는 날 그 목록이 따라오지 않는다(시작 칸 좌표를 세 곳에 박아 뒀던 것과
 * 같은 종류의 숫자다). 세계의 생김새가 이미 그 사실을 알고 있다 — 마을은
 * 월드맵에서 들어가고, 채집장은 마을에서 들어가고, 개발용 시험장은 마을
 * 뒷문이다. 전환표를 보면 셋이 저절로 갈린다.
 *
 * 순서는 전환표에 적힌 순서다 — 작가가 적은 순서가 곧 화면에 놓이는 순서다.
 */
export function startVillages(data: GameData): MapDef[] {
  const villages: MapDef[] = []
  const seen = new Set<string>()

  for (const transition of data.transitions) {
    if (transition.fromMap !== WORLD_MAP_ID || seen.has(transition.toMap)) continue
    const map = data.maps[transition.toMap]
    // 빌드가 이미 막았다(validateTransitions) — 여기 닿았다면 데이터가 어긋난 것이다.
    if (!map) throw new Error(`전환표가 가리키는 맵 "${transition.toMap}" 이 등록부에 없다`)
    seen.add(transition.toMap)
    villages.push(map)
  }

  if (villages.length === 0) {
    throw new Error(
      `"${WORLD_MAP_ID}" 에서 나가는 전환이 하나도 없다 — 고를 수 있는 시작 마을이 없다`,
    )
  }
  return villages
}

/** 마을 하나가 데리고 있는 채집장과, 그 채집장이 가르치는 기술. */
export interface VillageField {
  map: MapDef
  skill: SkillId
}

/**
 * 마을 → 대표 숙련도. **어디에도 적혀 있지 않고 세계의 생김새에서 나온다**(설계 규범 14).
 *
 * "시작 마을 = 첫 숙련도" 는 이 게임의 설계이므로 캐릭터 생성 화면이 그것을
 * 말해야 하는데, 그 대응을 카드에 적어 두면 마을을 하나 더 그리거나 채집장의
 * 노드를 갈아끼우는 날 화면만 옛말을 한다 — 시작 칸 좌표를 세 곳에 박아 뒀던
 * 것과 같은 종류의 중복이다.
 *
 * 유도의 규칙은 셋이다:
 * 1. 마을에서 나가는 전환 중 월드맵과 다른 마을을 뺀 것이 후보다.
 * 2. 후보 중 **노드가 놓여 있고 그 노드가 전부 한 기술인** 맵이 채집장이다.
 *    개발용 시험장은 네 기술이 섞여 있어 여기서 저절로 걸러진다 — "여러 기술을
 *    한 맵에 두면 그 맵은 어느 마을의 정체성도 아니다" 가 규칙 자체다.
 * 3. 그런 맵이 정확히 하나여야 한다. 없거나 둘이면 던진다.
 *
 * 던지는 이유: 조용히 첫 번째를 고르면 마을 둘이 같은 답을 내는 날에도 화면은
 * 멀쩡해 보이고, 그 어긋남은 사람이 "왜 항구 마을이 얼음이지" 하고 눈치챌
 * 때까지 산다. 빌드가 이것을 검사한다(validate.ts 의 validateVillageFields).
 */
export function villageField(data: GameData, villageId: string): VillageField {
  const villages = new Set(startVillages(data).map((map) => map.id))
  if (!villages.has(villageId)) throw new Error(`"${villageId}" 은 시작 마을이 아니다`)

  const found: VillageField[] = []
  const seen = new Set<string>()

  for (const transition of data.transitions) {
    if (transition.fromMap !== villageId) continue
    const toMap = transition.toMap
    if (toMap === WORLD_MAP_ID || villages.has(toMap) || seen.has(toMap)) continue
    seen.add(toMap)

    const map = data.maps[toMap]
    if (!map) throw new Error(`전환표가 가리키는 맵 "${toMap}" 이 등록부에 없다`)

    const skills = new Set<SkillId>()
    for (const placement of Object.values(data.placements)) {
      if (placement.mapId !== toMap) continue
      const node = data.nodes[placement.nodeId]
      // 빌드가 이미 막았다(validateGameData 의 배치 검사) — 여기 닿았다면 데이터가 어긋난 것이다.
      if (!node) throw new Error(`배치가 가리키는 노드 "${placement.nodeId}" 가 등록부에 없다`)
      skills.add(node.skill)
    }

    if (skills.size === 1) found.push({ map, skill: [...skills][0]! })
  }

  if (found.length !== 1) {
    const names = found.map((f) => f.map.id).join(', ') || '없음'
    throw new Error(
      `마을 "${villageId}" 의 대표 채집장을 하나로 정할 수 없다 (후보: ${names}) — ` +
        `마을에서 바로 들어가는 맵 중 한 가지 기술의 노드만 놓인 맵이 정확히 하나여야 한다`,
    )
  }
  return found[0]!
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
  /**
   * 모든 맵의 지점을 합친 것. 지점 id 도 맵을 넘어 유일하다 — 일과(`.sched`)가
   * 맵을 적지 않고 이름 하나로만 지점을 부르기 때문이다.
   */
  places: Record<string, PlaceDef>
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
  const places: Record<string, PlaceDef> = {}

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

    const ownPlaces = inMap(ctx, file, () => parsePlaces(json, id))
    for (const [placeId, place] of Object.entries(ownPlaces)) {
      // 지점 id 는 맵을 넘어 유일해야 한다 — 일과가 맵을 적지 않고 이름
      // 하나로 부르므로, 두 맵에 같은 이름이 있으면 그 일과가 어느 마을의
      // 자리를 뜻하는지 알 방법이 없다.
      if (places[placeId]) {
        throw new Error(
          `maps.csv: 지점 "${placeId}" 가 여러 맵에 있다 (${places[placeId].mapId}, ${id}) — ` +
            `일과는 맵을 적지 않고 이름만으로 지점을 부른다. 한쪽 이름을 바꾼다`,
        )
      }
      places[placeId] = place
    }
  }

  return { maps, terrains, mapJson, placements, places }
}
