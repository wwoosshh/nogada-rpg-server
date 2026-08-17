import type {
  AuthTokenResponse,
  CreateCharacterRequest,
  MeResponse,
  MilestoneDef,
  PlayerState,
  RecipeInput,
} from '@nogada/shared'
import { resolveApiBase } from './apiBase.js'
import { clearToken, readToken } from './sessionToken.js'

/**
 * 서버 주소는 이 변수 하나로만 결정된다.
 * 개발은 localhost, 실기는 PC 의 LAN IP, 운영은 **빈 문자열**(같은 오리진) —
 * 코드는 그대로다. 규칙 자체는 apiBase.ts 가 갖는다: 빈 문자열을 폴백시키지
 * 않는 것이 공개 배포의 전제라, 그 한 줄에는 따로 자가 필요하다.
 */
const BASE = resolveApiBase(import.meta.env.VITE_API_BASE_URL)

export interface GatherOutcomeDto {
  success: boolean
  // chance 는 은퇴했다(설계 §7-앞 2, 채집 gathering-tiers G4) — 채집은 성공률이
  // 아니라 표 기반 티어 판정이라 미리 보여줄 확률 자체가 없다(§7-앞 9).
  /** 성공 시 뽑힌 아이템 1개. 수량은 항상 1 이다. */
  gained: { itemId: string; count: 1 } | null
  skillGained: number
  /**
   * 이번 행동으로 새로 달성된 이정표. **실패한 채집도 여기 찰 수 있다** — 숙련
   * 증가가 성패 무관 무조건이라(설계 §7-앞 7), 실패한 손질이 문턱을 넘기면
   * achieved 가 찬다. 거부(요청 자체가 실패한) 경로에서만 이 필드가 없다.
   */
  achieved: MilestoneDef[]
  player: PlayerState
}

export interface CraftOutcomeDto {
  success: boolean
  chance: number
  produced: RecipeInput | null
  consumed: RecipeInput[]
  skillGained: number
  autoEquipped: boolean
  /** 이번 행동으로 새로 달성된 이정표. 실패·거부 경로에서는 항상 빈 배열이다. */
  achieved: MilestoneDef[]
  player: PlayerState
}

/**
 * 대화 한 번의 결과.
 *
 * `lines` 는 발화 **전체**다 — 대사창이 순서대로 넘길 칸들이고, 칸마다 서버에
 * 다시 묻지 않는다(설계 문서 4.5).
 */
export interface TalkOutcomeDto {
  speaker: string
  lines: string[]
  /**
   * 이 대화가 여는 상점 id — **문이 실제로 열릴 때만** 실려 온다.
   *
   * 이긴 대사 규칙과 무관하게 서버가 등록부(`shops.csv`)와 상태로 판정한 것이다
   * (설계 §6-앞 1). 클라이언트가 다시 판정하지 않는다: 이 값이 있으면 대사가
   * 끝난 뒤 그 상점을 연다(§6-앞 20 — 스토어의 pendingShop).
   */
  shop?: string
  /**
   * 이 대화가 여는 여관의 화자 id — `shop` 의 쌍둥이다(아크 D §2). 이 값이
   * 있으면 대사가 끝난 뒤 여관 패널이 열린다(스토어의 pendingInn). 상점과
   * 달리 문턱이 없어, 여관 화자와의 대화에는 언제나 실려 온다.
   */
  inn?: string
  /**
   * 이번 대화에서 받은 달인의 1회성 대금. 두 번째 대화에는 실리지 않는다.
   *
   * 금액이 함께 오는 이유는 화면이 "+1,000,000 G" 를 말해야 하기 때문이다 —
   * 골드 총액만 오면 클라이언트가 차이를 계산해야 하고, 그 계산은 같은 응답에
   * 매도 대금이 섞이는 날 조용히 틀린다.
   */
  reward?: { id: string; gold: number }
  player: PlayerState
}

