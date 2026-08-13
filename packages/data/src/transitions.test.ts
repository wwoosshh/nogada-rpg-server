import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseTransitions, validateTransitions } from './transitions.js'
import type { GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMaps, START_MAP_ID } from './maps.js'
import { parseSpeakers } from './speakers.js'
import type { MapTerrain } from './placements.js'

/**
 * 픽스처의 출발 맵은 시작 맵이어야 한다. 도달 가능성 검사가 START_MAP_ID 에서
 * 출발하므로, 여기 다른 이름을 적으면 아래 검사들이 "닿을 수 없다" 로 뒤덮여
 * 정작 각자가 보려던 위반이 파묻힌다.
 */
const ROWS = [
  { fromMap: START_MAP_ID, fromX: '15', fromY: '0', toMap: '숲', toX: '15', toY: '13', facing: 'up' },
]

const terrains: Record<string, MapTerrain> = {
  [START_MAP_ID]: { width: 20, height: 15, walls: new Set() },
  숲: { width: 20, height: 15, walls: new Set(['15,13']) },
}

function data(transitions = parseTransitions(ROWS)): GameData {
  return {
    items: {}, nodes: {}, recipes: {}, milestones: [], speakers: {}, dialogue: [],
    shops: {}, masters: [], enhanceCosts: [], collection: {},
    places: {}, schedules: {}, routes: [],
    maps: {
      [START_MAP_ID]: {
        id: START_MAP_ID, name: '시작 맵', file: 'start.tmx', width: 20, height: 15, spawn: { x: 1, y: 1 },
      },
      숲: { id: '숲', name: '숲', file: 's.tmx', width: 20, height: 15, spawn: { x: 1, y: 1 } },
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
    const rows = [ROWS[0]!, { ...ROWS[0]!, toMap: START_MAP_ID, toX: '1', toY: '1' }]
    const violations = validateTransitions(data(parseTransitions(rows)), terrains)
    expect(violations.join('\n')).toMatch(/같은 칸/)
  })

  // 왜: 시작 맵에서 걸어서 못 닿는 맵은 만들어도 아무도 못 본다.
  it('시작 맵에서 못 닿는 맵을 막는다', () => {
    const violations = validateTransitions(data(parseTransitions([])), terrains)
    expect(violations.join('\n')).toMatch(/닿을 수 없다/)
  })

  // 왜: START_MAP_ID 는 코드 상수이고 maps.csv 는 데이터라, 맵 id 를 개명하면
  //     둘이 갈라진다. 예전에는 그때 **모든 맵**이 "시작 맵에서 걸어서 닿을 수
  //     없다" 라고 말했다 — 없는 맵의 이름을 대면서. 진짜 원인은 한 줄이고,
  //     나머지는 그 한 줄의 그림자다.
  it('시작 맵이 등록부에 없으면 그것만 말하고 도달 가능성으로 도배하지 않는다', () => {
    const d = data()
    delete d.maps[START_MAP_ID]
    const violations = validateTransitions(d, terrains)
    expect(violations.filter((v) => v.includes('닿을 수 없다'))).toEqual([])
    expect(violations.join('\n')).toMatch(new RegExp(`시작 맵 "${START_MAP_ID}" 가 maps\\.csv 에 없다`))
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

  // 왜: 맵 안이어도 벽이면 결과는 맵 밖과 똑같다 — 아무도 그 칸에 설 수 없어
  //     전환이 조용히 죽는다. 도착 칸만 검사하면 이런 데이터가 빌드를 통과하고,
  //     플레이어가 그 가장자리까지 걸어가 보고서야 "왜 안 넘어가지" 가 된다.
  //     이 계획이 처음 적어 둔 예시 좌표(출발 맵의 15,0)가 정확히 그런 칸이었다.
  it('출발 칸이 벽이면 막는다', () => {
    const walled: Record<string, MapTerrain> = {
      ...terrains,
      [START_MAP_ID]: { width: 20, height: 15, walls: new Set(['15,0']) },
    }
    // 도착 칸은 (15,13) 벽을 피해 (15,12) 로 옮긴다 — 도착 위반이 섞이면
    // 이 테스트가 출발 검사 없이도 통과해 버린다.
    const rows = [{ ...ROWS[0]!, toY: '12' }]
    const violations = validateTransitions(data(parseTransitions(rows)), walled)
    expect(violations.join('\n')).toMatch(/출발 칸 \(15, 0\) 이 벽이다/)
  })

  // 왜: 출발 칸이 맵 밖이면 아무도 그 칸을 밟을 수 없어 전환이 통째로 죽는다.
  it('출발 칸이 맵 밖이면 막는다', () => {
    const rows = [{ ...ROWS[0]!, fromX: '20' }] // 픽스처의 출발 맵은 20 칸 폭이라 x 는 0~19 다
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
    const { maps, terrains: realTerrains, placements, places } = parseMaps(
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
      // 실제 맵의 지점을 그대로 싣는다 — 일과가 들어오면 이 검사도 함께 자란다.
      places,
      schedules: {},
      shops: {}, masters: [], enhanceCosts: [], collection: {},
      routes: [],
      dialogue: [],
    }
    expect(validateTransitions(real, realTerrains)).toEqual([])
  })
})
