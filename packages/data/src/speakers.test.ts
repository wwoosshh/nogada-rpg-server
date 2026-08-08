import { describe, expect, it } from 'vitest'
import { parseSpeakers } from './speakers.js'

function validRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    id: '채집장노인', name: '채집장 노인', kind: 'npc', mapId: 'world', x: '16', y: '12', sprite: 'npc_elder',
    ...overrides,
  }
}

describe('parseSpeakers', () => {
  it('행 하나를 SpeakerDef 로 만든다', () => {
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
    const speakers = parseSpeakers([validRow({ id: '얼음안내판', name: '안내판', kind: 'sign', x: '14', y: '18', sprite: 'sign_wood' })])
    expect(speakers.얼음안내판?.kind).toBe('sign')
  })

  it('알 수 없는 kind 값을 거부한다', () => {
    expect(() => parseSpeakers([validRow({ kind: 'monster' })])).toThrow(
      'speakers.csv[채집장노인]: kind 는 npc 또는 sign 이어야 한다',
    )
  })

  it('필수 칸이 비어 있으면 거부한다', () => {
    expect(() => parseSpeakers([validRow({ name: '' })])).toThrow(/name/)
  })

  it('중복된 id 를 거부한다', () => {
    expect(() => parseSpeakers([validRow(), validRow()])).toThrow('speakers.csv: 중복된 id "채집장노인"')
  })

  it('실제로 출하되는 CSV 데이터를 오류 없이 파싱한다', () => {
    // build.ts 가 읽는 실제 csv/speakers.csv — 브리프가 요구한 두 화자가 있다.
    const rows = [
      { id: '채집장노인', name: '채집장 노인', kind: 'npc', mapId: 'world', x: '16', y: '12', sprite: 'npc_elder' },
      { id: '얼음안내판', name: '안내판', kind: 'sign', mapId: 'world', x: '14', y: '18', sprite: 'sign_wood' },
    ]
    const speakers = parseSpeakers(rows)
    expect(Object.keys(speakers).sort()).toEqual(['얼음안내판', '채집장노인'])
  })
})
