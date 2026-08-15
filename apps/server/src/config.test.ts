import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { LightMyRequestResponse } from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import {
  LOG_CENSOR,
  isDevConsole,
  parseClientDist,
  parseCorsOrigin,
  parseListen,
  parseLogger,
  parseTrustProxy,
  type LoggerSetting,
} from './config.js'
import { JsonPersistence } from './state/jsonPersistence.js'
import { buildTestApp } from './testSupport.js'

describe('parseListen', () => {
  it('아무것도 없으면 지금까지 서던 자리 그대로다 — 이 변경으로 아무것도 안 깨져야 한다', () => {
    // 개발 중에는 폰·다른 기계가 LAN 으로 붙고 지금 운영도 Tailscale 주소로
    // 닿는다. 기본을 좁히는 순간 그것들이 조용히 끊긴다.
    expect(parseListen(undefined, undefined)).toEqual({ host: '0.0.0.0', port: 3000 })
  })

  it('HOST 로 좁힐 수 있다 — 터널 뒤에서는 127.0.0.1 하나만 연다', () => {
    expect(parseListen('127.0.0.1', undefined)).toEqual({ host: '127.0.0.1', port: 3000 })
    expect(parseListen(' 127.0.0.1 ', ' 8080 ')).toEqual({ host: '127.0.0.1', port: 8080 })
  })

  it('빈 값은 "안 정했다"로 읽는다 — .env 에 이름만 남기는 일이 흔하다', () => {
    // 빈 호스트를 그대로 넘기면 listen 이 터지고, 빈 포트는 Number('') = 0 이라
    // "아무 빈 포트나" 가 된다 — 서버는 멀쩡히 뜨고 아무도 못 찾는다.
    expect(parseListen('', '')).toEqual({ host: '0.0.0.0', port: 3000 })
    expect(parseListen('   ', '   ')).toEqual({ host: '0.0.0.0', port: 3000 })
  })
})

describe('parseClientDist', () => {
  it('기본은 이 저장소의 apps/client/dist 다 — 절대경로로 준다', () => {
    const 기본 = parseClientDist(undefined)
    expect(isAbsolute(기본)).toBe(true)
    expect(기본.replace(/\\/g, '/')).toMatch(/\/apps\/client\/dist$/)
    // **어디서 띄웠는가에 흔들리면 안 된다.** WinSW 는 apps\server 에서,
    // 개발은 저장소 루트에서 띄운다(docs/deploy-windows.md 의 workingdirectory).
    // 같은 값이 두 자리에서 다른 폴더를 가리키면 한쪽만 그림 없는 사이트가 뜬다.
    expect(기본).toBe(fileURLToPath(new URL('../../client/dist', import.meta.url)))
  })

  it('빈 값은 "안 정했다"로 읽는다 — resolve("") 는 저장소를 통째로 내놓는다', () => {
    // `.env` 에 `CLIENT_DIST=` 한 줄만 남기는 일이 흔한데, 그 빈 문자열을
    // 경로로 넘기면 현재 작업 디렉터리가 웹 루트가 된다. 여기서 걸러야 한다.
    //
    // **기대값을 `parseClientDist(undefined)` 로 적으면 안 된다.** 빈 값 처리를
    // 통째로 지워도 둘 다 `resolve('')` 로 같아져서 이 검사가 초록으로 남는다
    // (실측으로 확인했다). 두 값을 서로 견주는 대신 **저장소 안의 그 자리**와
    // 견주어야 한다.
    const dist = fileURLToPath(new URL('../../client/dist', import.meta.url))
    expect(parseClientDist('')).toBe(dist)
    expect(parseClientDist('   ')).toBe(dist)
    // 그리고 그것이 cwd 가 아니어야 한다 — 자를 대는 자리가 바로 여기다.
    expect(parseClientDist('')).not.toBe(resolve(''))
  })

  it('적힌 경로를 절대경로로 만든다 — 상대경로의 기준은 띄운 자리다', () => {
    expect(parseClientDist(' ./어떤/dist ')).toBe(resolve('./어떤/dist'))
    const 절대 = resolve('/nogada-server/화면')
    expect(parseClientDist(절대)).toBe(절대)
  })
})

