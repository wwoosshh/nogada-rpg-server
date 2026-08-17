import Phaser from 'phaser'
import type { TiledMapJson } from '@nogada/data'
import type { GameData, PlayerState, TilePos } from '@nogada/shared'
import type { InputHub } from '../../input/InputState.js'
import { useGameStore } from '../../store/gameStore.js'
import { addText, FONT_SIZE } from '../gameText.js'
import {
  FLAG,
  MINIMAP,
  MINIMAP_INNER,
  MINIMAP_ORIGIN,
  flagGlyph,
  minimapFit,
  minimapMarks,
  tileToScreen,
  type MinimapFit,
} from '../minimap.js'
import { bakeMinimap } from '../minimapBake.js'
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
/** INK_COLOR 와 같은 색의 숫자꼴 — Phaser 도형은 문자열 색을 안 받는다. */
const INK_SHAPE_COLOR = 0x241c1c

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
 * 미니맵의 반투명도 — **띠보다 진하다.**
 *
 * 띠는 게임 화면 위에 겹친 글이라 아래가 비쳐야 하지만(BAND_ALPHA), 미니맵 상자
 * 안쪽은 곧바로 구운 그림이 덮으므로 비칠 것이 없다. 이 값이 실제로 보이는 곳은
 * 맵이 정사각이 아닐 때 남는 여백(contain-fit)이고, 거기서 옅으면 "지도가 여기서
 * 끝난다"는 경계가 흐려진다.
 */
const MINIMAP_ALPHA = 0.94

/*
 * 얹는 것들의 색 — 전부 tokens.css 다(위 팔레트 주석과 같은 이유로 리터럴이다).
 *
 * 넷이 서로 안 겹치는 것이 이 목록의 요점이다: 흰 점은 나(--c-parchment 가 아니라
 * 순백이다 — 파치먼트는 상자 안 어디에나 있는 글자색이다), 노랑은 문(--c-accent),
 * 붉음은 숙련을 요구하는 문(--c-danger — 오늘 못 지나가는 문이라는 뜻이고, 그
 * 요구치를 옆에 숫자로 적는다), 초록은 지금 갈 곳(--c-success).
 */
const ME_COLOR = 0xffffff
const DOOR_COLOR = 0xd9a441
const GATED_DOOR_COLOR = 0xb4543a
const FLAG_COLOR = 0x7fa650

/** 문 네모의 한 변. 배율이 가장 작은 월드맵(1.40px/타일)에서도 눈에 잡히는 크기다. */
const DOOR_SIZE = 5
/** 흰 점의 반지름. 문 네모보다 작아야 겹쳤을 때 어느 쪽이 나인지 읽힌다. */
const ME_RADIUS = 2.5
/** 문 옆에 적는 요구 숫자와 그 문 사이의 틈. */
const GATE_LABEL_GAP = 3

/**
 * 상자 안에서 무엇이 무엇을 덮는가.
 *
 * 축소도와 문 네모는 만든 순서대로 0 에 남고, **깃발과 나만 그 위로 올린다** —
 * 이 둘은 문 위에 겹칠 수 있고(첫 60초의 깃발이 정확히 문 위다) 그때 가려지면
 * 안내가 사라진다. 깃발보다 내가 위인 이유는 겹쳤을 때 알아야 하는 것이 "다
 * 왔다" 이기 때문이다.
 */
const MARK_DEPTH = { flag: 1, me: 2 } as const

/** 구운 축소도가 올라가는 텍스처 키의 앞머리. 씬이 끝날 때 이 이름으로 지운다. */
const MINIMAP_TEXTURE_PREFIX = 'minimap:'

/**
 * 미니맵이 씬에서 읽어 가는 것 둘.
 *
 * **왜 스토어가 아닌가**(설계 ⑤): 플레이어의 실시간 자리는 스토어에 없다 —
 * `player.location` 은 전환·사망 귀환에만 갱신되고 맵 안의 걸음은 서버로 안 간다.
 * Phaser 면 `mover.tile` 을 그냥 읽어 5Hz 채널을 새로 팔 필요가 없다.
 */
