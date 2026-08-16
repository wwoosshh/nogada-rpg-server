import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **홈 화면에 추가하면 게임처럼 열리는가** — 그 사슬을 잰다.
 *
 * 왜 자가 필요한가: manifest 는 JSON 이라 **조용히 깨진다.** 쉼표 하나가 남거나
 * 파일 이름이 갈라지면 브라우저는 그 파일을 통째로 무시하고 **아무 말도 안 한다.**
 * 증상은 "설치 메뉴가 안 뜬다" 하나뿐이고, 그것도 HTTPS 오리진의 폰에서만 보인다
 * (설치는 https 나 localhost 를 하드 요구조건으로 건다 — docs/deploy-public.md).
 * 즉 사람이 알아채는 자리가 개발 PC 에는 없다.
 *
 * 끊기는 자리가 넷이라 자도 넷이다: ① JSON 이 깨지는 것, ② index.html 이 다른
 * 이름을 가리키는 것, ③ 적은 크기와 실제 PNG 가 다른 것(192 라 적고 180 을 두면
 * 크롬이 설치를 **거부한다**), ④ 색이 tokens.css 와 갈라지는 것.
 *
 * **이 자가 재지 않는 것 — 폰이 실제로 설치를 제안하는가.** 여기 있는 검사는
 * 전부 manifest 쪽 요건이고, 안드로이드 크롬의 설치 배너·WebAPK 발급은 그것
 * 말고도 **fetch 핸들러를 가진 서비스워커**를 오래 함께 요구해 왔다. 이
 * 클라이언트에는 서비스워커가 한 개도 없다(실측: `apps/client/src` 에
 * `serviceWorker` grep 0건). 즉 아래가 전부 초록이어도 "홈 화면에 추가하면
 * 게임처럼 열린다"가 성립한다는 뜻은 **아니다** — manifest 쪽은 여기서 재고,
 * 설치가 실제로 되는지는 진짜 안드로이드에서 ⋮ → '앱 설치' 가 뜨는지 눈으로
 * 봐야 알며 아직 아무 기계에서도 안 재 봤다. 안 뜨면 붙일 것은 최소한의
 * 서비스워커 한 장이고, 그 자리는 여기가 아니라 별도 태스크다.
 */

const clientRoot = fileURLToPath(new URL('..', import.meta.url))
const publicDir = join(clientRoot, 'public')
const manifestPath = join(publicDir, 'manifest.webmanifest')

const manifestText = readFileSync(manifestPath, 'utf8')
const indexHtml = readFileSync(join(clientRoot, 'index.html'), 'utf8')

/**
 * manifest 가 적은 색이 어느 토큰의 값인지 **여기에 못 박는다.**
 *
 * manifest 는 JSON 이라 주석을 못 달고, index.html 의 `theme-color` 는 CSS 가
 * 아니라 `var()` 를 못 쓴다. 그래서 리터럴이 불가피한 자리가 셋 생겼고, 그 셋이
 * 팔레트에서 갈라지는 날 아무도 못 본다 — 게임 화면만 새 색으로 바뀌고 상태바와
 * 스플래시는 옛 색으로 남는데, 그 어긋남은 **설치한 폰에서만** 보인다.
 * 아래 검사가 tokens.css 를 실제로 읽어서 잰다.
 *
 * `--c-ink` 인 이유: global.css 가 html/body/#root 에 칠하는 바로 그 색이다.
 * 상태바(theme_color)와 기동 스플래시(background_color)가 그것과 같아야 게임이
 * 화면 끝까지 이어져 보이고, 뜨는 순간의 색 번쩍임도 없다.
 */
const 색_토큰 = {
  theme_color: 'ink',
  background_color: 'ink',
} as const

