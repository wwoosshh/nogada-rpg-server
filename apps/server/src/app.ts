import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { loadGameData, startLocation } from '@nogada/data'
// 별도 진입이다 — 배럴(index.ts)에 실리면 클라이언트 번들도 이 표를 받는다.
// 브라켓 경계·잭팟 확률이 곧 숨은 문턱이라 그러면 F12 로 스포일된다(설계 §7-앞 9).
import { loadGatherTables } from '@nogada/data/gather-tables'
// 역시 별도 진입이다 — 결계 뒤 칸들은 서버가 위조 요청을 거르는 근거이지
// 화면이 그릴 것이 아니다. 서버 전용 산출물 규범은 바로 위와 같은 한 줄이
// 출처다(채집 티어 스펙 §7-앞 9) — 결계 스펙 §9-앞 에는 그 규범이 없고,
// 오래 §9-앞 18 로 적혀 있었는데 그 번호는 "계기 절의 숫자 셋을 고친다"다.
// 벽은 클라이언트가 맵 JSON 으로 이미 보고 있으므로 감출 비밀이 있어서가
// 아니라, 판정의 재료를 판정받는 쪽에 쥐여 줄 이유가 없어서다.
import { loadBarrierRegions } from '@nogada/data/barriers'
// 셋째 별도 진입 — 드랍 확률이 곧 숨은 문턱이라(전투 §4) 확률표와 같은 취급이다.
// 몬스터의 패턴·배치는 반대로 GameData 에 실려 온다: 화면이 그릴 정보다.
import { loadMonsterDrops } from '@nogada/data/monster-drops'
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify'
import { requireSession } from './auth/sessions.js'
import {
  isDevConsole,
  parseClientDist,
  parseCorsOrigin,
  parseLogger,
  parseTrustProxy,
} from './config.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerCraftRoutes } from './routes/craft.js'
import { registerDonateRoutes } from './routes/donate.js'
import { registerEnhanceRoutes } from './routes/enhance.js'
import { registerEquipRoutes } from './routes/equip.js'
import { registerFightRoutes } from './routes/fight.js'
import { registerGatherRoutes } from './routes/gather.js'
import { registerInnRoutes } from './routes/inn.js'
import { registerMeRoutes } from './routes/me.js'
import { registerMoveRoutes } from './routes/move.js'
import { registerStateRoutes } from './routes/state.js'
import { registerTalkRoutes } from './routes/talk.js'
import { registerTimeRoutes } from './routes/time.js'
import { registerTradeRoutes } from './routes/trade.js'
import { registerUseRoutes } from './routes/use.js'
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
  /**
   * 로거를 통째로 주입한다. 기본은 `LOG_LEVEL`·`NODE_ENV` 가 정하지만
   * (config.ts), 로그에 무엇이 남는지를 시험하려면 받아 볼 스트림이 필요하다 —
   * 환경변수로는 스트림을 건넬 수 없다.
   */
  logger?: FastifyServerOptions['logger']
  /**
   * 클라이언트 dist 를 어디서 내줄 것인가. 기본은 `CLIENT_DIST` 가 정한다
   * (config.ts). **`false` 는 "아예 붙이지 않는다"** 다.
   *
   * 테스트가 이 값을 못 박는 이유: 기본대로 두면 `apps/client/dist` 가 **있는
   * 기계에서만** 정적 핸들러가 붙어, 같은 커밋이 개발 PC 와 CI 에서 다른 라우터를
   * 갖는다. 조건이 실행 환경에 달린 관문은 관문이 아니다(testSupport.ts 가
   * `logger` 를 못 박는 것과 같은 이유).
   */
  clientDist?: string | false
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  // trustProxy 는 요청마다 `request.ip` 가 무엇인지를 정한다 — 리버스 프록시
  // 뒤에서 켜지 않으면 모든 요청이 프록시 IP 하나로 보이고, 프록시 없이 켜면
  // 아무나 헤더를 지어내 IP 인 척한다. 어느 쪽이든 레이트리미터가 무력해지므로
  // 배포 토폴로지가 정하게 두고, 기본은 끈 상태다(config.ts).
  //
  // 로그는 오래 꺼져 있었다(`logger: false`). 그동안 미니PC 의 로그에 남는 것은
  // 기동·마이그레이션·오류뿐이라, "그 요청이 서버까지 왔는가"를 물으려면
  // 클라이언트가 받은 상태 코드를 되짚는 수밖에 없었다. 이제 사람이 안 보는
  // 자리에 선 서버는 아무 설정 없이도 그 줄을 남기되(config.ts 의 isDevConsole),
  // 자격증명은 지워진 채로 남는다(같은 파일의 LOG_REDACT_PATHS).
  const app = Fastify({
    logger:
      options.logger ??
      parseLogger(process.env.LOG_LEVEL, process.env.NODE_ENV, process.stdout.isTTY),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  })
  const data = loadGameData()
  // GameData 와 갈라서 온다(위 import 주석 참고) — data 처럼 한 번 읽어서
  // 채집 라우트에 주입한다. 다른 라우트는 이 값을 받지 않는다.
  const gatherTables = loadGatherTables()
  // 확률표와 같은 자리·같은 수명 — 한 번 읽어서 채집 라우트에만 준다.
  const barrierRegions = loadBarrierRegions()
  const store = options.persistence ?? (await openStore(options.dataFile))

  // 개발 중 클라이언트(Vite dev server)와 오리진이 다르므로 허용한다.
  // 배포에서는 `CORS_ORIGIN` 이 목록을 좁힌다 — 안드로이드 빌드의
  // `capacitor://localhost` 까지 포함해야 앱에서 붙는다(.env.example).
  // x-server-now 는 커스텀 헤더라 명시하지 않으면 브라우저가 읽지 못한다.
  app.register(cors, {
    origin: parseCorsOrigin(process.env.CORS_ORIGIN),
    exposedHeaders: ['x-server-now'],
  })

  serveClient(app, options.clientDist ?? parseClientDist(process.env.CLIENT_DIST))

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

  // 오류의 자세한 사정을 밖으로 줄 것인가. 개발 콘솔에서만 준다 — 그 자리에서는
  // 응답을 읽는 사람과 서버를 띄운 사람이 같은 사람이라 감출 것이 없다.
  // 판정은 로그와 같은 물음 하나를 쓴다(config.ts 의 isDevConsole): 여기서
  // `NODE_ENV !== 'production'` 을 따로 쓰면 WinSW 배포는 그 변수를 놓지 않아
  // **운영에서도 개발처럼 뱉는다** — 요청 로그가 여태 안 남던 것과 같은 함정이다.
  const devConsole = isDevConsole(process.env.NODE_ENV, process.stdout.isTTY)

  // 타입을 손으로 적는 이유: 안 적으면 TS 가 아래 `instanceof` 하나로 오류의
  // 타입을 CharacterStateError 로 좁혀 버려서, 그 밖의 오류를 다루는 자리에서
  // statusCode 를 못 읽는다. 여기 오는 것은 Fastify 가 넘기는 모든 오류다.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof CharacterStateError) {
      // 500 이다 — 400 이 아니다. 요청은 멀쩡했고 잘못된 것은 우리가 가진 자료다.
      // 그리고 행은 지우지 않았으므로 사람이 보고 고칠 수 있다.
      console.error(error.message)
      return reply.code(500).send({ code: 'character_unreadable' })
    }

    // 4xx 는 그대로 돌려준다. 그건 보낸 쪽이 고칠 수 있는 말이고(본문이 JSON 이
    // 아니다, 너무 크다 같은 것) 우리 안쪽 사정이 아니다. 여기까지 오는 4xx 는
    // Fastify 가 만든 것뿐이다 — 게임의 거절은 전부 라우트가 직접 코드로 답한다.
    const status = error.statusCode ?? 500
    if (status < 500) return reply.send(error)

    // 자세한 것은 **로그로** 간다. 밖으로 나가면 안 되는 이유는 그 문장이 안쪽
    // 지형이기 때문이다: DB 가 죽으면 message 가 `connect ECONNREFUSED
    // 127.0.0.1:5432` 라, 공개된 주소를 두드리는 쪽이 우리 포트 배치를 공짜로
    // 받아 간다. 로그에는 그대로 남으므로 디버깅은 잃지 않는다(WinSW 의 logs\).
    request.log.error({ err: error }, '요청이 500 으로 끝났다')
    if (devConsole) return reply.send(error)
    // 코드만 준다. 클라이언트는 본문의 `code` 하나만 읽으므로(GameClient 의
    // describeError) 이 형태가 기존 거절들과 같은 계약이다.
    return reply.code(status).send({ code: 'internal_error' })
  })

  // 컨테이너의 HEALTHCHECK 가 두드리는 문이다. 프로세스가 살아 있다는 것만으로
  // 초록불을 켜면, DB 가 끊긴 서버가 "건강함"을 달고 서서 모든 요청에 500 을
  // 돌려주는 상태가 밖에서는 정상으로 보인다 — 그래서 저장소에 한 번 묻는다.
  app.get('/api/health', async (_request, reply) => {
    try {
      await store.ping()
    } catch (error) {
      console.error(error)
      return reply.code(503).send({ ok: false, code: 'store_unreachable' })
    }

    return {
      ok: true,
      items: Object.keys(data.items).length,
      nodes: Object.keys(data.nodes).length,
      recipes: Object.keys(data.recipes).length,
      // 배포된 서버가 자기 커밋을 말할 수 있어야 원격에서 배포를 검증한다.
      // Dockerfile 이 GIT_SHA 를 이미지에 새겨 넣고(ENV), 로컬에서 tsx 로
      // 바로 띄운 서버에는 그 변수가 없으므로 'dev' 로 구분한다.
      sha: process.env.GIT_SHA ?? 'dev',
    }
  })

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
    registerGatherRoutes(guarded, store, data, gatherTables, barrierRegions)
    registerCraftRoutes(guarded, store, data)
    registerEquipRoutes(guarded, store, data)
    registerEnhanceRoutes(guarded, store, data)
    registerTalkRoutes(guarded, store, data)
    registerTradeRoutes(guarded, store, data)
    registerInnRoutes(guarded, store, data)
    registerUseRoutes(guarded, store, data)
    registerMoveRoutes(guarded, store, data)
    registerDonateRoutes(guarded, store, data)
    // 몬스터 세계 — 종·배치는 gamedata 에서, 드랍표만 서버 전용 산출물에서 온다
    // (전투 §4: 드랍 확률이 곧 숨은 문턱이다). def 는 배치별로 구워져 있어
    // monsterId = instanceId 다(packages/data 의 monsters.ts).
    // 죽음 귀환 자리는 시작 맵의 spawn 하나다(startLocation — newCharacter 가
    // 마을 spawn 을 유일한 출처로 삼는 그 규범).
    registerFightRoutes(
      guarded,
      store,
      data,
      { defs: data.monsters, placements: data.monsterPlacements, drops: loadMonsterDrops() },
      startLocation(data),
    )
  })

  return app
}

