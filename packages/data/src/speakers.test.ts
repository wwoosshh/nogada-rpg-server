import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './parse.js'
import { parseSpeakers } from './speakers.js'

function validRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    id: '채집장노인', name: '채집장 노인', kind: 'npc', mapId: 'world', x: '16', y: '12', sprite: 'npc_elder',
    ...overrides,
  }
}

describe('parseSpeakers', () => {
  it('행 하나를 SpeakerDef 로 만든다', () => {
    // x·y 가 문자열이 아니라 숫자로 나오는 것이 핵심이다 — 배치 검증과
    // 클라이언트의 타일 계산이 둘 다 숫자로 다루므로, 여기서 문자열이 새면
    // "16" * 32 같은 조용한 계산 오류로 이어진다.
    const speakers = parseSpeakers([validRow()])
    expect(speakers.채집장노인).toEqual({
      id: '채집장노인', name: '채집장 노인', kind: 'npc', mapId: 'world', x: 16, y: 12, sprite: 'npc_elder',
    })
  })

  it('x·y 는 타일 좌표라 0 을 허용한다', () => {
    // NodePlacement 와 같은 성격이다 — toInt 의 기본 최솟값 1 을 그대로 쓰면
    // 지도 맨 왼쪽 위 타일(0,0)에 화자를 놓을 수 없어진다.
    const speakers = parseSpeakers([validRow({ x: '0', y: '0' })])
    expect(speakers.채집장노인).toMatchObject({ x: 0, y: 0 })
  })

  it('sign 종류도 파싱한다', () => {
    // 이 게임에서는 안내판 같은 사물도 화자다(설계 §5) — npc 만 통과시키면
    // 안내판 대사를 쓸 방법이 아예 없어진다.
    const speakers = parseSpeakers([validRow({ id: '얼음안내판', name: '안내판', kind: 'sign', x: '3', y: '27', sprite: 'sign_wood' })])
    expect(speakers.얼음안내판?.kind).toBe('sign')
  })

  it('알 수 없는 kind 값을 거부한다', () => {
    // kind 는 나중에 클라이언트가 무엇으로 그릴지 고르는 값이라, 오타가
    // 통과하면 화자가 화면에 안 나오는 형태로 한참 뒤에 드러난다.
    expect(() => parseSpeakers([validRow({ kind: 'monster' })])).toThrow(
      'speakers.csv[채집장노인]: kind 는 npc 또는 sign 이어야 한다',
    )
  })

  it('필수 칸이 비어 있으면 거부한다', () => {
    // 빈 칸을 빈 문자열로 통과시키면 이름 없는 화자가 만들어져, 대사창에
    // 말하는 사람 자리가 비어 나온다.
    expect(() => parseSpeakers([validRow({ name: '' })])).toThrow(/name/)
  })

  it('중복된 id 를 거부한다', () => {
    // 조용히 덮어쓰면 CSV 에 있는 행 하나가 아무 말 없이 사라진다 —
    // 다른 CSV 파서(addUnique)가 같은 이유로 같은 것을 막는다.
    expect(() => parseSpeakers([validRow(), validRow()])).toThrow('speakers.csv: 중복된 id "채집장노인"')
  })

  it('실제로 출하되는 CSV 데이터를 오류 없이 파싱한다', () => {
    // 행을 여기 베껴 두면 CSV 를 고쳐도 이 테스트는 계속 통과해서, "실제로
    // 출하되는 데이터"라는 이름이 거짓말이 된다 — build.ts 가 읽는 그 파일을
    // 그대로 읽는다.
    const here = dirname(fileURLToPath(import.meta.url))
    const rows = parseCsv(readFileSync(join(here, '..', 'csv', 'speakers.csv'), 'utf8'))
    const speakers = parseSpeakers(rows)
    expect(Object.keys(speakers).sort()).toEqual(['얼음안내판', '채집장노인'])
  })
})