function 토큰값(이름: string): string {
  const css = readFileSync(join(clientRoot, 'src/styles/tokens.css'), 'utf8')
  const 찾은것 = new RegExp(`--c-${이름}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css)
  expect(찾은것, `tokens.css 에 --c-${이름} 이 없다`).not.toBeNull()
  return 찾은것![1]!.toLowerCase()
}

/** `<link rel="...">` 의 href. index.html 에도 dist/index.html 에도 같이 쓴다. */
function 링크href(html: string, rel: string): string | undefined {
  const 태그 = new RegExp(`<link[^>]*rel="${rel}"[^>]*>`, 'i').exec(html)?.[0]
  return 태그 ? /href="([^"]+)"/i.exec(태그)?.[1] : undefined
}

/**
 * PNG 의 실제 크기를 헤더에서 읽는다. 라이브러리를 안 쓰는 이유는 이 자가 재는
 * 것이 **파일이 정말 그 크기인가**이기 때문이다 — 굽는 스크립트와 같은 Pillow 로
 * 재면 스크립트가 틀렸을 때 자도 같이 틀린다.
 *
 * IHDR 은 규격상 첫 청크라 자리가 고정이다: 서명 8바이트 + 길이 4 + 'IHDR' 4
 * 다음에 폭·높이가 빅엔디언 4바이트씩.
 */
function png크기(경로: string): { width: number; height: number } {
  const buf = readFileSync(경로)
  expect(buf.subarray(12, 16).toString('ascii'), `${경로} 가 PNG 가 아니다`).toBe('IHDR')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * **describe 본문이 아니라 검사 안에서** 판다. 여기서 던지면 파일이 통째로
 * 수집에 실패해서, 정작 "유효한 JSON 이다" 라는 이름의 검사는 돌지도 못하고
 * 실패 목록에 안 나온다 — 고치는 사람이 무엇이 틀렸는지 이름으로 못 읽는다.
 */
function 읽기(): Record<string, any> {
  try {
    return JSON.parse(manifestText)
  } catch (e) {
    throw new Error(`manifest.webmanifest 가 유효한 JSON 이 아니다: ${(e as Error).message}`)
  }
}

describe('manifest.webmanifest', () => {
  it('유효한 JSON 이다 — 깨지면 브라우저가 통째로 무시하고 아무 말도 안 한다', () => {
    expect(() => 읽기()).not.toThrow()
  })

  it('주소창을 없애고 가로로 잠근다 — 이 둘이 홈 화면 추가의 값어치 전부다', () => {
    const manifest = 읽기()
    // standalone 이 아니면 주소창 50px 을 그대로 먹고, landscape 가 아니면
    // 세로로 든 폰에서 화면이 무너진다 — 이 게임은 812x375 가로 고정 전제다.
    expect(manifest.display).toBe('standalone')
    expect(manifest.orientation).toBe('landscape')
  })

  it('이름이 있고 short_name 이 홈 화면 라벨 길이 안이다', () => {
    const manifest = 읽기()
    // 게임 이름은 index.html 의 title·Capacitor 의 appName 과 같은 것이어야 한다.
    expect(manifest.name).toBe('노가다 RPG')
    expect(indexHtml).toContain(`<title>${manifest.name}</title>`)
    // 안드로이드 런처는 아이콘 밑 라벨을 12자 안팎에서 자른다. 잘린 이름은
    // 무엇인지 못 알아보므로 짧은 쪽을 따로 준다.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12)
  })

  it('주소를 하나도 안 박는다 — 도메인이 바뀌어도 안 깨지는 자리다', () => {
    const manifest = 읽기()
    // `.env.production` 을 비운 것과 **같은 판단**이다(apiBase.test.ts). 같은
    // 오리진 서빙이라 절대 주소를 적을 이유가 없고, 적으면 주소가 바뀌는 날
    // 설치된 폰들이 옛 주소를 계속 연다 — 그건 재빌드로도 못 고친다.
    const 주소칸 = [
      manifest.start_url,
      manifest.scope,
      ...manifest.icons.map((i: { src: string }) => i.src),
    ]
    for (const 값 of 주소칸) {
      expect(값, '절대 주소가 박혔다').not.toMatch(/^[a-z]+:\/\//i)
      expect(값, '오리진 루트를 박으면 하위 경로로 옮기는 날 깨진다').not.toMatch(/^\//)
    }
  })

  it('id 를 적지 않는다 — 이 칸만 상대값이 상대값으로 안 풀린다', () => {
    const manifest = 읽기()
    // **위 검사가 못 재는 칸이라 따로 판다.** 위는 글자 모양만 보는데(`^/` 와
    // `^scheme://`), `id` 는 명세상 **start_url 의 오리진**을 기준으로 풀린다 —
    // manifest 파일의 위치가 아니다. 그래서 `"id": "./"` 라고 적어도 그것은
    // 상대값이 아니라 오리진 루트를 박는 것과 같고, 위 자는 그 차이를 못 본다.
    //
    // 지금 배치(manifest 가 웹 루트)에서는 둘이 같은 주소라 아무 일도 안 하지만,
    // 하위 경로(`/game/`)로 옮기는 날 start_url·scope·icons 만 따라 움직이고 id 는
    // 루트에 남아 갈라진다. 생략하면 기본값이 곧 start_url 이라 **적을 때보다
    // 정확하다** — 그래서 이 저장소는 이 칸을 비워 둔다.
    expect(manifest.id, 'id 는 오리진 기준이라 상대값 약속을 못 지킨다 — 비워 둔다').toBeUndefined()
  })

  it('아이콘이 실제로 있고 적힌 크기와 파일이 같다 — 다르면 크롬이 설치를 거부한다', () => {
    const manifest = 읽기()
    // 192 와 512 둘 다 있어야 크롬이 설치 가능으로 친다.
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes).sort()).toEqual([
      '192x192',
      '512x512',
    ])

    for (const icon of manifest.icons) {
      // src 는 manifest 위치 기준 상대경로다. manifest 가 public/ 루트에 있으므로
      // public/ 아래에서 찾는다.
      const 경로 = join(publicDir, icon.src)
      expect(existsSync(경로), `${icon.src} 가 없다 — python scripts/bake-app-icon.py`).toBe(true)

      const [w, h] = icon.sizes.split('x').map(Number)
      // **이 검사가 이 파일의 존재 이유 절반이다.** 적은 크기와 파일이 다르면
      // 크롬은 그 아이콘을 무시하고, 192/512 가 둘 다 없다고 판단해 설치
      // 메뉴를 안 띄운다 — 그런데 콘솔에는 아무 말도 안 남는다.
      expect(png크기(경로), `${icon.src} 의 실제 크기가 ${icon.sizes} 가 아니다`).toEqual({
        width: w,
        height: h,
      })
      expect(icon.type).toBe('image/png')
      // 안드로이드 런처는 아이콘을 제 모양으로 잘라 낸다. maskable 을 안 주면
      // 어두운 픽셀 그림이 흰 원 안에 축소돼 박히고, any 를 안 주면 크롬이
      // 설치 요건을 못 채웠다고 본다 — 그래서 한 파일이 둘 다 맡는다.
      // 가장자리를 비워 두는 것은 bake-app-icon.py 의 _안전영역검사() 가 잰다.
      expect(icon.purpose).toBe('any maskable')
    }
  })

  it('색이 tokens.css 와 갈라지지 않았다 — JSON 은 var() 를 못 쓴다', () => {
    const manifest = 읽기()
    for (const [칸, 토큰] of Object.entries(색_토큰)) {
      expect(manifest[칸]?.toLowerCase(), `${칸} 이 --c-${토큰} 과 다르다`).toBe(토큰값(토큰))
    }
  })
})