/**
 * 게임 화면을 **API 와 같은 오리진으로** 내준다.
 *
 * 이 한 등록이 공개 배포의 절반이다(docs/deploy-public.md 1장): 오리진이 하나면
 * CORS 도, HTTPS 페이지가 평문 API 를 부르는 혼합 콘텐츠도, 안드로이드의 평문
 * 차단도, 주소가 바뀔 때의 재빌드도 **애초에 생기지 않는다.** 각각을 따로 고치는
 * 것보다 싸다.
 *
 * **없으면 조용히 안 붙이고 로그로 한 줄 남긴다.** dist 는 빌드 생성물이라
 * 저장소에 없고, 개발도 테스트도 그것 없이 서버를 띄운다.
 *
 * 이 앞 검사가 무엇을 사는지 실측했다. **처음 생각한 것과 달랐다:**
 * - **없는 폴더는 @fastify/static 이 안 던진다.** 전부 404 를 줄 뿐이고, 게다가
 *   그쪽도 경로를 담은 warn 을 스스로 남긴다(`"root" path "..." must exist`).
 *   즉 여기 `existsSync` 가 사는 것은 서버의 목숨도, 유일한 단서도 아니다 —
 *   운영자에게 우리 말로, 우리가 문서에서 가리킨 자리에(docs/deploy-windows.md)
 *   한 줄 남기는 것뿐이다. 그것을 위해 남긴다고 적어 두는 편이 정직하다.
 * - **파일을 가리키면 던진다**(`"root" option must be a directory`). 이쪽이
 *   진짜다: `.env` 에 `CLIENT_DIST` 를 `.../dist/index.html` 로 적는 오타 하나면
 *   화면이 아니라 **게임 전체가 안 뜬다.** `isDirectory()` 가 사는 것이 그것이고,
 *   `existsSync` 가 앞에 있는 것은 없는 경로에 `statSync` 를 부르면 ENOENT 로
 *   던지기 때문이다 — 둘은 한 벌이다.
 *
 * **`wildcard` 는 기본값(true)이다.** `false` 는 기동 시 파일마다 라우트를
 * 등록하는 모드다. 그것으로 바꿔 보고 실제로 깨지는 것을 쟀다:
 * - dist 를 갈아 끼워도 재시작 전까지 옛 목록이 남는다 — 사람이 손으로 밀어
 *   넣는 것이 이 프로젝트의 배포 절차라(docs/deploy-public.md 6단계) 밀어 넣은
 *   새 화면이 안 나오고, 그 증상은 "브라우저 캐시겠지"로 읽혀서 한참 헤맨다.
 * - dist 에 `api/` 아래 파일이 하나라도 있으면 게임 라우트와 이름이 겹쳐
 *   `FST_ERR_DUPLICATED_ROUTE` 로 **앱이 아예 안 뜬다.**
 *
 * (처음에는 한글 맵 파일 이름이 이 모드에서 깨질 것이라 적었는데, 재 보니
 * 안 깨졌다 — 라우터가 %-인코딩을 풀어 등록된 경로와 맞춘다. 위 둘이 실제 이유다.)
 *
 * **SPA 폴백은 두지 않는다.** 이 클라이언트에는 History API 라우터가 없다 —
 * 화면 전환이 전부 Zustand 상태이고 주소는 늘 `/` 하나다(grep: pushState·
 * popstate 0건). 없는 경로를 index.html 로 받아 주면 오타 난 API 호출이 404
 * 대신 HTML 을 받아, 클라이언트가 "JSON 이 아니다"로 엉뚱하게 죽는다.
 */
function serveClient(app: FastifyInstance, root: string | false): void {
  if (root === false) return
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    // "없어서"라고만 적지 않는다 — 파일을 가리킨 경우도 여기로 오고, 그때
    // 로그가 "없다"고 하면 운영자는 있는 파일을 앞에 두고 없다는 말을 읽는다.
    app.log.info(`클라이언트 dist 가 폴더로 있지 않아 정적 서빙을 붙이지 않는다: ${root}`)
    return
  }

  // 등록 순서는 신경 쓰지 않는다 — Fastify 라우터는 등록 순서가 아니라 경로
  // 구체성으로 고르므로 `/*` 를 먼저 등록해도 `/api/health` 가 이긴다(실측이자
  // clientDist.test.ts 가 못 박는 것). 순서에 기대는 코드를 쓰면 라우트를 옮기는
  // 날 게임 API 가 조용히 정적 파일 핸들러로 흘러간다.
  app.register(fastifyStatic, { root })
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
