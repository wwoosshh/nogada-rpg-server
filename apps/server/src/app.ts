import { join } from 'node:path'
import cors from '@fastify/cors'
import { loadGameData } from '@nogada/data'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerGatherRoutes } from './routes/gather.js'
import { registerStateRoutes } from './routes/state.js'
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
  app.register(cors, { origin: true })

  app.get('/api/health', () => ({
    ok: true,
    items: Object.keys(data.items).length,
    nodes: Object.keys(data.nodes).length,
    recipes: Object.keys(data.recipes).length,
  }))

  registerStateRoutes(app, store)
  registerGatherRoutes(app, store, data)

  return app
}
