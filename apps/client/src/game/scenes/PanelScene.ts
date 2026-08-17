import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'
import { useGameStore } from '../../store/gameStore.js'
import {
  DIM_COLOR,
  MILESTONE_FOLD,
  SETTINGS_ACTION,
  TABS,
  type DetailMenuTab,
} from '../detailMenuTabs.js'
import { addText, FONT_SIZE } from '../gameText.js'
import { PANEL_BOX, panelBoxRect, panelListRect } from '../panelBox.js'
import { ScrollList } from '../ScrollList.js'
import { renderScale, viewSize } from '../viewport.js'
import type { ControlScene } from './ControlScene.js'

/*
 * ControlScene 과 같은 팔레트다(tokens.css 의 --c-panel / --c-panel-edge /
 * --c-accent / --c-parchment / --c-parchment-dim / --c-success / --c-ink).
 * 두 파일이 상수를 공유하지 않고 각자 리터럴로 옮겨 적는 이유는
 * NodeMarker·FloatingText 와 같다 — ControlScene.ts 상단 주석 참고. 바꿀 때
 * tokens.css 와 함께 고친다.
 *
 * DIM_COLOR 만 예외로 detailMenuTabs.ts 에서 import 한다 — 그 파일의 탭
 * 내용(이정표·숙련도 줄)도 같은 색을 쓰고, 원래 이 파일 안의 코드였던 것을
 * 구조만 나눈 것이라 리터럴을 다시 옮겨 적지 않는다(이 주석의 "두 파일" 은
 * PanelScene 과 ControlScene 처럼 애초에 별개였던 파일들 얘기다).
 */
const PANEL_COLOR = 0x3a2f2a
const PANEL_EDGE_COLOR = 0x6b5646
const ACCENT_COLOR = 0xd9a441
const ACCENT_TEXT_COLOR = '#d9a441'
const INK_COLOR = '#241c1c'

/** 배경 위에서도 글자가 또렷이 읽혀야 하므로 컨트롤러 버튼(0.55)보다 훨씬 불투명하다. */
const PANEL_ALPHA = 0.94

/*
 * 카드의 치수(위쪽 여백·세 면 여백·최소/최대 폭·헤더 줄 높이)는 panelBox.ts 에
 * 있다 — 각 값이 왜 그 수인지도 그 파일에 적었다.
 *
 * **이 파일 밖으로 뺀 이유는 자다.** 이 카드는 화면 위쪽에서 미니맵 상자와
 * 겹치고, 그 겹침이 「닫힌 패널이 입력을 먹으면 무엇이 죽는가」를 정한다.
 * 그 물음은 좌표만으로 답할 수 있는데 상수가 씬 안의 리터럴인 동안에는 잴
 * 방법이 없었다(minimap.ts 가 MINIMAP 을 밖에 둔 것과 같은 이유).
 */
const TOP_MARGIN = PANEL_BOX.topMargin
const HEADER_HEIGHT = PANEL_BOX.headerHeight

/** 손가락 최소 크기 — ControlScene.MIN_BUTTON_DIAMETER 와 같은 스펙값이다(그 파일 상단 주석과 같은 이유로 이 파일도 리터럴을 다시 옮겨 적는다 — 두 파일은 상수를 공유하지 않는다). */
const CLOSE_BUTTON_DIAMETER = 48
const CLOSE_BUTTON_RADIUS = CLOSE_BUTTON_DIAMETER / 2
/** 박스 오른쪽 변에서 닫기 버튼 원 가장자리까지 남기는 여유. */
const CLOSE_BUTTON_MARGIN = 4
/** 탭 바와 닫기 버튼 사이 최소 틈 — 탭 폭을 계산할 때 이만큼을 닫기 버튼 앞에서 미리 뺀다. */
const TAB_CLOSE_GAP = 4

const TAB_INDICATOR_HEIGHT = 2
const TAB_LABEL_FONT_SIZE = FONT_SIZE.body

/**
 * 탭 정의(TABS)·탭 id 타입(DetailMenuTab)·탭 내용을 만드는 함수들은
 * detailMenuTabs.ts 에 있다 — Phaser 와 무관한 내용 조립이라 이 씬 밖으로
 * 뺐다(그 파일 상단 주석이 이유를 설명한다). 이 파일은 그 결과를 그리기만
 * 한다: 탭 바를 TABS 에서 만들고(create()), 탭이 바뀌면 그 tab.buildLines()
 * 를 불러 ScrollList 에 넘긴다(rebuildMenuContent()).
 */

