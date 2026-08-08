import Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputButton, InputHub } from './InputState.js'

/**
 * 패드 중심에서 이 반경 안이면 방향을 고르지 않는다.
 *
 * 엄지가 패드 한가운데 가만히 놓인 것과 축 하나를 확실히 고른 것을 구별해야
 * 한다 — 안 그러면 손가락을 떼기 전 마지막 미세한 떨림이 엉뚱한 방향으로
 * 캐릭터를 한 걸음 걷게 만든다. 값은 방향 버튼 반지름(26px)의 절반에도
 * 못 미치게 작게 잡았다 — 죽은 영역이 방향 판정 자체를 눈에 띄게 좁히면
 * 안 되기 때문이다.
 */
const PAD_DEAD_ZONE_RADIUS = 12

/**
 * 버튼 하나의 등록 상태: 지금 이 버튼을 쥔 포인터 id(안 쥐었으면 null)와, 놓을 때 할 일.
 *
 * heldBy 를 갖고 있는 이유는 pointerupoutside 핸들러가 "나간 그 포인터가 이 버튼도
 * 쥐고 있었는가" 를 버튼마다 스스로 답하게 해야 하기 때문이다 — 이 파일 밖에서는
 * 쓸 일이 없다.
 */
interface Binding {
  heldBy: number | null
  release(): void
}

/**
 * 터치 버튼을 hub 에 연결한다.
 *
 * KeyboardSource 와 짝을 이루는 장치별 입력 소스이지만 모양이 다르다. 키보드는
 * 매 프레임 상태를 다시 읽지만(update()), 터치는 포인터 이벤트 자체가 신호다 —
 * "이번 프레임에 눌렸는가" 가 아니라 "지금 이 순간 눌렸다/떼졌다" 이기 때문이다.
 * 그래서 update() 가 없다. ControlScene 이 만든 도형에 이벤트를 붙이는
 * bindPad·bindButton 만 있고, hub 에는 이벤트 콜백에서 바로 쓴다.
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
 *    밖으로 드래그해 놓을 때, 또는 터치 손가락이 캔버스 밖에서 들릴 때) →
 *    pointerupoutside. Phaser 에서 이건 개별 게임 오브젝트가 아니라 씬
 *    전체(this.input)에서만 발생하는 이벤트다 — 버튼에 걸어도 절대 불리지
 *    않는다. 그리고 이 이벤트가 주는 건 어느 포인터가 나갔는지뿐, 어느
 *    버튼이었는지는 주지 않는다. 그렇다고 전부 놓으면, 패드를 쥔 손가락이
 *    캔버스 밖에서 떨어질 때마다 A 를 쥔 다른 손가락까지 놓여버린다 — 패드로
 *    걸으며 A 로 채집하는, 이 게임에서 가장 흔한 두 손가락 조작이 매번
 *    끊긴다. 그래서 버튼마다 자신을 누른 포인터의 id 를 기억해 뒀다가, 나간
 *    포인터의 id 와 같을 때만 놓는다.
 *  - 창이 포커스를 잃음(알림 내리기, 앱 전환, 전화 수신) → 이 경우 touchend
 *    류 이벤트 자체가 안 올 수 있다. game.events 의 BLUR/HIDDEN 에서 전부
 *    놓는다.
 */
