import Phaser from 'phaser'

const TILE = 32
const PLAYER_SPEED = 120

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
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
    const walls = map.createLayer('walls', tileset, 0, 0)
    if (!walls) throw new Error('walls 레이어를 찾을 수 없다')
    walls.setCollisionByExclusion([-1])

    const spawn = map.findObject('spawn', (o) => o.name === 'player')
    const startX = spawn?.x ?? TILE * 2
    const startY = spawn?.y ?? TILE * 2

    this.player = this.physics.add.sprite(startX, startY, 'player', 0)
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
}
