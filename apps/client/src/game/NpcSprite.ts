import Phaser from 'phaser'
import { DIRECTIONS, NPC_STEP_MS, type Direction, type TilePos } from '@nogada/shared'
import { idleFrame, walkFrames } from './charSheet.js'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'
import { npcSprite, npcSpriteKey } from './npcSprites.js'

/** NodeMarker 의 이름표와 같은 색 — 지도 위 글자가 한 종류로 읽혀야 한다. */
const CAPTION_COLOR = '#e8dcc0'
/** 타일 한 칸. WorldScene 과 같은 값이고 이유도 같다(월드는 32px 격자다). */
const TILE = 32

/**
 * 걷는 속도 — 일과가 쓰는 것과 **같은 상수**에서 나온다.
 *
 * 스케줄러는 400ms 마다 한 칸씩 다음 칸을 알려 준다. 그것을 그대로 화면에 놓으면
 * NPC 가 2.5초에 여섯 칸씩 순간이동한다. 그래서 그림은 알려 준 칸을 향해 이
 * 속도로 걸어가고, 마침 400ms 에 한 칸이라 정확히 따라붙는다 — 여기에 다른
 * 숫자를 적으면 그림이 점점 뒤처지거나 먼저 도착해 멈칫한다.
 */
const WALK_SPEED_PX_PER_MS = TILE / NPC_STEP_MS

/**
 * 여기서 더 멀면 걸어가지 않고 그 자리에 **놓는다**.
 *
 * 실내에서 나오거나 맵을 다시 들어왔을 때 목표가 화면 반대편일 수 있다. 그때
 * 걸어가게 두면 벽을 뚫고 가로지르는 그림이 몇 초씩 이어진다 — 없던 사람이
 * 제자리에 나타나는 편이 맞다. 한 칸을 넘겨 잡는 것은 시계 재동기(slew)가
 * 한 칸쯤 앞당길 수 있어서다.
 */
const SNAP_DISTANCE_PX = TILE * 1.5

/** 다 왔다고 볼 거리. 부동소수점 나머지로 영원히 0.0001px 씩 걷지 않게 한다. */
const ARRIVED_PX = 0.5

/**
 * 걷기 프레임이 넘어가는 속도. 한 칸에 두 프레임이다.
 *
 * 플레이어와 같은 8fps 로 두면 절반 속도로 걷는 NPC 의 발이 헛돈다 —
 * 걸음 속도(NPC_STEP_MS)에서 끌어내야 둘이 갈라지지 않는다.
 */
const WALK_FRAME_RATE = 1000 / (NPC_STEP_MS / 2)

/** 이 시트의 이 방향 걷기 애니메이션 키. 시트마다 따로 만든다. */
function walkKey(sprite: string, facing: Direction): string {
  return `npcwalk:${sprite}:${facing}`
}

/**
 * 화자가 지금 어디에 어느 쪽을 보고 서 있는가.
 *
 * 그리기가 아는 위치 정보의 **전부**다. 여기 더 들어오고 싶어지는 것들(맵 id,
 * 걷는 중인가, 다음 목적지)은 전부 "그리는 데 필요한가"로 걸러진다 — 지금
 * 화면에 그리려면 칸과 방향이면 된다.
 */
export interface SpeakerPose {
  tile: TilePos
  facing: Direction
}

/**
 * 자세를 알려 주는 곳. **이 인터페이스가 이 파일의 존재 이유다.**
 *
 * 한때 화자의 자리는 `speakers.csv` 에 박혀 있었고 방향만 클라이언트가 심심풀이로
 * 바꿨다. 이 인터페이스는 그때 "언젠가 일과표가 생겨 자리가 밀려 들어올 것"을
 * 보고 미리 낸 것이고, 그 언젠가가 왔다 — 이제 `npcScheduler` 가 시각으로
 * 계산한 칸을 이 통로로 민다. 실제로 갈아 끼운 것은 미는 쪽 하나뿐이고 그리는
 * 코드는 한 줄도 안 바뀌었다.
 *
 * 그래서 NpcSprite 는 좌표를 **받지 않는다.** 생성자에 x·y 를 넘기게 두면 그
 * 순간 "누가 그것을 다시 계산해 넘기는가"가 씬의 일이 되고, 씬이 화자마다 위치를
 * 들고 있어야 한다 — 그건 자리의 주인이 둘이라는 뜻이다.
 */
export interface SpeakerPoseSource {
  readonly pose: SpeakerPose
  /** 자세가 바뀔 때마다 부른다. 돌려주는 함수를 부르면 구독이 끊긴다. */
  subscribe(listener: (pose: SpeakerPose) => void): () => void
}

/**
 * 유일한 구현 — **클라이언트가 직접 밀어 넣는다.**
 *
 * 미는 사람은 둘이고 미는 것이 다르다. 일과가 없는 화자에게는 심심풀이 방향
 * 전환과 "말 걸면 돌아보기"만 들어오고 칸은 처음 그대로다. 일과가 있는 화자에게는
 * `npcScheduler` 가 시각으로 계산한 칸과, **걷는 동안의** 방향이 들어온다 —
 * 서 있는 동안의 방향은 여전히 미세 동작의 것이다(설계 §6).
 */
