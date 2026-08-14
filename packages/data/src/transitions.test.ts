import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bakeBarrierRegions, parseTransitions, validateTransitions } from './transitions.js'
import type { BarrierRegions, GameData } from '@nogada/shared'
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
    const { real, realTerrains } = shipped()
    expect(validateTransitions(real, realTerrains)).toEqual([])
  })
})

/**
 * **문과 문 뒤의 것이 서로를 아는가.**
 *
 * 이 검사가 없던 동안 두 렌즈가 독립으로 수렴했다 — 문은 `transitions.csv` 에서,
 * 심층 노드는 `.tmx` 오브젝트에서 각자 서고 그 둘이 서로에 대해 아무것도 주장하지
 * 않았다. 아래 셋은 전부 리뷰가 실제로 돌려 본 재현이고, 그때 빌드는 전부 초록이었다.
 */
describe('validateTransitions — 결계와 그 안의 배치', () => {
  const { real, realTerrains } = shipped()

  /** 출하 데이터에서 배치 하나를 더하거나 전환을 손본 사본. 원본은 건드리지 않는다. */
  function variant(overrides: Partial<GameData>): GameData {
    return { ...real, ...overrides }
  }

  // 왜: §9-앞 4 가 **치명**이라 부른 상태(개발맵 뒷문)가 `.tmx` 오브젝트 하나로
  //     그대로 돌아온다. 심층 표는 "문 너머에서만 굴려진다"를 전제로 지은 표라,
  //     밖에 하나만 놓여도 숙련 0 인 사람이 입구에서 그 분포를 굴린다.
  it('심층 배치가 결계 밖에 하나라도 있으면 막는다', () => {
    const leaked = variant({
      placements: {
        ...real.placements,
        'deep_ice_vein-99': {
          instanceId: 'deep_ice_vein-99', nodeId: 'deep_ice_vein', mapId: '얼음채집장', x: 10, y: 20,
        },
      },
    })
    expect(validateTransitions(leaked, realTerrains)).toEqual([
      'placements[deep_ice_vein-99]: 심층 노드 "deep_ice_vein"(variant=deep) 가 결계 밖 얼음채집장 (10, 20) 에 놓였다 — 그 표(ice_deep)는 문 너머에서만 굴려지기로 하고 지은 표라(설계 §9-앞 3·4), 밖에 하나만 놓이면 숙련 0 인 사람이 입구에서 그 분포를 굴린다. 그 맵의 .tmx 에서 이 오브젝트를 결계 안쪽 칸으로 옮기거나, nodeId 를 같은 계열 normal 노드로 바꾼다',
    ])
  })

  // 왜: `transitions.csv` 의 `ice` 를 `wood` 로 한 글자 오타 내도 빌드가 전부
  //     초록이었다. 문은 문대로 열리고 노드는 노드대로 캐지므로 **어느 화면에서도
  //     되짚을 수 없다** — validate.ts 의 "문턱은 X 계열인데 산출물은 Y 계열" 과
  //     같은 부류, 같은 처방이다.
  it('결계의 gateSkill 이 그 안 노드의 계열과 다르면 막는다', () => {
    const typo = variant({
      transitions: real.transitions.map((t) => (t.gateSkill === 'ice' ? { ...t, gateSkill: 'wood' as const } : t)),
    })
    expect(validateTransitions(typo, realTerrains)).toEqual([
      'transitions[얼음채집장 (5, 4)]: 문턱은 wood 85000 인데 이 문 뒤의 노드 [deep_ice_vein-2(ice), deep_ice_vein-3(ice), deep_ice_vein-4(ice), deep_ice_vein-5(ice)] 는 다른 계열이다 — 문을 여는 숙련과 문 뒤에서 캐는 숙련이 갈라지면 네 NPC 가 말한 "그 숙련이면 그 결계 너머도 가 볼 만하지" 가 거짓이 되는데, 그 어긋남은 어느 화면에서도 되짚을 수 없다(문은 문대로 열리고 노드는 노드대로 캐진다). transitions.csv 의 gateSkill 이나 얼음채집장.tmx 의 그 노드 배치 중 하나를 고친다',
    ])
  })

  // 왜: 물때만 지는 문은 결계 구역을 만들지만(isGated 가 그렇게 센다) 숙련은 안
  //     묻는다 — 기다리면 누구에게나 열리므로 그 뒤의 심층은 숙련 0 짜리 손에
  //     열린다. 허브 결계에서 gateSkill 두 칸만 비우면 그 상태가 된다.
  it('심층이 있는 구역으로 들어오는 문에 숙련 문턱이 하나도 없으면 막는다', () => {
    const tideOnly = variant({
      transitions: real.transitions.map((t) =>
        t.gateSkill === 'herb' ? { ...t, gateSkill: undefined, gateValue: undefined } : t,
      ),
    })
    expect(validateTransitions(tideOnly, realTerrains)).toEqual([
      'maps[허브채집장] (27, 13) 구역: 심층 노드 [rare_herb_patch-2, rare_herb_patch-3, rare_herb_patch-4, rare_herb_patch-5] 가 있는데 이 구역으로 들어오는 문에 숙련 문턱(gateSkill)이 하나도 없다 — 물때만 지는 문은 기다리면 누구에게나 열리므로, 숙련 0 인 사람이 물이 빠지는 창마다 결계 뒤의 분포를 굴린다. transitions.csv 의 그 문에 gateSkill·gateValue 를 적는다',
    ])
  })

  // ---- 특수 배치의 거울(노드 종류 §6-7) ----
  //
  // 심층은 "결계 안에 있어야 한다"이고 특수는 정확히 반대다. 특수 재료는 **유일
  // 출처**라 결계 안에 들어가면 그 아이템이 통째로 153.8분짜리 문 뒤로 사라진다 —
  // 심층은 밖에 같은 계열 normal 이 여덟 개 그대로 있어서 저숙련이 잃는 것이
  // 없지만, 특수는 대신 캘 자리가 세상에 없다.

  /** 얼음 특수 노드 하나를 세운 사본 — 배치 자리는 인자로 받는다. */
  function withSpecialAt(mapId: string, x: number, y: number): GameData {
    return variant({
      nodes: {
        ...real.nodes,
        red_ice_vein: {
          id: 'red_ice_vein', name: '붉은 얼음 광맥', skill: 'ice',
          tableId: 'ice_special', variant: 'special', sprite: 'red_ice_vein',
        },
      },
      placements: {
        ...real.placements,
        'red_ice_vein-1': { instanceId: 'red_ice_vein-1', nodeId: 'red_ice_vein', mapId, x, y },
      },
    })
  }

  it('특수 배치가 결계 **안**에 있으면 막는다 — 유일 출처가 문 뒤로 사라진다', () => {
    // (2, 1) 은 얼음 결계 안이다 — 심층 넷이 거기 산다.
    const trapped = withSpecialAt('얼음채집장', 2, 1)
    expect(validateTransitions(trapped, realTerrains).join('\n')).toMatch(/red_ice_vein-1[\s\S]*결계 안/)
  })

  it('특수 배치가 결계 밖이면 아무 말도 안 한다 — 거기가 그 노드의 자리다', () => {
    expect(validateTransitions(withSpecialAt('얼음채집장', 10, 20), realTerrains)).toEqual([])
  })

  // 왜: 개발맵은 눈의마을 서문에서 숙련 0 으로 걸어 들어간다. 결계 아크가 그
  //     함정을 한 번 밟고 고쳤고(개발맵 배치 13개가 전부 normal 인 이유),
  //     특수는 유일 출처라 그 문이 더 넓다 — 게임 전체의 그 재료를 숙련 0 에
  //     내주는 것과 같다.
  it('특수 배치가 개발맵에 있으면 막는다 — 숙련 0 으로 걸어 들어가는 문이다', () => {
    expect(validateTransitions(withSpecialAt('개발맵', 15, 15), realTerrains).join('\n')).toMatch(
      /red_ice_vein-1[\s\S]*개발맵/,
    )
  })

  // 왜: 둘이면 "제일 가까운 것"이 다시 답이 되고, 아크가 고치러 온 문제
  //     (한 채집장의 normal 여덟이 서로 죽인다)가 특수 노드에서 그대로 복사된다.
  it('한 맵에 특수 배치가 둘이면 막는다 — 채집장당 정확히 하나다', () => {
    const twice = withSpecialAt('얼음채집장', 10, 20)
    const doubled = variant({
      nodes: twice.nodes,
      placements: {
        ...twice.placements,
        'red_ice_vein-2': { instanceId: 'red_ice_vein-2', nodeId: 'red_ice_vein', mapId: '얼음채집장', x: 12, y: 20 },
      },
    })
    expect(validateTransitions(doubled, realTerrains).join('\n')).toMatch(/얼음채집장[\s\S]*2개/)
  })

  // 왜: 반대는 **묻지 않는다.** 결계의 약속은 "심층은 문 뒤에만 있다"이지 "문
  //     뒤에는 심층만 있다"가 아니다 — 결계 안의 normal 노드는 아무에게도 손해가
  //     아니다(같은 노드가 밖에 8개 그대로 있으므로 저숙련이 잃는 것이 없다,
  //     설계 §2). 금지하면 "안쪽에도 평범한 나무가 몇 그루 선 숲" 같은 정당한
  //     맵을 데이터로 표현할 수 없게 된다. 해악이 비대칭이라 검사도 비대칭이다.
  it('결계 안의 normal 노드는 막지 않는다 — 같은 계열이면 문턱과도 어긋나지 않는다', () => {
    const inside = variant({
      placements: {
        ...real.placements,
        'ice_vein-99': { instanceId: 'ice_vein-99', nodeId: 'ice_vein', mapId: '얼음채집장', x: 5, y: 1 },
      },
    })
    expect(validateTransitions(inside, realTerrains)).toEqual([])
  })
})

