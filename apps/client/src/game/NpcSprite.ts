import Phaser from 'phaser'
import type { Direction, TilePos } from '@nogada/shared'
import { idleFrame } from './charSheet.js'
import { DEPTH } from './depth.js'
import { addText, FONT_SIZE } from './gameText.js'
import { npcSprite, npcSpriteKey } from './npcSprites.js'

/** NodeMarker 의 이름표와 같은 색 — 지도 위 글자가 한 종류로 읽혀야 한다. */
const CAPTION_COLOR = '#e8dcc0'
/** 타일 한 칸. WorldScene 과 같은 값이고 이유도 같다(월드는 32px 격자다). */
const TILE = 32

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
 * 지금 화자의 자리는 `speakers.csv` 에 박혀 있고 방향은 클라이언트가 심심풀이로
 * 바꾼다. 나중에는 일과표가 생겨 **서버가 자리의 주인**이 되고, 갱신이 밀려
 * 들어온다 — 아침엔 밭에, 저녁엔 여관에. 그때 갈아 끼울 것이 이 인터페이스의
 * 구현 하나여야 하고, 그리는 코드는 한 줄도 안 바뀌어야 한다.
 *
 * 그래서 NpcSprite 는 좌표를 **받지 않는다.** 생성자에 x·y 를 넘기게 두면 그
 * 순간 "누가 그것을 다시 계산해 넘기는가"가 씬의 일이 되고, 갱신이 밀려 들어오는
 * 미래에는 씬이 화자마다 위치를 들고 있어야 한다 — 그건 자리의 주인이 둘이라는 뜻이다.
 */
export interface SpeakerPoseSource {
  readonly pose: SpeakerPose
  /** 자세가 바뀔 때마다 부른다. 돌려주는 함수를 부르면 구독이 끊긴다. */
  subscribe(listener: (pose: SpeakerPose) => void): () => void
}

/**
 * 지금 단계의 유일한 구현 — **클라이언트가 직접 밀어 넣는다.**
 *
 * 이 단계의 화자는 칸을 옮기지 않는다(서버의 대화 검사도 클라이언트의 앞칸
 * 판정도 `speakers.csv` 의 좌표를 읽는다). 그래서 여기로 들어오는 것은 방향
 * 뿐이고, 그마저 판정에 쓰이지 않는 연출이다. 그런데도 `tile` 까지 함께
 * 실어 나르는 이유는 위 인터페이스와 같다: 일과표가 오면 바뀔 것이 이 클래스
 * 하나여야 한다.
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

  constructor(options: NpcSpriteOptions) {
    const { scene, speakerId, label, sprite, pose } = options
    this.speakerId = speakerId

    const def = npcSprite(sprite)
    const key = npcSpriteKey(sprite)

    if (def.kind === 'char') {
      // 플레이어와 같은 자세 — 32×32 프레임 하나를 칸 **중심**에 놓는다.
      this.body = scene.add.sprite(0, 0, key, idleFrame(pose.pose.facing))
      this.container = scene.add.container(0, 0, [this.body])
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
    // 구독을 끊는 자리를 두지 않는다: 이 객체도 채널도 씬의 create() 가 만들고
    // 씬이 다시 시작하면 함께 버려지므로(WorldScene 이 맵마다 목록을 비운다)
    // 살아남아 죽은 컨테이너를 건드릴 채널이 없다.
    pose.subscribe((next) => this.apply(next))
  }

  /** 자세 하나를 화면에 옮긴다. 칸 좌표에 타일 크기를 곱해 그 칸의 중심 픽셀을 얻는다. */
  private apply(pose: SpeakerPose): void {
    this.container.setPosition(pose.tile.x * TILE + TILE / 2, pose.tile.y * TILE + TILE / 2)
    this.body?.setFrame(idleFrame(pose.facing))
  }
}
