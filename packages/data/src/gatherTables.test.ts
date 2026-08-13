import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData, GatherTables, ItemDef, NodeDef } from '@nogada/shared'
import { gatherBracketFor } from '@nogada/shared'
import { testItem } from '@nogada/shared/testing'
import { parseCsv } from './parse.js'
import { goldPerMinute, measureHand } from './gatherMeasure.js'
import {
  DEEP_MEASURE_PROFICIENCY,
  DEEP_TOP_TIER_CEILING,
  DEEP_YIELD_TARGET,
  DEEP_YIELD_TOLERANCE,
  isDeepTableId,
  parseGatherTables,
  validateGatherTables,
} from './gatherTables.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * 심층 ÷ 바깥 분당 산출 — **재는 자리는 문 바로 위(85,001)·구리 손 하나**다.
 *
 * 검증(gatherTables.ts)과 같은 자(gatherMeasure.ts)를 부른다. 여기서 확률을
 * 다시 세면 증명이 판정과 다른 식을 보게 된다(§6-앞 14 의 교훈).
 */
function deepOuterRatio(tables: GatherTables, data: GameData, deepId: string, outerId: string): number {
  const deep = tables[deepId]!
  const outer = tables[outerId]!
  const hand = measureHand(deep.skill, data.items, 1, false, 0)!
  const at = DEEP_MEASURE_PROFICIENCY
  return (
    goldPerMinute(deep, gatherBracketFor(deep, at), at, hand, data.items) /
    goldPerMinute(outer, gatherBracketFor(outer, at), at, hand, data.items)
  )
}

// ---- 픽스처 ----
//
// 세 CSV(메타·사다리·브라켓)의 행을 최소로 짓는다. 기본값은 "2티어·2브라켓의
// 정상 표" 하나 — 각 테스트는 망가뜨리고 싶은 칸 하나만 덮어쓴다.

type Row = Record<string, string>

function metaRow(overrides: Row = {}): Row {
  return { tableId: 'ice', skill: 'ice', skillGainMin: '1', skillGainMax: '2', ...overrides }
}

function tierRows(tableId = 'ice'): Row[] {
  return [
    { tableId, tier: '1', itemId: 'ice_gem' },
    { tableId, tier: '2', itemId: 'ice_shard' },
  ]
}

function bracketRow(overrides: Row = {}): Row {
  return {
    tableId: 'ice', bracketMax: '500', cum1: '3', cum2: '60000',
    cum3: '', cum4: '', cum5: '', cum6: '', cum7: '',
    ...overrides,
  }
}

