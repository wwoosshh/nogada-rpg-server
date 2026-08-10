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
      facing: 'down',
    })
  })

  it('facing 칸이 아예 없는 CSV 도 읽는다 — 기본 자세는 아래다', () => {
    // 선택 칸이라야 하는 이유: 이 칸이 생기기 전에 쓰인 행들이 그대로 살아
    // 있어야 한다. 필수로 만들면 화자를 한 명 더할 때가 아니라 이 칸을 더하는
    // 순간 이미 있던 모든 행을 고쳐야 한다.
    const row = validRow()
    expect('facing' in row).toBe(false)
    expect(parseSpeakers([row]).채집장노인?.facing).toBe('down')
  })

  it('빈 facing 칸도 기본 자세로 읽는다', () => {
    // 사물(간판)은 방향이 없어서 이 칸을 비워 둔다. 빈 칸을 "필수 항목이
    // 비었다"로 거절하면 간판마다 의미 없는 방향을 적어 넣어야 한다.
    expect(parseSpeakers([validRow({ facing: '' })]).채집장노인?.facing).toBe('down')
  })

  it('적어 준 facing 을 그대로 싣는다', () => {
    // 이 값이 실제로 쓰이는 곳은 클라이언트의 첫 자세다. 여기서 조용히 기본값이
    // 되면 "노인이 입구를 보고 선다"가 데이터에 적혀 있는데도 화면에서만 안 된다.
    expect(parseSpeakers([validRow({ facing: 'left' })]).채집장노인?.facing).toBe('left')
  })

  it('알 수 없는 facing 값을 거부한다', () => {
    // kind 와 같은 이유다 — 오타는 "그 화자만 엉뚱한 쪽을 본다"로 드러나는데,
    // 방향은 눈에 잘 안 띄어서 그 상태로 한참 간다.
    expect(() => parseSpeakers([validRow({ facing: '북' })])).toThrow(
      'speakers.csv[채집장노인]: facing 은 up 또는 down 또는 left 또는 right 이어야 한다',
    )
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

    // 화자 id 목록을 여기 베껴 적지 않는다. 예전엔 그랬는데, 마을에 사람이
    // 늘 때마다 이 테스트가 깨졌다 — 그 실패는 "출하되는 데이터가 파싱되는가"에
    // 대해 아무것도 말해 주지 않으면서 목록을 한 줄 늘리라고만 시킨다.
    // 행 수와 정의 수가 같은지를 보면 조용히 사라진 행이 없다는 것까지 확인되고,
    // 실제로 확인하고 싶었던 것도 그것이다.
    expect(Object.keys(speakers)).toHaveLength(rows.length)
    for (const row of rows) {
      expect(speakers[row.id!]).toBeDefined()
    }
  })
})
