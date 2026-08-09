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
 * 클라이언트가 타일셋을 찾는 이름. `addTilesetImage(TILESET_NAME, TILESET_NAME)`
 * 의 첫 인자가 Tiled 안의 타일셋 이름이라, 맵이 다른 이름을 쓰면 그 호출이
 * null 을 돌려주고 WorldScene 이 그 자리에서 던진다 — 검은 화면이다.
 *
 * 그래서 빌드와 클라이언트가 **같은 글자**를 봐야 한다. 여기 한 곳에 두고
 * 양쪽이 가져다 쓴다.
 */
export const TILESET_NAME = 'pipoya-basechip'

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

  // 타일셋이 없거나 이름이 다르면 예전에는 `tilesets: []` 이 조용히 나왔다.
  // 그 맵은 빌드를 통과한 뒤 클라이언트의 addTilesetImage 가 null 을 돌려주는
  // 자리에서야 터지고, 화면에는 아무것도 안 나온다 — 맵을 그린 사람이 스스로
  // 원인을 짚을 수 없는 실패다. 그리는 시점에 말한다.
  if (!tilesets.some((ts) => ts.name === TILESET_NAME)) {
    const found = tilesets.map((ts) => `"${ts.name}"`).join(', ')
    throw new Error(
      `맵에 "${TILESET_NAME}" 타일셋이 없다${found ? ` (들어 있는 것: ${found})` : ''} — ` +
        `Tiled 의 Map ▸ Add External Tileset 이 아니라, 타일셋 이름을 "${TILESET_NAME}" 으로 두고 ` +
        `Embed Tileset 으로 저장한다. 클라이언트가 이 이름으로 타일셋을 찾는다`,
    )
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
