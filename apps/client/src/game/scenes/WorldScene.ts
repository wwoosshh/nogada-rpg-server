import Phaser from 'phaser'
import { gameTimeAt } from '@nogada/shared'
import { useGameStore } from '../../store/gameStore.js'
import { worldNow } from '../../time/clock.js'
import { DEPTH } from '../depth.js'
import { DayNightOverlay } from '../DayNightOverlay.js'
import { spawnFloatingText } from '../FloatingText.js'
import { NodeMarker } from '../NodeMarker.js'

const TILE = 32
const PLAYER_SPEED = 120

type Facing = 'down' | 'left' | 'right' | 'up'

/**
 * Pipoya 32x32 캐릭터 시트는 3열 x 4행이다.
 * 행 순서는 아래·왼쪽·오른쪽·위이고, 가운데 열이 대기 자세다.
 */
const WALK_ROW: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 }

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private facing: Facing = 'down'
  /** 터치 조작용 목표 지점. null 이면 키보드 입력만 처리한다. */
  private moveTarget: Phaser.Math.Vector2 | null = null
  private markers: NodeMarker[] = []
  private dayNight!: DayNightOverlay
  private unsubscribeStore: (() => void) | null = null

  constructor() {
    super({ key: 'World' })
  }

  preload(): void {
    this.load.tilemapTiledJSON('world', 'maps/world.json')
    this.load.image('pipoya-basechip', 'tilesets/pipoya-basechip.png')
    // Pipoya 캐릭터 시트는 96x128 = 3열 x 4행, 프레임 32x32
    this.load.spritesheet('player', 'sprites/player.png', {
      frameWidth: TILE,
      frameHeight: TILE,
    })
  }

  create(): void {
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
    // 메서드 이름은 setCollisionByExclusion 이다 (Excluding 아님).
    // -1 은 빈 칸이므로, walls 의 비어있지 않은 모든 타일이 충돌한다.
    walls.setCollisionByExclusion([-1])

    // 플레이어보다 나중이 아니라 깊이로 위에 올린다. 생성 순서와 무관하게 동작한다.
    if (tileLayerNames.includes('overhead')) {
      map.createLayer('overhead', tileset, 0, 0)?.setDepth(DEPTH.overhead)
    }

    const spawn = map.findObject('spawn', (o) => o.name === 'player')
    const startX = spawn?.x ?? TILE * 2
    const startY = spawn?.y ?? TILE * 2

    this.createAnimations()
    this.player = this.physics.add.sprite(startX, startY, 'player', this.idleFrame('down'))
    this.player.setDepth(DEPTH.player)
    this.player.setSize(20, 16).setOffset(6, 14)
    this.physics.add.collider(this.player, walls)

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
    this.cameras.main.startFollow(this.player, true)
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels)

    this.cursors = this.input.keyboard!.createCursorKeys()

    // 터치·클릭 이동: 누른 지점을 목표로 삼는다.
    // 두 번째 인자는 그 지점에서 적중한 인터랙티브 오브젝트 목록이다. 노드 마커를
    // 눌렀다면 비어 있지 않으므로 이동을 건너뛴다 — 채집하려고 누른 것이지
    // 그 자리로 걸어가려던 것이 아니다.
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, hitObjects: unknown[]) => {
      if (hitObjects.length > 0) return
      this.moveTarget = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY)
    })

    this.spawnNodes(map)

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
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
    }
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup)
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup)
  }

  update(): void {
    this.applyMovement()
    const body = this.player.body as Phaser.Physics.Arcade.Body
    this.updateAnimation(body.velocity.x, body.velocity.y)
    this.dayNight.update(gameTimeAt(worldNow()).minuteOfDay)
  }

  /**
   * Tiled 의 `nodes` 오브젝트 레이어를 읽어 채집 노드를 배치한다.
   * 레이어가 없어도 오류가 아니다 — 채집 노드가 없는 맵도 정상이다.
   */
  private spawnNodes(map: Phaser.Tilemaps.Tilemap): void {
    const { data } = useGameStore.getState()
    const objects = map.getObjectLayer('nodes')?.objects ?? []

    for (const obj of objects) {
      const nodeId = obj.properties?.find(
        (p: { name: string; value: unknown }) => p.name === 'nodeId',
      )?.value as string | undefined
      if (!nodeId) continue

      const def = data.nodes[nodeId]
      if (!def) {
        console.warn(`맵에 정의되지 않은 노드가 있다: ${nodeId}`)
        continue
      }

      this.markers.push(
        new NodeMarker({
          scene: this,
          x: obj.x ?? 0,
          y: obj.y ?? 0,
          nodeId,
          label: def.name,
          tier: def.tier,
          onTap: (id) => void useGameStore.getState().gather(id),
        }),
      )
    }
  }

  /** 입력을 읽어 속도만 정한다. 애니메이션은 결과 속도를 보고 별도로 정한다. */
  private applyMovement(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body
    const kx = (this.cursors.right.isDown ? 1 : 0) - (this.cursors.left.isDown ? 1 : 0)
    const ky = (this.cursors.down.isDown ? 1 : 0) - (this.cursors.up.isDown ? 1 : 0)

    if (kx !== 0 || ky !== 0) {
      this.moveTarget = null
      body.setVelocity(kx * PLAYER_SPEED, ky * PLAYER_SPEED)
      body.velocity.normalize().scale(PLAYER_SPEED)
      return
    }

    if (this.moveTarget) {
      const dist = Phaser.Math.Distance.BetweenPoints(this.player, this.moveTarget)
      if (dist < 4) {
        this.moveTarget = null
        body.setVelocity(0, 0)
      } else {
        this.physics.moveTo(this.player, this.moveTarget.x, this.moveTarget.y, PLAYER_SPEED)
      }
      return
    }

    body.setVelocity(0, 0)
  }

  private createAnimations(): void {
    for (const facing of Object.keys(WALK_ROW) as Facing[]) {
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
  private idleFrame(facing: Facing): number {
    return WALK_ROW[facing] * 3 + 1
  }

  private updateAnimation(vx: number, vy: number): void {
    if (vx === 0 && vy === 0) {
      this.player.anims.stop()
      this.player.setFrame(this.idleFrame(this.facing))
      return
    }

    // 대각선 이동에서 방향이 매 프레임 튀지 않도록 큰 축을 따른다.
    this.facing =
      Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : vy > 0 ? 'down' : 'up'

    // 두 번째 인자가 true 라 이미 같은 애니메이션이 돌고 있으면 다시 시작하지 않는다.
    this.player.anims.play(`walk-${this.facing}`, true)
  }
}