/** 정상 표 하나(ice, 2티어, 브라켓 ≤500 + ∞)를 파싱해 돌려준다. */
function parsedIce(): GatherTables {
  return parseGatherTables(
    [metaRow()],
    tierRows(),
    [bracketRow(), bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' })],
  )
}

function node(id: string, skill: NodeDef['skill'], tableId: string): NodeDef {
  return { id, name: id, skill, tableId, variant: 'normal' }
}

/** validateGatherTables 가 보는 것은 items·nodes 뿐이다 — 나머지는 빈 채로 채운다. */
function gameDataWith(items: ItemDef[], nodes: NodeDef[]): GameData {
  return {
    items: Object.fromEntries(items.map((i) => [i.id, i])),
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    recipes: {}, maps: {}, transitions: [], placements: {}, milestones: [],
    shops: {}, masters: [], enhanceCosts: [], collection: {},
    speakers: {}, places: {}, schedules: {}, routes: [], dialogue: [],
  }
}

/** parsedIce() 의 표를 온전히 받치는 최소 세계 — 위반 0건의 기준선이다. */
function healthyData(): GameData {
  return gameDataWith([testItem('ice_gem'), testItem('ice_shard')], [node('ice_vein', 'ice', 'ice')])
}

describe('parseGatherTables — 구조', () => {
  it('메타·사다리·브라켓 세 CSV 를 표 하나로 조립한다', () => {
    const tables = parsedIce()
    expect(tables.ice).toEqual({
      id: 'ice', skill: 'ice', skillGainMin: 1, skillGainMax: 2, equity: false,
      tiers: [{ itemId: 'ice_gem' }, { itemId: 'ice_shard' }],
      brackets: [
        { bracketMax: 500, cumulative: [3, 60000] },
        { bracketMax: null, cumulative: [15000, 100000] },
      ],
    })
  })

  it('equity 칸의 "1" 은 그 표가 계열을 대표해 재인다는 표시다 — 빈 칸은 아니다(결계 §9-앞 1·2)', () => {
    expect(parsedIce().ice!.equity).toBe(false)
    expect(parseGatherTables([metaRow({ equity: '1' })], tierRows(), [bracketRow()]).ice!.equity).toBe(true)
  })

  it('equity 에 "1" 도 빈 칸도 아닌 값이 오면 거부한다 — 조용히 false 가 되면 그 계열의 형평 검증이 소리 없이 사라진다', () => {
    expect(() => parseGatherTables([metaRow({ equity: 'true' })], tierRows(), [bracketRow()])).toThrow(
      'gather_tables.csv[ice]: equity "true" 는 알 수 없다 — 계열의 대표 표 한 줄에만 "1" 을 적고 나머지는 비운다',
    )
  })

  it('중복된 tableId 를 거부한다', () => {
    expect(() => parseGatherTables([metaRow(), metaRow()], tierRows(), [bracketRow()])).toThrow(
      'gather_tables.csv: 중복된 id "ice"',
    )
  })

  it('알 수 없는 skill 을 거부한다', () => {
    expect(() => parseGatherTables([metaRow({ skill: 'ise' })], tierRows(), [bracketRow()])).toThrow(
      /skill "ise" 는 알 수 없다/,
    )
  })

  it('메타에 없는 표를 가리키는 사다리 행을 거부한다', () => {
    expect(() =>
      parseGatherTables([metaRow()], [{ tableId: 'ise', tier: '1', itemId: 'ice_gem' }], [bracketRow()]),
    ).toThrow('gather_tiers.csv[ise]: 존재하지 않는 표를 가리킨다 — gather_tables.csv 에 먼저 적는다')
  })

  it('메타에 없는 표를 가리키는 브라켓 행을 거부한다', () => {
    expect(() => parseGatherTables([metaRow()], tierRows(), [bracketRow({ tableId: 'ise' })])).toThrow(
      'gather_brackets.csv[ise]: 존재하지 않는 표를 가리킨다 — gather_tables.csv 에 먼저 적는다',
    )
  })

  it('tier 번호가 1부터 빈틈없이 오르지 않으면 거부한다', () => {
    const gapped = [
      { tableId: 'ice', tier: '1', itemId: 'ice_gem' },
      { tableId: 'ice', tier: '3', itemId: 'ice_shard' },
    ]
    // 번호가 뛰면 "그 사이 티어가 있는데 빠뜨렸나" 를 알 수 없다 — cum 칸과의
    // 자리 짝이 조용히 어긋나는 대신 여기서 세운다.
    expect(() => parseGatherTables([metaRow()], gapped, [bracketRow()])).toThrow(
      'gather_tiers.csv[ice]: tier 2 자리에 3 이 왔다 — 1부터 빈틈없이 오름차순이어야 한다',
    )
  })

  it('한 표에 같은 아이템이 두 번 오면 거부한다', () => {
    const doubled = [
      { tableId: 'ice', tier: '1', itemId: 'ice_gem' },
      { tableId: 'ice', tier: '2', itemId: 'ice_gem' },
    ]
    expect(() => parseGatherTables([metaRow()], doubled, [bracketRow()])).toThrow(
      'gather_tiers.csv[ice]: 아이템 "ice_gem" 이 한 표에 두 번 있다',
    )
  })

  it('cum 칸의 중간이 비어 있으면 거부한다 — 빈 칸은 오른쪽 끝에만 온다', () => {
    expect(() =>
      parseGatherTables([metaRow()], tierRows(), [bracketRow({ cum1: '3', cum2: '', cum3: '60000' })]),
    ).toThrow('gather_brackets.csv[ice]: cum2 가 비어 있는데 cum3 가 차 있다 — 빈 칸은 오른쪽 끝에만 온다')
  })

  it('티어가 한 줄도 없는 표를 거부한다', () => {
    expect(() => parseGatherTables([metaRow()], [], [bracketRow()])).toThrow(
      'gather_tables.csv[ice]: 티어가 한 줄도 없다 — gather_tiers.csv 에 사다리를 적는다',
    )
  })

  it('브라켓이 한 줄도 없는 표를 거부한다', () => {
    expect(() => parseGatherTables([metaRow()], tierRows(), [])).toThrow(
      'gather_tables.csv[ice]: 브라켓이 한 줄도 없다 — gather_brackets.csv 에 적는다',
    )
  })
})

describe('validateGatherTables — 위반', () => {
  it('정상 표는 위반도 경고도 없다', () => {
    const { violations, warnings } = validateGatherTables(parsedIce(), healthyData())
    expect(violations).toEqual([])
    expect(warnings).toEqual([])
  })

  it('skillGainMin 이 skillGainMax 보다 크면 잡아낸다', () => {
    const tables = parseGatherTables(
      [metaRow({ skillGainMin: '3', skillGainMax: '2' })],
      tierRows(),
      [bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' })],
    )
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice]: skillGainMin(3) 이 skillGainMax(2) 보다 크다',
    )
  })

  it('∞ 브라켓(bracketMax 빈 칸)이 없으면 잡아낸다 — 고숙련이 판정 불능이 된다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [bracketRow()])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice]: bracketMax 가 빈 칸(∞)인 브라켓이 없다 — 마지막 행의 bracketMax 를 비워야 상한 밖 숙련도 판정을 받는다',
    )
  })

  it('∞ 브라켓이 두 개면 잡아낸다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ bracketMax: '', cum1: '3', cum2: '60000' }),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' }),
    ])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice]: bracketMax 가 빈 칸(∞)인 브라켓이 2개다 — 정확히 하나, 마지막 행이어야 한다',
    )
  })

  it('∞ 브라켓이 중간에 오면 잡아낸다 — 그 뒤의 브라켓은 영원히 선택되지 않는다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ bracketMax: '', cum1: '3', cum2: '60000' }),
      bracketRow({ bracketMax: '500', cum1: '15000', cum2: '100000' }),
    ])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice]: ∞ 브라켓이 마지막이 아니다 — 그 뒤의 브라켓은 영원히 선택되지 않는다',
    )
  })

  it('브라켓 상한이 오름차순이 아니면 잡아낸다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ bracketMax: '5000' }),
      bracketRow({ bracketMax: '500', cum1: '5', cum2: '65000' }),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' }),
    ])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice]: 브라켓 상한이 오름차순이 아니다 — 5000 다음에 500 이 왔다',
    )
  })

  it('누적이 같은 값이면(폭 0) 잡아낸다 — 영원히 안 나오는 티어다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ cum1: '3', cum2: '3' }),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' }),
    ])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice] 브라켓(≤500): 누적이 순증가가 아니다 — cum2(3) 가 cum1(3) 이하다. 같은 값은 폭 0, 영원히 안 나오는 티어다',
    )
  })

  it('누적 칸 수가 티어 수와 다르면 잡아낸다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ cum1: '60000', cum2: '' }),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' }),
    ])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice] 브라켓(≤500): 누적 칸 수(1)가 티어 수(2)와 다르다 — 티어마다 누적 상한이 하나씩 있어야 한다',
    )
  })

  it('누적이 100000 을 넘으면 잡아낸다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ cum2: '100001' }),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' }),
    ])
    expect(validateGatherTables(tables, healthyData()).violations).toContain(
      'gather[ice] 브라켓(≤500): 누적 100001 이 100000 을 넘는다 — roll 은 0~100000 이다',
    )
  })

  it('존재하지 않는 아이템을 가리키는 티어를 잡아낸다', () => {
    const data = gameDataWith([testItem('ice_shard')], [node('ice_vein', 'ice', 'ice')])
    expect(validateGatherTables(parsedIce(), data).violations).toContain(
      'gather[ice] 티어 1: 존재하지 않는 아이템 "ice_gem" 을 가리킨다',
    )
  })

  it('어느 노드도 가리키지 않는 고아 표를 잡아낸다', () => {
    const data = gameDataWith([testItem('ice_gem'), testItem('ice_shard')], [])
    expect(validateGatherTables(parsedIce(), data).violations).toContain(
      'gather[ice]: 어느 노드도 이 표를 가리키지 않는다 — 플레이어가 닿을 방법이 없는 표다',
    )
  })

  it('한 표를 두 기술의 노드가 공유하면 잡아낸다', () => {
    // 표의 기술은 하나(meta.skill)다. 다른 기술의 노드가 같은 표를 가리키면 그
    // 노드의 채집이 엉뚱한 기술의 숙련 브라켓을 굴리게 된다.
    const data = gameDataWith(
      [testItem('ice_gem'), testItem('ice_shard')],
      [node('ice_vein', 'ice', 'ice'), node('odd_tree', 'wood', 'ice')],
    )
    expect(validateGatherTables(parsedIce(), data).violations).toContain(
      'nodes[odd_tree]: 기술(wood)이 표 "ice" 의 기술(ice)과 다르다 — 한 표는 한 기술의 노드만 가리킨다',
    )
  })
})