/**
 * 헌납 한 번의 결과 — 플레이어와 **이번에 새로 달성된 이정표**.
 *
 * 착용·강화·사용·거래가 `{ player }` 하나인데 여기만 다른 이유(수집의 방 §6-앞 9):
 * 헌납은 `donated` 를 늘려 방의 총점을 밀어 올리고, 그 총점이 이정표 지표
 * (`metricKind='collection'`)라 이번 헌납이 문턱을 넘겼을 수 있다. 실어 오지
 * 않으면 그 축하는 다음 채집·제작 때까지 조용히 미뤄져 "이 헌납 때문에 열렸다"가
 * 화면에서 사라진다.
 */
export interface DonateOutcomeDto {
  player: PlayerState
  achieved: MilestoneDef[]
}

/**
 * 맵을 넘어간 결과.
 *
 * 다른 결과들과 달리 실린 것이 플레이어뿐이다 — 전환에는 성패도 산출물도
 * 없고, 어디에 떨어졌는지는 `player.location` 이 이미 말한다.
 */
export interface MoveOutcomeDto {
  player: PlayerState
}

/**
 * 스윙 한 번의 결과 — 서버 fightService 의 FightOutcome 과 같은 모양이다.
 *
 * `hit:false` 는 헛스윙이다(전투 §2-2 갱신본): 거절이 아니라 수락된 스윙이라
 * 간격은 소모됐고 몬스터만 무피해다. 피격(tookHit)은 사거리와 무관하다 —
 * 위험은 구역이고 사거리는 명중에만 관여한다.
 */
export interface FightOutcomeDto {
  hit: boolean
  /** 이 스윙 뒤 그 배치의 HP. 부재(리스폰 대기)면 null — 0(방금 처치)과 다른 말이다. */
  monsterHp: number | null
  slainNow: boolean
  /** 처치 드랍. 처치가 아니거나 굴림이 빈손이면 null. */
  gained: { itemId: string; count: 1 } | null
  tookHit: boolean
  /** 이 스윙이 실제로 받은 피해 합 — 화면의 "-N" 은 이 값이다(걸린 구역의 주인이 표적과 다를 수 있다). */
  tookDamage: number
  /** 판정 직후의 내 HP(자연 회복 반영). */
  playerHp: number
  died: boolean
  skillGained: number
  achieved: MilestoneDef[]
  player: PlayerState
}

export class ApiError extends Error {
  /**
   * @param serverNowMs 이 거절을 **서버가 판정한 순간**(응답 헤더 `x-server-now`).
   *   서버에 닿지도 못했으면 없다.
   *
   *   **왜 오류가 시각을 지고 오는가:** 시각으로 갈리는 거절이 있다(결계의
   *   물때 — 결계 설계 §6). 그 거절을 화면이 설명하려면 **판정이 본 시각**을
   *   알아야 하는데, 왕복이 끝난 뒤 클라이언트가 자기 시계를 다시 읽으면
   *   그것은 서버가 잰 순간보다 늘 나중이다(왕복 지연 + 시계 기울임 최대 2초,
   *   time/slew.ts). 창이 **닫히는** 경계에서는 늦어도 같은 답이 나오지만
   *   **열리는** 경계(02:00·14:00)에서는 답이 뒤집힌다 — 서버는 01:59 로 재
   *   거절했는데 화면은 02:00 으로 읽어 "열려 있다"가 되고, 그러면 몸은
   *   되밀렸는데 화면이 아무 말도 못 한다. 물때를 기다리다 열리는 순간 문을
   *   두드리는 사람이 정확히 그 창을 밟는다.
   *
   *   시계(clock.ts)에 맡기지 않는 이유는 그쪽이 **일부러** 이 값을 앵커로
   *   바로 쓰지 않기 때문이다(왕복 보정이 없어 떨림이 그대로 시각에 실린다).
   *   여기 필요한 것은 매끄러운 세계 시각이 아니라 **그 한 번의 판정이 본
   *   시각**이라, 그 거절과 함께 온 값을 그 거절에 붙여 둔다.
   */
  constructor(readonly code: string, readonly serverNowMs?: number) {
    super(code)
    this.name = 'ApiError'
  }
}