interface TabButton {
  id: DetailMenuTab
  label: Phaser.GameObjects.Text
  /** 탭 글자 자체는 짧아 히트 영역이 좁다 — 칸 전체(탭 폭 × 탭 바 높이)를 따로 잡는다. */
  hitZone: Phaser.GameObjects.Zone
}

/**
 * B 가 여는 상세 메뉴(숙련도·이정표·설정) — 그리고 이제 그것만이다.
 *
 * 한때 이 씬이 가방·제작까지 세 패널을 그렸고 "무엇이 열려 있는가"의 주인도
 * 자기 open 필드였다. 지금 그 권위는 **스토어의 `openPanel` 하나다**(설계
 * §8-앞 6): `bag`·`craft` 는 DOM(React — TopBar 가 마운트하는 전면 패널)이
 * 그리고, 이 씬은 `'menu'` 값의 구독자로 격하됐다. 값이 하나라 상호배제는
 * 공짜다 — 가방을 연 채 B 를 누르면 openPanel 이 'menu' 로 덮이며 가방이
 * 닫힌다. 원작에서 특수 메뉴를 호출하는 커먼이벤트 이름이 `[★B]특수메뉴호출`
 * 이고 숙련도 정보 화면이 그 안에 있던 것과 같은 자리다.
 *
 * 그래도 **입력 라우팅은 여전히 이 씬의 applyInput 이다**(설계 §8-앞 7).
 * I(가방)/C(제작)/ESC·B(취소)는 DOM 키보드 리스너가 아니라 기존 InputHub →
 * applyInput 체인이 openPanel 을 읽고 쓴다 — 그래야 대사창 계약(대화 중 I/C
 * 삼킴, B 는 대사창 우선)이 WorldScene 의 가드 한 곳("대사창이 열려 있던
 * 프레임에는 applyInput 을 부르지 않는다")으로 그대로 산다. DOM 패널의 ✕ 와
 * 상단 바 톱니는 스토어 액션(setOpenPanel·openMenu)만 부른다.
 *
 * 세계 잠금·컨트롤러 숨김도 **스토어 구독 한 곳**에서 계산한다(설계 §8-앞 8,
 * applyWorldLock 참고): `lockedBy.panel = (openPanel !== null)`. React 는
 * ControlScene 에 닿을 수 없으므로, DOM ✕ 가 패널을 닫아도 이 구독이 잠금을
 * 풀고 컨트롤러를 되살린다 — 잠금 주인이 흩어지면 "먼저 닫는 쪽이 잠금을
 * 푸는" 버그가 부활한다.
 *
 * B 의 의미는 하나다: 무엇이든(가방·제작·메뉴) 열려 있으면 닫고, 아무것도
 * 없으면 `menu` 를 연다(applyInput 참고) — 휴대폰 뒤로 가기와 같은 규칙이다.
 * 상단 바 톱니는 같은 메뉴를 설정 탭으로 여는 두 번째 입구다(gameStore 의
 * openMenu — MenuRequest 채널이 탭을, openPanel 이 열림을 나른다).
 *
 * 화면을 거의 다 쓴다 — 위로는 상단 바(TOP_MARGIN)만, 나머지 세 면은
 * PANEL_MARGIN 만 남긴다(layout() 참고). 패널이 열려 있는 동안 컨트롤러는
 * 어차피 쓸모가 없다 — dir·action 은 hub 가 잠그고, cancel·bag·craft 로 닫거나
 * 바꾸던 자리는 닫기 버튼(그리고 여전히 살아 있는 키보드 —
 * ControlScene.setControllerVisible 문서 참고)이 대신한다. 그래서 자리를
 * 비켜주는 대신 ControlScene.setControllerVisible() 로 통째로 숨긴다.
 *
 * **대사창과 동시에 열려 있을 수 있다.** 톱니는 대사창이 열려 있는 동안에도
 * 눌리므로 이 패널이 그 위로 열린다 — 그래서 세계 잠금도 컨트롤러 숨김도 이
 * 씬 혼자 정하지 않는다(applyWorldLock 참고).
 *
 * ControlScene 처럼 WorldScene 과 별도인 씬이다 — 이유도 같다. WorldScene 의
 * 카메라 스크롤과 낮밤 명암은 그 씬 안의 오브젝트에만 적용되므로, 별도 씬으로
 * 두면 스크롤을 안 따라가고(화면에 고정) 밤에도 어두워지지 않는다.
 *
 * PhaserGame.ts 의 씬 배열에서 WorldScene 위, ControlScene 아래에 둔다. 자리가
 * 필요한 이유는 World 보다 위에 그려져야 한다는 것 하나뿐이다(그래야 낮밤
 * 명암 밖에 있다 — 위 문단). ControlScene 과 마찬가지로 배열의 두 번째
 * 이후라 자동 시작하지 않는다 — WorldScene.create() 가 명시적으로 launch 한다.
 */