describe('validateGatherTables — 경고', () => {
  it('최종(∞) 브라켓에 실패가 남으면 경고한다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow(),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '95000' }),
    ])
    const { violations, warnings } = validateGatherTables(tables, healthyData())
    expect(violations).toEqual([])
    expect(warnings).toContain(
      'gather[ice]: 최종(∞) 브라켓에 실패가 남는다 — 마지막 누적이 95000 이라 5000/100001 은 빈손이다. 원작 준용은 100000(실패 0%)이다',
    )
  })

  it('첫 브라켓의 최상 티어 누적이 0 이면 경고한다 — 숙련 0 의 잭팟이 사라진다', () => {
    const tables = parseGatherTables([metaRow()], tierRows(), [
      bracketRow({ cum1: '0' }),
      bracketRow({ bracketMax: '', cum1: '15000', cum2: '100000' }),
    ])
    const { warnings } = validateGatherTables(tables, healthyData())
    expect(warnings).toContain(
      'gather[ice]: 첫 브라켓(≤500)의 최상 티어 누적이 0 이다 — 숙련 0 의 잭팟이 사실상 사라진다',
    )
  })
})

// ---- 실제로 출하되는 표 ----
//
// 원작 덤프(prob_261~264)를 옮긴 수치가 규칙(§7-앞 6)대로 옮겨졌는지 못박는다.
// 특히 광물은 10단 → 7단 접기라 "행만 지우고 남은 누적은 그대로" 가 지켜졌는지를
// 브라켓별 마지막 누적(원작과 동일해야 한다)으로 검증한다.

