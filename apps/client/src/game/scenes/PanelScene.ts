import Phaser from 'phaser'
import type { InputHub } from '../../input/InputState.js'
import { useGameStore } from '../../store/gameStore.js'
import { DIM_COLOR, LABEL_COLOR, TABS, type DetailMenuTab } from '../detailMenuTabs.js'
import { ScrollList } from '../ScrollList.js'

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

/** 상단 바를 침범하지 않을 위쪽 여백. */
const TOP_MARGIN = 40
/**
 * 화면 맨 아래에서 bag·craft 안내 상자가 침범하지 않는 높이.
 *
 * ControlScene 의 가방·제작 토글 줄 윗변은 대략 `height - 192` 다
 * (EDGE_MARGIN_BOTTOM + 버튼 반지름들의 합, ControlScene.ts 의 layout() 참고).
 * 그 버튼들은 패널이 열려 있는 동안에도 계속 눌려야 하므로(닫기·전환) 가려지면
 * 안 된다. 정확한 값을 다시 계산해 맞추는 대신 여유를 더한 근사값을 쓴다 —
 * 실기 확인 전까지는 컨트롤러 치수 자체가 조정 대상이라(설계 문서 §10), 두
 * 파일이 정확히 같은 상수를 공유하게 만드는 비용이 지금은 이득보다 크다.
 *
 * 안내 상자는 두 줄짜리 고정 텍스트라 이 예산을 실제로 쓴 적이 없다
 * (MAX_HEIGHT=170 에서 이미 잘린다) — 그래서 아무도 "화면 세로의 절반"이라는
 * 크기를 신경 쓰지 않았다. 스크롤되는 상세 메뉴는 다르다. 그 트레이드가
 * MENU_BOTTOM_RESERVE 를 따로 둔 이유다.
 */
const BOTTOM_RESERVE = 196
/**
 * 상세 메뉴 전용 아래 여백 — bag·craft 와 달리 훨씬 작다.
 *
 * BOTTOM_RESERVE 를 그대로 썼을 때 812×375 가로 화면에서 스크롤 내용 높이가
 * 97px 남짓이었다 — 이정표 27개(두 줄씩, 약 760px)를 보려면 한 화면에 서너
 * 줄만 보이고 나머지는 전부 스크롤이었다. bag·craft 상자는 절대 안 쓰는
 * 공간을 스크롤 목록에서는 실제로 쓴다.
 *
 * 그래도 화면 물리적 맨 아래는 피한다 — ControlScene.EDGE_MARGIN_BOTTOM 과
 * 같은 값, 같은 이유다(안드로이드 제스처 내비게이션 영역과 겹치면 스와이프를
 * OS 가 먼저 가로챈다). 이 여백만으로는 가방·제작 토글 버튼(height - 192)을
 * 다 피하지 못해 메뉴 내용과 그 버튼이 겹친다 — 의도한 트레이드다. PanelScene
 * 이 WorldScene 과 ControlScene 사이에 있는 이유(클래스 문서)가 정확히 이
 * 상황을 위한 것이다: Control 의 버튼은 항상 이 패널보다 위에 그려지고 자기
 * 원형 히트 영역을 스스로 갖고 있어(setCircularHitArea), 시각적으로 겹쳐도
 * 버튼은 계속 눌린다 — 그 버튼들이 패널이 열려 있는 동안에도 눌려야 한다는
 * 요구사항은 BOTTOM_RESERVE 주석과 같다.
 *
 * 812×375 가로 화면에서 실제로 확인했다: 목록을 이 겹치는 영역까지 스크롤한
 * 채로 가방·제작·취소(B) 버튼을 눌러도 정확히 그 패널로 전환된다 — 겹침이
 * 히트 테스트를 방해하지 않는다.
 */
const MENU_BOTTOM_RESERVE = 32
/** 극단적으로 낮은 화면에서도 두 줄 글자가 안 뭉개지는 최소 높이. */
const MIN_HEIGHT = 64

// 가방·제작 — 아직 자리만 있는 작은 안내 상자의 치수.
const SIDE_MARGIN = 32
const MAX_WIDTH = 380
const MAX_HEIGHT = 170
const TEXT_PADDING = 16

// 상세 메뉴 — 안이 스크롤되므로(ScrollList) 자기 몫의 세로 안전 영역을 꽉
// 채운다(MENU_BOTTOM_RESERVE — bag·craft 의 안전 영역보다 아래로 더 내려간다).
// 가로만 이 폭 안에서 상한을 둔다(너무 넓으면 한 줄이 길어져 오히려 읽기 나쁘다).
const MENU_MAX_WIDTH = 720
const MENU_SIDE_MARGIN = 16
const MENU_TAB_BAR_HEIGHT = 26
const MENU_CONTENT_GAP = 8
const MENU_CONTENT_PADDING = 8
const TAB_INDICATOR_HEIGHT = 2
const TAB_LABEL_FONT_SIZE = 13

