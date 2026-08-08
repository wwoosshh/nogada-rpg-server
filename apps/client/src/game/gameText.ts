import type Phaser from 'phaser'
import { textResolution } from './viewport.js'

export type GameTextStyle = Phaser.Types.GameObjects.Text.TextStyle

/**
 * DOM 과 같은 글꼴을 쓴다. tokens.css 의 `--font-ui` 와 같은 값이어야 하는데,
 * Phaser 설정은 CSS 변수를 읽지 못해서 여기 한 번 더 적는다.
 *
 * Neo둥근모 Pro 는 16 단위 격자로 설계됐다(unitsPerEm = 16). 글자 크기가 16 의
 * 배수가 아니면 획이 반픽셀에 걸려 뭉개지므로, 이 파일을 거치는 모든 글자는
 * FONT_SIZE 의 값만 쓴다.
 */
const FONT_FAMILY = "'NeoDunggeunmo Pro', 'Malgun Gothic', sans-serif"

/**
 * 쓸 수 있는 글자 크기. 16 의 배수만 있다 — 이유는 FONT_FAMILY 주석 참고.
 *
 * 새 크기가 필요하면 여기 16 의 배수로 추가한다. 임의의 숫자를 직접 넘기면
 * 그 글자만 뭉개지고, 화면에서 그 원인을 짚기 어렵다.
 */
export const FONT_SIZE = {
  /** 본문·목록·버튼 라벨 — 기본값 */
  body: 16,
  /** 패널 제목, 이정표 알림 */
  title: 32,
  /**
   * 맵 위 노드 이름표 — **의도적으로 격자를 벗어난 값이다.**
   *
   * 16 은 맵에서 너무 커서 이름표가 타일보다 넓어 보인다. 격자를 지키는 다음
   * 단계는 8 인데(기기 픽셀비 2 에서 8×2 = 16 이라 1 단위 = 1 기기 픽셀), 그건
   * 반대로 너무 작다. 12 는 그 사이를 택한 대신 획이 반픽셀에 걸려 다른 글자보다
   * 살짝 흐릿하다.
   *
   * 이름표는 지도를 읽는 보조 정보이고 패널 본문처럼 오래 들여다보는 글이
   * 아니라서 이쪽을 택했다. 화면에서 거슬리면 8 로 내리는 것이 다음 선택지다.
   */
  caption: 12,
} as const

/**
 * 게임 화면 안의 글자는 전부 이 함수를 거친다.
 *
 * Phaser 는 글자를 별도 캔버스에 그려 텍스처로 올리는데, 그 캔버스의 해상도를
 * 스타일마다 따로 정해야 한다 — `resolution` 을 안 주면 Phaser 가 1 로 강제하고
 * (Text.js 의 `if (this.style.resolution === 0) this.style.resolution = 1`),
 * 게임 설정에서 한 번에 정하는 방법은 없다. 그래서 창구를 하나로 모은다.
 *
 * 폰트를 바꾸는 것도 여기 한 곳이면 된다. 흩어져 있으면 새 화면을 만들 때마다
 * 한 군데씩 빠뜨리고, 빠뜨린 곳만 다른 글꼴로 나온다.
 */
export function addText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  style: GameTextStyle = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: FONT_FAMILY,
    fontSize: `${FONT_SIZE.body}px`,
    ...style,
    resolution: textResolution(),
  })
}