function loadRealTables(): GatherTables {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const read = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))
  return parseGatherTables(read('gather_tables.csv'), read('gather_tiers.csv'), read('gather_brackets.csv'))
}

describe('실제로 출하되는 채집표', () => {
  it('네 표의 티어 수는 얼음 5 · 나무 6 · 광물 7 · 허브 7 이다', () => {
    const tables = loadRealTables()
    expect(tables.ice!.tiers).toHaveLength(5)
    expect(tables.wood!.tiers).toHaveLength(6)
    expect(tables.mineral!.tiers).toHaveLength(7)
    expect(tables.herb!.tiers).toHaveLength(7)
  })

  it('나무만 8브라켓(30k·70k·290k 포함)이고 나머지는 6브라켓이다 — §7-앞 19', () => {
    const tables = loadRealTables()
    expect(tables.wood!.brackets.map((b) => b.bracketMax)).toEqual([
      500, 5000, 10000, 30000, 70000, 290000, 500000, null,
    ])
    for (const id of ['ice', 'mineral', 'herb'] as const) {
      expect(tables[id]!.brackets.map((b) => b.bracketMax)).toEqual([500, 5000, 10000, 150000, 500000, null])
    }
  })

  it('광물 접기(10단→7단)가 브라켓별 마지막 누적을 원작 그대로 보존한다 — §7-앞 6', () => {
    // 삭제한 행(황동·에메랄드·다이아)의 질량은 다음 행에 자동 흡수되므로,
    // 마지막 누적(성공 질량 전체)은 원작 20000/25000/70000/80000/90000/100000
    // 에서 달라질 수 없다. 달라졌다면 접기 규칙이 아니라 수치를 고친 것이다.
    const mineral = loadRealTables().mineral!
    expect(mineral.brackets.map((b) => b.cumulative.at(-1))).toEqual([
      20000, 25000, 70000, 80000, 90000, 100000,
    ])
  })

  it('숙련 0 의 잭팟(최상 티어 누적 3)이 네 표 전부에 살아 있다 — §7-앞 18', () => {
    const tables = loadRealTables()
    for (const id of ['ice', 'wood', 'mineral', 'herb'] as const) {
      expect(tables[id]!.brackets[0]!.cumulative[0]).toBe(3)
    }
  })

  it('최종 브라켓은 네 표 모두 실패 0%(마지막 누적 100000)다 — §8-3', () => {
    const tables = loadRealTables()
    for (const id of ['ice', 'wood', 'mineral', 'herb'] as const) {
      expect(tables[id]!.brackets.at(-1)!.cumulative.at(-1)).toBe(100000)
    }
  })

  it('네 표가 각자 자기 계열의 대표 표다 — 계열마다 표가 하나뿐인 지금은 그 하나가 25칸을 잰다', () => {
    // 계열마다 정확히 하나여야 한다는 규칙 자체는 validateCollection 이 지고,
    // 여기서는 출하 CSV 가 그 규칙을 만족한 채로 나간다는 사실만 못박는다.
    const tables = loadRealTables()
    for (const id of ['ice', 'wood', 'mineral', 'herb'] as const) {
      expect(tables[id]!.equity).toBe(true)
    }
  })
})

