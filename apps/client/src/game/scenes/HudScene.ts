import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'
import { useGameStore } from '../../store/gameStore.js'
import { addText, FONT_SIZE } from '../gameText.js'
import { BAND, questBandView } from '../questBand.js'
import { renderScale, viewSize } from '../viewport.js'
import type { ControlScene } from './ControlScene.js'

/*
 * ControlScene·PanelScene 과 같은 팔레트다(tokens.css 의 --c-panel /
 * --c-panel-edge / --c-parchment / --c-ink). 세 파일이 상수를 공유하지 않고
 * 각자 리터럴로 옮겨 적는 이유는 ControlScene.ts 상단 주석 참고 — Phaser 도형은
 * CSS 변수를 못 읽는다. 바꿀 때 tokens.css 와 함께 고친다.
 */
const PANEL_COLOR = 0x3a2f2a
const PANEL_EDGE_COLOR = 0x6b5646
const LABEL_COLOR = '#e8dcc0'
const INK_COLOR = '#241c1c'

/**
 * 띠의 반투명도.
 *
 * 컨트롤러 버튼(0.55)보다 진하고 패널(0.94)보다 옅다. 진해야 하는 이유는 이것이
 * **읽어야 하는 글**이기 때문이고(버튼은 모양만 보이면 된다), 그렇다고 패널만큼
 * 막지 않는 이유는 이 띠가 게임 화면 위에 상시로 겹쳐 있기 때문이다 — 아래에서
 * 무엇이 움직이는지는 비쳐야 한다.
 */
const BAND_ALPHA = 0.8

/** 화면 오른쪽 끝에 띠가 딱 붙지 않게 남기는 여백. 미니맵의 왼쪽 여백(설계 ⑤ 의 left:9)과 같다. */
const EDGE_MARGIN_RIGHT = 9

/**
 * 헤더 밑 한 줄짜리 띠 — 지금 걸린 스토리 마디의 목적을 적는다(설계 ⑧-6).
 *
 * **왜 DOM 이 아니라 Phaser 인가**(설계 ⑤): 낮밤 명암·날씨의 영향을 자동으로
 * 벗어나고, 패널이 열릴 때 숨는 규칙을 그대로 쓰며, **App.tsx 불가침**을 안
 * 민다. 여기에 하나 더 — 이 씬은 미니맵(설계 ⑤ · (9,39) 116×116)이 들어올
 * 자리이기도 하다. 띠의 x=131 은 그 미니맵 오른쪽이라는 뜻이고, 둘은 헤더 밑
 * 같은 한 줄이라 같은 씬에 산다.
 *
 * ControlScene·PanelScene 과 같은 자세의 UI 씬이다 — WorldScene 과 별도라
 * 카메라 스크롤을 안 따라가고(화면에 고정) 밤에도 어두워지지 않는다. 배열의
 * 두 번째 이후라 자동 시작하지 않고 WorldScene.create() 가 launch·bind 한다.
 *
 * **띠는 셋 중 하나라도 참이면 안 뜬다**: 사슬이 끝났다 · 지금 마디가
 * `discoverable` 이 아니다(둘 다 questBandView 가 null 로 답한다) · 세계 입력이
 * 잠겼다(패널·대사창). 마지막 것을 이 씬이 스스로 재는 이유는 update() 문서에
 * 적었다.
 */
export class HudScene extends Phaser.Scene {
  private box!: Phaser.GameObjects.Rectangle
  private label!: Phaser.GameObjects.Text
  private hub: InputHub | null = null
  /** 마디 1 동안 A 에 테두리를 붙이는 통로 — bind() 참고. */
  private control: ControlScene | null = null
  private unsubscribeStore: (() => void) | null = null

  /** 지금 적을 글. null 이면 적을 것이 없다(사슬이 끝났거나 유도등이 꺼진 마디다). */
  private line: string | null = null
  /** 마지막으로 본 세계 잠금 — update() 가 매 프레임 다시 그리지 않게 한다. */
  private locked = false

  constructor() {
    super({ key: 'Hud' })
  }

