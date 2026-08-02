import Phaser from 'phaser'
import { DEPTH } from './depth.js'

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
  nodeId: string
  label: string
  tier: number
  onTap: (nodeId: string) => void
}

/**
 * 맵 위 채집 노드 한 개.
 * 자체 게임 상태를 들고 있지 않으며, 쿨다운은 씬이 스토어를 읽어 주입한다.
 */
export class NodeMarker {
  readonly nodeId: string
  private readonly defaultLabel: string
  private readonly body: Phaser.GameObjects.Rectangle
  private readonly caption: Phaser.GameObjects.Text
  private readonly container: Phaser.GameObjects.Container

  constructor(options: NodeMarkerOptions) {
    const { scene, x, y, nodeId, label, tier, onTap } = options
    this.nodeId = nodeId
    this.defaultLabel = label

    this.body = scene.add
      .rectangle(0, 0, 24, 24, TIER_COLORS[tier] ?? TIER_COLORS[1]!)
      .setStrokeStyle(2, 0x241c1c)

    this.caption = scene.add
      .text(0, 18, label, { fontSize: '10px', color: '#e8dcc0' })
      .setOrigin(0.5, 0)

    this.container = scene.add.container(x, y, [this.body, this.caption])
    this.container.setDepth(DEPTH.node)

    this.body.setInteractive({ useHandCursor: true })
    this.body.on('pointerdown', () => onTap(nodeId))
  }

  /** 남은 쿨다운(ms). 0 이하면 채집 가능 상태로 표시한다. */
  setCooldown(remainingMs: number): void {
    if (remainingMs > 0) {
      this.body.setAlpha(0.3)
      this.caption.setText(`${Math.ceil(remainingMs / 1000)}초`)
    } else {
      this.body.setAlpha(1)
      this.caption.setText(this.defaultLabel)
    }
  }
}
