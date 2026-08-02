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

describe('POST /api/gather', () => {
  it('구리 광맥 채집 요청을 처리한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { nodeId: 'copper_vein' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json() as { chance: number; player: { id: string } }
    expect(body.chance).toBeCloseTo(0.5)
    expect(body.player.id).toBe('local')

    await app.close()
  })

  it('판정 결과를 저장해서 다음 조회에 반영한다', async () => {
    const app = buildTestApp()

    const gather = await app.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { nodeId: 'copper_vein' },
    })
    const outcome = gather.json() as { player: { nodeCooldowns: Record<string, number> } }

    const state = await app.inject({ method: 'GET', url: '/api/state' })
    const saved = state.json() as { player: { nodeCooldowns: Record<string, number> } }

    // 성패는 서버 난수라 단정할 수 없지만, 쿨다운은 성패와 무관하게 걸리고 저장된다.
    expect(saved.player.nodeCooldowns.copper_vein).toBe(outcome.player.nodeCooldowns.copper_vein)

    await app.close()
  })

  it('쿨다운 중 재요청은 409 와 해제 시각을 반환한다', async () => {
    const app = buildTestApp()

    await app.inject({ method: 'POST', url: '/api/gather', payload: { nodeId: 'copper_vein' } })
    const res = await app.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { nodeId: 'copper_vein' },
    })

    expect(res.statusCode).toBe(409)
    const body = res.json() as { code: string; availableAt: number }
    expect(body.code).toBe('on_cooldown')
    expect(body.availableAt).toBeGreaterThan(Date.now())

    await app.close()
  })

  it('도구 등급이 모자란 노드는 400 을 반환한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { nodeId: 'iron_vein' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'cannot_gather' })

    await app.close()
  })

  it('없는 노드는 400 을 반환한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { nodeId: 'ghost_vein' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_node' })

    await app.close()
  })

  it('nodeId 가 없으면 400 을 반환한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({ method: 'POST', url: '/api/gather', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})

describe('POST /api/craft', () => {
  it('재료가 없으면 400 missing_materials 를 반환한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'copper_ingot' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'missing_materials' })

    await app.close()
  })

  it('숙련도가 모자라면 400 level_too_low 를 반환한다', async () => {
    const app = buildTestApp()

    // 신규 플레이어는 대장 1레벨이라 요구 레벨이 높은 레시피에 닿지 못한다.
    // 재료도 없지만 숙련도 검사가 먼저이므로 level_too_low 가 나와야 한다.
    const res = await app.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'mithril_hammer' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'level_too_low' })

    await app.close()
  })

  it('없는 레시피는 400 unknown_recipe 를 반환한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'ghost' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'unknown_recipe' })

    await app.close()
  })

  it('recipeId 가 없으면 400 을 반환한다', async () => {
    const app = buildTestApp()

    const res = await app.inject({ method: 'POST', url: '/api/craft', payload: {} })
    expect(res.statusCode).toBe(400)

    await app.close()
  })
})
