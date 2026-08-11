import { createHash, randomBytes } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { characterIdOf } from '../state/characterKey.js'
import type { Persistence } from '../state/persistence.js'

/**
 * 세션 — 로그인한 기기 하나. 토큰을 만들고, 견주고, 미룬다.
 *
 * 쿠키가 아니라 `Authorization: Bearer` 인 이유는 이 게임이 브라우저에만 살지
 * 않기 때문이다(Capacitor 앱). 쿠키는 오리진에 묶이고 모바일 웹뷰에서 CORS 와
 * 얽히지만, 헤더는 어디서든 같은 방식으로 실린다(설계 §3).
 */

/** 30일. 매일 하는 게임이 아니라 며칠 쉬었다 돌아오는 게임이라 짧으면 매번 로그인이다. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 남은 기간이 이보다 적을 때만 미룬다(설계 규범 5).
 *
 * 요청마다 만료를 미루면 채집 한 번에 쓰기가 하나씩 더 붙는다 — 노가다 게임에서
 * 그것은 세션 표에 대한 초당 몇 번의 쓰기다. 이레 남았을 때 미루면 그 사람이
 * 일주일에 한 번만 들어와도 세션은 끊기지 않는다.
 */
export const SESSION_RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000

/** 인증 없이 들어온 요청. 클라이언트는 이것을 보면 토큰을 버리고 로그인 화면으로 간다(설계 규범 12). */
export const UNAUTHORIZED = 'unauthorized'

/** 이 요청을 보낸 사람. 인증 훅이 지나간 라우트에서만 채워진다. */
export interface Account {
  userId: string
  /** 이 계정의 캐릭터 키. 캐릭터가 아직 없어도 키는 정해져 있다(characterKey 참고). */
  characterId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    account: Account | null
  }
}

/**
 * 토큰 하나 — 불투명한 256비트 무작위.
 *
 * 계정 id 나 만료 시각을 담지 않는다(JWT 가 아니다). 담는 순간 그것을 검증할
 * 열쇠를 관리해야 하고, "로그아웃하면 즉시 죽는다"가 어려워진다 — 서버가 표를
 * 갖고 있으면 행 하나를 지우는 것이 곧 로그아웃이다.
 */
export function mintSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * 저장소에 남기는 표 — **토큰 자체는 어디에도 저장하지 않는다**(설계 규범 5).
 *
 * 우리가 하는 일은 "들고 온 토큰이 그 표를 만드는가" 하나라, 단방향으로 찍은
 * 값만 있으면 충분하다. 비밀번호와 달리 solt·느린 해시가 필요 없는 것은 토큰이
 * 사람이 지은 것이 아니라 256비트 무작위이기 때문이다 — 사전으로 되짚을 수 없다.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** 로그인·가입이 끝나는 자리. 토큰은 이 한 번만 밖으로 나간다. */
export async function openSession(store: Persistence, userId: string): Promise<string> {
  const token = mintSessionToken()
  await store.createSession(hashToken(token), userId, Date.now() + SESSION_TTL_MS)
  return token
}

/**
 * `Authorization: Bearer <토큰>` 에서 토큰만 꺼낸다. 모양이 아니면 null.
 *
 * 대소문자를 가리지 않는 이유: HTTP 명세가 스킴을 대소문자 구분 없이 정의하고,
 * 클라이언트 라이브러리마다 `Bearer`·`bearer` 를 섞어 쓴다.
 */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^bearer\s+(\S+)$/i.exec(header.trim())
  return match?.[1] ?? null
}

/**
 * **모든 게임 라우트가 지나는 문.** 세션이 없으면 여기서 401 로 끝난다.
 *
 * 캐릭터가 있는지는 보지 않는다 — 그것은 라우트마다 답이 다르기 때문이다:
 * `/api/me` 는 없으면 null 을 돌려줘야 하고(캐릭터 생성 화면으로 가는 분기),
 * 게임 라우트는 404 `no_character` 여야 한다. 이 훅이 대신 판정하면 "캐릭터를
 * 만들 수 있는 유일한 요청"이 자기 자신 때문에 막힌다.
 */
export function requireSession(store: Persistence) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = bearerToken(request.headers.authorization)
    if (!token) return reply.code(401).send({ code: UNAUTHORIZED })

    const tokenHash = hashToken(token)
    const session = await store.findSession(tokenHash)
    if (!session) return reply.code(401).send({ code: UNAUTHORIZED })

    const now = Date.now()
    if (session.expiresAt <= now) {
      // 지난 세션은 그 자리에서 지운다. 남겨 두면 아무도 못 쓰는 행이 계정마다
      // 쌓이고, 청소를 따로 도는 일이 하나 더 생긴다.
      await store.deleteSession(tokenHash)
      return reply.code(401).send({ code: UNAUTHORIZED })
    }

    if (session.expiresAt - now < SESSION_RENEW_WITHIN_MS) {
      await store.extendSession(tokenHash, now + SESSION_TTL_MS)
    }

    request.account = { userId: session.userId, characterId: characterIdOf(session.userId) }
  }
}

/**
 * 인증 훅을 지난 라우트에서 "누구인가"를 꺼낸다.
 *
 * 던지는 것은 프로그래밍 오류다 — 훅 없이 등록된 라우트가 있다는 뜻이고, 그건
 * 인증 없이 남의 캐릭터를 만지는 길이 열렸다는 뜻이라 조용히 넘길 수 없다.
 */
export function requireAccount(request: FastifyRequest): Account {
  if (!request.account) throw new Error('인증 훅 없이 등록된 라우트다 — 세션을 확인할 수 없다')
  return request.account
}
