import type { MilestoneDef, PlayerState, RecipeInput } from '@nogada/shared'

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
 * 서버에 닿지 못했을 때의 코드. HTTP 4xx·5xx 와 구분한다.
 *
 * 4xx 는 서버가 살아서 "그 요청은 안 된다" 고 답한 것이고, 이 코드는 서버와
 * 말 자체를 못 한 것이다. 접속 게이트는 후자에만 반응해야 한다 — 채집이
 * 쿨다운으로 거부됐다고 게임 밖으로 튕겨내면 안 된다.
 */
export const NETWORK_ERROR = 'network_error'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
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
    throw new ApiError(body.code ?? `http_${res.status}`)
  }

  return (await res.json()) as T
}

/** 서버 통신의 단일 진입점. 다른 곳에서 fetch 를 직접 부르지 않는다. */
export const GameClient = {
  getTime: (signal?: AbortSignal) => request<{ serverNowMs: number }>('/api/time', { signal }),

  getState: () => request<{ player: PlayerState }>('/api/state'),

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
