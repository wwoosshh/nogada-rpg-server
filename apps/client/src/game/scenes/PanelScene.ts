import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'
import { useGameStore } from '../../store/gameStore.js'
import { worldNow } from '../../time/clock.js'
import { buildCraftLines, canAffordCraft, craftRepeatUnlocked } from '../craftPanelContent.js'
import { DIM_COLOR, LABEL_COLOR, TABS, type DetailMenuTab } from '../detailMenuTabs.js'
import { addText, FONT_SIZE } from '../gameText.js'
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
 * LABEL_COLOR·DIM_COLOR 만 예외로 detailMenuTabs.ts 에서 import 한다 — 그
 * 파일의 탭 내용(이정표·숙련도 줄)도 같은 두 색을 쓰고, 원래 이 파일 안의
 * 코드였던 것을 구조만 나눈 것이라 리터럴을 다시 옮겨 적지 않는다(이 주석의
 * "두 파일" 은 PanelScene 과 ControlScene 처럼 애초에 별개였던 파일들 얘기다).
 */
const PANEL_COLOR = 0x3a2f2a
const PANEL_EDGE_COLOR = 0x6b5646
const ACCENT_COLOR = 0xd9a441
const ACCENT_TEXT_COLOR = '#d9a441'
const INK_COLOR = '#241c1c'

/** 배경 위에서도 글자가 또렷이 읽혀야 하므로 컨트롤러 버튼(0.55)보다 훨씬 불투명하다. */
const PANEL_ALPHA = 0.94

/** 상단 바를 침범하지 않을 위쪽 여백 — 실측 상단 바 높이(약 34px: ui.css 의 .topbar 패딩 4px×2 + 톱니 min-height 24px + 테두리 2px)보다 살짝 크게 잡았다. */
const TOP_MARGIN = 40

/**
 * 위쪽을 뺀 나머지 세 면(좌·우·아래)에서 패널이 남기는 여백.
 *
 * 컨트롤러를 피하려는 값이 더는 아니다 — 패널이 하나라도 열리면 컨트롤러
 * 전체가 숨고 입력도 꺼진다(ControlScene.setControllerVisible — setOpen·
 * openMenuTab 이 부른다. 클래스 문서 참고). 그래도 화면의 물리적 가장자리는
 * 여전히 피한다: 아래쪽이 안드로이드 제스처 내비게이션 영역과 겹치면
 * ScrollList 의 드래그 스크롤을 OS 가 먼저 가로챌 수 있다
 * (ControlScene.EDGE_MARGIN_BOTTOM 과 같은 이유) — 좌우는 그 정도로 민감하지
 * 않지만 화면 끝에 내용이 딱 붙지 않을 정도의 여유는 준다.
 */
const PANEL_MARGIN = 16

/** 아주 좁은 창에서도 패널이 찌그러지지 않는 최소 폭. */
const MIN_WIDTH = 240
/** 극단적으로 낮은 화면에서도 두 줄 글자가 안 뭉개지는 최소 높이. */
const MIN_HEIGHT = 64
/**
 * 패널 폭의 상한.
 *
 * "화면을 거의 다 쓴다"는 요구는 실제 세로 모바일 화면(가로로 눕혀도 이
 * 값에 닿지 않는다) 얘기다 — 데스크톱에서 개발용 창을 비정상적으로 넓게
 * 열었을 때 목록 줄이 화면 끝까지 죽 늘어지는 것만 막는 방어값이다.
 */
const MAX_PANEL_WIDTH = 900

const TEXT_PADDING = 16

/**
 * 상단 헤더 줄 높이. 닫기 버튼(CLOSE_BUTTON_DIAMETER)이 온전히 들어가는
 * 높이로 잡았다 — menu 는 같은 줄에 탭도 놓지만(탭 라벨은 작아도 손끝으로
 * 누를 칸은 이 줄 전체 높이만큼 크다), bag·craft 는 닫기 버튼만 있고 나머지는
 * 비어 있다.
 */
