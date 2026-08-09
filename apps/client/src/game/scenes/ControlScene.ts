import Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputHub } from '../../input/InputState.js'
import { TouchSource } from '../../input/TouchSource.js'
import { addText, FONT_SIZE } from '../gameText.js'
import { renderScale, viewSize } from '../viewport.js'

/*
 * tokens.css 의 --c-panel / --c-panel-edge / --c-accent / --c-parchment / --c-ink 와
 * 같은 색이다. Phaser 도형은 CSS 변수를 직접 못 읽는다 — PhaserGame.ts 가 배경색
 * 하나만 getComputedStyle 로 다리를 놓는 이유도 그것이다. 버튼마다 다리를 놓는
 * 대신 NodeMarker·FloatingText 와 같은 방식으로 값을 리터럴로 옮기고 주석으로
 * 출처를 남긴다. 바꿀 때 tokens.css 와 함께 고친다.
 */
const PANEL_COLOR = 0x3a2f2a
const PANEL_EDGE_COLOR = 0x6b5646
const ACCENT_COLOR = 0xd9a441
const LABEL_COLOR = '#e8dcc0'
const INK_COLOR = '#241c1c'

/** 평소 반투명도. 별도 띠 없이 게임 화면 위에 겹치므로 아래가 비쳐야 한다. */
const BASE_ALPHA = 0.55
/** 눌렸을 때. 겉보기로도 손가락이 인식됐다는 걸 알려준다. */
const PRESSED_ALPHA = 0.85

/** 손가락 최소 크기. 스펙이 명시한 값이다 — 이 아래로 내려가지 않는다. */
const MIN_BUTTON_DIAMETER = 48

/**
 * 화면 맨 아래에서부터의 여백. 안드로이드 제스처 내비게이션 영역과 겹치면
 * 조작 중에 그 스와이프가 먼저 먹어서 앱이 뒤로 가거나 홈으로 나가버린다.
 * 스펙 최소치는 24px 다. 제스처 바 높이는 기기마다 달라서 그 최소치에 딱
 * 맞추지 않고 여유를 더했다 — 32px 는 흔한 제스처 바 높이(대략 24~34px)를
 * 넉넉히 덮는다.
 */
const EDGE_MARGIN_BOTTOM = 32
/** 좌우 여백. 화면 가장자리에 버튼이 딱 붙지 않게 하는 정도의 여유다. */
const EDGE_MARGIN_SIDE = 20

const PAD_DIAMETER = 52
const PAD_RADIUS = PAD_DIAMETER / 2
/**
 * 패드 중심에서 각 방향 버튼 중심까지. 인접한 두 버튼(예: 위·왼쪽)의 중심 거리는
 * 대각선이므로 `PAD_ARM_DIST * √2`(≈62.2) 다. 두 버튼(반지름 26 씩)이 겹치지
 * 않으려면 이 값이 52(반지름 합)보다 커야 하고, 여유 6px 정도를 더 두었다.
 *
 * 방향 버튼 네 개는 이제 순수 시각 요소다 — 히트 테스트는 아래 padSurface
 * 하나가 대신 받는다(TouchSource.bindPad). 이 값은 그 네 원을 어디에
 * 그릴지만 정한다.
 */
const PAD_ARM_DIST = 44
/**
 * 패드 전체를 덮는 정사각 입력 표면의 한 변.
 *
 * 중심에서 가장 먼 방향 버튼의 바깥 가장자리(PAD_ARM_DIST + PAD_RADIUS = 70)
 * 를 반변으로 삼는다 — 네 원이 차지하는 시각적 범위를 정확히 감싸는 정사각형이다.
 * 대각선 모서리(예: 위와 오른쪽 버튼 사이 빈틈)를 눌러도 이 표면 안이므로
 * 죽지 않고, TouchSource 가 거리로 가까운 축 하나를 고른다.
 */
