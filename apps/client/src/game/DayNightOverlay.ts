import type Phaser from 'phaser'
import { skyShade } from '@nogada/shared'
import { DEPTH } from './depth.js'

/**
 * 자정의 최대 어둠. 1 이면 화면이 완전히 검어져 아무것도 안 보인다.
 * 밤이 밤답게 어둡되 플레이는 가능한 선이다.
 */
const MAX_NIGHT_ALPHA = 0.55

/**
 * 화면 전체를 덮는 낮밤 명암.
 *
 * 카메라에 고정하므로 맵을 스크롤해도 따라다니지 않고 화면에 붙어 있다.
 * 자체 시간을 세지 않고 매 프레임 받은 값을 그리기만 한다.
 *
 * setScrollFactor(0) 은 카메라 스크롤에서만 벗어나고 줌에서는 벗어나지 않는다.
 * 지금은 카메라 줌을 쓰지 않아 무해하지만, 나중에 camera.setZoom(n) 을 쓰게 되면
 * 이 사각형 크기를 cam.width / cam.zoom, cam.height / cam.zoom 으로 다시 맞춰야
 * 화면 전체를 덮는다.
 */
export class DayNightOverlay {
  private readonly rect: Phaser.GameObjects.Rectangle
  private readonly scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    const cam = scene.cameras.main
    this.rect = scene.add
      .rectangle(0, 0, cam.width, cam.height, 0x000000, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.dayNight)

    scene.scale.on('resize', this.handleResize, this)
  }

  /** 게임 시각(분)을 받아 명암을 갱신한다. */
  update(minuteOfDay: number): void {
    const { darkness, color } = skyShade(minuteOfDay)
    this.rect.setFillStyle(color, darkness * MAX_NIGHT_ALPHA)
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this)
    this.rect.destroy()
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.rect.setSize(gameSize.width, gameSize.height)
  }
}
