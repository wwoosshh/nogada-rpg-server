import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BarrierRegions, GatherTables, MonsterDropTables } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { transformWithEsbuild } from 'vite'
import viteConfig from '../vite.config.js'

/**
 * 이 게임의 핵심은 **숨은 문턱**이다 — 진행도로 열리는 것이 노가다 사이사이에
 * 숨어 있다는 것(설계 §7-앞 9). 그래서 채집 브라켓 확률·몬스터 드랍 확률·결계
 * 좌표는 클라이언트 번들에 실리면 안 된다. 실리는 순간 F12 한 번에 스포일되고,
 * 공개 배포 뒤에는 되돌릴 방법이 없다(이미 받아 간 번들을 회수하지 못한다).
 *
 * 지금은 지켜지고 있다. 지키는 방법은 **진입을 나눈 것**이다 — 세 표를 읽는 문은
 * `@nogada/data` 배럴이 아니라 서브경로 진입에만 있다(loadGatherTables.ts 참조).
 * 문제는 그것을 지키는 자가 없었다는 것이다: 배럴에 `export * from './loadX.js'`
 * 한 줄이 늘어나는 날 조용히 새고, 타입 검사도 빌드도 초록이다.
 *
 * ## 자를 왜 둘 대는가
 *
 * **1. 소스 그래프**(늘 돈다) — 클라이언트 진입에서 import 를 따라 걸어가서 서버
 * 전용 모듈과 그 생성 JSON 에 닿지 않는지 본다. 빌드가 필요 없어 관문이 안
 * 느려지고, 새는 커밋 자체를 막는다. 그리고 **트리 셰이킹을 안 믿는다**: 그래프에
 * 닿기만 해도 빨갛다. 그 자세가 옳다는 것을 재서 확인했다 — 배럴에
 * `export * from './loadGatherTables.js'` **한 줄만** 넣고 아무도 안 쓰게 두어도
 * 확률표가 통째로 번들에 실렸다. loader 가 최상위에서 `deepFreeze(generated)` 를
 * 부르는 부수효과 때문에 rollup 이 지우지 못한다.
 *
 * **2. 빌드된 번들**(dist 가 있을 때만) — 실제 산출물에서 값 자체를 찾는다. 1번을
 * 우회하는 길이 남아 있기 때문이다: 손으로 베껴 적은 확률, 다른 경로로 흘러든
 * 값, 소스맵. 이쪽이 최종 판정이고 1번은 더 이른 자리에서 무는 자다.
 *
 * dist 가 없으면 2번은 건너뛴다(apiBase.test.ts 의 '번들에 주소 0건' 과 같은
 * 판단·같은 이유다: 테스트가 3MB 빌드를 부르면 관문 전체가 느려지고, 없는 것을
 * 실패로 치면 빌드 안 한 사람의 저장소가 통째로 빨개진다). CI 는 테스트 앞에서
 * 클라이언트를 빌드하므로 거기서는 실제로 돈다(.github/workflows/deploy.yml).
 *
 * ## 값을 여기 적지 않는다
 *
 * `0.35` 같은 숫자를 이 파일에 박으면 CSV 에서 그 값을 바꾸는 날 자가 거짓
 * 초록이 된다 — 없는 값이 없는 것을 확인할 뿐이다. 그래서 **구운 JSON 에서 값을
 * 읽어** 서명을 만든다. 서명이 실제로 그 표의 지문인지는 아래 '양성 대조군'이
 * 원본 JSON 에서 되찾아 증명한다.
 */

const clientRoot = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(clientRoot, '../..')

// ─────────────────────────────────────────────────────────────────────────────
// 무엇이 서버 전용인가 — 손으로 적지 않고 패키지의 exports 에서 읽는다
// ─────────────────────────────────────────────────────────────────────────────

type 워크스페이스패키지 = { readonly dir: string; readonly exports: Record<string, string> }

