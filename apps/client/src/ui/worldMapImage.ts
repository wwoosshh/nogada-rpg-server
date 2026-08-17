import { WORLD_MAP_ID, type TiledMapJson } from '@nogada/data'
import { bakeMinimap } from '../game/minimapBake.js'

/**
 * 전체화면 지도의 **그림** — 월드맵 한 장을 한 번 굽고 그 캔버스를 붙잡아 둔다.
 *
 * 미니맵과 **같은 붓**을 쓴다(`bakeMinimap`). 그 함수가 Phaser 를 모르는 것이
 * 여기서 값이 된다 — 이 화면은 DOM 이고 Phaser 의 텍스처 관리자에 닿을 방법이
 * 없는데, 붓이 `CanvasRenderingContext2D` 한 메서드와 「이름으로 그림 찾기」
 * 하나만 요구하므로 그대로 다시 쓴다. 축소도를 두 번 짓지 않는다.
 *
 * **왜 DOM 이고 Phaser 씬이 아닌가**(설계 ⑤ 후반부): 이 화면의 절반은 열 줄짜리
 * 읽기 전용 목록이다. Phaser 는 글자 줄만 그릴 수 있어(PanelScene) 두 단짜리
 * 표와 줄바꿈을 손으로 다시 만들게 되고, 그 벽은 가방·제작·상점·수집의 방이
 * 이미 만나 같은 답을 낸 자리다 — `.panel` 껍데기 재사용 + `openPanel` 리터럴
 * 하나. 설계가 적어 둔 본문 774×265 도 그 껍데기의 치수다.
 *
 * **언제 받는가 — 처음 열 때다.**
 * `WorldScene.preload` 는 서 있는 맵 하나만 받으므로, 마을 안에서 전체 월드맵을
 * 열려면 `월드맵.json` 58KB 를 따로 받아야 한다. 그것을 부팅에 얹지 않는 이유는
 * 셋이다.
 * ① 부팅은 **모두가** 지나는 길이고 지도는 **여는 사람만** 지나는 길이다. 지금도
 *    첫 화면이 타일셋 610KB + 맵 JSON 을 기다리는데, 거기에 안 열 수도 있는 58KB
 *    를 먼저 끼우면 모두가 걷기 시작하는 시각이 늦어진다.
 * ② 지도는 **서서 보는 화면**이다. 걷다가 한 박자 끊기는 자리가 아니라 이미 멈춰
 *    서서 "여기가 어디지" 하는 자리라, 첫 열림의 한 번은 채집 한 번이 끊기는
 *    것과 값이 다르다.
 * ③ 타일셋은 **이미 받아 둔 것**이다(`WorldScene.preload` 가 무조건 여섯 장을
 *    올린다). 그래서 첫 열림에 실제로 새로 나가는 요청은 맵 JSON 하나이고, 그림
 *    여섯 장은 브라우저 캐시에서 온다.
 *
 * 그리고 **두 번째 열림부터는 0 이다** — 받은 것도 구운 것도 여기 남는다.
 * 미니맵이 텍스처를 안 지우는 그 이유이고(HudScene 의 minimapTextureKey), 값도
 * 같은 자리에서 나온다: 월드맵은 조각이 9,382개라 굽는 것 자체가 데스크톱에서도
 * 기록만 26.7ms 다.
 *
 * **실측(데스크톱, 기기 픽셀비 1, 251px):** 첫 열림 101ms — 그중 맵 JSON 이 14ms
 * (전송 59,416바이트)이고 타일셋 여섯 장은 전부 304 다(이미 받아 둔 것이라는 위
 * ③ 이 실제로 그렇다). 두 번째 열림 0ms.
 */

/** 한 번 받아 온 맵 JSON. 두 번째 열림부터는 이 약속이 바로 답한다. */
let mapJsonOnce: Promise<TiledMapJson> | null = null
/** 한 번 얻어 온 타일셋 그림들. 키는 Tiled 안의 시트 이름이다. */
let imagesOnce: Promise<Map<string, HTMLImageElement>> | null = null
/**
 * 마지막으로 구운 것 — 한 장만 붙잡는다.
 *
 * 키에 크기와 밀도가 함께 들어가는 이유는 미니맵의 텍스처 키와 같다: 상자 크기는
 * 창을 리사이즈하면 바뀌고 기기 픽셀비는 창을 다른 배율의 모니터로 옮기면 바뀐다.
 * 한 장만 붙잡는 것은 이 화면이 크기를 하나만 쓰기 때문이다 — 옛 크기의 그림을
 * 쌓아 둬 봐야 돌아갈 일이 없다.
 */
let bakedOnce: { key: string; canvas: HTMLCanvasElement } | null = null

/** 구운 그림 한 장과, 그것을 화면에서 몇 CSS 픽셀로 놓아야 하는가. */
export interface WorldMapImage {
  canvas: HTMLCanvasElement
  cssWidth: number
  cssHeight: number
}

