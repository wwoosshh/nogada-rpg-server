import { join } from 'node:path'
import cors from '@fastify/cors'
import { loadGameData } from '@nogada/data'
import Fastify, { type FastifyInstance } from 'fastify'
import { requireSession } from './auth/sessions.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCraftRoutes } from './routes/craft.js'
import { registerGatherRoutes } from './routes/gather.js'
import { registerMeRoutes } from './routes/me.js'
import { registerMoveRoutes } from './routes/move.js'
import { registerStateRoutes } from './routes/state.js'
import { registerTalkRoutes } from './routes/talk.js'
import { registerTimeRoutes } from './routes/time.js'
import { JsonPersistence } from './state/jsonPersistence.js'
import { CharacterStateError, type Persistence } from './state/persistence.js'
import { PostgresPersistence } from './state/postgresPersistence.js'

export interface BuildAppOptions {
  /** 테스트에서 임시 파일을 쓰기 위해 주입한다. */
  dataFile?: string
  /**
   * 저장소를 통째로 주입한다. 파일 경로로는 만들 수 없는 저장소(프로세스 밖으로
   * 나가서 진짜로 기다리는 저장소)를 앉혀 볼 수 있어야 동시성이 시험된다.
   */
  persistence?: Persistence
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const data = loadGameData()
  const store = options.persistence ?? (await openStore(options.dataFile))

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

  // 저장소를 닫는 것도 앱의 일이다. Postgres 풀은 여기서 드레인되고, 그래야
  // SIGTERM 을 받은 서버가 쓰다 만 연결을 남기지 않는다.
  app.addHook('onClose', () => store.close())

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof CharacterStateError) {
      // 500 이다 — 400 이 아니다. 요청은 멀쩡했고 잘못된 것은 우리가 가진 자료다.
      // 그리고 행은 지우지 않았으므로 사람이 보고 고칠 수 있다.
      console.error(error.message)
      return reply.code(500).send({ code: 'character_unreadable' })
    }
    return reply.send(error)
  })

  app.get('/api/health', () => ({
    ok: true,
    items: Object.keys(data.items).length,
    nodes: Object.keys(data.nodes).length,
    recipes: Object.keys(data.recipes).length,
  }))

  // 인증 밖에 있는 것은 셋뿐이다: 서버가 살아 있는가(health), 지금 몇 시인가
  // (time), 그리고 게임의 문(auth). 나머지는 전부 "누구인가"에 답해야 한다.
  registerTimeRoutes(app)
  registerAuthRoutes(app, store)

  // **여기부터 세션이 필요하다.** 캡슐화된 자식 컨텍스트에 훅을 걸어 두면,
  // 새 게임 라우트를 이 안에 등록하는 것만으로 인증이 따라온다 — 라우트마다
  // 훅을 적게 하면 언젠가 하나를 잊고, 그 하나가 남의 캐릭터를 여는 문이 된다.
  await app.register(async (guarded) => {
    guarded.decorateRequest('account', null)
    guarded.addHook('onRequest', requireSession(store))

    registerMeRoutes(guarded, store, data)
    registerStateRoutes(guarded, store)
    registerGatherRoutes(guarded, store, data)
    registerCraftRoutes(guarded, store, data)
    registerTalkRoutes(guarded, store, data)
    registerMoveRoutes(guarded, store, data)
  })

  return app
}

/**
 * `DATABASE_URL` 이 저장소를 고른다 — 있으면 Postgres, 없으면 JSON 파일.
 *
 * 폴백을 남겨 두는 이유는 개발이 docker 없이도 돌아야 하기 때문이다(설계 §2).
 * 같은 계약 스위트가 양쪽에서 통과하므로, 어느 쪽으로 개발했든 다른 쪽에서
 * 처음 보는 동작이 나오지 않는다.
 */
async function openStore(dataFile: string | undefined): Promise<Persistence> {
  const databaseUrl = process.env.DATABASE_URL
  if (databaseUrl) return PostgresPersistence.open(databaseUrl)
  return JsonPersistence.open(dataFile ?? join(process.cwd(), '.data', 'players.json'))
}