const HEADER_HEIGHT = 48
/** 헤더 줄 바로 아래, 실제 내용(목록)이 시작되기 전 틈. */
const CONTENT_GAP = 8
/** 목록(craft·menu) 좌우·아래 안쪽 여백. */
const CONTENT_PADDING = 8

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
 * 어느 패널이 열려 있는지.
 *
 * `bag` 는 아직 자리만 있다(설계 문서 §9 가 내용을 범위 밖에 뒀다) — 무엇이
 * 열렸는지와 "아직 안 만들었다"만 보여준다. `craft` 는 레시피 목록이다 —
 * menu 와 같은 큰 상자·ScrollList 를 쓰지만 탭은 없다(레시피 자체가 목록의
 * 유일한 단위라 탭으로 더 나눌 게 없다). `menu` 는 B 의 상세 메뉴다: 탭으로
 * 나뉘고 실제 내용(숙련도·이정표·설정)이 있다.
 */
type PanelId = 'bag' | 'craft' | 'menu'

/** 가방 안내 상자 문구. 가방 내용은 설계 문서 §9 에서 범위 밖이다 — craft 는 더 이상 이 자리를 쓰지 않는다(아래 refreshCraft 참고). */
const BAG_TITLE = '가방'
const BAG_BODY = '아직 만들지 않았습니다.'

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
 * 가방·제작 버튼과 B 가 여는 상세 메뉴.
 *
 * 세 가지를 그린다:
 *  - `bag`: 아직 자리만 있다(설계 문서 §9 범위 밖) — 무엇이 열렸는지와
 *    "아직 안 만들었다"만 보여준다. 가짜 인벤토리를 꾸미지 않는다.
 *  - `craft`: 레시피 목록. menu 와 같은 큰 상자·ScrollList 를 재사용하지만
 *    탭은 없다 — 줄 하나하나가 레시피이고 그 줄 자체가 누르는 대상이다
 *    (craftPanelContent.ts, ScrollList 의 groupId 문서 참고). 이정표 목록이
 *    "구리 망치를 만들 수 있다"고 광고하면서 실제로는 만들 방법이 없었던
 *    것이 이 화면을 채운 이유다.
 *  - `menu`: B 의 상세 메뉴. 탭(숙련도·이정표·설정)으로 나뉘고 실제 내용이
 *    있다 — 원작에서 특수 메뉴를 호출하는 커먼이벤트 이름이 `[★B]특수메뉴호출`
 *    이고 숙련도 정보 화면이 그 안에 있던 것과 같은 자리다.
 *
 * B 의 의미는 하나다: 셋 중 무엇이든 열려 있으면 닫고, 아무것도 없으면
 * `menu` 를 연다(applyInput 참고) — 휴대폰 뒤로 가기와 같은 규칙이다. 상단
 * 바 톱니는 같은 메뉴를 설정 탭으로 여는 두 번째 입구다(openMenuTab 참고 —
 * gameStore.ts 의 MenuRequest 채널이 그 통로다. App.tsx 를 건드리지 않고
 * React 의 톱니 버튼과 이 Phaser 씬을 잇는 유일한 길이 그것이다).
 *
 * 화면을 거의 다 쓴다 — 위로는 상단 바(TOP_MARGIN)만, 나머지 세 면은
 * PANEL_MARGIN 만 남긴다(layout() 참고). 예전에는 아래쪽에 컨트롤러가 들어갈
 * 큰 여백(BOTTOM_RESERVE)을 항상 남겨 뒀지만, 그 여백이 이정표처럼 자라는
 * 목록의 화면을 절반 가까이 깎아 먹었다 — 그런데도 컨트롤러 버튼은 레이아웃이
 * 못 미친 자리에서 패널 위에 그려져 내용을 가렸다(가방·제작 토글 줄). 패널이
 * 닫기 버튼을 스스로 갖게 되면서 이 트레이드를 뒤집었다: 패널이 열려 있는
 * 동안 컨트롤러는 어차피 쓸모가 없다 — dir·action 은 hub 가 잠그고, cancel·
 * bag·craft 로 닫거나 바꾸던 자리는 이 닫기 버튼(그리고 여전히 살아 있는
 * 키보드 — ControlScene.setControllerVisible 문서 참고)이 대신한다. 그래서
 * 컨트롤러에게 자리를 비켜줄 필요 자체가 없어졌고, 자리를 비켜주는 대신
 * ControlScene.setControllerVisible() 로 통째로 숨긴다(setOpen·openMenuTab 이
 * 둘 다 applyWorldLock() 을 지난다).
 *
 * **대사창과 동시에 열려 있을 수 있다.** 톱니는 대사창이 열려 있는 동안에도
 * 눌리므로 이 패널이 그 위로 열린다 — 그래서 세계 잠금도 컨트롤러 숨김도 이
 * 씬 혼자 정하지 않는다(applyWorldLock 참고).
 *
 * ControlScene 처럼 WorldScene 과 별도인 씬이다 — 이유도 같다. WorldScene 의
 * 카메라 스크롤과 낮밤 명암은 그 씬 안의 오브젝트에만 적용되므로, 별도 씬으로
 * 두면 스크롤을 안 따라가고(화면에 고정) 밤에도 어두워지지 않는다. 패널은
 * "지금 무엇이 열려 있는지"를 밤에도 분명히 보여야 하는 화면이라 컨트롤러와
 * 같은 성질이 필요하다.
 *
 * PhaserGame.ts 의 씬 배열에서 WorldScene 위, ControlScene 아래에 둔다. 자리가
 * 필요한 이유는 World 보다 위에 그려져야 한다는 것 하나뿐이다(그래야 낮밤
 * 명암 밖에 있다 — 위 문단). Control 과의 상대 순서는 더는 의미가 없다 —
 * 패널이 열리면 Control 이 스스로 숨으므로(위 문단), 이 씬과 Control 이 동시에
 * 화면에 보이는 상태 자체가 없다(PhaserGame.ts 의 씬 배열 주석 참고).
 *
 * ControlScene 과 마찬가지로 배열의 두 번째 이후라 자동 시작하지 않는다 —
 * WorldScene.create() 가 명시적으로 launch 한다.
 */
