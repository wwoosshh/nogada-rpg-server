import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTransitions, validateTransitions } from './transitions.js'
import type { GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMaps } from './maps.js'
import { parseSpeakers } from './speakers.js'
import type { MapTerrain } from './placements.js'

const ROWS = [
  { fromMap: 'world', fromX: '15', fromY: '0', toMap: '숲', toX: '15', toY: '13', facing: 'up' },
]

const terrains: Record<string, MapTerrain> = {
  world: { width: 20, height: 15, walls: new Set() },
  숲: { width: 20, height: 15, walls: new Set(['15,13']) },
}

function data(transitions = parseTransitions(ROWS)): GameData {
  return {
    items: {}, nodes: {}, recipes: {}, milestones: [], speakers: {}, dialogue: [],
    maps: {
      world: { id: 'world', name: '월드', file: 'w.tmx', width: 20, height: 15 },
      숲: { id: '숲', name: '숲', file: 's.tmx', width: 20, height: 15 },
    },
    placements: {},
    transitions,
  }
}

describe('parseTransitions', () => {
  // 왜: facing 은 비워 둘 수 있다. 빈 칸을 'null' 이 아니라 오류로 읽으면
  //     작가가 매번 방향을 적어야 한다.
  it('facing 이 비면 null 이다', () => {
    const rows = [{ ...ROWS[0]!, facing: '' }]
    expect(parseTransitions(rows)[0]?.facing).toBeNull()
  })
})

describe('validateTransitions', () => {
  // 왜: 도착 칸이 벽이면 도착하자마자 낀다. 플레이하다 발견할 일이 아니다.
  it('도착 칸이 벽이면 막는다', () => {
    const violations = validateTransitions(data(), terrains)
    expect(violations.join('\n')).toMatch(/벽/)
  })

  // 왜: 오타 하나로 전환이 조용히 죽는 것을 막는다.
  it('없는 맵을 가리키면 막는다', () => {
    const rows = [{ ...ROWS[0]!, toMap: '없는맵' }]
    const violations = validateTransitions(data(parseTransitions(rows)), terrains)
    expect(violations.join('\n')).toMatch(/없는맵/)
  })

  // 왜: 한 칸에서 두 곳으로 갈 수는 없다. 무엇이 이길지 정해지지 않는다.
  it('같은 출발 칸이 둘이면 막는다', () => {
    const rows = [ROWS[0]!, { ...ROWS[0]!, toMap: 'world', toX: '1', toY: '1' }]
    const violations = validateTransitions(data(parseTransitions(rows)), terrains)
    expect(violations.join('\n')).toMatch(/같은 칸/)
  })

  // 왜: 시작 맵에서 걸어서 못 닿는 맵은 만들어도 아무도 못 본다.
  it('시작 맵에서 못 닿는 맵을 막는다', () => {
    const violations = validateTransitions(data(parseTransitions([])), terrains)
    expect(violations.join('\n')).toMatch(/닿을 수 없다/)
  })

  // 왜: 도착 칸이 벽인지만 보면 노드 위에 내려서는 것을 놓친다 — 그 칸에서는
  //     서 있을 수도 없고, 무엇을 향한 것인지도 정해지지 않는다.
  it('도착 칸에 노드가 있으면 막는다', () => {
    const d = data()
    d.transitions = parseTransitions([{ ...ROWS[0]!, toY: '12' }]) // (15,13) 벽을 피해 (15,12) 로
    d.placements = {
      'ice-1': { instanceId: 'ice-1', nodeId: 'ice_vein', mapId: '숲', x: 15, y: 12 },
    }
    expect(validateTransitions(d, terrains).join('\n')).toMatch(/도착 칸에 노드 ice-1 이 있다/)
  })

  // 왜: 출발 칸이 맵 밖이면 아무도 그 칸을 밟을 수 없어 전환이 통째로 죽는다.
  it('출발 칸이 맵 밖이면 막는다', () => {
    const rows = [{ ...ROWS[0]!, fromX: '20' }] // world 는 20 칸 폭이라 x 는 0~19 다
    const violations = validateTransitions(data(parseTransitions(rows)), terrains)
    expect(violations.join('\n')).toMatch(/출발 칸이 맵 밖이다/)
  })

  // 왜: 실제로 출하되는 전환이 스스로 이 검사를 통과하지 못하면, 위의 픽스처
  //     테스트가 전부 통과해도 게임은 빌드되지 않는다. 특히 도달 가능성은
  //     맵을 하나 더 그린 뒤 길 내는 것을 잊기 가장 쉬운 자리다.
  it('실제로 출하되는 전환은 검증을 통과한다', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const csvDir = join(here, '..', 'csv')
    const mapsDir = join(here, '..', 'maps')
    const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))
    const nodes = parseNodes(readRealCsv('nodes.csv'))
    const { maps, terrains: realTerrains, placements } = parseMaps(
      readRealCsv('maps.csv'),
      (file) => readFileSync(join(mapsDir, file), 'utf8'),
      nodes,
    )
    const real: GameData = {
      items: parseItems(readRealCsv('items.csv')),
      nodes,
      recipes: parseRecipes(readRealCsv('recipes.csv')),
      maps,
      transitions: parseTransitions(readRealCsv('transitions.csv')),
      placements,
      milestones: [],
      speakers: parseSpeakers(readRealCsv('speakers.csv')),
      dialogue: [],
    }
    expect(validateTransitions(real, realTerrains)).toEqual([])
  })
})
