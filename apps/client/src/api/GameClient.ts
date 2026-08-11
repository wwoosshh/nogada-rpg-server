import type {
  AuthTokenResponse,
  CreateCharacterRequest,
  MeResponse,
  MilestoneDef,
  PlayerState,
  RecipeInput,
} from '@nogada/shared'
import { clearToken, readToken } from './sessionToken.js'

/**
 * 서버 주소는 이 변수 하나로만 결정된다.
 * 개발은 localhost, 실기는 PC 의 LAN IP, 운영은 원격 — 코드는 그대로다.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export interface GatherOutcomeDto {
  success: boolean
  chance: number
  gained: RecipeInput | null
  skillGained: number
  /** 이번 행동으로 새로 달성된 이정표. 실패·거부 경로에서는 항상 빈 배열이다. */
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
  player: PlayerState
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

export class ApiError extends Error {
  constructor(readonly code: string) {
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
        'Content-Type': 'application/json',
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

  const serverNow = Number(res.headers.get('x-server-now'))
  if (Number.isFinite(serverNow) && serverNow > 0) observeServerTime(serverNow)

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
    throw new ApiError(body.code ?? `http_${res.status}`)
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
   * 화면 분기이고, 부팅이 서버에 묻는 것은 이 한 번뿐이다(설계 §5).
   */
  me: () => request<MeResponse>('/api/me', undefined, { timeoutMs: BOOT_TIMEOUT_MS }),

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
}