export class PanelScene extends Phaser.Scene {
  private panelBox!: Phaser.GameObjects.Rectangle
  private closeButtonShape!: Phaser.GameObjects.Arc
  private closeButtonLabel!: Phaser.GameObjects.Text

  private tabButtons: TabButton[] = []
  private tabIndicator!: Phaser.GameObjects.Rectangle
  private scrollList!: ScrollList

  private hub: InputHub | null = null
  /** 패널이 열리고 닫힐 때 컨트롤러를 같이 숨기고 보이는 통로 — bind() 참고. */
  private control: ControlScene | null = null
  private menuTab: DetailMenuTab = 'skills'
  /**
   * 지금 펼쳐 둔 접이 머리들(이정표 탭의 「그 뒤의 문」·「칭호」).
   *
   * 메뉴를 **닫을 때** 비운다(render() 참고) — 여는 것은 언제나 접힌 첫 화면이어야
   * 한다. 탭을 오가는 동안은 남겨 둔다: 칭호를 펼쳐 놓고 숙련도를 잠깐 보고 돌아온
   * 사람에게 자기가 편 것을 다시 접어 보이면, 화면이 사람이 한 일을 되돌리는 것이다.
   */
  private readonly expandedFolds = new Set<string>()
  private unsubscribeStore: (() => void) | null = null

  constructor() {
    super({ key: 'Panel' })
  }

