import Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputButton, InputHub } from './InputState.js'
import { padDirection } from './padDirection.js'

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

    /**
     * 눌린 지점을 패드 중심 기준 오프셋으로 옮겨 방향을 고른다.
     *
     * **인자가 pointer 가 아니라 localX/localY 인 것이 이 함수의 전부다.**
     * 한때 여기서 `pointer.x - shape.x` 를 뺐는데, 그 둘은 서로 다른 좌표계다:
     * `pointer.x` 는 캔버스 백킹스토어 픽셀이고 `shape.x` 는 씬 좌표다. 이
     * 게임은 캔버스를 기기 해상도로 그리고 카메라 zoom 으로 되돌리므로
     * (viewport.renderScale, ControlScene 의 setZoom) 기기 픽셀비 2인 화면에서
     * `pointer.x` 는 `shape.x` 의 두 배 공간에 있다. 그래서 패드 중심이 씬
     * 좌표 (90, 273) 일 때 ◀ 를 눌러도 오프셋이 (2, 273) 으로 나와 세로가 늘
     * 이겼다 — 실기에서 위·왼쪽으로는 아예 걸을 수 없었다. 데드존도 같은
     * 이유로 배율만큼 좁아졌다(두 배로 부풀린 벡터를 씬 좌표 반경과 쟀으니까).
     *
     * Phaser 가 인터랙티브 오브젝트의 pointerdown·pointermove 콜백에 2·3번째
     * 인자로 넘겨주는 localX/localY 는 **이미 그 오브젝트의 로컬 좌표**다 —
     * 카메라 zoom·스크롤을 Phaser 가 되돌린 뒤(InputManager.hitTest 가
     * camera.getWorldPoint 로 월드 점을 구하고 TransformXY 로 오브젝트 로컬로
     * 옮긴다) displayOrigin 을 더해 준 값이라, 여기서 배율도 카메라도 알 필요가
     * 없다. `pointer.worldX` 나 `camera.getWorldPoint()` 로도 같은 공간을 만들
     * 수 있지만 둘 다 "지금 이 오브젝트를 그리는 카메라가 어느 것이냐" 를 이
     * 자리에서 옳게 고르는 데 달려 있다 — 씬이 넷인 이 게임에서 다시 틀리기
     * 쉬운 선택이다. 로컬 좌표는 고를 것 자체가 없어서 다시 틀릴 수가 없다.
     *
     * 중심을 `shape.displayOriginX/Y` 로 빼는 이유: 로컬 좌표계에서 도형의
     * 좌상단이 (0, 0) 이고 `setPosition()` 이 놓은 지점(= 패드 중심)이 바로
     * displayOrigin 이다. Zone 의 크기나 origin 을 나중에 바꿔도 같이 따라간다.
     */
    const apply = (localX: number, localY: number): void => {
      const dir = padDirection(
        localX - shape.displayOriginX,
        localY - shape.displayOriginY,
        PAD_DEAD_ZONE_RADIUS,
      )
      this.hub.setDir('touch', dir)
      onDirectionChange(dir)
    }

    shape.on('pointerdown', (pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      if (binding.heldBy !== null) return // 이미 다른 손가락이 패드를 쥐고 있다
      binding.heldBy = pointer.id
      apply(localX, localY)
    })

    // 패드 표면 위에서 손가락이 움직일 때마다 다시 판정한다 — 슬라이드로
    // 방향을 바꾸는 조작이 여기서 나온다. heldBy 로 내가 쥔 포인터인지
    // 확인하는 이유는, 눌리지 않은 채 지나가는 포인터(데스크톱 마우스 호버 등)
    // 까지 방향으로 잡으면 안 되기 때문이다.
    shape.on('pointermove', (pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
      if (binding.heldBy !== pointer.id) return
      apply(localX, localY)
    })

    binding.release = (): void => {
      binding.heldBy = null
      this.hub.setDir('touch', null)
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
      this.hub.setButton('touch', button, true)
      setVisual(true)
    })

    binding.release = (): void => {
      binding.heldBy = null
      setVisual(false)
      this.hub.setButton('touch', button, false)
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
   * BLUR·HIDDEN(창이 포커스를 잃거나 앱이 백그라운드로 감), destroy(), 그리고
   * ControlScene.setControllerVisible(false) 에서 쓴다. 이 경우엔 화면의 모든
   * 손가락이 함께 사라진 것과 같으므로, releasePointer 처럼 포인터를 가려낼
   * 필요 없이 전부 놓는 게 맞다.
   *
   * **놓는 범위는 이 소스까지다.** hub 에 `'touch'` 를 넘기는 것이 그 뜻이다 —
   * 사라진 것은 화면의 버튼이지 PC 개발자의 손가락 밑에 있는 물리 키가 아니다.
   * 예전에는 인자 없는 hub.releaseAll() 이라 키보드가 누르고 있던 행동키까지
   * 함께 놓았고, KeyboardSource 는 다시 말해 주지 않으므로(그 파일 문서) 대화를
   * 마칠 때마다 쥐고 있던 A 가 죽었다.
   */
  releaseAll(): void {
    this.hub.releaseAll('touch')
    for (const binding of this.bindings) binding.release()
  }

  destroy(): void {
    this.scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.releasePointer, this)
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this)
    this.scene.game.events.off(Phaser.Core.Events.HIDDEN, this.releaseAll, this)
    this.releaseAll()
  }
}
