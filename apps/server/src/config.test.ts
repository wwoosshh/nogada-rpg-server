import { describe, expect, it } from 'vitest'
import { parseCorsOrigin, parseTrustProxy } from './config.js'
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
