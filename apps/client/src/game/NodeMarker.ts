import Phaser from 'phaser'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'

/** tokens.css 의 --c-tier-* 와 같은 색. 픽셀 맵과 UI 의 팔레트를 맞춘다. */
const TIER_COLORS: Record<number, number> = {
  1: 0xa8785a,
  2: 0x9aa3ad,
  3: 0x6fc2d6,
}

export interface NodeMarkerOptions {
  scene: Phaser.Scene
  x: number
  y: number
  instanceId: string
  label: string
  tier: number
}

/** 맵 위 채집 노드 한 개. 보여주기만 한다 — 상호작용은 앞칸 판정이 대신한다. */
export class NodeMarker {
  readonly instanceId: string
  private readonly body: Phaser.GameObjects.Rectangle
  private readonly caption: Phaser.GameObjects.Text
  private readonly container: Phaser.GameObjects.Container

  constructor(options: NodeMarkerOptions) {
    const { scene, x, y, instanceId, label, tier } = options
    this.instanceId = instanceId

    this.body = scene.add
      .rectangle(0, 0, 24, 24, TIER_COLORS[tier] ?? TIER_COLORS[1]!)
      .setStrokeStyle(2, 0x241c1c)

    this.caption = addText(scene, 0, 18, label, {
      fontSize: `${FONT_SIZE.caption}px`,
      color: '#e8dcc0',
    }).setOrigin(0.5, 0)

    this.container = scene.add.container(x, y, [this.body, this.caption])
    this.container.setDepth(DEPTH.node)
  }
}
