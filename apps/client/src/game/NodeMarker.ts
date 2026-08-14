import Phaser from 'phaser'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'
import { nodeSpriteKey } from './nodeSprites.js'

export interface NodeMarkerOptions {
  scene: Phaser.Scene
  x: number
  y: number
  instanceId: string
  label: string
  /**
   * `nodes.csv` 의 `sprite` 이름. 등급(`variant`)이 아니라 이 이름이 그림을 정한다 —
   * 같은 계열의 보통과 심층이 갈리는 것은 이제 색이 아니라 그림 자체다(잎↔가지,
   * 꽃의 유무, 금속색). 텍스처가 이미 로더에 올라 있다고 전제한다(WorldScene.preload).
   */
  sprite: string
}

/** 맵 위 채집 노드 한 개. 보여주기만 한다 — 상호작용은 앞칸 판정이 대신한다. */
export class NodeMarker {
  readonly instanceId: string
  private readonly body: Phaser.GameObjects.Image
  private readonly caption: Phaser.GameObjects.Text
  private readonly container: Phaser.GameObjects.Container

  constructor(options: NodeMarkerOptions) {
    const { scene, x, y, instanceId, label, sprite } = options
    this.instanceId = instanceId

    // 그림은 32×32 한 칸이라 타일 한 칸을 정확히 덮는다(설계 규범 13). 크기를
    // 여기서 손대지 않는 것이 중요하다 — 늘리면 밑변 정렬과 y 정렬 깊이가 따라오는데
    // DEPTH.node 는 평면이라 그 순간 노드가 플레이어를 가리거나 그 반대가 된다.
    this.body = scene.add.image(0, 0, nodeSpriteKey(sprite))

    // 캡션 자리는 네모였던 시절 그대로다. 그림이 24px 네모보다 위아래로 4px 씩
    // 크므로 간격이 6px 에서 2px 로 좁아졌을 뿐, 이름은 여전히 그림 바로 밑에 선다.
    this.caption = addText(scene, 0, 18, label, {
      fontSize: `${FONT_SIZE.caption}px`,
      color: '#e8dcc0',
    }).setOrigin(0.5, 0)

    this.container = scene.add.container(x, y, [this.body, this.caption])
    this.container.setDepth(DEPTH.node)
  }
}