export interface MinimapSource {
  /**
   * 지금 그리는 맵. 씬이 사는 동안 바뀌지 않는다 — 맵이 바뀐다는 것은 곧 씬을
   * 통째로 다시 시작한다는 뜻이다(WorldScene 의 `mapId` 와 같은 이유).
   */
  mapId: string
  /** 지금 서 있는 칸. */
  tile: () => TilePos
}

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
 * 잠겼다(패널·대사창·**맵 전환 중**). 마지막 것을 이 씬이 스스로 재는 이유는
 * update() 문서에 적었다.
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

  /** 미니맵 상자. 그림이 없어도 선다 — 자리가 흔들리지 않는 것이 설계 ⑤ 의 전제다. */
  private minimapBox!: Phaser.GameObjects.Rectangle
  private minimapImage: Phaser.GameObjects.Image | null = null
  /** 이 맵의 배율과 여백. bind() 가 정하고 그 뒤로는 안 바뀐다(맵이 바뀌면 씬이 다시 선다). */
  private fit: MinimapFit | null = null
  private source: MinimapSource | null = null
  /** 흰 점(나) — `mover.tile` 을 매 프레임 따라간다. */
  private meDot!: Phaser.GameObjects.Arc
  /** 문 표식(네모)과 요구 숫자(글). 맵마다 개수가 달라 목록으로 들고 있다. */
  private readonly doorMarks: (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = []
  private flagPole!: Phaser.GameObjects.Rectangle
  private flagBanner!: Phaser.GameObjects.Triangle
  /** 지금 깃발을 세울 곳이 있는가 — 없으면 잠금과 무관하게 안 보인다. */
  private hasFlag = false
  /** 마지막으로 흰 점을 옮긴 칸. 같으면 다시 안 옮긴다. */
  private meTile: TilePos = { x: -1, y: -1 }
  /** 이 씬이 올린 축소도 텍스처. 씬이 끝날 때 지운다 — 텍스처는 게임 전역이다. */
  private textureKey: string | null = null

  constructor() {
    super({ key: 'Hud' })
  }

  create(): void {
    // 씬을 다시 시작해도 인스턴스는 같은 것이 쓰인다 — WorldScene.create() 의 첫
    // 문단과 같은 이유로, 이전 맵의 기억을 여기서 비운다. 도형 자체는 Phaser 가
    // 씬과 함께 버리지만 이 목록은 우리 것이라 죽은 참조가 그대로 남는다.
    this.doorMarks.length = 0
    this.minimapImage = null
    this.fit = null
    this.source = null
    this.textureKey = null
    this.meTile = { x: -1, y: -1 }
    this.hasFlag = false

    // 미니맵 상자가 먼저다 — UI 씬은 만든 순서가 곧 그리는 순서라, 뒤에 만드는
    // 축소도와 표식들이 이 상자 위에 얹힌다.
    this.minimapBox = this.add
      .rectangle(MINIMAP.x, MINIMAP.y, MINIMAP.size, MINIMAP.size, PANEL_COLOR, MINIMAP_ALPHA)
      .setOrigin(0, 0)
      .setStrokeStyle(MINIMAP.border, PANEL_EDGE_COLOR, 1)
      .setVisible(false)

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
      this.source = null
      // 도형은 씬과 함께 사라지지만 **텍스처는 게임 전역이라 안 사라진다.** 맵을
      // 넘을 때마다 이 씬이 다시 서므로, 안 지우면 걸어 다닌 맵 수만큼 캔버스가
      // 메모리에 쌓인다(월드맵 하나가 112×112×기기픽셀비² 다).
      if (this.textureKey && this.textures.exists(this.textureKey)) {
        this.textures.remove(this.textureKey)
      }
      this.textureKey = null
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
   *
   * `world` 는 미니맵이 읽는 것 둘이다(MinimapSource). 축소도를 **여기서** 굽는
   * 이유는 어느 맵인지가 그때 정해지기 때문이고(씬의 create() 는 맵을 모른다),
   * 한 번만 굽는 이유는 맵이 바뀌면 이 씬이 통째로 다시 서기 때문이다.
   */
  bind(hub: InputHub, control: ControlScene, world: MinimapSource): void {
    if (this.hub) throw new Error('HudScene.bind 은 한 번만 부를 수 있다')
    this.hub = hub
    this.control = control
    this.source = world

    this.buildMinimap(world.mapId)

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
   * **주인이 셋이다.** `worldInputLocked` 는 dialogue·panel·**transition** 의
   * 합이다(InputState 의 lockedBy) — 그래서 띠는 문을 넘는 서버 왕복 동안에도
   * 꺼졌다가 씬이 다시 서면 돌아온다. 하필 마디 0→1 이 넘어가는 그 순간이지만
   * 씬이 통째로 재시작하는 구간이라 눈에 띄지는 않는다. 여기 적어 두는 이유는
   * 다음 사람이 이 세 번째 주인을 모른 채 "패널만 보는 값"으로 읽지 않게 하려는
   * 것이다(전환이 거절되면 — 결계에 막히면 — 잠금이 풀려 띠가 돌아온다).
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
    if (locked !== this.locked) {
      this.locked = locked
      this.applyVisibility()
    }
    this.followPlayer()
  }

  /**
   * 흰 점을 지금 서 있는 칸으로 옮긴다 — **이 씬에서 유일하게 매 프레임 도는 일**.
   *
   * 칸이 그대로면 아무것도 안 한다. 걸음 하나가 200ms 이므로(STEP_MS) 60fps 에서
   * 열두 프레임에 한 번만 실제로 옮기고, 나머지 열한 번은 비교 둘로 끝난다.
   *
   * **칸 단위로만 움직인다**(픽셀 보간을 안 쓴다). 배율이 1.40~4.67px/타일이라
   * 한 걸음이 미니맵에서 1~5px 이고, 그 거리를 200ms 에 걸쳐 보간해 봐야 눈에
   * 보이는 것은 같은 점이다 — 대신 매 프레임 좌표를 다시 계산하게 된다.
   */
  private followPlayer(): void {
    const fit = this.fit
    if (!fit || !this.source) return
    const tile = this.source.tile()
    if (tile.x === this.meTile.x && tile.y === this.meTile.y) return
    this.meTile = tile
    const at = tileToScreen(fit, tile.x, tile.y)
    this.meDot.setPosition(at.x, at.y)
  }

  /** 스토어의 지금 값을 띠·A 테두리·지도 표식에 한꺼번에 비춘다. */
  private render(): void {
    const { data, player } = useGameStore.getState()
    const view = questBandView(data, player)
    this.line = view.line
    // 빈 글로 덮지 않는다 — 안 보이는 동안 글자를 지워 봐야 달라지는 것이 없고,
    // 다시 뜰 때 한 프레임 빈 띠가 보일 여지만 생긴다.
    if (view.line !== null) this.label.setText(view.line)
    this.control?.setActionHighlighted(view.teachAction)

    // 문과 깃발도 같은 자리에서 다시 그린다. 문은 맵이 정하므로 이 씬이 사는
    // 동안 안 바뀌지만(그래도 첫 render 가 세워야 한다), **깃발은 마디가 넘어갈
    // 때마다 옮겨 간다** — 마디 0 에서 1 로 넘어가는 그 순간이 곧 문에서 광맥으로
    // 옮겨 가는 순간이다.
    const source = this.source
    if (source) this.drawMarks(data, player, source.mapId)

    this.applyVisibility()
  }

  private applyVisibility(): void {
    const band = this.line !== null && !this.locked
    this.box.setVisible(band)
    this.label.setVisible(band)

    // **미니맵은 띠와 달리 사슬이 끝나도 남는다.** 띠는 3.5분짜리 유도등이라
    // 꺼지는 것이 설계이고(⑧-6), 지도는 "내가 어디 있는지 모르겠다"에 답하는
    // 항구 비용이다(설계 ⑦ 의 13.7%). 그래서 여기서 보는 것은 잠금 하나다.
    const map = !this.locked
    this.minimapBox.setVisible(map)
    this.minimapImage?.setVisible(map)
    for (const mark of this.doorMarks) mark.setVisible(map)
    this.meDot.setVisible(map)
    this.flagPole.setVisible(map && this.hasFlag)
    this.flagBanner.setVisible(map && this.hasFlag)
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

  /**
   * 이 맵의 축소도를 한 번 굽고, 그 위에 얹을 도형들을 세운다.
   *
   * **굽는 시점이 씬 진입 한 번뿐인 것이 이 아크의 성능 전부다**(설계 ⑤). 굽는
   * 값은 마을 0.2~0.6ms · 월드맵 2.1~2.7ms(데스크톱 실측)이고, 그 뒤로는 프레임마다
   * 이미지 한 장을 그릴 뿐이다.
   *
   * 맵 JSON 과 타일셋 그림은 **이미 메모리에 있다** — 둘 다 게임 전역 캐시라
   * (`cache.tilemap`·`textures`) WorldScene 이 방금 올린 것을 이 씬이 그대로
   * 읽는다. 다시 내려받지 않는다.
   */
  private buildMinimap(mapId: string): void {
    const cached = this.cache.tilemap.get(`map:${mapId}`) as { data?: TiledMapJson } | undefined
    const map = cached?.data
    // WorldScene 의 다른 필수값들과 같은 자세다: 조용한 대체값은 "로더가 어긋났다"를
    // "미니맵이 왜 비어 있지"로 바꿔 놓는다.
    if (!map) {
      throw new Error(`미니맵: 맵 "${mapId}" 의 JSON 이 캐시에 없다 — WorldScene.preload 를 확인하라`)
    }

    const fit = minimapFit(map.width, map.height)
    this.fit = fit

    // **기기 픽셀로 굽는다.** 이 씬의 카메라는 zoom = renderScale() 이라, 112 CSS px
    // 짜리 그림을 올리면 기기 픽셀비 2 인 폰에서 두 배로 늘어나 뭉갠다 — 캔버스
    // 안의 글자만 흐리던 그 문제와 같은 것이다(viewport.ts 의 renderScale).
    const density = renderScale()
    const canvas = document.createElement('canvas')
    // 올림이다. 반올림하면 마지막 줄·칸이 반 px 잘리는데, 잘리는 쪽이 하필
    // 지도의 가장자리라 "세계가 여기서 끝난다"가 흐려진다.
    canvas.width = Math.ceil(fit.width * density)
    canvas.height = Math.ceil(fit.height * density)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('미니맵: 2d 컨텍스트를 못 얻었다')

    bakeMinimap(
      ctx,
      map,
      (name) => (this.textures.exists(name) ? (this.textures.get(name).getSourceImage() as CanvasImageSource) : undefined),
      fit.scale * density,
    )

    // 텍스처는 **게임 전역**이라 같은 이름이 남아 있으면 addCanvas 가 거절한다
    // (같은 맵으로 되돌아오는 경우다). 지우고 다시 올린다 — 캐시로 재사용하지
    // 않는 이유는 설계 ⑨ 다: 폰에서 몇 ms 인지 재기 전에는 손잡이를 늘리지 않는다.
    const key = `${MINIMAP_TEXTURE_PREFIX}${mapId}`
    if (this.textures.exists(key)) this.textures.remove(key)
    this.textures.addCanvas(key, canvas)
    this.textureKey = key

    this.minimapImage = this.add
      .image(MINIMAP_ORIGIN.x + fit.offsetX, MINIMAP_ORIGIN.y + fit.offsetY, key)
      .setOrigin(0, 0)
      // 기기 픽셀로 구운 것을 CSS 픽셀 크기로 되돌린다 — 카메라 zoom 이 다시
      // density 를 곱하므로 화면에서는 원본 한 픽셀이 한 픽셀로 떨어진다.
      .setDisplaySize(fit.width, fit.height)
      .setVisible(false)

    // **깃발과 흰 점은 문 네모 위에 선다.** 이 둘은 여기서(bind) 만들어지고 문
    // 네모는 나중에(render→drawMarks) 만들어지므로 만든 순서로는 아래로 가는데,
    // 깃발은 종종 **문 위에** 선다(다른 맵이 목적지일 때 그 맵으로 가는 문을
    // 가리킨다 — 첫 60초가 정확히 그 경우다). 그때 문 네모가 깃대 밑동을 덮으면
    // 깃발이 공중에 뜬 것처럼 보인다. 깊이로 못박아 만든 순서와 무관하게 한다.
    this.flagPole = this.add
      .rectangle(0, 0, 1, FLAG.poleHeight, INK_SHAPE_COLOR, 1)
      .setDepth(MARK_DEPTH.flag)
      .setVisible(false)
    this.flagBanner = this.add
      .triangle(0, 0, 0, 0, FLAG.bannerWidth, FLAG.bannerHeight / 2, 0, FLAG.bannerHeight, FLAG_COLOR, 1)
      .setDepth(MARK_DEPTH.flag)
      .setVisible(false)
    this.meDot = this.add
      .circle(0, 0, ME_RADIUS, ME_COLOR, 1)
      .setStrokeStyle(1, INK_SHAPE_COLOR, 1)
      .setDepth(MARK_DEPTH.me)
      .setVisible(false)
  }

  /**
   * 문과 깃발을 지금 상태대로 다시 세운다.
   *
   * 매번 도형을 버리고 다시 만드는 이유: 문은 맵이 정하므로 개수가 안 바뀌지만
   * 이 함수는 마디가 넘어갈 때마다 불리고, "몇 개까지 만들어 뒀는가"를 기억하는
   * 쪽이 그 재사용으로 아끼는 것보다 비싸다 — 이 씬이 사는 동안 실제로 도는 횟수는
   * 마디 수만큼(여섯 번 이하)이다.
   */
  private drawMarks(data: GameData, player: PlayerState | null, mapId: string): void {
    const fit = this.fit
    if (!fit) return

    for (const mark of this.doorMarks) mark.destroy()
    this.doorMarks.length = 0

    const marks = minimapMarks(data, player, mapId)

    for (const door of marks.doors) {
      const at = tileToScreen(fit, door.x, door.y)
      this.doorMarks.push(
        this.add
          .rectangle(at.x, at.y, DOOR_SIZE, DOOR_SIZE, door.gate === null ? DOOR_COLOR : GATED_DOOR_COLOR, 1)
          .setStrokeStyle(1, INK_SHAPE_COLOR, 1),
      )
      if (door.gate === null) continue

      // 숫자는 문의 **안쪽**으로 적는다. 결계 문은 언제나 맵 가장자리 가까이에
      // 있어(전환은 가장자리 칸이다) 바깥으로 적으면 상자 밖으로 나간다.
      const toRight = at.x < MINIMAP_ORIGIN.x + MINIMAP_INNER / 2
      const text = addText(this, 0, at.y, door.gate, {
        fontSize: `${FONT_SIZE.caption}px`,
        color: LABEL_COLOR,
        stroke: INK_COLOR,
        strokeThickness: 3,
      }).setOrigin(toRight ? 0 : 1, 0.5)
      text.setX(at.x + (toRight ? DOOR_SIZE / 2 + GATE_LABEL_GAP : -(DOOR_SIZE / 2 + GATE_LABEL_GAP)))
      this.doorMarks.push(text)
    }

    this.hasFlag = marks.flag !== null
    if (marks.flag) {
      // 깃대 밑동이 그 칸이다 — 깃발은 그 끝에 매달린다. 가리키는 곳이 그림의
      // 가운데가 아니라 밑동이라는 것이 깃발을 쓰는 이유다. 위로 설 자리가 없으면
      // 아래로 뒤집는다(FlagGlyph.up) — 밑동은 그대로 두고 매다는 쪽만 바꾼다.
      const g = flagGlyph(fit, marks.flag.x, marks.flag.y)
      this.flagPole.setOrigin(0.5, g.up ? 1 : 0).setPosition(g.x, g.y)
      this.flagBanner
        .setOrigin(0, g.up ? 0 : 1)
        .setPosition(g.x + 1, g.up ? g.y - FLAG.poleHeight : g.y + FLAG.poleHeight)
    }
  }
}
