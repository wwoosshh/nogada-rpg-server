import type { FastifyInstance } from 'fastify'

/**
 * 세계 시각의 권위는 서버 시계다.
 * 클라이언트는 이 값으로 자기 시계와의 오프셋을 재서 따라간다.
 */
export function registerTimeRoutes(app: FastifyInstance): void {
  app.get('/api/time', () => ({ serverNowMs: Date.now() }))
}
