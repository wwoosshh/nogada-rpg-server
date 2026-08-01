import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

describe('GET /api/health', () => {
  it('200 과 데이터 개수를 반환한다', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, items: 13, nodes: 3, recipes: 10 })

    await app.close()
  })

  it('없는 경로는 404 를 반환한다', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