describe('parseCorsOrigin', () => {
  it('없거나 비어 있으면 전부 허용한다 — 개발 PC 가 그 상태다', () => {
    expect(parseCorsOrigin(undefined)).toBe(true)
    expect(parseCorsOrigin('')).toBe(true)
    expect(parseCorsOrigin('   ')).toBe(true)
    expect(parseCorsOrigin(',, ,')).toBe(true)
  })

  it('별표도 전부 허용이다', () => {
    expect(parseCorsOrigin('*')).toBe(true)
    expect(parseCorsOrigin('https://nogada.example, *')).toBe(true)
  })

  it('쉼표로 나누고 공백을 떼고 빈 칸을 버린다', () => {
    expect(parseCorsOrigin(' https://a.example , , http://b.example:5173 ')).toEqual([
      'https://a.example',
      'http://b.example:5173',
    ])
  })

  it('안드로이드 빌드의 출처를 그대로 통과시킨다', () => {
    // capacitor://localhost 는 웹 주소가 아니라 잘라 내거나 고치면 앱에서만 막힌다.
    expect(parseCorsOrigin('capacitor://localhost,http://localhost')).toEqual([
      'capacitor://localhost',
      'http://localhost',
    ])
  })

  it('끝의 슬래시를 떼어 낸다 — 주소창에서 복사하면 붙어 온다', () => {
    expect(parseCorsOrigin('https://a.example/')).toEqual(['https://a.example'])
    expect(parseCorsOrigin('https://a.example///')).toEqual(['https://a.example'])
  })
})

describe('parseTrustProxy', () => {
  it('없으면 끈다 — 직접 노출된 서버에서 켜면 IP 백오프가 무력해진다', () => {
    expect(parseTrustProxy(undefined)).toBe(false)
    expect(parseTrustProxy('')).toBe(false)
    expect(parseTrustProxy('  ')).toBe(false)
  })

  it('말로 끄고 켠다', () => {
    expect(parseTrustProxy('true')).toBe(true)
    expect(parseTrustProxy('ON')).toBe(true)
    expect(parseTrustProxy('yes')).toBe(true)
    expect(parseTrustProxy('false')).toBe(false)
    expect(parseTrustProxy('off')).toBe(false)
    expect(parseTrustProxy('no')).toBe(false)
  })

  it('숫자는 홉 수다 — 1 은 "전부 믿는다"가 아니라 "한 대만 믿는다"다', () => {
    expect(parseTrustProxy('1')).toBe(1)
    expect(parseTrustProxy('2')).toBe(2)
    expect(parseTrustProxy('0')).toBe(0)
  })

  it('주소 목록은 목록으로 넘긴다', () => {
    expect(parseTrustProxy('127.0.0.1, 172.18.0.0/16')).toEqual(['127.0.0.1', '172.18.0.0/16'])
  })
})

/**
 * 파서가 맞아도 그 값이 앱에 실리지 않으면 아무 소용이 없다 — 실제로 세운
 * 서버가 목록대로 답하는지 본다. 특히 `x-server-now` 노출은 이 변경에서
 * 잃기 가장 쉬운 것이라(오리진 옵션만 갈아 끼우다 함께 지워진다) 매번 확인한다.
 */
describe('CORS 배선', () => {
  it('허용 목록 안의 오리진에는 허용과 노출 헤더를 함께 준다', async () => {
    const res = await withEnv({ CORS_ORIGIN: 'https://nogada.example' }, async () => {
      const app = await buildTestApp()
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://nogada.example' },
      })
      await app.close()
      return response
    })

    expect(res.headers['access-control-allow-origin']).toBe('https://nogada.example')
    // 시계 동기화가 이 헤더 하나에 달려 있다(설계 규범 9).
    expect(String(res.headers['access-control-expose-headers'])).toContain('x-server-now')
  })

  it('목록 밖의 오리진에는 허용 헤더를 주지 않는다', async () => {
    const res = await withEnv({ CORS_ORIGIN: 'https://nogada.example' }, async () => {
      const app = await buildTestApp()
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { origin: 'https://stranger.example' },
      })
      await app.close()
      return response
    })

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    // 서버가 거절하는 것이 아니라 브라우저가 막는 것이다 — 응답 자체는 200 이다.
    expect(res.statusCode).toBe(200)
  })
})

