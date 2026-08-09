import { XMLParser } from 'fast-xml-parser'

/**
 * Tiled 의 JSON 내보내기와 같은 모양. 이 파일이 그 모양을 만드는 유일한 곳이다.
 *
 * `placements.ts` 의 `TiledMap`·`TiledLayer` 가 읽는 칸(width·height·tilewidth·tileheight·
 * layers[].name·type·data·objects)은 물론 담는다. 그것만으로는 부족하다 — 이 JSON 은
 * 클라이언트가 그대로 Phaser 에 넘기므로(WorldScene.ts 의 `this.cache.tilemap.add`),
 * Phaser 3.90 의 Tiled JSON 파서가 요구하는 칸도 함께 담아야 한다:
 *
 *   - `orientation` 이 없으면 맵 생성 자체가 그 자리에서 던진다
 *     (`FromOrientationString` 이 `undefined.toLowerCase()` 를 호출한다).
 *   - `tilesets` 가 없으면 마찬가지로 던진다(`json.tilesets.length`). 있어도
 *     `image`/`imagewidth`/`imageheight` 가 없으면 GID 를 그림 조각으로 바꾸지
 *     못한다 — 클라이언트가 preload 의 키로 찾는 것은 "어느 그림인가"뿐이고,
 *     "그 그림의 어느 조각인가"는 이 칸들로 계산한다.
 *   - 레이어의 `opacity`/`visible` 이 없으면 `undefined` 가 곱셈·논리곱을 타고
 *     내려가 `NaN`/`undefined` 가 되어 레이어가 안 보이게 된다.
 *   - 타일 레이어의 `width`/`height` 가 없으면 평평한 `data` 배열을 행으로 못
 *     자른다 — 타일이 전부 사라진다.
 *
 * 실제로 Phaser 소스(ParseJSONTiled.js 와 그 아래 ParseTilesets.js·ParseTileLayers.js·
 * ParseObjectLayers.js)를 따라가며 확인했다. 반대로 개별 오브젝트(`TiledObjectJson`)는
 * `id`·`width`·`height`·`rotation`·`visible` 이 없어도 Phaser 가 조용히 건너뛴다
 * (`Pick` 이 있는 키만 옮긴다) — 그래서 그쪽은 최소한만 남겨 두었다.
 */
export interface TiledObjectJson {
  name?: string
  x: number
  y: number
  properties?: { name: string; value: string }[]
}

export interface TiledLayerJson {
  id: number
  name: string
  type: 'tilelayer' | 'objectgroup'
  /** Tiled 는 기본값(1)이면 속성 자체를 안 쓴다 — 그래서 항상 채워서 내보낸다. */
  opacity: number
  /** Tiled 는 기본값(true)이면 속성 자체를 안 쓴다 — 그래서 항상 채워서 내보낸다. */
  visible: boolean
  x: number
  y: number
  /** 타일 레이어에만 있다. Phaser 가 이 값으로 평평한 data 배열을 행으로 자른다. */
  width?: number
  height?: number
  data?: number[]
  objects?: TiledObjectJson[]
}

/**
 * Phaser 가 GID → 그림 조각 위치를 계산하는 데 쓰는 칸만 담는다. `columns`·`tilecount` 는
 * 옮기지 않는다 — Phaser 는 이미지 실제 크기(`imagewidth`·`imageheight`)로 다시 계산하므로
 * (`Tileset.updateTileData`) 그 값을 읽지 않는다.
 */
export interface TiledTilesetJson {
  firstgid: number
  name: string
  tilewidth: number
  tileheight: number
  /** Phaser 는 내용이 아니라 "있다/없다"만 본다 — 실제 그림은 preload 의 키로 찾는다. */
  image: string
  imagewidth: number
  imageheight: number
  margin?: number
  spacing?: number
}

export interface TiledMapJson {
  width: number
  height: number
  tilewidth: number
  tileheight: number
  orientation: string
  layers: TiledLayerJson[]
  tilesets: TiledTilesetJson[]
}

