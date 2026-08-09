import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'
import { useGameStore } from '../../store/gameStore.js'
import { DialogueFlow, speakerName } from '../dialogueFlow.js'
import { addText, FONT_SIZE } from '../gameText.js'
import { renderScale, viewSize } from '../viewport.js'
import type { ControlScene } from './ControlScene.js'

/*
 * PanelScene·ControlScene 과 같은 팔레트다(tokens.css 의 --c-panel /
 * --c-panel-edge / --c-accent / --c-parchment / --c-ink). 세 파일이 상수를
 * 공유하지 않고 각자 리터럴로 옮겨 적는 이유는 ControlScene.ts 상단 주석 참고.
 * 바꿀 때 tokens.css 와 함께 고친다.
 */
const BOX_COLOR = 0x3a2f2a
const BOX_EDGE_COLOR = 0x6b5646
const ACCENT_TEXT_COLOR = '#d9a441'
const LABEL_COLOR = '#e8dcc0'
const INK_COLOR = '#241c1c'

/** 패널과 같은 값 — 게임 화면 위에 겹쳐도 글자가 또렷이 읽혀야 한다. */
const BOX_ALPHA = 0.94

/**
 * 좌·우·아래 여백. PanelScene.PANEL_MARGIN 과 같은 값이고 이유도 같다 —
 * 아래쪽이 안드로이드 제스처 내비게이션 영역과 겹치지 않게 한다.
 */
const MARGIN = 16
/** 상자 안쪽 여백. */
const PADDING = 12
/** 이름줄과 본문 사이. */
const NAME_GAP = 4
/** 아주 좁은 창에서도 상자가 찌그러지지 않는 최소 폭. */
const MIN_WIDTH = 240
/** PanelScene.MAX_PANEL_WIDTH 와 같은 이유의 방어값 — 데스크톱에서 창을 아주 넓게 열었을 때. */
const MAX_WIDTH = 900
/**
 * 본문이 차지할 최소 높이(본문 두 줄).
 *
 * 칸마다 글자 수가 달라도 상자 높이는 그대로여야 한다 — 넘길 때마다 상자가
 * 들썩이면 시선이 매번 다시 자리를 찾아야 한다. 세로 픽셀이 가장 귀한
 * 화면(812×375)이라 두 줄로 잡았다: 그보다 긴 대사는 상자가 그만큼만 자란다.
 */
const MIN_BODY_HEIGHT = 44
/**
 * 본문 아래에 늘 비워 두는 넘김 표시(▼) 자리.
 *
 * 표시를 본문 오른쪽 아래에 그냥 얹으면, 마지막 줄이 폭을 꽉 채운 대사에서만
 * 글자 위에 겹친다 — 되는 대사와 안 되는 대사가 갈리는 종류의 버그라 화면에서
 * 잡기 어렵다. 세로 18px 을 늘 내주고 겹칠 수 없게 만든다.
 */
const CARET_ROW = 18

/** 손가락 최소 크기 — PanelScene.CLOSE_BUTTON_DIAMETER 와 같은 스펙값이다. */
const CLOSE_BUTTON_DIAMETER = 48
const CLOSE_BUTTON_RADIUS = CLOSE_BUTTON_DIAMETER / 2
/** 상자 오른쪽 변에서 닫기 버튼 원 가장자리까지 남기는 여유. */
const CLOSE_BUTTON_MARGIN = 4
/** 글자가 닫기 버튼에 닿지 않도록 본문 폭에서 미리 빼는 틈. */
const CLOSE_TEXT_GAP = 8

/**
 * "탭하면 다음"을 알리는 표시.
 *
 * 마지막 칸에서도 같은 표시를 쓴다 — 마지막 칸의 탭도 하는 일이 같기 때문이다
 * (한 번 더 넘기면 창이 닫힌다, 설계 문서 §10). 표시를 둘로 나누면 플레이어가
 * 배워야 할 기호만 하나 늘고 조작은 하나도 안 바뀐다.
 */
const CARET = '▼'

