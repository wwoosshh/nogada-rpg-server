import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance, FastifyServerOptions } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { CLIENT_DIST_ABSENT_LOG, CLIENT_DIST_NOT_DIR_LOG, buildApp } from './app.js'
import { buildTestApp } from './testSupport.js'

/**
 * 서버가 게임 화면을 **API 와 같은 오리진으로** 내주는가.
 *
 * 이 파일이 재는 것은 판정이 아니라 **라우터의 모양**이다: 정적 핸들러가
 * `/*` 로 앉은 뒤에도 게임 API 가 그대로 이기는가, dist 를 갈아 끼우면 재시작
 * 없이 새 파일이 나가는가, 한글 파일 이름이 %-인코딩으로 와도 열리는가.
 * 셋 다 손으로 확인하면 매번 브라우저를 열어야 하고, 그래서 안 하게 된다.
 *
 * 임시 폴더에 진짜 dist 를 만들어 재는 이유: `apps/client/dist` 에 기대면
 * 빌드해 둔 기계에서만 초록인 검사가 된다.
 */

/** 이 스위트가 만든 앱과 폴더. 하나라도 남기면 다음 실행이 옛 파일을 읽는다. */
const 정리: (() => void | Promise<void>)[] = []

afterEach(async () => {
  while (정리.length > 0) await 정리.pop()!()
})

/** 파일 몇 개를 담은 임시 dist 를 만든다. 키는 dist 안의 상대경로다. */
function 임시dist(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'nogada-dist-'))
  정리.push(() => rmSync(root, { recursive: true, force: true }))
  쓰기(root, files)
  return root
}

function 쓰기(root: string, files: Record<string, string>): void {
  for (const [name, body] of Object.entries(files)) {
    const file = join(root, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, body, 'utf8')
  }
}

/** 그 dist 를 내주는 앱. 세이브 파일은 임시 폴더에 둔다(buildTestApp 이 하던 일). */
async function 앱(
  clientDist: string | false,
  logger?: FastifyServerOptions['logger'],
): Promise<FastifyInstance> {
  const app = await buildTestApp({ clientDist, logger })
  정리.push(() => app.close())
  return app
}

/**
 * pino 가 뱉는 줄을 모아 **메시지만** 꺼낸다. 기동 로그는 눈으로 볼 수 없으므로
 * 받아 본다(config.test.ts 의 captureLines 와 같은 자세).
 *
 * 원문을 그대로 훑지 않는 이유: pino 는 JSON 한 줄씩 쓰는데, 윈도 경로의 `\` 가
 * 거기서 `\\` 로 이스케이프된다. 원문에 `C:\Users\...` 를 찾으면 로그에 그 경로가
 * **있는데도** 안 걸린다(실측으로 한 번 속았다).
 */
function 모은다(): { stream: Writable; 메시지들: () => string[] } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      chunks.push(chunk.toString())
      done()
    },
  })
  return {
    stream,
    메시지들: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => (JSON.parse(line) as { msg?: string }).msg ?? ''),
  }
}