export class SpeakerPoseChannel implements SpeakerPoseSource {
  private current: SpeakerPose
  private readonly listeners = new Set<(pose: SpeakerPose) => void>()

  constructor(initial: SpeakerPose) {
    this.current = initial
  }

  get pose(): SpeakerPose {
    return this.current
  }

  subscribe(listener: (pose: SpeakerPose) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 새 자세를 알린다. 같은 값이면 아무에게도 알리지 않는다 — 매번 알리면 듣는 쪽이 헛일을 한다. */
  set(pose: SpeakerPose): void {
    const same =
      this.current.facing === pose.facing &&
      this.current.tile.x === pose.tile.x &&
      this.current.tile.y === pose.tile.y
    if (same) return
    this.current = pose
    for (const listener of this.listeners) listener(pose)
  }
}

export interface NpcSpriteOptions {
  scene: Phaser.Scene
  /** `speakers.csv` 의 id. 어느 화자의 그림인지 밖에서 알아볼 수 있게 들고 있는다. */
  speakerId: string
  /** 머리 밑에 붙는 이름표. */
  label: string
  /** `speakers.csv` 의 `sprite` 칸. npcSprites.ts 가 파일과 종류로 푼다. */
  sprite: string
  pose: SpeakerPoseSource
}

/**
 * 맵 위 화자 하나. **보여주기만 한다** — 상호작용은 앞칸 판정(WorldScene 의
 * frontTile + byTile)이 전부 대신하므로 여기서 히트 테스트를 켜지 않는다.
 * 켜면 같은 일을 두 경로가 하게 되고 그중 하나(탭)는 "앞칸을 보고 결정 버튼"이라는
 * 이 게임의 유일한 동사를 우회한다. NodeMarker 와 같은 약속이다.
 *
 * 달라진 것은 그림이다. 예전에는 색칠한 사각형이었다 — 저장소가 라이선스
 * 그림을 담지 못해(assets/CREDITS.md) "없을지도 모르는 파일"을 로드하지 않으려던
 * 것이었는데, 그 결정이 세계에서 사람을 지웠다. 이제는 `npcSprites.ts` 가
 * 이름을 파일로 풀고, 그 파일이 없으면 로더가 조용히 넘어가는 대신 눈에 띄게
 * 깨진다 — 그편이 "사람이 있어야 할 자리에 주황 네모가 있다"보다 낫다.
 *
 * 깊이는 `DEPTH.speaker` 다. 플레이어(10)보다 아래이고 overhead(20)보다도
 * 아래라, 지붕 밑으로 들어간 화자는 지붕에 가려진다 — 플레이어와 같은 규칙이다.
 */
export class NpcSprite {
  readonly speakerId: string
  private readonly container: Phaser.GameObjects.Container
  /** 사람일 때만 있다. 사물(간판)은 방향이 없어 프레임을 바꿀 일이 없다. */
  private readonly body: Phaser.GameObjects.Sprite | null
  /** `speakers.csv` 의 `sprite` 이름. 걷기 애니메이션 키를 여기서 짓는다. */
  private readonly sheet: string
  /** 걸어가야 할 칸의 중심 픽셀. 자세가 들어올 때마다 갱신된다. */
  private targetX = 0
  private targetY = 0
  /** 지금 보고 있는 쪽. 프레임을 고르는 데만 쓴다. */
  private facing: Direction
  /** 지금 걷는 애니메이션이 돌고 있는가. 매 프레임 같은 명령을 되풀이하지 않으려고 기억한다. */
  private walking = false

