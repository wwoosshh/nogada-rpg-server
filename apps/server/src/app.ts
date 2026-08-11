import { join } from 'node:path'
import cors from '@fastify/cors'
import { START_MAP_ID, loadGameData } from '@nogada/data'
import { DEFAULT_APPEARANCE } from '@nogada/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerCraftRoutes } from './routes/craft.js'
import { registerGatherRoutes } from './routes/gather.js'
import { registerMoveRoutes } from './routes/move.js'
import { registerStateRoutes } from './routes/state.js'
import { registerTalkRoutes } from './routes/talk.js'
import { registerTimeRoutes } from './routes/time.js'
import { LOCAL_PLAYER_ID } from './state/constants.js'
import { JsonPersistence } from './state/jsonPersistence.js'
import { createInitialPlayer } from './state/newCharacter.js'
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

  registerTimeRoutes(app)
  registerStateRoutes(app, store)
  registerGatherRoutes(app, store, data)
  registerCraftRoutes(app, store, data)
  registerTalkRoutes(app, store, data)
  registerMoveRoutes(app, store, data)

  await ensureLocalCharacter(store)

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

/**
 * **A2 에서 지운다.** 계정이 들어오기 전의 임시 관문이다.
 *
 * 저장소는 이제 없는 캐릭터를 지어내지 않는다 — 그 습관이 오타 하나로 빈
 * 캐릭터를 낳고, 형식이 안 맞는 세이브를 조용히 새것으로 갈아 치웠다. 그런데
 * 캐릭터를 만드는 곳(가입 → 캐릭터 생성)은 아직 없고 라우트는 여전히 'local'
 * 하나를 본다. 그래서 부팅 때 한 번, 여기서만 만든다. 가입이 생기면 이 함수와
 * LOCAL_PLAYER_ID 가 같이 사라진다.
 */
async function ensureLocalCharacter(store: Persistence): Promise<void> {
  try {
    if (await store.getCharacter(LOCAL_PLAYER_ID)) return
  } catch (error) {
    if (!(error instanceof CharacterStateError)) throw error
    // 읽을 수 없는 세이브를 새것으로 덮는 것이야말로 이 태스크가 뒤집은 습관이다.
    // 서버는 뜨고, 그 캐릭터를 부르는 요청만 500 을 본다 — 행은 그대로 남는다.
    console.error(`${error.message} — 덮어쓰지 않고 그대로 둔다`)
    return
  }

  // 캐릭터에는 이제 주인이 있어야 한다(characters.user_id). 그래서 이 임시
  // 관문도 계정을 하나 만든다 — **로그인할 수 없는 계정**이다: 비밀번호 해시
  // 자리에 argon2 가 만들 수 없는 글자를 넣어 두어, 이 계정으로 들어오는 길이
  // 없게 한다. 가입 라우트가 생기는 다음 커밋에서 이 함수가 통째로 사라진다.
  const user =
    (await store.createUser(LOCAL_PLAYER_ID, '로그인할 수 없는 계정')) ??
    (await store.findUser(LOCAL_PLAYER_ID))
  if (!user) throw new Error('개발용 계정을 만들지도 찾지도 못했다')

  await store.createCharacter(
    user.id,
    createInitialPlayer({
      id: LOCAL_PLAYER_ID,
      // 고른 사람이 없으니 고른 것도 없다 — 가입 화면이 생기면 함께 사라진다.
      name: '아무개',
      appearance: DEFAULT_APPEARANCE,
      village: START_MAP_ID,
    }),
  )
}
