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
    const line = rawLine.trim()
    const copied = /^([a-z_]+):(\d+)$/.exec(line)
    if (copied) map.set(copied[1]!, copied[2]!)
    // **색으로 파생한 아이콘**도 복원 가능한 이름이다(4단 도구 넷 · 벼락 심재).
    // 팩에 없는 그림이라 `name:num` 줄이 아니라 magick 한 줄로 만들어지는데, 이
    // 문서만으로 재구성된다는 점에서는 같다. 값에 `derived:` 를 붙여 아래
    // "두 이름이 같은 원본 번호를 가리키지 않는다" 검사와 섞이지 않게 한다 —
    // 파생본이 원본과 같은 번호를 쓰는 것은 정상이고(미스릴 도구 → 별똥 도구)
    // 그것을 중복으로 세면 그 검사가 옳은 데이터를 거절한다.
    const derived = /"\$I\/([a-z_]+)\.png"$/.exec(line)
    if (derived) map.set(derived[1]!, `derived:${derived[1]!}`)
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

  /**
   * 대장 첫 줄이 적는 **개수 셋**이 실제와 같은가.
   *
   * 그 줄은 사람이 손으로 세어 적는데, 아크 B 에서 한 커밋이 두 줄을 더하면서 안
   * 올려 65/61 이 72/68 과 어긋난 채 남았다. 문서가 자기 내용과 다른 수를 말하면
   * 다음 사람이 "빠진 게 있나" 를 세느라 시간을 쓴다 — 그 셈을 여기서 한다.
   */
  it('CREDITS.md 첫 줄의 아이콘 개수 셋이 실제와 같다', () => {
    const credits = readFileSync(join(repoRoot, 'assets', 'CREDITS.md'), 'utf8')
    const header = /# 아이템 아이콘 (\d+)종\(여기 복사 (\d+) \+ 아래 색 파생 (\d+)\)[\s\S]*?이 중 (\d+)종을 쓴다/.exec(credits)
    expect(header, 'CREDITS.md 의 아이콘 개수 머리글').not.toBeNull()
    const [, total, copiedText, derivedText, usedText] = header!

    const copied = [...credits.matchAll(/^[a-z_]+:\d+$/gm)].length
    const derived = new Set([...credits.matchAll(/"\$I\/([a-z_]+)\.png"/g)].map((m) => m[1]!)).size
    const used = new Set(Object.values(loadGameData().items).map((i) => i.icon)).size

    expect(Number(copiedText)).toBe(copied)
    expect(Number(derivedText)).toBe(derived)
    expect(Number(total)).toBe(copied + derived)
    expect(Number(usedText)).toBe(used)
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
