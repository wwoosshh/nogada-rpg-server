import cors from '@fastify/cors'
import { loadGameData } from '@nogada/data'
import Fastify, { type FastifyInstance } from 'fastify'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  const data = loadGameData()

  // 개발 중 클라이언트(Vite dev server)와 오리진이 다르므로 허용한다.
  app.register(cors, { origin: true })

  app.get('/api/health', () => ({
    ok: true,
    items: Object.keys(data.items).length,
    nodes: Object.keys(data.nodes).length,
    recipes: Object.keys(data.recipes).length,
  }))

  return app
}