/**
 * 응답 헤더의 서버 시각을 받는 콜백. clock.ts 가 등록한다.
 * GameClient 가 clock 을 직접 import 하면 순환 의존이 되므로 주입받는다.
 */
type ServerTimeObserver = (serverNowMs: number) => void
let observeServerTime: ServerTimeObserver = () => {}

export function setServerTimeObserver(fn: ServerTimeObserver): void {
  observeServerTime = fn
}

/**
 * 세션이 죽었다는 것을 화면에 알리는 콜백. gameStore 가 등록한다.
 *
 * 시각 관찰자와 같은 자세로 주입받는 이유도 같다 — 여기서 스토어를 import 하면
 * 스토어가 이미 이 파일을 import 하고 있어 곧바로 순환이 된다.
 */
type UnauthorizedObserver = () => void
let observeUnauthorized: UnauthorizedObserver = () => {}

export function setUnauthorizedObserver(fn: UnauthorizedObserver): void {
  observeUnauthorized = fn
}

/**
 * 서버에 닿지 못했을 때의 코드. HTTP 4xx·5xx 와 구분한다.
 *
 * 4xx 는 서버가 살아서 "그 요청은 안 된다" 고 답한 것이고, 이 코드는 서버와
 * 말 자체를 못 한 것이다. 접속 게이트는 후자에만 반응해야 한다 — 채집이
 * 쿨다운으로 거부됐다고 게임 밖으로 튕겨내면 안 된다.
 */
export const NETWORK_ERROR = 'network_error'

/**
 * 부팅 경로의 요청 하나가 버틸 수 있는 최대 시간(설계 규범 12).
 *
 * fetch 는 연결은 됐는데 응답이 영영 오지 않는 서버 앞에서는 스스로 실패하지
 * 않는다. 게임 안이라면 그 요청 하나가 멈춰 있을 뿐이지만, 부팅 경로에서는
 * 그것이 곧 **타이틀 화면이 영원히 "확인하는 중"으로 남는 것**이다.
 * clock.ts 의 SYNC_TIMEOUT_MS 와 같은 성격이고, 사람이 기다려 주는 시간이
 * 시계 동기보다 짧으므로 더 짧게 잡는다.
 */
const BOOT_TIMEOUT_MS = 8000

interface RequestOptions {
  /**
   * 이 요청에 세션 토큰을 싣는가. 기본은 싣는다.
   *
   * 가입·로그인만 false 다 — 그 둘은 서버에서도 인증 밖에 있고(app.ts), 더
   * 중요하게는 **거기서 오는 401 은 세션의 죽음이 아니라 비밀번호가 틀렸다는
   * 뜻**이라 아래의 일괄 처리에 걸리면 안 된다.
   */
  auth?: boolean
  /** 응답을 기다릴 최대 시간. 부팅 경로만 준다. */
  timeoutMs?: number
}

/**
 * 이 요청이 기다릴 신호.
 *
 * 둘 다 있으면 먼저 울리는 쪽이 이긴다 — 호출자가 준 취소와 우리가 건 시한이
 * 서로를 덮으면 안 된다(지금은 시계 동기만 자기 신호를 준다).
 */
function abortSignalFor(init: RequestInit | undefined, timeoutMs: number | undefined): AbortSignal | undefined {
  if (timeoutMs === undefined) return init?.signal ?? undefined
  const timeout = AbortSignal.timeout(timeoutMs)
  return init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
}

