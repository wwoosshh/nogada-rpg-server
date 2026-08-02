import type Phaser from 'phaser'
import { DEPTH } from './depth.js'

/** tokens.css 의 --c-success / --c-danger 와 같은 값이다. 바꿀 때 함께 고친다. */
const TONE_COLORS = {
  good: '#7fa650',
  bad: '#b4543a',
} as const

const RISE_PX = 28
const DURATION_MS = 900

/**
 * 캐릭터 머리 위에서 떠오르며 사라지는 한 줄.
 *
 * 패널로 알리지 않는 이유는 가로 화면에서 시선이 캐릭터에 머물고, 패널은
 * 그 자체로 화면을 가리기 때문이다.
 */
export function spawnFloatingText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  tone: keyof typeof TONE_COLORS,
): void {
  const label = scene.add
    .text(x, y, text, {
      fontSize: '12px',
      color: TONE_COLORS[tone],
      stroke: '#241c1c',
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.floatingText)

  scene.tweens.add({
    targets: label,
    y: y - RISE_PX,
    alpha: 0,
    duration: DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => label.destroy(),
  })
}
