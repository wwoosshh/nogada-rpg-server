import Phaser from 'phaser'
import worldMap from '@nogada/data/maps/world.json' with { type: 'json' }
import { frontTile, gameTimeAt, isAchieved, type Direction, type TilePos } from '@nogada/shared'
import { InputHub } from '../../input/InputState.js'
import { KeyboardSource } from '../../input/KeyboardSource.js'
import { useGameStore } from '../../store/gameStore.js'
import { worldNow } from '../../time/clock.js'
import { DEPTH } from '../depth.js'
import { DayNightOverlay } from '../DayNightOverlay.js'
import { FloatingTextGroup } from '../FloatingText.js'
import { NodeMarker } from '../NodeMarker.js'
import { TileMover } from '../TileMover.js'
import { ControlScene } from './ControlScene.js'
import { PanelScene } from './PanelScene.js'

const TILE = 32

/**
 * Pipoya 32x32 캐릭터 시트는 3열 x 4행이다.
 * 행 순서는 아래·왼쪽·오른쪽·위이고, 가운데 열이 대기 자세다.
 */
const WALK_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 }

/**
 * 앞칸에 있을 수 있는 것.
 *
 * 원작에서 "앞칸을 향해 결정 버튼"은 세계와 상호작용하는 유일한 동사다.
 * 얼음채집장 이벤트 29개 중 채집 노드는 6개뿐이고 나머지 23개(오크·노인·
 * 퀴즈도우미·소환물)가 전부 같은 입력을 쓴다. 그래서 채집 전용으로 만들지
 * 않는다 — NPC·이벤트·전투 진입점이 나중에 여기 종류를 더한다.
 */
