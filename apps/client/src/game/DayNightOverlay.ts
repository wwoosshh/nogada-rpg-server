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
 * 월드 카메라는 기기 픽셀 배율만큼 확대돼 있으므로(viewport.ts), 이 사각형은
 * 그만큼 작게 그린 뒤 확대되어 화면을 정확히 덮는다.
 */
export class DayNightOverlay {
  private readonly rect: Phaser.GameObjects.Rectangle
  private readonly scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.rect = scene.add
      .rectangle(0, 0, 10, 10, 0x000000, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.dayNight)

    this.fitToCamera()
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

  private handleResize(): void {
    this.fitToCamera()
  }

  /**
   * 확대된 카메라 안에서 화면을 정확히 덮도록 크기와 위치를 잡는다.
   *
   * 크기를 zoom 으로 나누는 것은 확대되어 원래 크기로 돌아오게 하려는 것이고,
   * 좌상단을 중앙 쪽으로 당기는 것은 이 카메라가 화면 중앙을 기준으로 확대하기
   * 때문이다. 둘 중 하나만 하면 사각형이 화면 밖으로 밀리거나 일부만 덮는다.
   */
  private fitToCamera(): void {
    const cam = this.scene.cameras.main
    const w = cam.width / cam.zoom
    const h = cam.height / cam.zoom
    this.rect.setSize(w, h)
    this.rect.setPosition(cam.width * cam.originX - w / 2, cam.height * cam.originY - h / 2)
  }
}
