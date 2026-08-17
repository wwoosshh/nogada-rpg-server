import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **팔레트 단일 출처**가 실제로 하나인지 잰다 — tokens.css 첫 줄의 규칙이다.
 *
 * 왜 자가 필요한가: 이 규칙은 **조용히 깨진다.** 색 리터럴 한 줄을 더 적어도
 * 화면은 그날 멀쩡하고, 어긋남은 팔레트를 손보는 **나중에** 나타난다 — 그것도
 * 「고장났다」가 아니라 「좀 이상한데」로만. 실제로 그렇게 넉 줄이 쌓였고
 * (`rgb(36 28 28 / 85%)` 둘 · `rgb(36 28 28 / 75%)` · `rgb(107 86 70 / 35%)`),
 * 그중 셋은 --c-ink 를, 하나는 --c-panel-edge 를 손으로 옮겨 적은 것이었다.
 *
 * **이 자가 재지 않는 것 — Phaser 쪽 리터럴.** ControlScene·PanelScene·HudScene·
 * DialogueScene 은 같은 색을 각자 숫자로 들고 있다(`0x3a2f2a` 등). 그것은 빚이
 * 아니라 결정이다: Phaser 도형은 CSS 변수를 못 읽고, 네 파일이 각자 그 사실과
 * 「바꿀 때 tokens.css 와 함께 고친다」를 자기 상단 주석에 적어 뒀다. 여기서
 * 재는 것은 **CSS 가 CSS 를 두 번 적는 것**뿐이다.
 */

const stylesDir = fileURLToPath(new URL('.', import.meta.url))
const clientSrc = join(stylesDir, '..')

/** tokens.css 를 뺀, 이 클라이언트의 모든 스타일시트. */
const 화면쪽_css = ['styles/global.css', 'ui/ui.css'] as const

/**
 * 색 리터럴로 읽히는 것들 — 16진수 · `rgb()`/`rgba()` · `hsl()`/`hsla()`.
 *
 * `var(--…)` 를 인자로 받은 `rgb()` 는 리터럴이 아니다(값이 여전히 tokens.css 에
 * 있다). 그래서 괄호 안에 숫자가 실제로 적힌 것만 잡는다.
 */
const 리터럴들 = (css: string): string[] => {
  const out: string[] = []
  for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) out.push(m[0])
  for (const m of css.matchAll(/\b(?:rgb|rgba|hsl|hsla)\(([^)]*)\)/g)) {
    if (/\d/.test(m[1] ?? '')) out.push(m[0])
  }
  return out
}

describe('팔레트 단일 출처', () => {
  it('tokens.css 밖의 CSS 에는 색 리터럴이 하나도 없다', () => {
    for (const rel of 화면쪽_css) {
      const css = readFileSync(join(clientSrc, rel), 'utf8')
      expect(리터럴들(css), `${rel} 에 색 리터럴이 있다 — tokens.css 의 변수를 쓰라`).toEqual([])
    }
  })

  it('반투명에 쓰는 채널값이 같은 파일의 16진수와 같은 색이다', () => {
    // 채널 토큰은 팔레트의 **두 번째 꼴**이라(그 이유는 tokens.css 의 주석) 두
    // 줄이 갈라질 수 있는 유일한 자리다. 갈라지면 반투명 자리만 옛 색으로 남고,
    // 그 어긋남은 화면에서 「좀 이상한데」로만 보인다.
    const tokens = readFileSync(join(stylesDir, 'tokens.css'), 'utf8')
    const 값 = (name: string): string => {
      const found = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens)
      expect(found, `tokens.css 에 --${name} 이 없다`).not.toBeNull()
      return found![1]!.trim()
    }
    const 십육진수를_채널로 = (hex: string): string => {
      const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex)
      expect(m, `${hex} 가 #rrggbb 가 아니다`).not.toBeNull()
      return m!.slice(1).map((h) => parseInt(h, 16)).join(' ')
    }

    for (const name of ['ink', 'panel-edge']) {
      expect(값(`c-${name}-rgb`), `--c-${name}-rgb 이 --c-${name} 과 다른 색이다`).toBe(
        십육진수를_채널로(값(`c-${name}`)),
      )
    }
  })

  it('채널 토큰은 실제로 쓰인다 — 안 쓰이면 팔레트에 죽은 줄이 는다', () => {
    // 양성 대조군. 은퇴한 노드 색이 남긴 교훈이 tokens.css 에 적혀 있다:
    // 지킬 주인이 없는 토큰은 언젠가 조용히 갈라진다.
    const ui = readFileSync(join(clientSrc, 'ui/ui.css'), 'utf8')
    expect(ui).toContain('var(--c-ink-rgb)')
    expect(ui).toContain('var(--c-panel-edge-rgb)')
  })
})
