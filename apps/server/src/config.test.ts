import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  LOG_CENSOR,
  parseCorsOrigin,
  parseLogger,
  parseTrustProxy,
  type LoggerSetting,
} from './config.js'
import { buildTestApp } from './testSupport.js'

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

describe('parseLogger', () => {
  it('컨테이너는 아무 설정 없이도 말을 한다 — .env 를 고치지 않아도 info 다', () => {
    // 미니PC 의 .env 는 커밋되지 않아 우리가 고칠 수 없다. 그 파일이 LOG_LEVEL 을
    // 모르는 채로도 배포된 서버가 로그를 남기지 않으면 이 변경은 헛것이다.
    expect(parseLogger(undefined, 'production')).toMatchObject({ level: 'info' })
  })

  it('테스트에서는 무조건 끈다 — LOG_LEVEL 이 있어도', () => {
    // 셸에 남은 환경변수 하나로 테스트 출력이 사람마다 달라지면 안 된다.
    expect(parseLogger(undefined, 'test')).toBe(false)
    expect(parseLogger('debug', 'test')).toBe(false)
    expect(parseLogger('info', 'test')).toBe(false)
  })

  it('개발 PC 는 조용한 쪽이 기본이다 — 지금까지 조용했다', () => {
    expect(parseLogger(undefined, undefined)).toBe(false)
    expect(parseLogger('', 'development')).toBe(false)
  })

  it('심각도를 말한 대로 받는다', () => {
    expect(parseLogger('debug', 'production')).toMatchObject({ level: 'debug' })
    expect(parseLogger(' WARN ', undefined)).toMatchObject({ level: 'warn' })
    expect(parseLogger('trace', 'development')).toMatchObject({ level: 'trace' })
  })

  it('끄는 말은 배포에서도 끈다', () => {
    for (const word of ['off', 'none', 'silent', 'false', 'no', '0', 'OFF']) {
      expect(parseLogger(word, 'production')).toBe(false)
    }
  })

  it('모르는 값은 info 로 간다 — 오타 한 글자로 서버가 안 뜨면 안 된다', () => {
    // pino 는 모르는 심각도를 받으면 기동 중에 던진다. 여기서 흡수하지 않으면
    // `LOG_LEVEL=Verbose` 한 줄이 배포를 통째로 세운다.
    expect(parseLogger('verbose', 'production')).toMatchObject({ level: 'info' })
    expect(parseLogger('아무말', 'production')).toMatchObject({ level: 'info' })
  })

  it('자격증명이 실릴 수 있는 이름을 모두 가린다', () => {
    const setting = parseLogger('info', 'production')
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
    const a = parseLogger('info', 'production')
    const b = parseLogger('info', 'production')
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

/** 배포에서 실제로 실리는 로거 설정. 시험하는 것이 그것이어야 한다. */
function deployLogger(): Exclude<LoggerSetting, false> {
  const setting = parseLogger(undefined, 'production')
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

/** 환경변수를 잠깐 갈아 끼운다. 끝나면 원래대로 — 다음 테스트가 이 값을 물려받으면 안 된다. */
async function withEnv<T>(vars: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const before = new Map(Object.keys(vars).map((key) => [key, process.env[key]]))
  Object.assign(process.env, vars)
  try {
    return await body()
  } finally {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