/**
 * 어느 패널이 열려 있는지.
 *
 * `bag`·`craft` 는 아직 자리만 있다(설계 문서 §9 가 내용을 범위 밖에 뒀다) —
 * 무엇이 열렸는지와 "아직 안 만들었다"만 보여준다. `menu` 는 이 태스크가
 * 채우는 B 의 상세 메뉴다: 탭으로 나뉘고 실제 내용(숙련도·이정표·설정)이 있다.
 */
type PanelId = 'bag' | 'craft' | 'menu'

/** 어느 패널인지와 "아직 안 만들었다"만 말한다 — bag·craft 의 내용은 설계 문서 §9 에서 범위 밖이다. */
const PANEL_TEXT: Record<'bag' | 'craft', { title: string; body: string }> = {
  bag: { title: '가방', body: '아직 만들지 않았습니다.' },
  craft: { title: '제작', body: '아직 만들지 않았습니다.' },
}

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
 *  - `bag`·`craft`: 아직 자리만 있다(설계 문서 §9 범위 밖) — 무엇이 열렸는지와
 *    "아직 안 만들었다"만 보여준다. 가짜 인벤토리를 꾸미지 않는다.
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
  // 가방·제작 — 작은 안내 상자.
  private box!: Phaser.GameObjects.Rectangle
  private title!: Phaser.GameObjects.Text
  private body!: Phaser.GameObjects.Text

  // 상세 메뉴.
  private menuBox!: Phaser.GameObjects.Rectangle
  private tabButtons: TabButton[] = []
  private tabIndicator!: Phaser.GameObjects.Rectangle
  private scrollList!: ScrollList

  private hub: InputHub | null = null
  private open: PanelId | null = null
  private menuTab: DetailMenuTab = 'skills'
  private unsubscribeMenuRequest: (() => void) | null = null

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

    this.menuBox = this.add
      .rectangle(0, 0, 10, 10, PANEL_COLOR, PANEL_ALPHA)
      .setStrokeStyle(2, PANEL_EDGE_COLOR, 1)
      .setVisible(false)

    this.tabButtons = TABS.map((tab) => {
      const label = this.add
        .text(0, 0, tab.label, {
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
      // input 자체를 안 붙이는 경우가 있었다(실측). layoutMenu() 가 매 리사이즈마다
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

    this.layout(this.scale.width, this.scale.height)
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

    // ControlScene 과 같은 이유로 SHUTDOWN·DESTROY 둘 다에 같은 정리를 걸고
    // 두 번째 호출은 가드로 무시한다 — ControlScene.create() 의 주석 참고.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.scale.off('resize', this.handleResize, this)
      this.unsubscribeMenuRequest?.()
      this.unsubscribeMenuRequest = null
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
      // B 의 의미는 하나다: 무엇이든(가방·제작·메뉴) 열려 있으면 닫고,
      // 아무것도 없으면 상세 메뉴를 연다 — 휴대폰 뒤로 가기와 같은 규칙이다.
      next = this.open === null ? 'menu' : null
    }

    this.setOpen(next)
  }

  private setOpen(next: PanelId | null): void {
    if (next === this.open) return
    this.open = next
    // B 로 새로 열 때는 항상 첫 탭(숙련도)에서 시작한다 — 톱니로 연 설정
    // 탭과 달리, B 는 "무엇을 보러 왔는지"를 모르는 진입이라 고정된 시작점이 필요하다.
    if (next === 'menu') this.menuTab = 'skills'
    this.render()
    this.hub?.setWorldInputLocked(this.open !== null)
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
    this.hub?.setWorldInputLocked(true)
  }

  /** 메뉴 안 탭 바를 눌렀을 때. 메뉴는 이미 열려 있으므로 open·잠금은 건드리지 않는다. */
  private selectTab(tab: DetailMenuTab): void {
    if (this.menuTab === tab) return
    this.menuTab = tab
    this.render()
  }

  private render(): void {
    const open = this.open

    const showSimple = open === 'bag' || open === 'craft'
    this.box.setVisible(showSimple)
    this.title.setVisible(showSimple)
    this.body.setVisible(showSimple)
    if (showSimple) {
      const content = PANEL_TEXT[open]
      this.title.setText(content.title)
      this.body.setText(content.body)
    }

    const showMenu = open === 'menu'
    this.menuBox.setVisible(showMenu)
    this.tabIndicator.setVisible(showMenu)
    for (const btn of this.tabButtons) btn.label.setVisible(showMenu)
    this.scrollList.setVisible(showMenu)
    if (showMenu) {
      this.refreshMenu()
    } else {
      // 메뉴가 닫히면 줄(Text 오브젝트)을 다음에 열릴 때까지 붙잡아 둘 이유가
      // 없다 — 여기서 바로 놓아준다(ScrollList.clear() 문서 참고).
      this.scrollList.clear()
    }
  }

  /** 메뉴를 열거나 탭을 바꿀 때: 위치(탭 밑줄 포함)까지 다시 잡고 내용도 다시 짠다. */
  private refreshMenu(): void {
    this.layout(this.scale.width, this.scale.height)
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

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.layout(gameSize.width, gameSize.height)
    // 메뉴가 열린 채로 리사이즈되면 줄바꿈 폭이 달라지므로 내용을 다시 짠다.
    if (this.open === 'menu') this.rebuildMenuContent()
  }

  /**
   * 패널 상자들을 화면 크기에 맞게 다시 잡는다.
   *
   * 위로는 상단 바를 침범하지 않는 안전 영역을 계산하고 그 안에 상자를
   * 맞춘다 — 가로 화면 전용이라 세로 폭이 늘 좁으므로, 화면이 작아져도 그
   * 영역과 겹치지 않는 게 최우선이다. 아래쪽 여백은 bag·craft 와 menu 가
   * 다르다(BOTTOM_RESERVE·MENU_BOTTOM_RESERVE 각 주석 참고) — 그래서 안전
   * 영역도 둘을 따로 계산한다.
   */
  private layout(width: number, height: number): void {
    const simpleSafeBottom = Math.max(TOP_MARGIN + MIN_HEIGHT, height - BOTTOM_RESERVE)
    const menuSafeBottom = Math.max(TOP_MARGIN + MIN_HEIGHT, height - MENU_BOTTOM_RESERVE)

    this.layoutSimplePanel(width, simpleSafeBottom - TOP_MARGIN)
    this.layoutMenu(width, menuSafeBottom - TOP_MARGIN)
  }

  private layoutSimplePanel(width: number, safeHeight: number): void {
    const boxWidth = Math.min(MAX_WIDTH, Math.max(160, width - SIDE_MARGIN * 2))
    const boxHeight = Math.min(MAX_HEIGHT, safeHeight)

    const x = width / 2
    const y = TOP_MARGIN + safeHeight / 2

    this.box.setPosition(x, y).setSize(boxWidth, boxHeight)
    this.title.setPosition(x, y - 16)
    this.body.setPosition(x, y + 12)
    this.body.setWordWrapWidth(boxWidth - TEXT_PADDING * 2)
  }

  /**
   * 상세 메뉴는 안이 스크롤되므로(ScrollList) bag·craft 상자처럼 작게 가둘
   * 이유가 없다 — 자기 몫의 세로 안전 영역(layout() 이 MENU_BOTTOM_RESERVE 로
   * 계산한, bag·craft 보다 더 아래로 내려가는 영역)을 꽉 채운다. 가로만
   * MENU_MAX_WIDTH 로 상한을 둔다(너무 넓으면 한 줄이 길어져 오히려 읽기 나쁘다).
   */
  private layoutMenu(width: number, safeHeight: number): void {
    const menuWidth = Math.min(MENU_MAX_WIDTH, Math.max(240, width - MENU_SIDE_MARGIN * 2))
    const menuLeft = (width - menuWidth) / 2
    const menuTop = TOP_MARGIN

    this.menuBox.setPosition(width / 2, menuTop + safeHeight / 2).setSize(menuWidth, safeHeight)

    const tabWidth = menuWidth / TABS.length
    const tabBarCenterY = menuTop + MENU_TAB_BAR_HEIGHT / 2
    this.tabButtons.forEach((btn, i) => {
      const colLeft = menuLeft + tabWidth * i
      btn.hitZone.setPosition(colLeft, menuTop).setSize(tabWidth, MENU_TAB_BAR_HEIGHT)
      // Zone 의 setInteractive() 는 호출 시점의 width/height 로 히트 영역을
      // 스냅샷한다(ScrollList.setViewport 의 같은 주석, 원출처는
      // ControlScene.setCircularHitArea) — setSize() 는 그 스냅샷을 자동으로
      // 따라오지 않으므로 리사이즈마다 직접 갱신한다.
      const hitArea = btn.hitZone.input?.hitArea as Phaser.Geom.Rectangle | undefined
      hitArea?.setTo(0, 0, tabWidth, MENU_TAB_BAR_HEIGHT)
      btn.label.setPosition(colLeft + tabWidth / 2, tabBarCenterY)
    })

    const activeIndex = Math.max(
      0,
      TABS.findIndex((t) => t.id === this.menuTab),
    )
    this.tabIndicator
      .setPosition(menuLeft + tabWidth * activeIndex + tabWidth / 2, menuTop + MENU_TAB_BAR_HEIGHT)
      .setSize(tabWidth * 0.6, TAB_INDICATOR_HEIGHT)

    const contentTop = menuTop + MENU_TAB_BAR_HEIGHT + MENU_CONTENT_GAP
    const contentLeft = menuLeft + MENU_CONTENT_PADDING
    const contentWidth = menuWidth - MENU_CONTENT_PADDING * 2
    const contentHeight = Math.max(0, menuTop + safeHeight - MENU_CONTENT_PADDING - contentTop)
    this.scrollList.setViewport(contentLeft, contentTop, contentWidth, contentHeight)
  }
}
