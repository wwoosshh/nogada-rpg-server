import type { PlayerState, RecipeInput } from '@nogada/shared'

/**
 * 서버 주소는 이 변수 하나로만 결정된다.
 * 개발은 localhost, 실기는 PC 의 LAN IP, 운영은 원격 — 코드는 그대로다.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export interface GatherOutcomeDto {
  success: boolean
  chance: number
  gained: RecipeInput | null
  xpGained: number
  player: PlayerState
  cooldownUntil: number
}

export interface CraftOutcomeDto {
  success: boolean
  chance: number
  produced: RecipeInput | null
  consumed: RecipeInput[]
  xpGained: number
  autoEquipped: boolean
  player: PlayerState
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly availableAt?: number,
  ) {
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
    const body = (await res.json().catch(() => ({}))) as { code?: string; availableAt?: number }
    throw new ApiError(body.code ?? `http_${res.status}`, body.availableAt)
  }

  return (await res.json()) as T
}

/** 서버 통신의 단일 진입점. 다른 곳에서 fetch 를 직접 부르지 않는다. */
export const GameClient = {
  getTime: (signal?: AbortSignal) => request<{ serverNowMs: number }>('/api/time', { signal }),

  getState: () => request<{ player: PlayerState }>('/api/state'),

  gather: (nodeId: string) =>
    request<GatherOutcomeDto>('/api/gather', {
      method: 'POST',
      body: JSON.stringify({ nodeId }),
    }),

  craft: (recipeId: string) =>
    request<CraftOutcomeDto>('/api/craft', {
      method: 'POST',
      body: JSON.stringify({ recipeId }),
    }),
}
