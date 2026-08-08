import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'
import { TouchSource } from '../../input/TouchSource.js'

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
 */
const PAD_ARM_DIST = 44

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
 * 원 하나 + 글자 하나로 버튼 하나를 만든다.
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
    .setInteractive()

  const label = scene.add
    .text(0, 0, labelText, {
      fontSize: `${fontSize}px`,
      color: LABEL_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 3,
      fontStyle: 'bold',
      align: 'center',
    })
    .setOrigin(0.5)

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
  private btnAction!: ButtonVisual
  private btnCancel!: ButtonVisual
  private btnBag!: ButtonVisual
  private btnCraft!: ButtonVisual
  private touchSource: TouchSource | null = null

  constructor() {
    super({ key: 'Control' })
  }

  create(): void {
    this.dirUp = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '▲', 18)
    this.dirDown = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '▼', 18)
    this.dirLeft = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '◀', 18)
    this.dirRight = createButtonVisual(this, PAD_RADIUS, PANEL_COLOR, '▶', 18)

    // A 만 강조색이다 — 가장 많이 누르는 버튼이라는 걸 크기에 이어 색으로도 표시한다.
    this.btnAction = createButtonVisual(this, ACTION_RADIUS, ACCENT_COLOR, 'A', 26)
    this.btnCancel = createButtonVisual(this, CANCEL_RADIUS, PANEL_COLOR, 'B', 20)
    this.btnBag = createButtonVisual(this, TOGGLE_RADIUS, PANEL_COLOR, '가방', 11)
    this.btnCraft = createButtonVisual(this, TOGGLE_RADIUS, PANEL_COLOR, '제작', 11)

    this.layout(this.scale.width, this.scale.height)
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

    touchSource.bindDirection(this.dirUp.shape, 'up', this.dirUp.setPressed)
    touchSource.bindDirection(this.dirDown.shape, 'down', this.dirDown.setPressed)
    touchSource.bindDirection(this.dirLeft.shape, 'left', this.dirLeft.setPressed)
    touchSource.bindDirection(this.dirRight.shape, 'right', this.dirRight.setPressed)

    touchSource.bindButton(this.btnAction.shape, 'action', this.btnAction.setPressed)
    touchSource.bindButton(this.btnCancel.shape, 'cancel', this.btnCancel.setPressed)
    touchSource.bindButton(this.btnBag.shape, 'bag', this.btnBag.setPressed)
    touchSource.bindButton(this.btnCraft.shape, 'craft', this.btnCraft.setPressed)
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layout(gameSize.width, gameSize.height)
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
