import Phaser from 'phaser'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'

export type NodeVariant = 'normal' | 'deep'

/**
 * tokens.css 의 --c-node-normal / --c-node-deep 와 같은 색. Phaser 도형은 CSS
 * 변수를 직접 못 읽으므로 리터럴로 옮기고 주석으로 출처를 남긴다(ControlScene.ts·
 * FloatingText.ts 와 같은 관습) — 바꿀 때 tokens.css 와 함께 고친다.
 */
const VARIANT_COLORS: Record<NodeVariant, number> = {
  normal: 0xa8785a,
  deep: 0x4d8a99,
}

export interface NodeMarkerOptions {
  scene: Phaser.Scene
  x: number
  y: number
  instanceId: string
  label: string
  variant: NodeVariant
}

/** 맵 위 채집 노드 한 개. 보여주기만 한다 — 상호작용은 앞칸 판정이 대신한다. */
export class NodeMarker {
  readonly instanceId: string
  private readonly body: Phaser.GameObjects.Rectangle
  private readonly caption: Phaser.GameObjects.Text
  private readonly container: Phaser.GameObjects.Container

  constructor(options: NodeMarkerOptions) {
    const { scene, x, y, instanceId, label, variant } = options
    this.instanceId = instanceId

    this.body = scene.add
      .rectangle(0, 0, 24, 24, VARIANT_COLORS[variant])
      .setStrokeStyle(2, 0x241c1c)

    this.caption = addText(scene, 0, 18, label, {
      fontSize: `${FONT_SIZE.caption}px`,
      color: '#e8dcc0',
    }).setOrigin(0.5, 0)

    this.container = scene.add.container(x, y, [this.body, this.caption])
    this.container.setDepth(DEPTH.node)
  }
}