describe('loadGatherTables — 서버 전용 진입의 내용물', () => {
  it('빌드가 구운 여덟 표(바깥 넷 + 심층 넷)를 동결된 채로 돌려준다', () => {
    // gamedata.json 과 별개 파일(gather-tables.json)에서 온다 — GameData 에
    // 실리지 않는 것이 이 산출물의 존재 이유다(§7-앞 9). **심층 표도 이쪽에
    // 실려야 한다**(결계 §9-앞 12): 확률표가 클라 번들로 새는 순간 결계 뒤의
    // 분포까지 F12 로 스포일된다.
    const tables = loadGatherTables()
    expect(Object.keys(tables).sort()).toEqual([
      'herb', 'herb_deep', 'ice', 'ice_deep', 'mineral', 'mineral_deep', 'wood', 'wood_deep',
    ])
    expect(Object.isFrozen(tables.ice_deep!.brackets[0])).toBe(true)
  })
})

// ---- 결계: 심층 표 넷 ----
//
// 심층 노드는 이제 자기 표를 굴린다. 그 표가 **바깥 표에 매여 있는** 방식이
// 이 아크의 값어치이고 동시에 빌드가 서는 조건이라(§9-앞 1·3·6·7), 출하 수치
// 자체를 여기서 못박는다. 아래 검증 스위트(위반이 실제로 뜨는가)와 짝이다 —
// 이쪽은 "출하 데이터가 그 규칙을 지킨 채로 나간다"를 본다.

/** 심층 표와 그 계열 바깥 표의 짝. 이 넷이 결계 뒤의 전부다. */
const DEEP_PAIRS = [
  ['ice_deep', 'ice'],
  ['wood_deep', 'wood'],
  ['mineral_deep', 'mineral'],
  ['herb_deep', 'herb'],
] as const

/** 결계가 열리는 문턱 — 이 값 **바로 위**가 심층 표를 재는 자리다(아래 주석). */
const BARRIER_SKILL = 85_000