/**
 * `packages/*`·`apps/*` 의 package.json 을 이름으로 찾을 수 있게 모은다.
 * import 지정자를 파일로 되돌리려면 exports 표가 필요한데, 그 표를 여기 베껴
 * 적으면 진짜 표가 바뀌는 날 자만 옛말을 하게 된다.
 */
function 워크스페이스를읽는다(): Map<string, 워크스페이스패키지> {
  const 표 = new Map<string, 워크스페이스패키지>()
  for (const 묶음 of ['packages', 'apps']) {
    const base = join(repoRoot, 묶음)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const pkgFile = join(base, entry.name, 'package.json')
      if (!existsSync(pkgFile)) continue
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as {
        name?: string
        exports?: Record<string, unknown>
      }
      if (!pkg.name) continue
      const exports: Record<string, string> = {}
      for (const [key, value] of Object.entries(pkg.exports ?? {})) {
        // 조건부 exports(객체)는 이 저장소에 없다. 생기면 여기서 조용히 빠지는
        // 대신 아래 '미해결 지정자' 검사가 빨개지도록 일부러 안 흡수한다.
        if (typeof value === 'string') exports[key] = value
      }
      표.set(pkg.name, { dir: join(base, entry.name), exports })
    }
  }
  return 표
}

const 패키지들 = 워크스페이스를읽는다()
const 데이터패키지 = 패키지들.get('@nogada/data')
if (!데이터패키지) throw new Error('@nogada/data 를 워크스페이스에서 못 찾았다')

/**
 * 데이터 패키지의 **서브경로 진입은 곧 서버 전용**이라는 것이 이 저장소의 규범이다
 * (세 loader 파일의 주석). 그래서 금지 목록을 손으로 적지 않고 exports 에서
 * 뽑는다 — 넷째 표를 굽는 날 그 표는 자동으로 이 자의 관할에 들어온다.
 */
const 서버전용서브경로 = Object.keys(데이터패키지.exports).filter((key) => key !== '.')
const 서버전용진입 = 서버전용서브경로.map((key) => resolve(데이터패키지.dir, 데이터패키지.exports[key]!))

/**
 * 진입만 막으면 반쪽이다: `packages/data/src/generated/gather-tables.json` 을
 * 상대경로로 곧장 import 하면 loader 를 안 지나고도 같은 값이 번들에 실린다.
 * 그 JSON 이 어느 파일인지도 손으로 적지 않고 **loader 가 실제로 무엇을 읽는지**
 * 에서 뽑는다(파일 이름이 바뀌면 자도 따라간다).
 */
const 서버전용JSON = 서버전용진입.flatMap((진입) =>
  지정자들(readFileSync(진입, 'utf8'))
    .filter((spec) => spec.startsWith('.') && spec.endsWith('.json'))
    .map((spec) => resolve(dirname(진입), spec)),
)

// ─────────────────────────────────────────────────────────────────────────────
// 자 1 — 클라이언트 모듈 그래프
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 소스에서 import 지정자를 뽑는다.
 *
 * 왜 파서가 아니라 정규식인가: 이 자의 값어치는 "빌드 없이 빠르게"인데, 파서를
 * 들이면 의존성이 늘고 그만큼 느려진다. 대신 **주석에 적힌 지정자를 진짜로 오해
 * 하지 않는 것**이 관건이다 — 이 저장소는 주석에 `@nogada/data/gather-tables` 를
 * 자주 인용하고(loader 셋, gatherService), 그것을 import 로 세면 자는 늘 빨갛다.
 * 그래서 정적 import 는 **줄머리 규칙**으로 잰다: ESM 의 정적 import/export 는
 * 최상위 문이라 줄 처음에 오고, 주석 줄은 `//`·`*` 로 시작해 이 규칙에 안 걸린다.
 */