const PAD_SURFACE_SIZE = (PAD_ARM_DIST + PAD_RADIUS) * 2

const ACTION_DIAMETER = 72 // 가장 많이 누르는 버튼이므로 가장 크다.
const ACTION_RADIUS = ACTION_DIAMETER / 2
const CANCEL_DIAMETER = 56
const CANCEL_RADIUS = CANCEL_DIAMETER / 2
const TOGGLE_DIAMETER = MIN_BUTTON_DIAMETER
const TOGGLE_RADIUS = TOGGLE_DIAMETER / 2

/** A → B, 바깥쪽(오른쪽)으로 이동하는 거리. */
const DIAG_STEP_X = 54
/** A → B, 위쪽으로 이동하는 거리. 위 두 값으로 만든 중심 거리(≈73.6)는 두 반지름 합(64)보다 크다. */
const DIAG_STEP_Y = 50
/** B → 가방/제작 행까지 위쪽 거리. */
const TOGGLE_ROW_STEP_Y = 50
/** 가방·제작 사이 절반 간격. */
const TOGGLE_GAP_X = 34
/** A 중심에서 묶음의 가장 바깥(제작 버튼 오른쪽 끝)까지. 화면 오른쪽 여백을 계산할 때 쓴다. */
const CLUSTER_RIGHTMOST_OFFSET = DIAG_STEP_X + TOGGLE_GAP_X + TOGGLE_RADIUS

interface ButtonVisual {
  readonly shape: Phaser.GameObjects.Arc
  readonly label: Phaser.GameObjects.Text
  reposition(x: number, y: number): void
  setPressed(pressed: boolean): void
}

/**
 * 원 하나 + 글자 하나로 버튼 하나를 만든다. 시각 요소만 만들 뿐 히트 테스트는
 * 켜지 않는다 — 인터랙티브 여부와 히트 영역 모양은 호출한 쪽이 정한다
 * (방향 패드는 padSurface 하나가 대신 받고, 오른쪽 버튼 묶음은 원형 히트
 * 영역을 스스로 켠다).
 *
 * `setPressed` 가 자기 `fillColor` 를 클로저로 들고 있어서, 이 함수가 반환한
 * 객체를 어디로 넘기고 `this` 없이 호출해도(예: 콜백으로 그대로 전달) 안전하다.
 */
function createButtonVisual(
  scene: Phaser.Scene,
  radius: number,
  fillColor: number,
  labelText: string,
  fontSize: number,
): ButtonVisual {
  const shape = scene.add
    .circle(0, 0, radius, fillColor, BASE_ALPHA)
    .setStrokeStyle(2, PANEL_EDGE_COLOR, 0.9)

  const label = addText(scene, 0, 0, labelText, {
    fontSize: `${fontSize}px`,
    color: LABEL_COLOR,
    stroke: INK_COLOR,
    strokeThickness: 3,
    fontStyle: 'bold',
    align: 'center',
  }).setOrigin(0.5)

  return {
    shape,
    label,
    reposition(x, y) {
      shape.setPosition(x, y)
      label.setPosition(x, y)
    },
    setPressed(pressed) {
      shape.setFillStyle(fillColor, pressed ? PRESSED_ALPHA : BASE_ALPHA)
    },
  }
}

/**
 * 원으로 그린 버튼의 히트 영역을 실제로 원으로 켠다.
 *
 * `shape.setInteractive()` 를 인자 없이 부르면 Phaser 는 `width`/`height` 로
 * 사각 히트 영역을 만든다(InputPlugin.setHitAreaFromTexture — 텍스처가 없는
 * 도형은 `new Rectangle(0, 0, width, height)`). `Arc` 의 `width`/`height` 는
 * 지름이므로, 그 사각형은 실제로 그려진 원보다 넓다 — 특히 네 모서리가
 * 화면에는 없는 히트 영역이 된다. 이 파일의 반지름 합·중심 거리 주석들이
 * 실제로 참이 되려면 히트 영역도 원이어야 한다.
 *
 * `radius, radius` 를 중심으로 준 것은 우연이 아니다: `Arc` 의 원점은
 * (0.5, 0.5) 이므로 로컬 좌표계에서 도형의 좌상단은 (0, 0), 중심은
 * (radius, radius) 다 — 사각 히트 영역이 `Rectangle(0, 0, width, height)` 를
 * 쓰는 것과 같은 좌표계다.
 */
