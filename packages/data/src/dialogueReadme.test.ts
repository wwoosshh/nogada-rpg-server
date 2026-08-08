import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DECLARED_FACTS, EVENT_ORDER } from '@nogada/shared'
import { DIALOGUE_OPS } from './dialogueParse.js'

/**
 * `dialogue/README.md` 가 코드와 어긋나지 않는지 지킨다.
 *
 * 그 README 는 작가가 "무엇을 쓸 수 있는가"를 찾아보는 유일한 곳이다 —
 * 코드를 읽지 않고 대사를 쓸 수 있어야 한다는 것이 이 영역 전체의 목표다.
 * 그런데 실제 목록(DECLARED_FACTS·EVENT_ORDER·DIALOGUE_OPS)은 TypeScript 에
 * 있으므로, 둘이 갈라지는 순간 README 는 "없는 것보다 나쁜" 문서가 된다 —
 * 작가가 그걸 믿고 쓴 조건이 빌드에서 막히거나, 쓸 수 있는 것을 못 쓴다.
 *
 * README 를 생성하지 않고 손으로 쓰되 이 테스트로 묶어 두는 쪽을 골랐다:
 * README 의 값어치는 표가 아니라 그 옆의 설명("이 사실은 무엇이고 언제
 * 쓰나")에 있는데, 그건 생성할 수 없는 산문이다. 표만 생성하려면 문서에
 * 생성 구간 표시를 넣고 빌드 단계를 하나 더 만들어야 하는데, 그 장치가
 * 지키는 것과 이 테스트가 지키는 것이 정확히 같다.
 */
const README = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'dialogue', 'README.md'), 'utf8')

/**
 * `## <제목>` 절 안에 있는 표에서, 첫 칸이 백틱으로 시작하는 행만 뽑는다.
 * 백틱 조건이 표 머리와 구분선을 자연스럽게 걸러 준다.
 */
function tableRows(heading: string): string[][] {
  const lines = README.split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`)
  if (start < 0) throw new Error(`README 에 "## ${heading}" 절이 없다`)

  const rows: string[][] = []
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('## ')) break
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim())
    if (cells[0]?.startsWith('`')) rows.push(cells)
  }
  return rows
}

/** 표의 `코드` 칸에서 백틱을 벗긴다. */
function code(cell: string | undefined): string {
  return (cell ?? '').replace(/`/g, '')
}

describe('dialogue/README.md — 코드와 어긋나지 않는다', () => {
  it('사실 표가 DECLARED_FACTS 와 같다', () => {
    // 접두사 사실(skill.)은 README 에 `skill.*` 로 적는다 — 뒤가 열려 있다는
    // 것이 작가에게 보이는 표기이고, 여기서 기계적으로 대조할 수 있다.
    const documented = tableRows('사실')
      .map((r) => `${code(r[0])} ${r[1]}`)
      .sort()
    const declared = DECLARED_FACTS.map(
      (spec) => `${spec.prefix ? `${spec.name}*` : spec.name} ${spec.supplied ? '예' : '아직'}`,
    ).sort()
    expect(documented).toEqual(declared)
  })

  it('사건 표가 EVENT_ORDER 와 같다', () => {
    const documented = tableRows('사건').map((r) => code(r[0]).replace('@', ''))
    // 서열이 곧 우선순위라 순서까지 같아야 한다 — README 가 순서를 다르게
    // 적으면 작가는 "무엇이 무엇을 이기는가"를 거꾸로 배운다.
    expect(documented).toEqual([...EVENT_ORDER])
  })

  it('연산자 표가 파서가 받는 연산자와 같다', () => {
    const documented = tableRows('연산자').map((r) => code(r[0])).sort()
    expect(documented).toEqual([...DIALOGUE_OPS].sort())
  })
})