export class TouchSource {
  /**
   * 버튼마다 하나씩. pointerupoutside 가 "이 포인터를 쥔 버튼만" 골라 놓는 것도,
   * releaseAll 이 "전부" 놓는 것도 이 목록 하나만 훑으면 된다.
   */
  private readonly bindings: Binding[] = []

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hub: InputHub,
  ) {
    // 기본은 마우스 1개 + 터치 포인터 1개뿐이다. 늘리지 않으면 패드를 누른 채
    // A 를 누르는 두 번째 손가락이 아예 추적되지 않아 걸으면서 채집이 불가능하다.
    scene.input.addPointer(2)

    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releasePointer, this)
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this)
    scene.game.events.on(Phaser.Core.Events.HIDDEN, this.releaseAll, this)
  }

  /**
   * 방향 패드를 버튼 네 개가 아니라 표면 하나로 연결한다.
   *
   * 설계 문서(§7)는 "누른 지점에서 가장 가까운 축 방향 하나를 고른다"고
   * 못박는다 — 패드는 하나의 면이지 버튼 네 개가 아니다. 버튼 네 개로
   * 나누면 두 가지가 깨진다.
   *
   * 1. 어느 버튼의 히트 영역도 닿지 않는 패드 정중앙의 사각 사각지대가 생긴다
   *    (버튼은 원인데 각자 반지름만큼 중심에서 떨어져 있으니까).
   * 2. Phaser 는 TOUCH_MOVE 에서 processMoveEvents·processOverOutEvents 만
   *    돌리고 processDownEvents 는 다시 부르지 않는다(InputPlugin.update() 의
   *    TOUCH_MOVE 분기). 그래서 눌린 채로 ◀ 에서 ▲ 로 슬라이드하면 ◀ 은
   *    pointerout 으로 풀리고 ▲ 는 pointerover 만 받을 뿐 pointerdown 을
   *    못 받아 영영 눌리지 않는다.
   *
   * 표면을 하나로 합치면 두 문제 다 사라진다 — 표면 전체가 한 히트 영역이라
   * 사각지대가 없고, 슬라이드는 그 표면 위의 pointermove 이므로 매번 다시
   * 축을 계산할 수 있다.
   */
  bindPad(shape: Phaser.GameObjects.Zone, onDirectionChange: (dir: Direction | null) => void): void {
    const binding: Binding = { heldBy: null, release: () => {} }

    const resolve = (pointer: Phaser.Input.Pointer): Direction | null => {
      const dx = pointer.x - shape.x
      const dy = pointer.y - shape.y
      if (Math.hypot(dx, dy) < PAD_DEAD_ZONE_RADIUS) return null
      // 동률(|dx| === |dy|, 정확히 대각선)이면 세로를 고른다. '>' 비교라
      // 가로가 더 클 때만 가로가 이기고, 같으면 자연히 세로 분기로
      // 떨어진다 — 프레임마다 다른 쪽으로 흔들리지 않으려면 이 갈림이
      // 결정적이어야 한다.
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
      return dy > 0 ? 'down' : 'up'
    }

    const apply = (pointer: Phaser.Input.Pointer): void => {
      const dir = resolve(pointer)
      this.hub.setDir(dir)
      onDirectionChange(dir)
    }

    shape.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (binding.heldBy !== null) return // 이미 다른 손가락이 패드를 쥐고 있다
      binding.heldBy = pointer.id
      apply(pointer)
    })

    // 패드 표면 위에서 손가락이 움직일 때마다 다시 판정한다 — 슬라이드로
    // 방향을 바꾸는 조작이 여기서 나온다. heldBy 로 내가 쥔 포인터인지
    // 확인하는 이유는, 눌리지 않은 채 지나가는 포인터(데스크톱 마우스 호버 등)
    // 까지 방향으로 잡으면 안 되기 때문이다.
    shape.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (binding.heldBy !== pointer.id) return
      apply(pointer)
    })

    binding.release = (): void => {
      binding.heldBy = null
      this.hub.setDir(null)
      onDirectionChange(null)
    }
    shape.on('pointerup', binding.release)
    shape.on('pointerout', binding.release)

    this.bindings.push(binding)
  }

  /** A·B·가방·제작처럼 독립적인 눌림 버튼 하나를 연결한다. */
  bindButton(
    shape: Phaser.GameObjects.GameObject,
    button: InputButton,
    onPressChange?: (pressed: boolean) => void,
  ): void {
    const setVisual = onPressChange ?? (() => {})
    const binding: Binding = { heldBy: null, release: () => {} }

    shape.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      binding.heldBy = pointer.id
      this.hub.setButton(button, true)
      setVisual(true)
    })

    binding.release = (): void => {
      binding.heldBy = null
      setVisual(false)
      this.hub.setButton(button, false)
    }
    shape.on('pointerup', binding.release)
    shape.on('pointerout', binding.release)

    this.bindings.push(binding)
  }

  /**
   * 나간 포인터가 쥐고 있던 버튼만 골라 놓는다. pointerupoutside 전용.
   *
   * 이 이벤트는 씬 전체에서 한 번만 발생하고 어느 포인터가 나갔는지만 알려준다 —
   * 어느 버튼이었는지는 이벤트 자체에 없다. 그래서 반대로 버튼마다 "너를 쥔 게
   * 이 포인터냐" 를 스스로 답하게 하고, 그렇다는 버튼만 놓는다. 두 손가락을 동시에
   * 쓰는 조작(패드+A)에서 관계없는 다른 손가락의 버튼은 자기 포인터가 아니므로
   * 그대로 눌린 채 남는다.
   */
  private releasePointer(pointer: Phaser.Input.Pointer): void {
    for (const binding of this.bindings) {
      if (binding.heldBy === pointer.id) binding.release()
    }
  }

  /**
   * 이 소스가 쥐고 있던 입력을 전부 놓는다.
   *
   * BLUR·HIDDEN(창이 포커스를 잃거나 앱이 백그라운드로 감)과 destroy() 에서 쓴다.
   * 이 경우엔 화면의 모든 손가락이 함께 사라진 것과 같으므로, releasePointer 처럼
   * 포인터를 가려낼 필요 없이 전부 놓는 게 맞다.
   */
  releaseAll(): void {
    this.hub.releaseAll()
    for (const binding of this.bindings) binding.release()
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releasePointer, this)
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this)
    this.scene.game.events.off(Phaser.Core.Events.HIDDEN, this.releaseAll, this)
    this.releaseAll()
  }
}
