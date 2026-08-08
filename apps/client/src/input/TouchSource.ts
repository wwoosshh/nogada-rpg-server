import Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputButton, InputHub } from './InputState.js'

/**
 * 터치 버튼을 hub 에 연결한다.
 *
 * KeyboardSource 와 짝을 이루는 장치별 입력 소스이지만 모양이 다르다. 키보드는
 * 매 프레임 상태를 다시 읽지만(update()), 터치는 포인터 이벤트 자체가 신호다 —
 * "이번 프레임에 눌렸는가" 가 아니라 "지금 이 순간 눌렸다/떼졌다" 이기 때문이다.
 * 그래서 update() 가 없다. ControlScene 이 만든 도형에 이벤트를 붙이는
 * bindDirection·bindButton 만 있고, hub 에는 이벤트 콜백에서 바로 쓴다.
 *
 * 손가락이 버튼과의 접촉을 잃는 경로를 전부 여기서 막는다:
 *  - 버튼 위에서 정상적으로 뗌 → pointerup.
 *  - 누른 채로 버튼 밖으로 밀려나감 → pointerout. 이게 없으면 화면을 쓸다가
 *    버튼을 벗어나도 눌린 채로 남아 캐릭터가 영원히 걷는다 — 실기에서 가장
 *    흔한 사고다.
 *  - 시스템이 터치를 가로챔(전화, 알림창 당김) → DOM touchcancel. Phaser 는
 *    이걸 touchend 와 같은 경로(processUpEvents/processOutEvents)로 처리하므로
 *    위 두 이벤트로 이미 잡힌다. 따로 구독할 이벤트가 없다.
 *  - 포인터가 캔버스 밖에서 놓임(주로 데스크톱에서 마우스를 누른 채 캔버스
 *    밖으로 드래그해 놓을 때) → pointerupoutside. Phaser 에서 이건 개별
 *    게임 오브젝트가 아니라 씬 전체(this.input)에서만 발생하는 이벤트다 —
 *    버튼에 걸어도 절대 불리지 않는다. 게다가 이 시점엔 어느 버튼 것이었는지도
 *    알 수 없으므로 전부 놓는다.
 *  - 창이 포커스를 잃음(알림 내리기, 앱 전환, 전화 수신) → 이 경우 touchend
 *    류 이벤트 자체가 안 올 수 있다. game.events 의 BLUR/HIDDEN 에서 전부
 *    놓는다.
 */
export class TouchSource {
  /** 버튼마다 "눌림 해제됨" 을 알려줄 시각 콜백. 전체 놓임(releaseAll)에서 전부 부른다. */
  private readonly resetVisuals: Array<() => void> = []

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hub: InputHub,
  ) {
    // 기본은 마우스 1개 + 터치 포인터 1개뿐이다. 늘리지 않으면 패드를 누른 채
    // A 를 누르는 두 번째 손가락이 아예 추적되지 않아 걸으면서 채집이 불가능하다.
    scene.input.addPointer(2)

    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releaseAll, this)
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this)
    scene.game.events.on(Phaser.Core.Events.HIDDEN, this.releaseAll, this)
  }

  /**
   * 방향 패드 버튼 하나를 연결한다.
   *
   * 뗄 때 무조건 null 을 부르지 않는다. 다른 손가락이 이미 다른 방향을 눌러
   * hub 의 방향을 가져간 뒤라면, 내가 뗀다고 그 방향을 끊으면 안 된다.
   * 그래서 "지금 hub 의 방향이 여전히 나인가" 를 확인하고서 끊는다.
   */
  bindDirection(
    shape: Phaser.GameObjects.GameObject,
    dir: Direction,
    onPressChange?: (pressed: boolean) => void,
  ): void {
    const setVisual = onPressChange ?? (() => {})

    shape.on('pointerdown', () => {
      this.hub.setDir(dir)
      setVisual(true)
    })

    const release = (): void => {
      setVisual(false)
      if (this.hub.state.dir === dir) this.hub.setDir(null)
    }
    shape.on('pointerup', release)
    shape.on('pointerout', release)

    this.resetVisuals.push(() => setVisual(false))
  }

  /** A·B·가방·제작처럼 독립적인 눌림 버튼 하나를 연결한다. */
  bindButton(
    shape: Phaser.GameObjects.GameObject,
    button: InputButton,
    onPressChange?: (pressed: boolean) => void,
  ): void {
    const setVisual = onPressChange ?? (() => {})

    shape.on('pointerdown', () => {
      this.hub.setButton(button, true)
      setVisual(true)
    })

    const release = (): void => {
      setVisual(false)
      this.hub.setButton(button, false)
    }
    shape.on('pointerup', release)
    shape.on('pointerout', release)

    this.resetVisuals.push(() => setVisual(false))
  }

  /**
   * 이 소스가 쥐고 있던 입력을 전부 놓는다.
   *
   * pointerupoutside·창 포커스 상실에서 쓴다. 어느 손가락이 어느 버튼 위에
   * 있었는지 이 시점엔 알 수 없으므로 개별 버튼이 아니라 전부를 놓는다 —
   * 과하게 놓는 것이 아무것도 안 놓는 것보다 항상 안전하다.
   */
  releaseAll(): void {
    this.hub.releaseAll()
    for (const reset of this.resetVisuals) reset()
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releaseAll, this)
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this)
    this.scene.game.events.off(Phaser.Core.Events.HIDDEN, this.releaseAll, this)
    this.releaseAll()
  }
}