/**
 * 클라이언트가 그림으로 들고 있는 타일셋들. `addTilesetImage(이름, 이름)` 의
 * 첫 인자가 Tiled 안의 타일셋 이름이라, 맵이 여기 없는 이름을 쓰면 그 호출이
 * null 을 돌려주고 WorldScene 이 그 자리에서 던진다 — 검은 화면이다.
 *
 * 그래서 빌드와 클라이언트가 **같은 글자**를 봐야 한다. 여기 한 곳에 두고
 * 양쪽이 가져다 쓴다 — 클라이언트는 preload 의 키로, 빌드는 맵이 요구하는
 * 그림이 실제로 있는지 보는 잣대로.
 *
 * **왜 여러 장인가:** 원본 `[Base]BaseChip_pipo.png` 는 256×4256(1,064 타일)
 * 인데, 저사양 안드로이드의 WebGL `MAX_TEXTURE_SIZE` 가 2048 이라 한 장으로는
 * 못 올린다(assets/CREDITS.md). 예전엔 위 512 타일만 남기고 잘라 버려서 지붕·
 * 실내 가구·침대가 통째로 없었다 — 벽은 세울 수 있는데 지붕을 못 얹었다.
 * 이제 같은 원본을 512 + 512 + 40 으로 나눠 셋으로 들고, `addwork` 을 더한다.
 *
 * 순서는 맵의 `firstgid` 순서와 같게 둔다. 그 덕에 앞 세 장의 gid 는 원본
 * 시트의 타일 번호 + 1 로 그대로 이어진다(1..512, 513..1024, 1025..1064).
 *
 * `pipoya-water` 만 출처가 다르다 — 베이스칩에는 물이 없다. 이것은 팩의
 * `[A]_type3` 오토타일 두 벌(깊은 바다·물가 파도)을 위아래로 이어 붙인
 * 96 타일짜리 시트다. 맨 뒤에 두어 앞 네 장의 gid 를 한 칸도 건드리지 않는다.
 */
export const TILESET_NAMES = [
  'pipoya-basechip',
  'pipoya-basechip-2',
  'pipoya-basechip-3',
  'pipoya-addwork',
  'pipoya-water',
] as const

export type TilesetName = (typeof TILESET_NAMES)[number]

/** 하나뿐인 자식을 객체로 접는 XML 파서의 습성을 여기서 한 번에 편다. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function toNumber(value: unknown, what: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`맵 파일에서 ${what} 를 숫자로 읽지 못했다: ${String(value)}`)
  return n
}

/** 있으면 숫자로 읽고, 없으면 기본값 — opacity·x·y 처럼 Tiled 가 기본값일 때 속성을 생략하는 값용. */
function toNumberOrDefault(value: unknown, fallback: number, what: string): number {
  return value === undefined ? fallback : toNumber(value, what)
}

/** Tiled 는 true(기본값)면 속성을 아예 안 쓰고, false 일 때만 "0" 을 적는다. */
function tiledBool(value: unknown, fallback: boolean): boolean {
  return value === undefined ? fallback : value !== '0'
}

/**
 * 시트 하나가 담는 타일 수. `<tileset>` 의 `tilecount` 를 믿지 않고 그림 크기에서
 * 다시 센다 — Phaser 도 같은 계산을 한다(`Tileset.updateTileData`). 두 값이
 * 어긋난 맵에서 Tiled 와 게임이 서로 다른 gid 를 쓰게 되는데, 그 어긋남을
 * 잡으려는 것이 바로 아래의 firstgid 검사다.
 */
function tileCountOf(ts: TiledTilesetJson): number {
  const margin = ts.margin ?? 0
  const spacing = ts.spacing ?? 0
  const columns = Math.floor((ts.imagewidth - margin * 2 + spacing) / (ts.tilewidth + spacing))
  const rows = Math.floor((ts.imageheight - margin * 2 + spacing) / (ts.tileheight + spacing))
  return Math.max(0, columns) * Math.max(0, rows)
}

/**
 * `.tmx`(XML) 를 Tiled 의 JSON 내보내기와 같은 모양으로 바꾼다.
 *
 * 왜 빌드가 직접 읽는가: 예전에는 Tiled 에서 "Export As" 를 손으로 눌러야
 * `.json` 이 나왔고, 그것을 빠뜨리면 저장했는데 게임은 옛 맵인 상태가 됐다.
 * 맵이 여러 장이 되면 그 위험이 맵 수만큼 늘어난다.
 */
