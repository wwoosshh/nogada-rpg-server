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
    const body = res.json() as { player: { skills: Record<string, number> } }
    expect(body.player.skills.mineral).toBe(0)

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
  it('숙련도가 모자라면 400 level_too_low 를 반환한다', async () => {
    const app = buildTestApp()

    // 신규 플레이어는 조합 숙련도가 0이라 요구 숙련도가 높은 레시피에 닿지 못한다
    // (iron_pickaxe 요구치 500). 재료도 없지만 숙련도 검사가 먼저이므로
    // level_too_low 가 나와야 한다.
    const res = await app.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'iron_pickaxe' },
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

describe('GET /api/time', () => {
  it('서버 현재 시각을 반환한다', async () => {
    const app = buildTestApp()
    const before = Date.now()
    const res = await app.inject({ method: 'GET', url: '/api/time' })
    const after = Date.now()

    expect(res.statusCode).toBe(200)
    const body = res.json() as { serverNowMs: number }
    expect(body.serverNowMs).toBeGreaterThanOrEqual(before)
    expect(body.serverNowMs).toBeLessThanOrEqual(after)

    await app.close()
  })
})

describe('x-server-now 헤더', () => {
  it('모든 응답에 서버 시각이 실린다', async () => {
    const app = buildTestApp()

    for (const url of ['/api/health', '/api/state', '/api/time']) {
      const res = await app.inject({ method: 'GET', url })
      const header = res.headers['x-server-now']
      expect(header, `${url} 에 헤더가 없다`).toBeDefined()
      expect(Number(header)).toBeGreaterThan(0)
    }

    await app.close()
  })

  it('POST 응답에도 실린다', async () => {
    const app = buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'ghost' },
    })

    expect(res.statusCode).toBe(400)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })

  it('없는 경로(404) 응답에도 실린다', async () => {
    const app = buildTestApp()
    const res = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(res.statusCode).toBe(404)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })

  it('CORS 프리플라이트(OPTIONS) 응답에도 실린다', async () => {
    const app = buildTestApp()

    // onSend 훅이 캡슐화된 자식 컨텍스트로 옮겨지거나 누군가 OPTIONS 를 특별
    // 취급하도록 리팩터링하면, 프리플라이트 응답에서만 헤더가 조용히 빠질 수 있다.
    // 그러면 브라우저는 실제 요청을 보내기도 전에 드리프트 감지에 쓸 기준 시각을
    // 하나 놓치게 되는데, 테스트가 없으면 이 회귀는 아무 것도 빨갛게 만들지 않는다.
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/time',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    })

    expect(res.statusCode).toBe(204)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })
})

describe('CORS exposedHeaders 설정', () => {
  it('Origin 요청에 access-control-expose-headers 로 x-server-now 를 실어 보낸다', async () => {
    const app = buildTestApp()

    // app.ts 의 exposedHeaders: ['x-server-now'] 한 줄이 빠지거나 값이 바뀌면, 헤더
    // 자체는 여전히 응답에 실리지만 브라우저의 fetch 는 이 헤더를 볼 수 없게 된다.
    // app.inject() 는 Node 의 raw 응답을 읽을 뿐 브라우저의 CORS 가시성 필터링을
    // 적용하지 않으므로, 여기서는 서버가 Access-Control-Expose-Headers 를 실제로
    // 보내는지만 확인한다 — 브라우저 쪽 강제 여부는 이 테스트의 검증 범위가 아니다.
    const res = await app.inject({
      method: 'GET',
      url: '/api/time',
      headers: { origin: 'http://localhost:5173' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['access-control-expose-headers']).toBe('x-server-now')

    await app.close()
  })
})