describe('결계 — 심층 표 넷이 자기 계열 바깥 표에 매여 있다(§9-앞 1·3·6·7)', () => {
  const tables = loadRealTables()
  const data = loadGameData()

  it('심층 표의 id 는 바깥 표 id 에 "_deep" 을 붙인 것이고, 티어 사다리는 바깥과 같은 종이다', () => {
    // 사다리가 같아야 수집의 방 만점이 100(25칸 × 4등급)에서 안 움직인다 —
    // 심층 전용 아이템은 이 아크의 범위 밖이다(설계 §7 훅).
    for (const [deepId, outerId] of DEEP_PAIRS) {
      expect(isDeepTableId(deepId)).toBe(true)
      expect(isDeepTableId(outerId)).toBe(false)
      expect(tables[deepId]!.tiers).toEqual(tables[outerId]!.tiers)
      expect(tables[deepId]!.skill).toBe(tables[outerId]!.skill)
    }
    const slots = new Set(Object.values(tables).flatMap((t) => t.tiers.map((tier) => tier.itemId)))
    expect(slots.size).toBe(25)
  })

  it('∞ 브라켓이 바깥 ∞ 와 티어별로 글자 그대로 같다 — equity 로 형평 검증을 가려도 이 성질까지 사라지면 안 된다', () => {
    // **이 단언이 이 파일에서 가장 값비싼 한 줄이다.** 수집의 방 형평 검증은
    // 표를 순회하며 같은 25칸 문턱을 그 표의 ∞ 로 재는데(collection.ts), 오늘은
    // equity 칸이 심층 표를 그 순회에서 빼 준다. 언젠가 누가 equity 를 옮기거나
    // 그 가림을 걷어내면, 한 칸의 t4 가 두 표의 ∞ 양쪽에서 25~35분 대역을 동시에
    // 만족해야 하는 교착이 그날 돌아온다(실측 허용창 0.84×~1.23×). ∞ 가 복사본인
    // 한 그 교착은 산술적으로 일어날 수 없다.
    for (const [deepId, outerId] of DEEP_PAIRS) {
      expect(tables[deepId]!.brackets.at(-1)!).toEqual(tables[outerId]!.brackets.at(-1)!)
      expect(tables[deepId]!.brackets.at(-1)!.bracketMax).toBeNull()
    }
  })

  it('유한 브라켓이 500,000 까지 깔려 있다 — 85,000 에서 끝나면 형평 검증의 간격이 50ms 가 아니라 67ms 가 된다', () => {
    // 형평 검증은 `유한 상한 최댓값 + 1` 로 최종 브라켓의 간격을 잰다
    // (collection.ts 의 finalBracketProficiency). 심층 유한 브라켓이 85,000 에서
    // 끝나면 그 자리가 85,001 이 되어 최적손 간격이 67ms 다 — ∞ 를 글자 그대로
    // 복사해도 4단이 40.2분이 나와 25~35분 대역을 벗어난다(§9-앞 3).
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const finite = (id: string) =>
        Math.max(...tables[id]!.brackets.map((b) => b.bracketMax).filter((m): m is number => m !== null))
      expect(finite(deepId)).toBe(500_000)
      expect(finite(deepId)).toBe(finite(outerId))
    }
  })

  it('결계 아래(≤85,000) 브라켓은 바깥과 글자 그대로 같다 — 문이 열리기 전에는 심층도 바깥이다', () => {
    // 심층 배치는 결계 뒤에만 있지만(B3·B4), 표가 그것에 기대면 안 된다.
    // 문턱 아래 구간을 바깥과 같게 두면 "결계를 못 넘은 사람이 심층 노드 앞에
    // 섰을 때"가 애초에 이득도 손해도 아닌 상태가 된다.
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const below = (id: string) =>
        tables[id]!.brackets.filter((b) => b.bracketMax !== null && b.bracketMax <= BARRIER_SKILL)
      expect(below(deepId)).toEqual(below(outerId))
      expect(below(deepId).length).toBeGreaterThan(0)
    }
  })

  it('어느 유한 브라켓도 최상위 티어가 천장을 넘지 않는다 — 결계 뒤가 잭팟 자판기가 되면 절벽이 줄 것을 잃는다', () => {
    // 천장은 `max(바깥 ∞ × 10%, 바깥 같은 자리)` 다. max 인 이유는 나무가 만들었다 —
    // 나무의 절벽은 290,001 이라 `wood,500000` 이 이미 ∞ 값이고, 거기에 ∞×10% 를
    // 강제하면 심층이 바깥보다 10.7배 드문 표가 된다(아래 바닥 검사가 그것을 잡는다).
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const outer = tables[outerId]!
      const fromInfinite = Math.floor(outer.brackets.at(-1)!.cumulative[0]! * DEEP_TOP_TIER_CEILING)
      for (const bracket of tables[deepId]!.brackets) {
        if (bracket.bracketMax === null) continue
        const peerTop = gatherBracketFor(outer, bracket.bracketMax).cumulative[0]!
        expect(bracket.cumulative[0], `${deepId} ≤${bracket.bracketMax}`).toBeLessThanOrEqual(
          Math.max(fromInfinite, peerTop),
        )
      }
    }
  })

  it('어느 브라켓 어느 티어에서도 심층이 바깥보다 드물지 않다 — 문 너머가 어느 축에서든 나쁘면 그 문은 함정이다', () => {
    // 누적으로 재는 것이 요점이다: 누적 i 는 "티어 i 이상으로 희귀한 것이 나올
    // 확률"이라, 전 티어에서 심층 ≥ 바깥이면 어느 희귀도 문턱에서 보든 심층이
    // 나쁘지 않다는 뜻이 된다. 분당 골드만 보면 `wood_deep ≤500000` 처럼 값은
    // 같은데 최상위가 10.7배 드문 표가 조용히 통과한다 — 골드는 같아도 수집의
    // 방 칸은 그 자리에서 멀어진다.
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const outer = tables[outerId]!
      for (const bracket of tables[deepId]!.brackets) {
        if (bracket.bracketMax === null) continue
        const peer = gatherBracketFor(outer, bracket.bracketMax)
        bracket.cumulative.forEach((cum, i) => {
          expect(cum, `${deepId} ≤${bracket.bracketMax} 티어 ${i + 1}`).toBeGreaterThanOrEqual(peer.cumulative[i]!)
        })
      }
    }
  })

  it('나무 심층의 ≤500000 은 바깥의 글자 그대로 복사본이다 — 나무의 절벽은 290,001 이라 그 위에서 심층은 바깥과 같다', () => {
    // §9-앞 8: `wood,500000` 과 `wood,` 두 행이 바이트 단위로 같다. 그 구간의
    // ×2.5 는 산술적으로 불가능하고(천장 아래 최댓값이 1,625G/회인데 필요한 값은
    // 2,207G/회다) §4 도 "그 위에서 심층은 바깥과 같다"라고 적었다. 그러니 여기서
    // 심층이 할 수 있는 가장 정직한 일은 **바깥을 그대로 베끼는 것**이다.
    const at500k = (id: string) => tables[id]!.brackets.find((b) => b.bracketMax === 500_000)!
    expect(at500k('wood_deep')).toEqual(at500k('wood'))
  })

  it('숙련 85,001·구리 손에서 네 계열이 전부 분당 산출 ×2.5 다 — 결계 하나가 계열마다 다른 값이 되지 않는다', () => {
    // 재는 자리를 문 바로 위(85,001)·구리 손으로 고정한 이유: 그것이 이 문이
    // 실제로 열리는 순간이고, 구리는 그 구간에 서 있는 사람이 최소한 들고 있는
    // 손이다(1티어는 시작 지급이다). 간격은 표와 무관하므로 이 배수는 회당 기대
    // 매도가의 비와 정확히 같고, 그래서 손을 바꿔도 순위가 흔들리지 않는다.
    const ratios = DEEP_PAIRS.map(([deepId, outerId]) => deepOuterRatio(tables, data, deepId, outerId))
    for (const [index, ratio] of ratios.entries()) {
      expect(ratio, DEEP_PAIRS[index]![0]).toBeGreaterThan(DEEP_YIELD_TARGET * (1 - DEEP_YIELD_TOLERANCE))
      expect(ratio, DEEP_PAIRS[index]![0]).toBeLessThan(DEEP_YIELD_TARGET * (1 + DEEP_YIELD_TOLERANCE))
    }
    // 대역만 보면 2.13 과 2.87 이 나란히 통과한다(서로 35% 차이) — 출하 수치는
    // 넷이 한 점에 모여 있고, 그것이 흐트러지는 날 여기가 먼저 말한다.
    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThan(1.01)
  })

  it('목표 배수와 재는 자리가 문서와 같은 숫자다 — 2.5배·85,001·±15%', () => {
    // 검증이 읽는 상수를 테스트가 그대로 되읽으면 "둘이 같다"만 증명된다.
    // 리터럴로 한 번 못박아 두면 상수가 조용히 움직이는 날 여기가 빨개진다.
    expect(DEEP_YIELD_TARGET).toBe(2.5)
    expect(DEEP_YIELD_TOLERANCE).toBe(0.15)
    expect(DEEP_TOP_TIER_CEILING).toBe(0.1)
    expect(DEEP_MEASURE_PROFICIENCY).toBe(BARRIER_SKILL + 1)
  })

  it('어느 숙련에서도 심층이 바깥보다 나쁘지 않다 — 결계를 넘은 대가가 손해인 구간이 없다', () => {
    // 브라켓 하나만 ×2.5 로 맞추면 그 위 구간에서 바깥이 심층을 앞지를 수 있다
    // (얼음 바깥 ≤500000 은 179G/회인데 심층 ≤150000 은 156G/회다). 그러면
    // 결계 뒤가 특정 숙련대에서 함정이 된다 — 각 브라켓의 경계에서 되잰다.
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const deep = tables[deepId]!
      const outer = tables[outerId]!
      const hand = measureHand(deep.skill, data.items, 1, false, 0)!
      for (const bracket of deep.brackets) {
        const probe = bracket.bracketMax ?? 1_000_000
        const deepGold = goldPerMinute(deep, bracket, probe, hand, data.items)
        const outerGold = goldPerMinute(outer, gatherBracketFor(outer, probe), probe, hand, data.items)
        expect(deepGold, `${deepId} 숙련 ${probe}`).toBeGreaterThanOrEqual(outerGold)
      }
    }
  })

  it('심층 표의 equity 칸은 비어 있다 — 계열마다 25칸을 재는 표는 바깥 하나뿐이다(§9-앞 1·2)', () => {
    for (const [deepId, outerId] of DEEP_PAIRS) {
      expect(tables[deepId]!.equity).toBe(false)
      expect(tables[outerId]!.equity).toBe(true)
    }
  })
})