describe('클라이언트 dist 서빙', () => {
  // 왜: 이 검사는 두 번 고쳐 썼다. 재 보니 **없는 폴더는 @fastify/static 이
  //     안 던지고**(전부 404 일 뿐), 게다가 그쪽도 경로를 담은 warn 을 스스로
  //     남긴다. 그래서 "서버가 뜬다"만 재도, "아무 줄에 그 경로가 있다"만 재도
  //     app.ts 의 안내 줄을 지운 구현이 초록이었다 — 플러그인의 영어 warn 이
  //     대신 걸렸기 때문이다. 재야 하는 것은 **우리가 우리 말로 남긴 그 줄**이다.
  it('dist 가 없으면 서버는 뜨고, 우리 말로 그 경로를 알린다', async () => {
    const 없는곳 = join(tmpdir(), 'nogada-없는-dist')
    const 줄 = 모은다()
    const app = await 앱(없는곳, { level: 'info', stream: 줄.stream })

    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    const 안내 = 줄.메시지들().find((m) => m.includes(CLIENT_DIST_ABSENT_LOG))
    expect(안내, '기동 로그에 안내가 없다 — "사이트가 404 다" 앞에서 볼 자리다').toBeDefined()
    // 경로가 함께 있어야 쓸모가 있다. "없다"만으로는 어디를 봐야 하는지 모른다.
    expect(안내).toContain(없는곳)
  })

  // 왜: **이 자리가 첫 릴리스다.** 서버 PC 는 정의상 첫 ship 전까지 dist 가 없고
  //     (거기엔 라이선스 에셋이 없어 빌드할 수 없다), 그래서 가장 처음 화면을
  //     옮기는 그 한 번이 정확히 "기동 때는 없었는데 나중에 생긴" 경우다.
  //     없으면 등록을 건너뛰던 구현은 여기서 사이트를 계속 404 로 두는데,
  //     ship-client.ps1 과 문서 셋은 그 순간 "재시작할 필요 없다"고 적는다 —
  //     운영자는 초록 스크립트를 손에 들고 404 앞에 선다.
  //
  //     위의 '갈아 끼우면' 검사는 이 자리를 못 지킨다: 그쪽은 dist 가 **기동
  //     시점에 이미 있던** 경우만 잰다.
  it('기동 뒤에 생긴 dist 도 재시작 없이 나간다 — 첫 ship 이 이 길이다', async () => {
    const 나중에 = join(tmpdir(), `nogada-나중-dist-${Date.now()}`)
    정리.push(() => rmSync(나중에, { recursive: true, force: true }))

    const app = await 앱(나중에)
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404)

    // 사람이 robocopy 로 밀어 넣는 그 순간.
    쓰기(나중에, { 'index.html': '첫 화면' })

    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode, '첫 ship 뒤에도 404 다 — 서비스를 껐다 켜야만 나온다').toBe(200)
    expect(res.body).toBe('첫 화면')
  })

  // 왜: **이쪽이 진짜로 서버를 죽이는 길이다**(실측: `"root" option must be a
  //     directory` 로 던진다). `.env` 에 `CLIENT_DIST` 를 `.../dist/index.html`
  //     로 적는 오타 하나면 그렇게 되고, 그때는 화면이 아니라 게임 전체가 안 뜬다.
  it('CLIENT_DIST 가 파일을 가리켜도 서버는 뜬다 — .env 오타 하나로 게임을 잃지 않는다', async () => {
    const root = 임시dist({ 'index.html': '<!doctype html>' })
    const 파일 = join(root, 'index.html')
    const 줄 = 모은다()
    const app = await 앱(파일, { level: 'info', stream: 줄.stream })

    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
    // "없다"가 아니라 "폴더가 아니다"라고 말해야 한다 — 여기서 운영자는 있는
    // 파일을 앞에 두고 로그를 읽는다.
    const 안내 = 줄.메시지들().find((m) => m.includes(CLIENT_DIST_NOT_DIR_LOG))
    expect(안내, '"없다"고 말하고 있다 — 있는 파일을 앞에 둔 사람이 읽을 줄이다').toBeDefined()
    expect(안내).toContain(파일)
  })

  it('/ 로 index.html 을 준다', async () => {
    const app = await 앱(임시dist({ 'index.html': '<!doctype html><title>노가다</title>' }))
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('노가다')
    expect(String(res.headers['content-type'])).toContain('text/html')
  })

  it('번들과 맵도 그대로 나간다 — 한글 파일 이름을 %-인코딩으로 물어도 연다', async () => {
    // 맵 id 가 한글이라 요청 URL 은 늘 %-인코딩되어 온다(11개). 디코딩을 어디선가
    // 놓치면 맵만 404 가 나고, 그 증상은 "게임은 떴는데 마을이 안 그려진다"로
    // 보여서 원인을 정적 서빙에서 찾지 않게 된다(vite dev 서버가 같은 이유로
    // 손수 decodeURIComponent 를 한다 — vite.config.ts 의 serveGeneratedMaps).
    const app = await 앱(
      임시dist({ 'assets/index-abc.js': 'console.log(1)', 'maps/항구마을.json': '{"놀이":true}' }),
    )

    const js = await app.inject({ method: 'GET', url: '/assets/index-abc.js' })
    expect(js.statusCode).toBe(200)
    expect(js.body).toBe('console.log(1)')

    const map = await app.inject({ method: 'GET', url: `/maps/${encodeURIComponent('항구마을')}.json` })
    expect(map.statusCode).toBe(200)
    expect(map.json()).toEqual({ 놀이: true })
  })

  // 왜: **이것이 이 변경에서 가장 조용히 깨질 수 있는 것이다.** `/*` 가 앉은
  //     뒤에 게임 API 가 정적 핸들러로 흘러가면 모든 요청이 404 HTML 을 받고,
  //     클라이언트는 "JSON 이 아니다"로 죽는다. dist 안에 같은 이름의 파일을
  //     **일부러 심어** 둔 채로 재는 이유는, 파일이 없으면 이 검사가 "우연히
  //     통과"하기 때문이다.
  //
  //     이 자리가 실제로 무엇을 잡는지 재 봤다: `wildcard: false` 로 바꾸면
  //     기동 시 파일마다 라우트를 등록하다가 `FST_ERR_DUPLICATED_ROUTE` 로
  //     **앱이 아예 안 뜬다**(전부 500). 등록 순서가 아니라 그 모드가 위험한
  //     것이고, 그래서 기본값을 지키는 것이 판단이다.
  it('게임 API 가 정적 파일보다 이긴다 — dist 에 같은 이름이 있어도', async () => {
    const app = await 앱(
      임시dist({
        'index.html': '<!doctype html>',
        'api/health': '이건 파일이지 라우트가 아니다',
        'api/time': '이것도',
      }),
    )

    const health = await app.inject({ method: 'GET', url: '/api/health' })
    expect(health.statusCode).toBe(200)
    expect((health.json() as { ok: boolean }).ok).toBe(true)

    const time = await app.inject({ method: 'GET', url: '/api/time' })
    expect(time.statusCode).toBe(200)
    expect((time.json() as { serverNowMs: number }).serverNowMs).toBeGreaterThan(0)
  })

  // 왜: SPA 폴백을 두지 않기로 한 판단을 못 박는다(app.ts 의 serveClient).
  //     이 클라이언트에는 History API 라우터가 없으므로 폴백은 얻는 것 없이
  //     오타 난 API 호출을 404 대신 HTML 로 만든다.
  it('없는 경로는 index.html 이 아니라 404 다 — SPA 폴백을 두지 않았다', async () => {
    const app = await 앱(임시dist({ 'index.html': '<!doctype html><title>노가다</title>' }))

    for (const url of ['/api/nope', '/없는파일.js']) {
      const res = await app.inject({ method: 'GET', url })
      expect({ url, status: res.statusCode }).toEqual({ url, status: 404 })
      expect(res.body).not.toContain('노가다')
    }
  })

  // 왜: dist 는 **서버 PC 의 저장소 안**에 있다(apps/client/dist). 그 폴더 밖으로
  //     한 칸만 나가면 `apps/server/.env` 가 있고 거기에 DB 비밀번호가 있다.
  //     지금은 라우터가 경로를 먼저 정규화해서 `..` 이 사라지지만, 그것은
  //     @fastify/static 의 방어가 아니라 그 앞단의 성질이라 자를 대 둔다.
  it('dist 밖을 가리키는 요청은 열리지 않는다 — 인코딩해서 물어도', async () => {
    const root = 임시dist({ 'index.html': '<!doctype html>' })
    // 형제 폴더에 비밀을 하나 둔다 — 한 칸이라도 나가지면 이 글자가 응답에 실린다.
    const 비밀 = join(root, '..', 'nogada-비밀.txt')
    writeFileSync(비밀, 'DATABASE_URL=postgres://...', 'utf8')
    정리.push(() => rmSync(비밀, { force: true }))

    const app = await 앱(root)
    for (const url of ['/../nogada-비밀.txt', '/%2e%2e/nogada-비밀.txt', '/..%2fnogada-비밀.txt']) {
      const res = await app.inject({ method: 'GET', url })
      expect({ url, status: res.statusCode }).toEqual({ url, status: 404 })
      expect(res.body).not.toContain('DATABASE_URL')
    }
  })

  // 왜: 이 프로젝트의 배포는 사람이 dist 를 서버 PC 로 밀어 넣는 것이다
  //     (docs/deploy-public.md 6단계). `wildcard: false` 는 기동 시 파일마다
  //     라우트를 등록하므로, 그 모드로 바꾸면 밀어 넣은 새 화면이 **서비스를
  //     재시작할 때까지 안 나온다** — 그리고 그 실패는 "브라우저 캐시겠지"로
  //     읽혀서 한참을 헤맨다.
  it('dist 를 갈아 끼우면 재시작 없이 새 파일이 나간다', async () => {
    const root = 임시dist({ 'index.html': '옛것' })
    const app = await 앱(root)

    expect((await app.inject({ method: 'GET', url: '/' })).body).toBe('옛것')

    쓰기(root, { 'index.html': '새것', 'assets/새-번들.js': 'console.log(2)' })

    expect((await app.inject({ method: 'GET', url: '/' })).body).toBe('새것')
    // 기동 뒤에 **새로 생긴** 파일도 열려야 한다 — 릴리스마다 번들 이름이 바뀐다.
    const 새번들 = await app.inject({ method: 'GET', url: `/assets/${encodeURIComponent('새-번들')}.js` })
    expect(새번들.statusCode).toBe(200)
  })

  // 왜: @fastify/static 의 `dotfiles` 기본값은 `'allow'` 라(index.js:56) 옵션을
  //     안 적으면 root 아래 숨김 파일이 **본문까지 그대로 나간다**(실측: 200).
  //     지금 dist 에는 dotfile 이 하나도 없지만 `CLIENT_DIST` 는 사람이 `.env` 에
  //     손으로 적는 값이고, **한 칸 위인 `apps/client` 를 적는 오타는 위의 방어를
  //     전부 통과한다**(폴더가 맞으니까) — 그 폴더 안에 `.env.local` 이 있다.
  it('숨김 파일은 안 나간다 — CLIENT_DIST 를 한 칸 위로 적는 오타가 있다', async () => {
    const app = await 앱(임시dist({ 'index.html': '<!doctype html>', '.env.local': 'SECRET=1' }))

    const res = await app.inject({ method: 'GET', url: '/.env.local' })
    // 404 다. `'deny'`(403)가 아닌 이유는 app.ts 에 적었다 — 없는 것과 못 주는
    // 것의 답이 같아야 밖에서 읽을 것이 없다.
    expect({ status: res.statusCode }, 'dotfiles 기본값(allow)이 그대로다').toEqual({ status: 404 })
    expect(res.body).not.toContain('SECRET=1')
  })

  // 왜: 스크립트와 문서가 "밀어 넣으면 다음 요청부터 새 화면" 이라고 약속하는데
  //     `index.html` 은 이름에 해시가 안 붙는 유일한 파일이라, 캐시가 그 약속을
  //     깰 수 있는 자리다. 지금 나가는 헤더가 그것을 막는다: `max-age=0` 이면
  //     브라우저는 평범한 방문에서도 조건부 요청을 보내고 ETag 로 바뀐 것을 그
  //     자리에서 받는다(그래서 문서의 '강력 새로고침' 안내를 지웠다 — 실측 전에
  //     적힌 말이었다). 누가 `maxAge` 를 켜는 날 여기가 빨개져야 한다.
  it('index.html 응답은 매 요청 재검증된다 — 강력 새로고침이 필요 없는 근거다', async () => {
    const app = await 앱(임시dist({ 'index.html': '<!doctype html>' }))
    const res = await app.inject({ method: 'GET', url: '/' })

    expect(String(res.headers['cache-control'])).toContain('max-age=0')
    expect(res.headers.etag, 'ETag 가 없으면 재검증이 매번 전부 다시 받는 것이 된다').toBeDefined()
  })
})

