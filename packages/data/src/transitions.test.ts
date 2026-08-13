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

/**
 * 결계 픽스처 — 벽 하나로 안쪽을 만든 채집장.
 *
 * `채집장` 은 10×10 이고 y=3 한 줄이 통째로 벽이라, 위쪽(y 0~2)으로 가는 길은
 * 결계 전환 하나뿐이다. 실제 네 채집장이 B3 에서 이 모양으로 수술됐다 —
 * 전환의 `fromMap === toMap` 이고, 밟으면 벽 너머로 선다.
 */
const BARRIER_WALL = Array.from({ length: 10 }, (_, x) => `${x},3`)

const barrierTerrains: Record<string, MapTerrain> = {
  [START_MAP_ID]: { width: 20, height: 15, walls: new Set() },
  채집장: { width: 10, height: 10, walls: new Set(BARRIER_WALL) },
}

/** 결계 픽스처의 네 줄. 키는 아래 `barrier()` 가 덮어쓸 때 쓰는 이름이다. */
const BARRIER_ROWS = {
  들어가는입구: { fromMap: START_MAP_ID, fromX: '15', fromY: '0', toMap: '채집장', toX: '5', toY: '8', facing: 'up' },
  나가는입구: { fromMap: '채집장', fromX: '5', fromY: '9', toMap: START_MAP_ID, toX: '15', toY: '1', facing: 'down' },
  // 들어가는 문에만 문턱이 있다. 나오는 문은 비운다 — 그것이 이 검사가 지키는 규범이다.
  들어가는문: {
    fromMap: '채집장', fromX: '5', fromY: '4', toMap: '채집장', toX: '5', toY: '2', facing: 'up',
    gateSkill: 'ice', gateValue: '85000',
  },
  나오는문: { fromMap: '채집장', fromX: '5', fromY: '2', toMap: '채집장', toX: '5', toY: '4', facing: 'down' },
}

function barrier(overrides: Partial<Record<keyof typeof BARRIER_ROWS, Record<string, string>>> = {}): GameData {
  const rows = Object.entries(BARRIER_ROWS).map(([name, row]) => ({
    ...row,
    ...overrides[name as keyof typeof BARRIER_ROWS],
  }))
  return {
    ...data(parseTransitions(rows)),
    maps: {
      [START_MAP_ID]: {
        id: START_MAP_ID, name: '시작 맵', file: 'start.tmx', width: 20, height: 15, spawn: { x: 1, y: 1 },
      },
      채집장: { id: '채집장', name: '채집장', file: 'f.tmx', width: 10, height: 10, spawn: { x: 5, y: 9 } },
    },
  }
}

