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
  // 배포에서는 `CORS_ORIGIN` 이 목록을 좁히고, **적지 않으면 아무 데도 안 준다** —
  // 빈 값의 뜻이 개발 콘솔과 그 밖에서 갈린다(config.ts 의 parseCorsOrigin).
  // 웹은 이제 서버가 같은 오리진으로 내주므로(아래 serveClient) 목록이 필요한 것은
  // **APK 뿐**이고, 그때 적을 오리진은 `https://localhost` 다 — `capacitor://` 가
  // 아니다(config.ts 의 parseCorsOrigin 에 실측 근거). x-server-now 는 커스텀
  // 헤더라 명시하지 않으면 브라우저가 읽지 못한다.
  //
  // `NODE_ENV`·isTTY 를 여기서 함께 넘기는 이유는 아래 `devConsole` 과 **같은
  // 물음**이기 때문이다. 셋(요청 로그·500 리댁션·CORS)이 갈라져 판정하면
  // 언젠가 하나만 고쳐지고, 그날 배포는 반쪽이 된다.
  app.register(cors, {
    origin: parseCorsOrigin(process.env.CORS_ORIGIN, process.env.NODE_ENV, process.stdout.isTTY),
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
 * 기동 로그의 두 문구. **문서가 글자 그대로 인용하는 값이라** 상수로 둔다.
 *
 * docs/deploy-windows.md 의 런북은 "사이트가 404 면 기동 로그에서 이 줄을 찾아라"
 * 라고 가리킨다. 코드와 문서가 한 글자만 어긋나도 그 지시는 grep 0건이 되고,
 * 그 자리에 선 사람은 자기가 잘못 본 줄 안다 — 실제로 어긋나 있었다(검토가
 * 잡았다). clientDist.test.ts 가 로그와 **문서 양쪽**을 이 상수로 잰다.
 */
export const CLIENT_DIST_ABSENT_LOG =
  '클라이언트 dist 가 아직 없다 — 밀어 넣으면 재시작 없이 나간다'
export const CLIENT_DIST_NOT_DIR_LOG = '클라이언트 dist 가 폴더가 아니라 정적 서빙을 붙이지 않는다'

/**
 * 게임 화면을 **API 와 같은 오리진으로** 내준다.
 *
 * 이 한 등록이 공개 배포의 절반이다(docs/deploy-public.md 1장): 오리진이 하나면
 * CORS 도, HTTPS 페이지가 평문 API 를 부르는 혼합 콘텐츠도, 안드로이드의 평문
 * 차단도, 주소가 바뀔 때의 재빌드도 **애초에 생기지 않는다.** 각각을 따로 고치는
 * 것보다 싸다.
 *
 * **dist 가 없어도 등록은 한다.** dist 는 빌드 생성물이라 저장소에 없고, 개발도
 * 테스트도 그것 없이 서버를 띄운다. 그런데 **서버 PC 는 정의상 첫 ship 전까지
 * dist 가 없다**(라이선스 에셋이 없어 거기서 빌드할 수 없다 — config.ts 의
 * `CLIENT_DIST`). 없으면 등록을 건너뛰던 앞의 코드는 바로 그 **가장 처음 옮기는
 * 한 번**을 밟았다: 사람이 dist 를 밀어 넣어도 서비스를 껐다 켜기 전까지 사이트가
 * 404 인데, 스크립트와 문서 셋은 그 순간 "재시작할 필요 없다"고 적는다. 운영자는
 * 초록 스크립트를 손에 들고 404 앞에 서게 된다(검토가 실측으로 잡아냈다).
 *
 * 이 자리를 실측했다. **처음 생각한 것과 달랐다:**
 * - **없는 폴더는 @fastify/static 이 안 던진다.** 등록도 `ready` 도 통과하고
 *   전부 404 를 줄 뿐이며, **나중에 생긴 파일을 재시작 없이 그대로 내준다**
 *   (없는 root 로 띄운 앱에 폴더를 만들어 index.html 을 넣자 그 자리에서 200).
 *   게다가 그쪽도 경로를 담은 warn 을 스스로 남긴다(`"root" path "..." must
 *   exist`). 그래서 `existsSync` 는 **등록 여부가 아니라 로그 문구만** 고른다 —
 *   운영자에게 우리 말로, 우리가 문서에서 가리킨 자리에(docs/deploy-windows.md)
 *   한 줄 남기기 위한 것이다.
 * - **파일을 가리키면 던진다**(`"root" option must be a directory`). 등록을
 *   건너뛰는 유일한 경우가 이쪽이다: `.env` 에 `CLIENT_DIST` 를
 *   `.../dist/index.html` 로 적는 오타 하나면 화면이 아니라 **게임 전체가 안
 *   뜬다.** `existsSync` 가 앞에 있는 것은 없는 경로에 `statSync` 를 부르면
 *   ENOENT 로 던지기 때문이다.
 *
 * **`dotfiles` 를 막는다.** 라이브러리 기본값은 `'allow'` 이고(index.js:56),
 * 그대로 두면 root 아래 숨김 파일이 그대로 나간다(실측: `.env.local` 을 두고
 * 물으면 200 에 본문까지). 지금 dist 에는 dotfile 이 하나도 없지만 `CLIENT_DIST`
 * 는 사람이 `.env` 에 손으로 적는 값이고, **한 칸 위인 `apps/client` 를 적는
 * 오타는 위의 방어를 전부 통과한다**(폴더가 맞으니까) — 그 폴더 안에
 * `.env.local` 과 `src/` 가 통째로 있다.
 *
 * `'deny'`(403) 가 아니라 `'ignore'`(404) 인 이유는 **dotfile 의 답을 "그런 건
 * 없다"와 같게 두기 위해서**다. `'deny'` 면 `/.env.local` 이 403 이 되어, 아무
 * 파일도 안 주면서 **"이 서버에는 dotfile 규칙이 있다"를 알려 준다.**
 *
 * 오래 여기 "403 은 거기 뭔가 있다를 알려 준다"고 적혀 있었는데 **그건 틀렸다.**
 * 재 봤다: `'deny'` 에서 있는 dotfile 과 없는 dotfile 이 **둘 다 403** 이다.
 * 403 이 말하는 것은 파일의 존재가 아니라 **경로의 꼴**이다. 판단(=`'ignore'`)은
 * 그대로지만 근거가 달랐다.
 *
 * **그리고 답은 실제로 하나가 아니다.** 같은 자리에 "없는 것도 못 주는 것도 전부
 * 404" 라고 적혀 있던 것도 틀렸다 — `..` 을 담은 경로는 `dotfiles` 값과 무관하게
 * **403** 이다(그 거절은 `send` 의 경로 해석에서 나오지 이 옵션에서 나오지 않는다).
 * 실측:
 *
 * ```
 * /../nogada-비밀.txt        403      /nosuchfile.txt   404
 * /..%5cnogada-비밀.txt      403      /.env.local       404
 * /../../../windows/win.ini  403
 * ```
 *
 * **그 갈림을 없애지 않기로 했다.** 근거 셋:
 * - **403 은 파일시스템에 대해 아무것도 말하지 않는다.** 있는 이웃과 없는 이웃이
 *   같은 403 이고, 여섯 칸 위로 올라가는 경로도 같은 403 이다(위 실측). 밖에서
 *   이 코드로 셀 수 있는 것이 없다 — dotfiles 를 404 로 둔 저울과 어긋나지 않는다.
 * - **404 로 뭉치려면 우리가 URL 정규화를 앞단에 써야 한다.** 경로 이탈 버그가
 *   태어나는 자리가 정확히 그런 코드다. 새는 것 없는 라이브러리의 거절을,
 *   아무것도 안 새는 상태 코드 하나 때문에 우리 코드로 바꾸는 것은 남는 장사가
 *   아니다.
 * - **403 은 우리 쪽에 값이 있다.** 요청 로그에서 "누가 `..` 을 던졌다"와 "링크가
 *   깨졌다"가 갈린다. 모니터링이 아직 없는 채로 공개하는 서버다
 *   (docs/deploy-public.md 7장).
 *
 * `clientDist.test.ts` 가 이 셋을 **원시 소켓으로** 잰다 — `app.inject` 는 경로를
 * 먼저 정규화해서 프로덕션과 다른 것을 재기 때문이다(검토가 잡았다).
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

  const 있다 = existsSync(root)
  if (있다 && !statSync(root).isDirectory()) {
    // 두 경우를 한 문장으로 뭉뚱그리지 않는다 — 파일을 가리킨 경우에 로그가
    // "없다"고 하면 운영자는 있는 파일을 앞에 두고 없다는 말을 읽는다.
    app.log.info(`${CLIENT_DIST_NOT_DIR_LOG}: ${root}`)
    return
  }
  // 없어도 등록은 한다. 남기는 것은 "왜 지금 404 인가"의 답이지 포기가 아니다.
  if (!있다) app.log.info(`${CLIENT_DIST_ABSENT_LOG}: ${root}`)

  // 등록 순서는 신경 쓰지 않는다 — Fastify 라우터는 등록 순서가 아니라 경로
  // 구체성으로 고르므로 `/*` 를 먼저 등록해도 `/api/health` 가 이긴다(실측이자
  // clientDist.test.ts 가 못 박는 것). 순서에 기대는 코드를 쓰면 라우트를 옮기는
  // 날 게임 API 가 조용히 정적 파일 핸들러로 흘러간다.
  app.register(fastifyStatic, { root, dotfiles: 'ignore' })
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
