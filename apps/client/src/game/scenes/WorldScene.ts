import Phaser from 'phaser'
import { DEPTH } from '../depth.js'

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
    map.createLayer('decor', tileset, 0, 0)?.setDepth(DEPTH.decor)

    const walls = map.createLayer('walls', tileset, 0, 0)
    if (!walls) throw new Error('walls 레이어를 찾을 수 없다')
    walls.setDepth(DEPTH.walls)
    // 메서드 이름은 setCollisionByExclusion 이다 (Excluding 아님).
    // -1 은 빈 칸이므로, walls 의 비어있지 않은 모든 타일이 충돌한다.
    walls.setCollisionByExclusion([-1])

    // 플레이어보다 나중이 아니라 깊이로 위에 올린다. 생성 순서와 무관하게 동작한다.
    map.createLayer('overhead', tileset, 0, 0)?.setDepth(DEPTH.overhead)

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
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.moveTarget = new Phaser.Math.Vector2(pointer.worldX, pointer.worldY)
    })
  }

  update(): void {
    this.applyMovement()
    const body = this.player.body as Phaser.Physics.Arcade.Body
    this.updateAnimation(body.velocity.x, body.velocity.y)
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