export function parseTmx(xml: string): TiledMapJson {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // 타일 데이터는 텍스트 노드로 들어온다. 이름을 고정해 두어야 읽을 수 있다.
    textNodeName: '#text',
    // 좌표·크기를 숫자로 바꾸는 것은 우리가 한다 — 파서가 "01" 같은 값을
    // 마음대로 바꾸면 오히려 원인을 찾기 어렵다.
    parseAttributeValue: false,
  })

  const root = parser.parse(xml) as Record<string, any>
  const map = root['map']
  if (!map) throw new Error('맵 파일에 <map> 이 없다 — Tiled 로 저장한 .tmx 가 맞는지 확인한다')

  // 무한 맵은 타일을 <data> 가 아니라 그 안의 <chunk> 들에 나눠 담는다. 그러면
  // 아래 타일 수 검사가 "0 개다" 라고만 말하는데, 그 말로는 무엇을 고쳐야 하는지
  // 알 수 없다 — 고칠 곳은 맵 속성의 체크박스 하나다. 여기서 먼저 짚는다.
  if (map['@infinite'] === '1') {
    throw new Error(
      '맵이 무한(Infinite) 으로 저장됐다 — Tiled 의 Map ▸ Map Properties 에서 Infinite 를 끄고 다시 저장한다',
    )
  }

  const width = toNumber(map['@width'], 'width')
  const height = toNumber(map['@height'], 'height')
  const tilewidth = toNumber(map['@tilewidth'], 'tilewidth')
  const tileheight = toNumber(map['@tileheight'], 'tileheight')
  const orientation = String(map['@orientation'] ?? 'orthogonal')

  const tilesets: TiledTilesetJson[] = asArray(map['tileset']).map((ts: Record<string, any>) => {
    const name = String(ts['@name'] ?? '')
    const image = ts['image']
    if (!image) {
      throw new Error(
        `타일셋 "${name}" 이 이미지를 내장하지 않았다(외부 참조는 지원하지 않는다) — ` +
          `Tiled 에서 Embed Tileset 으로 저장한다`,
      )
    }
    const out: TiledTilesetJson = {
      firstgid: toNumber(ts['@firstgid'], `타일셋 "${name}" 의 firstgid`),
      name,
      tilewidth: toNumber(ts['@tilewidth'], `타일셋 "${name}" 의 tilewidth`),
      tileheight: toNumber(ts['@tileheight'], `타일셋 "${name}" 의 tileheight`),
      image: String(image['@source'] ?? ''),
      imagewidth: toNumber(image['@width'], `타일셋 "${name}" 이미지의 width`),
      imageheight: toNumber(image['@height'], `타일셋 "${name}" 이미지의 height`),
    }
    if (ts['@margin'] !== undefined) out.margin = toNumber(ts['@margin'], `타일셋 "${name}" 의 margin`)
    if (ts['@spacing'] !== undefined) out.spacing = toNumber(ts['@spacing'], `타일셋 "${name}" 의 spacing`)
    return out
  })

  // 타일셋이 없으면 예전에는 `tilesets: []` 이 조용히 나왔다. 그 맵은 빌드를
  // 통과한 뒤 클라이언트의 addTilesetImage 가 null 을 돌려주는 자리에서야
  // 터지고, 화면에는 아무것도 안 나온다 — 맵을 그린 사람이 스스로 원인을
  // 짚을 수 없는 실패다. 그리는 시점에 말한다.
  if (tilesets.length === 0) {
    throw new Error(
      `맵에 타일셋이 하나도 없다 — Tiled 의 Map ▸ Add External Tileset 이 아니라, ` +
        `타일셋 이름을 ${TILESET_NAMES.map((n) => `"${n}"`).join(' · ')} 중 하나로 두고 ` +
        `Embed Tileset 으로 저장한다. 클라이언트가 이 이름으로 타일셋을 찾는다`,
    )
  }

  // 클라이언트가 못 들고 있는 그림을 요구하는 맵은 여기서 세운다 — 그 맵은
  // 브라우저에서 addTilesetImage 가 null 을 돌려주는 자리에서야 터진다.
  // 타일셋이 여럿이 된 지금 이 검사가 이름 한 개짜리 검사를 대신한다.
  const known: readonly string[] = TILESET_NAMES
  for (const ts of tilesets) {
    if (!known.includes(ts.name)) {
      throw new Error(
        `맵이 클라이언트가 모르는 타일셋 "${ts.name}" 을 쓴다 — ` +
          `쓸 수 있는 것: ${TILESET_NAMES.join(', ')}. ` +
          `새 시트를 더하려면 packages/data 의 TILESET_NAMES 에 이름을 넣고 ` +
          `그 그림을 apps/client/public/tilesets/ 에 둔다(assets/CREDITS.md)`,
      )
    }
  }

  // firstgid 가 앞 시트들의 타일 수를 그대로 이어야 한다.
  //
  // 이 한 줄이 어긋나면 아무것도 터지지 않고 **세계의 모든 타일이 밀린다** —
  // 바닥이 벽이 되고 벽이 지붕이 된다. 화면을 봐야만 알 수 있고, 열 장을 다
  // 열어 보기 전에는 어느 맵이 밀렸는지도 모른다. 시트가 하나일 때는 있을 수
  // 없던 실수라 이 검사도 없었다.
  let expected = 1
  for (const ts of tilesets) {
    if (ts.firstgid !== expected) {
      throw new Error(
        `타일셋 "${ts.name}" 의 firstgid 가 ${ts.firstgid} 인데 ${expected} 여야 한다 — ` +
          `앞 시트들의 타일 수를 이어야 맵의 타일이 밀리지 않는다. ` +
          `Tiled 에서 타일셋을 지웠다 다시 넣으면 번호가 다시 매겨진다`,
      )
    }
    expected += tileCountOf(ts)
  }

  const layers: TiledLayerJson[] = []

  for (const layer of asArray(map['layer'])) {
    const name = String(layer['@name'] ?? '')
    const raw = layer['data']
    const encoding = raw?.['@encoding']
    if (encoding !== 'csv') {
      throw new Error(
        `맵 레이어 "${name}" 의 타일 저장 형식이 csv 가 아니다(${String(encoding)}) — ` +
          `Tiled 의 맵 속성에서 Tile Layer Format 을 CSV 로 바꾼다`,
      )
    }
    const text = String(raw['#text'] ?? '')
    const data = text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => toNumber(s, `레이어 "${name}" 의 타일 값`))

    if (data.length !== width * height) {
      throw new Error(
        `맵 레이어 "${name}" 의 타일 수가 맞지 않다 — ${width}×${height} 이면 ${width * height} 개여야 하는데 ${data.length} 개다`,
      )
    }
    layers.push({
      id: toNumberOrDefault(layer['@id'], 0, `레이어 "${name}" 의 id`),
      name,
      type: 'tilelayer',
      opacity: toNumberOrDefault(layer['@opacity'], 1, `레이어 "${name}" 의 opacity`),
      visible: tiledBool(layer['@visible'], true),
      x: toNumberOrDefault(layer['@x'], 0, `레이어 "${name}" 의 x`),
      y: toNumberOrDefault(layer['@y'], 0, `레이어 "${name}" 의 y`),
      width: toNumber(layer['@width'], `레이어 "${name}" 의 width`),
      height: toNumber(layer['@height'], `레이어 "${name}" 의 height`),
      data,
    })
  }

  for (const group of asArray(map['objectgroup'])) {
    const name = String(group['@name'] ?? '')
    const objects = asArray(group['object']).map((obj: Record<string, any>) => {
      const properties = asArray(obj['properties']?.['property']).map((p: Record<string, any>) => ({
        name: String(p['@name'] ?? ''),
        value: String(p['@value'] ?? ''),
      }))
      const out: TiledObjectJson = {
        x: toNumber(obj['@x'] ?? 0, `오브젝트 x`),
        y: toNumber(obj['@y'] ?? 0, `오브젝트 y`),
      }
      const objName = obj['@name']
      if (objName !== undefined) out.name = String(objName)
      if (properties.length > 0) out.properties = properties
      return out
    })
    layers.push({
      id: toNumberOrDefault(group['@id'], 0, `레이어 "${name}" 의 id`),
      name,
      type: 'objectgroup',
      opacity: toNumberOrDefault(group['@opacity'], 1, `레이어 "${name}" 의 opacity`),
      visible: tiledBool(group['@visible'], true),
      x: toNumberOrDefault(group['@x'], 0, `레이어 "${name}" 의 x`),
      y: toNumberOrDefault(group['@y'], 0, `레이어 "${name}" 의 y`),
      objects,
    })
  }

  return { width, height, tilewidth, tileheight, orientation, layers, tilesets }
}