export class PanelScene extends Phaser.Scene {
  // 세 패널이 공유하는 배경 상자와 닫기 버튼 — 한 번에 하나만 열리므로
  // (setOpen) bag·craft·menu 마다 따로 둘 이유가 없다. 항상 같은 자리에 같은
  // 모양으로 나타난다.
  private panelBox!: Phaser.GameObjects.Rectangle
  private closeButtonShape!: Phaser.GameObjects.Arc
  private closeButtonLabel!: Phaser.GameObjects.Text

  // 가방 — 아직 자리만 있는 작은 안내 문구.
  private title!: Phaser.GameObjects.Text
  private body!: Phaser.GameObjects.Text

  // 상세 메뉴. scrollList 는 menu 뿐 아니라 craft 도 쓴다 — PanelId 는 한 번에
  // 하나만 열리므로(setOpen) 인스턴스를 둘로 나눌 이유가 없다.
  private tabButtons: TabButton[] = []
  private tabIndicator!: Phaser.GameObjects.Rectangle
  private scrollList!: ScrollList

  private hub: InputHub | null = null
  /** 패널이 열리고 닫힐 때 컨트롤러를 같이 숨기고 보이는 통로 — bind() 참고. */
  private control: ControlScene | null = null
  private open: PanelId | null = null
  private menuTab: DetailMenuTab = 'skills'
  private unsubscribeMenuRequest: (() => void) | null = null
  /** 제작 패널이 열려 있는 동안 플레이어 상태가 바뀔 때마다(제작 결과마다) 목록을 다시 그리는 구독. */
  private unsubscribePlayer: (() => void) | null = null
  /** 응답이 날아가 있는 동안 같은 레시피를 또 보내지 않는다 — WorldScene.gatherPending 과 같은 이유다. */
  private craftPending = false

  constructor() {
    super({ key: 'Panel' })
  }

