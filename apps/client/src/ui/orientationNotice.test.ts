import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ROTATE_BODY,
  ROTATE_HINT,
  ROTATE_KEEP,
  ROTATE_LOCK,
  ROTATE_TITLE,
} from './OrientationNotice.js'

/**
 * **세로로 든 화면에 안내가 뜨는가** — 그 사슬을 잰다.
 *
 * 이 자가 재지 못하는 것을 먼저 적는다: **진짜로 뜨는지는 브라우저에서만 보인다.**
 * 여기 있는 것은 전부 소스를 읽는 검사라, 미디어 쿼리가 문법적으로 서 있고 서로
 * 이름이 맞는지까지만 안다. 실제로 375×812 에서 덮이는지, 812×375 로 돌리면
 * 사라지고 게임이 살아 있는지는 사람이 눈으로 봐야 한다(태스크 보고에 적었다).
 *
 * 그럼에도 자를 대는 이유는 이 기능이 **개발 PC 의 평상시 화면에서 절대 안 보이는
 * 자리**에 살기 때문이다. 데스크톱 브라우저는 늘 가로라 누가 이 블록을 지우거나
 * 클래스 이름을 한쪽만 고쳐도 아무 화면도 안 바뀌고, 증상은 폰을 세로로 든
 * 사람에게만 — 그것도 "아무 말도 안 해 준다"는 침묵으로만 — 나타난다.
 *
 * 그래서 잡으려는 실패가 넷이다:
 * ① 미디어 쿼리가 통째로 사라지는 것,
 * ② CSS 와 컴포넌트의 클래스 이름이 한쪽만 고쳐져 갈라지는 것,
 * ③ main.tsx 에서 마운트가 빠져 CSS 만 남는 것(죽은 규칙),
 * ④ 문구가 두 벌이 되는 것 — `ALREADY_FULL_TEXT` 의 그 교훈이다.
 */

const uiDir = fileURLToPath(new URL('.', import.meta.url))
const srcDir = fileURLToPath(new URL('..', import.meta.url))
const uiCss = readFileSync(join(uiDir, 'ui.css'), 'utf8')
const noticeTsx = readFileSync(join(uiDir, 'OrientationNotice.tsx'), 'utf8')
const mainTsx = readFileSync(join(srcDir, 'main.tsx'), 'utf8')

/**
 * 프렐류드에 `orientation: portrait` 가 든 `@media` 의 **본문**을 꺼낸다.
 *
 * 정규식으로 `}` 까지 자르지 않고 중괄호를 세는 이유는 이 블록 안에 규칙이 여럿
 * 들어 있어서다 — `[\s\S]*?\}` 로 자르면 첫 규칙에서 끊기고, 그러면 "블록이 있다"는
 * 초록인데 정작 무엇이 들어 있는지는 못 보는 자가 된다.
 */