function setCircularHitArea(shape: Phaser.GameObjects.Arc, radius: number): void {
  shape.setInteractive(new Phaser.Geom.Circle(radius, radius, radius), Phaser.Geom.Circle.Contains)
}

/**
 * 화면 위에 그리는 가상 컨트롤러. 왼쪽 아래에 4방향 패드, 오른쪽 아래에
 * A(행동)·B(취소)·가방·제작 버튼 묶음을 둔다.
 *
 * WorldScene 위에 별도로 띄우는 씬이다 — 월드의 카메라 스크롤과 낮밤 명암은
 * 그 씬의 카메라·오버레이에만 적용되고, 이 씬은 자신의 카메라로 화면에
 * 고정해서 그리므로 둘 다 영향을 받지 않는다. 그래서 컨트롤러가 밤에도
 * 어두워지지 않는다.
 *
 * `PhaserGame.ts` 의 씬 배열에서 `WorldScene` 뒤에 오지만 자동 시작하지
 * 않는다(배열의 두 번째 이후 씬은 Phaser 가 자동으로 시작하지 않는다) —
 * `WorldScene.create()` 가 `this.scene.launch('Control')` 로 띄운다.
 */
export class ControlScene extends Phaser.Scene {
  private dirUp!: ButtonVisual
  private dirDown!: ButtonVisual
  private dirLeft!: ButtonVisual
  private dirRight!: ButtonVisual
  /** 방향 패드의 입력 표면. 시각 요소가 아니라 히트 테스트 전용 Zone 이다 — bind() 참고. */
  private padSurface!: Phaser.GameObjects.Zone
  private btnAction!: ButtonVisual
  private btnCancel!: ButtonVisual
  private btnBag!: ButtonVisual
  private btnCraft!: ButtonVisual
  private touchSource: TouchSource | null = null
  /** setControllerVisible() 의 마지막 값 — 같은 값이면 다시 적용하지 않는다. */
  private controllerVisible = true

  constructor() {
    super({ key: 'Control' })
  }