  create(): void {
    this.panelBox = this.add
      .rectangle(0, 0, 10, 10, PANEL_COLOR, PANEL_ALPHA)
      .setStrokeStyle(2, PANEL_EDGE_COLOR, 1)
      .setVisible(false)

    this.title = addText(this, 0, 0, '', {
      fontSize: `${FONT_SIZE.title}px`,
      color: ACCENT_TEXT_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 3,
      fontStyle: 'bold',
      align: 'center',
    })
      .setOrigin(0.5)
      .setVisible(false)

    this.body = addText(this, 0, 0, '', {
      fontSize: `${FONT_SIZE.body}px`,
      color: LABEL_COLOR,
      stroke: INK_COLOR,
      strokeThickness: 2,
      align: 'center',
    })
      .setOrigin(0.5)
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

    // 닫기 버튼 — 세 패널이 공유한다(항상 같은 자리, 항상 같은 동작). 다른
    // 내용(탭·목록) 위에 그려져야 하므로 이 씬에서 가장 마지막에 만든다 —
    // 같은 씬 안에서는 만든 순서가 곧 그리는 순서다(뒤에 만들수록 위).
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
    // 무엇이 열려 있든 닫기는 항상 같은 동작이다. setOpen(null) 은 이미 아무것도
    // 안 열려 있으면 조용히 넘어간다(그 안의 가드) — 탭 hitZone 과 달리 이
    // 버튼은 안 보일 때도 인터랙티브를 따로 끄지 않는다(닫힌 상태에서 눌려도
    // 부작용이 없기 때문이다).
    this.closeButtonShape.on('pointerdown', () => this.setOpen(null))

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

    this.relayout()
    this.scale.on('resize', this.handleResize, this)

    // 톱니(React)가 gameStore.openMenu() 로 세운 요청을 여기서 받는다 —
    // MenuRequest 문서(gameStore.ts) 참고. seq 비교는 milestone 채널과 같은
    // 이유다: 같은 tab 을 두 번 연달아 요청해도(톱니를 두 번 누름) "이미
    // 처리함"으로 착각해 무시하지 않는다.
    this.unsubscribeMenuRequest = useGameStore.subscribe((state, prev) => {
      const req = state.menuRequest
      if (!req || req.seq === prev.menuRequest?.seq) return
      this.openMenuTab(req.tab)
    })

    // 제작 패널이 열려 있는 동안 제작 결과(성공·실패 모두)가 올 때마다 목록을
    // 다시 그린다. player 참조는 gather 든 craft 든 매 행동마다 서버가 새
    // structuredClone 을 주므로 바뀐다(gameStore.applyPlayer) — Object.is 로
    // 비교하는 이 기본 구독 비교자가 그 변화를 그대로 잡아낸다. menu·bag 는
    // 이런 구독이 필요 없다: 패널이 열린 동안은 hub.setWorldInputLocked() 가
    // 행동을 막아 그 사이 player 가 바뀔 수 없다(rebuildMenuContent 문서
    // 참고) — craft 만 예외인 이유는 그 행동(제작) 자체가 이 패널 안에서
    // 일어나기 때문이다.
    this.unsubscribePlayer = useGameStore.subscribe((state, prev) => {
      if (state.player === prev.player) return
      if (this.open === 'craft') this.refreshCraftContent()
    })

    // ControlScene 과 같은 이유로 SHUTDOWN·DESTROY 둘 다에 같은 정리를 걸고
    // 두 번째 호출은 가드로 무시한다 — ControlScene.create() 의 주석 참고.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
      this.unsubscribeMenuRequest?.()
      this.unsubscribeMenuRequest = null
      this.unsubscribePlayer?.()
      this.unsubscribePlayer = null
      this.scrollList.destroy()
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
   * 숨기고 보이려면(setOpen·openMenuTab 참고) 그 씬을 가리킬 방법이 있어야
   * 한다. WorldScene 이 Control 을 먼저 launch·bind 한 뒤 Panel 을 bind 하므로
   * (WorldScene.create() 참고) 이 시점에는 이미 유효한 참조다.
   */
  bind(hub: InputHub, control: ControlScene): void {
    if (this.hub) throw new Error('PanelScene.bind 은 한 번만 부를 수 있다')
    this.hub = hub
    this.control = control
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
      // B 의 의미는 하나다: 무엇이든(가방·제작·메뉴) 열려 있으면 닫고,
      // 아무것도 없으면 상세 메뉴를 연다 — 휴대폰 뒤로 가기와 같은 규칙이다.
      next = this.open === null ? 'menu' : null
    }

    this.setOpen(next)

    // 제작 패널 자체의 누름은 hub 를 거치지 않는다 — pollCraftPress 문서 참고.
    if (this.open === 'craft') this.pollCraftPress()
  }

  private setOpen(next: PanelId | null): void {
    if (next === this.open) return
    this.open = next
    // B 로 새로 열 때는 항상 첫 탭(숙련도)에서 시작한다 — 톱니로 연 설정
    // 탭과 달리, B 는 "무엇을 보러 왔는지"를 모르는 진입이라 고정된 시작점이 필요하다.
    if (next === 'menu') this.menuTab = 'skills'
    this.render()
    this.applyWorldLock()
  }

