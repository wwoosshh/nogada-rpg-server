import Phaser from 'phaser'
import worldMap from '@nogada/data/maps/world.json' with { type: 'json' }
import { gameTimeAt, type Direction, type TilePos } from '@nogada/shared'
import { InputHub } from '../../input/InputState.js'
import { KeyboardSource } from '../../input/KeyboardSource.js'
import { useGameStore } from '../../store/gameStore.js'
import { worldNow } from '../../time/clock.js'
import { DEPTH } from '../depth.js'
import { DayNightOverlay } from '../DayNightOverlay.js'
import { spawnFloatingText } from '../FloatingText.js'
import { NodeMarker } from '../NodeMarker.js'
import { TileMover } from '../TileMover.js'

const TILE = 32

/**
 * Pipoya 32x32 캐릭터 시트는 3열 x 4행이다.
 * 행 순서는 아래·왼쪽·오른쪽·위이고, 가운데 열이 대기 자세다.
 */
const WALK_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 }

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite
  private facing: Direction = 'down'
  private dayNight!: DayNightOverlay
  private unsubscribeStore: (() => void) | null = null
  private hub!: InputHub
  private keyboard!: KeyboardSource
  private mover!: TileMover
  private wallLayer!: Phaser.Tilemaps.TilemapLayer
  private mapWidth = 0
  private mapHeight = 0
  private readonly blocked = new Set<string>()

  constructor() {
    super({ key: 'World' })
  }

  preload(): void {
    this.load.image('pipoya-basechip', 'tilesets/pipoya-basechip.png')
    // Pipoya 캐릭터 시트는 96x128 = 3열 x 4행, 프레임 32x32
    this.load.spritesheet('player', 'sprites/player.png', {
      frameWidth: TILE,
      frameHeight: TILE,
    })
  }

  create(): void {
    // 맵은 packages/data 가 소유한다. 서버가 노드 배치를 알아야 하기 때문이다.
    // HTTP 로 받지 않고 번들에 들어오므로 Capacitor 에서 파일 경로 문제도 없다.
    this.cache.tilemap.add('world', {
      format: Phaser.Tilemaps.Formats.TILED_JSON,
      data: worldMap,
    })

    const map = this.make.tilemap({ key: 'world' })
    // 첫 인자는 Tiled 안의 타일셋 이름, 둘째는 preload 에서 쓴 키다.
    const tileset = map.addTilesetImage('pipoya-basechip', 'pipoya-basechip')
    if (!tileset) throw new Error('타일셋을 찾을 수 없다: Tiled 의 타일셋 이름을 확인하라')

    const ground = map.createLayer('ground', tileset, 0, 0)
    if (!ground) throw new Error('ground 레이어를 찾을 수 없다')
    ground.setDepth(DEPTH.ground)

    // decor 와 overhead 는 선택 레이어다. 장식이 없는 맵도 정상이므로 없어도 오류가 아니다.
    // 존재하지 않는 레이어 이름으로 createLayer 를 호출하면 Phaser 가 콘솔에
    // "Invalid Tilemap Layer ID" 경고를 남긴다 — 옵셔널 체이닝으로 실패를 허용하는 대신,
    // 이름 목록으로 먼저 존재를 확인해 애초에 실패할 호출을 하지 않는다.
    const tileLayerNames = map.getTileLayerNames()

    if (tileLayerNames.includes('decor')) {
      map.createLayer('decor', tileset, 0, 0)?.setDepth(DEPTH.decor)
    }

    const walls = map.createLayer('walls', tileset, 0, 0)
    if (!walls) throw new Error('walls 레이어를 찾을 수 없다')
    walls.setDepth(DEPTH.walls)

    // 플레이어보다 나중이 아니라 깊이로 위에 올린다. 생성 순서와 무관하게 동작한다.
    if (tileLayerNames.includes('overhead')) {
      map.createLayer('overhead', tileset, 0, 0)?.setDepth(DEPTH.overhead)
    }

    const spawn = map.findObject('spawn', (o) => o.name === 'player')
    const startX = spawn?.x ?? TILE * 2
    const startY = spawn?.y ?? TILE * 2

    this.createAnimations()
    this.player = this.add.sprite(startX, startY, 'player', this.idleFrame('down'))
    this.player.setDepth(DEPTH.player)

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
    this.cameras.main.startFollow(this.player, true)

    this.mapWidth = map.width
    this.mapHeight = map.height
    this.wallLayer = walls

    // 노드가 놓인 칸은 걸을 수 없다. 맵 데이터에 벽을 그려 넣는 대신 여기서
    // 판정하는 이유는, 노드 배치가 이미 데이터에 있어서 같은 사실을 두 곳에
    // 적을 필요가 없기 때문이다.
    for (const p of Object.values(useGameStore.getState().data.placements)) {
      this.blocked.add(`${p.x},${p.y}`)
    }

    this.mover = new TileMover({
      start: { x: Math.floor(startX / TILE), y: Math.floor(startY / TILE) },
      isWalkable: (p) => this.isWalkable(p),
    })

    this.hub = new InputHub()
    this.keyboard = new KeyboardSource(this, this.hub)

    this.spawnNodes()

    // 스토어가 여전히 게임 상태의 단일 소유자다. 씬은 결과를 따로 보관하지
    // 않고 변화가 생길 때만 글자를 띄운다. update() 에서 폴링하면 같은
    // 결과를 두 번 그리지 않도록 소비 여부를 씬이 기억해야 하고, 그게 곧
    // 씬이 상태를 갖는 것이다.
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      const action = state.lastAction
      if (!action || action.seq === prev.lastAction?.seq) return
      spawnFloatingText(
        this,
        this.player.x,
        this.player.y - this.player.displayHeight / 2,
        action.text,
        action.tone,
      )
    })

    this.dayNight = new DayNightOverlay(this)

    // 씬이 끝나는 유일한 경로는 App.tsx 의 game.destroy(true) 다. Phaser 는 이 경로에서
    // Systems.destroy() 만 부르고 Systems.shutdown() 은 부르지 않으므로 DESTROY 만
    // 발생하고 SHUTDOWN 은 절대 발생하지 않는다. shutdown 에만 걸면 정리가 전혀 돌지
    // 않아 스토어 구독이 살아남고, 나중에 그 구독이 불리면 이미 사라진 씬에
    // scene.add.text 를 호출해 던진다 — zustand 의 setState 는 리스너를 forEach 로
    // 돌리는데 하나가 던지면 그 뒤 리스너(다음 씬의 구독)는 아예 실행되지 않아 글자
    // 표시가 조용히 멈춘다. 그래서 두 이벤트 모두에 같은 정리 함수를 걸고, 두 번
    // 불려도 안전하도록 가드한다.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      this.dayNight.destroy()
      this.keyboard.destroy()
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  private isWalkable(p: TilePos): boolean {
    if (p.x < 0 || p.y < 0 || p.x >= this.mapWidth || p.y >= this.mapHeight) return false
    if (this.blocked.has(`${p.x},${p.y}`)) return false
    // walls 레이어에 타일이 있으면 벽이다. getTileAt 은 빈 칸에 null 을 준다.
    const tile = this.wallLayer.getTileAt(p.x, p.y)
    return tile === null || tile.index === -1
  }

  update(_time: number, delta: number): void {
    this.hub.beginFrame()
    this.keyboard.update()

    this.mover.update(delta, this.hub.state.dir)

    const px = this.mover.pixel
    this.player.setPosition(px.x * TILE + TILE / 2, px.y * TILE + TILE / 2)
    this.updateAnimation(this.mover.moving, this.mover.facing)

    this.dayNight.update(gameTimeAt(worldNow()).minuteOfDay)
  }

  /**
   * `data.placements` 를 돌며 채집 노드 마커를 놓는다. 같은 종류의 노드가 여러 칸에
   * 있을 수 있으므로 종류가 아니라 배치(인스턴스) 단위로 순회한다.
   *
   * 저장된 좌표는 픽셀이 아니라 타일 좌표라 `x * TILE + TILE / 2` 로 그 타일의
   * 중심 픽셀로 되돌린다. 배치가 없어도 오류가 아니다 — 채집 노드가 없는 맵도 정상이다.
   */
  private spawnNodes(): void {
    const { data } = useGameStore.getState()

    for (const placement of Object.values(data.placements)) {
      const def = data.nodes[placement.nodeId]
      if (!def) {
        console.warn(`배치가 정의되지 않은 노드를 가리킨다: ${placement.instanceId} -> ${placement.nodeId}`)
        continue
      }

      new NodeMarker({
        scene: this,
        x: placement.x * TILE + TILE / 2,
        y: placement.y * TILE + TILE / 2,
        nodeId: placement.instanceId,
        label: def.name,
        tier: def.tier,
        onTap: (id) => void useGameStore.getState().gather(id),
      })
    }
  }

  private createAnimations(): void {
    for (const facing of Object.keys(WALK_ROW) as Direction[]) {
      const start = WALK_ROW[facing] * 3
      this.anims.create({
        key: `walk-${facing}`,
        // 한 걸음 → 대기 → 반대 걸음 → 대기. RPG Maker 계열 4프레임 순환이다.
        frames: [start, start + 1, start + 2, start + 1].map((frame) => ({
          key: 'player',
          frame,
        })),
        frameRate: 8,
        repeat: -1,
      })
    }
  }

  /** 가운데 열이 대기 자세다. */
  private idleFrame(facing: Direction): number {
    return WALK_ROW[facing] * 3 + 1
  }

  private updateAnimation(moving: boolean, facing: Direction): void {
    this.facing = facing
    if (!moving) {
      this.player.anims.stop()
      this.player.setFrame(this.idleFrame(facing))
      return
    }
    this.player.anims.play(`walk-${facing}`, true)
  }
}