  create(): void {
    this.panelBox = this.add
      .rectangle(0, 0, 10, 10, PANEL_COLOR, PANEL_ALPHA)
      .setStrokeStyle(2, PANEL_EDGE_COLOR, 1)
      .setVisible(false)

    this.tabButtons = TABS.map((tab) => {
      const label = addText(this, 0, 0, tab.label, {
        fontSize: `${TAB_LABEL_FONT_SIZE}px`,
        color: DIM_COLOR,
        stroke: INK_COLOR,
        strokeThickness: 2,
        fontStyle: 'bold',
      })
        .setOrigin(0.5)
        .setVisible(false)

      // origin (0,0) + 칸 전체 크기를 히트 영역으로 쓰면 글자 자체의 좁은
      // 경계 대신 탭 칸 전체가 눌린다 — 짧은 라벨("설정")도 넓게 누를 수 있다.
      // 명시적 Rectangle 을 주는 이유는 ScrollList.hitZone 생성부의 주석과
      // 같다 — 크기 0인 Zone 에 인자 없이 setInteractive() 를 부르면 Phaser 가
      // input 자체를 안 붙이는 경우가 있었다(실측). layout() 이 매 리사이즈마다
      // 이 Rectangle 의 크기를 직접 갱신한다.
      const hitZone = this.add
        .zone(0, 0, 0, 0)
        .setOrigin(0, 0)
        .setInteractive(new Phaser.Geom.Rectangle(0, 0, 0, 0), Phaser.Geom.Rectangle.Contains)
      hitZone.on('pointerdown', () => this.selectTab(tab.id))

      return { id: tab.id, label, hitZone }
    })

    this.tabIndicator = this.add
      .rectangle(0, 0, 0, TAB_INDICATOR_HEIGHT, ACCENT_COLOR)
      .setOrigin(0.5, 0)
      .setVisible(false)

    this.scrollList = new ScrollList(this)

    // 닫기 버튼 — 다른 내용(탭·목록) 위에 그려져야 하므로 이 씬에서 가장
    // 마지막에 만든다. 같은 씬 안에서는 만든 순서가 곧 그리는 순서다(뒤에
    // 만들수록 위).
    this.closeButtonShape = this.add
      .circle(0, 0, CLOSE_BUTTON_RADIUS, PANEL_COLOR, PANEL_ALPHA)
      .setStrokeStyle(2, PANEL_EDGE_COLOR, 1)
      .setVisible(false)
    // Arc 의 원점은 (0.5, 0.5) 라 로컬 중심이 (radius, radius) 다 —
    // ControlScene.setCircularHitArea 와 같은 이유로 히트 영역도 원으로, 그
    // 중심 기준으로 켠다. 지름이 고정이라(리사이즈로 크기가 안 바뀐다) 탭
    // hitZone 과 달리 이 히트 영역은 리사이즈마다 다시 잡을 필요가 없다 —
    // layout() 은 위치만 옮긴다.
    this.closeButtonShape.setInteractive(
      new Phaser.Geom.Circle(CLOSE_BUTTON_RADIUS, CLOSE_BUTTON_RADIUS, CLOSE_BUTTON_RADIUS),
      Phaser.Geom.Circle.Contains,
    )
    // 닫기는 스토어 액션 하나다 — setOpenPanel(null) 은 이미 닫혀 있으면 같은
    // 값 가드로 조용히 넘어간다(gameStore). 오브젝트마다 인터랙티브를 껐다
    // 켜지 않는 이유는 그 일을 씬 하나가 대신하기 때문이다 — render() 의
    // `this.input.enabled` 참고.
    this.closeButtonShape.on('pointerdown', () => useGameStore.getState().setOpenPanel(null))

    this.closeButtonLabel = addText(this, 0, 0, '✕', {
      fontSize: `${FONT_SIZE.title}px`,
      color: ACCENT_TEXT_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 3,
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setVisible(false)

    // ControlScene 과 같은 이유로 카메라 원점을 좌상단에 둔다 — 이 파일의 좌표를
    // 하나도 고치지 않고 기기 픽셀 배율만 얹기 위해서다. viewport.ts 참고.
    this.cameras.main.setOrigin(0, 0).setZoom(renderScale())

    // 열림 값이 처음 반영되는 자리는 bind() → render() 다. 그 사이의 한 프레임도
    // 이 씬이 포인터를 먹으면 그것은 곧 미니맵이 안 눌리는 프레임이므로(render()
    // 의 `input.enabled` 주석), 시작 상태를 닫힌 쪽으로 못박는다.
    this.input.enabled = false

    this.relayout()
    this.scale.on('resize', this.handleResize, this)

    // 열림 상태의 주인은 스토어다 — 이 구독 하나가 menu 그리기와 세계 잠금·
    // 컨트롤러 숨김을 전부 반영한다(설계 §8-앞 8: 잠금 주인이 흩어지면 "먼저
    // 닫는 쪽이 잠금을 푸는" 버그가 부활한다). menuRequest(톱니)는 탭만
    // 고른다 — openPanel 을 'menu' 로 덮는 것은 openMenu 액션 자신이 하므로
    // (gameStore), 한 번의 set() 이 두 변화를 함께 싣고 이 구독은 한 번만
    // 불린다. seq 비교는 milestone 채널과 같은 이유다: 같은 tab 을 두 번
    // 연달아 요청해도(톱니를 두 번 누름) "이미 처리함"으로 착각해 무시하지
    // 않는다.
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      const req = state.menuRequest
      const reqChanged = req !== null && req.seq !== prev.menuRequest?.seq
      if (reqChanged) {
        // 톱니는 "그 탭으로 이동"이다: 메뉴가 이미 다른 탭으로 열려 있어도
        // 항상 그 탭을 보여준다. 두 번째 입구는 "누르면 거기 도착한다"가
        // 계약이지 "다시 누르면 닫힌다"가 아니다 — 그건 B 의 일이다.
        this.menuTab = req.tab
      } else if (state.openPanel === 'menu' && prev.openPanel !== 'menu') {
        // B 로 새로 열 때는 항상 첫 탭(숙련도)에서 시작한다 — 톱니로 연 설정
        // 탭과 달리, B 는 "무엇을 보러 왔는지"를 모르는 진입이라 고정된
        // 시작점이 필요하다.
        this.menuTab = 'skills'
      }
      if (state.openPanel !== prev.openPanel || reqChanged) this.syncFromStore()
    })

    // ControlScene 과 같은 이유로 SHUTDOWN·DESTROY 둘 다에 같은 정리를 걸고
    // 두 번째 호출은 가드로 무시한다 — ControlScene.create() 의 주석 참고.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
      this.scrollList.destroy()
      // ControlScene 이 touchSource 를 비우는 것과 **같은 이유**다. 씬을 다시
      // 시작하면 create() 는 다시 돌지만 인스턴스는 그대로라, 여기서 놓지 않으면
      // bind() 가 "두 번 불렸다"며 던진다. 맵을 넘을 때마다 WorldScene 이
      // 재시작하므로 그건 드문 경우가 아니라 전환마다다. 게다가 그 예외는 씬
      // 매니저의 작업 큐 안에서 터져서 **그 뒤 순서인 Dialogue 씬이 아예 시작되지
      // 못했다** — 전환 뒤로는 말을 걸어도 대사창이 뜨지 않았다.
      //
      // 남겨 두는 것도 답이 아니다: 그 hub 는 이전 맵의 것이라, 패널이 잠그고
      // 푸는 대상이 지금 걷고 있는 세계가 아니게 된다.
      this.hub = null
      this.control = null
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  /**
   * WorldScene 이 자신의 create() 끝에서 한 번 부른다. ControlScene.bind() 와
   * 같은 이유로 미룬다 — 이 씬의 create() 가 끝나야 존재하고, hub 는
   * WorldScene.create() 가 만든다. 두 시점 어느 쪽 생성 시점에도 넘길 수
   * 없으므로 별도 진입점으로 나중에 연결한다.
   *
   * control 도 같은 이유로 함께 받는다 — 패널이 열리고 닫힐 때 컨트롤러를
   * 숨기고 보이려면(applyWorldLock 참고) 그 씬을 가리킬 방법이 있어야 한다.
   * WorldScene 이 Control 을 먼저 launch·bind 한 뒤 Panel 을 bind 하므로
   * (WorldScene.create() 참고) 이 시점에는 이미 유효한 참조다.
   */
  bind(hub: InputHub, control: ControlScene): void {
    if (this.hub) throw new Error('PanelScene.bind 은 한 번만 부를 수 있다')
    this.hub = hub
    this.control = control
    // 구독은 "바뀔 때"만 불린다 — bind 시점의 초기값도 같은 계산으로 한 번
    // 반영한다(설계 §8-앞 8). 씬이 재시작된 직후 스토어에 열림 값이 이미
    // 남아 있어도 새 hub 가 그 값대로 잠긴다.
    this.syncFromStore()
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
   * **대사창이 열려 있던 프레임에는 WorldScene 이 이 메서드를 부르지 않는다**
   * — 그 한 곳이 대화 중 I/C 삼킴·B 의 대사창 우선을 전부 지킨다(설계 §8-앞
   * 7). 그래서 여기서는 대사창을 다시 검사하지 않는다.
   *
   * hub 가 아직 없으면(bind() 가 아직 안 불렸으면) 조용히 넘어간다 — launch()
   * 는 다음 씬 매니저 처리 단계로 미뤄질 수 있어, WorldScene 의 첫 update()
   * 가 이 씬의 create()/bind() 보다 먼저 돌 가능성을 배제할 수 없다.
   */
  applyInput(): void {
    const hub = this.hub
    if (!hub) return

    const state = hub.state
    const store = useGameStore.getState()
    if (state.toggleBagPressed) {
      store.setOpenPanel(store.openPanel === 'bag' ? null : 'bag')
    } else if (state.toggleCraftPressed) {
      store.setOpenPanel(store.openPanel === 'craft' ? null : 'craft')
    } else if (state.cancelPressed) {
      // B 의 의미는 하나다: 무엇이든(가방·제작·메뉴) 열려 있으면 닫고,
      // 아무것도 없으면 상세 메뉴를 연다 — 휴대폰 뒤로 가기와 같은 규칙이다.
      store.setOpenPanel(store.openPanel === null ? 'menu' : null)
    }

    // 메뉴 안 목록의 누름은 hub 를 거치지 않는다 — pollMenuPress 문서 참고.
    // 방금 위에서 열림 값이 바뀌었을 수 있으므로 스토어를 다시 읽는다.
    if (useGameStore.getState().openPanel === 'menu') this.pollMenuPress()
  }

  /** 스토어의 열림 값을 화면(그리기)과 세계(잠금·컨트롤러)에 한꺼번에 비춘다. */
  private syncFromStore(): void {
    this.render()
    this.applyWorldLock()
  }

  /**
   * 지금 열림 상태를 세계 잠금과 컨트롤러에 반영한다. 스토어 구독과 bind()
   * 둘 다 여기를 지난다 — 잠금을 적는 곳이 갈라지면 언젠가 한쪽만 고쳐진다.
   *
   * 잠금에 'panel' 이라는 주인 이름을 붙여 건다. 열림의 주인이 스토어로
   * 옮겨 갔어도 이 씬과 대사창이 동시에 열릴 수 있다는 사실은 그대로다 —
   * 톱니(React)는 대사창이 열려 있는 동안에도 눌리고, 반대로 A 로 대화를
   * 요청해 놓고 응답이 오기 전에 I 를 눌러도 둘이 겹친다. 주인 이름이 없던
   * 시절에는 먼저 닫는 쪽이 잠금을 통째로 풀어, 패널이 화면을 덮고 있는데도
   * 그 밑에서 세계가 움직였다(InputHub.setWorldInputLocked 문서).
   *
   * 컨트롤러도 openPanel 하나가 아니라 **hub 의 합**을 보고 정한다 — 이유는
   * 같다. 여기서 `openPanel === null` 만 보면 대사창이 아직 열려 있는데
   * 컨트롤러가 그 위로 돌아온다. 아무 창도 없을 때 그 합은 정확히
   * `openPanel === null` 과 같다.
   */
  private applyWorldLock(): void {
    const hub = this.hub
    if (!hub) return
    hub.setWorldInputLocked('panel', useGameStore.getState().openPanel !== null)
    // 컨트롤러 전체를 같이 여닫는다 — ControlScene.setControllerVisible 문서 참고.
    this.control?.setControllerVisible(!hub.worldInputLocked)
  }

  /** 메뉴 안 탭 바를 눌렀을 때. 메뉴는 이미 열려 있으므로 열림 값은 건드리지 않는다. */
  private selectTab(tab: DetailMenuTab): void {
    // 메뉴가 아닐 때의 눌림은 이제 여기까지 오지 않는다 — 닫힌 동안 씬 입력이
    // 통째로 꺼져 있다(render() 의 `this.input.enabled`). 그래도 이 가드를
    // 남긴다: 여기 오는 길이 하나뿐이라는 것은 위쪽 한 줄에 달린 사실이고,
    // 값을 바꾸는 함수가 자기 전제를 스스로 확인하는 편이 싸다.
    //
    // **원래 이 주석이 진짜 버그를 적어 두고도 못 막았다.** 「패널이 닫힌 동안
    // 세계의 그 자리를 탭하는 것만으로 menuTab 이 바뀐다」— menuTab 만 바뀌는
    // 것이 아니라 그 탭이 세계의 그 눌림을 **먹어 버린다**는 것이 값이었고,
    // 미니맵이 그 자리에 놓이자 지도가 안 열렸다.
    if (useGameStore.getState().openPanel !== 'menu') return
    if (this.menuTab === tab) return
    this.menuTab = tab
    this.render()
  }

  /**
   * 스토어의 열림 값대로 메뉴를 그리거나 치운다.
   *
   * 이 씬이 그리는 것은 `'menu'` 하나뿐이다 — `bag`·`craft` 값일 때 이 씬은
   * 아무것도 그리지 않는다(그건 DOM 의 일이다). 잠금은 applyWorldLock 이
   * 따로 반영하므로 여기서는 화면만 만진다.
   *
   * **그리지 않는 동안에는 포인터도 안 먹는다**(아래 첫 줄). 그 한 줄이 없어서
   * 미니맵의 위 절반이 안 눌렸다 — 자세한 것은 그 줄의 주석에 있다.
   */
  private render(): void {
    const showMenu = useGameStore.getState().openPanel === 'menu'

    // **아무것도 안 그리는 씬은 아무것도 안 먹어야 한다.**
    //
    // 이 씬의 히트 영역 둘(탭 칸 셋 · 목록 뷰포트)은 안 보이는 동안에도 살아
    // 있었다. 탭 칸은 `render()` 가 라벨만 숨겼기 때문이고, ScrollList 의
    // hitZone 은 애초에 컨테이너와 별개 오브젝트라 `setVisible` 이 안 닿는다
    // (그 파일이 스스로 그렇게 적어 뒀다). 812×375 에서 그 둘은 각각
    // (16,40)~(740,88) 과 (24,96)~(788,351) 이고, 미니맵 상자는
    // (9,39)~(125,155) 다 — 즉 상자 116px 중 **왼쪽 가장자리와 8px 짜리 띠를
    // 뺀 거의 전부**가 이 씬 밑에 깔려 있었다.
    //
    // 그것이 왜 곧 "안 눌린다" 인가: 씬 배열이 [World, Hud, Panel, Control,
    // Dialogue] 라 입력 처리 차례는 Panel → Hud 이고, 위 씬이 무언가를 잡으면
    // Phaser 는 그 프레임을 통째로 아래 씬에 안 내려보낸다(InputManager 의
    // `globalTopOnly`). 미니맵을 눌러도 지도가 안 열렸다.
    //
    // 히트 영역을 하나씩 끄지 않고 **씬 입력 자체**를 끄는 이유는 그것이 이
    // 씬의 참말이기 때문이다 — 닫혀 있는 동안 이 씬에는 누를 것이 하나도 없다.
    // 하나씩 끄면 다음에 여기 무언가를 더하는 사람이 같은 함정을 다시 판다.
    // (이미 그렇게 한 번 팠다: 탭 hitZone 의 값 가드 `selectTab` 은 "닫힌
    // 동안에도 눌린다"를 알고 쓴 것인데, 그 앎이 눌림 자체를 막지는 못했다.)
    this.input.enabled = showMenu

    this.panelBox.setVisible(showMenu)
    this.closeButtonShape.setVisible(showMenu)
    this.closeButtonLabel.setVisible(showMenu)
    this.tabIndicator.setVisible(showMenu)
    for (const btn of this.tabButtons) btn.label.setVisible(showMenu)
    this.scrollList.setVisible(showMenu)

    if (showMenu) {
      // 열 때마다 위치(탭 밑줄 포함)까지 다시 잡고 내용도 다시 짠다.
      this.relayout()
      this.rebuildMenuContent()
    } else {
      // 목록이 안 보이면 줄(Text 오브젝트)을 다음에 열릴 때까지 붙잡아 둘
      // 이유가 없다 — 여기서 바로 놓아준다(ScrollList.clear() 문서 참고).
      this.scrollList.clear()
      // 펼침도 함께 놓는다 — 다음에 여는 사람이 보는 첫 화면은 언제나 접힌
      // 것이어야 한다(expandedFolds 문서). 여는 쪽에서 비우지 않는 이유는
      // render() 가 탭 전환에서도 불리기 때문이다.
      this.expandedFolds.clear()
    }
  }

  /**
   * 메뉴 내용만 다시 짠다(위치는 그대로) — 리사이즈로 줄바꿈 폭이 바뀌었을
   * 때도 쓴다. 플레이어 상태는 스토어에서 그때그때 읽는다 — 메뉴가 열려 있는
   * 동안은 hub.setWorldInputLocked() 가 이동·행동을 막아 그 사이 값이 바뀔
   * 수 없으므로, 매 프레임 다시 그릴 이유가 없다(ScrollList.setLines 문서 참고).
   */
  private rebuildMenuContent(): void {
    for (const btn of this.tabButtons) {
      btn.label.setColor(btn.id === this.menuTab ? ACCENT_TEXT_COLOR : DIM_COLOR)
    }

    const { data, player } = useGameStore.getState()
    if (!player) return // 접속 전에는 메뉴를 열 방법이 없지만(App.tsx), 방어적으로 넘어간다

    const tab = TABS.find((t) => t.id === this.menuTab)
    if (!tab) throw new Error(`알 수 없는 탭: ${this.menuTab}`)
    this.scrollList.setLines(tab.buildLines(data, player, this.expandedFolds))
  }

  /**
   * 접이 머리를 눌렀을 때만 쓰는 다시 그리기 — **스크롤을 그대로 둔다.**
   *
   * `rebuildMenuContent()` 의 `setLines` 는 스크롤을 0 으로 되돌린다(그 문서: "새로
   * 연다는 선언"). 접이 머리는 목록의 맨 아래에 있어서, 그걸로 그리면 「칭호
   * [펼치기]」를 누른 사람이 자기가 편 것을 못 본 채 맨 위로 튕겨 나간다 —
   * 제작 패널이 반복 제작 중에 `updateLines` 를 쓰는 것과 같은 이유다.
   */
  private refreshMenuLines(): void {
    const { data, player } = useGameStore.getState()
    if (!player) return
    const tab = TABS.find((t) => t.id === this.menuTab)
    if (!tab) throw new Error(`알 수 없는 탭: ${this.menuTab}`)
    this.scrollList.updateLines(tab.buildLines(data, player, this.expandedFolds))
  }

  /**
   * 메뉴가 열려 있는 동안 매 프레임: 누를 수 있는 줄(설정 탭의 둘, 이정표 탭의
   * 접이 머리 둘)을 확인한다.
   *
   * **쥐고 있는 것(heldGroup)은 보지 않는다.** 반복해서 좋은 일이 아니라
   * 한 번만 일어나야 하는 일이고, 그중 하나는 캐릭터를 지우는 문이다 —
   * 손가락을 얹고 있는 것만으로 계속 시도되면 안 된다. 접이 머리도 같다:
   * 얹고 있는 것만으로 매 프레임 접혔다 펴지면 그건 조작이 아니라 깜빡임이다.
   *
   * 여기서 하는 일은 요청을 남기는 것까지다. 실제 확인 창은 DOM 이 그린다
   * (TopBar) — 이름을 타이핑해야 하는데, 그 입력을 Phaser 캔버스 위에 만들면
   * 모바일 키보드·IME·한글 조합을 전부 직접 다시 만들게 된다.
   */
  private pollMenuPress(): void {
    const tapped = this.scrollList.consumeTap()
    if (!tapped) return
    if (tapped === MILESTONE_FOLD.gates || tapped === MILESTONE_FOLD.titles) {
      if (this.expandedFolds.has(tapped)) this.expandedFolds.delete(tapped)
      else this.expandedFolds.add(tapped)
      this.refreshMenuLines()
      return
    }
    const store = useGameStore.getState()
    if (tapped === SETTINGS_ACTION.logout) {
      void store.logout()
      return
    }
    if (tapped === SETTINGS_ACTION.deleteCharacter) store.askDeleteCharacter()
  }

  private handleResize(): void {
    this.relayout()
    // 메뉴가 열린 채로 리사이즈되면 줄바꿈 폭이 달라지므로 내용을 다시 짠다.
    if (useGameStore.getState().openPanel === 'menu') this.rebuildMenuContent()
  }

  /**
   * 지금 화면 크기로 다시 배치한다.
   *
   * `scale.width` 를 직접 쓰지 않는 이유는 그것이 기기 픽셀이기 때문이다. 이
   * 파일의 좌표와 크기 상수는 전부 CSS 픽셀이고, 그 차이는 카메라 zoom 이
   * 메운다 — viewport.ts 참고.
   */
  private relayout(): void {
    const view = viewSize(this)
    this.layout(view.width, view.height)
  }

  /**
   * 패널 상자를 화면 크기에 맞게 다시 잡는다.
   *
   * 위로는 상단 바(TOP_MARGIN)를, 나머지 세 면은 PANEL_MARGIN 을 남기고 그
   * 사이를 꽉 채운다 — "화면을 거의 다 쓴다"는 요구가 그대로 이 한 사각형이다.
   */
  private layout(width: number, height: number): void {
    const box = panelBoxRect(width, height)
    const boxWidth = box.width
    const boxHeight = box.height
    const boxLeft = box.x
    const boxTop = box.y
    const centerX = width / 2

    this.panelBox.setPosition(centerX, boxTop + boxHeight / 2).setSize(boxWidth, boxHeight)

    // 닫기 버튼 — 박스 우상단, 헤더 줄 한가운데. DOM 패널(가방·제작)의 ✕ 도
    // 같은 구석을 쓴다 — 어느 패널이 열려도 엄지가 다시 찾을 필요가 없도록.
    const closeCenterX = boxLeft + boxWidth - CLOSE_BUTTON_MARGIN - CLOSE_BUTTON_RADIUS
    const closeCenterY = boxTop + HEADER_HEIGHT / 2
    this.closeButtonShape.setPosition(closeCenterX, closeCenterY)
    this.closeButtonLabel.setPosition(closeCenterX, closeCenterY)

    // 탭 바 — 헤더 줄 안, 닫기 버튼 왼쪽까지만 쓴다.
    const tabsRight = closeCenterX - CLOSE_BUTTON_RADIUS - TAB_CLOSE_GAP
    const tabsWidth = Math.max(0, tabsRight - boxLeft)
    const tabWidth = tabsWidth / TABS.length
    const tabBarCenterY = boxTop + HEADER_HEIGHT / 2
    this.tabButtons.forEach((btn, i) => {
      const colLeft = boxLeft + tabWidth * i
      btn.hitZone.setPosition(colLeft, boxTop).setSize(tabWidth, HEADER_HEIGHT)
      // Zone 의 setInteractive() 는 호출 시점의 width/height 로 히트 영역을
      // 스냅샷한다(ScrollList.setViewport 의 같은 주석, 원출처는
      // ControlScene.setCircularHitArea) — setSize() 는 그 스냅샷을 자동으로
      // 따라오지 않으므로 리사이즈마다 직접 갱신한다.
      const hitArea = btn.hitZone.input?.hitArea as Phaser.Geom.Rectangle | undefined
      hitArea?.setTo(0, 0, tabWidth, HEADER_HEIGHT)
      btn.label.setPosition(colLeft + tabWidth / 2, tabBarCenterY)
    })

    const activeIndex = Math.max(
      0,
      TABS.findIndex((t) => t.id === this.menuTab),
    )
    this.tabIndicator
      .setPosition(boxLeft + tabWidth * activeIndex + tabWidth / 2, boxTop + HEADER_HEIGHT - TAB_INDICATOR_HEIGHT)
      .setSize(tabWidth * 0.6, TAB_INDICATOR_HEIGHT)

    // 목록 — 헤더 아래 남은 영역을 꽉 채운다. 그 사각형을 여기서 다시 계산하지
    // 않는 이유는 검사도 같은 수를 봐야 하기 때문이다(panelBox.ts 의 panelListRect).
    const list = panelListRect(width, height)
    this.scrollList.setViewport(list.x, list.y, list.width, list.height)
  }
}
