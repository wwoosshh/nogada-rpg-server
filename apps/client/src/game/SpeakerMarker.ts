import Phaser from 'phaser'
import type { SpeakerDef } from '@nogada/shared'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'

/*
 * tokens.css 의 --c-accent / --c-panel-edge / --c-ink / --c-parchment 와 같은 색.
 * NodeMarker 와 같은 이유로 리터럴을 옮겨 적는다(Phaser 도형은 CSS 변수를 못
 * 읽는다 — ControlScene.ts 상단 주석 참고). 바꿀 때 tokens.css 와 함께 고친다.
 */
const NPC_COLOR = 0xd9a441
const SIGN_COLOR = 0x6b5646
const EDGE_COLOR = 0x241c1c
const CAPTION_COLOR = '#e8dcc0'

/**
 * 화자 종류마다 다른 크기. 32px 타일 안에 들어가되 서로 한눈에 구별돼야 한다 —
 * 사람은 세로로 길고, 간판은 가로로 넓은 판이다. 노드 마커(24×24 정사각)와도
 * 겹치지 않는 실루엣이라, 지도만 보고 "말을 걸 수 있는 것"과 "캘 수 있는 것"이
 * 갈린다.
 */
const SIZE: Record<SpeakerDef['kind'], { width: number; height: number; color: number }> = {
  npc: { width: 18, height: 28, color: NPC_COLOR },
  sign: { width: 26, height: 16, color: SIGN_COLOR },
}

export interface SpeakerMarkerOptions {
  scene: Phaser.Scene
  x: number
  y: number
  speakerId: string
  label: string
  kind: SpeakerDef['kind']
}

/**
 * 맵 위 화자 한 명(또는 한 개). NodeMarker 와 같은 자세다 — **보여주기만 한다.**
 *
 * 히트 테스트를 켜지 않는 것이 중요하다. 상호작용은 앞칸 판정(WorldScene 의
 * frontTile + byTile)이 전부 대신하므로, 여기서 setInteractive 를 켜면 같은
 * 일을 두 경로가 하게 되고 그중 하나(탭)는 "앞칸을 보고 결정 버튼"이라는
 * 이 게임의 유일한 동사를 우회한다.
 *
 * 스프라이트가 아니라 도형인 이유는 저장소가 라이선스 그림을 담지 못하기
 * 때문이다(assets/CREDITS.md: Pipoya 재배포 금지 → apps/client/public/sprites/
 * 는 .gitignore 대상). `speakers.csv` 의 `sprite` 칸은 그림이 들어올 자리로
 * 남아 있고, 지금은 `kind` 만 보고 그린다 — 있지도 않은 파일 이름을 로드하려
 * 들면 에셋을 복원하지 않은 환경에서 맵 전체가 깨진다.
 */
export class SpeakerMarker {
  readonly speakerId: string
  private readonly body: Phaser.GameObjects.Rectangle
  private readonly caption: Phaser.GameObjects.Text
  private readonly container: Phaser.GameObjects.Container

  constructor(options: SpeakerMarkerOptions) {
    const { scene, x, y, speakerId, label, kind } = options
    this.speakerId = speakerId

    const shape = SIZE[kind]
    this.body = scene.add
      .rectangle(0, 0, shape.width, shape.height, shape.color)
      .setStrokeStyle(2, EDGE_COLOR)

    // 이름표는 몸통 바로 아래. 노드 마커와 같은 크기·색이라 지도의 글자가
    // 한 종류로 읽힌다(FONT_SIZE.caption 이 격자를 벗어난 이유는 그 문서 참고).
    this.caption = addText(scene, 0, shape.height / 2 + 4, label, {
      fontSize: `${FONT_SIZE.caption}px`,
      color: CAPTION_COLOR,
    }).setOrigin(0.5, 0)

    this.container = scene.add.container(x, y, [this.body, this.caption])
    this.container.setDepth(DEPTH.speaker)
  }
}