function 세로블록(css: string): string {
  const 시작 = /@media[^{]*orientation:\s*portrait[^{]*\{/.exec(css)
  expect(시작, 'ui.css 에 orientation: portrait 미디어 쿼리가 없다').not.toBeNull()

  let i = 시작!.index + 시작![0].length
  let 깊이 = 1
  const 본문시작 = i
  while (i < css.length && 깊이 > 0) {
    if (css[i] === '{') 깊이 += 1
    else if (css[i] === '}') 깊이 -= 1
    i += 1
  }
  expect(깊이, '미디어 쿼리의 중괄호가 안 닫혔다').toBe(0)
  return css.slice(본문시작, i - 1)
}

/** `.rotate`·`.rotate__box` 처럼 이 기능이 쓰는 클래스 이름만 모은다. */
function 회전클래스(글: string, 정규식: RegExp): Set<string> {
  return new Set(Array.from(글.matchAll(정규식), (m) => m[1]!))
}

/** 주석을 지운다 — 주석이 언급한 선택자 이름이 규칙으로 잡히지 않게. */
function 주석없이(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 선택자 **하나의 선언 뭉치**만 꺼낸다.
 *
 * 왜 블록 전체가 아니라 규칙 하나인가. 미디어 블록 본문에 정규식을 그냥 대면
 * 같은 블록 안의 **다른 규칙**이 대신 맞아 준다. 검토가 실측한 구멍이 그것이다 —
 * `.rotate__box` 도 `display: flex` 라, `.rotate` 자신을 `display: none` 으로
 * 바꿔 세로 화면에서 안내가 한 픽셀도 안 뜨게 만들어도 블록 전체를 훑는 자는
 * 9개 전부 초록이었다. 이 자가 유일한 그물인데 잡으려던 바로 그 실패를
 * 통과시킨 것이다. 그래서 이제 선언 뭉치를 떼어 내고 거기에만 자를 댄다.
 *
 * `\.rotate\s*\{` 는 `.rotate__box {` 에 안 걸린다 — "rotate" 다음이 `_` 라
 * `\s*\{` 가 못 맞기 때문이다. 그래서 접두사가 겹쳐도 규칙이 안 섞인다.
 */
function 규칙(css: string, 선택자: string): string {
  const 이름 = 선택자.replace(/\./g, '\\.')
  const m = new RegExp(`${이름}\\s*\\{([^}]*)\\}`).exec(주석없이(css))
  expect(m, `${선택자} 규칙을 못 찾았다`).not.toBeNull()
  return m![1]!
}

/** 규칙에서 z-index 값 하나를 읽는다. 없으면 `undefined` — 그것도 사실이다. */
function 쌓임순서(css: string, 선택자: string): number | undefined {
  const m = /z-index:\s*(-?\d+)/.exec(규칙(css, 선택자))
  return m ? Number(m[1]) : undefined
}

describe('세로 안내 — CSS', () => {
  it('orientation: portrait 블록이 있고 그 안에서 안내를 켠다', () => {
    // 누가 이 블록을 지우는 날을 잡는다. 지워도 화면은 안 바뀌므로(데스크톱은
    // 늘 가로다) 이 검사 말고는 알아챌 자리가 없다.
    //
    // 단언은 전부 `.rotate` **한 규칙**에 건다. 블록 전체에 걸면 이웃 규칙이
    // 대신 맞아 주어 정작 덮개가 죽은 날을 통과시킨다(위 `규칙()` 주석).
    const 덮개 = 규칙(세로블록(uiCss), '.rotate')
    expect(덮개, '블록 안에서 덮개를 켜지 않으면 규칙만 있고 아무 일도 안 한다').toMatch(
      /display:\s*flex/,
    )
    // 화면 전체를 덮는다는 판단 자체를 못 박는다 — `position: fixed; inset: 0` 이
    // 아니면 게임이 반쯤 비치고, 그 화면은 "놀 수 있는 것처럼" 보인다.
    expect(덮개).toMatch(/position:\s*fixed/)
    expect(덮개).toMatch(/inset:\s*0/)
    // 불투명한 배경이 곧 이 기능이다. 이 한 줄이 빠지면 덮개는 투명해지는데
    // `pointer-events` 는 그대로라 터치만 계속 막는다 — 게임이 멀쩡히 비치니
    // 사람은 못 쓰는 화면을 계속 두드리게 된다. ui.css 의 그 주석이 "반쯤
    // 보여 주는" 쪽을 거부한 이유이고, 보이면서 안 먹는 쪽은 그보다도 나쁘다.
    expect(덮개, '배경이 없으면 덮개가 투명해지고 터치만 막는다').toMatch(
      /background:\s*var\(--c-ink\)/,
    )
  })

  it('덮개가 모달·패널보다 위에 쌓인다', () => {
    // 장식이 아니다. App 루트 div 는 `position: relative; z-index: auto` 라
    // 쌓임 맥락을 안 만들고, `.modal`·`.panel` 은 z-index 를 가진 위치 요소다.
    // 그래서 이 값이 빠지면 DOM 순서와 무관하게 **패널이 덮개 위로 올라온다** —
    // 패널을 연 채 세로로 돌린 사람에게 덮개가 패널 밑에 깔린다.
    //
    // 상수 10 을 못 박지 않고 상대값으로 재는 이유: 나중에 패널 쪽이 올라가는
    // 날도 같이 잡으려는 것이다. 그날 이 자를 안 고치면 조용히 진다.
    const 덮개 = 쌓임순서(세로블록(uiCss), '.rotate')
    expect(덮개, '덮개에 z-index 가 없다 — 패널이 위로 올라온다').toBeDefined()
    for (const 이름 of ['.modal', '.panel']) {
      const z = 쌓임순서(uiCss, 이름)
      expect(z, `${이름} 의 z-index 를 못 읽었다 — 비교가 성립하지 않는다`).toBeDefined()
      expect(덮개!, `덮개가 ${이름} 보다 아래다`).toBeGreaterThan(z!)
    }
  })

  it('기본값은 감춤이다 — 미디어 쿼리가 깨져도 가로 화면을 덮지 않는다', () => {
    // 실패의 방향을 고정한다. 기본이 보임이면 쿼리가 깨지는 날 **가로로 게임하는
    // 사람 앞에** 덮개가 남는다. 안 뜨는 쪽으로 실패해야 한다.
    const 기본 = /(?:^|\n)\.rotate\s*\{([^}]*)\}/.exec(uiCss)
    expect(기본, '미디어 쿼리 밖에 .rotate 기본 규칙이 없다').not.toBeNull()
    expect(기본![1]).toMatch(/display:\s*none/)
  })

  it('폭 조건을 함께 건다 — 세로로 긴 데스크톱 창은 돌릴 것이 없다', () => {
    // `orientation: portrait` 는 기기가 아니라 뷰포트의 종횡비다. 폭 조건이
    // 빠지면 900×1200 짜리 멀쩡한 창에도 "돌려 주세요"가 뜬다.
    const 프렐류드 = /@media[^{]*orientation:\s*portrait[^{]*/.exec(uiCss)![0]
    const 폭 = /max-width:\s*(\d+)px/.exec(프렐류드)
    expect(폭, '폭 조건이 없다 — 세로로 긴 데스크톱 창까지 덮는다').not.toBeNull()
    // 812 는 이 게임의 설계 폭이다. 그 폭이면 UI 가 다 들어가므로 덮으면 안 된다.
    expect(Number(폭![1]), '설계 폭(812)에서도 덮으면 멀쩡한 화면을 가린다').toBeLessThan(812)
  })

  it('블록 안에 색 리터럴이 없다 — 팔레트는 tokens.css 하나다', () => {
    const 본문 = 세로블록(uiCss)
    expect(본문, '#hex 를 적으면 팔레트가 갈라진다').not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(본문, 'rgb()/hsl() 도 리터럴이다').not.toMatch(/\b(?:rgba?|hsla?)\s*\(/)
  })
})

describe('세로 안내 — 배선', () => {
  it('CSS 가 칠하는 클래스와 컴포넌트가 그리는 클래스가 같다', () => {
    // 한쪽 이름만 고치면 안내가 **글자만 남은 알몸으로** 뜬다 — 검은 배경도
    // 없이 세로 화면 위에 떠서, 고친 사람은 데스크톱에서 아무것도 못 본다.
    const css = 회전클래스(세로블록(uiCss) + uiCss, /\.(rotate(?:__[a-z-]+)?)\s*\{/g)
    const tsx = 회전클래스(noticeTsx, /className="(rotate(?:__[a-z-]+)?)"/g)
    expect(tsx.size, '컴포넌트가 rotate 클래스를 하나도 안 쓴다').toBeGreaterThan(0)
    for (const 이름 of tsx) {
      expect(css, `${이름} 를 그리는데 ui.css 에 그 규칙이 없다`).toContain(이름)
    }
    for (const 이름 of css) {
      expect(tsx, `ui.css 가 ${이름} 을 칠하는데 아무도 안 그린다 — 죽은 규칙이다`).toContain(이름)
    }
  })

  it('main.tsx 가 실제로 마운트한다 — 안 그리면 CSS 만 남는다', () => {
    // App.tsx 는 불가침 파일이라 이 안내는 main.tsx 에서만 걸린다. 그 한 줄이
    // 빠지면 ui.css 의 블록은 그대로 초록인데 화면에는 아무것도 안 뜬다.
    expect(mainTsx).toMatch(/<OrientationNotice\s*\/>/)
    expect(mainTsx).toMatch(/from '\.\/ui\/OrientationNotice\.js'/)
  })

  it('상태를 새로 만들지 않는다 — 방향을 아는 자는 CSS 하나다', () => {
    // 화면 방향을 JS 로 다시 관측해 스토어에 담으면 같은 사실의 사본이 둘이 되고,
    // 그 둘이 어긋나는 날 화면과 상태가 다른 말을 한다. 훅도 리스너도 없어야 한다.
    expect(noticeTsx, 'useState/useEffect 가 붙었다면 방향을 두 곳이 알게 된 것이다').not.toMatch(
      /\buse(?:State|Effect|Store|SyncExternalStore)\b/,
    )
    expect(noticeTsx, 'matchMedia 를 부르면 CSS 와 사본이 갈라진다').not.toMatch(/matchMedia/)
  })
})

describe('세로 안내 — 문구', () => {
  const 문구들 = { ROTATE_TITLE, ROTATE_BODY, ROTATE_HINT, ROTATE_LOCK, ROTATE_KEEP }

  it('다섯 줄이 비어 있지 않다', () => {
    for (const [이름, 값] of Object.entries(문구들)) {
      expect(값.trim().length, `${이름} 이 비었다`).toBeGreaterThan(0)
    }
  })

  it('같은 글자가 apps/client/src 안에 한 벌뿐이다 — 두 벌이 되면 한쪽만 고쳐진다', () => {
    // `ALREADY_FULL_TEXT` 가 그 교훈이다. 이 검사 자신은 글자를 안 타이핑하고
    // 상수를 불러다 쓴다 — 그러지 않으면 자가 곧 두 번째 사본이 된다.
    //
    // 이름이 "저장소에"가 아니라 "apps/client/src 안에"인 이유: `소스파일들()` 이
    // 걷는 곳이 거기까지다. 한때 docs/deploy-public.md 가 이 문구를 따옴표로
    // 물고 있었는데 이 자는 그것을 못 봤다 — 그래서 문서 쪽의 따옴표를 지웠고
    // (산문으로 풀어 쓰면 사본이 아니다), 이름도 재는 만큼으로 좁혔다.
    for (const [이름, 값] of Object.entries(문구들)) {
      const 가진파일 = 소스파일들().filter((f) => readFileSync(f, 'utf8').includes(값))
      expect(가진파일.map((f) => f.slice(srcDir.length)), `${이름} 이 여러 벌이다`).toHaveLength(1)
      expect(가진파일[0]!.endsWith('OrientationNotice.tsx'), `${이름} 이 남의 집에 있다`).toBe(true)
    }
  })
})

/** apps/client/src 아래의 소스 전부. 문구 사본을 셀 때 쓴다. */
function 소스파일들(): string[] {
  const 모은것: string[] = []
  const 걷기 = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) 걷기(p)
      else if (['.ts', '.tsx', '.css', '.html'].includes(extname(e.name))) 모은것.push(p)
    }
  }
  걷기(srcDir)
  return 모은것
}