/**
 * **런북이 인용한 문구가 실제 로그와 같은가.**
 *
 * docs/deploy-windows.md 는 "사이트가 404 면 기동 로그에서 이 줄을 찾아라"라고
 * 글자 그대로 인용한다. 코드가 남기는 줄과 한 글자만 어긋나면 그 지시는 grep
 * 0건이 되고, 그 자리에 선 사람은 자기가 잘못 본 줄 안다 — 실제로 어긋나 있었다.
 * 문서에는 자를 댈 곳이 없으므로 **여기 한 줄로 묶어 둔다.**
 */
describe('런북의 인용', () => {
  it('deploy-windows.md 가 기동 로그를 글자 그대로 인용한다', () => {
    const 런북 = fileURLToPath(new URL('../../../docs/deploy-windows.md', import.meta.url))
    expect(readFileSync(런북, 'utf8')).toContain(CLIENT_DIST_ABSENT_LOG)
  })
})

/**
 * 파서가 맞아도 **앱이 그것을 안 부르면** 화면은 안 나온다.
 *
 * 위 스위트는 이 자리를 못 지킨다 — `clientDist` 를 손으로 넘기므로 app.ts 의
 * `parseClientDist(process.env.CLIENT_DIST)` 한 줄을 아예 지나지 않는다. 그
 * 줄이 사라져도 위 전부가 초록이고, 그러면 서버 PC 의 `.env` 는 아무 말도
 * 못 하는 값이 된다(config.test.ts 의 '로거 배선' 과 같은 함정이다).
 */
describe('CLIENT_DIST 배선', () => {
  it('환경변수가 가리키는 폴더를 실제로 내준다', async () => {
    const root = 임시dist({ 'index.html': '환경변수가 가리킨 것' })
    const dir = mkdtempSync(join(tmpdir(), 'nogada-배선-'))
    정리.push(() => rmSync(dir, { recursive: true, force: true }))

    const before = process.env.CLIENT_DIST
    process.env.CLIENT_DIST = root
    정리.push(() => {
      if (before === undefined) delete process.env.CLIENT_DIST
      else process.env.CLIENT_DIST = before
    })

    // buildTestApp 은 `clientDist: false` 를 못 박으므로 여기서는 buildApp 을
    // 직접 세운다 — 재려는 것이 바로 그 기본값이다.
    const app = await buildApp({ dataFile: join(dir, 'players.json'), logger: false })
    정리.push(() => app.close())

    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('환경변수가 가리킨 것')
  })
})