describe('index.html', () => {
  it('manifest 를 실제로 있는 파일로 가리킨다 — 이름이 갈라지는 날을 잡는다', () => {
    const href = 링크href(indexHtml, 'manifest')
    expect(href, '<link rel="manifest"> 가 없다').toBeDefined()
    // 소스의 `/…` 는 public/ 기준이다(vite 가 빌드에서 base 에 맞춰 바꾼다).
    expect(existsSync(join(publicDir, href!)), `${href} 가 public/ 에 없다`).toBe(true)
  })

  it('theme-color 가 manifest 와 같은 값이다 — 갈라지면 설치 전후로 색이 바뀐다', () => {
    const manifest = 읽기()
    // 브라우저는 설치 전에 이 meta 를, 설치 뒤에 manifest 를 본다. 한쪽만
    // 고치면 주소창 색과 앱 상태바 색이 서로 다른 색이 된다.
    const 태그 = /<meta[^>]*name="theme-color"[^>]*>/i.exec(indexHtml)?.[0]
    expect(태그, '<meta name="theme-color"> 가 없다').toBeDefined()
    const 값 = /content="([^"]+)"/i.exec(태그!)?.[1]
    expect(값?.toLowerCase()).toBe(manifest.theme_color.toLowerCase())
  })

  it('apple-touch-icon 이 진짜 그림이고 manifest 가 적은 그것과 같은 파일이다', () => {
    // iOS 홈 화면 아이콘은 이 줄로만 정해진다. 없으면 화면을 축소한
    // 스크린샷이 아이콘이 되는데, 그 실패는 아이폰에서만 보인다.
    //
    // **전에는 존재만 쟀고, 그래서 안 물었다** — href 를 `/manifest.webmanifest`
    // 로 바꿔 놔도 열 검사가 전부 초록이었다(실측). 개발 PC 에서 절대 안 보이는
    // 유일한 칸을 가장 약한 자로 재고 있었던 셈이라, manifest 쪽과 같은 자를 댄다.
    const manifest = 읽기()
    const href = 링크href(indexHtml, 'apple-touch-icon')
    expect(href, '<link rel="apple-touch-icon"> 가 없다').toBeDefined()
    const 경로 = join(publicDir, href!)
    expect(existsSync(경로), `${href} 가 public/ 에 없다`).toBe(true)

    // 사파리는 이 파일을 **그림으로** 읽는다. PNG 가 아니면 아이콘이 통째로 없는
    // 것과 같고, 그때도 콘솔에는 아무 말이 안 남는다.
    const { width, height } = png크기(경로)
    expect(width, 'apple-touch-icon 이 정사각형이 아니다 — iOS 가 찌그러뜨린다').toBe(height)
    // 180x180 이 iOS 가 홈 화면에 쓰는 가장 큰 크기다. 그보다 작은 것을 주면
    // 늘려서 박으므로 픽셀 아트가 흐려진다.
    expect(width, 'iOS 홈 화면은 180px 까지 쓴다 — 그보다 작으면 늘어난다').toBeGreaterThanOrEqual(
      180,
    )

    // manifest 가 안 적은 그림을 아이폰에만 따로 주면 두 그림이 갈라지는데,
    // 그 어긋남은 안드로이드와 아이폰을 나란히 놓아야만 보인다. index.html 은
    // `/app-icon/…`, manifest 는 `app-icon/…` 라 앞의 `/` 를 떼고 잰다.
    const 아이콘들 = manifest.icons.map((i: { src: string }) => i.src)
    expect(아이콘들, 'manifest 에 없는 그림을 아이폰에만 준다').toContain(href!.replace(/^\//, ''))
  })
})