/**
 * 화면 아래쪽 대사창. 설계 문서 §10 이 이 씬의 명세다.
 *
 * PanelScene 과 같은 자세를 따른다 — 별도 씬, 열려 있는 동안
 * `hub.setWorldInputLocked(true)`, 컨트롤러 숨김. 별도 씬인 이유도 같다:
 * WorldScene 의 카메라 스크롤과 낮밤 명암은 그 씬 안의 오브젝트에만 걸리므로,
 * 밖에 두면 화면에 고정되고 밤에도 어두워지지 않는다. 대사는 밤에 더 읽기
 * 어려워질 이유가 없는 글이다.
 *
 * 패널과 다른 점은 크기다. 패널은 화면을 거의 다 쓰지만 대사창은 아래쪽
 * 한 줄기만 쓴다 — 상대와 지형이 계속 보여야 "그 자리에서 그 사람이 말한다"가
 * 되기 때문이고, 설계 문서 §10 이 "화면 아래쪽"을 명시한다. 대신 넘기는
 * 손가락은 상자 밖도 쓴다: **화면 아무 곳이나 탭하면 다음 칸이다.**
 *
 * 행동 버튼으로 넘기지 않는 이유가 이 화면의 핵심이다 — 이 게임은 숙련도
 * 10,000 이후 플레이어가 A 를 **쥐고 있도록** 훈련시키므로, 쥔 채로 대화가
 * 열리면 발화가 한 프레임에 통째로 넘어간다. 키보드는 행동키로 넘기되 대화가
 * 열린 시점에 눌려 있던 키는 한 번 떼야 먹는다 — 그 규칙의 구현은 DialogueFlow
 * 에 있다(그 클래스 문서 참고). 이 씬은 그 상태 기계에 한 프레임의 입력을
 * 넘기고 결과를 그리기만 한다.
 *
 * `PhaserGame.ts` 의 씬 배열에서 맨 끝이다 — 무엇 위에도 그려져야 하고,
 * 대사창이 열리면 컨트롤러도 패널도 화면에 없으므로 가릴 것과 다툴 일이 없다.
 * 배열의 두 번째 이후라 자동 시작하지 않는다 — WorldScene.create() 가 launch 한다.
 */
export class DialogueScene extends Phaser.Scene {
  private box!: Phaser.GameObjects.Rectangle
  private nameText!: Phaser.GameObjects.Text
  private lineText!: Phaser.GameObjects.Text
  private caret!: Phaser.GameObjects.Text
  private closeButtonShape!: Phaser.GameObjects.Arc
  private closeButtonLabel!: Phaser.GameObjects.Text
  /** 화면 전체를 덮는 히트 영역. "아무 곳이나 탭"이 이것 하나다. */
  private tapZone!: Phaser.GameObjects.Zone

  private hub: InputHub | null = null
  /** 대사창이 열리고 닫힐 때 컨트롤러를 같이 숨기고 보이는 통로 — bind() 참고. */
  private control: ControlScene | null = null
  private readonly flow = new DialogueFlow()

  /**
   * 포인터 이벤트가 남긴 자국. 이벤트 안에서 바로 상태를 바꾸지 않고 여기
   * 적어 두었다가 applyInput() 이 한 프레임에 한 번 소비한다.
   *
   * 그래야 닫기 버튼 위의 탭이 결정적으로 처리된다 — 그 탭은 닫기 버튼과 화면
   * 전체 히트 영역 **둘 다** 맞으므로, 이벤트에서 즉시 처리하면 어느 핸들러가
   * 먼저 불리느냐(Phaser 의 히트 정렬)에 결과가 매달린다. 두 자국을 모아
   * DialogueFlow.step() 에 함께 넘기면 우선순위가 그 상태 기계 안에서 정해지고,
   * 테스트가 그것을 확인한다.
   */
  private tapPending = false
  private closePending = false

  private unsubscribeUtterance: (() => void) | null = null
  /** 지금 화면에 그려져 있는 상태 — 바뀔 때만 다시 그린다(render 참고). */
  private renderedOpen = false
  private renderedLine = ''

  constructor() {
    super({ key: 'Dialogue' })
  }

