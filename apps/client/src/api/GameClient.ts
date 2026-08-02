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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; availableAt?: number }
    throw new ApiError(body.code ?? `http_${res.status}`, body.availableAt)
  }

  return (await res.json()) as T
}

/** 서버 통신의 단일 진입점. 다른 곳에서 fetch 를 직접 부르지 않는다. */
export const GameClient = {
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
