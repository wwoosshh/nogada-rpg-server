import { loadGameData } from '@nogada/data'
import {
  calcCraftSuccess,
  equippedToolTier,
  nodeAvailable,
  SKILL_LABELS,
  transitionGate,
  WEATHER_LABELS,
  type CreateCharacterRequest,
  type GameData,
  type MilestoneDef,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'
import { create } from 'zustand'
import {
  ApiError,
  GameClient,
  NETWORK_ERROR,
  setUnauthorizedObserver,
  type CraftOutcomeDto,
  type GatherOutcomeDto,
  type MoveOutcomeDto,
  type TalkOutcomeDto,
} from '../api/GameClient.js'
import { clearToken, readToken, writeToken } from '../api/sessionToken.js'
import type { DetailMenuTab } from '../game/detailMenuTabs.js'
import { syncClock, worldNow } from '../time/clock.js'
import { toCraftContext } from '../ui/craftCardModel.js'
import {
  describeServerError,
  SERVER_UNREACHABLE,
  type MessageOverrides,
} from '../ui/serverMessages.js'
import { formatGold } from '../ui/shopModel.js'

/**
 * 캐릭터 머리 위에 띄울 행동 결과.
 *
 * seq 는 같은 문구가 연달아 나올 때(구리 원석 +1 을 두 번 캐는 경우)도
 * 구독자가 새 사건임을 알 수 있게 한다. 문구만 비교하면 두 번째를 놓친다.
 */
export interface ActionFeedback {
  seq: number
  text: string
  tone: 'good' | 'bad'
  /**
   * 같은 키의 결과가 연달아 오면 새 글자를 만들지 않고 기존 글자에 더한다.
   * null 이면 누적하지 않고 매번 새로 띄운다.
   */
  groupKey: string | null
  amount: number
}

/**
 * 노가다 사이사이의 사건.
 *
 * 원작이 8,000시간을 버틴 이유는 반복 자체가 아니라 반복이 무언가를 향하고
 * 있었기 때문이다. 자동 반복 해금은 그 첫 번째 사건이 될 수 있다 — 조용히
 * 켜지면 아무도 알아채지 못하고, 그러면 문턱을 둔 의미가 사라진다.
 */
export interface Milestone {
  seq: number
  text: string
}

/**
 * 화자가 지금 한 말.
 *
 * `lines` 는 한 마디 전체다 — 대사창이 순서대로 넘길 칸들이고, 칸마다 서버에
 * 다시 묻지 않는다. 서버가 한 번의 판정으로 전부 정해서 보낸다.
 *
 * milestone 채널과 같은 모양(seq 로 "새 사건"을 구분)을 쓴다: 같은 화자에게
 * 두 번 말을 걸어 같은 대사가 다시 나와도(동점 후보가 하나뿐인 경우) seq 가
 * 올라가야 구독자가 "이미 처리한 발화"로 착각해 무시하지 않는다.
 */
export interface Utterance {
  seq: number
  /** 화자 id. 이름·초상은 구독자가 `data.speakers` 에서 찾는다. */
  speaker: string
  lines: string[]
}

/**
 * 게임 화면을 띄워도 되는가.
 *
 * 이 게임은 모든 판정을 서버가 한다. 서버에 닿지 못하면 채집도 제작도 불가능하므로
 * 반쯤 동작하는 화면을 보여주는 대신 진입 자체를 막는다. 오프라인 플레이(설계 문서
 * 3.4 의 인프로세스 서버)는 게임 구조가 자리잡은 뒤에 별도로 만든다.
 *
 * 계정이 생긴 뒤로 이 값은 **`boot` 에서 파생된다**(`gate()` 참고) —
 * `'online'` 은 정확히 `boot === 'playing'` 이다. App.tsx 가 보는 창이 이 필드
 * 하나뿐이라, 둘을 따로 적으면 언젠가 게이트가 사라진 채로 세계가 열린다.
 */
export type Connection = 'connecting' | 'online' | 'offline'

/**
 * 게임에 들어가기까지의 국면 — 화면 하나에 하나씩 대응한다(설계 §5).
 *
 * `'unreachable'` 을 따로 두는 것이 규범 12 의 요구다: **토큰 없음 / 토큰 거부 /
 * 서버 불통은 서로 다른 화면이어야 한다.** 앞의 둘은 `'title'` 에서 `session` 이
 * 가르고(각각 "시작" 과 "만료되었습니다"), 서버에 말 자체를 못 건 경우만
 * 이 국면으로 온다 — 그 셋을 한 화면에 뭉치면 "다시 시도" 를 눌러야 하는
 * 상황과 "로그인해야 하는" 상황이 구별되지 않는다.
 */
export type BootPhase = 'checking' | 'title' | 'auth' | 'creating' | 'playing' | 'unreachable'

/**
 * 저장된 토큰이 지금 무엇인가.
 *
 * - `'none'` — 토큰이 없다. 처음 켠 기기이거나 로그아웃했다.
 * - `'rejected'` — 토큰이 있었지만 서버가 거절했다(만료·로그아웃된 세션).
 * - `'ready'` — 서버가 받아들였다. 타이틀이 "이어서 하기" 를 내놓을 수 있다.
 */
export type SessionState = 'none' | 'rejected' | 'ready'

/**
 * 화자가 없는 말 — 대사창 자리에 뜨는 짧은 안내.
 *
 * 발화(Utterance)와 채널을 나눈 이유는 **말한 사람이 없기 때문이다.** 발화를
 * 들은 WorldScene 은 그 화자를 플레이어 쪽으로 돌려세우는데(faceSpeakerToPlayer),
 * 여기 오는 것은 애초에 그 자리에 없는 사람이라 돌려세울 몸이 없다. 같은 채널에
 * 실으면 그 구독이 "누구인지 모를 화자"를 매번 골라내야 한다.
 *
 * seq 는 다른 채널들과 같은 이유다: 같은 문 앞에서 두 번 눌러 같은 글이 다시
 * 나와도 구독자가 "이미 처리했다"로 착각해 무시하지 않는다.
 */
export interface Notice {
  seq: number
  text: string
}

/**
 * 없는 사람에게 말을 걸었을 때 뜨는 글.
 *
 * 서버가 `not_here` 로 답하는 경우는 둘이다 — 실내로 들어갔거나(밤의 여관),
 * 길 위를 걷는 중이다. 어느 쪽인지 말하지 않는 것이 맞다: 플레이어가 아는 것은
 * "여기 없다" 까지이고, 어디 갔는지는 하루를 지켜봐서 알아내는 것이 이 시스템의
 * 재미다. 화면에 보이는 사람에게 말을 걸었는데 이 글이 뜨는 일은 없다 —
 * 걷는 사람은 앞칸 판정에 아예 오르지 않는다(npcScheduler 의 isTalkable).
 */
const NOT_HERE_NOTICE = '지금 여기 없는 것 같다.'

/**
 * 상단 바 톱니(React)가 상세 메뉴(Phaser 씬)를 열어 달라는 요청.
 *
 * 톱니는 DOM 버튼이고 메뉴는 PanelScene 안의 Phaser 오브젝트라 직접 부를 수 없다 —
 * App.tsx 를 건드리지 않고 두 세계를 잇는 유일한 통로가 이 스토어다. milestone
 * 채널과 같은 모양(seq 로 "새 사건"을 구분)을 쓴다: 같은 tab 을 두 번 연달아
 * 요청해도(예: 톱니를 두 번 누름) seq 가 매번 올라가야 PanelScene 의 구독이
 * "이미 처리한 요청"으로 착각해 무시하지 않는다.
 */
export interface MenuRequest {
  seq: number
  tab: DetailMenuTab
}

/**
 * 지금 열려 있는 전면 패널 — 열림 상태의 유일한 주인이다(설계 §8-앞 6).
 *
 * 값이 하나라서 상호배제는 공짜다: 가방을 연 채 메뉴를 열면 이전 값이 덮이며
 * 닫힌다. `bag`·`craft`·`codex` 는 DOM(React, TopBar 가 마운트)이 그리고 `menu` 는
 * Phaser(PanelScene)가 그린다 — 그리는 쪽이 둘이어도 읽는 값은 이것 하나다.
 *
 * 입력 라우팅(I/C/ESC)은 여기가 아니라 PanelScene.applyInput 이 한다. DOM 에
 * 키보드 리스너를 두지 않는 이유는 대사창 계약(대화 중 I/C 삼킴) 때문이다 —
 * 그 계약은 WorldScene 이 applyInput 을 부르지 않는 것 한 곳으로 지켜진다.
 *
 * **`'codex'` 는 리터럴 하나로 끝난다**(수집의 방 설계 §6-앞 1). B 로 닫히는 것도,
 * 열려 있는 동안 세계 입력이 잠기고 가상 컨트롤러가 숨는 것도 전부 `openPanel !==
 * null` 하나를 보는 값 무관한 규칙이라(PanelScene.applyInput·applyWorldLock) 새
 * 패널은 그것을 공짜로 물려받는다 — 새 입력 키를 파지 않는 이유이기도 하다.
 */
export type OpenPanel = 'bag' | 'craft' | 'codex' | 'menu' | ShopPanelKey | null

/**
 * 상점 패널의 열림 값 — 상점 **id 를 품은 문자열 키**다(설계 §6-앞 20).
 *
 * 왜 `{ kind: 'shop', id }` 객체가 아닌가: `setOpenPanel` 의 항등 가드
 * (`panel === get().openPanel`)가 값 비교라, 객체를 넣으면 같은 상점을 다시
 * 여는 요청이 매번 새 객체로 와서 가드를 통과한다 — 그 가드 하나가 제작 tally
 * 리셋을 지키고 있다. 문자열이면 상호배제도 그대로 공짜다: 상점을 연 채 가방을
 * 열면 값이 덮이며 닫힌다.
 */
export type ShopPanelKey = `shop:${string}`

/** 상점 id 하나를 열림 값으로 만든다. 접두사를 손으로 적는 곳을 하나로 묶는다. */
export function shopPanelKey(shopId: string): ShopPanelKey {
  return `shop:${shopId}`
}

/** 열림 값이 상점이면 그 상점 id, 아니면 null — 상점 패널이 자기 차례인지 묻는 창구. */
export function shopIdOf(panel: OpenPanel): string | null {
  return panel !== null && panel.startsWith('shop:') ? panel.slice('shop:'.length) : null
}

/** 레시피 하나의 이번-열림 누적 성적. 제작 카드가 `+N · 실패 M` 로 보여준다(설계 §8-앞 3). */
export interface CraftTallyEntry {
  success: number
  fail: number
}

interface GameStore {
  data: GameData
  player: PlayerState | null
  connection: Connection
  boot: BootPhase
  session: SessionState
  /** 게임 앞 화면들이 띄울 실패 한 줄. 화면마다 문구를 짓지 않고 여기 하나만 읽는다. */
  gateError: string | null
  /** 게임 앞 화면이 서버의 답을 기다리는 중. 버튼을 잠그고 두 번 눌리는 것을 막는다. */
  gateBusy: boolean
  /** 캐릭터 삭제 확인 창이 떠 있는가. 설정 탭(Phaser)이 열고 DOM 이 그린다. */
  confirmingDelete: boolean
  /** 지금 열려 있는 전면 패널. 규칙은 OpenPanel 타입 문서에 있다. */
  openPanel: OpenPanel
  /**
   * 대사가 끝나면 열릴 상점 id(설계 §6-앞 20).
   *
   * talk 응답이 곧바로 패널을 열지 못하는 이유가 이 필드의 존재 이유다:
   * DialogueScene 의 발화 구독이 **가장 먼저** `setOpenPanel(null)` 을 부른다
   * (대사가 화면의 단독 소유자여야 하므로). 응답에서 바로 열면 그 직후 닫힌다.
   * 그래서 문은 여기서 기다렸다가 대사창이 닫히는 순간 열린다 — 원작에서도
   * 상인은 말을 마치고 나서 물건을 펼쳤다.
   */
  pendingShop: string | null
  /**
   * 제작 패널이 열려 있는 동안의 레시피별 누적 성공/실패(설계 §8-앞 3).
   * 결과가 초당 여러 번 오는 화면이라 점멸 대신 쌓이는 숫자를 쓴다 —
   * 제작 패널이 열리는 순간 리셋된다(setOpenPanel).
   */
  craftTally: Record<string, CraftTallyEntry>
  /**
   * 방금 거래가 거절된 이유 한 줄 — **상점 패널 안에서** 읽는 채널이다.
   *
   * 왜 머리 위 글자(lastAction)가 아닌가: 거래는 상점 패널이 화면을 덮은
   * 상태에서만 일어난다. 캔버스 플로터로 보내면 그 글자는 패널 뒤에서 뜨고
   * 사라져 **아무도 못 본다** — 같은 이유로 이 파일의 매도 액션은 성공을
   * 아예 알리지 않는다(성공은 골드와 스택 숫자가 그 자리에서 직접 말한다).
   * 거절은 다르다: 화면이 바뀌지 않으니 말이 없으면 정말로 아무 일도 안
   * 일어난 것처럼 보인다. 그래서 문구는 패널 안 합계 줄 옆에 앉는다.
   *
   * seq 를 달지 않는 이유는 이것이 사건이 아니라 **상태**이기 때문이다 —
   * 구독자(ShopPanel)는 글자를 띄웠다 지우는 것이 아니라 값이 있는 동안 그
   * 자리를 그린다. 다음 요청이 나갈 때·거래가 성공할 때·패널이 바뀔 때 지워진다.
   */
  tradeError: string | null
  /**
   * 거래 요청이 나가 있다 — 상점 패널의 [팔기]·[사기] 를 그동안 잠근다.
   *
   * 이것이 "보유량 전부로 두 번 빠르게 누르면 둘째가 거절된다"의 **근본**
   * 교정이다: 첫 요청이 돌아오기 전에 둘째가 나가면 그 둘째는 이미 비워진
   * 스택을 다시 팔려 해 반드시 `missing_items` 로 거절된다. 문구를 보여주는
   * 것은 그 뒤에 남는 안전망이고, 애초에 두 번째 요청을 안 보내는 것이 답이다.
   */
  tradeBusy: boolean
  /**
   * 가방 패널 안에서 거절된 이유 한 줄 — 착용·강화·사용이 함께 쓴다.
   *
   * `tradeError` 가 상점 패널에서 배운 것을 그대로 옮긴 채널이다: 이 세 조작은
   * **가방 패널이 화면을 덮은 상태에서만** 일어나므로, 거절을 머리 위 글자
   * (lastAction → 캔버스 플로터)로 보내면 그 문구는 패널 뒤에서 뜨고 사라져
   * 아무도 못 본다. 착용·강화가 오래 그 자리에 있었던 것은 "거절이 드물어
   * 채널을 나눌 이유가 없다"는 판단이었는데, [사용] 버튼이 들어오면서 채널이
   * 생겼으니 셋이 같은 자리를 쓴다 — 같은 패널의 같은 종류의 실패다.
   *
   * seq 가 없는 이유도 tradeError 와 같다: 이것은 사건이 아니라 **상태**다.
   * 다음 요청이 나갈 때·성공할 때·패널이 바뀔 때 지워진다.
   */
  bagError: string | null
  /**
   * 가방 요청이 나가 있다 — [착용]·[강화]·[사용] 을 그동안 잠근다.
   *
   * `tradeBusy` 와 같은 신호이고 같은 이유다(그쪽 문서 참고): 왕복이 도는
   * 동안 둘째 요청이 나가면 그 둘째는 이미 없어진 것을 다시 쓰려 해 반드시
   * 거절된다. 가루는 그중에서도 나쁜 축이다 — 성공하면 개수가 정말로 줄어드는데
   * 화면에는 그 사이 아무 표시가 없어서, 안 먹혔다고 생각한 사람이 한 번 더
   * 누르고 그 한 번이 두 번째 가루를 태운다.
   *
   * 상점이 이 교훈을 먼저 배웠는데 가방만 빠져 있었다. 채널(bagError)을 셋이
   * 나눠 쓰는 것처럼 잠금도 하나다 — 셋 다 같은 패널의 같은 왕복이다.
   */
  bagBusy: boolean
  lastAction: ActionFeedback | null
  milestone: Milestone | null
  utterance: Utterance | null
  notice: Notice | null
  menuRequest: MenuRequest | null
  connect: () => Promise<void>
  showAuth: () => void
  showTitle: () => void
  authenticate: (mode: AuthMode, username: string, password: string) => Promise<void>
  resume: () => Promise<void>
  createCharacter: (req: CreateCharacterRequest) => Promise<void>
  logout: () => Promise<void>
  askDeleteCharacter: () => void
  cancelDeleteCharacter: () => void
  deleteCharacter: (confirmName: string) => Promise<void>
  gather: (instanceId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
  talk: (speakerId: string) => Promise<void>
  move: (x: number, y: number) => Promise<void>
  equip: (instanceId: string) => Promise<void>
  enhance: (materialInstanceId: string) => Promise<void>
  use: (itemId: string) => Promise<void>
  donate: (itemId: string, count: number) => Promise<void>
  sell: (shopId: string, itemId: string, count: number) => Promise<void>
  buy: (shopId: string, itemId: string, count: number) => Promise<void>
  openMenu: (tab: DetailMenuTab) => void
  setOpenPanel: (panel: OpenPanel) => void
  /**
   * 지난 거래 거절 문구를 지운다 — 상점 패널 안에서 **선택이 옮겨질 때** 부른다.
   *
   * `setOpenPanel` 이 패널이 바뀌는 순간을 이미 지키지만(그쪽 주석), 패널을 열어
   * 둔 채 탭을 옮기거나 다른 줄을 고르는 경우는 그 문 밖이었다. 그때 화면은
   * 아이콘·이름·보유·합계가 전부 새 줄의 것으로 바뀌는데 빨간 줄만 앞 줄의 것이
   * 남아, 방금 고른 물건이 거절당한 것처럼 읽힌다.
   */
  clearTradeError: () => void
  openPendingShop: () => void
}

/** 가입인가 로그인인가. 화면 하나가 둘을 오가므로(설계 §5) 값으로 받는다. */
export type AuthMode = 'login' | 'register'

let actionSeq = 0
let milestoneSeq = 0
let utteranceSeq = 0
let noticeSeq = 0
let menuRequestSeq = 0

/** 서버와 말 자체를 못 한 경우에만 true. HTTP 4xx 는 서버가 살아있는 것이다. */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof ApiError && err.code === NETWORK_ERROR
}

/**
 * 국면 하나를 그 국면이 뜻하는 연결 상태와 **함께** 낸다.
 *
 * App.tsx 는 `connection` 만 보고 세계를 띄울지 정한다(그 파일은 불가침이다).
 * 두 값을 호출자마다 따로 적으면 언젠가 한쪽만 바뀌고, 그 한 번이 캐릭터도
 * 없는 상태에서 WorldScene 이 열리는 것이거나 게임 중에 게이트가 화면을
 * 덮는 것이 된다.
 *
 * **국면이 움직이면 열려 있던 패널도 함께 닫는다**(설계 §8-앞 9). 로그아웃·
 * 401·연결 게이트 이탈이 전부 이 함수를 지나므로 여기 한 곳이면 빠짐이 없다 —
 * 호출자마다 따로 적으면 언젠가 한 곳이 빼먹고, 그 한 번이 "재접속 후 새 hub
 * 는 안 잠겼는데 DOM 패널만 열려 있는" 화면이 된다(confirmingDelete 와 같은
 * 이유이지만, 그쪽은 여는 곳이 설정 탭 하나뿐이라 리셋도 그 옆에 둘 수 있었다).
 */
function gate(boot: BootPhase): {
  boot: BootPhase
  connection: Connection
  openPanel: null
  pendingShop: null
} {
  // 기다리던 상점도 함께 버린다 — 국면이 움직였다는 것은 그 대화가 있던 세계에서
  // 나왔다는 뜻이라, 남겨 두면 재접속 뒤 첫 대화가 끝나는 순간 엉뚱한 상점이 열린다.
  if (boot === 'playing') return { boot, connection: 'online', openPanel: null, pendingShop: null }
  if (boot === 'checking') {
    return { boot, connection: 'connecting', openPanel: null, pendingShop: null }
  }
  return { boot, connection: 'offline', openPanel: null, pendingShop: null }
}

/**
 * 게임 상태의 단일 소유자.
 * Phaser 씬과 React 컴포넌트 둘 다 이 스토어만 읽고 쓴다.
 * 어느 쪽도 플레이어 상태 사본을 따로 들고 있지 않다.
 */
export const useGameStore = create<GameStore>((set, get) => ({
  data: loadGameData(),
  player: null,
  connection: 'connecting',
  boot: 'checking',
  session: 'none',
  gateError: null,
  gateBusy: false,
  confirmingDelete: false,
  openPanel: null,
  pendingShop: null,
  craftTally: {},
  tradeError: null,
  tradeBusy: false,
  bagError: null,
  bagBusy: false,
  lastAction: null,
  milestone: null,
  utterance: null,
  notice: null,
  menuRequest: null,

  /**
   * 부팅 — 시계를 맞추고, 저장된 토큰이 아직 유효한지 서버에 한 번 묻는다.
   *
   * 세 갈래로 끝난다(설계 규범 12): 토큰이 없으면 타이틀, 있는데 거절당하면
   * 타이틀 + 만료 안내(401 관찰자가 옮긴다), 서버에 말 자체를 못 걸면 불통 화면.
   * "다시 시도" 도 이 함수를 부르므로 최초 부팅과 재시도가 같은 길을 탄다.
   */
  connect: async () => {
    set({ ...gate('checking'), gateError: null })

    // 시계가 먼저다. 세계 시각 없이 들어가면 행동 간격 판정이 로컬 시계로
    // 흘러가고, 그건 서버가 전부 거절하는 화면이 된다.
    if (!(await syncClock())) {
      set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
      return
    }

    if (!readToken()) {
      set({ ...gate('title'), session: 'none', player: null })
      return
    }

    try {
      const { character } = await GameClient.me()
      // **놀던 사람이 잠깐 끊겼다 돌아온 것이면 타이틀을 거치지 않는다.** 게임
      // 중의 통신 실패도 이 함수로 돌아오는데, 그때마다 타이틀을 보여주면
      // 지하철에서 한 칸 지날 때마다 게임 밖으로 튕겨 나간다.
      if (character && get().player) {
        set({ player: character, ...gate('playing'), session: 'ready', gateError: null })
        return
      }
      set({ ...gate('title'), session: 'ready', gateError: null })
    } catch (err) {
      // 401 이면 관찰자가 이미 타이틀로 옮겨 놓았다 — 여기서 덮으면 "만료됐다"가
      // "서버에 연결할 수 없다"로 바뀌어, 사람이 할 수 있는 일(다시 로그인)을
      // 할 수 없는 일(서버를 켜기)로 잘못 안내한다.
      if (get().boot !== 'checking') return
      set({ ...gate('unreachable'), gateError: describeServerError(err) })
    }
  },

  showAuth: () => set({ ...gate('auth'), gateError: null }),

  /** 로그인 화면에서 뒤로. 만료 안내는 이미 읽었으므로 지운다. */
  showTitle: () => set({ ...gate('title'), gateError: null }),

  /**
   * 가입 또는 로그인. 성공하면 토큰을 저장하고 곧바로 이어서 하기와 같은 길을 탄다.
   *
   * 가입 직후 로그인 화면으로 되돌리지 않는 것은 서버와 같은 결정이다
   * (routes/auth.ts) — 방금 적은 것을 다시 적게 할 이유가 없다.
   */
  authenticate: async (mode, username, password) => {
    await runGateStep(set, AUTH_MESSAGES, async () => {
      const { token } =
        mode === 'register'
          ? await GameClient.register(username, password)
          : await GameClient.login(username, password)
      writeToken(token)
      await loadCharacterOrCreate(set)
    })
  },

  /** 이어서 하기 — 토큰은 이미 유효하다고 확인됐다(connect). 캐릭터만 확인한다. */
  resume: async () => {
    await runGateStep(set, {}, () => loadCharacterOrCreate(set))
  },

  createCharacter: async (req) => {
    await runGateStep(set, CREATE_MESSAGES, async () => {
      const { player } = await GameClient.createCharacter(req)
      set({ player, ...gate('playing'), session: 'ready' })
    })
  },

  /**
   * 로그아웃 — 서버의 세션 행을 지우고 이 기기의 토큰도 버린다.
   *
   * 서버 쪽이 실패해도 토큰은 버린다. 남겨 두면 "로그아웃했는데 아직 로그인
   * 상태" 라는, 사용자가 고칠 방법이 없는 상태가 된다 — 죽지 않은 세션은
   * 만료로 저절로 닫히지만, 버리지 않은 토큰은 스스로 사라지지 않는다.
   */
  logout: async () => {
    set({ gateBusy: true, gateError: null })
    try {
      await GameClient.logout()
    } catch (err) {
      console.error(err)
    } finally {
      clearToken()
      set({
        ...gate('title'),
        session: 'none',
        player: null,
        confirmingDelete: false,
        gateBusy: false,
        gateError: null,
      })
    }
  },

  askDeleteCharacter: () => set({ confirmingDelete: true, gateError: null }),
  cancelDeleteCharacter: () => set({ confirmingDelete: false, gateError: null }),

  /**
   * 캐릭터를 지운다. **계정은 남는다** — 잘못 고른 외형·마을 때문에 계정까지
   * 버리게 하지 않는다(서버 routes/me.ts).
   */
  deleteCharacter: async (confirmName) => {
    await runGateStep(set, DELETE_MESSAGES, async () => {
      await GameClient.deleteCharacter(confirmName)
      set({
        ...gate('title'),
        session: 'ready',
        player: null,
        confirmingDelete: false,
      })
    })
  },

  gather: async (instanceId) => {
    try {
      const outcome: GatherOutcomeDto = await GameClient.gather(instanceId)
      applyPlayer(set, outcome.player)
      pushMilestones(set, outcome.achieved)

      if (outcome.success && outcome.gained) {
        // gained 의 필드명이 item → itemId 로 바뀌었다(서버 DTO 개조, G4) — 표가
        // 무엇을 골랐는지 이름으로 보여준다("얼음 결정 +1"). 확률표 자체는
        // 클라이언트에 없어도(§7-앞 9) 결과 하나의 이름 정도는 GameData 가 이미 안다.
        const name = labelOf(useGameStore.getState().data, outcome.gained.itemId)
        pushAction(
          set,
          `${name} +${outcome.gained.count}`,
          'good',
          outcome.gained.itemId,
          outcome.gained.count,
        )
      } else {
        // 실패해도 숙련은 무조건 오른다(설계 §7-앞 7) — "실패" 문구는 그대로 두고
        // 그 사실을 함께 싣는다. groupKey 를 이번 판정의 skillGained 값으로 가르는
        // 이유: FloatingTextGroup 의 실패 누적(×N, "실패는 몇 번인지가 정보다")은
        // 같은 숫자가 반복될 때만 뜻이 있다 — 값이 다른 실패를 한 글자에 묶으면
        // "숙련 +2" 라고 써 놓고 실제로는 +1 세 번이 섞인 경우를 감춘다.
        pushAction(set, `실패 · 숙련 +${outcome.skillGained}`, 'bad', `gather-fail-${outcome.skillGained}`, 1)
      }
    } catch (err) {
      // 행동 간격은 조용히 넘긴다. 아직 다음 행동 시각이 안 된 상태에서 누르는
      // 것은 실수가 아니라 정상적인 조작이라, 매번 알리면 연타할수록 화면이
      // 경고로 덮인다.
      if (err instanceof ApiError && err.code === 'too_fast') return
      // 서버와 끊겼으면 머리 위 글자로 알릴 게 아니라 게이트로 내보낸다.
      if (isNetworkFailure(err)) {
        set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
        return
      }
      // 조건이 안 맞는 노드다(설계 §3). too_fast 와 같이 **오류가 아니라 세계가
      // 제대로 돌아간 결과**라 console 로 흘리지 않지만, 저쪽과 달리 조용히
      // 넘기지도 않는다 — 간격은 몇 초 뒤 저절로 풀리는 것을 플레이어가 이미
      // 알지만, 닫힌 노드는 무엇이 있어야 열리는지 아무도 말해 주지 않는다.
      //
      // 문구가 앉는 자리는 **머리 위가 아니라 대사창(notice)** 이다 — 결계가 그
      // 자리를 고른 이유와 같다: 이 말은 "왜 못 캤는가"라서 읽힐 시간이 있어야
      // 한다. 그리고 그 창이 열리는 동안 세계 입력이 잠기므로(DialogueScene),
      // A 를 누른 채 있는 사람이 닫힌 노드에 요청을 쏟아붓는 일도 함께 막힌다.
      //
      // **거절이 지고 온 시각으로 문구를 짓는다** — describeBarrier 와 같은 이유다.
      if (err instanceof ApiError && err.code === 'node_closed') {
        const text = describeClosedNode(get(), instanceId, err.serverNowMs ?? worldNow())
        set({ notice: { seq: ++noticeSeq, text } })
        return
      }
      pushAction(set, describeError(err), 'bad')
      console.error(err)
    }
  },

  craft: async (recipeId) => {
    try {
      const outcome: CraftOutcomeDto = await GameClient.craft(recipeId)
      applyPlayer(set, outcome.player)
      pushMilestones(set, outcome.achieved)
      bumpCraftTally(set, recipeId, outcome.success)

      if (outcome.success && outcome.produced) {
        const name = labelOf(useGameStore.getState().data, outcome.produced.item)
        const suffix = outcome.autoEquipped ? ' · 자동 착용' : ''
        // 자동 착용이 붙으면 누적하지 않는다. 도구를 새로 낀 것은 수치로 뭉갤 사건이 아니다.
        const groupKey = outcome.autoEquipped ? null : outcome.produced.item
        pushAction(
          set,
          `${name} +${outcome.produced.count}${suffix}`,
          'good',
          groupKey,
          outcome.produced.count,
        )
      } else {
        pushAction(set, '제작 실패', 'bad', 'craft-fail', 1)
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'too_fast') return
      if (isNetworkFailure(err)) {
        set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
        return
      }
      pushAction(set, describeError(err), 'bad')
      console.error(err)
    }
  },

  /**
   * 말을 건다. 대화 한 번이 요청 한 번이고, 발화 전체가 한 번에 온다.
   *
   * 실패 중 **하나만** 플레이어에게 보인다. 없는 화자·할 말 없음은 데이터나
   * 콘텐츠의 구멍이라 보여 줄 말이 없지만, `not_here` 는 다르다 — 그건 세계가
   * 제대로 돌아간 결과이고(그 사람은 지금 실내에 있거나 길 위에 있다) 플레이어의
   * 조작도 옳았다. 아무 일도 안 일어나면 "여기 눌러도 되는 자리인가"부터
   * 의심하게 되므로, 그 자리에 짧은 안내를 띄운다(설계 §5).
   *
   * 그 밖의 실패에는 스토어가 아무것도 바꾸지 않는다 — 대사창은 열리지 않고
   * 플레이어 상태도 그대로다.
   */
  talk: async (speakerId) => {
    try {
      const outcome: TalkOutcomeDto = await GameClient.talk(speakerId)
      applyPlayer(set, outcome.player)
      // 상점은 여기서 열지 않는다 — 대사창이 이 발화를 받으며 패널을 전부 닫기
      // 때문이다(pendingShop 문서). 문은 대사가 끝난 뒤 열린다(설계 §6-앞 20).
      set({
        utterance: { seq: ++utteranceSeq, speaker: outcome.speaker, lines: outcome.lines },
        pendingShop: outcome.shop ?? null,
      })
      // 달인의 1회성 대금 — 새 채널을 만들지 않고 머리 위 피드백으로 말한다.
      // 대사창은 화면 아래쪽만 쓰므로 이 글자는 그 위에 그대로 보인다. 누적
      // (groupKey)은 없다: 평생 한 번뿐인 사건을 다음 것과 합칠 이유가 없다.
      if (outcome.reward) pushAction(set, `+${formatGold(outcome.reward.gold)}`, 'good')
    } catch (err) {
      // 서버와 끊겼으면 대사창이 아니라 게이트가 할 일이다 — 채집과 같다.
      if (isNetworkFailure(err)) {
        set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
        return
      }
      if (err instanceof ApiError && err.code === 'not_here') {
        set({ notice: { seq: ++noticeSeq, text: NOT_HERE_NOTICE } })
        return
      }
      console.error(err)
    }
  },

  /**
   * 전환 칸을 밟았다고 알린다. 도착지는 서버가 정해서 `player.location` 으로 온다.
   *
   * 채집·제작·대화와 달리 **실패를 삼키지 않고 다시 던진다.** 호출자(WorldScene)는
   * 성공했을 때에만 씬을 다시 시작해야 하는데, 여기서 삼키면 실패도 성공처럼
   * 보여서 서버가 거절한 전환에도 씬이 재시작된다 — 그러면 플레이어는 지금
   * 서 있던 칸이 아니라 **마지막 전환 도착 칸**으로 되돌아가 순간이동한 것처럼
   * 보인다. 대사창처럼 "아무것도 안 일어난다"로 끝낼 수 있는 실패가 아니다.
   *
   * **거절 중 하나는 말이 있다 — 결계다**(결계 설계 §5). 이 주석은 오래도록
   * "전환이 거절되는 경우는 클라이언트와 서버가 서로 다른 전환표를 보고 있을
   * 때뿐이라 보여 줄 말이 없다"고 적혀 있었고, 그때는 사실이었다. 결계 아크가
   * 그 문장을 거짓으로 만들었다: `locked` 는 **숫자를 올리면 열리는** 문이라
   * 화면이 요구치와 현재치를 말해야 한다. 남은 하나(`no_transition`)는 여전히
   * 표 불일치뿐이라 말이 없다.
   *
   * 문구는 화자가 없는 말이므로 대사창 자리(notice)로 간다 — 머리 위 글자는
   * 걸음과 함께 흘러가고, 이 말은 "왜 못 지나갔는가"라서 읽힐 시간이 있어야 한다.
   */
  move: async (x, y) => {
    try {
      const outcome: MoveOutcomeDto = await GameClient.move(x, y)
      applyPlayer(set, outcome.player)
    } catch (err) {
      // 서버와 끊겼으면 세계를 다시 그릴 게 아니라 게이트가 할 일이다 — 채집과 같다.
      if (isNetworkFailure(err)) set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
      else if (err instanceof ApiError && err.code === 'locked') {
        // 결계는 오류가 아니라 세계가 제대로 돌아간 결과다(채집의 too_fast 와
        // 같은 자세) — console 로 흘리지 않고 화면에 말로 남긴다.
        //
        // **거절이 지고 온 시각으로 문구를 짓는다.** 물때는 시각으로 갈리는
        // 조건이라, 왕복이 끝난 뒤 세계 시각을 다시 읽으면 서버가 잰 순간보다
        // 나중이 되어 **열리는 경계에서 답이 뒤집힌다**(describeBarrier 문서).
        // 헤더가 없는 것은 서버에 닿지도 못했을 때뿐이라 실제로는 오지 않지만,
        // 그때는 세계 시각으로 물러난다 — 시각이 없다고 말까지 없앨 수는 없다.
        const text = describeBarrier(get(), x, y, err.serverNowMs ?? worldNow())
        set({ notice: { seq: ++noticeSeq, text } })
      } else console.error(err)
      // **말을 세우고도 그대로 다시 던진다.** 삼키면 호출자(WorldScene)의 성공
      // 분기가 실패를 성공으로 읽어 씬을 재시작하고, 그때 스토어의 위치는 아직
      // 옛것이라 플레이어가 마지막 전환 도착 칸으로 순간이동한다.
      throw err
    }
  },

  /**
   * 착용 — 가방의 예비 도구 칩 [착용] 버튼이 부른다(설계 §6-앞 12).
   *
   * 채집·제작과 달리 too_fast 가 올 수 없다(서버가 행동 간격을 검사하지 않는다,
   * §6-앞 11) — 그래서 그 코드를 따로 거르지 않는다. 성공해도 머리 위 글자는
   * 띄우지 않는다: 결과는 슬롯 그림이 그 자리에서 즉시 말하고, 가방 패널이
   * 열려 있는 동안 세계 위 글자는 어차피 보이지도 않는다.
   */
  equip: async (instanceId) => {
    await bagAction(set, () => GameClient.equip(instanceId))
  },

  /** 강화 — 가방의 예비 도구 칩 [강화] 버튼이 부른다. equip 과 같은 자세(정리 행위, 실패만 알린다). */
  enhance: async (materialInstanceId) => {
    await bagAction(set, () => GameClient.enhance(materialInstanceId))
  },

  /**
   * 사용 — 가방의 재료 줄 [사용] 버튼이 부른다(설계 §6-앞 1~4).
   *
   * 착용·강화와 같은 길이다: 응답은 `{ player }` 하나뿐이고, 성공은 알리지
   * 않는다 — 줄어든 개수와 상단바에 뜬 남은 시간, 그리고 무엇보다 **바뀐
   * 하늘**이 그 자리에서 직접 말한다. 여기서 날씨를 따로 기억하지 않는 것이
   * 요점이다: 하늘의 유일한 출처는 `player.weather` 이고 만료는 저장된 타이머가
   * 아니라 시각 비교 하나라(shared 의 weatherView), 스토어가 들고 있을 상태가
   * 애초에 없다.
   */
  use: async (itemId) => {
    await bagAction(set, () => GameClient.use(itemId))
  },

  /**
   * 헌납 — 가방 재료 줄의 `[바치기]` 확인 버튼이 부른다(수집의 방 설계 §6-앞 1).
   *
   * 착용·강화·사용과 같은 왕복(bagAction)을 타는 이유는 **같은 패널의 같은
   * 종류의 실패**이기 때문이다: 거절은 가방 패널 안에서 말해야 하고(bagError),
   * 왕복이 도는 동안 버튼이 잠겨야 한다(bagBusy). 특히 여기서 두 번 누르는 것은
   * 가루보다 나쁘다 — 성공한 첫 요청이 스택을 비운 뒤 둘째가 나가면 거절이지만,
   * 남아 있으면 **두 배가 태워진다**. 돌이킬 수 없는 행위라 그 왕복 하나를
   * 막는 것이 문구보다 근본이다.
   *
   * 다른 셋과 달리 응답에 `achieved` 가 실린다(§6-앞 9) — 총점이 이정표 지표라
   * 이 헌납이 문턱을 넘겼으면 그 축하가 이번 응답에 있어야 한다. 그것을 채널에
   * 싣는 일은 bagAction 이 한다.
   */
  donate: async (itemId, count) => {
    await bagAction(set, () => GameClient.donate(itemId, count))
  },

  /**
   * 매도 — 상점 패널의 [팔기] 버튼이 부른다. 거래는 행동 간격을 쓰지 않으므로
   * (설계 §6-앞 18) too_fast 가 올 수 없다. 성공은 머리 위 글자로 알리지 않는다 —
   * 결과는 그 자리에서 골드와 스택 숫자가 직접 말하고, 패널이 화면을 덮고 있어
   * 어차피 안 보인다. **거절도 같은 이유로 머리 위에 띄우지 않는다**: 패널 안
   * 합계 줄 옆(tradeError)에 앉힌다. 가방 쪽(착용·강화·사용)이 나중에 같은
   * 결론에 도달해 자기 채널(bagError)을 얻었다 — 덮인 패널 뒤에서는 머리 위
   * 글자가 보이지 않는다는 사실이 상점만의 사정이 아니었다.
   */
  sell: async (shopId, itemId, count) => {
    await trade(set, get, () => GameClient.sell(shopId, itemId, count))
  },

  /** 매수 — [사기] 버튼이 부른다. 매도와 같은 길이고 같은 이유다. */
  buy: async (shopId, itemId, count) => {
    await trade(set, get, () => GameClient.buy(shopId, itemId, count))
  },

  // 톱니 클릭 자체는 게임 상태가 아니지만, App.tsx 를 건드리지 않고 React ->
  // Phaser 로 "메뉴를 열어라"를 전달할 통로가 이 스토어뿐이라 여기 둔다.
  // openPanel 을 'menu' 로 함께 덮는다 — 열려 있던 가방·제작(DOM) 패널은 그
  // 교체 한 번으로 닫힌다. 두 번째 입구의 계약은 "누르면 거기 도착한다"다.
  openMenu: (tab) => set({ menuRequest: { seq: ++menuRequestSeq, tab }, openPanel: 'menu' }),

  /**
   * 전면 패널 하나를 열거나(값) 전부 닫는다(null). 규칙은 OpenPanel 문서 참고.
   *
   * 같은 값이면 무시한다 — 이미 열린 제작 패널에 '열기'가 또 왔을 때 아래
   * tally 리셋이 진행 중인 누적을 지우면 안 된다. 다른 값이면 교체 한 번이
   * 곧 상호배제다.
   */
  setOpenPanel: (panel) => {
    if (panel === get().openPanel) return
    // 거절 문구는 그 패널 그 순간의 것이다 — 남겨 두면 패널을 닫았다 다시
    // 연 사람이 아무것도 안 했는데 실패한 화면을 본다. craftTally 가 제작
    // 패널을 열 때 0 에서 시작하는 것과 같은 이유이고, 여기 한 곳이면 빠짐이 없다.
    // 가방(bagError)과 상점(tradeError)을 함께 지우는 이유: 지우는 자리가 패널이
    // 바뀌는 이 한 곳이라, 채널마다 따로 두면 언젠가 한쪽이 빠진다.
    set({ tradeError: null, bagError: null })
    // 제작 패널이 열리는 순간 누적 카운터를 0 에서 시작한다(설계 §8-앞 3) —
    // 이 숫자는 "이번에 열어 둔 동안"의 성적이다.
    if (panel === 'craft') set({ openPanel: panel, craftTally: {} })
    else set({ openPanel: panel })
  },

  /** 위 setOpenPanel 이 지키지 못하는 자리 — 패널은 그대로인데 안에서 선택만 옮겨질 때. */
  clearTradeError: () => set({ tradeError: null }),

  /**
   * 대사가 끝났다 — 기다리던 상점이 있으면 지금 연다(설계 §6-앞 20).
   *
   * 부르는 곳은 DialogueScene 의 render() 하나다: 대사창이 열림→닫힘으로
   * 바뀌는 그 순간이 유일하게 "말이 끝났다"를 아는 자리다. 기다리는 상점이
   * 없으면 아무 일도 없다 — 대사창은 상점과 무관한 말에도 매번 닫힌다.
   */
  openPendingShop: () => {
    const shopId = get().pendingShop
    if (shopId === null) return
    set({ pendingShop: null })
    get().setOpenPanel(shopPanelKey(shopId))
  },
}))

type SetFn = (partial: Partial<GameStore>) => void

/**
 * **세션이 죽었다.** GameClient.request() 가 401 을 보면 여기로 온다.
 *
 * 토큰은 이미 버려졌다(그 파일). 여기서 하는 일은 화면을 옮기는 것뿐이다 —
 * 그리고 그 화면은 "토큰이 없는" 타이틀과 달라야 한다: 방금까지 로그인된
 * 상태였던 사람에게 아무 설명 없이 시작 화면을 내밀면, 자기 진행도가 사라진
 * 줄 안다.
 */
setUnauthorizedObserver(() => {
  useGameStore.setState({
    ...gate('title'),
    session: 'rejected',
    player: null,
    confirmingDelete: false,
    gateBusy: false,
    gateError: '로그인이 만료되었습니다. 다시 로그인해 주세요.',
  })
})

/** 가입·로그인 화면에서만 뜻이 달라지는 코드들. 나머지는 공통표가 답한다. */
const AUTH_MESSAGES: MessageOverrides = {
  bad_request: '아이디는 3~16자의 영문·숫자·한글, 비밀번호는 8자 이상이어야 합니다.',
}

const CREATE_MESSAGES: MessageOverrides = {
  bad_request: '이름은 2~12자여야 하고, 외형과 마을을 골라야 합니다.',
}

const DELETE_MESSAGES: MessageOverrides = {
  bad_request: '캐릭터 이름을 적어 주세요.',
}

/**
 * 게임 앞 화면에서 일어나는 서버 왕복 하나를 감싼다.
 *
 * 세 가지를 매번 같은 순서로 한다: 이전 실패를 지우고, 버튼을 잠그고, 실패는
 * 한 줄로 옮겨 담는다. 화면마다 이 셋을 적으면 언젠가 한 화면이 잠금을
 * 빼먹고, 그 화면은 버튼을 두 번 누르면 요청이 두 번 나간다.
 */
async function runGateStep(
  set: SetFn,
  messages: MessageOverrides,
  step: () => Promise<void>,
): Promise<void> {
  set({ gateBusy: true, gateError: null })
  try {
    await step()
  } catch (err) {
    set({ gateError: describeServerError(err, messages) })
    console.error(err)
  } finally {
    set({ gateBusy: false })
  }
}

/**
 * 로그인이 끝난 뒤의 갈림길 — 캐릭터가 있으면 들어가고, 없으면 만들러 간다.
 *
 * 가입·로그인·이어서 하기 셋이 같은 이 길을 탄다. 갈라 두면 "가입 직후에만
 * 캐릭터 생성으로 간다" 같은 규칙이 생기고, 그러면 캐릭터를 지운 사람이
 * 로그인해서 갈 곳이 없어진다.
 */
async function loadCharacterOrCreate(set: SetFn): Promise<void> {
  const { character } = await GameClient.me()
  if (character) {
    set({ player: character, ...gate('playing'), session: 'ready' })
    return
  }
  set({ ...gate('creating'), session: 'ready', player: null })
}

function pushAction(
  set: SetFn,
  text: string,
  tone: ActionFeedback['tone'],
  groupKey: string | null = null,
  amount = 1,
): void {
  set({ lastAction: { seq: ++actionSeq, text, tone, groupKey, amount } })
}

function applyPlayer(set: SetFn, next: PlayerState): void {
  set({ player: next })
}

/**
 * 가방 패널 안에서 누른 버튼 하나의 왕복(착용·강화·사용·헌납 공통).
 *
 * 넷 다 응답에 `player` 가 실려 적용은 한 줄이고, **거절을 말하는 자리**가
 * 넷이 같아서 함수 하나로 묶인다: 이 조작들은 가방 패널이 화면을 덮은 상태에서만
 * 일어나므로 머리 위 글자로 보내면 패널 뒤에서 뜨고 사라진다(bagError 문서).
 * trade() 가 상점에서 하는 일과 같은 모양이고 같은 이유다.
 *
 * 성공을 알리지 않는 것도 넷이 같다 — 슬롯 그림, 강화 +N, 줄어든 개수와 바뀐
 * 하늘, 그리고 방의 채워진 칸이 그 자리에서 직접 말한다. 행동 간격(too_fast)은
 * 넷 다 올 수 없다: 정리와 사용은 행동이 아니다(설계 §6-앞 11, 서버 useService·
 * donateService).
 *
 * **이정표는 실린 것만 나른다**(수집의 방 §6-앞 9). 헌납만 `achieved` 를 갖는
 * 이유는 헌납만 지표(총점)를 밀어 올리기 때문이고, 없는 것을 빈 배열로 지어내지
 * 않는 것은 이 저장소가 사실 공급자에게 요구해 온 자세와 같다.
 *
 * 왕복 동안 `bagBusy` 를 켜 두 번째 요청 자체를 막는다 — trade() 가 tradeBusy 로
 * 하는 그 일이고, 근본 교정인 것도 같다. 마지막 한 개를 두 번 빠르게 누르면
 * 둘째는 이미 없어진 것을 다시 쓰려 해 반드시 거절되는데, 버튼이 잠겨 있으면
 * 그 거절이 애초에 생기지 않는다. 가루는 특히 그렇다: 누른 뒤 응답이 오기
 * 전까지 화면에 아무 변화가 없어서, 안 먹혔다고 여긴 사람이 한 번 더 누른다.
 */
async function bagAction(
  set: SetFn,
  send: () => Promise<{ player: PlayerState; achieved?: readonly MilestoneDef[] }>,
): Promise<void> {
  set({ bagBusy: true, bagError: null })
  try {
    const { player, achieved } = await send()
    applyPlayer(set, player)
    if (achieved) pushMilestones(set, achieved)
  } catch (err) {
    if (isNetworkFailure(err)) {
      set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
      return
    }
    set({ bagError: describeError(err) })
    console.error(err)
  } finally {
    // finally 인 것이 요점이다 — 거절로 끝난 왕복이 잠금을 켜 둔 채 돌아오면
    // 가방의 세 버튼이 영영 잠겨, 패널을 닫았다 열기 전에는 아무것도 못 한다.
    set({ bagBusy: false })
  }
}

/**
 * 거래 왕복 하나(매도·매수 공통) — 응답은 `{ player }` 하나뿐이라 적용도 하나다.
 *
 * 두 액션이 이 함수를 나눠 쓰는 이유는 **자리를 뜬 화자** 때문이다(설계 §6-앞 4):
 * 상점 넷 중 셋은 화자의 일과에 실내 지점이 있어 밤이면 `not_here` 가 된다.
 * 그건 버그가 아니라 세계가 살아 있다는 증거이고, 그때 화면이 할 일은 패널을
 * 닫고 **대화와 똑같은 안내**를 띄우는 것 하나다 — 두 액션이 각자 적으면
 * 언젠가 한쪽만 고쳐져서 "팔리지도 않고 닫히지도 않는" 패널이 남는다.
 *
 * 나머지 거절은 **패널 안에서** 말한다(`tradeError`). 거래는 상점 패널이 화면을
 * 덮은 상태에서만 일어나므로 머리 위 글자로 보내면 그 문구는 패널 뒤에서
 * 뜨고 사라진다 — 이 파일이 매도 성공을 아예 안 알리는 것과 정확히 같은 사정이다.
 *
 * 왕복 동안 `tradeBusy` 를 켜 두 번째 요청 자체를 막는다. 이것이 근본 교정이다:
 * 보유량 전부로 두 번 빠르게 누르면 둘째는 이미 비워진 스택을 다시 팔려 해
 * 반드시 거절되는데, 버튼이 잠겨 있으면 그 거절이 애초에 생기지 않는다.
 */
async function trade(
  set: SetFn,
  get: () => GameStore,
  send: () => Promise<{ player: PlayerState }>,
): Promise<void> {
  set({ tradeBusy: true, tradeError: null })
  try {
    const { player } = await send()
    applyPlayer(set, player)
  } catch (err) {
    if (isNetworkFailure(err)) {
      set({ ...gate('unreachable'), gateError: SERVER_UNREACHABLE })
      return
    }
    if (err instanceof ApiError && err.code === 'not_here') {
      get().setOpenPanel(null)
      set({ notice: { seq: ++noticeSeq, text: NOT_HERE_NOTICE } })
      return
    }
    set({ tradeError: describeError(err) })
    console.error(err)
  } finally {
    set({ tradeBusy: false })
  }
}

/**
 * 제작 결과 하나를 누적 카운터에 더한다(설계 §8-앞 3·5).
 *
 * craft 액션이 여기까지 책임지는 이유: 현행 craft 는 `Promise<void>` 라 결과를
 * 삼키는데, 반환값을 바꾸는 대신 스토어가 스스로 tally 를 갱신하면 카드(React)는
 * 구독만 하면 된다. 성공 여부는 서버 응답의 `outcome.success` 그대로다 —
 * 거부(too_fast 등)와 통신 실패는 여기 오지 않으므로 세지 않는다.
 */
function bumpCraftTally(set: SetFn, recipeId: string, success: boolean): void {
  const tally = useGameStore.getState().craftTally
  const prev = tally[recipeId] ?? { success: 0, fail: 0 }
  set({
    craftTally: {
      ...tally,
      [recipeId]: success
        ? { success: prev.success + 1, fail: prev.fail }
        : { success: prev.success, fail: prev.fail + 1 },
    },
  })
}

/**
 * 서버가 이번 행동에서 새로 달성됐다고 알린 이정표 중, 화면에 알릴 것만 채널에 싣는다.
 *
 * `announce` 가 빈 문자열인 이정표는 달성으로는 세지만(서버가 이미 celebrated 에
 * 넣었다) 화면에는 띄우지 않는다 — 같은 문턱을 여러 기술이 동시에 넘을 때 전부
 * 띄우면 화면이 묻힌다.
 *
 * 여러 개가 한 번에 오면 각각 다른 seq 로 순서대로 싣는다. 겹쳐 보이지 않게
 * 줄 세워 하나씩 보여주는 일은 구독자(WorldScene)가 큐를 들고 한다 — 여기서는
 * "무엇을, 몇 번째로" 만 정한다.
 */
function pushMilestones(set: SetFn, achieved: readonly MilestoneDef[]): void {
  for (const m of achieved) {
    if (m.announce === '') continue
    set({ milestone: { seq: ++milestoneSeq, text: m.announce } })
  }
}

function labelOf(data: GameData, itemId: string): string {
  return data.items[itemId]?.name ?? itemId
}

/** 이 저장소가 숫자를 적는 방식. 상단 바·가방·제작·상점이 전부 이 글자꼴이다. */
function fmt(n: number): string {
  return n.toLocaleString('ko-KR')
}

/** 시각을 두 자리로 — 안내판이 새긴 "02시" 와 화면이 적는 글자가 같아야 한다. */
function hourText(hour: number): string {
  return `${String(hour).padStart(2, '0')}시`
}

/**
 * 그 낱말에 주격 조사를 붙인다 — 눈**이**, 비**가**.
 *
 * **왜 손으로 안 적는가:** 이 저장소는 조사가 변하는 낱말에 직접 닿지 않게 하는
 * 규율이 있다(validate.ts·content-cli.ts 는 한국어 명사를 사이에 끼워 피한다).
 * 여기서는 피할 자리가 없다 — 문장의 주어가 곧 그 하늘의 이름이다. 그래서
 * 규칙 쪽을 코드로 옮긴다: 받침이 있으면 "이", 없으면 "가". 날씨가 하나
 * 늘어나는 날(`WEATHER_KINDS`) 그 이름이 무엇이든 이 줄은 맞는 문장을 만든다.
 *
 * 한글 음절이 아니면 손대지 않는다 — 지어낼 규칙이 없고, 조사 없이 남는 편이
 * 틀린 조사가 붙는 것보다 낫다.
 */
function subject(word: string): string {
  const last = word.codePointAt(word.length - 1)
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return word
  return `${word}${(last - 0xac00) % 28 === 0 ? '가' : '이'}`
}

/**
 * 결계가 밀어냈다 — 그 문이 요구하는 것과 지금 손에 있는 것을 한 줄로 적는다.
 *
 * > 결계가 밀어낸다 — 광물 숙련 85,000 (지금 63,240)
 * > 결계가 밀어낸다 — 물이 빠질 때만 열린다 (02시~08시 · 14시~20시, 지금 11시)
 *
 * **부등호를 다시 적지 않는다**(결계 설계 §9-앞 13). 서버가 이미 `locked` 로
 * 판정했고, 여기서 필요한 것은 그 판정을 다시 짓는 일이 아니라 판정이 본 숫자를
 * 그대로 읽는 일이다 — 그래서 서버(moveService)와 같은 shared 술어를 부르고
 * 돌려받은 숫자만 쓴다. 화면이 자기 비교를 한 줄 더 적는 순간, 서버가 거절한
 * 문 앞에서 화면만 "열려 있다"고 말하는 날이 온다. 시각도 같은 이유로 술어가
 * 돌려준 `hour` 를 쓴다 — 여기서 시계를 한 번 더 읽으면 판정이 본 시각과 화면이
 * 적은 시각이 갈라진다.
 *
 * **막힌 이유를 갈라 말한다**(§6 — 허브 결계는 조건 둘을 진다). 숙련은 캐면
 * 열리는 문이고 물때는 기다리면 열리는 문이라, 플레이어가 할 일이 전혀 다르다.
 * 둘 다 막혔으면 **숙련을 먼저** 말한다: 물때부터 말하면 숙련 1,000 인 사람이
 * 여섯 시간을 기다렸다가 같은 자리에서 또 막힌다.
 *
 * **프로토콜은 그대로다.** 스토어가 `loadGameData()` 를 직접 갖고 있어
 * `TransitionDef` 의 게이트가 이미 손에 있으므로, 서버는 코드 하나만 보낸다.
 *
 * 계열 이름은 `SKILL_LABELS` 다 — 가방 슬롯·상점 잠금·도감이 쓰는 그 글자다.
 * 한 숫자가 화면마다 다른 이름을 달면 그것이 같은 문인지 알 수 없다.
 *
 * **판정이 본 시각을 그대로 받는다**(`judgedAtMs` — 응답 헤더 `x-server-now`).
 * 여기서 `worldNow()` 를 읽던 시절에는 **열리는 경계에서 화면이 침묵했다**:
 * 세계 시각은 왕복 지연과 기울임(최대 2초)만큼 서버보다 늘 나중이라, 서버가
 * 01:59 로 재 거절한 요청을 화면은 02:00 으로 읽어 "물이 빠져 있다"고 판단했고,
 * 그러면 아래 두 분기가 다 비껴가 아무 말도 안 남았다. 닫히는 경계(08·20시)
 * 에서는 늦음이 답을 안 바꾸지만 **열리는 경계(02·14시)에서는 뒤집는다** —
 * 그리고 그 창을 밟는 사람이 바로 물때를 기다리다 열리는 순간 문을 두드리는
 * 사람이다.
 *
 * **그래서 이 함수는 `null` 을 돌려주지 않는다.** 숫자를 못 지어도 한 줄은
 * 남긴다: 몸이 되밀렸는데 화면이 침묵하는 것이 가장 나쁘다 — 플레이어가 보는
 * 것은 "칸을 밟았는데 아무 일도 안 일어났다"뿐이고, 그건 고장과 구별되지
 * 않는다. 숫자 없는 줄이 나올 수 있는 경우는 둘뿐이고 둘 다 우리 쪽 어긋남이다:
 * 클라와 서버의 전환표가 갈라졌거나(그 칸에 게이트가 없다), 헤더가 없어 시각을
 * 세계 시각으로 물러나 재다가 위의 찰나를 다시 밟았거나. `locked` 는 서버가
 * 결계에만 쓰는 코드이므로(moveService), 이유를 못 대도 "결계가 밀어낸다"는
 * 그 자체로 참이다.
 */
function describeBarrier(
  store: GameStore,
  x: number,
  y: number,
  judgedAtMs: number,
): string {
  const pushed = '결계가 밀어낸다'
  const { data, player } = store
  if (!player) return pushed

  const transition = data.transitions.find(
    (t) => t.fromMap === player.location.mapId && t.fromX === x && t.fromY === y,
  )
  const gate = transition ? transitionGate(transition, player, judgedAtMs) : null
  if (!gate) return pushed

  if (gate.skill && !gate.skill.open) {
    const { skill, need, have } = gate.skill
    return `${pushed} — ${SKILL_LABELS[skill]} 숙련 ${fmt(need)} (지금 ${fmt(have)})`
  }
  if (gate.tide && !gate.tide.open) {
    const windows = gate.tide.windows
      .map((w) => `${hourText(w.start)}~${hourText(w.end)}`)
      .join(' · ')
    return `${pushed} — 물이 빠질 때만 열린다 (${windows}, 지금 ${hourText(gate.tide.hour)})`
  }
  return pushed
}

/**
 * 그 노드가 지금 안 열린다 — 무엇이 있어야 열리는지를 한 줄로 적는다(설계 §9-1).
 *
 * > 눈이 올 때만 캘 수 있다
 * > 눈이 올 때만 캘 수 있다 (지금 비)
 * > 물이 빠질 때만 캘 수 있다 (02시~08시 · 14시~20시, 지금 11시)
 * > 밤에만 캘 수 있다 (21시~24시 · 00시~04시, 지금 12시)
 *
 * **결계 문구(describeBarrier)와 같은 문법이고 같은 규율이다.** 조건 비교를 여기서
 * 다시 짓지 않고 서버와 **같은 술어**(nodeAvailable)를 불러 돌려받은 값만 읽는다 —
 * 화면이 자기 비교를 한 줄 더 적는 순간, 서버가 거절한 노드 앞에서 화면만
 * "열려 있다"고 말하는 날이 온다. 시각도 술어가 돌려준 `hour` 를 쓴다.
 *
 * **문구가 "밀어낸다"가 아닌 이유:** 이 사람은 밀려나지 않았다. 노드 앞에 그대로
 * 서 있고, 다만 지금 캘 수 없을 뿐이다 — 결계는 몸을 되미는 일이라 그 말이 참이지만
 * 여기서 같은 말을 쓰면 화면이 일어나지 않은 일을 적는 것이 된다.
 *
 * **막힌 이유를 갈라 말하고, 둘 다 막혔으면 날씨를 먼저 말한다.** 결계가 물때보다
 * 숙련을 먼저 말하는 그 저울이다: 시각은 기다리는 것 말고 할 수 있는 일이 없지만
 * 날씨는 **가루로 부른다**(§3 — 이 아크가 얼음 가루에 처음으로 채집용 쓸모를
 * 준다). 물때부터 말하면 여섯 시간을 기다린 사람이 같은 자리에서 눈이 없어 또 막힌다.
 *
 * **아무것도 안 내릴 때 "지금 맑음"을 적지 않는다.** 하늘에는 'clear' 가 없고
 * (weather.ts 가 자리표시를 거부한다) 화면이 낱말을 지어내면 안 된다 — 이름이
 * 있는 하늘이 걸려 있을 때만 괄호가 선다. 그때는 적어 줘야 한다: 비 가루를 방금
 * 쓴 사람이 왜 안 열리는지를 그 괄호가 말한다.
 *
 * **판정이 본 시각을 그대로 받는다**(`judgedAtMs` — 응답 헤더 `x-server-now`).
 * 이유는 describeBarrier 문서에 있다: 세계 시각은 서버보다 늘 나중이라 **열리는
 * 경계**(02·14·21시)에서 답이 뒤집히고, 그 창을 밟는 사람이 바로 물때를 기다리다
 * 열리는 순간 A 를 누르는 사람이다.
 *
 * **`null` 을 돌려주지 않는 것도 같다.** A 를 눌렀는데 화면이 침묵하면 플레이어가
 * 보는 것은 "아무 일도 안 일어났다"뿐이고 그건 고장과 구별되지 않는다.
 * `node_closed` 는 서버가 조건에만 쓰는 코드이므로(gatherService), 이유를 못 대도
 * "지금은 캘 수 없다"는 그 자체로 참이다.
 */
function describeClosedNode(
  store: GameStore,
  instanceId: string,
  judgedAtMs: number,
): string {
  const closed = '지금은 캘 수 없다'
  const { data, player } = store
  if (!player) return closed

  const placement = Object.hasOwn(data.placements, instanceId) ? data.placements[instanceId] : undefined
  const node = placement ? data.nodes[placement.nodeId] : undefined
  const gate = node ? nodeAvailable(node, player.weather, judgedAtMs) : null
  if (!gate) return closed

  if (gate.weather && !gate.weather.open) {
    const { need, now } = gate.weather
    const sky = now === undefined ? '' : ` (지금 ${WEATHER_LABELS[now]})`
    return `${subject(WEATHER_LABELS[need])} 올 때만 캘 수 있다${sky}`
  }
  if (gate.time && !gate.time.open) {
    const windows = gate.time.windows.map((w) => `${hourText(w.start)}~${hourText(w.end)}`).join(' · ')
    // 조건 이름마다 다른 말이 붙는다 — "밤에만"과 "물이 빠질 때만"은 세계의 서로
    // 다른 사실이고, 뭉치면("조건이 맞을 때만") 화면이 아무것도 말하지 않은 것이 된다.
    const when = gate.time.need === 'night' ? '밤에만' : '물이 빠질 때만'
    return `${when} 캘 수 있다 (${windows}, 지금 ${hourText(gate.time.hour)})`
  }
  return closed
}

function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return '서버에 연결할 수 없습니다'
  // cannot_gather 문구('도구나 숙련도 부족')는 은퇴했다 — 맨손 채집이 허용되면서
  // (도구 루프 설계 §2) 서버가 그 코드를 더는 보내지 않는다.
  switch (err.code) {
    case 'level_too_low':
      return '숙련도 부족'
    case 'missing_materials':
      return '재료 부족'
    case 'too_fast':
      return '너무 빠릅니다'
    // 아래 다섯은 착용·강화(equip·enhance) 전용 코드다(설계 §6-앞 11). 가방의
    // 버튼 조건(같은 itemId 착용 중일 때만 강화 노출 등)이 대부분 막지만,
    // 여러 탭·경합 요청은 화면이 못 막으므로 서버 거절도 말이 있어야 한다.
    // 이 문구들이 앉는 자리는 가방 패널 안이다(bagError) — 머리 위가 아니다.
    case 'unknown_instance':
      return '존재하지 않는 도구'
    case 'not_a_tool':
      return '도구가 아니다'
    case 'material_equipped':
      return '착용 중인 도구는 재료가 될 수 없다'
    case 'no_target':
      return '강화할 착용 도구가 없다'
    case 'enhance_cap':
      return '더 강화할 수 없다'
    // 강화가 원재료·골드를 먹게 되면서 생긴 코드다(§6-앞 11). 가방이 요구를
    // 숫자로 적고 못 채우면 버튼 자체를 안 그리며, 왕복이 도는 동안에는 버튼이
    // 잠기므로(bagBusy) 정상 조작으로는 오지 않는다 — 두 창에서 같은 재료를
    // 동시에 쓰는 경합처럼 화면이 막을 수 없는 경우에만 온다.
    // `not_enough_gold` 는 아래 거래 코드와 같은 글자를 쓴다 — 골드가 모자란 것은
    // 상점에서든 강화에서든 같은 사실이고, 문구가 갈라지면 그게 더 이상하다.
    case 'missing_enhance_materials':
      return '강화 재료가 모자란다'
    // 사용(use) 전용. 가방은 `useEffect` 가 있는 재료에만 [사용] 을 그리고,
    // 한 창 안에서 두 번 빠르게 누르는 것은 왕복 잠금(bagBusy)이 막는다 —
    // 그래서 마지막 한 개가 missing_items 로 돌아오는 것은 **두 창**을 동시에
    // 연 경합뿐이다. 화면이 막을 수 없는 그 경우에 조용하면 안 된다.
    case 'not_usable':
      return '쓸 수 없는 물건'
    // 헌납(donate) 전용(수집의 방 설계 §6-앞 1). `unknown_item`·`missing_items`
    // 는 아래 거래 블록의 문구를 그대로 같이 쓴다 — 없는 물건·모자란 물건은
    // 상점이든 방이든 같은 사실이다. 이 코드만 따로 두는 이유는 **지금은 화면이
    // 절대 못 보내는** 요청이기 때문이다: 가방은 data.collection 에 칸이 있는
    // 재료에만 [바치기] 를 그린다(BagPanel). 그래도 넣는 것은 not_usable 이 이미
    // 세운 자세와 대칭을 맞추기 위해서다 — 저 코드도 화면이 못 막는 경합(두 창)
    // 에만 오는데 문구가 있다. 여기는 경합보다 더 흔한 문이 하나 더 있다:
    // collection.csv 에서 칸 하나를 빼고 배포한 직후, 그 탭을 이미 열어 둔
    // 사람의 화면에는 옛 [바치기] 버튼이 그대로 남아 있어 이 코드가 온다.
    // 문구가 없으면 `오류: not_collectable` 이라는 날것이 그대로 뜬다.
    case 'not_collectable':
      return '바칠 수 없는 물건'
    // 아래는 거래(sell·buy) 전용 코드다(설계 §6-앞 18). 상점 패널이 잠긴 칸·
    // 보유 증표·모자란 골드를 미리 걸러 버튼을 잠그고, 왕복 동안에는 버튼
    // 자체가 잠기므로(tradeBusy) 정상 조작으로는 거의 오지 않는다 — 두 창을
    // 동시에 열어 같은 스택을 파는 경합처럼, 화면이 막을 수 없는 경우에만 온다.
    // 그래도 말이 없으면 화면이 조용히 아무 일도 안 한 것처럼 보이므로 문구가
    // 있어야 한다. **그 문구는 머리 위가 아니라 상점 패널 안에 앉는다**
    // (trade() 가 tradeError 에 싣는다) — 거래는 패널이 화면을 덮은 상태에서만
    // 일어나므로 캔버스 플로터로 보내면 패널 뒤에서 뜨고 사라져 아무도 못 본다.
    // `not_here` 는 여기 없다 — 그건 문구가 아니라 패널을 닫는 사건이라
    // trade() 가 대화와 같은 안내로 따로 다룬다.
    case 'unknown_shop':
      return '없는 상점'
    case 'shop_locked':
      return '아직 열리지 않은 상점'
    case 'wrong_map':
      return '여기서는 안 된다'
    case 'unknown_item':
      return '없는 물건'
    case 'not_sellable':
      return '이 상점이 사지 않는 물건'
    case 'missing_items':
      return '물건이 모자란다'
    case 'item_locked':
      return '아직 살 수 없는 물건'
    case 'not_enough_gold':
      return '골드 부족'
    case 'already_owned':
      return '이미 가지고 있다'
    default:
      return `오류: ${err.code}`
  }
}

// ---- 셀렉터 ----
// 서버와 같은 공식을 써서 예상치를 계산한다. 별도 구현이 아니다.

export function selectToolTier(skill: SkillId): number {
  const { player, data } = useGameStore.getState()
  return player ? equippedToolTier(player, data, skill) : 0
}

// selectGatherChance 는 은퇴했다(설계 §7-앞 2, 소비자 0) — 채집은 더 이상 단일
// 성공률이 아니라 표의 분포이고, 그 표는 클라이언트에 없다(§7-앞 9). 예상치를
// 그릴 재료 자체가 없는 것이 의도다.

export function selectCraftChance(recipeId: string): number {
  const { player, data } = useGameStore.getState()
  const recipe = data.recipes[recipeId]
  if (!player || !recipe) return 0
  // 판정에 넘기는 값 한 벌은 카드 모델의 toCraftContext 하나에서 나온다 — 여기
  // 사본을 두면 문턱이 하나 더 생길 때마다(§6-앞 9 의 계열 숙련이 그랬다) 한쪽만
  // 고쳐져 같은 레시피의 성공률이 패널과 셀렉터에서 갈라진다.
  return calcCraftSuccess(toCraftContext(data, player, recipe))
}
