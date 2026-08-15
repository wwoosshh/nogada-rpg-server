import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveApiBase } from './apiBase.js'

/**
 * 공개 배포의 전제 하나를 세 자리에서 잰다: **번들에 서버 주소가 없다.**
 *
 * 셋이 한 사슬이다 — `.env.production` 이 빈 값을 주고, resolveApiBase 가 그
 * 빈 값을 폴백시키지 않고, 그래서 빌드된 번들에 주소가 0건이다. 앞의 둘은
 * 빌드 없이도 늘 돌고, 마지막 하나는 dist 가 있을 때만 돈다(아래 참고).
 * 사슬을 셋으로 나눈 이유는 끊기는 자리가 셋이기 때문이다: 파일을 지우는 것,
 * `??` 를 `||` 로 "고치는" 것, 그리고 둘 다 멀쩡한데 엉뚱한 모드로 빌드하는 것.
 */

const clientRoot = fileURLToPath(new URL('../..', import.meta.url))

describe('resolveApiBase', () => {
  it('빈 문자열은 그대로 빈 문자열이다 — 이 한 줄이 같은 오리진 배포의 전부다', () => {
    // `||` 로 바꾸면 여기가 빨개진다. 그것이 이 검사의 존재 이유다: 빈 값이
    // 폴백되면 공개된 사이트의 번들에 localhost 가 박힌 채로 나가고, 그 실패는
    // 타입 검사도 빌드도 통과해 폰에서야 발견된다.
    expect(resolveApiBase('')).toBe('')
  })

  it('값을 안 정하면 개발 기본값이다 — 개발 PC 를 이 변경으로 끊으면 안 된다', () => {
    expect(resolveApiBase(undefined)).toBe('http://localhost:3000')
  })

  it('적힌 주소는 그대로 쓴다 — APK 는 오리진 상대경로를 못 쓴다', () => {
    expect(resolveApiBase('https://nogada.example')).toBe('https://nogada.example')
  })
})

describe('.env.production', () => {
  it('커밋되어 있고 VITE_API_BASE_URL 을 비운다', () => {
    // vite 는 `vite build` 를 production 모드로 돌리고, `.env.local` 보다
    // `.env.[mode]` 를 나중에 읽어 덮는다. 그래서 이 파일 하나가 개발용
    // `.env.local` 을 건드리지 않고 배포 빌드만 오리진 상대경로로 만든다.
    //
    // **파일이 없는 것이 가장 흔한 실패다** — 루트 `.gitignore` 가 `.env*` 를
    // 통째로 막으므로, 예외 한 줄이 지워지면 다음 사람의 체크아웃에는 이 파일이
    // 없고 빌드는 아무 경고 없이 localhost 를 박는다.
    const file = join(clientRoot, '.env.production')
    expect(existsSync(file), `${file} 이 없다 — .gitignore 의 예외가 지워졌는지 본다`).toBe(true)

    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.trimStart().startsWith('VITE_API_BASE_URL'))
    expect(line, 'VITE_API_BASE_URL 줄 자체가 없다').toBeDefined()
    expect(line!.trim()).toBe('VITE_API_BASE_URL=')
  })
})

/**
 * 빌드된 번들을 직접 읽는다 — 위 둘이 초록인데도 주소가 박히는 길이 남아 있다
 * (셸 환경변수, 다른 모드, 새로 생긴 하드코딩). 문서의 손 관문
 * (docs/deploy-public.md 5단계)이 여기로 옮겨 온 것이다.
 *
 * **dist 가 없으면 건너뛴다.** 테스트가 3.1MB 빌드를 부르게 하면 관문 전체가
 * 느려지고, 없는 것을 실패로 치면 빌드 안 한 사람의 저장소가 통째로 빨개진다.
 * 대신 CI 는 테스트 앞에서 클라이언트를 빌드해 이 자리가 실제로 돌게 한다
 * (.github/workflows/deploy.yml — 계약 스위트에 DB 를 대 주는 것과 같은 이유:
 * 건너뛴 것을 통과로 세지 않으려면 CI 가 조건을 마련해야 한다).
 */
const assetsDir = join(clientRoot, 'dist', 'assets')

describe.skipIf(!existsSync(assetsDir))('빌드된 번들 (dist 가 있을 때만)', () => {
  /** 관문이 찾는 것들. 하나는 개발 폴백이고 하나는 현행 운영 주소다. */
  const 박히면안되는것 = ['localhost:3000', '100.125.30.85']

  it('서버 주소가 한 건도 없다', () => {
    const files = readdirSync(assetsDir).filter((name) => name.endsWith('.js'))
    // 자바스크립트가 하나도 안 잡히면 이 검사는 아무것도 안 재고 초록이 된다.
    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      const text = readFileSync(join(assetsDir, name), 'utf8')
      for (const 주소 of 박히면안되는것) {
        expect(text.includes(주소), `${name} 에 ${주소} 가 박혀 있다`).toBe(false)
      }
    }
  })
})
