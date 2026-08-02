import { join } from 'node:path'
import cors from '@fastify/cors'
import { loadGameData } from '@nogada/data'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerCraftRoutes } from './routes/craft.js'
import { registerGatherRoutes } from './routes/gather.js'
import { registerStateRoutes } from './routes/state.js'
import { registerTimeRoutes } from './routes/time.js'
import { PlayerStore } from './state/store.js'

export interface BuildAppOptions {
  /** 테스트에서 임시 파일을 쓰기 위해 주입한다. */
  dataFile?: string
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })
  const data = loadGameData()
  const store = new PlayerStore(options.dataFile ?? join(process.cwd(), '.data', 'players.json'))

  // 개발 중 클라이언트(Vite dev server)와 오리진이 다르므로 허용한다.
  // x-server-now 는 커스텀 헤더라 명시하지 않으면 브라우저가 읽지 못한다.
  app.register(cors, { origin: true, exposedHeaders: ['x-server-now'] })

  // 모든 응답에 서버 시각을 싣는다. 클라이언트가 채집·제작할 때마다 공짜로
  // 드리프트를 확인할 수 있어, 따로 동기화 요청을 보낼 필요가 줄어든다.
  // 본문이 아니라 헤더에 두는 이유는 응답 스키마를 건드리지 않기 위해서다 —
  // 앞으로 추가될 라우트도 자동으로 포함된다.
  app.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('x-server-now', String(Date.now()))
    done(null, payload)
  })

  app.get('/api/health', () => ({
    ok: true,
    items: Object.keys(data.items).length,
    nodes: Object.keys(data.nodes).length,
    recipes: Object.keys(data.recipes).length,
  }))

  registerTimeRoutes(app)
  registerStateRoutes(app, store)
  registerGatherRoutes(app, store, data)
  registerCraftRoutes(app, store, data)

  return app
}