describe('isDevConsole', () => {
  it('콘솔이 붙어 있으면 개발이다', () => {
    expect(isDevConsole(undefined, true)).toBe(true)
    expect(isDevConsole('development', true)).toBe(true)
  })

  it('서비스로 도는 자리는 개발이 아니다 — NODE_ENV 가 없어도 그렇다', () => {
    // 이 한 줄이 이 판정의 전부다. WinSW XML 은 NODE_ENV 를 놓지 않으므로
    // (docs/deploy-windows.md), NODE_ENV 만 보던 시절의 배포는 개발과 구별되지
    // 않았고 그래서 로그가 한 줄도 안 남았다. stdout 이 파일로 흘러가는 것이
    // 그 자리를 가르는 유일한 신호다.
    expect(isDevConsole(undefined, undefined)).toBe(false)
    expect(isDevConsole(undefined, false)).toBe(false)
  })

  it('production 은 콘솔이 붙어 있어도 배포다 — 컨테이너를 -t 로 들여다볼 때', () => {
    expect(isDevConsole('production', true)).toBe(false)
    expect(isDevConsole(' production ', true)).toBe(false)
  })
})

describe('parseLogger', () => {
  it('컨테이너는 아무 설정 없이도 말을 한다 — .env 를 고치지 않아도 info 다', () => {
    // 미니PC 의 .env 는 커밋되지 않아 우리가 고칠 수 없다. 그 파일이 LOG_LEVEL 을
    // 모르는 채로도 배포된 서버가 로그를 남기지 않으면 이 변경은 헛것이다.
    expect(parseLogger(undefined, 'production', undefined)).toMatchObject({ level: 'info' })
  })

  it('윈도 서비스도 아무 설정 없이 말을 한다 — NODE_ENV 가 없는 그 자리다', () => {
    // 실제 배포는 컨테이너가 아니라 WinSW 다. 그쪽은 NODE_ENV 도 LOG_LEVEL 도
    // 없이 뜨고 stdout 은 로그 파일로 간다 — 여기가 초록이 아니면 공개한 서버는
    // 무슨 일이 나도 볼 것이 없다.
    expect(parseLogger(undefined, undefined, undefined)).toMatchObject({ level: 'info' })
  })

  it('테스트에서는 무조건 끈다 — LOG_LEVEL 이 있어도, 콘솔이 붙어 있어도', () => {
    // 셸에 남은 환경변수 하나로 테스트 출력이 사람마다 달라지면 안 된다.
    expect(parseLogger(undefined, 'test', true)).toBe(false)
    expect(parseLogger('debug', 'test', true)).toBe(false)
    expect(parseLogger('info', 'test', undefined)).toBe(false)
  })

  it('개발 PC 는 조용한 쪽이 기본이다 — 지금까지 조용했다', () => {
    // 콘솔이 붙어 있다는 것이 개발이라는 뜻이다. pnpm·tsx watch 를 지나도
    // isTTY 가 살아 남는 것을 실측했다(config.ts 의 isDevConsole).
    expect(parseLogger(undefined, undefined, true)).toBe(false)
    expect(parseLogger('', 'development', true)).toBe(false)
  })

  it('심각도를 말한 대로 받는다', () => {
    expect(parseLogger('debug', 'production', undefined)).toMatchObject({ level: 'debug' })
    expect(parseLogger(' WARN ', undefined, true)).toMatchObject({ level: 'warn' })
    expect(parseLogger('trace', 'development', true)).toMatchObject({ level: 'trace' })
  })

  it('끄는 말은 배포에서도 끈다', () => {
    for (const word of ['off', 'none', 'silent', 'false', 'no', '0', 'OFF']) {
      expect(parseLogger(word, 'production', undefined)).toBe(false)
    }
  })

  it('모르는 값은 info 로 간다 — 오타 한 글자로 서버가 안 뜨면 안 된다', () => {
    // pino 는 모르는 심각도를 받으면 기동 중에 던진다. 여기서 흡수하지 않으면
    // `LOG_LEVEL=Verbose` 한 줄이 배포를 통째로 세운다.
    expect(parseLogger('verbose', 'production', undefined)).toMatchObject({ level: 'info' })
    expect(parseLogger('아무말', 'production', undefined)).toMatchObject({ level: 'info' })
  })

  it('자격증명이 실릴 수 있는 이름을 모두 가린다', () => {
    const setting = parseLogger('info', 'production', undefined)
    if (setting === false) throw new Error('꺼져 있으면 안 된다')

    // Fastify 는 `req`, 손으로 적으면 `request`, 헤더만 넘기면 `headers` 다.
    // 하나만 적으면 나머지 둘로 새어 나간다.
    for (const path of [
      'req.headers.authorization',
      'request.headers.authorization',
      'headers.authorization',
      'password',
      '*.password',
      'req.body.password',
      'token',
      '*.token',
    ]) {
      expect(setting.redact.paths).toContain(path)
    }
    expect(setting.redact.censor).toBe(LOG_CENSOR)
  })

  it('목록을 앱마다 새로 준다 — 공유하면 한쪽이 건드릴 때 다른 쪽까지 바뀐다', () => {
    const a = parseLogger('info', 'production', undefined)
    const b = parseLogger('info', 'production', undefined)
    if (a === false || b === false) throw new Error('꺼져 있으면 안 된다')
    expect(a.redact.paths).not.toBe(b.redact.paths)
  })
})

