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
 * **Phaser 쪽 리터럴은 지우지 않고 묶는다.** ControlScene·PanelScene·HudScene·
 * DialogueScene 은 같은 색을 각자 숫자로 들고 있다(`0x3a2f2a` 등). 그것은 빚이
 * 아니라 결정이다: Phaser 도형은 CSS 변수를 못 읽고, 네 파일이 각자 그 사실과
 * 「바꿀 때 tokens.css 와 함께 고친다」를 자기 상단 주석에 적어 뒀다. 그런데 그
 * 약속을 지키는 것이 **주석뿐**이라 실제로 한 줄이 새어 있었다 — 미니맵의 흰 점
 * (`ME_COLOR = 0xffffff`)만 tokens.css 에 짝이 없었다. 은퇴한 노드 색이 정확히
 * 그 길로 갔다(화면 파일에만 색이 있고 팔레트에는 없다). 그래서 아래 셋째 검사가
 * **네 씬의 숫자를 팔레트에 묶는다** — 지우는 것이 아니라 짝을 강제한다.
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

  /*
   * UI 씬 넷 — 각자 상단에 「바꿀 때 tokens.css 와 함께 고친다」를 적어 둔 파일들.
   * 세계를 그리는 쪽(DayNightOverlay 의 검정 · WeatherSky 의 하늘색 · MonsterSprite
   * 의 피격 섬광)은 여기 없다: 그것들은 UI 팔레트가 아니라 **연출**이고, 팔레트에
   * 끌어올리면 「타일셋에서 추출한 색만」이라는 이 파일 첫 줄이 흔들린다.
   */
  const UI씬들 = [
    'game/scenes/ControlScene.ts',
    'game/scenes/DialogueScene.ts',
    'game/scenes/HudScene.ts',
    'game/scenes/PanelScene.ts',
  ] as const

  it('UI 씬의 색 숫자는 전부 tokens.css 에 짝이 있다', () => {
    const tokens = readFileSync(join(stylesDir, 'tokens.css'), 'utf8')
    const 팔레트 = new Set(
      [...tokens.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => m[1]!.toLowerCase()),
    )
    expect(팔레트.size, 'tokens.css 에서 색을 하나도 못 읽었다').toBeGreaterThan(5)

    for (const rel of UI씬들) {
      const src = readFileSync(join(clientSrc, rel), 'utf8')
      // 주석 속의 예시(`0x3a2f2a` 등)까지 세는 것이 맞다 — 팔레트를 손보는 날
      // 그 주석도 함께 낡는다.
      const 색들 = [...src.matchAll(/\b0x([0-9a-fA-F]{6})\b/g)].map((m) => m[1]!.toLowerCase())
      expect(색들.length, `${rel} 에서 색 숫자를 하나도 못 읽었다`).toBeGreaterThan(0)
      for (const 색 of new Set(색들)) {
        expect(팔레트.has(색), `${rel} 의 0x${색} 이 tokens.css 에 없다`).toBe(true)
      }
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