  constructor(options: NpcSpriteOptions) {
    const { scene, speakerId, label, sprite, pose } = options
    this.speakerId = speakerId
    this.sheet = sprite
    this.facing = pose.pose.facing

    const def = npcSprite(sprite)
    const key = npcSpriteKey(sprite)

    if (def.kind === 'char') {
      // 플레이어와 같은 자세 — 32×32 프레임 하나를 칸 **중심**에 놓는다.
      this.body = scene.add.sprite(0, 0, key, idleFrame(pose.pose.facing))
      this.container = scene.add.container(0, 0, [this.body])
      // 애니메이션은 씬이 아니라 게임 전체가 갖는다. 맵을 넘을 때마다 이
      // 생성자가 다시 도는데, 이미 있는 키를 다시 만들면 Phaser 가 조용히
      // 무시하면서 콘솔에 경고만 남긴다(WorldScene.createAnimations 와 같은 이유).
      for (const facing of DIRECTIONS) {
        const animKey = walkKey(sprite, facing)
        if (scene.anims.exists(animKey)) continue
        scene.anims.create({
          key: animKey,
          frames: walkFrames(facing).map((frame) => ({ key, frame })),
          frameRate: WALK_FRAME_RATE,
          repeat: -1,
        })
      }
    } else {
      // 사물은 시트가 아니라 한 장짜리 그림이고, 32×64 처럼 한 칸보다 클 수 있다
      // (안내판이 그렇다: 기둥이 선 칸은 하나인데 판은 그 위 칸까지 올라간다).
      // 그래서 중심이 아니라 **밑변을 칸 아래에 맞춘다** — 맵이 그 이정표를
      // 그리는 방식과 같아야 한 화면에서 둘이 같은 물건으로 읽힌다.
      this.body = null
      const image = scene.add.image(0, TILE / 2, key).setOrigin(0.5, 1)
      this.container = scene.add.container(0, 0, [image])
    }

    // 이름표는 칸 바로 아래. 노드 마커와 같은 크기·색이라 지도의 글자가 한
    // 종류로 읽힌다(FONT_SIZE.caption 이 격자를 벗어난 이유는 그 문서 참고).
    this.container.add(
      addText(scene, 0, TILE / 2 + 2, label, {
        fontSize: `${FONT_SIZE.caption}px`,
        color: CAPTION_COLOR,
      }).setOrigin(0.5, 0),
    )

    this.container.setDepth(DEPTH.speaker)
    this.apply(pose.pose)
    this.place()
    // 구독을 끊는 자리를 두지 않는다: 이 객체도 채널도 씬의 create() 가 만들고
    // 씬이 다시 시작하면 함께 버려지므로(WorldScene 이 맵마다 목록을 비운다)
    // 살아남아 죽은 컨테이너를 건드릴 채널이 없다.
    pose.subscribe((next) => this.apply(next))
  }

  /**
   * 이 맵에 보이는가.
   *
   * 실내로 들어갔거나 다른 맵에 있는 사람은 여기서 꺼진다. 스프라이트를 없앴다
   * 다시 만들지 않는 이유는 그 편이 상태가 하나 적기 때문이다 — 만들고 부수면
   * 자세 통로 구독을 누가 끊는가가 새 문제로 생기고, 하루에 몇 번뿐인 일에
   * 그 위험을 지불할 이유가 없다.
   *
   * 다시 보일 때는 **걸어오지 않고 그 자리에 놓는다**. 문에서 나오는 사람이
   * 화면을 가로질러 걸어오는 그림이 되면 안 된다.
   */
  setVisible(visible: boolean): void {
    if (visible && !this.container.visible) this.place()
    this.container.setVisible(visible)
  }

  /**
   * 알려 준 칸을 향해 한 프레임만큼 걷는다. 씬의 update() 가 매 프레임 부른다.
   *
   * 스케줄러는 400ms 마다 한 칸씩만 말해 준다 — 그것을 그대로 놓으면 사람이
   * 칸에서 칸으로 튄다. 여기서 그 사이를 이어 주는 대신, **자리의 주인은 여전히
   * 스케줄러다**: 이 함수는 목표를 넘어가지 않고, 너무 멀면 걸어가는 대신 놓는다.
   */
  update(deltaMs: number): void {
    if (!this.container.visible) return

    const dx = this.targetX - this.container.x
    const dy = this.targetY - this.container.y
    const distance = Math.hypot(dx, dy)

    if (distance <= ARRIVED_PX || distance > SNAP_DISTANCE_PX) {
      this.place()
      return
    }

    const step = WALK_SPEED_PX_PER_MS * deltaMs
    if (step >= distance) {
      this.place()
      return
    }

    this.container.setPosition(
      this.container.x + (dx / distance) * step,
      this.container.y + (dy / distance) * step,
    )
    this.setWalking(true)
  }

  /** 자세 하나를 받아 둔다. 칸 좌표에 타일 크기를 곱해 그 칸의 중심 픽셀을 얻는다. */
  private apply(pose: SpeakerPose): void {
    this.targetX = pose.tile.x * TILE + TILE / 2
    this.targetY = pose.tile.y * TILE + TILE / 2
    this.facing = pose.facing
    // 걷는 중이면 방향이 바뀌어도 대기 프레임으로 되돌리지 않는다 — 돌아서는
    // 순간마다 한 프레임씩 멈춰 선 것처럼 보인다.
    if (this.walking) this.body?.anims.play(walkKey(this.sheet, this.facing), true)
    else this.body?.setFrame(idleFrame(this.facing))
  }

  /** 목표 칸에 딱 세운다. 걷기를 멈추고 그 방향의 대기 프레임으로 돌아간다. */
  private place(): void {
    this.container.setPosition(this.targetX, this.targetY)
    this.setWalking(false)
  }

  private setWalking(walking: boolean): void {
    if (this.walking === walking) return
    this.walking = walking
    if (walking) this.body?.anims.play(walkKey(this.sheet, this.facing), true)
    else {
      this.body?.anims.stop()
      this.body?.setFrame(idleFrame(this.facing))
    }
  }
}
