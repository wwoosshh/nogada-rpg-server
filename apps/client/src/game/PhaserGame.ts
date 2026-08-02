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

/**
 * Phaser 의 설정 객체는 CSS 커스텀 프로퍼티를 직접 읽지 못한다. 그렇다고 배경색을
 * '#241c1c' 로 여기 다시 적으면 tokens.css 의 --c-ink 와 값이 두 곳에 따로 존재하게
 * 되어, tokens.css 자신의 주석이 금지하는 "팔레트 단일 출처 밖에서 색상 리터럴을
 * 쓰는" 상황이 된다. 대신 게임 생성 시점에 실제 문서에서 --c-ink 값을 읽어와
 * 그대로 전달하는 다리 역할만 한다. 값이 비어 있을 때(스타일시트 로드 실패 등)만
 * 최후 수단으로 같은 리터럴을 fallback 으로 둔다.
 */
function readInkColor(): string {
  const fallback = '#241c1c'
  const value = getComputedStyle(document.documentElement).getPropertyValue('--c-ink').trim()
  return value || fallback
}

export function createPhaserGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    roundPixels: true,
    backgroundColor: readInkColor(),
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      zoom: pickIntegerZoom(),
    },
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scene: [WorldScene],
  })
}
