import Phaser from 'phaser'
import { GROUND_LAYER, TILESET_NAMES, WALLS_LAYER } from '@nogada/data'
import {
  DIRECTIONS,
  frontTile,
  gameTimeAt,
  isAchieved,
  isAdjacentFacing,
  weatherView,
  type Direction,
  type PlayerState,
  type TilePos,
} from '@nogada/shared'
import { InputHub } from '../../input/InputState.js'
import { KeyboardSource } from '../../input/KeyboardSource.js'
import { useGameStore } from '../../store/gameStore.js'
import { worldNow } from '../../time/clock.js'
import { arrivalFacing } from '../arrivalFacing.js'
import { idleFrame, walkFrames } from '../charSheet.js'
import { DEPTH } from '../depth.js'
import { DayNightOverlay } from '../DayNightOverlay.js'
import { FloatingTextGroup } from '../FloatingText.js'
import { addText, FONT_SIZE } from '../gameText.js'
import { NodeMarker } from '../NodeMarker.js'
import { NpcSprite, SpeakerPoseChannel } from '../NpcSprite.js'
import { NpcScheduler, schedulesForMap, speakersForMap, type NpcCommand } from '../npcScheduler.js'
import { npcSprite, npcSpriteKey } from '../npcSprites.js'
import { playerSprite, playerSpriteKey } from '../playerSprites.js'
import { facingToward } from '../speakerFacing.js'
import { TileMover } from '../TileMover.js'
import { WeatherSky } from '../WeatherSky.js'
import { fixedToCamera, renderScale } from '../viewport.js'
import { ControlScene } from './ControlScene.js'
import { DialogueScene } from './DialogueScene.js'
import { PanelScene } from './PanelScene.js'

const TILE = 32

/**
 * 심심풀이로 방향을 바꾸는 간격. 사람이 가만히 서 있기만 하면 마을이 정지
 * 화면처럼 보이고, 너무 자주 돌면 안절부절 못하는 것처럼 보인다.
 *
 * 화자마다 이 범위에서 **따로** 뽑으므로 처음부터 어긋나 있다 — 같은 값으로
 * 시작해 같은 주기로 돌면 마을 사람 전부가 한 박자에 고개를 돌린다.
 */
const IDLE_TURN_MIN_MS = 3000
const IDLE_TURN_MAX_MS = 8000

/** 심심풀이로 방향을 바꾸는 화자 하나. 사물(간판)은 여기 들어오지 않는다. */
interface IdleSpeaker {
  pose: SpeakerPoseChannel
  /** 다음에 방향을 바꿀 때까지 남은 시간. 세계가 잠긴 동안에는 줄지 않는다. */
  remainingMs: number
  /**
   * 지금 서 있는가. 걷는 중이거나 실내에 있는 사람의 방향은 스케줄러의 것이라
   * 여기서 건드리면 걷다 말고 뒤를 돌아본다(설계 §6 의 facing 소유권).
   * 일과가 없는 화자는 언제나 참이다.
   */
  standing: boolean
}

/**
 * 앞칸에 있을 수 있는 것.
 *
 * 원작에서 "앞칸을 향해 결정 버튼"은 플레이어가 세계에 말을 거는 주된 통로다.
 * 얼음채집장 이벤트 29개 중 채집 노드는 6개뿐이고 나머지(노인·퀴즈도우미·
 * 소환물)의 상당수가 같은 결정 버튼 트리거를 쓴다. 그래서 채집 전용으로 만들지
 * 않았고, 이제 두 번째 종류가 들어왔다 — 화자다. 전투 진입점 같은 것이 나중에
 * 여기 더 붙는다.
 */
type Interactable =
  | { kind: 'node'; instanceId: string; nodeId: string }
  | { kind: 'speaker'; speakerId: string }

/**
 * 씬을 다시 시작할 때 이전 맵에서 넘겨주는 것.
 *
 * 전환의 `facing` 이 비어 있으면 "들어온 방향을 그대로 유지한다"(설계 문서 3.5)
 * 인데, 씬을 통째로 다시 시작하면 그 방향을 알던 TileMover 가 함께 사라진다.
 * Phaser 의 `scene.restart(data)` 가 `init(data)` 로 넘겨 주는 이 한 칸이 그
 * 방향이 살아 건너오는 유일한 길이다.
 */