  create(): void {
    this.dirUp = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '▲', 18)
    this.dirDown = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '▼', 18)
    this.dirLeft = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '◀', 18)
    this.dirRight = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '▶', 18)

    // 방향 버튼 네 개는 순수 시각 요소라 인터랙티브를 켜지 않는다. 대신 이
    // Zone 하나가 패드 전체의 입력을 받는다 — 이유는 bindPad 의 문서 참고.
    // Zone 은 그리지 않으므로 크기가 시각과 어긋나도 눈에 보이지 않는다;
    // PAD_SURFACE_SIZE 가 네 원의 시각적 범위와 맞춰 두는 이유가 그것이다.
    this.padSurface = this.add.zone(0, 0, PAD_SURFACE_SIZE, PAD_SURFACE_SIZE).setInteractive()

    // A 만 강조색이다 — 가장 많이 누르는 버튼이라는 걸 크기에 이어 색으로도 표시한다.
    // 글자 크기가 16 과 32 뿐인 이유는 gameText.FONT_SIZE 문서 참고 — 이 글꼴은
    // 16 단위 격자라 그 배수가 아니면 획이 반픽셀에 걸린다. A 만 큰 글자를 쓴다.
    this.btnAction = createButtonVisual(this, ACTION_RADIUS, ACCENT_COLOR, 'A', FONT_SIZE.title)
    this.btnCancel = createButtonVisual(this, CANCEL_RADIUS, PANEL_COLOR, 'B', FONT_SIZE.body)
    this.btnBag = createButtonVisual(this, TOGGLE_RADIUS, PANEL_COLOR, '가방', FONT_SIZE.body)
    this.btnCraft = createButtonVisual(this, TOGGLE_RADIUS, PANEL_COLOR, '제작', FONT_SIZE.body)
    // 오른쪽 버튼 묶음은 원형 히트 영역을 스스로 켠다 — 이유는
    // setCircularHitArea 의 문서 참고.
    setCircularHitArea(this.btnAction.shape, ACTION_RADIUS)
    setCircularHitArea(this.btnCancel.shape, CANCEL_RADIUS)
    setCircularHitArea(this.btnBag.shape, TOGGLE_RADIUS)
    setCircularHitArea(this.btnCraft.shape, TOGGLE_RADIUS)

    // 게임 좌표는 기기 픽셀이고 이 씬의 상수들은 CSS 픽셀이다. 카메라 원점을
    // (0, 0) 으로 두면 zoom 이 화면 중앙이 아니라 좌상단 기준으로 걸려서, 이
    // 파일의 좌표를 하나도 고치지 않고 배율만 얹을 수 있다. 월드 씬은 플레이어를
    // 화면 중앙에 두어야 해서 원점을 옮기지 못하지만, UI 씬은 스크롤이 없으므로
    // 이렇게 두는 편이 훨씬 단순하다.
    this.cameras.main.setOrigin(0, 0).setZoom(renderScale())

    const view = viewSize(this)
    this.layout(view.width, view.height)
    this.scale.on('resize', this.handleResize, this)

    // 씬이 끝나는 경로가 두 갈래다: WorldScene 의 cleanup 이 명시적으로
    // this.scene.stop('Control') 을 부르면 SHUTDOWN 이 먼저 오고, 그 뒤
    // game.destroy(true) 로 전체가 죽을 때 DESTROY 가 또 온다. 두 번 다
    // 오므로(WorldScene 의 경우와 달리 여기선 실제로 둘 다 발생한다) 같은
    // 정리 함수를 양쪽에 걸고 두 번째 호출은 가드로 무시한다.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
      this.touchSource?.destroy()
      this.touchSource = null
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  /**
   * WorldScene 이 자신의 create() 끝에서 한 번 부른다.
   *
   * 씬 생성 시점(constructor·create())에는 아직 hub 가 없다 — hub 는
   * WorldScene.create() 가 만들고, 이 씬은 WorldScene 이 launch 한 직후에
   * (자신의 create() 가 끝나야) 존재하므로 둘 중 어느 쪽 생성 시점에도
   * 넘길 수 없다. 그래서 별도 진입점으로 나중에 연결한다.
   */
  bind(hub: InputHub): void {
    if (this.touchSource) throw new Error('ControlScene.bind 은 한 번만 부를 수 있다')

    const touchSource = new TouchSource(this, hub)
    this.touchSource = touchSource

    touchSource.bindPad(this.padSurface, (dir) => this.setActiveDirection(dir))

    touchSource.bindButton(this.btnAction.shape, 'action', this.btnAction.setPressed)
    touchSource.bindButton(this.btnCancel.shape, 'cancel', this.btnCancel.setPressed)
    touchSource.bindButton(this.btnBag.shape, 'bag', this.btnBag.setPressed)
    touchSource.bindButton(this.btnCraft.shape, 'craft', this.btnCraft.setPressed)
  }

  /**
   * 패널이나 대사창이 열리고 닫힐 때 그 씬이 부른다(PanelScene.applyWorldLock·
   * DialogueScene.render 참고).
   *
   * **부르는 쪽이 넘기는 것은 자기 열림 여부가 아니라 `!hub.worldInputLocked`
   * 다.** 둘은 동시에 열려 있을 수 있어서(톱니로 패널을 대사창 위에 여는 경우
   * — InputHub.setWorldInputLocked 문서), 각자 자기 상태만 보고 이 함수를 부르면
   * 먼저 닫는 쪽이 아직 열려 있는 화면 위로 컨트롤러를 도로 켠다. 잠금과 이
   * 숨김은 언제나 서로의 반대라, 진실을 한 곳(hub)에 두고 여기서는 받은 값을
   * 그대로 그린다.
   *
   * 왜 숨기는가: 패널이 화면을 거의 다 쓰게 되면서(모바일 조작 설계 문서 §7,
   * PanelScene.ts 클래스 문서) 여덟 버튼 모두 어느 패널이 열려도 그 안에
   * 깔린다. 그런데도 계속 그려 두면 눌러도 반응 없는 유령 버튼이 되고, 이
   * 씬이 PanelScene 보다 나중에 그려지는 순서라(PhaserGame.ts 의 씬 배열)
   * 인터랙티브 상태까지 남겨 두면 오히려 이 버튼이 패널 내용(목록 줄 등)
   * 대신 탭을 가로챈다 — "컨트롤러 버튼을 패널 너머로 누를 수 없어야 한다"는
   * 요구를 어기는 셈이다. setVisible 만으로는 부족하다: Phaser 는 안 보이는
   * 오브젝트의 히트 테스트를 자동으로 막지 않는다.
   *
   * dir·action 은 이미 hub.setWorldInputLocked() 로 세계에 못 미치게 막혀
   * 있지만(InputState.ts), cancel·bag·craft 는 그 잠금을 일부러 피해 간다 —
   * 패널을 닫거나 바꾸는 유일한 통로였기 때문이다. 이제 그 자리를 패널
   * 자신의 닫기 버튼이 대신한다. 화면 버튼과 달리 KeyboardSource(ESC·K·I·C)
   * 는 이 메서드와 무관하게 계속 살아 있다 — hub.setButton() 을 직접 부르지
   * 이 씬의 도형을 거치지 않기 때문이다. 그래서 취소·가방·제작은 키보드로는
   * 패널이 열린 동안에도 여전히 같은 동작을 한다.
   */
  setControllerVisible(visible: boolean): void {
    if (visible === this.controllerVisible) return
    this.controllerVisible = visible

    // 버튼이 손가락 밑에서 사라지므로, 이 소스가 쥐고 있던 것을 여기서 놓는다.
    // Phaser 의 disableInteractive() 는 오브젝트를 _over 목록에서 빼기만 하고
    // pointerout 을 내지 않으므로(InputPlugin.disable), 놓아 주지 않으면 그
    // 버튼은 영영 "눌린 채"로 남는다 — hub.held 가 참으로 굳으면 다음에 그
    // 버튼을 진짜로 눌러도 justPressed 가 아니라서 그 한 번이 통째로 삼켜진다.
    // 대사창이 생기면서 이게 드문 경우가 아니게 됐다: A 로 말을 걸면 그 A 를
    // 누른 바로 그 손가락 밑에서 컨트롤러가 사라지므로, 대화를 마칠 때마다
    // 다음 채집 한 번이 안 먹는다.
    if (!visible) this.touchSource?.releaseAll()

    const visuals: ButtonVisual[] = [
      this.dirUp,
      this.dirDown,
      this.dirLeft,
      this.dirRight,
      this.btnAction,
      this.btnCancel,
      this.btnBag,
      this.btnCraft,
    ]
    for (const btn of visuals) {
      btn.shape.setVisible(visible)
      btn.label.setVisible(visible)
    }
    this.padSurface.setVisible(visible)

    // 방향 버튼 네 개는 애초에 인터랙티브가 아니다(패드 표면 하나가 대신
    // 받는다 — bindPad 문서 참고) — padSurface 와 나머지 네 개(A·B·가방·제작)
    // 만 히트 테스트를 켜고 끈다. setInteractive()/disableInteractive() 는
    // 기존 히트 영역 도형(원·사각형)을 그대로 두고 켜고 끄기만 한다 — Phaser
    // 의 InputPlugin.enable() 은 이미 input 설정이 있으면(비활성 상태여도)
    // setHitArea 를 다시 부르지 않는다.
    const interactive: Phaser.GameObjects.GameObject[] = [
      this.padSurface,
      this.btnAction.shape,
      this.btnCancel.shape,
      this.btnBag.shape,
      this.btnCraft.shape,
    ]
    for (const obj of interactive) {
      if (visible) obj.setInteractive()
      else obj.disableInteractive()
    }
  }

  /**
   * 패드가 고른 방향에 맞는 화살표 하나만 강조한다.
   *
   * 버튼이 넷에서 표면 하나로 줄면서 방향별 pointerdown/up 이 사라져 개별
   * setPressed 를 부를 지점이 없어졌다. 대신 TouchSource 가 방향이 바뀔
   * 때마다(눌림·슬라이드·뗌) 이 콜백으로 알리고, 여기서 해당 화살표만 켜고
   * 나머지는 끈다 — 눌림 표시라는 기존 시각 언어(알파 상승, setPressed)를
   * 그대로 재사용한다. dir 이 null 이면(뗌, 또는 데드존) 넷 다 꺼진다.
   */
  private setActiveDirection(dir: Direction | null): void {
    this.dirUp.setPressed(dir === 'up')
    this.dirDown.setPressed(dir === 'down')
    this.dirLeft.setPressed(dir === 'left')
    this.dirRight.setPressed(dir === 'right')
  }

  private handleResize(): void {
    // 이벤트가 넘겨주는 gameSize 는 기기 픽셀이라 그대로 쓰면 배율만큼 어긋난다.
    const view = viewSize(this)
    this.layout(view.width, view.height)
  }

  /**
   * 버튼 여덟 개를 현재 화면 크기에 맞게 배치한다.
   *
   * 패드는 왼쪽 아래에 십자로, 버튼 묶음은 오른쪽 아래에 A 를 기준점 삼아
   * 바깥쪽 위로 B, 그 위에 가방·제작을 나란히 둔다 — 엄지가 자연히 놓이는
   * 안쪽 아래가 A 이고, 나머지는 엄지를 편 방향(바깥·위)으로 퍼진다.
   */
  private layout(width: number, height: number): void {
    const padCenterX = EDGE_MARGIN_SIDE + PAD_ARM_DIST + PAD_RADIUS
    const padCenterY = height - EDGE_MARGIN_BOTTOM - PAD_ARM_DIST - PAD_RADIUS
    this.dirUp.reposition(padCenterX, padCenterY - PAD_ARM_DIST)
    this.dirDown.reposition(padCenterX, padCenterY + PAD_ARM_DIST)
    this.dirLeft.reposition(padCenterX - PAD_ARM_DIST, padCenterY)
    this.dirRight.reposition(padCenterX + PAD_ARM_DIST, padCenterY)
    this.padSurface.setPosition(padCenterX, padCenterY)

    const actionCenterX = width - EDGE_MARGIN_SIDE - CLUSTER_RIGHTMOST_OFFSET
    const actionCenterY = height - EDGE_MARGIN_BOTTOM - ACTION_RADIUS
    this.btnAction.reposition(actionCenterX, actionCenterY)

    const cancelCenterX = actionCenterX + DIAG_STEP_X
    const cancelCenterY = actionCenterY - DIAG_STEP_Y
    this.btnCancel.reposition(cancelCenterX, cancelCenterY)

    const toggleCenterY = cancelCenterY - TOGGLE_ROW_STEP_Y
    this.btnBag.reposition(cancelCenterX - TOGGLE_GAP_X, toggleCenterY)
    this.btnCraft.reposition(cancelCenterX + TOGGLE_GAP_X, toggleCenterY)
  }
}