  /**
   * 상단 바 톱니(React) 전용 진입점 — gameStore 의 MenuRequest 구독이 부른다.
   *
   * 토글이 아니라 "그 탭으로 이동"이다: 가방이 열려 있어도, 메뉴가 이미
   * 다른 탭으로 열려 있어도 항상 그 탭을 보여준다. 두 번째 입구는 "누르면
   * 거기 도착한다"가 계약이지 "다시 누르면 닫힌다"가 아니다 — 그건 B 의 일이다.
   */
  private openMenuTab(tab: DetailMenuTab): void {
    this.open = 'menu'
    this.menuTab = tab
    this.render()
    this.applyWorldLock()
  }

  /**
   * 지금 열림 상태를 세계 잠금과 컨트롤러에 반영한다. setOpen 과 openMenuTab
   * 둘 다 여기를 지난다 — 두 입구가 각자 잠금을 적으면 언젠가 한쪽만 고쳐진다.
   *
   * 잠금에 'panel' 이라는 주인 이름을 붙여 건다. 이 씬과 대사창은 실제로 동시에
   * 열릴 수 있다 — 톱니(React)는 대사창이 열려 있는 동안에도 계속 눌리고, 반대로
   * A 로 대화를 요청해 놓고 응답이 오기 전에 톱니를 눌러도 둘이 겹친다. 주인
   * 이름이 없던 시절에는 먼저 닫는 쪽이 잠금을 통째로 풀어, 이 패널이 화면을
   * 덮고 있는데도 그 밑에서 세계가 움직였다(InputHub.setWorldInputLocked 문서).
   *
   * 컨트롤러도 이 패널의 열림 여부가 아니라 **hub 의 합**을 보고 정한다 —
   * 이유는 같다. 여기서 `this.open === null` 을 쓰면 대사창이 아직 열려 있는데
   * 컨트롤러가 그 위로 돌아온다.
   */
  private applyWorldLock(): void {
    const hub = this.hub
    if (!hub) return
    hub.setWorldInputLocked('panel', this.open !== null)
    // 컨트롤러 전체를 같이 여닫는다 — ControlScene.setControllerVisible 문서 참고.
    this.control?.setControllerVisible(!hub.worldInputLocked)
  }

  /** 메뉴 안 탭 바를 눌렀을 때. 메뉴는 이미 열려 있으므로 open·잠금은 건드리지 않는다. */
  private selectTab(tab: DetailMenuTab): void {
    // 탭 hitZone 은 헤더 줄 전체를 차지하고(layout() 참고), 그 줄은 craft 에도
    // 있다(탭 없이 비어 있을 뿐이다). menu 가 아닐 때 이 눌림을 무시하지
    // 않으면, craft 가 열린 동안 그 빈 자리를 탭하는 것만으로 menuTab 이
    // 바뀌고 render() 가 refreshCraft() 를 다시 불러 스크롤 위치가 맨 위로
    // 튕긴다(ScrollList.setLines 문서 참고) — 보이지도 않는 탭을 눌렀을 뿐인데.
    if (this.open !== 'menu') return
    if (this.menuTab === tab) return
    this.menuTab = tab
    this.render()
  }

  private render(): void {
    const open = this.open
    const isOpen = open !== null

    // 세 패널이 배경 상자와 닫기 버튼을 공유한다 — 무엇이 열렸든 이 둘은
    // 같은 자리에 같은 모양으로 나타난다(클래스 문서 참고).
    this.panelBox.setVisible(isOpen)
    this.closeButtonShape.setVisible(isOpen)
    this.closeButtonLabel.setVisible(isOpen)

    const showSimple = open === 'bag'
    this.title.setVisible(showSimple)
    this.body.setVisible(showSimple)
    if (showSimple) {
      this.title.setText(BAG_TITLE)
      this.body.setText(BAG_BODY)
    }

    // menu·craft 는 같은 ScrollList 를 나눠 쓴다 — 한 번에 하나만 열리므로
    // 인스턴스를 나눌 이유가 없다(클래스 문서 참고). 탭 바(라벨·밑줄)는 menu
    // 만 그린다 — craft 에는 탭이 없다.
    const showMenu = open === 'menu'
    const showCraft = open === 'craft'
    this.tabIndicator.setVisible(showMenu)
    for (const btn of this.tabButtons) btn.label.setVisible(showMenu)
    this.scrollList.setVisible(showMenu || showCraft)

    if (showMenu) {
      this.refreshMenu()
    } else if (showCraft) {
      this.refreshCraft()
    } else {
      // 아무 목록도 안 보이면(닫혔거나 가방이면) 줄(Text 오브젝트)을 다음에
      // 열릴 때까지 붙잡아 둘 이유가 없다 — 여기서 바로 놓아준다
      // (ScrollList.clear() 문서 참고).
      this.scrollList.clear()
    }
  }

