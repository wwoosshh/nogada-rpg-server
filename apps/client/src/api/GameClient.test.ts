import { afterEach, describe, expect, it, vi } from 'vitest'
import { GameClient } from './GameClient.js'

/**
 * 요청 하나가 **실제로 어떤 모양으로 나가는가**.
 *
 * 여기서 재는 것은 서버 테스트가 구조적으로 못 재는 자리다: `app.inject` 는 본문
 * 없는 요청에 `content-type` 을 안 붙이지만 **브라우저의 fetch 는 우리가 적어 준
 * 헤더를 그대로 보낸다.** 그 차이가 실전에서 400 하나를 오래 숨겼다(아래).
 */

const 원래fetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = 원래fetch
  vi.restoreAllMocks()
})

/** 나간 요청 하나를 붙잡는 가짜 fetch. 응답은 언제나 204(본문 없음)다. */
function 가로채기(): { init: RequestInit | undefined } {
  const 잡은것: { init: RequestInit | undefined } = { init: undefined }
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    잡은것.init = init
    return new Response(null, { status: 204 })
  }) as unknown as typeof fetch
  return 잡은것
}

/** 헤더가 무엇으로 오든(Headers·배열·객체) 이름으로 찾는다. */
function 헤더(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers).get(name)
}

describe('요청의 모양 — content-type', () => {
  /**
   * **본문 없는 POST 에 `content-type: application/json` 을 붙이면 Fastify 가
   * 400 으로 거절한다**(`FST_ERR_CTP_EMPTY_JSON_BODY`).
   *
   * 실측으로 잡았다: 본문 없이 나가던 `POST /api/auth/logout` 이 브라우저에서
   * 줄곧 400 이었고, 부르는 쪽이 실패를 삼키도록 짜여 있어(gameStore.logout —
   * "서버 쪽이 실패해도 토큰은 버린다") 화면에는 아무 흔적 없이 서버의 세션
   * 행만 안 지워졌다. 같은 모양으로 나가는 문이 하나 더 생겼을 때(`/api/me/enter`)
   * 브라우저 확인이 그 자리에서 다시 잡아냈다.
   */
  it('본문이 없으면 content-type 을 안 적는다 — 적으면 서버가 400 으로 거절한다', async () => {
    const 잡은것 = 가로채기()
    await GameClient.logout()
    expect(헤더(잡은것.init, 'content-type')).toBeNull()

    await GameClient.enter()
    expect(헤더(잡은것.init, 'content-type')).toBeNull()
  })

  it('본문이 있으면 적는다 — 안 적으면 서버가 본문을 못 읽는다', async () => {
    const 잡은것 = 가로채기()
    await GameClient.gather('copper_vein-1')
    expect(헤더(잡은것.init, 'content-type')).toBe('application/json')
  })
})
