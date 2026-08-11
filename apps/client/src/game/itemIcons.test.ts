import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')

/**
 * CREDITS.md 복원 heredoc(`name:num` 줄)을 파싱해 이름→번호 맵으로 돌려준다.
 * 줄 단위 정규식(`/^([a-z_]+):(\d+)$/`)만 쓴다 — `toContain` 부분 문자열 검사는
 * 예를 들어 `sickle_copper` 가 `sickle_copper2` 의 접두사인 경우를 오탐으로
 * 통과시킨다.
 */
function parseCreditsIconHeredoc(): Map<string, string> {
  const credits = readFileSync(join(repoRoot, 'assets', 'CREDITS.md'), 'utf8')
  const map = new Map<string, string>()
  for (const rawLine of credits.split('\n')) {
    const match = /^([a-z_]+):(\d+)$/.exec(rawLine.trim())
    if (match) map.set(match[1]!, match[2]!)
  }
  return map
}

describe('아이템 아이콘 — items.csv 와 CREDITS.md 복원 heredoc 대조', () => {
  // 왜: 아이콘 PNG 는 gitignore 대상이라 빌드가 파일 존재를 검사할 수 없다.
  //     items.csv 의 icon 값이 CREDITS 복원 heredoc 에 없으면 다른 환경에서
  //     복원했을 때 그 아이템만 조용히 빈 그림이 된다 — 런타임에도 안 잡힌다.
  it('모든 아이템의 icon 값이 CREDITS.md 복원 heredoc 에 있다', () => {
    const heredocNames = parseCreditsIconHeredoc()
    const items = loadGameData().items
    for (const [id, item] of Object.entries(items)) {
      expect(heredocNames.has(item.icon), `아이템 "${id}" 의 icon "${item.icon}"`).toBe(true)
    }
  })

  // 왜: 서로 다른 아이템이 같은 그림을 돌려쓰면 가방·제작 패널에서 구별이
  //     안 된다 — 이름은 다른데 그림이 같으면 뭘 모았는지 눈으로 알 수 없다.
  it('아이템마다 서로 다른 아이콘 그림을 쓴다', () => {
    const items = loadGameData().items
    const icons = Object.values(items).map((item) => item.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  // 왜: heredoc 에서 두 이름이 같은 원본 번호를 가리키면, 겉보기엔 서로 다른
  //     아이콘 이름인데 실제로 복원되는 그림은 한 장뿐이다 — (b)가 잡아내지
  //     못하는 잠복 중복이다.
  it('CREDITS.md 복원 heredoc 에서 두 이름이 같은 원본 번호를 가리키지 않는다', () => {
    const heredocNames = parseCreditsIconHeredoc()
    const numbers = [...heredocNames.values()]
    expect(new Set(numbers).size).toBe(numbers.length)
  })
})