  /** 메뉴를 열거나 탭을 바꿀 때: 위치(탭 밑줄 포함)까지 다시 잡고 내용도 다시 짠다. */
  private refreshMenu(): void {
    this.relayout()
    this.rebuildMenuContent()
  }

  /**
   * 메뉴 내용만 다시 짠다(위치는 그대로) — 리사이즈로 줄바꿈 폭이 바뀌었을
   * 때 쓴다. 플레이어 상태는 스토어에서 그때그때 읽는다 — 메뉴가 열려 있는
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
    this.scrollList.setLines(tab.buildLines(data, player))
  }

  /**
   * 제작 패널을 열 때: 메뉴와 같은 위치 계산을 그대로 쓴다 — layout() 은
   * 이미 menu 와 bag 자리를 매번 다시 잡으므로 craft 를 위한 세 번째 계산을
   * 새로 만들지 않는다. 탭 바 한 줄만큼의 위쪽 여백이 빈 채로 남지만, 그
   * 낭비가 별도 레이아웃 함수를 하나 더 유지하는 비용보다 싸다 — 이정표
   * 27개가 이미 이 상자 안에서 스크롤로 다 들어간다는 증거다.
   */
  private refreshCraft(): void {
    this.relayout()
    this.rebuildCraftContent()
  }

  /** 제작 패널을 처음 열 때(또는 리사이즈): 스크롤을 맨 위로 되돌리며 다시 그린다. */
  private rebuildCraftContent(): void {
    const { data, player } = useGameStore.getState()
    if (!player) return
    this.scrollList.setLines(buildCraftLines(data, player))
  }

  /**
   * 제작 결과가 올 때마다(성공·실패 모두, unsubscribePlayer 구독이 부른다):
   * 손가락을 쥔 채로 숫자만 새로 그린다. rebuildCraftContent 와 달리
   * ScrollList.updateLines() 를 써서 스크롤 위치와 눌림 상태를 그대로
   * 이어간다(그 문서 참고) — 반복 제작 중 매번 setLines 를 쓰면 스크롤이
   * 맨 위로 튕기고 쥐고 있던 그룹이 풀려 "누르고 있으면 계속된다"는 반복이
   * 끊긴다.
   */
  private refreshCraftContent(): void {
    const { data, player } = useGameStore.getState()
    if (!player) return
    this.scrollList.updateLines(buildCraftLines(data, player))
  }

  /**
   * 제작 패널이 열려 있는 동안 매 프레임(applyInput 이 부른다): 방금 누른
   * 레시피는 한 번, 쥐고 있는 레시피는 조합의 자동 반복 이정표를 달성했을
   * 때만 계속 시도한다 — WorldScene 의 actionPressed(한 번) / action +
   * repeatsOn(계속) 조합과 정확히 같은 모양이다. gather 는 그 판정 대상이
   * 앞칸의 노드이고 이건 눌린 레시피 줄이라는 점만 다르다.
   *
   * 물리 A 버튼(hub.state.action)을 다시 쓰지 않는 이유: 패널이 열린 동안
   * 세계로 새는 이동·행동을 막는 것은 모바일 조작 설계 문서 §7 의 명시적
   * 결정이고, InputHub.setWorldInputLocked() 가 그 결정을 action 버튼째
   * 잠근다(InputState.ts 문서 참고). 그 잠금을 풀어 재사용하면 "패널이 열린
   * 동안 행동 입력은 막는다"는 하나의 규칙이 "막되 제작 패널 안에서는 다른
   * 뜻으로 통과시킨다"로 갈라진다. 대신 이 패널은 탭 바(TabButton.hitZone)가
   * 이미 쓰던 언어 — 화면 위 대상을 직접 누른다 — 를 레시피 줄에도 쓴다
   * (ScrollList 의 groupId 기반 줄 누름). hub 의 잠금은 한 줄도 안 바뀐다.
   */
  private pollCraftPress(): void {
    const tapped = this.scrollList.consumeTap()
    if (tapped) {
      this.tryCraft(tapped)
      return
    }

    const { data, player } = useGameStore.getState()
    if (!player || !craftRepeatUnlocked(data, player)) return

    const held = this.scrollList.heldGroup()
    if (held) this.tryCraft(held)
  }