  create(): void {
    // 만드는 순서가 곧 그리는 순서다(뒤에 만들수록 위). 화면 전체 히트 영역이
    // 맨 아래여야 상자와 닫기 버튼이 그 위에 보인다.
    this.tapZone = this.add
      .zone(0, 0, 0, 0)
      .setOrigin(0, 0)
      // 크기 0 인 Zone 에 인자 없이 setInteractive() 를 부르면 Phaser 가 input 을
      // 아예 안 붙이는 경우가 있었다(ScrollList.hitZone 의 같은 주석, 실측) —
      // 명시적 Rectangle 을 주고 layout() 이 매 리사이즈마다 크기를 갱신한다.
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 0, 0), Phaser.Geom.Rectangle.Contains)
      .setVisible(false)
    this.tapZone.disableInteractive()
    this.tapZone.on('pointerdown', () => {
      this.tapPending = true
    })

    this.box = this.add
      .rectangle(0, 0, 10, 10, BOX_COLOR, BOX_ALPHA)
      .setStrokeStyle(2, BOX_EDGE_COLOR, 1)
      .setVisible(false)

    this.nameText = addText(this, 0, 0, '', {
      fontSize: `${FONT_SIZE.body}px`,
      color: ACCENT_TEXT_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 2,
      fontStyle: 'bold',
    })
      .setOrigin(0, 0)
      .setVisible(false)

    this.lineText = addText(this, 0, 0, '', {
      fontSize: `${FONT_SIZE.body}px`,
      color: LABEL_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 2,
    })
      .setOrigin(0, 0)
      .setVisible(false)

    this.caret = addText(this, 0, 0, CARET, {
      fontSize: `${FONT_SIZE.body}px`,
      color: ACCENT_TEXT_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 2,
    })
      .setOrigin(1, 1)
      .setVisible(false)

    // 닫기 버튼. 컨트롤러가 숨은 동안 B 를 대신하는 유일한 손가락 통로다 —
    // 패널이 자기 닫기 버튼을 갖는 것과 같은 이유다(PanelScene 클래스 문서).
    // 키보드(ESC·K)는 컨트롤러와 무관하게 계속 살아 있다.
    this.closeButtonShape = this.add
      .circle(0, 0, CLOSE_BUTTON_RADIUS, BOX_COLOR, BOX_ALPHA)
      .setStrokeStyle(2, BOX_EDGE_COLOR, 1)
      .setVisible(false)
    // Arc 에 인자 없는 setInteractive() 를 부르면 지름을 변으로 하는 **사각**
    // 히트 영역이 된다(ControlScene.setCircularHitArea 문서). 원으로 명시한다.
    this.closeButtonShape.setInteractive(
      new Phaser.Geom.Circle(CLOSE_BUTTON_RADIUS, CLOSE_BUTTON_RADIUS, CLOSE_BUTTON_RADIUS),
      Phaser.Geom.Circle.Contains,
    )
    this.closeButtonShape.on('pointerdown', () => {
      this.closePending = true
    })

    this.closeButtonLabel = addText(this, 0, 0, '✕', {
      fontSize: `${FONT_SIZE.title}px`,
      color: ACCENT_TEXT_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 3,
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setVisible(false)

    // ControlScene·PanelScene 과 같은 이유로 카메라 원점을 좌상단에 둔다 — 이
    // 파일의 좌표를 하나도 고치지 않고 기기 픽셀 배율만 얹기 위해서다.
    this.cameras.main.setOrigin(0, 0).setZoom(renderScale())

    this.relayout()
    this.scale.on('resize', this.handleResize, this)

    // 서버가 고른 발화가 이 채널로 온다(gameStore 의 Utterance 문서). seq 비교는
    // milestone·menuRequest 채널과 같은 이유다: 같은 상대에게 두 번 말을 걸어
    // 같은 대사가 다시 나와도 "이미 처리했다"로 착각해 무시하지 않는다.
    this.unsubscribeUtterance = useGameStore.subscribe((state, prev) => {
      const utterance = state.utterance
      if (!utterance || utterance.seq === prev.utterance?.seq) return
      this.beginUtterance(utterance.speaker, utterance.lines)
    })

    // ControlScene 과 같은 이유로 SHUTDOWN·DESTROY 둘 다에 같은 정리를 걸고
    // 두 번째 호출은 가드로 무시한다 — ControlScene.create() 의 주석 참고.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
      this.unsubscribeUtterance?.()
      this.unsubscribeUtterance = null
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  /**
   * WorldScene 이 자신의 create() 끝에서 한 번 부른다. PanelScene.bind() 와
   * 완전히 같은 이유로 미룬다 — 그 문서 참고.
   */
  bind(hub: InputHub, control: ControlScene): void {
    if (this.hub) throw new Error('DialogueScene.bind 은 한 번만 부를 수 있다')
    this.hub = hub
    this.control = control
  }

  /** 대사창이 지금 열려 있는가. WorldScene 이 패널 입력을 건너뛸지 정할 때 쓴다. */
  get isOpen(): boolean {
    return this.flow.isOpen
  }

  /**
   * 매 프레임 WorldScene.update() 가 이동을 처리하기 전에 이 씬을 대신 불러
   * 준다 — 이 씬 자신의 update() 를 쓰지 않는 이유는 PanelScene.applyInput() 의
   * 문서와 같다: 이 씬은 배열에서 WorldScene 뒤라, 자기 update() 에서 hub 를
   * 읽으면 이미 그 프레임의 beginFrame() 이 지나간 뒤여서 cancelPressed 같은
   * 한 프레임짜리 신호를 영영 못 본다.
   *
   * hub 가 아직 없으면 조용히 넘어간다 — launch() 가 다음 씬 매니저 처리
   * 단계로 미뤄질 수 있어 WorldScene 의 첫 update() 가 이 씬의 bind() 보다
   * 먼저 돌 가능성을 배제할 수 없다(PanelScene.applyInput() 과 같은 이유).
   */
  applyInput(): void {
    const hub = this.hub
    if (!hub) return

    const tapped = this.tapPending
    const closed = this.closePending
    this.tapPending = false
    this.closePending = false

    // 창이 닫혀 있어도 step 을 부른다 — 행동키 상태를 계속 따라가야 다음
    // 대화가 "이미 눌려 있었다"를 정확히 안다(DialogueFlow.step 문서).
    // 닫혀 있는 동안의 탭·닫기는 그 안에서 무시된다.
    this.flow.step({
      // state.action 이 아니라 isHeld 다 — 창이 열려 있는 동안은 우리가 건
      // 잠금 때문에 state.action 이 언제나 false 다(InputHub.isHeld 문서).
      actionDown: hub.isHeld('action'),
      tapped,
      // B 의 의미는 여전히 하나다 — 열려 있으면 닫는다. 패널이 같은 프레임에
      // 이 B 를 또 먹지 않도록 WorldScene 이 순서를 정한다(그쪽 update 참고).
      closed: closed || hub.state.cancelPressed,
    })

    this.render()
  }

  /**
   * 서버가 고른 발화를 화면에 올린다. utterance 채널 구독이 부른다.
   *
   * 행동키의 눌림 상태를 **여기서** 읽어 상태 기계에 넘기는 것이 "쥔 채로 열어도
   * 안 넘어간다"의 시작점이다(DialogueFlow 클래스 문서). 이 함수는 프레임 루프
   * 밖(응답이 도착한 순간)에서 불리므로 한 프레임짜리 신호는 읽을 수 없다 —
   * isHeld 는 상태라서 그 자리에서도 정확하다.
   *
   * render() 를 바로 부르는 이유: 잠금과 컨트롤러 숨김이 다음 프레임까지
   * 미뤄지면 그 한 프레임 동안 세계가 움직인다.
   */
  private beginUtterance(speakerId: string, lines: readonly string[]): void {
    const { data } = useGameStore.getState()
    const actionDown = this.hub?.isHeld('action') ?? false
    this.flow.begin(speakerName(data.speakers, speakerId), lines, actionDown)
    this.render()
  }

  /**
   * 상태 기계가 말하는 것을 화면에 맞춘다.
   *
   * 열림 여부가 바뀐 순간에만 잠금·컨트롤러·표시 여부를 건드리고, 칸이 바뀐
   * 순간에만 글자와 배치를 다시 잡는다. 매 프레임 무조건 다시 그리면
   * setWordWrapWidth 가 Text 캔버스를 통째로 다시 렌더한다 — 60fps 에서 그건
   * 공짜가 아니다.
   */
  private render(): void {
    const box = this.flow.box
    const open = box !== null

    if (open !== this.renderedOpen) {
      this.renderedOpen = open
      for (const piece of this.pieces()) piece.setVisible(open)
      // 안 보이는 히트 영역이 남아 있으면 컨트롤러 버튼 위의 탭을 가로챈다 —
      // Phaser 는 안 보이는 오브젝트의 히트 테스트를 자동으로 막지 않는다
      // (ControlScene.setControllerVisible 의 같은 이유).
      if (open) this.tapZone.setInteractive()
      else this.tapZone.disableInteractive()

      // 열려 있는 동안 이동·행동을 막고 컨트롤러를 숨긴다 — 패널과 같은
      // 자세다(PanelScene.setOpen). 둘은 동시에 열릴 수 없다: 대사창은 앞칸
      // 상호작용으로만 열리는데 그 입력 자체가 패널이 열려 있으면 잠겨 있다.
      this.hub?.setWorldInputLocked(open)
      this.control?.setControllerVisible(!open)
    }

    if (!box) {
      this.renderedLine = ''
      return
    }
    if (box.line === this.renderedLine) return
    this.renderedLine = box.line

    this.nameText.setText(box.speaker)
    this.lineText.setText(box.line)
    this.relayout()
  }

  /**
   * 표시 여부를 함께 켜고 끄는 것들. 히트 영역(tapZone·닫기 버튼)의 인터랙티브
   * 여부는 이것과 별개로 render() 가 다룬다.
   *
   * GameObject 가 아니라 Visible 컴포넌트로 받는 이유: 이 목록에 필요한 것은
   * setVisible 하나뿐이고, GameObject 에는 그게 없다(믹스인이다).
   */
  private pieces(): Phaser.GameObjects.Components.Visible[] {
    return [
      this.tapZone,
      this.box,
      this.nameText,
      this.lineText,
      this.caret,
      this.closeButtonShape,
      this.closeButtonLabel,
    ]
  }

  private handleResize(): void {
    this.relayout()
  }

  /**
   * 지금 화면 크기로 다시 배치한다. `scale.width` 를 직접 쓰지 않는 이유는
   * PanelScene.relayout() 과 같다 — 그건 기기 픽셀이고 이 파일의 상수는 CSS
   * 픽셀이다(viewport.ts).
   */
  private relayout(): void {
    const view = viewSize(this)
    this.layout(view.width, view.height)
  }

  /**
   * 화면 아래쪽에 상자 하나를 놓는다(설계 문서 §10).
   *
   * 높이는 글자가 정한다 — 본문이 두 줄 들어갈 만큼(MIN_BODY_HEIGHT)을 바닥
   * 삼고, 더 긴 대사면 그만큼만 자란다. 세로 픽셀이 가장 귀한 자원이라
   * 상자에게 고정된 큰 몫을 미리 떼어 주지 않는다.
   */
  private layout(width: number, height: number): void {
    // 화면 전체 히트 영역 — "아무 곳이나 탭"이라 상자와 무관하게 화면 전체다.
    this.tapZone.setPosition(0, 0).setSize(width, height)
    // Zone 의 setInteractive() 는 호출 시점의 width/height 로 히트 영역을
    // 스냅샷한다(PanelScene.layout 의 같은 주석) — setSize 는 그 스냅샷을
    // 따라오지 않으므로 리사이즈마다 직접 갱신한다.
    const zoneHitArea = this.tapZone.input?.hitArea as Phaser.Geom.Rectangle | undefined
    zoneHitArea?.setTo(0, 0, width, height)

    const boxWidth = Phaser.Math.Clamp(width - MARGIN * 2, MIN_WIDTH, MAX_WIDTH)
    const boxLeft = (width - boxWidth) / 2

    const closeCenterX = boxLeft + boxWidth - CLOSE_BUTTON_MARGIN - CLOSE_BUTTON_RADIUS
    const textLeft = boxLeft + PADDING
    const textWidth = Math.max(
      0,
      closeCenterX - CLOSE_BUTTON_RADIUS - CLOSE_TEXT_GAP - textLeft,
    )
    // 줄바꿈 폭을 먼저 정해야 아래의 lineText.height 가 이 폭 기준으로 나온다.
    this.lineText.setWordWrapWidth(textWidth)

    const nameHeight = this.nameText.height
    const bodyHeight = Math.max(MIN_BODY_HEIGHT, this.lineText.height)
    const boxHeight = PADDING * 2 + nameHeight + NAME_GAP + bodyHeight + CARET_ROW
    const boxTop = height - MARGIN - boxHeight

    this.box.setPosition(boxLeft + boxWidth / 2, boxTop + boxHeight / 2).setSize(boxWidth, boxHeight)
    this.nameText.setPosition(textLeft, boxTop + PADDING)
    this.lineText.setPosition(textLeft, boxTop + PADDING + nameHeight + NAME_GAP)
    // 넘김 표시는 본문 아래 자기 줄(CARET_ROW)의 오른쪽 끝. 본문 칸 안이라
    // 닫기 버튼과도 겹치지 않는다 — textWidth 가 이미 그 자리를 빼 놓았다.
    this.caret.setPosition(textLeft + textWidth, boxTop + boxHeight - PADDING)

    const closeCenterY = boxTop + boxHeight / 2
    this.closeButtonShape.setPosition(closeCenterX, closeCenterY)
    this.closeButtonLabel.setPosition(closeCenterX, closeCenterY)
  }
}