async function request<T>(path: string, init?: RequestInit, options: RequestOptions = {}): Promise<T> {
  const withAuth = options.auth !== false
  const token = withAuth ? readToken() : null

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        // **본문이 있을 때만 적는다.** 없는데 적으면 Fastify 가 그 요청을
        // 400 으로 거절한다(`FST_ERR_CTP_EMPTY_JSON_BODY` — "content-type 이
        // json 인데 본문이 비었다"). 실측으로 잡았다: 본문 없는 `POST
        // /api/auth/logout` 이 그동안 **줄곧 400** 이었고, 부르는 쪽이 실패를
        // 삼키도록 짜여 있어(gameStore.logout — "서버 쪽이 실패해도 토큰은
        // 버린다") 화면에는 아무것도 안 보인 채 서버의 세션 행만 안 지워졌다.
        // 서버 테스트가 못 잡은 이유는 `app.inject` 가 본문 없는 요청에
        // content-type 을 안 붙이기 때문이다 — 브라우저의 fetch 와 다르다.
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: abortSignalFor(init, options.timeoutMs),
    })
  } catch {
    // fetch 는 네트워크 자체가 실패했을 때만 reject 한다 — 서버가 안 떠 있거나,
    // 주소가 틀렸거나, 요청이 중단(타임아웃)된 경우다. 상태 코드가 무엇이든
    // 응답이 오기만 하면 여기로 오지 않는다.
    throw new ApiError(NETWORK_ERROR)
  }

  const raw = Number(res.headers.get('x-server-now'))
  const serverNowMs = Number.isFinite(raw) && raw > 0 ? raw : undefined
  if (serverNowMs !== undefined) observeServerTime(serverNowMs)

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string }
    // **401 을 다루는 자리는 여기 하나다**(설계 규범 12). 라우트마다 처리하면
    // 언젠가 하나를 빼먹고, 그 하나가 "죽은 토큰을 계속 들고 채집을 시도하는"
    // 화면이 된다. 토큰을 싣고 갔는데 거절당했다는 것은 그 토큰이 더는 아무
    // 문도 열지 못한다는 뜻이므로, 그 자리에서 버리고 타이틀로 돌려보낸다.
    if (res.status === 401 && token) {
      clearToken()
      observeUnauthorized()
    }
    // 거절에도 시각을 실어 보낸다 — 시각으로 갈리는 거절이 있고(결계의 물때),
    // 그 설명은 **판정이 본 시각**으로 지어야 한다(ApiError 의 serverNowMs 문서).
    throw new ApiError(body.code ?? `http_${res.status}`, serverNowMs)
  }

  // 204 는 본문이 없다(로그아웃·캐릭터 삭제). json() 을 부르면 빈 본문에서
  // 던지므로, "성공했는데 실패로 읽히는" 자리가 된다.
  if (res.status === 204) return undefined as T

  return (await res.json()) as T
}