  create(): void {
    this.box = this.add
      .rectangle(0, 0, 10, 10, PANEL_COLOR, BAND_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(1, PANEL_EDGE_COLOR, 1)
      .setVisible(false)

    // 글자는 세로 가운데 정렬이라 원점이 (0, 0.5) 다 — 띠 높이(24)가 바뀌어도
    // 글자가 따라 가운데에 남는다.
    this.label = addText(this, 0, 0, '', {
      fontSize: `${FONT_SIZE.body}px`,
      color: LABEL_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 2,
    })
      .setOrigin(0, 0.5)
      .setVisible(false)

    // ControlScene 과 같은 이유로 카메라 원점을 (0, 0) 으로 둔다 — 이 씬은
    // 스크롤이 없으므로 이 파일의 좌표를 CSS 픽셀 그대로 쓸 수 있다.
    this.cameras.main.setOrigin(0, 0).setZoom(renderScale())

    this.layout(viewSize(this).width)
    this.scale.on('resize', this.handleResize, this)

    // ControlScene 과 같은 이유로 SHUTDOWN·DESTROY 둘 다에 같은 정리를 걸고 두
    // 번째 호출은 가드로 무시한다 — 그 파일의 create() 주석 참고. 여기서 hub·
    // control 을 놓는 이유도 PanelScene 의 cleanup 과 같다: 맵을 넘을 때마다
    // 이 씬이 다시 시작하는데, 놓지 않으면 bind() 가 "두 번 불렸다"며 던진다.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
      this.hub = null
      this.control = null
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  /**
   * WorldScene 이 자신의 create() 끝에서 한 번 부른다 — ControlScene.bind()·
   * PanelScene.bind() 와 같은 이유로 미룬다(그 문서 참고).
   *
   * `control` 을 함께 받는 이유는 패널·대사창과 다르다: 저쪽은 컨트롤러를
   * **숨기려고** 받고, 여기는 A 에 **테두리를 붙이려고** 받는다. 띠에 적는 마디와
   * 테두리가 붙는 마디는 같은 판정 하나에서 나와야 한다(questBandView) — 두
   * 곳에서 각자 정하면 화면이 「앞에서 A」라고 적어 놓고 테두리는 딴 데 있는 날이
   * 온다.
   */
  bind(hub: InputHub, control: ControlScene): void {
    if (this.hub) throw new Error('HudScene.bind 은 한 번만 부를 수 있다')
    this.hub = hub
    this.control = control

    // 스토어의 `player` 는 서비스 응답마다 새 객체로 갈린다. 그 참조가 그대로면
    // 사슬도 그대로이므로 다시 계산하지 않는다 — 이 구독은 시계·연결 상태 같은
    // 남의 변화에도 불리고, 사슬을 펴는 계산(storyChainOf)은 마을 유도와 슬롯
    // 펴기를 포함한다. 행동 한 번에 한 번이면 서버가 훅에서 이미 내는 값과 같은
    // 비용이고, 프레임마다면 아니다.
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      if (state.player === prev.player) return
      this.render()
    })

    // 구독은 "바뀔 때"만 불린다 — PanelScene.bind() 와 같은 이유로 지금 값도 한
    // 번 반영한다. 맵을 넘어 이 씬이 다시 선 직후가 정확히 그 자리다.
    this.render()
  }

  /**
   * 세계 입력이 잠겨 있으면 띠를 숨긴다.
   *
   * **패널·대사창이 이 씬을 부르지 않는다.** 잠금의 주인은 hub 하나이고
   * (InputHub.setWorldInputLocked), 그 값은 한 프레임짜리 신호가 아니라 상태라
   * 여기서 읽어도 놓칠 것이 없다. 컨트롤러처럼 부르는 쪽을 늘리면 그 자리가
   * 셋이 되고(PanelScene·DialogueScene·앞으로 세계를 잠글 무엇), 그 셋 중 하나만
   * 고쳐지는 날 띠가 패널 위에 남는다 — 잠금 주인이 흩어졌을 때 실제로 났던
   * 사고와 같은 모양이다(PanelScene.applyWorldLock 문서).
   *
   * 숨겨야 하는 이유는 자리다: 패널의 윗변이 y=40 이고(PanelScene.TOP_MARGIN)
   * 띠는 39~63 이라, 안 숨기면 패널 위로 한 줄이 떠 있게 된다.
   */
  update(): void {
    const locked = this.hub?.worldInputLocked ?? false
    if (locked === this.locked) return
    this.locked = locked
    this.applyVisibility()
  }

  /** 스토어의 지금 값을 띠와 A 테두리에 한꺼번에 비춘다. */
  private render(): void {
    const { data, player } = useGameStore.getState()
    const view = questBandView(data, player)
    this.line = view.line
    // 빈 글로 덮지 않는다 — 안 보이는 동안 글자를 지워 봐야 달라지는 것이 없고,
    // 다시 뜰 때 한 프레임 빈 띠가 보일 여지만 생긴다.
    if (view.line !== null) this.label.setText(view.line)
    this.control?.setActionHighlighted(view.teachAction)
    this.applyVisibility()
  }

  private applyVisibility(): void {
    const show = this.line !== null && !this.locked
    this.box.setVisible(show)
    this.label.setVisible(show)
  }

  private handleResize(): void {
    // ControlScene 과 같은 이유로 gameSize 를 안 쓴다 — 그 값은 기기 픽셀이다.
    this.layout(viewSize(this).width)
  }

  /**
   * 띠를 지금 화면 폭에 맞춘다.
   *
   * 폭은 설계값(672)을 **넘지 않되**, 화면이 그보다 좁으면 남는 만큼만 쓴다.
   * 812×375 에서는 131 + 672 + 9 = 812 로 정확히 설계값이고, 개발용으로 창을
   * 좁게 연 데스크톱에서만 줄어든다 — 그 경우에도 띠가 화면 밖으로 나가지
   * 않는다는 것이 이 한 줄이 사는 이유다.
   *
   * 글자는 **자르지 않는다.** 잘린 안내는 안내가 아니고, 넘칠 일이 없다는 것은
   * 검사가 빌드에서 지킨다(questBand.test.ts 의 폭 예산 — 마을 넷 × 마디 전부).
   */
  private layout(width: number): void {
    const bandWidth = Math.min(BAND.width, Math.max(0, width - BAND.x - EDGE_MARGIN_RIGHT))
    this.box.setPosition(BAND.x, BAND.y).setSize(bandWidth, BAND.height)
    this.label.setPosition(BAND.x + BAND.padding, BAND.y + BAND.height / 2)
  }
}