/**
 * 출하되는 CSV·맵을 그대로 읽어 온다 — 픽스처가 아니라 **진짜 데이터**다.
 *
 * 두 스위트가 쓴다: 전환 검증이 스스로 통과하는지와, 결계 구역 굽기가 실제
 * 네 채집장에서 무엇을 내놓는지. 각자 읽으면 한쪽만 고쳐져 갈라진다.
 */
function shipped(): { real: GameData; realTerrains: Record<string, MapTerrain> } {
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
  return { real, realTerrains }
}

/**
 * 결계 구역 굽기 — 서버가 "지금 그 안에 있는가"에 답할 재료를 만드는 곳이다.
 *
 * 갇힘 방지 검사와 **같은 두 계산의 앞뒤 짝**이라 같은 픽스처 위에 선다: 저쪽은
 * 게이트 없는 문으로 거꾸로 넓혀 "나올 수 있는가"를 묻고, 이쪽은 앞으로 넓혀
 * "들어오는 데 게이트가 필요했는가"를 묻는다.
 */
describe('bakeBarrierRegions', () => {
  /** 그 칸이 구운 목록 안에 있는가 — 서버의 판정(barrierSeparates)과 같은 물음이다. */
  function baked(regions: BarrierRegions, mapId: string, x: number, y: number): boolean {
    return regions.some((r) => r.mapId === mapId && r.cells.includes(`${x},${y}`))
  }

  // 왜: 이것이 이 함수의 정의다. 벽 너머(y 0~2)는 게이트 걸린 문 하나로만
  //     닿으므로 결계 뒤이고, 문 앞쪽은 시작 맵에서 게이트 없이 걸어오므로 아니다.
  it('게이트 걸린 문으로만 닿는 덩어리만 굽는다', () => {
    const regions = bakeBarrierRegions(barrier(), barrierTerrains)
    expect(regions).toHaveLength(1)
    expect(regions[0]!.mapId).toBe('채집장')
    // 벽(y=3) 위쪽 30 칸 전부다 — 도착 칸 하나가 아니라 덩어리 전체여야, 안에서
    // 걸어 다닌 사람의 저장 위치가 어느 칸이든 "안에 있다"로 읽힌다.
    expect(regions[0]!.cells).toHaveLength(30)
    expect(baked(regions, '채집장', 5, 2)).toBe(true) // 결계 문의 도착 칸
    expect(baked(regions, '채집장', 0, 0)).toBe(true) // 안쪽 구석
    expect(baked(regions, '채집장', 5, 4)).toBe(false) // 문 앞(바깥)
    expect(baked(regions, '채집장', 5, 9)).toBe(false) // 채집장 입구(바깥)
    expect(baked(regions, START_MAP_ID, 15, 0)).toBe(false)
  })

  // 왜: 결계는 게이트가 만든다. 문턱을 지우면 그 덩어리는 누구나 걸어 들어가는
  //     평범한 안쪽이 되고, 서버가 지킬 것도 사라져야 한다 — 여기 남아 있으면
  //     게이트 없는 문 뒤가 이유 없이 잠긴다.
  it('게이트를 지운 문 뒤는 결계가 아니다', () => {
    const 문턱없는결계 = barrier({ 들어가는문: { gateSkill: '', gateValue: '' } })
    expect(bakeBarrierRegions(문턱없는결계, barrierTerrains)).toEqual([])
  })

  // 왜: 물때만 지는 문도 못 지나가는 문이다(isGated 가 같은 자리에서 말한다).
  //     숙련만 보면 허브 결계 같은 문 뒤가 통째로 빠져나간다.
  it('물때만 걸린 문 뒤도 결계다', () => {
    const 물때문 = barrier({ 들어가는문: { gateSkill: '', gateValue: '', gateTide: '1' } })
    expect(bakeBarrierRegions(물때문, barrierTerrains)).toHaveLength(1)
  })

  // 왜: 픽스처가 통과해도 출하 데이터에서 빗나가면 서버는 아무것도 못 지킨다.
  //     심층 배치 열여섯이 전부 구운 구역 안에 있고, 바깥 노드는 하나도 없어야
  //     한다 — 앞의 하나라도 빠지면 구멍이 남고, 뒤의 하나라도 들어가면 멀쩡히
  //     캐던 노드가 잠긴다.
  it('출하 데이터에서는 심층 배치만 결계 뒤에 있다', () => {
    const { real, realTerrains } = shipped()
    const regions = bakeBarrierRegions(real, realTerrains)

    const inside = Object.values(real.placements).filter((p) => baked(regions, p.mapId, p.x, p.y))
    const deep = Object.values(real.placements).filter((p) => real.nodes[p.nodeId]?.variant === 'deep')

    expect(deep.length).toBeGreaterThan(0) // 심층이 하나도 없으면 아래 단정이 공허하다
    expect(inside.map((p) => p.instanceId).sort()).toEqual(deep.map((p) => p.instanceId).sort())
  })

  // 왜: 결계를 넘은 사람의 저장된 위치는 그 문의 도착 칸이다(moveThroughTransition).
  //     그 칸이 구운 구역 안에 없으면 정당하게 들어간 사람이 벽 안에서 아무것도
  //     못 캔다 — 구멍을 막으려다 정반대의 벽을 세우는 실패다.
  it('출하된 결계 문의 도착 칸은 전부 구운 구역 안이다', () => {
    const { real, realTerrains } = shipped()
    const regions = bakeBarrierRegions(real, realTerrains)
    const gates = real.transitions.filter((t) => t.gateSkill !== undefined || t.gateTide === true)

    expect(gates.length).toBeGreaterThan(0)
    for (const t of gates) {
      expect(baked(regions, t.toMap, t.toX, t.toY)).toBe(true)
      // 그리고 출발 칸(문 앞)은 바깥이어야 한다 — 안팎이 뒤집히면 아무도 못 캔다.
      expect(baked(regions, t.fromMap, t.fromX, t.fromY)).toBe(false)
    }
  })
})
