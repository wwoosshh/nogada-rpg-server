import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadGameData } from '@nogada/data'
import { StateResponseSchema } from '@nogada/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nogada-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** 세이브 파일을 임시 디렉터리로 격리한다. 테스트가 저장소 루트에 .data/ 를 남기지 않는다. */
function buildTestApp() {
  return buildApp({ dataFile: join(dir, 'players.json') })
}

describe('GET /api/health', () => {
  it('200 과 데이터 개수를 반환한다', async () => {
    const app = buildTestApp()
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
    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('GET /api/state', () => {
  it('플레이어 상태를 반환한다', async () => {
    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/state' })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { player: { skills: Record<string, { level: number }> } }
    expect(body.player.skills.mining!.level).toBe(1)

    await app.close()
  })

  it('응답이 프로토콜 스키마를 만족한다', async () => {
    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/state' })

    // 클라이언트가 이 스키마로 응답을 검증한다(Task 10). 서버가 먼저 지키는지 확인한다.
    expect(() => StateResponseSchema.parse(res.json())).not.toThrow()

    await app.close()
  })

  it('다시 호출해도 같은 플레이어를 돌려준다', async () => {
    const app = buildTestApp()
    const first = await app.inject({ method: 'GET', url: '/api/state' })
    const second = await app.inject({ method: 'GET', url: '/api/state' })

    expect(second.json()).toEqual(first.json())

    await app.close()
  })
})