function 지정자들(source: string): string[] {
  const 찾은: string[] = []
  const 규칙 = [
    // `import ... from '...'` / `export ... from '...'` — 여러 줄에 걸쳐도 잡되
    // 따옴표를 건너뛰지는 않게 해서(`[^'"]*?`) 옆 문장까지 삼키지 않는다.
    /^[ \t]*(?:import|export)\b[^'"]*?\bfrom[ \t]*['"]([^'"]+)['"]/gm,
    // 부수효과 import(`import './styles/global.css'`)
    /^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm,
    // 동적 import 는 줄 어디에나 올 수 있으므로 줄머리 규칙 밖이다.
    /\bimport[ \t]*\([ \t]*['"]([^'"]+)['"]/g,
  ]
  for (const 규 of 규칙) {
    for (const m of source.matchAll(규)) if (m[1]) 찾은.push(m[1])
  }
  return 찾은
}

const 소스확장자 = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/** 확장자를 생략했거나 `.js` 로 적은 TS import 를 실제 파일로 되돌린다. */
function 실제파일(경로: string): string | null {
  const 시도 = [경로]
  if (경로.endsWith('.js')) 시도.push(`${경로.slice(0, -3)}.ts`, `${경로.slice(0, -3)}.tsx`)
  if (!extname(경로)) {
    시도.push(...소스확장자.map((ext) => 경로 + ext))
    시도.push(...소스확장자.map((ext) => join(경로, `index${ext}`)))
  }
  for (const 후보 of 시도) {
    if (existsSync(후보) && statSync(후보).isFile()) return 후보
  }
  return null
}

/**
 * 지정자를 파일로 옮긴다. 워크스페이스 밖의 것(react·phaser·zustand…)은 null 이고
 * 그것은 정상이다 — 비밀은 이 저장소 안에만 있다.
 */
function 옮긴다(spec: string, 부모: string): { file: string | null; 워크스페이스: boolean } {
  if (spec.startsWith('.')) return { file: 실제파일(resolve(dirname(부모), spec)), 워크스페이스: true }
  for (const [이름, pkg] of 패키지들) {
    if (spec !== 이름 && !spec.startsWith(`${이름}/`)) continue
    const subpath = spec === 이름 ? '.' : `./${spec.slice(이름.length + 1)}`
    const target = pkg.exports[subpath]
    if (!target) return { file: null, 워크스페이스: true }
    return { file: 실제파일(resolve(pkg.dir, target)), 워크스페이스: true }
  }
  return { file: null, 워크스페이스: false }
}

/** 클라이언트 진입. index.html 에서 읽는다 — 진입이 옮겨 가면 자도 따라가야 한다. */
function 클라이언트진입(): string {
  const html = readFileSync(join(clientRoot, 'index.html'), 'utf8')
  const m = html.match(/<script[^>]*\bsrc=["']([^"']+)["']/)
  if (!m?.[1]) throw new Error('index.html 에서 진입 스크립트를 못 찾았다')
  const file = 실제파일(join(clientRoot, m[1].replace(/^\/+/, '')))
  if (!file) throw new Error(`index.html 이 가리키는 ${m[1]} 이 없다`)
  return file
}

/** 진입에서 import 를 따라 닿는 모든 파일. 미해결 지정자는 따로 돌려준다. */
function 클라이언트그래프(): { 도달: Set<string>; 미해결: string[] } {
  const 도달 = new Set<string>()
  const 미해결: string[] = []
  const 남은 = [클라이언트진입()]
  while (남은.length > 0) {
    const 파일 = 남은.pop()!
    if (도달.has(파일)) continue
    도달.add(파일)
    // JSON·CSS 는 잎이다. 닿았다는 사실만 세면 되고(그것이 곧 유출이다) 안에서
    // 다시 import 가 나갈 일은 없다.
    if (!소스확장자.includes(extname(파일))) continue
    for (const spec of 지정자들(readFileSync(파일, 'utf8'))) {
      const { file, 워크스페이스 } = 옮긴다(spec, 파일)
      if (file) 남은.push(file)
      else if (워크스페이스) 미해결.push(`${relative(repoRoot, 파일)} → ${spec}`)
    }
  }
  return { 도달, 미해결 }
}

describe('숨은 문턱 — 소스 그래프 (빌드 없이 늘 돈다)', () => {
  const { 도달, 미해결 } = 클라이언트그래프()

  it('데이터 패키지의 서브경로 진입은 곧 서버 전용이다 — 늘어나면 여기서 분류해라', () => {
    // 넷째가 생기면 이 검사가 빨개진다. 그것이 의도다: 새 서브경로가 비밀이면
    // 위의 자동 목록이 이미 지키고 있으니 여기 이름만 더하면 되고, 비밀이 아니면
    // "서브경로 = 서버 전용" 규범이 깨진 것이라 그 자리에서 정해야 한다.
    expect([...서버전용서브경로].sort()).toEqual(['./barriers', './gather-tables', './monster-drops'])
  })

  it('그래프가 실제로 걸어졌다 — 이 자가 눈감으면 아래 셋이 공짜로 초록이다', () => {
    // 양성 대조군. 해석이 조용히 깨지면(확장자 규칙 변경, exports 표 개편) 그래프가
    // 진입 한 개로 쪼그라들고 아래 검사들은 아무것도 안 재면서 초록이 된다.
    expect(도달.size).toBeGreaterThan(50)
    expect(도달).toContain(join(repoRoot, 'packages', 'data', 'src', 'index.ts'))
    expect(도달).toContain(join(repoRoot, 'packages', 'shared', 'src', 'index.ts'))
  })

  it('워크스페이스 안의 지정자는 전부 해석된다 — 못 옮긴 것은 못 잰 것이다', () => {
    // 못 옮긴 지정자 하나가 곧 안 걸어 본 가지 하나다. 유출이 그 가지 너머에
    // 있으면 이 자는 그것을 영영 못 본다.
    expect(미해결).toEqual([])
  })

  it('서버 전용 진입에 닿지 않는다', () => {
    for (const 진입 of 서버전용진입) {
      expect(도달.has(진입), `${relative(repoRoot, 진입)} 이 클라이언트 그래프에 들어왔다`).toBe(
        false,
      )
    }
  })

  it('구운 비밀 JSON 에도 닿지 않는다 — loader 를 건너뛰는 상대경로가 있다', () => {
    expect(서버전용JSON.length).toBe(서버전용진입.length)
    for (const json of 서버전용JSON) {
      expect(도달.has(json), `${relative(repoRoot, json)} 이 클라이언트 그래프에 들어왔다`).toBe(
        false,
      )
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 자 2 — 빌드된 번들
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 서명 하나. `raw` 는 구운 JSON 에 그대로 있는 꼴이고(양성 대조군이 그것으로
 * 증명한다), `꼴들` 은 번들에서 찾을 모든 변형이다.
 */
type 서명 = { readonly 이름: string; readonly raw: string; readonly 꼴들: readonly string[] }

/**
 * 값 하나를 **번들에 실렸다면 보일 꼴**로 옮긴다.
 *
 * 최소화된 꼴을 손으로 추측하지 않고 **빌드가 쓰는 그 최소화기에게 직접 시킨다**
 * (`build.minify` 기본값이 'esbuild' 이고, vite 의 json 플러그인이 JSON 을 객체
 * 리터럴로 바꾼 뒤 그것이 지나가는 자리다). 추측했다면 틀렸을 것이다 — 실측한
 * 유출 번들은 `0.5` 를 `.5` 로, `60000` 을 `6e4` 로, `150000` 을 `15e4` 로 적고
 * 있었다. 그 규칙을 여기 베껴 적으면 esbuild 가 판을 바꾸는 날 자만 옛 꼴을
 * 찾다가 조용히 눈을 감는다.
 *
 * `raw`(JSON 그대로)도 함께 본다. vite 가 큰 JSON 을 `JSON.parse("…")` 로 굽도록
 * 설정이 바뀌면 숫자가 원본 꼴 그대로 문자열 안에 남기 때문이다.
 */
async function 서명만들기(이름: string, 값: unknown): Promise<서명> {
  const raw = JSON.stringify(값)
  // 문(statement)으로 감싸야 esbuild 가 식을 그대로 돌려준다. 최소화가 이름을
  // 줄이지 않도록 minifyIdentifiers 는 빼고, 공백·문법만 줄인다 — 번들의 객체
  // 리터럴에서 실제로 달라지는 것이 그 둘뿐이다(키의 따옴표, 숫자 표기).
  const { code } = await transformWithEsbuild(`x=${raw}`, '서명.js', {
    minifyWhitespace: true,
    minifySyntax: true,
  })
  const 최소 = code.slice(code.indexOf('=') + 1).replace(/;?\s*$/, '')
  return { 이름, raw, 꼴들: raw === 최소 ? [raw] : [raw, 최소] }
}

const 생성폴더 = join(repoRoot, 'packages', 'data', 'src', 'generated')

function JSON을읽는다<T>(파일: string): { 값: T; 본문: string } {
  const 본문 = readFileSync(파일, 'utf8')
  return { 값: JSON.parse(본문) as T, 본문: 본문.replace(/\s+/g, '') }
}

const 채집 = JSON을읽는다<GatherTables>(join(생성폴더, 'gather-tables.json'))
const 드랍 = JSON을읽는다<MonsterDropTables>(join(생성폴더, 'monster-drops.json'))
const 결계 = JSON을읽는다<BarrierRegions>(join(생성폴더, 'barrier-regions.json'))

// 서명을 무엇으로 잡는가: **표 안에서 스스로 뜻을 갖는 가장 작은 덩어리**다.
// 더 크게(표 통째로) 잡으면 일부만 새는 유출을 놓치고, 더 잘게(숫자 하나) 잡으면
// `0.5`·`500` 같은 흔한 숫자가 번들 아무 데나 있어 거짓 빨강이 된다. 수열로
// 잡으면 우연히 같은 자리에 같은 순서로 있을 일이 사실상 없다.

/**
 * 브라켓의 누적 확률. 이 다섯 숫자가 곧 "얼마나 파야 잭팟이 나오는가"이고,
 * 브라켓 경계는 숙련 문턱 그 자체다.
 */
const 채집서명 = await Promise.all(
  Object.values(채집.값).flatMap((표) =>
    표.brackets.map((br, i) => 서명만들기(`${표.id} 브라켓 ${i}`, br.cumulative)),
  ),
)

/**
 * 한 몬스터의 드랍 목록. 확률만 이어 붙이지 않는 이유는 실측이다 — 구운 JSON
 * 에서도 번들에서도 확률 사이에는 itemId 가 끼어 있어(`{itemId:"…",chance:.5}`)
 * 확률만 이은 수열은 어느 쪽에도 없는 꼴이다. 처음에 그렇게 썼고 양성 대조군이
 * 그 자리에서 물었다.
 */
const 드랍서명 = await Promise.all(
  Object.values(드랍.값).map((표) => 서명만들기(`${표.monsterId} 드랍`, 표.drops)),
)

/** 결계 한 구역의 칸 목록. 새면 "어디까지 갈 수 있는가"가 통째로 새는 것이다. */
const 결계서명 = await Promise.all(
  결계.값.map((구역) => 서명만들기(`${구역.mapId} 결계`, 구역.cells)),
)

const distDir = join(clientRoot, 'dist')

/** 사람이 읽을 수 있는 것만 훑는다. 나머지(png 등)에는 이 값들이 실릴 자리가 없다. */
const 훑을확장자 = ['.js', '.mjs', '.css', '.html', '.json']

/** dist 아래 파일 전부(경로는 dist 기준 상대경로). */
function dist파일들(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const 이름 = `${prefix}${entry.name}`
    return entry.isDirectory() ? dist파일들(join(dir, entry.name), `${이름}/`) : [이름]
  })
}

describe('숨은 문턱 — 빌드된 번들 (dist 가 있을 때만)', () => {
  it('서명이 구운 JSON 에서는 실제로 잡힌다 — 무딘 자가 초록을 주지 않게', () => {
    // 양성 대조군이자 이 자의 존재 증명이다. 표의 모양이 바뀌어(필드 이름·중첩)
    // 서명이 엉뚱한 것을 잇게 되면 번들에서도 당연히 안 잡히고, 그러면 아래 셋은
    // 아무것도 안 재면서 영원히 초록이다. 원본에서 되찾아 그 길을 막는다.
    for (const [서명들, 원본] of [
      [채집서명, 채집.본문],
      [드랍서명, 드랍.본문],
      [결계서명, 결계.본문],
    ] as const) {
      expect(서명들.length).toBeGreaterThan(0)
      for (const 서명 of 서명들) {
        expect(원본.includes(서명.raw), `${서명.이름} 의 서명이 원본에 없다: ${서명.raw}`).toBe(true)
      }
    }
  })

  describe.skipIf(!existsSync(distDir))('dist', () => {
    // **읽기는 반드시 it 안에서 한다.** `describe.skipIf` 는 건너뛸 때도 콜백
    // 본문은 그대로 실행한다(수집 단계에서 안의 it 들을 알아내야 하므로). 여기서
    // 곧장 readdirSync 를 부르면 dist 없는 기계에서 파일 **전체**가 수집 오류로
    // 죽는다 — 건너뛰려고 만든 문이 정확히 그 반대를 한다. 직접 겪고 고쳤다.
    function dist를읽는다(): {
      파일들: string[]
      본문들: readonly (readonly [string, string])[]
    } {
      const 파일들 = dist파일들(distDir)
      const 본문들 = 파일들
        .filter((name) => 훑을확장자.some((ext) => name.toLowerCase().endsWith(ext)))
        // 공백을 지우고 찾는다: 최소화된 번들에는 공백이 없지만 `JSON.parse("…")`
        // 로 구운 것·맵 JSON 은 들여쓰기가 남아 있을 수 있다.
        .map(
          (name) => [name, readFileSync(join(distDir, name), 'utf8').replace(/\s+/g, '')] as const,
        )
      return { 파일들, 본문들 }
    }

    function 없어야한다(서명들: readonly 서명[]): void {
      const { 본문들 } = dist를읽는다()
      // 한 건도 안 훑으면 이 검사는 아무것도 안 재고 초록이 된다(apiBase.test.ts
      // 의 같은 자리와 같은 이유).
      expect(본문들.length).toBeGreaterThan(0)
      for (const [name, text] of 본문들) {
        for (const 서명 of 서명들) {
          for (const 꼴 of 서명.꼴들) {
            expect(text.includes(꼴), `${name} 에 ${서명.이름} 이 실려 있다`).toBe(false)
          }
        }
      }
    }

    it('채집 브라켓 확률이 없다', () => 없어야한다(채집서명))
    it('몬스터 드랍 확률이 없다', () => 없어야한다(드랍서명))
    it('결계 좌표가 없다', () => 없어야한다(결계서명))

    it('소스맵이 없다 — 있으면 위 셋을 통째로 우회한다', () => {
      const { 파일들, 본문들 } = dist를읽는다()
      // 소스맵은 최소화 이전의 소스를 그대로 담는다. 서버 전용 모듈이 어쩌다
      // 그래프에 들어왔다가 셰이킹으로 지워진 경우에도 소스맵에는 남을 수 있고,
      // 그러면 값 검사가 초록인 채로 표가 통째로 공개된다.
      expect(파일들.filter((name) => name.toLowerCase().endsWith('.map'))).toEqual([])
      for (const [name, text] of 본문들) {
        expect(text.includes('sourceMappingURL'), `${name} 이 소스맵을 가리킨다`).toBe(false)
      }
    })
  })
})

describe('숨은 문턱 — vite 설정', () => {
  it('소스맵을 켜지 않는다 — dist 검사보다 이른 자리에서 무는 자', () => {
    // 위 '소스맵이 없다' 는 dist 가 있을 때만 돈다. 이 한 줄은 늘 돌아서, 설정을
    // 켜는 커밋을 빌드 없이도 그 자리에서 잡는다.
    expect(viteConfig.build?.sourcemap ?? false).toBe(false)
  })
})