interface WorldSceneData {
  enteredFacing?: Direction
}

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite
  private dayNight!: DayNightOverlay
  private weatherSky!: WeatherSky
  private unsubscribeStore: (() => void) | null = null
  private unsubscribeMilestone: (() => void) | null = null
  private unsubscribeUtterance: (() => void) | null = null
  private hub!: InputHub
  private keyboard!: KeyboardSource
  private mover!: TileMover
  private panel!: PanelScene
  private dialogue!: DialogueScene
  private wallLayer!: Phaser.Tilemaps.TilemapLayer
  /**
   * 지금 그리고 있는 맵. `create()` 가 정하고 그 뒤로는 바뀌지 않는다 — 맵이
   * 바뀐다는 것은 곧 씬을 다시 시작한다는 뜻이다.
   *
   * 스토어의 `player.location.mapId` 를 그때그때 읽지 않고 여기 붙잡아 두는
   * 이유가 있다: 전환 응답이 도착하면 스토어의 맵 id 는 먼저 바뀌고 화면은
   * 아직 이전 맵이다. 그 사이에 스토어를 읽으면 이전 맵 위에서 새 맵의 벽과
   * 전환을 판정하게 된다.
   */
  private mapId = ''
  /**
   * 이 캐릭터의 외형이 올라간 로더 키. `preload()` 가 정하고 `create()` 와
   * 걷기 애니메이션이 그대로 쓴다.
   *
   * 붙잡아 두는 이유는 mapId 와 같다: 이 셋이 각자 스토어를 다시 읽으면 한
   * 씬 안에서 서로 다른 시트를 가리킬 여지가 생기고, 그러면 서 있는 모습과
   * 걷는 모습이 다른 사람이 된다(설계 규범 13).
   */
  private appearanceKey = ''
  /**
   * 이 맵으로 걸어 들어온 방향. 전환의 `facing` 이 비어 있을 때 쓴다.
   * 첫 부팅(새로고침)에는 물려받을 방향이 없으므로 기본 자세인 아래다.
   */
  private enteredFacing: Direction = 'down'
  private mapWidth = 0
  private mapHeight = 0
  private readonly blocked = new Set<string>()
  private readonly byTile = new Map<string, Interactable>()
  /**
   * 이 맵의 화자마다 자세를 밀어 넣는 통로. 지금은 방향만 지나다니지만, 일과표가
   * 생기면 서버가 보내는 자리 갱신이 같은 길로 들어온다(NpcSprite 의 문서).
   */
  private readonly speakerPoses = new Map<string, SpeakerPoseChannel>()
  /**
   * 이 맵의 화자 그림. 자리는 자세 통로가 옮기지만 **보이고 안 보이고**와 매
   * 프레임의 걸음 보간은 그림 자신이 하므로, 그것을 부르려면 손에 쥐고 있어야 한다.
   */
  private readonly npcSprites = new Map<string, NpcSprite>()
  /** 그중 사람들. 사물은 방향이 없어 심심풀이도 없다. */
  private readonly idleSpeakers: IdleSpeaker[] = []
  /**
   * 일과가 있는 화자를 시각에 맞춰 이 맵 위에 놓는 것. 일과가 이 맵에 데려올 수
   * 있는 사람이 하나도 없으면 null 이다 — 대부분의 맵이 그렇다.
   */
  private scheduler: NpcScheduler | null = null
  private readonly floaters = new FloatingTextGroup()
  /** 요청이 날아가 있는 동안 또 보내지 않는다. 응답을 기다리는 사이에 쌓이면 순서가 뒤엉킨다. */
  private gatherPending = false
  /**
   * 대화 요청이 날아가 있는 동안 또 보내지 않는다 — gatherPending 과 같은
   * 이유이고, 여기서는 하나 더 있다: 응답이 도착해야 대사창이 열리고 그때
   * 입력이 잠기므로, 그 사이에 A 를 또 누르면 발화 두 개가 연달아 도착해
   * 첫 번째가 두 번째에 덮인다(둘 다 서버에는 "말을 걸었다"로 남는다).
   */
  private talkPending = false
  /**
   * 전환 요청이 날아가 있는 동안 또 보내지 않는다 — gatherPending 과 같은
   * 이유다. 세계 입력 잠금만으로는 부족하다: 잠금은 다음 프레임의 걸음을
   * 막을 뿐, 이미 진행 중이던 한 걸음이 끝나면서 같은 칸을 다시 알리는 것은
   * 막지 못한다.
   */
  private movePending = false
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

  /**
   * 씬이 다시 시작될 때마다 preload 보다 먼저 불린다.
   *
   * 이전 맵에서 걸어 나온 방향은 여기서만 건너온다 — create() 시점에는 이전
   * TileMover 가 이미 사라진 뒤다. 첫 부팅에는 `data` 가 비어 있고, 그때
   * 물려받을 방향이 없는 것이 맞다.
   */
  init(data: WorldSceneData): void {
    this.enteredFacing = data.enteredFacing ?? 'down'
  }

  /**
   * 서버가 아는 플레이어. 게임은 `connection === 'online'` 이 된 뒤에만
   * 만들어지므로(App.tsx) 여기 도달했다면 반드시 있다.
   *
   * 없을 때 조용히 시작 맵으로 넘어가지 않는 이유는 이 파일의 다른 필수값들
   * (타일셋·ground·walls·Control 씬)과 같다: 조용한 대체값은 "게이트가 깨졌다"를
   * "왜 여기서 시작하지"로 바꿔 놓는다.
   */
  private requirePlayer(): PlayerState {
    const { player } = useGameStore.getState()
    if (!player) {
      throw new Error('플레이어 상태 없이 세계를 열 수 없다: App.tsx 의 연결 게이트를 확인하라')
    }
    return player
  }

  preload(): void {
    // 맵이 어느 시트를 쓰는지는 아직 모른다 — 맵 JSON 은 바로 아래에서 이제야
    // 큐에 들어가고, 그것을 읽는 것은 create() 다. 그래서 여섯 장을 다 올린다.
    // 로더가 이미 캐시에 있는 키는 건너뛰므로 맵을 넘을 때 다시 받지 않고,
    // 여섯 장 합쳐 약 610KB 다.
    for (const name of TILESET_NAMES) {
      this.load.image(name, `tilesets/${name}.png`)
    }
    // **외형은 preload 전에 정해져야 한다**(설계 규범 13). 맵을 넘을 때마다
    // 이 씬은 통째로 다시 시작하므로, 그때마다 스토어에서 다시 읽어 큐에 올린다.
    // 이미 캐시에 있는 키는 로더가 건너뛰므로 두 번 내려받지 않는다.
    //
    // 옛 세이브에는 이 필드가 없지만 여기까지 빈 값이 오지는 않는다 — 스키마가
    // 읽는 순간 DEFAULT_APPEARANCE 로 채운다(shared 의 PlayerStateSchema).
    const appearance = this.requirePlayer().appearance
    this.appearanceKey = playerSpriteKey(appearance)
    // Pipoya 캐릭터 시트는 96x128 = 3열 x 4행, 프레임 32x32
    this.load.spritesheet(this.appearanceKey, `sprites/${playerSprite(appearance).file}`, {
      frameWidth: TILE,
      frameHeight: TILE,
    })

    // 맵은 실행 중에 받는다. 정적 import 는 맵 수만큼 번들에 들어가서, 맵이
    // 수십 장이 되면 한 장만 쓰는 첫 화면이 그 전부를 내려받고 기다린다.
    // 어느 맵인지는 서버가 갖고 있는 위치가 정한다.
    //
    // 맵 id 가 한글이라 URL 로 쓰기 전에 인코딩한다 — 브라우저가 알아서 해
    // 주기도 하지만, 그 자동 변환에 기대면 개발 서버의 미들웨어가 무엇을 받게
    // 되는지가 브라우저마다 달라진다.
    //
    // 이미 캐시에 있는 키는 로더가 스스로 건너뛰므로, 왔던 맵으로 되돌아올 때
    // 다시 내려받지 않는다.
    //
    // 그 맵이 실재하는지는 여기서 묻지 않는다 — 서버가 세이브를 읽는 자리에서
    // 이미 보정했다(store.ts 의 resolvePlayerLocation). 여기서 또 물으면 같은
    // 규칙이 두 곳에 생기고, 클라이언트가 서버와 다른 답을 낼 여지가 열린다.
    const mapId = this.requirePlayer().location.mapId
    this.load.tilemapTiledJSON(`map:${mapId}`, `maps/${encodeURIComponent(mapId)}.json`)

    // 화자 그림은 타일셋과 달리 **이 맵에 필요한 것만** 올린다. 타일셋은 여섯
    // 장에 610KB 라 다 올려도 되지만, 화자 시트는 마을마다 다른 사람들이라
    // 세계가 자라는 만큼 늘어난다 — 눈의 마을에 들어서면서 항구의 약초밭지기를
    // 내려받을 이유가 없다.
    //
    // "이 맵에 필요한"의 뜻이 `speaker.mapId` 가 아닌 것이 중요하다(설계 §6).
    // 일과가 있는 사람에게 그 칸은 더 이상 자리가 아니고, 하루 중 어디 있는지는
    // 시각이 정한다 — **하루 중 한 번이라도 여기 올 수 있으면** 미리 싣는다.
    // 지금 여기 있는 사람만 실으면, 광장에서 걸어 들어오는 사람이 문턱을 넘는
    // 순간 그림이 없다. 그 판단은 speakersForMap 하나에 있고 spawnSpeakers 도
    // 같은 것을 본다 — 둘이 갈라지면 시트는 있는데 사람이 없거나 그 반대가 된다.
    //
    // 이미 캐시에 있는 키는 로더가 스스로 건너뛰므로, 왔던 맵으로 되돌아올 때
    // 다시 내려받지 않는다 — 맵 JSON 과 같다.
    const loaded = new Set<string>()
    for (const speaker of speakersForMap(useGameStore.getState().data, mapId)) {
      if (loaded.has(speaker.sprite)) continue
      loaded.add(speaker.sprite)

      // 모르는 이름이면 여기서 던진다(npcSprites.ts) — 맵이 안 뜨는 편이
      // 그 화자만 조용히 사라지는 것보다 낫다.
      const def = npcSprite(speaker.sprite)
      const key = npcSpriteKey(speaker.sprite)
      if (def.kind === 'char') {
        this.load.spritesheet(key, `sprites/${def.file}`, {
          frameWidth: TILE,
          frameHeight: TILE,
        })
      } else {
        this.load.image(key, `sprites/${def.file}`)
      }
    }
  }

  create(): void {
    // 씬을 다시 시작해도 인스턴스는 같은 것이 쓰인다. 선언과 함께 초기화한
    // 필드는 그래서 이전 맵의 값을 그대로 들고 오므로, 새로 부팅한 것과 같은
    // 자리에서 시작하도록 여기서 전부 비운다 — 하나라도 빠뜨리면 그 하나만
    // 이전 맵의 기억을 갖는다.
    //
    // 벽과 상호작용 대상: 비우지 않으면 이전 맵의 노드·화자 칸이 새 맵에
    // 보이지 않는 벽으로 남고, 그 앞에서 A 를 누르면 다른 맵의 노드를 캐려
    // 든다(서버가 wrong_map 으로 거절하지만, 화면에는 아무 일도 안 일어난다).
    this.blocked.clear()
    this.byTile.clear()
    // 화자 통로도 같은 이유로 비운다. 남겨 두면 이전 맵의 채널이 살아 있고,
    // 그 채널에 자세를 밀어 넣으면 이미 사라진 컨테이너를 건드린다 — 그리고
    // 이 맵에 같은 id 의 화자가 없으면 말을 걸어도 아무도 안 돈다.
    this.speakerPoses.clear()
    this.npcSprites.clear()
    this.idleSpeakers.length = 0
    // 스케줄러도 새로 만든다. 남겨 두면 이전 맵 기준으로 계산한 "지난 처지"를
    // 들고 있어서, 그 맵에서 서 있던 사람이 이 맵에서는 영영 나타나지 않는다
    // (그쪽 기억으로는 이미 나타나 있다). 새로 만들면 첫 틱이 지금 시각의
    // 자리를 통째로 다시 낸다 — 그것이 곧 "새로고침해도 제자리"다(설계 §9.1).
    this.scheduler = null
    // 이정표 큐: 트윈은 씬이 멈출 때 함께 사라져 onComplete 가 영영 오지
    // 않는다. milestoneShowing 을 되돌리지 않으면 새 맵에서 이정표 문구가
    // 큐에만 쌓이고 화면에는 하나도 안 뜬다.
    this.milestoneQueue.length = 0
    this.milestoneShowing = false
    // 날아가 있던 요청의 응답은 이 씬이 이미 사라진 뒤에 온다. 참으로 남으면
    // 새 맵에서 첫 채집·대화·전환이 통째로 무시된다.
    this.gatherPending = false
    this.talkPending = false
    this.movePending = false

    const location = this.requirePlayer().location
    this.mapId = location.mapId
    const map = this.make.tilemap({ key: `map:${this.mapId}` })
    // 맵이 적어 온 타일셋을 그대로 붙인다 — 우리가 아는 목록을 도는 것이
    // 아니라 맵을 따라간다. 맵이 세 장만 쓰면 세 장만 붙고, 그 순서와
    // firstgid 는 맵이 정한 것 그대로다.
    //
    // 첫 인자는 Tiled 안의 타일셋 이름, 둘째는 preload 에서 쓴 키다. 둘이
    // 같은 글자인 것이 TILESET_NAMES 를 양쪽이 함께 보는 이유다. 빌드가
    // 맵마다 이 이름들이 우리가 아는 것인지 이미 봤다(packages/data 의 parseTmx).
    //
    // **모든 레이어에 이 배열을 통째로 넘긴다.** Phaser 는 레이어마다 시트별
    // gid 구간표를 만들어 타일 하나하나가 자기 시트를 찾게 한다
    // (`TilemapLayer.setTilesets`). 레이어에 한 장만 넘기면 그 레이어에서
    // 다른 시트의 타일은 조용히 안 그려진다 — 지붕을 얹으려는 지금 그건
    // 곧 "지붕만 안 보인다" 이다.
    const tilesets = map.tilesets.map((ts) => {
      const added = map.addTilesetImage(ts.name, ts.name)
      if (!added) {
        throw new Error(
          `타일셋 "${ts.name}" 의 그림을 못 찾았다 — packages/data 의 TILESET_NAMES 와 ` +
            `apps/client/public/tilesets/ 를 확인하라(복원 방법은 assets/CREDITS.md)`,
        )
      }
      return added
    })

    const ground = map.createLayer(GROUND_LAYER, tilesets, 0, 0)
    if (!ground) throw new Error(`${GROUND_LAYER} 레이어를 찾을 수 없다`)
    ground.setDepth(DEPTH.ground)

    // decor 와 overhead 는 선택 레이어다. 장식이 없는 맵도 정상이므로 없어도 오류가 아니다.
    // 존재하지 않는 레이어 이름으로 createLayer 를 호출하면 Phaser 가 콘솔에
    // "Invalid Tilemap Layer ID" 경고를 남긴다 — 옵셔널 체이닝으로 실패를 허용하는 대신,
    // 이름 목록으로 먼저 존재를 확인해 애초에 실패할 호출을 하지 않는다.
    const tileLayerNames = map.getTileLayerNames()

    if (tileLayerNames.includes('decor')) {
      map.createLayer('decor', tilesets, 0, 0)?.setDepth(DEPTH.decor)
    }

    const walls = map.createLayer(WALLS_LAYER, tilesets, 0, 0)
    if (!walls) throw new Error(`${WALLS_LAYER} 레이어를 찾을 수 없다`)
    walls.setDepth(DEPTH.walls)

    // 플레이어보다 나중이 아니라 깊이로 위에 올린다. 생성 순서와 무관하게 동작한다.
    if (tileLayerNames.includes('overhead')) {
      map.createLayer('overhead', tilesets, 0, 0)?.setDepth(DEPTH.overhead)
    }

    // 설 자리는 언제나 서버가 아는 칸이다. 맵 파일의 `spawn` 오브젝트를 여기서
    // 보지 않는다 — 이 씬의 mapId 자체가 그 location 에서 나오므로 "다른 맵을
    // 가리킬 때" 라는 분기는 참이 될 수 없었고, 그 조용한 대체값은 서버가 이미
    // 보정하는 일(store.ts 의 resolvePlayerLocation)을 흉내 내면서 답만 달랐다.
    // spawn 오브젝트는 이제 빌드가 읽어 MapDef.spawn 으로 싣고, 새 플레이어의
    // 시작 칸과 세이브 복구 지점이 거기서 나온다.
    const startTile: TilePos = { x: location.x, y: location.y }

    // 어느 쪽을 보고 서는가. 전환표의 facing 이 정하고, 비어 있으면 걸어 들어온
    // 방향을 그대로 유지한다(설계 문서 3.5). 이것이 없던 동안에는 북쪽으로 걸어
    // 나가 도착해도 남쪽을 — 방금 나온 전환을 정면으로 — 보고 서 있었다.
    const startFacing = arrivalFacing(
      useGameStore.getState().data.transitions,
      this.mapId,
      startTile,
      this.enteredFacing,
    )

    this.createAnimations()
    // 칸의 **중심**에 놓는다. update() 가 매 프레임 같은 식으로 다시 놓으므로
    // 왼쪽 위 모서리에 놓으면 첫 프레임만 반 칸 어긋나 보인다.
    this.player = this.add.sprite(
      startTile.x * TILE + TILE / 2,
      startTile.y * TILE + TILE / 2,
      this.appearanceKey,
      idleFrame(startFacing),
    )
    this.player.setDepth(DEPTH.player)

    // 게임 좌표는 기기 픽셀이고 월드는 여전히 32px 타일이다. zoom 으로 그 차이를
    // 메우면 화면에 보이는 월드 범위는 전과 똑같으면서 그리는 해상도만 올라간다 —
    // 배율이 정수라 원본 한 픽셀이 화면의 정수 개 픽셀로 떨어져 오히려 더 또렷해진다.
    //
    // UI 씬과 달리 카메라 원점은 중앙(기본값)으로 둔다. startFollow 가 원점을 써서
    // 추적 대상을 화면 가운데에 놓기 때문에, 좌상단으로 옮기면 플레이어가 구석에 붙는다.
    this.cameras.main.setZoom(renderScale())
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels)
    this.cameras.main.startFollow(this.player, true)

    this.mapWidth = map.width
    this.mapHeight = map.height
    this.wallLayer = walls

    // 노드가 놓인 칸은 걸을 수 없다. 맵 데이터에 벽을 그려 넣는 대신 여기서
    // 판정하는 이유는, 노드 배치가 이미 데이터에 있어서 같은 사실을 두 곳에
    // 적을 필요가 없기 때문이다.
    for (const p of Object.values(useGameStore.getState().data.placements)) {
      if (p.mapId !== this.mapId) continue
      this.blocked.add(`${p.x},${p.y}`)
      this.byTile.set(`${p.x},${p.y}`, {
        kind: 'node',
        instanceId: p.instanceId,
        nodeId: p.nodeId,
      })
    }

    // 화자가 놓인 칸도 걸을 수 없다 — 노드와 같은 이유이고 같은 집합을 쓴다.
    // 화자와 노드가 같은 칸에 놓이는 것은 빌드가 막으므로(validateSpeakerPlacements)
    // 여기서 byTile 이 서로를 덮어쓸 수 없다.
    //
    // **일과가 있는 화자는 여기 없다.** 그 사람의 칸은 시각이 정하므로 지금
    // 어디 있는지는 스케줄러의 첫 틱이 말해 주고(spawnSpeakers 아래), 그 뒤로도
    // 서고 걷고 들어갈 때마다 그 틱이 이 두 집합을 고친다.
    for (const speaker of Object.values(useGameStore.getState().data.speakers)) {
      if (speaker.mapId !== this.mapId) continue
      if (this.hasSchedule(speaker.id)) continue
      this.blocked.add(`${speaker.x},${speaker.y}`)
      this.byTile.set(`${speaker.x},${speaker.y}`, { kind: 'speaker', speakerId: speaker.id })
    }

    this.mover = new TileMover({
      start: startTile,
      // 스프라이트와 같은 방향으로 시작해야 한다 — 여기가 기본값 'down' 으로
      // 남으면 update() 의 첫 프레임이 스프라이트를 곧바로 되돌려 놓는다.
      facing: startFacing,
      isWalkable: (p) => this.isWalkable(p),
      // 전환은 "칸에 올라선 순간"에 판정한다. update() 에서 칸이 바뀐 것을
      // 보고 판정하면 이미 다음 걸음이 시작된 뒤라, 가장자리를 밟고도 한 칸
      // 더 걸어 나간 뒤에 화면이 바뀐다(TileMover.onArrive 문서).
      onArrive: (tile) => this.checkTransition(tile),
    })

    this.hub = new InputHub()
    this.keyboard = new KeyboardSource(this.hub)

    this.spawnNodes()
    this.spawnSpeakers()
    this.startScheduler()

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

    // 대사창(DialogueScene)도 같은 채널을 듣지만 하는 일이 다르다 — 저쪽은
    // 말을 화면에 올리고 이쪽은 말한 사람을 돌려세운다. 한쪽이 다른 쪽에게
    // 알려 주게 만들지 않는 이유는 그러면 두 씬이 서로를 가리키게 되기
    // 때문이다. seq 비교는 다른 채널들과 같은 이유다(gameStore 의 Utterance 문서).
    this.unsubscribeUtterance = useGameStore.subscribe((state, prev) => {
      const utterance = state.utterance
      if (!utterance || utterance.seq === prev.utterance?.seq) return
      this.faceSpeakerToPlayer(utterance.speaker)
    })

    this.dayNight = new DayNightOverlay(this)
    // 하늘은 명암 뒤에 만든다 — 그리는 순서는 depth 가 정하지만(DEPTH.weather),
    // 읽는 사람에게 "명암 위에 비가 온다"를 두 줄의 순서로도 말해 둔다.
    this.weatherSky = new WeatherSky(this)

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

    // 대사창도 같은 자세다 — 별도 씬, launch, CREATE 를 기다린 뒤 bind(hub, control).
    // control 을 함께 넘기는 이유도 패널과 같다: 대사창이 열려 있는 동안 컨트롤러를
    // 숨겨야 한다(DialogueScene 클래스 문서).
    this.scene.launch('Dialogue')
    const dialogue = this.scene.get('Dialogue')
    if (!(dialogue instanceof DialogueScene)) {
      throw new Error('Dialogue 씬을 찾을 수 없다: PhaserGame.ts 의 씬 배열을 확인하라')
    }
    dialogue.events.once(Phaser.Scenes.Events.CREATE, () => dialogue.bind(this.hub, control))
    this.dialogue = dialogue

    // 씬이 끝나는 유일한 경로는 App.tsx 의 game.destroy(true) 다. Phaser 는 이 경로에서
    // Systems.destroy() 만 부르고 Systems.shutdown() 은 부르지 않으므로 DESTROY 만
    // 발생하고 SHUTDOWN 은 절대 발생하지 않는다. shutdown 에만 걸면 정리가 전혀 돌지
    // 않아 스토어 구독이 살아남고, 나중에 그 구독이 불리면 이미 사라진 씬에
    // scene.add.text 를 호출해 던진다 — zustand 의 setState 는 리스너를 forEach 로
    // 돌리는데 하나가 던지면 그 뒤 리스너(다음 씬의 구독)는 아예 실행되지 않아 글자
    // 표시가 조용히 멈춘다. 그래서 두 이벤트 모두에 같은 정리 함수를 걸고, 두 번
    // 불려도 안전하도록 가드한다.
    // 이 정리는 이제 씬이 **끝날** 때만이 아니라 맵을 넘을 때마다 돈다.
    // scene.restart() 가 SHUTDOWN 을 일으키기 때문이다. 그 뒤 create() 가 처음부터
    // 다시 도므로 세 씬은 다시 launch 되고 구독도 다시 걸린다 — Phaser 의 씬
    // 작업 큐가 [stop World, start World] 순서로 처리되고, stop 이 여기서 큐에
    // 넣은 stop Control/Panel/Dialogue 가 start World 안의 launch 보다 앞서
    // 들어가므로 "껐다가 켠다" 순서도 지켜진다.
    let cleanedUp = false
    const cleanup = (): void => {
      if (cleanedUp) return
      cleanedUp = true
      // 남은 한쪽을 떼어 낸다. 이 함수는 두 이벤트에 걸려 있고 SHUTDOWN 은
      // 재시작마다 오므로, 그냥 두면 재시작할 때마다 죽은 클로저가 DESTROY 에
      // 하나씩 쌓인다. 가드가 있어 동작은 멀쩡하지만, 재시작 뒤가 새로 부팅한
      // 것과 같은 상태여야 한다는 것이 이 자리의 규칙이다.
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup)
      this.events.off(Phaser.Scenes.Events.DESTROY, cleanup)
      this.scene.stop('Control')
      this.scene.stop('Panel')
      this.scene.stop('Dialogue')
      this.dayNight.destroy()
      this.weatherSky.destroy()
      this.keyboard.destroy()
      this.floaters.destroy()
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
      this.unsubscribeMilestone?.()
      this.unsubscribeMilestone = null
      this.unsubscribeUtterance?.()
      this.unsubscribeUtterance = null
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
   * 말을 건다. 대화 한 번이 요청 한 번이고 발화 전체가 한 번에 온다(설계 문서 4.5).
   *
   * sendGather 와 달리 `nextActionAt` 을 보지 않는다 — 서버의 대화 경로에는
   * 행동 간격 판정 자체가 없다(routes/talk.ts). 간격은 채집·제작이 자원을
   * 만드는 속도를 묶으려고 있는 것이라, 아무것도 만들지 않는 대화에는 막을
   * 것이 없다. 여기서 굳이 흉내 내면 채집 직후 말을 걸었을 때 아무 일도
   * 안 일어나는 이유를 플레이어가 알 길이 없다.
   *
   * 응답이 실패하면(없는 화자·할 말 없음) 스토어가 아무것도 바꾸지 않으므로
   * 대사창은 열리지 않고 조작도 잠기지 않는다 — 잠근 뒤 못 여는 상태가 생기지
   * 않는 것은 잠금을 대사창 자신이 열릴 때만 걸기 때문이다(DialogueScene.render).
   */
  private sendTalk(speakerId: string): void {
    if (this.talkPending) return

    this.talkPending = true
    void useGameStore
      .getState()
      .talk(speakerId)
      .finally(() => {
        this.talkPending = false
      })
  }

  /**
   * 방금 올라선 칸에 전환이 있으면 서버에 알리고, 그 자리에 멈춰 세운다.
   *
   * **"어디로 가고 싶다"가 아니라 "어느 칸을 밟았다"만 보낸다.** 목적지를
   * 클라이언트가 고를 수 있게 하면 요청 하나로 아무 맵 아무 칸에나 설 수 있고,
   * 그건 서버가 판정의 유일한 주인이라는 이 게임의 전제와 정면으로 어긋난다.
   * 어디로 가는지는 서버가 전환표에서 찾아 응답의 `player.location` 으로 말한다.
   *
   * 전환이 있는지 **여기서도** 보는 이유는 판정이 아니라 통신량이다 — 걸음마다
   * 서버에 묻지 않으려는 것이고, 판정 자체는 서버가 다시 한다.
   *
   * `'stop'` 을 돌려주는 것이 중요하다. 세계 입력 잠금은 **다음** 걸음을 막을
   * 뿐이고, 이 걸음에 이어 시작되려는 걸음은 그것으로 막히지 않는다.
   */
  private checkTransition(here: TilePos): 'stop' | void {
    if (this.movePending) return
    const { player, data } = useGameStore.getState()
    if (!player) return

    const found = data.transitions.some(
      (t) => t.fromMap === this.mapId && t.fromX === here.x && t.fromY === here.y,
    )
    if (!found) return

    this.movePending = true
    // 응답을 기다리는 동안 세계 입력을 잠근다. 잠그지 않으면 그 사이에 계속
    // 걸어서, 서버가 정한 도착 칸과 플레이어가 보고 있던 자리가 어긋난 채로
    // 맵이 바뀐다. 주인을 따로 두는 이유는 InputState 의 lockedBy 주석에 있다.
    this.hub.setWorldInputLocked('transition', true)
    void useGameStore
      .getState()
      .move(here.x, here.y)
      .then(() => {
        // 씬을 통째로 다시 시작한다. 맵 JSON·타일셋·벽·배치·화자가 전부 맵마다
        // 다르므로, 바꿀 것을 하나씩 골라내는 것보다 create() 를 처음부터 다시
        // 도는 편이 빠뜨릴 여지가 없다. 새 InputHub 가 만들어지므로 방금 건
        // 잠금도 그때 함께 사라진다.
        //
        // 걸어 나온 방향을 함께 넘긴다. 전환의 facing 이 비어 있으면 그것을
        // 그대로 유지해야 하는데(설계 문서 3.5), 이 mover 는 재시작과 함께
        // 사라지므로 지금이 그 방향을 전할 수 있는 마지막 순간이다.
        this.scene.restart({ enteredFacing: this.mover.facing } satisfies WorldSceneData)
      })
      .catch(() => {
        // 서버가 거절했거나 닿지 못했다. 씬은 그대로 두고 잠금만 푼다 — 여기서
        // 재시작하면 스토어의 위치는 아직 옛것이라 **마지막 전환 도착 칸**으로
        // 되돌아가 순간이동한 것처럼 보인다.
        this.hub.setWorldInputLocked('transition', false)
      })
      .finally(() => {
        this.movePending = false
      })

    return 'stop'
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

    // 이동·행동보다 먼저 처리한다 — 이번 프레임에 패널이나 대사창이 막 열리거나
    // 닫혔다면 같은 프레임의 이동조차 그 변화를 따라야 한다(설계 문서 §7). 이 씬의
    // update() 안에서 직접 부르는 이유는 PanelScene.applyInput() 의 문서에
    // 적었다: 자신의 update() 에서 읽으면 이미 이번 프레임의 beginFrame() 이
    // 지나간 뒤다.
    //
    // 대사창이 패널보다 먼저이고, 대사창이 열려 있던 프레임에는 패널이 아예
    // 입력을 안 본다. 둘 다 같은 B(cancelPressed)를 읽기 때문이다 — 안 그러면
    // 대사창을 B 로 닫는 그 프레임에 패널이 같은 B 를 "아무것도 안 열려 있으니
    // 메뉴를 열라"로 읽어, 대사를 닫자마자 상세 메뉴가 열린다. 열려 있었는지를
    // 부르기 **전에** 기억해 두는 것이 핵심이다.
    const dialogueWasOpen = this.dialogue.isOpen
    this.dialogue.applyInput()
    if (!dialogueWasOpen) this.panel.applyInput()

    // 전환 판정은 이 안에서 일어난다 — 걸음이 끝나는 그 순간에 mover 가
    // checkTransition() 을 부른다(create() 의 onArrive).
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

    // 일과는 세계 시각을 따르므로 **잠긴 동안에도 돈다.** 대사창을 열어 둔 채로
    // 시간이 흐르면 사람은 걸어가야 맞다 — 여기서 멈추면 창을 닫는 순간 그
    // 사람이 몇 칸을 순간이동한다.
    if (this.scheduler) this.applyNpcCommands(this.scheduler.tick(worldNow()))
    // 스케줄러가 말해 준 칸까지 걸어가는 것은 그림 자신이 한다(NpcSprite.update).
    // 일과가 없는 화자는 목표가 늘 제자리라 아무 일도 일어나지 않는다.
    for (const sprite of this.npcSprites.values()) sprite.update(delta)

    this.updateIdleFacing(delta)

    this.dayNight.update(gameTimeAt(worldNow()).minuteOfDay)

    // 하늘도 낮밤과 같은 자세로 매 프레임 "지금 무엇인가"를 받는다 — 켜고 끄는
    // 타이머가 없다. 만료는 시각 비교 하나이므로(shared 의 weatherView) 그친
    // 순간은 이 줄이 스스로 알아낸다: 취소할 타이머가 없으니 세계가 상태보다
    // 오래 비를 뿌릴 길이 없다. 상단바가 남은 시간을 세는 함수도 이것이다.
    this.weatherSky.update(weatherView(useGameStore.getState().player?.weather ?? null, worldNow()))

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
   * switch 로 열어 둔 덕에 화자를 더하면서 입력 계층은 한 줄도 안 바뀌었다.
   * never 가드는 종류가 둘이 된 지금부터 값어치를 갖는다 — 세 번째 종류를
   * Interactable 에 더하면서 여기 분기를 잊으면 그 순간 컴파일이 깨진다.
   * 가드가 없으면 그 대상은 앞칸에 서서 A 를 눌러도 조용히 아무 일도 안
   * 일어나고, 그건 화면만 봐서는 "아직 안 만든 것"과 구별되지 않는다.
   */
  private interact(target: Interactable): void {
    switch (target.kind) {
      case 'node':
        this.sendGather(target.instanceId)
        break
      case 'speaker':
        this.sendTalk(target.speakerId)
        break
      default: {
        const exhaustive: never = target
        throw new Error(`처리하지 않은 상호작용 대상: ${JSON.stringify(exhaustive)}`)
      }
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
    // setScrollFactor(0) 은 스크롤에서만 벗어나고 zoom 에서는 벗어나지 않는다.
    // 이 카메라는 중앙 기준으로 확대되므로, 화면의 (w/2, h/3) 에 보이게 하려면
    // 좌표를 중앙 쪽으로 당겨 놓아야 한다 — fixedToCamera 가 그 계산이다.
    const at = fixedToCamera(cam, cam.width / 2, cam.height / 3)
    const label = addText(this, at.x, at.y, text, {
      fontSize: `${FONT_SIZE.title}px`,
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
      if (placement.mapId !== this.mapId) continue
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
        variant: def.variant,
      })
    }
  }

  /** 이 화자의 자리를 시각이 정하는가. 정하면 blocked·byTile·자세의 주인이 스케줄러다. */
  private hasSchedule(speakerId: string): boolean {
    return Object.hasOwn(useGameStore.getState().data.schedules, speakerId)
  }

  /**
   * 이 맵의 화자 마커를 놓는다. 노드 배치와 같은 방식이다 — 타일 좌표에
   * `* TILE + TILE / 2` 로 그 칸의 중심 픽셀을 얻는다.
   *
   * 배치를 맵 파일이 아니라 `speakers.csv` 가 갖는 이유는 서버도 같은 배치를
   * 알아야 하기 때문이다(설계 문서 9장). 좌표가 벽이거나 맵 밖이거나 노드와
   * 겹치는 경우는 빌드가 이미 막았다(validateSpeakerPlacements).
   *
   * **일과가 있는 화자도 여기서 그림을 만들되 꺼 둔다.** 하루 중 이 맵에 올 수
   * 있으면 지금 실내에 있든 다른 맵에 있든 그림은 미리 있어야 하고(그래야 문에서
   * 나오는 순간 그릴 것이 있다), 지금 보이는지는 스케줄러의 첫 틱이 정한다.
   * 어느 화자가 여기 속하는지는 프리로드와 **같은 함수**가 답한다.
   */
  private spawnSpeakers(): void {
    const { data } = useGameStore.getState()

    for (const speaker of speakersForMap(data, this.mapId)) {
      const scheduled = this.hasSchedule(speaker.id)

      // 자리와 첫 자세는 데이터가 정한다. 그 뒤로 방향을 바꾸는 것은 이 채널
      // 하나뿐이고, 그래서 "지금 어느 쪽을 보고 있나"의 주인이 하나다.
      const pose = new SpeakerPoseChannel({
        tile: { x: speaker.x, y: speaker.y },
        facing: speaker.facing,
      })
      this.speakerPoses.set(speaker.id, pose)

      const sprite = new NpcSprite({
        scene: this,
        speakerId: speaker.id,
        label: speaker.name,
        sprite: speaker.sprite,
        pose,
      })
      this.npcSprites.set(speaker.id, sprite)
      // 일과가 있는 사람의 `speakers.csv` 좌표는 이제 자리가 아니라 그림의 첫
      // 자세일 뿐이다. 첫 틱 전에 그 칸에 서 있는 모습을 한 프레임이라도 보이면
      // 아무도 없어야 할 자리에 사람이 깜빡인다.
      if (scheduled) sprite.setVisible(false)

      // 사물은 심심풀이로 돌지 않는다 — 안내판이 두리번거리면 그건 사람이다.
      if (npcSprite(speaker.sprite).kind !== 'char') continue
      this.idleSpeakers.push({
        pose,
        remainingMs: this.nextIdleTurnMs(),
        // 일과가 있는 사람이 지금 서 있는지는 첫 틱이 말해 준다.
        standing: !scheduled,
      })
    }
  }

  /**
   * 일과가 있는 화자를 시각 위에 올린다.
   *
   * 첫 틱을 여기서 바로 돌리는 것이 핵심이다 — 첫 update() 를 기다리면 한
   * 프레임 동안 문 앞에 아무도 없고, 무엇보다 그 한 프레임에 blocked 가 비어
   * 있어 서 있는 사람의 칸으로 걸어 들어갈 수 있다.
   */
  private startScheduler(): void {
    const { data } = useGameStore.getState()
    const schedules = schedulesForMap(data, this.mapId)
    if (schedules.length === 0) return

    this.scheduler = new NpcScheduler({
      mapId: this.mapId,
      schedules,
      places: data.places,
      routes: data.routes,
    })
    this.applyNpcCommands(this.scheduler.tick(worldNow()))
  }

  /**
   * 스케줄러가 낸 명령을 화면과 판정에 옮긴다.
   *
   * 그림(보임·자세)은 자세 통로로 가고, 칸(막힘·앞칸 대화)은 `blocked`·`byTile`
   * 로 함께 간다. 둘이 갈라지는 자리가 걷는 사람이다 — 보이지만 칸은 잡지
   * 않는다. 실내는 그 반대다: 안 보이지만 문 칸은 잡는다(설계 §1·§9.3).
   */
  private applyNpcCommands(commands: readonly NpcCommand[]): void {
    for (const command of commands) {
      switch (command.kind) {
        case 'spawn':
          this.pushSpeakerPose(command.speakerId, command.tile, command.facing)
          this.npcSprites.get(command.speakerId)?.setVisible(true)
          this.setIdleStanding(command.speakerId, !command.walking)
          break
        case 'despawn':
          this.npcSprites.get(command.speakerId)?.setVisible(false)
          this.setIdleStanding(command.speakerId, false)
          break
        case 'move':
          this.pushSpeakerPose(command.speakerId, command.tile, command.facing)
          // 길 위에서는 심심풀이가 방향을 건드리지 않는다 — 걷는 동안의 방향은
          // 스케줄러의 것이다(설계 §6).
          this.setIdleStanding(command.speakerId, !command.walking)
          break
        case 'claim': {
          const key = `${command.tile.x},${command.tile.y}`
          this.byTile.set(key, { kind: 'speaker', speakerId: command.speakerId })
          this.blocked.add(key)
          break
        }
        case 'release': {
          const key = `${command.tile.x},${command.tile.y}`
          // 그 칸이 아직 이 사람의 것일 때만 지운다. 두 NPC 가 같은 지점에
          // 겹쳐 서는 것은 빌드가 안내만 하고 막지는 않으므로(collectScheduleNotices),
          // 남의 칸을 지워 벽이 사라지는 일이 없게 한다.
          const holder = this.byTile.get(key)
          if (holder?.kind !== 'speaker' || holder.speakerId !== command.speakerId) break
          this.byTile.delete(key)
          this.blocked.delete(key)
          break
        }
        default: {
          const exhaustive: never = command
          throw new Error(`처리하지 않은 일과 명령: ${JSON.stringify(exhaustive)}`)
        }
      }
    }
  }

  /**
   * 자세 하나를 그 화자의 통로에 민다. `facing` 이 null 이면 지금 보고 있는
   * 쪽을 그대로 둔다 — 지점이 방향을 적지 않았다는 것은 "여기서는 아무 쪽이나"
   * 라는 뜻이고, 그 자리에서 아래를 보게 만들면 미세 동작이 방금 고른 방향이 지워진다.
   */
  private pushSpeakerPose(speakerId: string, tile: TilePos, facing: Direction | null): void {
    const pose = this.speakerPoses.get(speakerId)
    if (!pose) return
    pose.set({ tile, facing: facing ?? pose.pose.facing })
  }

  private setIdleStanding(speakerId: string, standing: boolean): void {
    const pose = this.speakerPoses.get(speakerId)
    if (!pose) return
    const idle = this.idleSpeakers.find((s) => s.pose === pose)
    if (idle) idle.standing = standing
  }

  /** 다음에 고개를 돌릴 때까지의 시간. 화자마다 따로 뽑아 서로 어긋나게 둔다. */
  private nextIdleTurnMs(): number {
    return Phaser.Math.Between(IDLE_TURN_MIN_MS, IDLE_TURN_MAX_MS)
  }

  /**
   * 심심풀이로 고개를 돌린다. 판정에 쓰이지 않는 순수한 연출이라 클라이언트가
   * 혼자 정하고 서버에 알리지 않는다 — 서버가 아는 것은 여전히 화자의 칸뿐이고,
   * 대화도 앞칸 판정도 방향을 보지 않는다.
   *
   * **세계 입력이 잠긴 동안에는 멈춘다.** 대사창이나 패널이 열려 있는 동안 남은
   * 시간을 줄이지 않으므로, 대화를 마치고 나오면 카운트다운이 이어진다. 이게
   * 없으면 말을 걸어 이쪽을 보게 만든 상대가 대사창 뒤에서 고개를 돌려 버리고,
   * 창을 닫는 순간 딴 데를 보고 있다.
   *
   * **플레이어가 앞칸에서 바라보고 있으면 돌지 않는다.** 눈이 마주친 사람이
   * 고개를 홱 돌리면 무시당한 것처럼 읽힌다 — 그리고 방금 말을 건 상대가
   * 바로 그 자리에 있으므로, 이 한 줄이 "말을 걸면 이쪽을 본다"를 대화가 끝난
   * 뒤에도 지켜 준다.
   *
   * **걷는 사람도 돌지 않는다.** 걷는 동안의 방향은 스케줄러가 소유한다(설계
   * §6) — 여기서 함께 건드리면 길을 가다 말고 뒤를 돌아보며 옆으로 미끄러진다.
   */
  private updateIdleFacing(delta: number): void {
    if (this.hub.worldInputLocked) return

    for (const speaker of this.idleSpeakers) {
      if (!speaker.standing) continue
      speaker.remainingMs -= delta
      if (speaker.remainingMs > 0) continue
      speaker.remainingMs = this.nextIdleTurnMs()

      // 자리의 주인은 자세 통로다 — 일과가 있는 사람의 칸은 시각에 따라 옮겨
      // 다니므로, 처음 좌표를 따로 기억해 두면 그 사람은 옛 자리에서 두리번거린다.
      const tile = speaker.pose.pose.tile
      if (isAdjacentFacing(this.mover.tile, this.mover.facing, tile)) continue

      const current = speaker.pose.pose.facing
      const others = DIRECTIONS.filter((d) => d !== current)
      // 넷 중 지금 방향을 뺀 셋에서 고른다. 같은 방향이 나오면 그 차례는
      // 아무 일도 안 일어난 것과 같아서, 서 있는 시간만 들쭉날쭉해진다.
      speaker.pose.set({ tile, facing: Phaser.Math.RND.pick(others) })
    }
  }

  /**
   * 말이 통한 화자를 플레이어 쪽으로 돌려세운다.
   *
   * 발화 채널을 듣는 것이 이 자리의 핵심이다. 요청을 보내는 곳(sendTalk)에서
   * 돌리면 서버가 거절한 대화 — 없는 화자, 할 말 없음 — 에도 고개가 돌아가고,
   * 그러면 화면이 서버가 하지 않은 판정을 한 셈이 된다. 발화가 도착했다는 것은
   * 서버가 "이 화자가 이 말을 했다"고 정했다는 뜻이다.
   *
   * 돌아간 방향은 대화가 끝나도 그대로 남는다. 되돌리지 않는 것이 맞다 —
   * 방금 이야기를 나눈 사람이 말을 마치자마자 등을 돌리면 그게 더 이상하다.
   */
  private faceSpeakerToPlayer(speakerId: string): void {
    const pose = this.speakerPoses.get(speakerId)
    if (!pose) return // 다른 맵의 화자다. 맵을 넘는 사이에 응답이 도착하면 그럴 수 있다.

    const facing = facingToward(pose.pose.tile, this.mover.tile)
    if (!facing) return
    pose.set({ tile: pose.pose.tile, facing })

    // 방금 돌아섰으니 심심풀이 시계도 처음부터 센다. 안 그러면 말을 거는
    // 순간에 마침 시간이 다 된 화자가 돌아서자마자 딴 데를 본다.
    const idle = this.idleSpeakers.find((s) => s.pose === pose)
    if (idle) idle.remainingMs = this.nextIdleTurnMs()
  }

  /** 이 외형의 그 방향 걷기. 키에 외형을 넣는 이유는 createAnimations 문서 참고. */
  private walkKey(facing: Direction): string {
    return `walk-${this.appearanceKey}-${facing}`
  }

  private createAnimations(): void {
    for (const facing of DIRECTIONS) {
      // 애니메이션은 씬이 아니라 게임 전체가 갖는다. 맵을 넘을 때마다 이
      // create() 가 다시 도는데, 이미 있는 키를 다시 만들면 Phaser 가 조용히
      // 무시하면서 콘솔에 경고만 남긴다 — 전환마다 네 줄씩이다.
      //
      // **그래서 키에 외형이 들어간다.** 게임 전체가 갖는 것을 방향으로만
      // 구분하면, 한 번 만들어진 `walk-down` 은 처음 들어온 사람의 시트에
      // 영원히 묶인다 — 로그아웃하고 다른 계정으로 들어오면 서 있는 모습만
      // 바뀌고 걷는 순간 앞사람으로 돌아간다.
      const key = this.walkKey(facing)
      if (this.anims.exists(key)) continue
      this.anims.create({
        key,
        frames: walkFrames(facing).map((frame) => ({ key: this.appearanceKey, frame })),
        frameRate: 8,
        repeat: -1,
      })
    }
  }

  private updateAnimation(moving: boolean, facing: Direction): void {
    if (!moving) {
      this.player.anims.stop()
      this.player.setFrame(idleFrame(facing))
      return
    }
    this.player.anims.play(this.walkKey(facing), true)
  }
}