/**
 * 설정이 맞아도 실제로 지워지지 않으면 소용이 없다 — 진짜 앱에 진짜 pino 를
 * 붙이고, 받아 본 줄에 무엇이 남았는지 글자로 확인한다.
 */
describe('요청 로그 배선', () => {
  const TOKEN = '토큰이라면-이런-모양이다-abcdef123456'
  const PASSWORD = '비밀번호-nogada-1234'

  it('요청 한 줄이 남고, 그 줄에 토큰도 비밀번호도 없다', async () => {
    const lines = captureLines()
    const app = await buildTestApp({ logger: { ...deployLogger(), stream: lines.stream } })
    // 가장 위험한 요청이다 — 헤더에 토큰이, 본문에 비밀번호가 함께 실린다.
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { username: '아무개', password: PASSWORD },
    })
    await app.close()

    const text = lines.text()
    // 남기는 하는가. 이것이 없으면 아래 두 단정은 "아무것도 안 남겼다"로도 통과한다.
    expect(text).toContain('/api/auth/login')
    expect(text).toContain('"statusCode"')
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(PASSWORD)
  })

  it('헤더가 로그에 실리게 되는 날에도 Authorization 은 가려진다', async () => {
    // 오늘 Fastify 의 기본 직렬화기는 헤더를 아예 싣지 않는다. 그래서 위 테스트만
    // 두면 리댁션이 통째로 빠져도 초록이다. 디버깅하려고 직렬화기를 갈아 끼우는
    // 날은 오고, 그 한 줄은 리뷰에서 위험해 보이지 않는다 — 그날 이 설정이
    // 그물이 되는지를 지금 확인해 둔다.
    const lines = captureLines()
    const app = await buildTestApp({
      logger: {
        ...deployLogger(),
        stream: lines.stream,
        serializers: {
          req: (req: { method: string; url: string; headers: unknown }) => ({
            method: req.method,
            url: req.url,
            headers: req.headers,
          }),
        },
      },
    })
    await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    await app.close()

    const text = lines.text()
    expect(text).toContain('"authorization"')
    expect(text).toContain(LOG_CENSOR)
    expect(text).not.toContain(TOKEN)
  })
})

/**
 * 파서가 맞아도 **앱이 그것을 안 부르면** 로그는 여전히 안 남는다.
 *
 * 위 '요청 로그 배선' 은 이 자리를 못 지킨다 — `buildTestApp({ logger })` 로
 * 로거를 손수 앉히므로 app.ts 의 판정을 아예 지나지 않는다. parseLogger 단위
 * 검사도 인자를 손으로 넘기니 무사하다. 그래서 셋째 인자를 `true` 로 굳혀
 * (= 늘 개발인 척) 놓아도 여태 전부 초록이었다 — 그러면 WinSW 서비스는
 * `LOG_LEVEL` 을 적지 않는 한 다시 한 줄도 안 남긴다.
 */
describe('로거 배선', () => {
  it('아무 설정 없는 서비스 자리에서는 info 로 말한다', async () => {
    expect(await levelOf({ NODE_ENV: undefined, LOG_LEVEL: undefined }, undefined)).toBe('info')
  })

  it('콘솔이 붙은 개발에서는 그대로 조용하다 — 이 변경이 개발을 시끄럽게 하면 안 된다', async () => {
    // `logger: false` 이면 Fastify 가 no-op 로거를 앉히고, 그것에는 level 이
    // 없다(실측: undefined). "조용하다"를 이 값으로 읽는다.
    expect(await levelOf({ NODE_ENV: undefined, LOG_LEVEL: undefined }, true)).toBeUndefined()
  })

  it('LOG_LEVEL 을 적으면 그 말이 앱까지 간다', async () => {
    expect(await levelOf({ NODE_ENV: undefined, LOG_LEVEL: 'warn' }, undefined)).toBe('warn')
  })
})

