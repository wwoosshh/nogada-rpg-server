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
    // **파일이 없는 것이 가장 흔한 실패다.** 루트 `.gitignore` 가 `.env*` 를
    // 통째로 막고, `!apps/client/.env.production` 한 줄이 그 예외다 — 다만 그
    // 줄이 사는 자리는 **처음 `git add` 를 통과시키는 것**이지 체크아웃이
    // 아니다. 실측: 예외를 지워도 이미 추적 중인 파일은 그대로 남는다
    // (`git ls-files`·`git ls-tree HEAD` 그대로, `git status` 에 삭제 없음).
    // 위험한 것은 **누가 이 파일을 지웠다가 다시 add 할 때**다 — 그때 예외가
    // 없으면 add 가 조용히 무시되고, 다음 사람의 빌드는 아무 경고 없이
    // localhost 를 박는다. 규칙을 눈으로 확인하려면 `--no-index` 를 붙여야
    // 한다: `git check-ignore -v --no-index apps/client/.env.production`
    // (그냥 부르면 인덱스를 보므로 추적된 파일에는 늘 "무시 안 됨"이다).
    const file = join(clientRoot, '.env.production')
    expect(existsSync(file), `${file} 이 없다 — 지워졌는지, .gitignore 의 예외가 남았는지 본다`).toBe(
      true,
    )

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
const distDir = join(clientRoot, 'dist')

/** 사람이 읽을 수 있는 것만 훑는다. 나머지(png 등)에는 주소가 실릴 자리가 없다. */
const 훑을확장자 = ['.js', '.mjs', '.css', '.html', '.json']

/** dist 아래 텍스트 산출물 전부. 경로는 dist 기준 상대경로로 돌려준다. */
function 텍스트산출물(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const 이름 = `${prefix}${entry.name}`
    if (entry.isDirectory()) return 텍스트산출물(join(dir, entry.name), `${이름}/`)
    return 훑을확장자.some((ext) => entry.name.toLowerCase().endsWith(ext)) ? [이름] : []
  })
}

describe.skipIf(!existsSync(distDir))('빌드된 번들 (dist 가 있을 때만)', () => {
  /** 관문이 찾는 것들. 하나는 개발 폴백이고 하나는 현행 운영 주소다. */
  const 박히면안되는것 = ['localhost:3000', '100.125.30.85']

  // 왜 `dist/assets/*.js` 한 층이 아니라 **재귀**인가: 이 검사의 이름은 "번들에
  // 0건" 인데 한 층만 보면 CSS·index.html·맵 JSON 과 assets 밖으로 나오는
  // 산출물이 통째로 빠진다. 지금은 어느 쪽으로 재도 0건이지만, vite 설정이
  // 바뀌어 청크가 다른 폴더로 나가는 날 좁은 자가 조용히 눈을 감는다.
  it('서버 주소가 한 건도 없다', () => {
    const files = 텍스트산출물(distDir)
    // 한 건도 안 잡히면 이 검사는 아무것도 안 재고 초록이 된다.
    expect(files.length).toBeGreaterThan(0)

    for (const name of files) {
      const text = readFileSync(join(distDir, name), 'utf8')
      for (const 주소 of 박히면안되는것) {
        expect(text.includes(주소), `${name} 에 ${주소} 가 박혀 있다`).toBe(false)
      }
    }
  })
})