describe('parseTransitions', () => {
  // 왜: facing 은 비워 둘 수 있다. 빈 칸을 'null' 이 아니라 오류로 읽으면
  //     작가가 매번 방향을 적어야 한다.
  it('facing 이 비면 null 이다', () => {
    const rows = [{ ...ROWS[0]!, facing: '' }]
    expect(parseTransitions(rows)[0]?.facing).toBeNull()
  })

  // 왜: 게이트는 선택 칸이다. 출하된 전환 열여덟 줄이 게이트 없이 살아 있고,
  //     빈 칸을 "숙련 0 을 요구하는 문"으로 읽으면 화면이 마을 입구에서도
  //     결계 문구를 조립할 수 있게 된다.
  it('게이트 칸이 비면 문턱이 없다', () => {
    const t = parseTransitions([ROWS[0]!])[0]!
    expect(t.gateSkill).toBeUndefined()
    expect(t.gateValue).toBeUndefined()
  })

  it('둘 다 적으면 문턱이 실린다', () => {
    const rows = [{ ...ROWS[0]!, gateSkill: 'ice', gateValue: '85000' }]
    const t = parseTransitions(rows)[0]!
    expect(t.gateSkill).toBe('ice')
    expect(t.gateValue).toBe(85000)
  })

  // 왜: 한쪽만 적힌 행을 통과시키면 작가는 결계를 세웠다고 믿는데 게임에는
  //     아무나 지나는 문이 선다 — 그 어긋남은 화면 어디에도 흔적을 남기지
  //     않는다. recipes.csv 의 gateSkill/gateValue 와 같은 규칙, 같은 문구다.
  it('gateSkill 만 적으면 거절한다', () => {
    const rows = [{ ...ROWS[0]!, gateSkill: 'ice', gateValue: '' }]
    expect(() => parseTransitions(rows)).toThrow(/함께 적거나 함께 비워야 한다/)
  })

  it('gateValue 만 적어도 거절한다', () => {
    const rows = [{ ...ROWS[0]!, gateSkill: '', gateValue: '85000' }]
    expect(() => parseTransitions(rows)).toThrow(/함께 적거나 함께 비워야 한다/)
  })

  // 왜: 오타는 아무도 못 여는 문(없는 계열)이나 늘 열린 문이 된다. 어느 쪽이든
  //     빌드가 말해 주지 않으면 플레이해 보고서야 안다.
  it('없는 계열을 적으면 거절한다', () => {
    const rows = [{ ...ROWS[0]!, gateSkill: 'mining', gateValue: '85000' }]
    expect(() => parseTransitions(rows)).toThrow(/gateSkill/)
  })

  // 왜: 물때는 허브 결계 하나만 진다. 빈 칸을 "물때를 진다"로 읽으면 열여덟
  //     줄 전부가 새벽마다 조용히 닫힌다.
  it('gateTide 가 비면 물때를 안 진다', () => {
    expect(parseTransitions([ROWS[0]!])[0]?.gateTide).toBeUndefined()
  })

  it('gateTide 에 1 을 적으면 물때를 진다', () => {
    const rows = [{ ...ROWS[0]!, gateSkill: 'herb', gateValue: '85000', gateTide: '1' }]
    expect(parseTransitions(rows)[0]?.gateTide).toBe(true)
  })

  // 왜: `true`·`y`·`O` 를 적은 작가는 물때를 걸었다고 믿는데, 조용히 false 로
  //     접으면 그 문은 하루 종일 열려 있고 어느 화면에도 흔적이 안 남는다 —
  //     `gather_tables.csv` 의 equity 칸과 같은 자리, 같은 처방이다.
  it('gateTide 에 1 이 아닌 값을 적으면 거절한다', () => {
    const rows = [{ ...ROWS[0]!, gateTide: 'true' }]
    expect(() => parseTransitions(rows)).toThrow(/gateTide/)
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

  // 왜: 게이트가 걸린 문은 지금까지의 검사가 하나도 보지 않는다. 도달 가능성
  //     검사는 전환을 전부 문으로 세므로, 결계 안쪽도 "닿을 수 있다"고 말한다.
  it('게이트 없는 문만 남기면 결계 안쪽은 여전히 나올 수 있다', () => {
    expect(validateTransitions(barrier(), barrierTerrains)).toEqual([])
  })

  // 왜: 이것이 이 검사의 존재 이유다(§9-앞 16). resolvePlayerLocation 은 맵
  //     존재와 좌표 범위만 보므로 결계 안에 갇힌 세이브를 구제하지 못한다 —
  //     나오는 문에 게이트가 걸리는 순간 그 안의 사람은 영구히 갇힌다.
  it('나오는 문에 게이트를 걸면 막는다', () => {
    const d = barrier({ 나오는문: { gateSkill: 'ice', gateValue: '85000' } })
    const message = validateTransitions(d, barrierTerrains).join('\n')
    expect(message).toMatch(/갇힌다/)
    expect(message).toMatch(/채집장 \(5, 2\)→\(5, 4\)/)
  })

  // 왜: 물때 게이트는 갇힘이 더 나쁘다 — 숙련은 캐면 오르지만 시각은 플레이어가
  //     올릴 수 있는 숫자가 아니라, 나오는 문에 걸리면 몇 시간짜리 감옥이 된다.
  //     갇힘 검사가 gateSkill 만 보면 이 줄이 조용히 통과한다(§9-앞 17).
  it('나오는 문에 물때를 걸어도 막는다', () => {
    const d = barrier({ 나오는문: { gateTide: '1' } })
    const message = validateTransitions(d, barrierTerrains).join('\n')
    expect(message).toMatch(/갇힌다/)
    expect(message).toMatch(/채집장 \(5, 2\)→\(5, 4\)/)
  })

  // 왜: 문턱을 나중에 올리는 날(85,000 → 200,000)을 위한 검사다. 그 사이 숙련의
  //     플레이어가 안에 서 있는데 나오는 문이 사라져 있으면 세이브가 죽는다.
  it('나오는 문이 아예 없으면 막는다', () => {
    const d = barrier()
    d.transitions = d.transitions.filter((t) => !(t.fromX === 5 && t.fromY === 2))
    expect(validateTransitions(d, barrierTerrains).join('\n')).toMatch(/나가는 문: 없다/)
  })

  // 왜: 플레이어가 애초에 닿을 수 없는 구역(문 없는 골방)까지 갇힘으로 세면,
  //     장식으로 막아 둔 자리를 그릴 때마다 빌드가 선다. 이 검사가 묻는 것은
  //     "갈 수 있는데 못 나오는 자리가 있는가" 다.
  it('아무 문도 없는 골방은 갇힘으로 세지 않는다', () => {
    const closet: Record<string, MapTerrain> = {
      ...barrierTerrains,
      // (0,0) 을 (1,0)·(0,1) 벽으로 막아 아무 데서도 닿지 않는 한 칸을 만든다.
      채집장: { width: 10, height: 10, walls: new Set([...BARRIER_WALL, '1,0', '0,1']) },
    }
    expect(validateTransitions(barrier(), closet)).toEqual([])
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