/**
 * 앱을 **실제로 세워서** 그 로거의 심각도를 본다.
 *
 * `buildTestApp` 을 안 쓰는 이유: 그쪽은 조용함을 못 박으므로(testSupport.ts 의
 * `logger: appOptions.logger ?? false`) 배선을 지나지 않는다. 여기서 재려는 것이
 * 바로 그 배선이다.
 */
async function levelOf(
  vars: Record<string, string | undefined>,
  isTty: boolean | undefined,
): Promise<string | undefined> {
  return withConsole(vars, isTty, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nogada-로거-'))
    const app = await buildApp({ dataFile: join(dir, 'players.json') })
    const level = (app.log as { level?: string }).level
    await app.close()
    rmSync(dir, { recursive: true, force: true })
    return level
  })
}

/**
 * 500 이 무엇을 말하는가 — 밖으로는 코드만, 로그에는 그대로.
 *
 * 둘을 함께 재는 이유: 응답만 재면 "오류를 통째로 삼켰다"도 초록이고, 로그만
 * 재면 "밖으로도 여전히 뱉는다"가 초록이다. 감추는 것과 잃는 것은 다르고,
 * 이 변경이 하려는 것은 앞의 하나뿐이다.
 */
describe('오류 응답 배선', () => {
  it('운영에서는 500 본문에 내부 문장이 없다 — 코드 하나뿐이다', async () => {
    const { res } = await failingLogin({ NODE_ENV: 'production' }, undefined)

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ code: 'internal_error' })
    // 글자로도 확인한다 — 어느 필드로 새든 걸리게.
    expect(res.body).not.toContain('ECONNREFUSED')
    expect(res.body).not.toContain('5432')
  })

  it('NODE_ENV 도 콘솔도 없는 그 자리 — 실제 배포 모양에서도 감춘다', async () => {
    // **이 검사만 app.ts 의 배선을 지킨다.** 위아래 두 검사는 못 지킨다:
    // 하나는 `NODE_ENV=production` 을 박아서 재고, 다른 하나는 vitest 가 깔아 둔
    // `NODE_ENV=test` 에 기댄다 — 둘 다 `NODE_ENV !== 'production'` 으로
    // 되돌린 구현에서도 초록이다. 그런데 WinSW XML 은 NODE_ENV 를 놓지 않으므로
    // (docs/deploy-windows.md — 놓는 것은 GIT_SHA 하나다) 되돌린 구현의 배포는
    // 개발로 잡혀 500 에 errno·주소를 그대로 싣는다. 그 한 줄이 지금 공개된
    // 터널 뒤에 서 있다.
    //
    // 값을 지우는 것(빈 문자열이 아니라)이 요점이다 — 흉내가 아니라 그 모양이어야 한다.
    const { res, text } = await failingLogin({ NODE_ENV: undefined }, undefined)

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ code: 'internal_error' })
    expect(res.body).not.toContain('ECONNREFUSED')
    expect(res.body).not.toContain('5432')
    // 감추는 것과 잃는 것은 다르다 — 같은 자리에서 둘을 함께 잰다.
    expect(text).toContain(STORE_FAILURE)
  })

  it('감춘 그 문장이 로그에는 그대로 남는다 — 디버깅을 잃으면 안 된다', async () => {
    const { text } = await failingLogin({ NODE_ENV: 'production' }, undefined)

    expect(text).toContain(STORE_FAILURE)
    // 어느 요청이었는지도 함께 남아야 쓸모가 있다.
    expect(text).toContain('/api/auth/login')
  })

  it('개발 콘솔에서는 지금처럼 자세히 준다 — 읽는 사람과 띄운 사람이 같다', async () => {
    const { res } = await failingLogin({}, true)

    expect(res.statusCode).toBe(500)
    expect(res.body).toContain(STORE_FAILURE)
  })

  it('4xx 는 운영에서도 그대로 돌려준다 — 보낸 쪽이 고칠 수 있는 말이다', async () => {
    // 안쪽 사정을 감춘다면서 "본문이 JSON 이 아니다"까지 코드로 뭉개면, 붙이려는
    // 사람이 무엇을 잘못 보냈는지 알 길이 없어진다.
    const res = await withConsole({ NODE_ENV: 'production' }, undefined, async () => {
      const app = await buildTestApp()
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: '{이건 JSON 이 아니다',
      })
      await app.close()
      return response
    })

    expect(res.statusCode).toBe(400)
    // `code` 만 보면 안 된다 — 500 을 뭉개는 가지로 400 이 새어 들어가도 상태
    // 코드는 400 그대로라, 무엇이 잘못됐는지 적힌 문장이 남아 있는지를 재야 한다.
    const body = res.json() as { code?: string; message?: string }
    expect(body.code).not.toBe('internal_error')
    expect(body.message).toBeTypeOf('string')
    expect(body.message).toMatch(/JSON/i)
  })
})