describe('validateGatherTables — 심층 표가 바깥에서 떨어져 나가면 빌드가 선다', () => {
  const tables = loadRealTables()
  const data = loadGameData()

  /** 출하 표에서 브라켓 하나의 누적만 바꾼 사본. 원본은 건드리지 않는다. */
  function withBracket(tableId: string, bracketMax: number | null, cumulative: number[]): GatherTables {
    const table = tables[tableId]!
    return {
      ...tables,
      [tableId]: {
        ...table,
        brackets: table.brackets.map((b) => (b.bracketMax === bracketMax ? { ...b, cumulative } : b)),
      },
    }
  }

  it('출하 여덟 표는 위반도 경고도 없다', () => {
    expect(validateGatherTables(tables, data)).toEqual({ violations: [], warnings: [] })
  })

  it('심층 ∞ 가 바깥 ∞ 와 한 칸이라도 다르면 위반이다 — 형평 검증의 교착이 그날 돌아온다', () => {
    const broken = withBracket('ice_deep', null, [15000, 34500, 49000, 69000, 100000])
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[ice_deep] ∞ 브라켓: 티어 2(pure_ice_crystal)의 누적이 34500 인데 바깥 표 "ice" 의 ∞ 는 34000 이다 — 심층 ∞ 는 바깥 ∞ 의 복사본이어야 한다. 수집의 방 형평 검증은 표를 순회하며 같은 25칸 문턱을 그 표의 ∞ 로 재므로, 둘이 갈라지면 한 칸의 t4 가 두 표의 25~35분 대역을 동시에 만족해야 하는 교착이 된다. gather_brackets.csv 의 ice_deep ∞ 행을 ice 의 ∞ 행과 같게 적는다',
    ])
  })

  it('심층 유한 브라켓의 최상위 티어가 천장을 넘으면 위반이다 — "∞ 보다 흔하지 않다" 는 얼음에서 333배까지 통과시킨다', () => {
    const broken = withBracket('ice_deep', 150_000, [2000, 7202, 27202, 52202, 85000])
    expect(validateGatherTables(broken, data).violations).toContain(
      'gather[ice_deep] 브라켓(≤150000): 최상위 티어(ice_gem)의 누적이 2000 인데 천장은 1500 까지다 — 바깥 표 "ice" 의 ∞ 누적 15000 의 10%(1500)와 바깥 같은 자리(≤150000)의 45 중 큰 쪽이다. 넘으면 결계 뒤가 잭팟 자판기가 되어 절벽(∞)이 줄 것을 잃는다. gather_brackets.csv 의 그 행 cum1 을 1500 이하로 적는다',
    )
  })

  it('천장이 바깥 같은 자리보다 낮아지지는 않는다 — 절벽이 이미 지나간 브라켓에는 앞당길 것이 없다', () => {
    // 나무 ≤500000 은 바깥이 이미 ∞ 값(최상위 15000)이라, ∞×10% = 1500 만
    // 천장으로 삼으면 **바깥을 그대로 베낀 표가 위반**이 된다. 그 규칙은 자기
    // 목적(절벽을 앞당기지 못하게 한다)을 넘어 심층을 바깥보다 나쁘게 만든다.
    expect(validateGatherTables(tables, data).violations).toEqual([])
    expect(tables['wood_deep']!.brackets.find((b) => b.bracketMax === 500_000)!.cumulative[0]).toBe(15_000)
  })

  it('심층이 바깥보다 드문 티어가 하나라도 있으면 위반이고, 메시지가 몇 대 몇인지 적는다', () => {
    // 이 결함이 실제로 출하 직전까지 살아 있었다: `wood_deep ≤500000` 이 1400 을
    // 지고도 분당 산출은 ×1.00 이라 배수 검사가 조용했다. 천장만 있고 바닥이
    // 없으면 "골드는 같은데 최상위가 10.7배 드문" 문이 통과한다.
    const broken = withBracket('wood_deep', 500_000, [1400, 47672, 62672, 75672, 85672, 100000])
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[wood_deep] 브라켓(≤500000): 티어 1(golden_fruit)의 누적이 심층 1400 · 바깥 15000 — 결계 너머가 10.7배 드물다. 문을 연 사람이 어느 티어에서든 손해를 보면 그 문은 함정이고(분당 골드가 같아도 수집의 방 칸은 그 자리에서 멀어진다), 그것이 이 결계가 지우러 온 거짓말과 같은 종류다. gather_brackets.csv 의 wood_deep ≤500000 행 cum1 을 바깥 같은 자리(≤500000)의 15000 이상으로 적는다',
    ])
  })

  it('심층의 분당 산출이 목표 배수를 벗어나면 위반이고, 메시지가 어느 계열이 몇 배인지 적는다', () => {
    // 바깥 ≤290000 을 그대로 베낀 심층 — 결계를 넘어도 값이 그대로인 상태다.
    const broken = withBracket('wood_deep', 290_000, [100, 19100, 34100, 49100, 64100, 95000])
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[wood_deep]: 숙련 85,001·구리 손의 분당 산출이 191,729G 로 바깥 표 "wood"(191,729G)의 1.00배다 — 목표는 2.50배(±15% → 2.13~2.88배)다. 네 계열이 같은 배수를 져야 결계 하나가 계열마다 다른 값이 되지 않는다. gather_brackets.csv 의 wood_deep ≤290000 행 누적을 희귀 쪽으로 옮긴다',
    ])
  })

  it('짝이 될 바깥 표가 없는 심층 표는 위반이다 — 무엇을 복사하고 무엇의 몇 배인지 물을 상대가 없다', () => {
    const { ice: _outer, ...orphaned } = tables
    expect(validateGatherTables(orphaned, data).violations).toContain(
      'gather[ice_deep]: 같은 계열(ice)의 바깥 표가 없다 — 심층 표는 바깥 표의 ∞ 를 복사하고 그 분당 산출의 2.5배를 져야 하므로 짝이 반드시 있어야 한다. gather_tables.csv 에 "_deep" 이 아닌 ice 계열 표를 둔다',
    )
  })
})
