import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'

/*
 * ControlScene 과 같은 팔레트다(tokens.css 의 --c-panel / --c-panel-edge /
 * --c-accent / --c-parchment / --c-ink). 두 파일이 상수를 공유하지 않고 각자
 * 리터럴로 옮겨 적는 이유는 NodeMarker·FloatingText 와 같다 — ControlScene.ts
 * 상단 주석 참고. 바꿀 때 tokens.css 와 함께 고친다.
 */
const PANEL_COLOR = 0x3a2f2a
const PANEL_EDGE_COLOR = 0x6b5646
const ACCENT_TEXT_COLOR = '#d9a441'
const LABEL_COLOR = '#e8dcc0'
const INK_COLOR = '#241c1c'

/** 배경 위에서도 글자가 또렷이 읽혀야 하므로 컨트롤러 버튼(0.55)보다 훨씬 불투명하다. */
const PANEL_ALPHA = 0.94

/** 상단 바를 침범하지 않을 위쪽 여백. */
const TOP_MARGIN = 40
/**
 * 화면 맨 아래에서 패널이 침범하지 않는 높이.
 *
 * ControlScene 의 가방·제작 토글 줄 윗변은 대략 `height - 192` 다
 * (EDGE_MARGIN_BOTTOM + 버튼 반지름들의 합, ControlScene.ts 의 layout() 참고).
 * 그 버튼들은 패널이 열려 있는 동안에도 계속 눌려야 하므로(닫기·전환) 가려지면
 * 안 된다. 정확한 값을 다시 계산해 맞추는 대신 여유를 더한 근사값을 쓴다 —
 * 실기 확인 전까지는 컨트롤러 치수 자체가 조정 대상이라(설계 문서 §10), 두
 * 파일이 정확히 같은 상수를 공유하게 만드는 비용이 지금은 이득보다 크다.
 */
const BOTTOM_RESERVE = 196
const SIDE_MARGIN = 32
const MAX_WIDTH = 380
const MAX_HEIGHT = 170
/** 극단적으로 낮은 화면에서도 두 줄 글자가 안 뭉개지는 최소 높이. */
const MIN_HEIGHT = 64
const TEXT_PADDING = 16

type PanelId = 'bag' | 'craft'

/** 어느 패널인지와 "아직 안 만들었다"만 말한다 — 내용은 설계 문서 §9 에서 범위 밖이다. */
const PANEL_TEXT: Record<PanelId, { title: string; body: string }> = {
  bag: { title: '가방', body: '아직 만들지 않았습니다.' },
  craft: { title: '제작', body: '아직 만들지 않았습니다.' },
}

/**
 * 가방·제작 버튼이 여는 패널.
 *
 * 설계 문서 §9 는 패널 "내용"을 범위 밖에 두고 "버튼과 열고 닫기"만 남긴다.
 * 그래서 이 씬은 지금 어느 패널이 열려 있는지와 아직 안 만들었다는 것만
 * 보여준다 — 가짜 인벤토리를 꾸미지 않는다.
 *
 * ControlScene 처럼 WorldScene 과 별도인 씬이다 — 이유도 같다. WorldScene 의
 * 카메라 스크롤과 낮밤 명암은 그 씬 안의 오브젝트에만 적용되므로, 별도 씬으로
 * 두면 스크롤을 안 따라가고(화면에 고정) 밤에도 어두워지지 않는다. 패널은
 * "지금 무엇이 열려 있는지"를 밤에도 분명히 보여야 하는 화면이라 컨트롤러와
 * 같은 성질이 필요하다.
 *
 * PhaserGame.ts 의 씬 배열에서 WorldScene 과 ControlScene 사이에 둔다 —
 * World 보다 위에 그려지되(그래서 안 어두워지되) Control 의 버튼(B·가방·제작)은
 * 항상 이 패널보다 위에 그려지게 하기 위해서다. 패널이 열려 있어도 그 세
 * 버튼은 계속 눌려야 하므로(닫기·전환), 레이아웃이 겹치더라도 항상 보이고
 * 눌려야 한다. 실제로는 layout() 이 컨트롤러 버튼 영역을 아예 침범하지 않게
 * 잡으므로 겹칠 일이 없지만, 이 순서는 그 계산이 살짝 어긋나도 버튼이 죽지
 * 않게 하는 두 번째 안전장치다.
 *
 * ControlScene 과 마찬가지로 배열의 두 번째 이후라 자동 시작하지 않는다 —
 * WorldScene.create() 가 명시적으로 launch 한다.
 */
export class PanelScene extends Phaser.Scene {
  private box!: Phaser.GameObjects.Rectangle
  private title!: Phaser.GameObjects.Text
  private body!: Phaser.GameObjects.Text
  private hub: InputHub | null = null
  private open: PanelId | null = null

  constructor() {
    super({ key: 'Panel' })
  }

