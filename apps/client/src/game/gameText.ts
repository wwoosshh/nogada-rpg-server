import type Phaser from 'phaser'
import { textResolution } from './viewport.js'

export type GameTextStyle = Phaser.Types.GameObjects.Text.TextStyle

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
  return scene.add.text(x, y, text, { ...style, resolution: textResolution() })
}