/** 진짜 DB 가 죽으면 오는 문장이다. 이 글자가 밖으로 나가면 우리 포트 배치가 나간 것이다. */
const STORE_FAILURE = 'connect ECONNREFUSED 127.0.0.1:5432'

/**
 * 저장소가 던지는 서버를 세우고 로그인을 한 번 두드린다.
 *
 * 왜 로그인인가: 세션 없이 닿을 수 있으면서 **저장소를 반드시 만지는** 라우트라,
 * 인증을 통과시키느라 다른 것을 섞지 않고 500 을 만들 수 있다.
 */
async function failingLogin(
  vars: Record<string, string | undefined>,
  isTty: boolean | undefined,
): Promise<{ res: LightMyRequestResponse; text: string }> {
  const lines = captureLines()
  const dir = mkdtempSync(join(tmpdir(), 'nogada-오류-'))
  const store = await JsonPersistence.open(join(dir, 'players.json'))
  // 로그인이 처음 만지는 문 하나만 고장 낸다. 저장소 전체를 가짜로 바꾸면
  // 시험하는 것이 에러 핸들러가 아니라 그 가짜가 된다.
  store.findUser = () => Promise.reject(new Error(STORE_FAILURE))

  const res = await withConsole(vars, isTty, async () => {
    // 로거는 배포에 실리는 그 설정으로 앉힌다 — 로그에 남는지를 물을 것이므로
    // buildTestApp 의 기본(조용함)으로는 잴 수 없다.
    const app = await buildTestApp({
      persistence: store,
      logger: { ...deployLogger(), stream: lines.stream },
    })
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: '아무개', password: '비밀번호-nogada-1234' },
    })
    await app.close()
    return response
  })

  rmSync(dir, { recursive: true, force: true })
  return { res, text: lines.text() }
}

/** 배포에서 실제로 실리는 로거 설정. 시험하는 것이 그것이어야 한다. */
function deployLogger(): Exclude<LoggerSetting, false> {
  const setting = parseLogger(undefined, 'production', undefined)
  if (setting === false) throw new Error('배포 설정이 꺼져 있으면 안 된다')
  return setting
}

/** pino 가 뱉는 줄을 그대로 모아 두는 스트림. 로그는 눈으로 볼 수 없으므로 받아 본다. */
function captureLines(): { stream: Writable; text: () => string } {
  const chunks: string[] = []
  const stream = new Writable({
    write(chunk: Buffer | string, _encoding, done) {
      chunks.push(chunk.toString())
      done()
    },
  })
  return { stream, text: () => chunks.join('') }
}

/**
 * 환경변수와 "콘솔이 붙어 있는가"를 함께 갈아 끼운다.
 *
 * 둘을 같이 다루는 이유는 판정이 둘을 같이 보기 때문이다(config.ts 의
 * isDevConsole). 그리고 그 판정은 **앱을 세우는 순간**에 한 번 내려지므로,
 * buildTestApp 을 이 안에서 불러야 한다.
 */
async function withConsole<T>(
  vars: Record<string, string | undefined>,
  isTty: boolean | undefined,
  body: () => Promise<T>,
): Promise<T> {
  const before = process.stdout.isTTY
  setTty(isTty)
  try {
    return await withEnv(vars, body)
  } finally {
    setTty(before)
  }
}

/** `process.stdout.isTTY` 는 붙어 있지 않으면 undefined 다 — 타입은 boolean 이라 우회한다. */
function setTty(value: boolean | undefined): void {
  ;(process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = value
}

/**
 * 환경변수를 잠깐 갈아 끼운다. 끝나면 원래대로 — 다음 테스트가 이 값을 물려받으면 안 된다.
 *
 * **`undefined` 는 "그 변수를 지운다"다.** 실제 배포(WinSW)가 `NODE_ENV` 를 놓지
 * 않는 자리이므로, 그 모양을 재려면 값을 넣는 것만으로는 부족하다.
 * `Object.assign` 으로 뭉뚱그리면 문자열 `'undefined'` 가 들어가서 — 없는 것을
 * 흉내 내려던 자리가 **값이 있는 자리**가 된다.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const before = new Map(Object.keys(vars).map((key) => [key, process.env[key]]))
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await body()
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
