import type { TiledMapJson, TiledTilesetJson } from '@nogada/data'

/**
 * 맵 한 장을 **순수 캔버스에 한 번 굽는다**(설계 ⑤).
 *
 * **Phaser 두 번째 카메라를 쓰지 않는 이유는 실측이다.** 전체 맵을 담는 카메라는
 * 컬링이 전혀 안 먹어(통과 타일 564 → 9,382) 프레임당 렌더 CPU 가 0.1ms → 1.4ms 로
 * 오른다. 현재 렌더 비용 전체의 14배를 **매 프레임** 내는 것이고 대상은 폰이다.
 * 여기서 한 번 굽고 텍스처 한 장으로 올리면 프레임 비용이 이미지 하나로 돌아온다.
 *
 * **`pnpm data:build` 에 넣지 않는다.** CI(ubuntu)와 미니PC 가 그림 없이 그것을
 * 돌리고, 구운 PNG 를 커밋하면 `public/nodes/` 와 같은 라이선스 질문을 만난다
 * (Pipoya "Not redistribute"). 런타임 굽기는 그 질문을 아예 안 만난다 — 타일셋
 * 여섯 장은 어느 맵에서든 이미 메모리에 있다(`WorldScene.preload` 가 무조건 로드).
 *
 * **Phaser 를 안 쓰는 것이 이 파일의 값이다.** 그려지는 그림은 브라우저에서만
 * 보이지만, "몇 장을 어느 조각에서 어디로 그렸는가"는 가짜 붓 하나로 잴 수 있다.
 */

/**
 * gid 의 위 세 비트는 **뒤집기 표시**다(가로·세로·대각). 프로덕션 맵에 뒤집힌
 * 타일이 하나도 없지만(전수 확인) 마스킹은 한다 — 안 하면 그 하나가 들어온 날
 * 조각 번호가 수억이 되어 시트 밖을 가리키고, 화면에는 그 타일만 빈 칸으로 남는다.
 */
const GID_MASK = 0x1fffffff

/**
 * 붓 — `CanvasRenderingContext2D` 중 이 파일이 쓰는 한 메서드.
 *
 * 컨텍스트 통째로 받지 않는 이유: 받으면 이 함수를 부르려면 진짜 캔버스가
 * 있어야 하고, 그러면 "몇 장을 어디에 그렸는가"를 자가 못 재게 된다.
 */
