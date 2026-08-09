import { describe, expect, it } from 'vitest'
import { parseTmx } from './tmx.js'

/** Tiled 가 실제로 내보내는 모양을 줄여 옮긴 것. 레이어 하나, 오브젝트 하나. */
const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="orthogonal" renderorder="right-down" width="3" height="2" tilewidth="32" tileheight="32" infinite="0">
 <tileset firstgid="1" name="pipoya-basechip" tilewidth="32" tileheight="32" tilecount="512" columns="8">
  <image source="../tilesets/pipoya-basechip.png" width="256" height="2048"/>
 </tileset>
 <layer id="1" name="ground" width="3" height="2">
  <data encoding="csv">
1,1,1,
1,0,1
</data>
 </layer>
 <objectgroup id="2" name="nodes">
  <object id="1" x="64" y="32" width="32" height="32">
   <properties>
    <property name="nodeId" value="ice_vein"/>
    <property name="instanceId" value="ice_vein-1"/>
   </properties>
  </object>
 </objectgroup>
</map>`

describe('parseTmx', () => {
  // 왜: placements.ts 와 parseTerrain 이 이미 이 모양을 읽는다. 모양이 어긋나면
  // 맵을 읽는 코드가 두 벌이 된다.
  it('맵 크기와 타일 크기를 읽는다', () => {
    const map = parseTmx(SAMPLE)
    expect({ w: map.width, h: map.height, tw: map.tilewidth, th: map.tileheight }).toEqual({
      w: 3, h: 2, tw: 32, th: 32,
    })
  })

  // 왜: CSV 안의 줄바꿈과 뒤따르는 쉼표는 Tiled 가 실제로 내보내는 형식이다.
  // 그것을 흘리면 타일 배열의 길이가 width*height 와 어긋난다.
  it('타일 레이어를 행 우선 숫자 배열로 편다', () => {
    const layer = parseTmx(SAMPLE).layers.find((l) => l.name === 'ground')
    expect(layer?.type).toBe('tilelayer')
    expect(layer?.data).toEqual([1, 1, 1, 1, 0, 1])
  })

  // 왜: 노드 배치는 오브젝트의 커스텀 속성에만 있다. 속성을 흘리면 배치가 통째로 사라진다.
  it('오브젝트와 커스텀 속성을 읽는다', () => {
    const layer = parseTmx(SAMPLE).layers.find((l) => l.name === 'nodes')
    expect(layer?.type).toBe('objectgroup')
    expect(layer?.objects).toEqual([
      {
        x: 64,
        y: 32,
        properties: [
          { name: 'nodeId', value: 'ice_vein' },
          { name: 'instanceId', value: 'ice_vein-1' },
        ],
      },
    ])
  })

  // 왜: 오브젝트가 하나뿐인 그룹에서 XML 파서가 배열 대신 객체를 주는 것이
  //     이 부류 파서의 전형적인 함정이다. 하나짜리도 배열이어야 한다.
  it('오브젝트가 하나뿐이어도 배열이다', () => {
    const layer = parseTmx(SAMPLE).layers.find((l) => l.name === 'nodes')
    expect(Array.isArray(layer?.objects)).toBe(true)
  })

  // 왜: 클라이언트가 스폰을 오브젝트 이름 'player' 로 찾는다(WorldScene.ts).
  //     이름을 흘리면 플레이어가 조용히 (2,2) 에서 시작한다.
  it('오브젝트 이름을 옮긴다', () => {
    const xml = SAMPLE.replace('<object id="1"', '<object id="1" name="player"')
    const layer = parseTmx(xml).layers.find((l) => l.name === 'nodes')
    expect(layer?.objects?.[0]?.name).toBe('player')
  })
})

/**
 * 이 describe 는 Task 1 브리핑에 없던 것을 검증한다.
 *
 * 왜: 이 JSON 은 클라이언트가 그대로 Phaser 에 넘긴다(WorldScene.ts 의
 * `this.cache.tilemap.add` → `this.make.tilemap`). placements.ts 가 읽는 칸(위 describe)
 * 만으로는 부족하다 — Phaser 3.90 의 Tiled JSON 파서(ParseJSONTiled.js 및 그 아래)를
 * 직접 따라가 확인했다:
 *   - `orientation` 이 없으면 `FromOrientationString` 이 `undefined.toLowerCase()` 로
 *     그 자리에서 던진다. 맵 생성 자체가 안 된다.
 *   - `tilesets` 가 없으면 `ParseTilesets` 가 `json.tilesets.length` 에서 던진다.
 *     있어도 `image`/`imagewidth`/`imageheight` 가 없으면 GID 를 그림 조각으로
 *     바꾸지 못한다(Tileset.updateTileData).
 *   - 레이어의 `opacity`/`visible` 이 없으면 `undefined` 가 곱셈·논리곱을 타고
 *     내려가 `NaN`/`undefined` 가 되어 레이어가 안 보이게 된다.
 *   - 타일 레이어의 `width` 가 없으면 평평한 `data` 배열을 행으로 자르는 동안
 *     "x === width" 비교가 항상 거짓이라 행이 한 번도 안 쌓인다 — 타일이
 *     전부 사라진다(빈 배열).
 */
describe('parseTmx — Phaser 가 실제로 읽는 칸', () => {
  it('지형 방향을 옮긴다', () => {
    expect(parseTmx(SAMPLE).orientation).toBe('orthogonal')
  })

  it('타일셋을 옮긴다 — Phaser 가 GID 를 그림 조각으로 바꾸는 데 쓴다', () => {
    expect(parseTmx(SAMPLE).tilesets).toEqual([
      {
        firstgid: 1,
        name: 'pipoya-basechip',
        tilewidth: 32,
        tileheight: 32,
        image: '../tilesets/pipoya-basechip.png',
        imagewidth: 256,
        imageheight: 2048,
      },
    ])
  })

  it('타일셋에 이미지가 없으면 던진다 — 외부 참조(source=)는 지원하지 않는다', () => {
    const xml = SAMPLE.replace(
      '<image source="../tilesets/pipoya-basechip.png" width="256" height="2048"/>',
      '',
    )
    expect(() => parseTmx(xml)).toThrow(/Embed Tileset/)
  })

  // 왜: <tileset> 이 아예 없으면 `tilesets: []` 이 조용히 나오고, 그 맵은 빌드를
  //     통과한 뒤 클라이언트의 addTilesetImage 가 null 을 돌려주는 자리에서야
  //     "타일셋을 찾을 수 없다" 로 터진다 — 검은 화면이고, 맵을 그린 사람은
  //     자기가 무엇을 빠뜨렸는지 알 길이 없다.
  it('타일셋이 하나도 없으면 던진다', () => {
    const xml = SAMPLE.replace(/ <tileset[\s\S]*?<\/tileset>\n/, '')
    expect(() => parseTmx(xml)).toThrow(/pipoya-basechip/)
  })

  // 왜: 클라이언트는 타일셋을 **이름으로** 찾는다(addTilesetImage('pipoya-basechip')).
  //     이름이 다르면 타일셋이 있어도 못 찾아 같은 자리에서 같은 검은 화면이 된다.
  it('타일셋 이름이 다르면 던지고, 무엇이 들어 있는지 말한다', () => {
    const xml = SAMPLE.replace('name="pipoya-basechip"', 'name="basechip"')
    expect(() => parseTmx(xml)).toThrow(/basechip/)
    expect(() => parseTmx(xml)).toThrow(/pipoya-basechip/)
  })

  // 왜: Tiled 의 Infinite 체크박스는 타일을 <data> 대신 <chunk> 안에 넣는다.
  //     그러면 타일 수가 0 으로 읽혀 "900 개여야 하는데 0 개다" 라는, 원인을
  //     짚어 주지 않는 말만 나온다 — 정작 고칠 곳은 맵 속성의 체크박스 하나다.
  it('무한 맵이면 Infinite 를 짚어서 던진다', () => {
    const xml = SAMPLE.replace('infinite="0"', 'infinite="1"')
    expect(() => parseTmx(xml)).toThrow(/Infinite/)
  })

  // 왜: Tiled 는 opacity=1·visible=true(둘 다 기본값)일 때 속성 자체를 아예 안 쓴다.
  // SAMPLE 의 layer·objectgroup 이 정확히 이 상태다. 기본값을 안 채우면 undefined 가
  // Phaser 의 곱셈·논리곱을 타고 내려가 레이어가 안 보이게 된다.
  it('레이어에 보이기 기본값을 채운다 — Tiled 가 기본값이면 속성을 생략한다', () => {
    const map = parseTmx(SAMPLE)
    const ground = map.layers.find((l) => l.name === 'ground')
    const nodes = map.layers.find((l) => l.name === 'nodes')
    expect({ opacity: ground?.opacity, visible: ground?.visible, x: ground?.x, y: ground?.y }).toEqual({
      opacity: 1, visible: true, x: 0, y: 0,
    })
    expect({ opacity: nodes?.opacity, visible: nodes?.visible }).toEqual({ opacity: 1, visible: true })
  })

  // 왜: 기본값 채우기가 명시된 값을 덮어써 버리면 반대 방향으로 또 안 보이는 레이어가 생긴다.
  it('레이어에 명시된 보이기 값은 그대로 읽는다', () => {
    const xml = SAMPLE.replace('<layer id="1" name="ground"', '<layer id="1" name="ground" opacity="0.5" visible="0"')
    const layer = parseTmx(xml).layers.find((l) => l.name === 'ground')
    expect({ opacity: layer?.opacity, visible: layer?.visible }).toEqual({ opacity: 0.5, visible: false })
  })

  // 왜: Phaser 는 이 값으로 평평한 data 배열을 width 칸마다 끊어 행으로 만든다
  // (ParseTileLayers.js). 없으면 그 비교가 항상 거짓이라 행이 하나도 안 쌓인다.
  it('타일 레이어는 자기 폭·높이를 갖는다', () => {
    const layer = parseTmx(SAMPLE).layers.find((l) => l.name === 'ground')
    expect({ width: layer?.width, height: layer?.height }).toEqual({ width: 3, height: 2 })
  })
})