/**
 * 빌드된 dist 를 직접 읽는다 — 위 검사가 전부 초록인데도 폰에서 404 가 나는 길이
 * 남아 있다: `public/` 이 dist 로 안 복사되는 것, 그리고 vite 가 `base: './'` 에
 * 맞춰 경로를 바꾸면서 **manifest 만 못 바꾸는** 것(그러면 설치된 앱이 오리진
 * 루트를 찾아가고, 하위 경로 배포에서 깨진다).
 *
 * **dist 가 없으면 건너뛴다** — apiBase.test.ts 와 같은 판단이다. 빌드 안 한
 * 사람의 저장소를 빨갛게 만들지 않고, CI 는 테스트 앞에서 클라이언트를 빌드해
 * 이 자리가 실제로 돌게 한다(.github/workflows/deploy.yml).
 */
const distDir = join(clientRoot, 'dist')

describe.skipIf(!existsSync(distDir))('빌드된 dist (dist 가 있을 때만)', () => {
  it('manifest 와 아이콘이 dist 안에 있고, index.html 이 그것을 가리킨다', () => {
    const distIndex = readFileSync(join(distDir, 'index.html'), 'utf8')
    const href = 링크href(distIndex, 'manifest')
    expect(href, 'dist/index.html 에 manifest 링크가 없다').toBeDefined()
    // 빌드된 html 의 경로는 dist 루트 기준이다. `./manifest.webmanifest` 도
    // `/manifest.webmanifest` 도 여기서는 같은 파일을 가리킨다.
    const 파일 = join(distDir, href!.replace(/^\.?\//, ''))
    expect(existsSync(파일), `${href} 가 dist 에 없다 — public/ 이 복사됐는지 본다`).toBe(true)

    const 구운manifest = JSON.parse(readFileSync(파일, 'utf8'))
    for (const icon of 구운manifest.icons) {
      expect(existsSync(join(distDir, icon.src)), `${icon.src} 가 dist 에 없다`).toBe(true)
    }

    const apple = 링크href(distIndex, 'apple-touch-icon')
    expect(existsSync(join(distDir, apple!.replace(/^\.?\//, ''))), 'apple 아이콘이 dist 에 없다').toBe(
      true,
    )
  })
})