export interface MinimapBrush {
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

/** 시트 이름으로 그림을 찾는다. 없으면 undefined — 부르는 쪽에서 던진다. */
export type TilesetImages = (name: string) => CanvasImageSource | undefined

/** 굽는 데 쓸 시트 하나 — 그림과, gid 를 조각으로 바꾸는 데 필요한 수들. */
interface Sheet {
  firstgid: number
  columns: number
  rows: number
  tilewidth: number
  tileheight: number
  margin: number
  spacing: number
  image: CanvasImageSource
}

/**
 * 시트가 담는 조각의 행·열 수 — **`tilecount` 를 믿지 않고 그림 크기에서 다시
 * 센다.** `packages/data` 의 `tileCountOf` 와 같은 계산이고 같은 이유다: Phaser 도
 * 같은 계산을 하므로(`Tileset.updateTileData`) 여기서 다른 답을 내면 미니맵만
 * 남의 조각을 그린다.
 */
function gridOf(ts: TiledTilesetJson): { columns: number; rows: number } {
  const margin = ts.margin ?? 0
  const spacing = ts.spacing ?? 0
  return {
    columns: Math.floor((ts.imagewidth - margin * 2 + spacing) / (ts.tilewidth + spacing)),
    rows: Math.floor((ts.imageheight - margin * 2 + spacing) / (ts.tileheight + spacing)),
  }
}

/**
 * 맵 한 장을 붓 위에 굽는다. 그린 조각 수를 돌려준다.
 *
 * `scale` 은 **타일 하나가 몇 px 인가**다. 화면 배율(renderScale)을 이미 곱한
 * 값을 받는다 — 이 파일은 기기 픽셀을 모른다.
 *
 * 세는 값을 돌려주는 이유: 그림이 나오는지는 눈으로만 알 수 있지만, **한 장도
 * 안 그린 채 조용히 끝나는 것**은 자가 잡을 수 있다. 시트 짝짓기가 어긋나
 * 모든 gid 가 버려지면 미니맵은 빈 상자로 서는데, 그것은 "맵이 어두운 곳"과
 * 화면에서 구분되지 않는다.
 */
export function bakeMinimap(
  brush: MinimapBrush,
  map: TiledMapJson,
  images: TilesetImages,
  scale: number,
): number {
  // firstgid 오름차순으로 세워 두면 gid 하나가 어느 시트인지 뒤에서부터 한 번에
  // 찾힌다. 맵 파일은 이미 그 순서로 적혀 있지만(빌드가 firstgid 연속을 강제한다)
  // 그 사실에 기대지 않는다 — 여기서 정렬하는 값은 한 맵에 여섯 줄이다.
  const sheets: Sheet[] = map.tilesets
    .map((ts) => {
      const image = images(ts.name)
      if (!image) {
        throw new Error(
          `미니맵: 타일셋 "${ts.name}" 의 그림이 메모리에 없다 — WorldScene.preload 가 ` +
            `TILESET_NAMES 를 무조건 올리므로, 여기까지 왔다면 그 목록과 맵이 갈라진 것이다`,
        )
      }
      const { columns, rows } = gridOf(ts)
      return {
        firstgid: ts.firstgid,
        columns,
        rows,
        tilewidth: ts.tilewidth,
        tileheight: ts.tileheight,
        margin: ts.margin ?? 0,
        spacing: ts.spacing ?? 0,
        image,
      }
    })
    .sort((a, b) => a.firstgid - b.firstgid)

  let drawn = 0

  for (const layer of map.layers) {
    // 오브젝트 레이어(spawn·노드 배치·지점)는 그림이 아니다. 안 보이는 레이어도
    // 안 그린다 — 세계에서 안 보이는 것이 축소도에만 나오면 그 축소도는 거짓말이다.
    if (layer.type !== 'tilelayer' || layer.visible === false || !layer.data) continue

    for (let i = 0; i < layer.data.length; i++) {
      const gid = (layer.data[i] ?? 0) & GID_MASK
      // 0 은 빈 칸이다. 대부분의 맵에서 decor·overhead 는 거의 전부 0 이라, 이
      // 한 줄이 굽는 값의 절반을 덜어 낸다.
      if (gid === 0) continue

      const sheet = sheetFor(sheets, gid)
      if (!sheet) continue
      const local = gid - sheet.firstgid
      const row = Math.floor(local / sheet.columns)
      // 시트 밖을 가리키는 조각은 건너뛴다. `drawImage` 는 그런 원본 사각형에
      // 조용히 아무것도 안 그리거나 가장자리를 늘리는데, 기기마다 답이 다르다.
      if (row >= sheet.rows) continue

      const col = local % sheet.columns
      const x = i % map.width
      const y = Math.floor(i / map.width)

      // 칸의 두 끝을 각각 격자에 맞춘다 — 폭을 `scale` 로 두고 자리만 반올림하면
      // 배율이 정수가 아닌 맵(1.40~4.67px/타일)에서 칸 사이에 1px 틈이 생기고,
      // 축소도가 모눈종이처럼 보인다.
      const dx = Math.floor(x * scale)
      const dy = Math.floor(y * scale)
      brush.drawImage(
        sheet.image,
        sheet.margin + col * (sheet.tilewidth + sheet.spacing),
        sheet.margin + row * (sheet.tileheight + sheet.spacing),
        sheet.tilewidth,
        sheet.tileheight,
        dx,
        dy,
        Math.ceil((x + 1) * scale) - dx,
        Math.ceil((y + 1) * scale) - dy,
      )
      drawn++
    }
  }

  return drawn
}

/** 이 gid 가 속한 시트 — `firstgid` 가 그보다 크지 않은 것 중 마지막. */
function sheetFor(sheets: readonly Sheet[], gid: number): Sheet | null {
  for (let i = sheets.length - 1; i >= 0; i--) {
    const sheet = sheets[i]!
    if (sheet.firstgid <= gid) return sheet
  }
  return null
}