type Interactable = { kind: 'node'; instanceId: string; nodeId: string }

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite
  private dayNight!: DayNightOverlay
  private unsubscribeStore: (() => void) | null = null
  private unsubscribeMilestone: (() => void) | null = null
  private hub!: InputHub
  private keyboard!: KeyboardSource
  private mover!: TileMover
  private panel!: PanelScene
  private wallLayer!: Phaser.Tilemaps.TilemapLayer
  private mapWidth = 0
  private mapHeight = 0
  private readonly blocked = new Set<string>()
  private readonly byTile = new Map<string, Interactable>()
  private readonly floaters = new FloatingTextGroup()
  /** 요청이 날아가 있는 동안 또 보내지 않는다. 응답을 기다리는 사이에 쌓이면 순서가 뒤엉킨다. */
  private gatherPending = false
  /**
   * 아직 화면에 못 띄운 이정표 문구들.
   *
   * 조합은 한 번에 숙련도가 수십씩 올라 이정표 여러 개를 동시에 넘길 수 있다.
   * 스토어는 achieved 각각을 별도 seq 로 순서대로 싣지만, 그 여러 번의 set() 은
   * 같은 틱 안에서 동기로 연달아 일어나 구독 콜백도 연달아 불린다 — 매번 바로
   * showMilestone() 을 부르면 화면 가운데 같은 자리에 글자가 겹쳐 읽을 수 없게
   * 된다. 그래서 일단 큐에 쌓아 두고, 하나가 다 보인 뒤에야 다음 것을 꺼낸다.
   */
  private readonly milestoneQueue: string[] = []
  private milestoneShowing = false

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
      this.byTile.set(`${p.x},${p.y}`, {
        kind: 'node',
        instanceId: p.instanceId,
        nodeId: p.nodeId,
      })
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
      this.floaters.push(
        this,
        this.player.x,
        this.player.y - this.player.displayHeight / 2,
        action,
      )
    })

    this.unsubscribeMilestone = useGameStore.subscribe((state, prev) => {
      const m = state.milestone
      if (!m || m.seq === prev.milestone?.seq) return
      this.enqueueMilestone(m.text)
    })

    this.dayNight = new DayNightOverlay(this)

    // 컨트롤러는 별도 씬이라 카메라 스크롤과 낮밤 명암의 영향을 받지 않는다.
    // hub 가 여기서 막 만들어졌으므로 Control 씬 자신의 create() 가 끝난 뒤에야
    // bind() 로 넘길 수 있다 — CREATE 이벤트를 기다리는 이유다.
    this.scene.launch('Control')
    const control = this.scene.get('Control')
    // 다른 필수값들(tileset·ground·walls, 위 스무 줄 안)과 같은 자세다:
    // 없으면 조용히 넘어가지 않고 바로 던진다. instanceof 가 존재 여부와
    // 타입을 한 번에 좁혀 주므로, 이전의 `as ControlScene` 처럼 검증 없이
    // 믿고 캐스팅하는 지점이 사라진다.
    if (!(control instanceof ControlScene)) {
      throw new Error('Control 씬을 찾을 수 없다: PhaserGame.ts 의 씬 배열을 확인하라')
    }
    control.events.once(Phaser.Scenes.Events.CREATE, () => control.bind(this.hub))

    // 패널도 Control 과 같은 자세로 띄운다 — 별도 씬, launch, CREATE 이벤트를
    // 기다린 뒤 bind(). 이유는 PanelScene 클래스 문서와 ControlScene.bind() 의
    // 주석 참고. control 도 같이 넘기는 이유는 PanelScene.bind() 문서 참고 —
    // 패널이 열리고 닫힐 때 컨트롤러를 숨기고 보이려면 그 씬을 가리켜야 한다.
    this.scene.launch('Panel')
    const panel = this.scene.get('Panel')
    if (!(panel instanceof PanelScene)) {
      throw new Error('Panel 씬을 찾을 수 없다: PhaserGame.ts 의 씬 배열을 확인하라')
    }
    panel.events.once(Phaser.Scenes.Events.CREATE, () => panel.bind(this.hub, control))
    this.panel = panel

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
      this.scene.stop('Control')
      this.scene.stop('Panel')
      this.dayNight.destroy()
      this.keyboard.destroy()
      this.floaters.destroy()
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
      this.unsubscribeMilestone?.()
      this.unsubscribeMilestone = null
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

  private interactableAt(tile: TilePos): Interactable | null {
    return this.byTile.get(`${tile.x},${tile.y}`) ?? null
  }

  /**
   * 채집 요청을 보낸다.
   *
   * 서버의 행동 간격 이전에는 보내지 않는다. 보내 봐야 too_fast 로 거부되고
   * 그 거부는 스토어가 조용히 삼키므로, 플레이어에게는 "가끔 안 캐진다" 로
   * 보인다. 아예 보내지 않으면 그런 상태가 생기지 않는다.
   */
  private sendGather(instanceId: string): void {
    if (this.gatherPending) return
    const { player } = useGameStore.getState()
    if (!player || worldNow() < player.nextActionAt) return

    this.gatherPending = true
    void useGameStore
      .getState()
      .gather(instanceId)
      .finally(() => {
        this.gatherPending = false
      })
  }

  /**
   * 그 대상에서 누르고 있는 것만으로 반복되는가.
   *
   * 숙련도 상수를 직접 비교하지 않는다 — 그 기술의 `repeat` 이정표를 실제로
   * 달성했는지를 `isAchieved` 로 묻는다. 문턱은 이정표 데이터 한 곳에만 있다.
   */
  private repeatsOn(target: Interactable): boolean {
    if (target.kind !== 'node') return false
    const { player, data } = useGameStore.getState()
    const node = data.nodes[target.nodeId]
    if (!player || !node) return false

    const repeatMilestone = data.milestones.find(
      (m) => m.effect.kind === 'repeat' && m.effect.skill === node.skill,
    )
    return repeatMilestone ? isAchieved(repeatMilestone, player, data.milestones) : false
  }

  update(_time: number, delta: number): void {
    this.keyboard.update()

    // 이동·행동보다 먼저 처리한다 — 이번 프레임에 패널이 막 열리거나 닫혔다면
    // 같은 프레임의 이동조차 그 변화를 따라야 한다(설계 문서 §7). 이 씬의
    // update() 안에서 직접 부르는 이유는 PanelScene.applyInput() 의 문서에
    // 적었다: 자신의 update() 에서 읽으면 이미 이번 프레임의 beginFrame() 이
    // 지나간 뒤다.
    this.panel.applyInput()

    this.mover.update(delta, this.hub.state.dir)

    const px = this.mover.pixel
    this.player.setPosition(px.x * TILE + TILE / 2, px.y * TILE + TILE / 2)
    this.updateAnimation(this.mover.moving, this.mover.facing)

    const target = this.interactableAt(frontTile(this.mover.tile, this.mover.facing))
    if (target) {
      if (this.hub.state.actionPressed) {
        this.interact(target)
      } else if (this.hub.state.action && this.repeatsOn(target)) {
        this.interact(target)
      }
    }

    this.dayNight.update(gameTimeAt(worldNow()).minuteOfDay)

    // beginFrame() 은 반드시 update() 의 맨 끝에 있어야 한다 — 위로 옮기고
    // 싶어지면 이 주석부터 다시 읽을 것.
    //
    // 터치 이벤트는 Phaser 의 프레임 루프 밖, DOM 핸들러에서 동기적으로
    // 온다. 그래서 누름과 뗌이 이번 update() 와 다음 update() 사이(예:
    // 이 함수가 끝난 직후)에 둘 다 일어날 수 있다 — 그러면 actionPressed 는
    // 그 사이에 참이 되고, 다음 update() 가 읽으러 올 때까지 그대로 남아
    // 있어야 다음 update() 가 그 탭을 잡을 수 있다. beginFrame() 이 맨
    // 앞에 있으면 다음 update() 가 "자기 자신이 읽기도 전에" 그 신호를
    // 지워버려서, 두 update() 사이에 완전히 끝난 탭(누름+뗌)이 통째로
    // 사라진다 — 60fps 에서 약 16ms, 버벅이는 폰에서는 그보다 더 넓은
    // 창이다. 원래 이 게임 루프의 핵심 동작이 숙련도 10,000 이 되기 전까지
    // 행동 버튼을 계속 두드리는 것이므로, 이 창에 걸리는 탭은 드문 사고가
    // 아니라 "가끔 안 캐진다" 로 매일 체감되는 손실이었다.
    //
    // 맨 끝에 두면 이번 프레임이 신호를 다 읽은 뒤에만 지우므로, 두
    // update() 사이에 낀 탭도 다음 update() 에서 반드시 한 번 잡힌다.
    // 키보드는 다르다 — KeyboardSource.update() 는 이 함수 위쪽, 즉 읽기
    // 전에 동기로 쓰므로 beginFrame() 위치와 무관하게 항상 같은 프레임
    // 안에서 잡힌다.
    this.hub.beginFrame()
  }

  /**
   * 앞칸의 대상에 작용한다.
   *
   * 지금은 노드뿐이지만 switch 로 열어 두는 이유는, 새 종류를 더할 때
   * 입력 계층을 건드리지 않기 위해서다.
   */
  private interact(target: Interactable): void {
    switch (target.kind) {
      case 'node':
        this.sendGather(target.instanceId)
        break
    }
  }

  /** 큐 끝에 문구를 더하고, 지금 아무것도 안 보이는 중이면 바로 꺼내 보여준다. */
  private enqueueMilestone(text: string): void {
    this.milestoneQueue.push(text)
    this.pumpMilestoneQueue()
  }

  /**
   * 큐에서 다음 문구를 꺼내 보여준다. 이미 하나가 보이는 중이면 아무것도 하지
   * 않는다 — showMilestone() 의 트윈이 끝나며 다시 이 함수를 부른다.
   */
  private pumpMilestoneQueue(): void {
    if (this.milestoneShowing) return
    const text = this.milestoneQueue.shift()
    if (text === undefined) return
    this.milestoneShowing = true
    this.showMilestone(text)
  }

  /**
   * 화면 가운데에 크게, 오래 띄운다.
   *
   * 머리 위 플로팅 텍스트와 다르게 만드는 이유는 이것이 채집 결과가 아니라
   * 사건이기 때문이다. 같은 모양으로 띄우면 수천 번 본 글자에 묻힌다.
   */
  private showMilestone(text: string): void {
    const cam = this.cameras.main
    const label = this.add
      .text(cam.width / 2, cam.height / 3, text, {
        fontSize: '18px',
        color: '#ffe9a8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.milestone)

    this.tweens.add({
      targets: label,
      alpha: { from: 0, to: 1 },
      duration: 300,
      hold: 2600,
      yoyo: true,
      onComplete: () => {
        label.destroy()
        this.milestoneShowing = false
        // 큐에 쌓인 다음 것을 이어서 보여준다. 없으면 pumpMilestoneQueue 가 조용히 넘어간다.
        this.pumpMilestoneQueue()
      },
    })
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
        instanceId: placement.instanceId,
        label: def.name,
        tier: def.tier,
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
    if (!moving) {
      this.player.anims.stop()
      this.player.setFrame(this.idleFrame(facing))
      return
    }
    this.player.anims.play(`walk-${facing}`, true)
  }
}