/** 서버 통신의 단일 진입점. 다른 곳에서 fetch 를 직접 부르지 않는다. */
export const GameClient = {
  getTime: (signal?: AbortSignal) => request<{ serverNowMs: number }>('/api/time', { signal }),

  /**
   * 가입 — 성공하면 곧바로 토큰이 온다(서버가 로그인 화면으로 되돌리지 않는다).
   *
   * `auth: false` 가 요점이다: 여기서 오는 401·409 는 세션의 죽음이 아니라
   * 입력에 대한 답이다(request 의 RequestOptions 문서).
   */
  register: (username: string, password: string) =>
    request<AuthTokenResponse>(
      '/api/auth/register',
      { method: 'POST', body: JSON.stringify({ username, password }) },
      { auth: false, timeoutMs: BOOT_TIMEOUT_MS },
    ),

  login: (username: string, password: string) =>
    request<AuthTokenResponse>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
      { auth: false, timeoutMs: BOOT_TIMEOUT_MS },
    ),

  /** 세션 행 하나를 지운다. 이미 죽은 토큰으로 불러도 204 다(서버 routes/auth.ts). */
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }, { timeoutMs: BOOT_TIMEOUT_MS }),

  /**
   * 내 캐릭터 — **없으면 null 이다.** 그 null 이 곧 "캐릭터를 만들 차례" 라는
   * 화면 분기다(설계 §5).
   *
   * 토큰이 아직 유효한지 보는 자리(gameStore.connect)가 이것을 쓴다. 실제로
   * 들어가는 자리는 아래 `enter` 다.
   *
   * **부팅은 이제 두 왕복이다** — 여기서 토큰이 아직 사는지 확인하고, 들어설 때
   * `enter` 로 한 번 더. 아크 F 전까지 이 자리에 「부팅이 서버에 묻는 것은 이 한
   * 번뿐이다」라고 적혀 있었는데, 그 문장은 `enter` 가 생기면서 거짓이 됐다.
   * 둘을 하나로 합칠 수 없는 이유는 한 줄이다: **읽기 라우트가 세이브를 쓰면 안
   * 된다**(설계 ⑦). 그 값을 내고 사는 것은 「고인물이 켜자마자 초보 안내를 안
   * 받는다」이고, 그것이 실기 확인 1번이다.
   */
  me: () => request<MeResponse>('/api/me', undefined, { timeoutMs: BOOT_TIMEOUT_MS }),

  /**
   * **세계에 들어선다** — `me` 와 같은 답을 주되, 주기 전에 서버가 스토리 사슬을
   * 지금 상태에 맞춘다(서버 routes/me.ts 의 `POST /api/me/enter`).
   *
   * 왜 `me` 로 못 하는가: 밀어올림은 세이브를 **쓰는** 일이고 `GET /api/me` 는
   * 읽기 라우트다(설계 ⑦ 이 「접속 시 재판정」을 기각한 이유). 왜 부팅이 이쪽을
   * 부르는가: 그러지 않으면 얼음 200,000 인 사람이 게임을 켤 때마다 헤더 밑
   * 띠가 「마을 북문으로 나가라」를 적는다 — 서버가 그 사람의 사슬을 미는 것은
   * 첫 채집·전환 뒤이기 때문이다.
   */
  enter: () =>
    request<MeResponse>('/api/me/enter', { method: 'POST' }, { timeoutMs: BOOT_TIMEOUT_MS }),

  createCharacter: (req: CreateCharacterRequest) =>
    request<{ player: PlayerState }>(
      '/api/me/character',
      { method: 'POST', body: JSON.stringify(req) },
      { timeoutMs: BOOT_TIMEOUT_MS },
    ),

  /** 지울 캐릭터의 이름을 직접 타이핑해야 한다(설계 규범 7). 성공은 204 다. */
  deleteCharacter: (confirmName: string) =>
    request<void>(
      '/api/me/character',
      { method: 'DELETE', body: JSON.stringify({ confirmName }) },
      { timeoutMs: BOOT_TIMEOUT_MS },
    ),

  gather: (instanceId: string) =>
    request<GatherOutcomeDto>('/api/gather', {
      method: 'POST',
      body: JSON.stringify({ instanceId }),
    }),

  craft: (recipeId: string) =>
    request<CraftOutcomeDto>('/api/craft', {
      method: 'POST',
      body: JSON.stringify({ recipeId }),
    }),

  talk: (speakerId: string) =>
    request<TalkOutcomeDto>('/api/talk', {
      method: 'POST',
      body: JSON.stringify({ speakerId }),
    }),

  /**
   * 밟은 칸을 알린다. 목적지는 보내지 않는다 — 그 칸에서 어디로 가는지는
   * 서버가 전환표에서 찾는다(MoveRequestSchema 문서).
   */
  move: (x: number, y: number) =>
    request<MoveOutcomeDto>('/api/move', {
      method: 'POST',
      body: JSON.stringify({ x, y }),
    }),

  /**
   * 스윙 — 배치 하나를 향해 A 를 휘두른다(전투 §2-2). (x, y) 는 주장 칸이다:
   * 서버는 걸음마다 위치를 받지 않으므로 참을 알 수 없고, 명중·피격·처치는
   * 전부 서버가 monsterStateAt 으로 정한다(FightRequestSchema 문서).
   */
  fight: (instanceId: string, x: number, y: number) =>
    request<FightOutcomeDto>('/api/fight', {
      method: 'POST',
      body: JSON.stringify({ instanceId, x, y }),
    }),

  /**
   * 착용 — 지목한 인스턴스를 그 도구의 기술 슬롯에 끼운다(교체). 행동 간격을
   * 검사도 소비도 않는 정리 행위라(설계 §6-앞 11) 응답도 `{ player }` 뿐이다.
   */
  equip: (instanceId: string) =>
    request<{ player: PlayerState }>('/api/equip', {
      method: 'POST',
      body: JSON.stringify({ instanceId }),
    }),

  /**
   * 사용 — 소모품 하나를 쓴다. 지금 쓸 수 있는 것은 날씨 가루 4종뿐이고, 그
   * 효과는 하늘이다(설계 §6-앞 1~4).
   *
   * 착용·강화와 같은 모양(`{ player }` 하나)이고 같은 이유다: 무엇이 일어났는지는
   * 돌아온 상태가 이미 말한다 — 가루는 하나 줄었고 `player.weather` 에 그치는
   * 시각이 적혀 있다. 행동 간격도 여기 없다(서버 useService 의 머리말).
   */
  use: (itemId: string) =>
    request<{ player: PlayerState }>('/api/use', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    }),

  /**
   * 강화 — 예비 인스턴스(재료)를 소모해 같은 itemId 의 착용 중 인스턴스를 +1
   * 한다. 대상은 요청에 없다 — "같은 itemId 의 착용 인스턴스"를 서버가 스스로 찾는다.
   */
  enhance: (materialInstanceId: string) =>
    request<{ player: PlayerState }>('/api/enhance', {
      method: 'POST',
      body: JSON.stringify({ materialInstanceId }),
    }),

  /**
   * 헌납 — 채집물을 수집의 방에 바친다. **돌아오지 않는다**(설계 §3).
   *
   * 상점 id 가 없는 것이 요점이다: 방은 하나뿐이고 위치·시각과 무관하다
   * (protocol.ts 의 DonateRequestSchema). 수량 상한은 거래의 999 가 아니라
   * 헌납 전용 100,000 이고(스택에 상한이 없다), 화면 쪽 같은 값은
   * codexModel 의 `MAX_DONATE_COUNT` 다.
   */
  donate: (itemId: string, count: number) =>
    request<DonateOutcomeDto>('/api/donate', {
      method: 'POST',
      body: JSON.stringify({ itemId, count }),
    }),

  /**
   * 매도 — 그 계열의 재료를 상점에 넘긴다. 착용·강화와 같이 응답은 `{ player }`
   * 뿐이다(무엇이 얼마에 팔렸는지는 요청과 가격 함수가 이미 안다).
   *
   * **수량이 요청에 들어가는 첫 사례다**(설계 §6-앞 17). 지금까지 모든 요청은
   * id 하나였고 그 최소성이 규범이었다 — 수량만은 서버가 유도할 수 없는 판정
   * 대상의 크기라 예외다. 상한(999)은 서버 스키마가 조인다.
   */
  sell: (shopId: string, itemId: string, count: number) =>
    request<{ player: PlayerState }>('/api/shop/sell', {
      method: 'POST',
      body: JSON.stringify({ shopId, itemId, count }),
    }),

  /** 매수 — 진열된 물건을 정가에 산다. 매도와 같은 모양이고 같은 이유다. */
  buy: (shopId: string, itemId: string, count: number) =>
    request<{ player: PlayerState }>('/api/shop/buy', {
      method: 'POST',
      body: JSON.stringify({ shopId, itemId, count }),
    }),

  /**
   * 여관 — 값을 치르고 만혈로 회복한다(아크 D §2). 값은 요청에 담기지 않는다:
   * 여관비는 inns.csv 가 소유하는 등록부 값이다(InnRequestSchema 문서). 응답은
   * 착용·거래와 같은 `{ player }` 하나 — 깎인 골드와 찬 HP 는 돌아온 상태가
   * 이미 말한다.
   */
  rest: (speakerId: string) =>
    request<{ player: PlayerState }>('/api/inn', {
      method: 'POST',
      body: JSON.stringify({ speakerId }),
    }),
}
