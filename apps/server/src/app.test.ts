import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

describe('GET /api/health', () => {
  it('200 과 데이터 개수를 반환한다', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/health' })

    // 밸런스 CSV 를 정당하게 고칠 때마다 이 패키지의 무관한 테스트가 깨지는 것을
    // 막기 위해 하드코딩된 개수 대신 loadGameData() 에서 기대값을 뽑는다.
    // 그래도 라우트가 실제 개수 보고를 멈추면(예: 필드를 하드코딩하거나 뒤바꾸면)
    // 여전히 실패해야 하므로, 데이터가 최소한 비어 있지 않다는 것도 함께 확인한다.
    const data = loadGameData()
    const itemCount = Object.keys(data.items).length
    const nodeCount = Object.keys(data.nodes).length
    const recipeCount = Object.keys(data.recipes).length
    expect(itemCount).toBeGreaterThan(0)
    expect(nodeCount).toBeGreaterThan(0)
    expect(recipeCount).toBeGreaterThan(0)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, items: itemCount, nodes: nodeCount, recipes: recipeCount })

    await app.close()
  })

  it('없는 경로는 404 를 반환한다', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})