async function loadMapJson(): Promise<TiledMapJson> {
  // 경로가 `WorldScene.preload` 와 같은 상대 경로인 것이 중요하다 — dist 는
  // 루트와 Capacitor 의 `https://localhost/` 두 자리에서 로드되고, vite 설정이
  // `base: './'` 인 이유가 그것이다. 절대 경로를 적으면 한쪽에서만 맞는다.
  //
  // 맵 id 가 한글이라 URL 로 쓰기 전에 인코딩한다 — 브라우저가 알아서 해 주기도
  // 하지만, 그 자동 변환에 기대면 개발 서버의 미들웨어가 무엇을 받게 되는지가
  // 브라우저마다 달라진다(WorldScene.preload 의 같은 주석).
  const res = await fetch(`maps/${encodeURIComponent(WORLD_MAP_ID)}.json`)
  if (!res.ok) {
    throw new Error(
      `전체 지도: "${WORLD_MAP_ID}" 의 JSON 을 못 받았다 (${res.status}) — ` +
        `pnpm data:build 를 돌렸는지, dist/maps 가 함께 배포됐는지 확인하라`,
    )
  }
  return (await res.json()) as TiledMapJson
}

/**
 * 맵이 적어 온 시트만 받는다 — `TILESET_NAMES` 여섯 장을 다 도는 것이 아니다.
 *
 * 여기서는 맵 JSON 을 이미 손에 쥔 뒤라 어느 시트를 쓰는지 안다.
 * `WorldScene.preload` 가 여섯 장을 다 올리는 것은 그 시점에 맵 JSON 이 아직 큐에
 * 막 들어간 참이라 모르기 때문이다(그 파일의 첫 주석).
 */
function loadImages(map: TiledMapJson): Promise<Map<string, HTMLImageElement>> {
  const names = [...new Set(map.tilesets.map((ts) => ts.name))]
  return Promise.all(
    names.map(
      (name) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve([name, img])
          img.onerror = () =>
            reject(
              new Error(
                `전체 지도: 타일셋 "${name}" 을 못 읽었다 — apps/client/public/tilesets/ 를 ` +
                  `확인하라(복원 방법은 assets/CREDITS.md)`,
              ),
            )
          img.src = `tilesets/${name}.png`
        }),
    ),
  ).then((pairs) => new Map(pairs))
}

/**
 * 월드맵을 한 변 `sizePx` 인 정사각 상자에 **contain-fit** 으로 굽는다.
 *
 * 두 축 중 작은 배율을 쓰는 것이 곧 "안 잘린다"이다 — 미니맵의 `minimapFit` 과
 * 같은 규칙이고 같은 이유다. 월드맵은 80×80 이라 오늘은 두 축이 같지만, 세계를
 * 옆으로 늘리는 날 이 한 줄이 없으면 지도의 절반이 조용히 사라진다.
 *
 * `density` 는 기기 픽셀비다(`renderScale`). 캔버스를 그 배로 굽고 CSS 크기로
 * 되돌려 놓으면 원본 한 픽셀이 화면 한 픽셀로 떨어진다 — 미니맵이 축소도를
 * 기기 픽셀로 굽는 그 이유이고, 안 하면 배율 2 인 폰에서 두 배로 늘어나 뭉갠다.
 */
export async function worldMapImage(sizePx: number, density: number): Promise<WorldMapImage> {
  mapJsonOnce ??= loadMapJson()
  const map = await mapJsonOnce
  imagesOnce ??= loadImages(map)
  const images = await imagesOnce

  const scale = Math.min(sizePx / map.width, sizePx / map.height)
  const cssWidth = map.width * scale
  const cssHeight = map.height * scale

  const key = `${sizePx}@${density}`
  if (bakedOnce?.key === key) return { canvas: bakedOnce.canvas, cssWidth, cssHeight }

  const canvas = document.createElement('canvas')
  // 올림이다. 반올림하면 마지막 줄·칸이 반 px 잘리는데, 잘리는 쪽이 하필 지도의
  // 가장자리라 "세계가 여기서 끝난다"가 흐려진다(HudScene 의 같은 주석).
  canvas.width = Math.ceil(cssWidth * density)
  canvas.height = Math.ceil(cssHeight * density)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('전체 지도: 2d 컨텍스트를 못 얻었다')

  const drawn = bakeMinimap(ctx, map, (name) => images.get(name), scale * density)
  // 한 조각도 안 그린 채 조용히 끝나면 화면은 빈 상자로 서고, 그것은 "맵이 어두운
  // 곳"과 구분되지 않는다 — `bakeMinimap` 이 센 값을 돌려주는 이유가 이 한 줄이다.
  if (drawn === 0) {
    throw new Error(`전체 지도: "${WORLD_MAP_ID}" 에서 한 조각도 못 그렸다 — 시트 짝짓기를 확인하라`)
  }

  bakedOnce = { key, canvas }
  return { canvas, cssWidth, cssHeight }
}
