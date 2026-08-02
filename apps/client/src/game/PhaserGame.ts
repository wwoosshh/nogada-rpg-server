import Phaser from 'phaser'
import { WorldScene } from './scenes/WorldScene.js'

/**
 * zoom 은 반드시 정수여야 한다.
 * 소수 배율은 픽셀을 뭉개뜨려 픽셀아트를 망친다.
 */
function pickIntegerZoom(): number {
  const dpr = window.devicePixelRatio || 1
  const shortSide = Math.min(window.innerWidth, window.innerHeight)
  if (shortSide * dpr < 600) return 2
  if (shortSide * dpr < 1100) return 3
  return 4
}

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: '#241c1c',
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      zoom: pickIntegerZoom(),
    },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scene: [WorldScene],
  })
}