  create(): void {
    this.box = this.add
      .rectangle(0, 0, MAX_WIDTH, MAX_HEIGHT, PANEL_COLOR, PANEL_ALPHA)
      .setStrokeStyle(2, PANEL_EDGE_COLOR, 1)
      .setVisible(false)

    this.title = this.add
      .text(0, 0, '', {
        fontSize: '18px',
        color: ACCENT_TEXT_COLOR,
        stroke: INK_COLOR,
        strokeThickness: 3,
        fontStyle: 'bold',
        align: 'center',
      })
      .setOrigin(0.5)
      .setVisible(false)

    this.body = this.add
      .text(0, 0, '', {
        fontSize: '13px',
        color: LABEL_COLOR,
        stroke: INK_COLOR,
        strokeThickness: 2,
        align: 'center',
        wordWrap: { width: MAX_WIDTH - TEXT_PADDING * 2 },
      })
      .setOrigin(0.5)
      .setVisible(false)

    this.layout(this.scale.width, this.scale.height)
    this.scale.on('resize', this.handleResize, this)

    // ControlScene 과 같은 이유로 SHUTDOWN·DESTROY 둘 다에 같은 정리를 걸고
    // 두 번째 호출은 가드로 무시한다 — ControlScene.create() 의 주석 참고.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  /**
   * WorldScene 이 자신의 create() 끝에서 한 번 부른다. ControlScene.bind() 와
   * 같은 이유로 미룬다 — 이 씬의 create() 가 끝나야 존재하고, hub 는
   * WorldScene.create() 가 만든다. 두 시점 어느 쪽 생성 시점에도 넘길 수
   * 없으므로 별도 진입점으로 나중에 연결한다.
   */
  bind(hub: InputHub): void {
    if (this.hub) throw new Error('PanelScene.bind 은 한 번만 부를 수 있다')
    this.hub = hub
  }

  /**
   * 매 프레임 WorldScene.update() 가 이동을 처리하기 전에 이 씬을 대신 불러
   * 준다 — 이 씬 자신의 update() 를 쓰지 않는 이유는 씬 갱신 순서 때문이다.
   * Phaser 는 씬 배열 순서대로 각 씬의 update() 를 부르고, hub.beginFrame()
   * 은 WorldScene.update() 의 맨 끝에서 한 번만 불린다(WorldScene.update() 의
   * 주석 참고). 이 씬은 배열에서 WorldScene 뒤에 있으므로(패널을 세계 위에
   * 그리려고 일부러 그렇게 뒀다 — 클래스 문서 참고), 이 씬 자신의 update()
   * 에서 hub.state 를 읽으면 WorldScene 이 이미 그 프레임의 beginFrame() 을
   * 끝낸 뒤라 toggleBagPressed 같은 한 프레임짜리 신호를 영영 못 본다.
   * WorldScene 이 자기 update() 안에서, beginFrame() 보다 먼저, 이 메서드를
   * 직접 불러야 그 순서 문제를 피한다.
   *
   * hub 가 아직 없으면(bind() 가 아직 안 불렸으면) 조용히 넘어간다 — launch()
   * 는 다음 씬 매니저 처리 단계로 미뤄질 수 있어, WorldScene 의 첫 update()
   * 가 이 씬의 create()/bind() 보다 먼저 돌 가능성을 배제할 수 없다.
   */
  applyInput(): void {
    const hub = this.hub
    if (!hub) return

    const state = hub.state
    let next = this.open
    if (state.toggleBagPressed) {
      next = this.open === 'bag' ? null : 'bag'
    } else if (state.toggleCraftPressed) {
      next = this.open === 'craft' ? null : 'craft'
    } else if (state.cancelPressed) {
      // 열린 게 없으면 null → null 이라 아래 비교에서 걸러진다. B 에 다른
      // 취소 대상이 아직 없으므로 "아무 일도 안 함"이 자연히 나온다.
      next = null
    }

    if (next === this.open) return
    this.open = next
    this.render()
    hub.setWorldInputLocked(this.open !== null)
  }

  private render(): void {
    const open = this.open
    if (!open) {
      this.box.setVisible(false)
      this.title.setVisible(false)
      this.body.setVisible(false)
      return
    }

    const content = PANEL_TEXT[open]
    this.title.setText(content.title)
    this.body.setText(content.body)
    this.box.setVisible(true)
    this.title.setVisible(true)
    this.body.setVisible(true)
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layout(gameSize.width, gameSize.height)
  }

  /**
   * 패널 상자를 화면 크기에 맞게 다시 잡는다.
   *
   * 위로는 상단 바, 아래로는 컨트롤러 버튼 묶음을 침범하지 않는 안전 영역을
   * 계산하고 그 안에 상자를 맞춘다 — 가로 화면 전용이라 세로 폭이 늘 좁으므로,
   * 화면이 작아져도 두 영역과 겹치지 않는 게 최우선이다.
   */
  private layout(width: number, height: number): void {
    const safeBottom = Math.max(TOP_MARGIN + MIN_HEIGHT, height - BOTTOM_RESERVE)
    const safeHeight = safeBottom - TOP_MARGIN

    const boxWidth = Math.min(MAX_WIDTH, Math.max(160, width - SIDE_MARGIN * 2))
    const boxHeight = Math.min(MAX_HEIGHT, safeHeight)

    const x = width / 2
    const y = TOP_MARGIN + safeHeight / 2

    this.box.setPosition(x, y).setSize(boxWidth, boxHeight)
    this.title.setPosition(x, y - 16)
    this.body.setPosition(x, y + 12)
    this.body.setWordWrapWidth(boxWidth - TEXT_PADDING * 2)
  }
}