  /**
   * WorldScene.sendGather() 와 같은 세 가지 문: 응답을 기다리는 중이면
   * 넘어가고, 서버의 다음 행동 시각(nextActionAt) 전이면 넘어가고, 이 화면이
   * 이미 표시 중인 이유로 거부될 게 뻔하면(숙련도·재료 부족) 보내지 않는다.
   * 서버는 이 확인 없이도 스스로 거부하므로 안전을 위한 것이 아니라, 반복
   * 제작 중 매 프레임 거부 응답만 왕복시키지 않기 위해서다.
   */
  private tryCraft(recipeId: string): void {
    if (this.craftPending) return
    const { data, player } = useGameStore.getState()
    if (!player || worldNow() < player.nextActionAt) return
    if (!canAffordCraft(data, player, recipeId)) return

    this.craftPending = true
    void useGameStore
      .getState()
      .craft(recipeId)
      .finally(() => {
        this.craftPending = false
      })
  }

  private handleResize(): void {
    this.relayout()
    // 메뉴·제작이 열린 채로 리사이즈되면 줄바꿈 폭이 달라지므로 내용을 다시 짠다.
    if (this.open === 'menu') this.rebuildMenuContent()
    if (this.open === 'craft') this.rebuildCraftContent()
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
   * 패널 상자를 화면 크기에 맞게 다시 잡는다 — bag·craft·menu 세 패널이 전부
   * 같은 계산을 쓴다(클래스 문서 참고: 컨트롤러가 열려 있는 동안 숨으므로
   * 더는 패널마다 다른 안전 영역을 계산할 이유가 없다).
   *
   * 위로는 상단 바(TOP_MARGIN)를, 나머지 세 면은 PANEL_MARGIN 을 남기고 그
   * 사이를 꽉 채운다 — "화면을 거의 다 쓴다"는 요구가 그대로 이 한 사각형이다.
   */
  private layout(width: number, height: number): void {
    const boxWidth = Phaser.Math.Clamp(width - PANEL_MARGIN * 2, MIN_WIDTH, MAX_PANEL_WIDTH)
    const boxHeight = Math.max(MIN_HEIGHT, height - TOP_MARGIN - PANEL_MARGIN)
    const boxLeft = (width - boxWidth) / 2
    const boxTop = TOP_MARGIN
    const centerX = width / 2

    this.panelBox.setPosition(centerX, boxTop + boxHeight / 2).setSize(boxWidth, boxHeight)

    // 닫기 버튼 — 박스 우상단, 헤더 줄 한가운데. 세 패널 모두 같은 자리를
    // 쓴다(어느 패널이 열려도 엄지가 다시 찾을 필요가 없도록).
    const closeCenterX = boxLeft + boxWidth - CLOSE_BUTTON_MARGIN - CLOSE_BUTTON_RADIUS
    const closeCenterY = boxTop + HEADER_HEIGHT / 2
    this.closeButtonShape.setPosition(closeCenterX, closeCenterY)
    this.closeButtonLabel.setPosition(closeCenterX, closeCenterY)

    // bag 안내 문구 — 헤더 아래 남은 영역 한가운데.
    const contentTop = boxTop + HEADER_HEIGHT
    const contentHeight = boxHeight - HEADER_HEIGHT
    const simpleCenterY = contentTop + contentHeight / 2
    this.title.setPosition(centerX, simpleCenterY - 16)
    this.body.setPosition(centerX, simpleCenterY + 12)
    this.body.setWordWrapWidth(boxWidth - TEXT_PADDING * 2)

    // 탭 바(menu 전용) — 헤더 줄 안, 닫기 버튼 왼쪽까지만 쓴다.
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

    // 목록(craft·menu) — 헤더 아래 남은 영역을 꽉 채운다.
    const listTop = contentTop + CONTENT_GAP
    const listLeft = boxLeft + CONTENT_PADDING
    const listWidth = boxWidth - CONTENT_PADDING * 2
    const listHeight = Math.max(0, boxTop + boxHeight - CONTENT_PADDING - listTop)
    this.scrollList.setViewport(listLeft, listTop, listWidth, listHeight)
  }
}
