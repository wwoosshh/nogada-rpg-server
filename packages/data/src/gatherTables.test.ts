import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData, GatherBracketDef, GatherTableDef, GatherTables, ItemDef, NodeDef, SkillId } from '@nogada/shared'
import { NODE_VARIANTS, gatherBracketFor, sellPrice } from '@nogada/shared'
import { testItem } from '@nogada/shared/testing'
import { parseCsv } from './parse.js'
import { goldPerMinute, measureHand, tierChances } from './gatherMeasure.js'
import {
  DEEP_TOP_TIER_CEILING,
  DEEP_YIELD_TARGET,
  DEEP_YIELD_TOLERANCE,
  barrierGateValues,
  isDeepTableId,
  isSpecialTableId,
  parseGatherTables,
  suffixOfVariant,
  validateGatherTables,
  variantOfTableId,
} from './gatherTables.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * 그 계열 결계가 열리는 **바로 위** 숙련 — `transitions.csv` 에서 유도한다.
 *
 * 상수 85,001 을 여기서 되읽던 시절에는, 결계의 `gateValue` 를 200,000 으로 올려도
 * 이 증명이 그대로 초록이었다 — 문이 안 열리는 자리를 재면서. 재는 자리가 문에
 * 묶여 있어야 그 날 이 파일이 먼저 빨개진다.
 */
function opensAt(data: GameData, skill: SkillId): number {
  const gates = barrierGateValues(data.transitions, skill)
  expect(gates, `${skill} 계열 결계의 문턱`).toHaveLength(1)
  return gates[0]! + 1
}

/**
 * 심층 ÷ 바깥 분당 산출 — **재는 자리는 문 바로 위·구리 손 하나**다.
 *
 * 검증(gatherTables.ts)과 같은 자(gatherMeasure.ts)를 부른다. 여기서 확률을
 * 다시 세면 증명이 판정과 다른 식을 보게 된다(§6-앞 14 의 교훈).
 */
function deepOuterRatio(tables: GatherTables, data: GameData, deepId: string, outerId: string): number {
  const deep = tables[deepId]!
  const outer = tables[outerId]!
  const hand = measureHand(deep.skill, data.items, 1, false, 0)!
  const at = opensAt(data, deep.skill)
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
  // sprite 는 이 스위트가 재는 것과 무관하다(표 검증은 그림을 읽지 않는다) —
  // 타입이 요구하니 id 를 그대로 준다.
  return { id, name: id, skill, tableId, variant: 'normal', sprite: id }
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
  it('빌드가 구운 열두 표(바깥 넷 + 심층 넷 + 특수 넷)를 동결된 채로 돌려준다', () => {
    // gamedata.json 과 별개 파일(gather-tables.json)에서 온다 — GameData 에
    // 실리지 않는 것이 이 산출물의 존재 이유다. **심층 표도 이쪽에 실려야
    // 한다**: 확률표가 클라 번들로 새는 순간 결계 뒤의 분포까지 F12 로
    // 스포일된다.
    //
    // 근거는 **채집 티어 스펙 §7-앞 9** 하나다(바깥 넷과 같은 한 줄이다). 이
    // 줄은 오래 "결계 §9-앞 12" 도 함께 인용했는데 그 번호는 "`심층광맥곁`
    // 지점과 `얼음안내판` 은 결계 바깥에 둔다" 이고, 서버 전용 산출물 규범은
    // 결계 §9-앞 어디에도 없다.
    const tables = loadGatherTables()
    expect(Object.keys(tables).sort()).toEqual([
      'herb', 'herb_deep', 'herb_special',
      'ice', 'ice_deep', 'ice_special',
      'mineral', 'mineral_deep', 'mineral_special',
      'wood', 'wood_deep', 'wood_special',
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

/**
 * 심층 브라켓 하나가 **걸치는 바깥 브라켓들** — 숙련 구간이 겹치는 것 전부.
 *
 * 검증(gatherTables.ts)의 `spansOf` 와 같은 계산이지만 여기 따로 적는다: 검증이
 * 쓰는 함수를 증명이 그대로 되쓰면 "둘이 같다"만 증명되고, 그 계산 자체가 틀린
 * 날에는 양쪽이 사이좋게 틀린다. 걸치는 것이 하나뿐인 출하 데이터에서는 옛 자
 * (`gatherBracketFor(outer, 상한)`)와 답이 같지만, 자를 갈아 낀 이유가 데이터가
 * 아니라 규칙이므로 규칙 쪽을 적는다.
 */
function outerSpans(
  outerBrackets: readonly GatherBracketDef[],
  deepBrackets: readonly GatherBracketDef[],
  deepIndex: number,
): GatherBracketDef[] {
  const ranges = (brackets: readonly GatherBracketDef[]) => {
    let lo = 0
    return brackets.map((bracket) => {
      const hi = bracket.bracketMax ?? Number.MAX_SAFE_INTEGER
      const range = { bracket, lo, hi }
      lo = hi + 1
      return range
    })
  }
  const mine = ranges(deepBrackets)[deepIndex]!
  return ranges(outerBrackets)
    .filter((o) => Math.max(o.lo, mine.lo) <= Math.min(o.hi, mine.hi))
    .map((o) => o.bracket)
}

/** 심층 표와 그 계열 바깥 표의 짝. 이 넷이 결계 뒤의 전부다. */
const DEEP_PAIRS = [
  ['ice_deep', 'ice'],
  ['wood_deep', 'wood'],
  ['mineral_deep', 'mineral'],
  ['herb_deep', 'herb'],
] as const

/**
 * 출하된 결계 문턱 — 네 계열 전부 이 숫자다.
 *
 * **리터럴로 한 번 적어 두되, 아래 첫 단언이 그것을 `transitions.csv` 와 맞댄다.**
 * 예전에는 이 자리에 상수 하나만 있고 CSV 를 읽는 것이 아무것도 없었다 — 문턱을
 * 옮기면 검증도 증명도 여전히 옛 자리를 재면서 전부 초록이었다.
 */
const BARRIER_SKILL = 85_000

describe('결계 — 심층 표 넷이 자기 계열 바깥 표에 매여 있다(§9-앞 1·3·6·7)', () => {
  const tables = loadRealTables()
  const data = loadGameData()

  it('네 계열 결계의 문턱이 transitions.csv 에 정확히 하나씩 있고 그 숫자가 85,000 이다', () => {
    // 이 파일의 나머지가 재는 자리는 전부 이 숫자에서 나온다(opensAt). 문턱이
    // 계열마다 둘이거나 없으면 "문 바로 위" 라는 말이 성립하지 않는다.
    for (const [deepId] of DEEP_PAIRS) {
      expect(barrierGateValues(data.transitions, tables[deepId]!.skill)).toEqual([BARRIER_SKILL])
    }
  })

  it('심층 표의 id 는 바깥 표 id 에 "_deep" 을 붙인 것이고, 티어 사다리는 바깥과 같은 종이다', () => {
    // 사다리가 같아야 수집의 방 만점이 100(25칸 × 4등급)에서 안 움직인다 —
    // 심층 전용 아이템은 이 아크의 범위 밖이다(설계 §7 훅).
    for (const [deepId, outerId] of DEEP_PAIRS) {
      expect(isDeepTableId(deepId)).toBe(true)
      expect(isDeepTableId(outerId)).toBe(false)
      expect(tables[deepId]!.tiers).toEqual(tables[outerId]!.tiers)
      expect(tables[deepId]!.skill).toBe(tables[outerId]!.skill)
    }
    // **특수 표를 빼고 센다.** 방의 칸은 특수 표를 세지 않으므로(collection.ts,
    // 노드 종류 §6-5) 여기서 세는 것도 같은 집합이어야 만점 100 이 안 움직인다 —
    // 갈라지면 "사다리가 같다"는 이 테스트가 도감과 다른 세계를 지키게 된다.
    const slots = new Set(
      Object.values(tables)
        .filter((t) => !isSpecialTableId(t.id))
        .flatMap((t) => t.tiers.map((tier) => tier.itemId)),
    )
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
    // 천장은 `max(바깥 ∞ × 10%, 걸친 바깥 중 가장 인색한 곳)` 이다. max 인 이유는
    // 나무가 만들었다 — 나무의 절벽은 290,001 이라 `wood,500000` 이 이미 ∞ 값이고,
    // 거기에 ∞×10% 를 강제하면 심층이 바깥보다 10.7배 드문 표가 된다(바닥이 잡는다).
    //
    // **"걸친 것 중 가장 인색한"이 요점이다.** 여기서 `gatherBracketFor(outer, 상한)`
    // 하나만 보면 이 증명이 옛 자를 되쓰게 되고, 심층 브라켓 하나가 바깥 여럿에
    // 걸치는 데이터에서 천장이 통째로 풀리는 것을 못 본다(아래 재현 스위트).
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const outer = tables[outerId]!
      const fromInfinite = Math.floor(outer.brackets.at(-1)!.cumulative[0]! * DEEP_TOP_TIER_CEILING)
      for (const [index, bracket] of tables[deepId]!.brackets.entries()) {
        if (bracket.bracketMax === null) continue
        const stingiest = Math.min(
          ...outerSpans(outer.brackets, tables[deepId]!.brackets, index).map((b) => b.cumulative[0]!),
        )
        expect(bracket.cumulative[0], `${deepId} ≤${bracket.bracketMax}`).toBeLessThanOrEqual(
          Math.max(fromInfinite, stingiest),
        )
      }
    }
  })

  it('어느 브라켓 어느 티어에서도 심층이 바깥보다 드물지 않다 — 그때 기대 골드도 함께 진다', () => {
    // 누적으로 재는 것이 요점이다: 누적 i 는 "티어 i 이상으로 희귀한 것이 나올
    // 확률"이라, 전 티어에서 심층 ≥ 바깥이면 어느 희귀도 문턱에서 잘라 봐도 심층이
    // 두껍다는 뜻이 된다. 사다리 값이 희귀→흔함으로 단조 감소하므로(아래 단언)
    // 그때 **기대 골드도** 심층 ≥ 바깥이다(아벨 합).
    //
    // 그러나 **칸별로는 그렇지 않다** — 아래 별도 단언이 그 사실을 숫자로 붙든다.
    for (const [deepId, outerId] of DEEP_PAIRS) {
      const outer = tables[outerId]!
      for (const [index, bracket] of tables[deepId]!.brackets.entries()) {
        if (bracket.bracketMax === null) continue
        const spans = outerSpans(outer.brackets, tables[deepId]!.brackets, index)
        bracket.cumulative.forEach((cum, i) => {
          const mostGenerous = Math.max(...spans.map((b) => b.cumulative[i]!))
          expect(cum, `${deepId} ≤${bracket.bracketMax} 티어 ${i + 1}`).toBeGreaterThanOrEqual(mostGenerous)
        })
      }
    }
  })

  it('사다리 값이 희귀→흔함으로 단조 감소한다 — 누적 지배가 기대 골드 지배를 뜻하게 하는 전제다', () => {
    // 이것이 위 바닥 단언의 **전제**다. 회당 기대 매도가는 `Σ 누적_i × (값_i −
    // 값_{i+1})` 로 다시 쓸 수 있는데(아벨 합), 괄호가 음수가 되는 티어가 하나라도
    // 생기면 "누적이 전부 두꺼운데 기대 골드는 더 나쁜" 표가 만들어질 수 있다.
    // 전제를 적어 두지 않으면 바닥 검사의 주석이 언젠가 거짓말이 된다.
    for (const table of Object.values(tables)) {
      const prices = table.tiers.map((tier) => sellPrice(data.items[tier.itemId]!))
      for (let i = 1; i < prices.length; i++) {
        expect(prices[i - 1], `${table.id} 티어 ${i} → ${i + 1}`).toBeGreaterThanOrEqual(prices[i]!)
      }
    }
  })

  it('그래도 칸별로는 심층이 더 드문 티어가 있다 — 바닥 검사가 보장하지 않는 것을 숫자로 적어 둔다', () => {
    // **다음 사람이 "심층은 어느 칸에서도 나쁠 수 없다"고 믿으면 안 된다.** 누적
    // 지배는 칸별 확률 지배를 함의하지 않는다(누적이 올라가면 그 위 티어의 폭이
    // 줄 수 있다). 출하 데이터에서 이미 그렇고, 그것은 결함이 아니라 설계다 —
    // 결계 뒤는 희귀 쪽으로 질량을 옮긴 표이지 모든 칸이 더 잘 나오는 표가 아니다.
    // 흔한 것은 결계 **밖**에 normal 노드 8개가 그대로 있다(설계 §2).
    const hand = measureHand('herb', data.items, 1, false, 0)!
    const at500k = (id: string) => tables[id]!.brackets.find((b) => b.bracketMax === 500_000)!
    const deep = tierChances(at500k('herb_deep').cumulative, hand)
    const outer = tierChances(at500k('herb').cumulative, hand)
    const common = tables['herb']!.tiers.findIndex((t) => t.itemId === 'common_herb')
    expect(common).toBeGreaterThanOrEqual(0)
    // 흔한 약초: 심층 0.827% vs 바깥 32.435% — 결계 안이 39.2배 드물다.
    expect(outer[common]! / deep[common]!).toBeGreaterThan(39)
    expect(outer[common]! / deep[common]!).toBeLessThan(40)
  })

  it('나무 심층의 ≤500000 은 바깥의 글자 그대로 복사본이다 — 나무의 절벽은 290,001 이라 그 위에서 심층은 바깥과 같다', () => {
    // §9-앞 8: `wood,500000` 과 `wood,` 두 행이 바이트 단위로 같다. 그 구간의
    // ×2.5 는 산술적으로 불가능하고(천장 아래 최댓값이 1,625G/회인데 필요한 값은
    // 2,207G/회다) §4 도 "그 위에서 심층은 바깥과 같다"라고 적었다. 그러니 여기서
    // 심층이 할 수 있는 가장 정직한 일은 **바깥을 그대로 베끼는 것**이다.
    const at500k = (id: string) => tables[id]!.brackets.find((b) => b.bracketMax === 500_000)!
    expect(at500k('wood_deep')).toEqual(at500k('wood'))
  })

  it('문 바로 위·구리 손에서 네 계열이 전부 분당 산출 ×2.5 다 — 결계 하나가 계열마다 다른 값이 되지 않는다', () => {
    // 재는 자리를 문 바로 위·구리 손으로 고정한 이유: 그것이 이 문이 실제로
    // 열리는 순간이고, 구리는 그 구간에 서 있는 사람이 최소한 들고 있는
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

  it('목표 배수와 천장 비율이 문서와 같은 숫자다 — 2.5배·±15%·10%', () => {
    // 검증이 읽는 상수를 테스트가 그대로 되읽으면 "둘이 같다"만 증명된다.
    // 리터럴로 한 번 못박아 두면 상수가 조용히 움직이는 날 여기가 빨개진다.
    //
    // 재는 자리(85,001)는 이제 상수가 아니라 CSV 에서 나오므로 여기 없다 — 위
    // 첫 단언이 `transitions.csv` 의 문턱을 직접 맞댄다.
    expect(DEEP_YIELD_TARGET).toBe(2.5)
    expect(DEEP_YIELD_TOLERANCE).toBe(0.15)
    expect(DEEP_TOP_TIER_CEILING).toBe(0.1)
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
      'gather[ice_deep] 브라켓(≤150000): 최상위 티어(ice_gem)의 누적이 2000 인데 천장은 1500 까지다 — 바깥 표 "ice" 의 ∞ 누적 15000 의 10%(1500)와 이 구간(숙련 10,001~150,000)에 걸친 바깥 브라켓 중 가장 인색한 곳(≤150000)의 45 중 큰 쪽이다. 넘으면 결계 뒤가 잭팟 자판기가 되어 절벽(∞)이 줄 것을 잃는다. gather_brackets.csv 의 그 행 cum1 을 1500 이하로 적는다',
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
      'gather[wood_deep] 브라켓(≤500000): 티어 1(golden_fruit)의 누적이 심층 1400 · 바깥 15000 — 결계 너머가 10.7배 드물다. 문을 연 사람이 어느 희귀도 문턱에서 잘라 봐도 손해를 보면(사다리 값이 희귀→흔함으로 단조 감소하므로 그때 기대 골드도 함께 진다) 그 문은 함정이고, 그것이 이 결계가 지우러 온 거짓말과 같은 종류다. gather_brackets.csv 의 wood_deep ≤500000 행 cum1 을 이 구간(숙련 290,001~500,000)에 걸친 바깥 브라켓 중 가장 후한 곳(≤500000)의 15000 이상으로 적는다',
    ])
  })

  it('문 바로 위의 심층이 바깥의 복사본이면 위반이다 — 문을 연 사람이 첫 걸음부터 같은 표를 굴린다', () => {
    // 바깥 ≤290000 을 그대로 베낀 심층 — 결계를 넘어도 값이 그대로인 상태다.
    // 이제 두 검사가 함께 말한다: 문이 열리는 자리가 복사본이라는 것(규칙 4)과,
    // 그 구간의 배수가 ×1.00 이라는 것(규칙 5).
    const broken = withBracket('wood_deep', 290_000, [100, 19100, 34100, 49100, 64100, 95000])
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[wood_deep]: 결계가 열리는 숙련 85,001(transitions.csv 의 wood 결계 gateValue 85,000 바로 위)에서 브라켓(≤290000)이 바깥 표 "wood" 의 같은 자리(≤290000)와 글자 그대로 같다 — 문을 연 사람이 첫 걸음부터 바깥과 똑같은 표를 굴린다. 문 너머에 아무 일도 안 일어나는 것이 이 아크가 지우러 온 거짓말이다. gather_brackets.csv 의 wood_deep ≤290000 행 누적을 희귀 쪽으로 옮겨 2.50배로 만든다',
      'gather[wood_deep] 브라켓(≤290000): 숙련 70,001~290,000·구리 손의 분당 산출이 181,933G 로 바깥 표 "wood" 의 같은 구간(≤290000, 181,933G)의 1.00배다 — 목표는 2.50배(±15% → 2.13~2.88배)다. 네 계열이 같은 배수를 져야 결계 하나가 계열마다 다른 값이 되지 않고, 결계 수명 전 구간이 같은 약속을 져야 문 너머가 뒤로 갈수록 싱거워지지 않는다. gather_brackets.csv 의 wood_deep ≤290000 행 누적을 희귀 쪽으로 옮긴다',
    ])
  })

  it('짝이 될 바깥 표가 없는 심층 표는 위반이다 — 무엇을 복사하고 무엇의 몇 배인지 물을 상대가 없다', () => {
    const { ice: _outer, ...orphaned } = tables
    expect(validateGatherTables(orphaned, data).violations).toContain(
      'gather[ice_deep]: 같은 계열(ice)의 바깥 표가 없다 — 심층 표는 바깥 표의 ∞ 를 복사하고 그 분당 산출의 2.5배를 져야 하므로 짝이 반드시 있어야 한다. gather_tables.csv 에 "_deep" 이 아닌 ice 계열 표를 둔다',
    )
  })

  /**
   * **설계 §5 의 분 목표에서 역산한** 얼음 특수 표. 이 스위트와 아래 특수 스위트가
   * 같은 것을 쓴다 — 픽스처가 둘이면 한쪽만 규범을 만족하게 되는 날이 온다.
   *
   * 사다리는 둘뿐이다: 뜨거운 얼음(잭팟)과 그 계열 최저가(얼음 조각). 특수 노드가
   * 파는 것은 골드가 아니라 열쇠이므로 잡티어를 싼 것으로 채운다(설계 §6-9 —
   * 매도가 단조 감소는 고칠 테스트가 아니라 지킬 제약이다).
   *
   * `cum1` 은 구리손·브라켓 하한에서 "뜨거운 얼음 1개까지 N분"을 만족하는 값이다
   * (37.5 / 22 / 17 / 15 / 4 / 2분 → 22 / 23 / 22 / 22 / 47 / 61). 성공률(마지막
   * 누적)은 바깥과 같게 두었다 — 꽝을 늘려 특수를 낮추는 것은 저장소가 채집에서
   * 성공률 곡선을 은퇴시킨 그 이유에 정확히 걸린다.
   */
  const SPECIAL_CUM1 = [20, 25, 31, 38, 46, 61]

  function iceSpecial(): GatherTableDef {
    const outer = tables['ice']!
    return {
      ...outer,
      id: 'ice_special',
      equity: false,
      tiers: [
        { itemId: 'hot_ice' },
        { itemId: 'ice_shard' },
      ],
      brackets: outer.brackets.map((bracket, i) => ({
        bracketMax: bracket.bracketMax,
        cumulative: [SPECIAL_CUM1[i]!, bracket.cumulative.at(-1)!],
      })),
    }
  }

  /** 뜨거운 얼음이 없는 세계에서는 특수 표의 티어가 실재하지 않는다 — 아이템도 함께 준다. */
  function withHotIce(source: GameData): GameData {
    return {
      ...source,
      items: {
        ...source.items,
        hot_ice: testItem('hot_ice', { name: '뜨거운 얼음', price: 24000, skill: 'ice' }),
      },
    }
  }

  /**
   * 같은 계열에 특수 표를 하나 세운 세계 — 표도 그것을 가리키는 노드도 함께 준다.
   *
   * 노드까지 주는 이유: 고아 표 검사가 "어느 노드도 안 가리킨다"로 먼저 짖으면
   * 이 스위트가 재려는 것(심층↔바깥 짝짓기가 특수 표를 세었는가)이 그 소음에
   * 묻힌다. 표는 §5 목표를 만족하므로 특수 검사에도 아무 할 말이 없다.
   */
  function withIceSpecial(): { tables: GatherTables; data: GameData } {
    return {
      tables: { ...tables, ice_special: iceSpecial() },
      data: {
        ...withHotIce(data),
        nodes: {
          ...data.nodes,
          red_ice_vein: {
            id: 'red_ice_vein', name: '붉은 얼음 광맥', skill: 'ice',
            tableId: 'ice_special', variant: 'special', sprite: 'red_ice_vein',
          },
        },
      },
    }
  }

  // **바깥 표의 정의가 "심층이 아닌 표"이던 시절의 대가다.** `ice_special` 이
  // 서는 순간 `ice` 의 짝이 둘이 되어 `candidates.length !== 1` 이 참이 되고,
  // 그 자리의 continue 가 ∞복사·천장·바닥·결계문·배수 **다섯을 한꺼번에** 건너뛴다.
  // 특수 노드는 결계 밖에 서므로 이 상태는 아크 B 가 데이터를 한 줄 더하는
  // 그날 바로 온다 — 심층 검증 전체가 조용히 꺼지는데, 꺼졌다는 말은 어디에도 안 뜬다.
  it('같은 계열에 특수 표가 서도 심층은 바깥 표를 하나로 찾는다 — 접미사가 없는 표만 바깥이다', () => {
    const { tables: withSpecial, data: withNode } = withIceSpecial()
    expect(validateGatherTables(withSpecial, withNode)).toEqual({ violations: [], warnings: [] })
  })

  it('특수 표가 선 뒤에도 심층 검증 다섯이 그대로 문다 — 짝짓기 실패로 통째로 건너뛰면 안 된다', () => {
    // 위 테스트만으로는 부족하다. 그것이 말하는 것은 "위반이 없다"뿐인데, 다섯을
    // 건너뛰는 길이 짝짓기 실패 말고도 있다(∞ 브라켓이 없으면 그 자리에서
    // 돌아 나간다) — 그 길로 새면 여전히 0건이라 초록이 "검사가 돌았다"를 뜻하지
    // 않는다. 짝짓기 실패만은 예외로 위반 한 줄을 남기지만(gatherTables.ts 의
    // continue 는 push **뒤**에 온다) 그것은 다섯 중 하나도 돌지 않았다는 신호이지
    // 다섯이 돌았다는 증거가 아니다. 그래서 같은 세계에서 심층 ∞ 를 한 칸
    // 깨뜨려 두고, 그 위반이 **여전히 나오는지**를 묻는다.
    const { tables: withSpecial, data: withNode } = withIceSpecial()
    const broken = {
      ...withSpecial,
      ice_deep: {
        ...withSpecial['ice_deep']!,
        brackets: withSpecial['ice_deep']!.brackets.map((b) =>
          b.bracketMax === null ? { ...b, cumulative: [15000, 34500, 49000, 69000, 100000] } : b,
        ),
      },
    }
    expect(validateGatherTables(broken, withNode).violations).toContain(
      'gather[ice_deep] ∞ 브라켓: 티어 2(pure_ice_crystal)의 누적이 34500 인데 바깥 표 "ice" 의 ∞ 는 34000 이다 — 심층 ∞ 는 바깥 ∞ 의 복사본이어야 한다. 수집의 방 형평 검증은 표를 순회하며 같은 25칸 문턱을 그 표의 ∞ 로 재므로, 둘이 갈라지면 한 칸의 t4 가 두 표의 25~35분 대역을 동시에 만족해야 하는 교착이 된다. gather_brackets.csv 의 ice_deep ∞ 행을 ice 의 ∞ 행과 같게 적는다',
    )
  })
})

// ---- 특수 표: 천장은 상대, 바닥은 절대 ----
//
// 심층은 `DEEP_YIELD_TARGET ± TOLERANCE` 로 양쪽을 죈다. 특수에 같은 자를 쓸 수
// 없다는 것이 실측으로 확정됐다: §5 목표를 만족하는 표의 비가 0.712 → 0.587 →
// 0.518 → 0.363 → 0.148 → **0.014** 로 내려가는데, 마지막 계단이 ×0.09 인 것은
// **바깥 ∞ 가 한 칸에 ×11.4 로 터지기 때문**이다(얼음의 보석이 15%). 비를 0.1 위로
// 유지하려면 뜨거운 얼음의 정가가 67만이 되어야 하고, 그것은 "특수 노드는 골드가
// 아니라 열쇠를 판다"(설계 §4)를 정면으로 뒤집는다.
//
// 그런데 같은 표의 **자기 진행**은 단조다(1,958 → 3,560 → 5,062 → 6,769 →
// 14,227 → 23,543). 그래서 천장은 상대(바깥을 절대 안 이긴다), 바닥은 절대(자기
// 분당 골드가 브라켓마다 최소 ×SPECIAL_YIELD_MIN_STEP 오른다)로 나눈다.

describe('validateGatherTables — 특수 표는 바깥을 안 이기고, 스스로는 계속 오른다', () => {
  const data0 = loadGameData()
  const tables0 = loadGatherTables()

  const SPECIAL_CUM1 = [20, 25, 31, 38, 46, 61]

  function iceSpecial(overrides: Partial<GatherTableDef> = {}): GatherTableDef {
    const outer = tables0['ice']!
    return {
      ...outer,
      id: 'ice_special',
      equity: false,
      tiers: [
        { itemId: 'hot_ice' },
        { itemId: 'ice_shard' },
      ],
      brackets: outer.brackets.map((bracket, i) => ({
        bracketMax: bracket.bracketMax,
        cumulative: [SPECIAL_CUM1[i]!, bracket.cumulative.at(-1)!],
      })),
      ...overrides,
    }
  }

  /** 표를 세우려면 그 표를 가리키는 노드와 그 티어의 아이템이 함께 있어야 한다. */
  function world(special: GatherTableDef): { tables: GatherTables; data: GameData } {
    return {
      tables: { ...tables0, ice_special: special },
      data: {
        ...data0,
        items: {
          ...data0.items,
          hot_ice: testItem('hot_ice', { name: '뜨거운 얼음', price: 24000, skill: 'ice' }),
        },
        nodes: {
          ...data0.nodes,
          red_ice_vein: {
            id: 'red_ice_vein', name: '붉은 얼음 광맥', skill: 'ice',
            tableId: 'ice_special', variant: 'special', sprite: 'red_ice_vein',
          },
        },
      },
    }
  }

  const violationsOf = (special: GatherTableDef): string[] => {
    const { tables: t, data: d } = world(special)
    return validateGatherTables(t, d).violations
  }

  it('§5 의 분 목표에서 역산한 표는 위반도 경고도 없다 — 목표와 규범이 함께 설 수 있다', () => {
    const { tables: t, data: d } = world(iceSpecial())
    expect(validateGatherTables(t, d)).toEqual({ violations: [], warnings: [] })
  })

  it('바깥과 글자 그대로 같은 특수 표는 천장 위반이다 — 그것이 "두 번째 상점"이다', () => {
    const outer = tables0['ice']!
    const copied = iceSpecial({ tiers: outer.tiers, brackets: outer.brackets })
    expect(violationsOf(copied).join('\n')).toMatch(/천장/)
  })

  /**
   * **∞ 를 안 재면 이 검사는 아무것도 안 지킨다.** 심층은 ∞ 를 건너뛰는 것이 옳다
   * (규칙 1 이 "바깥의 복사본"으로 이미 재고, 그래서 배수는 산술적으로 1.000 이다).
   * 특수에는 복사 규칙이 없으므로 ∞ 는 **어떤 검사도 안 받는 구간**이 되는데,
   * 플레이어가 그 노드 앞에서 보내는 시간의 대부분이 ∞ 다(숙련 500,000 도달 =
   * 584.2분, 그 뒤로 영원히).
   */
  it('∞ 브라켓만 바깥을 넘겨도 천장이 문다 — 유한 브라켓만 재면 584분 뒤가 무측정이다', () => {
    // 유한 브라켓 다섯은 §5 목표 그대로 두고 ∞ 하나만 밀어 올린다. 바깥 ∞ 의
    // 분당 골드(구리손·숙련 500,001)를 넘기는 `cum1` 은 16,853 이므로 20,000 이면
    // 확실히 넘는다 — 유한 쪽만 재는 구현에서는 이 표가 초록이다.
    const infiniteRich = iceSpecial({
      brackets: iceSpecial().brackets.map((b) =>
        b.bracketMax === null ? { ...b, cumulative: [20000, b.cumulative[1]!] } : b,
      ),
    })
    expect(violationsOf(infiniteRich).join('\n')).toMatch(/∞[\s\S]*천장/)
  })

  /**
   * 천장 하나로는 ×0.016 과 ×0.999 를 구별하지 못한다 — 폭 ×52.3 이 전부 초록이다.
   * §3 이 "계열마다 다른 사다리 모양"이라고 부른 조종간이 통째로 검증 밖에 있게 된다.
   */
  it('자기 분당 골드가 브라켓 사이에 안 오르면 바닥 위반이다 — 천장만으로는 못 잡는다', () => {
    const flat = iceSpecial({
      brackets: iceSpecial().brackets.map((b) => ({ ...b, cumulative: [22, b.cumulative[1]!] })),
    })
    const found = violationsOf(flat).join('\n')
    expect(found).toMatch(/바닥/)
    // 천장은 전부 통과한다 — 바닥이 없으면 이 표가 초록이었다는 뜻이다.
    expect(found).not.toMatch(/천장/)
  })

  /**
   * 심층의 `:558` 은 문턱 아래에서 바깥과 **같기를** 요구한다. 그 근거는 "문턱
   * 아래에는 그 표를 굴릴 사람이 없다"인데, **특수 노드는 결계 밖에 서므로**
   * (설계 §6-7) 문턱 아래가 곧 특수 표가 실제로 굴려지는 자리다. 그 요구를 복사하면
   * §5 의 "숙련 0 에서 37.5분"이 그 자리에서 위반이 된다.
   */
  it('문턱 아래에서 바깥과 달라도 통과한다 — 특수 노드는 결계 밖에 선다', () => {
    // §5 표의 첫 두 브라켓(≤500·≤5000)은 얼음 결계 문턱 85,000 아래이고
    // 바깥과 값이 다르다. 그것이 위반이 아님을 위 초록 테스트가 이미 말하지만,
    // **왜** 아닌지를 여기서 못박는다 — 심층 쪽 문구가 특수에 새면 잡는다.
    expect(violationsOf(iceSpecial()).join('\n')).not.toMatch(/문턱/)
  })

  it('짝이 될 바깥 표가 없는 특수 표는 위반이다 — 무엇보다 낮아야 하는지 물을 상대가 없다', () => {
    const { tables: t, data: d } = world(iceSpecial())
    const { ice: _outer, ...orphaned } = t
    expect(validateGatherTables(orphaned, d).violations.join('\n')).toMatch(
      /gather\[ice_special\][\s\S]*바깥 표가 없다/,
    )
  })
})

// ---- 등급↔접미사 전사 ----
//
// 등급(`nodes.csv` 의 variant)과 표 id 의 접미사는 한 가지를 말하는 두 표시다.
// 둘을 잇는 자리가 여럿이 되면 갈라지고, **갈라져도 어느 화면 하나 이상해지지
// 않는다** — 확률표는 서버 전용이라 사람이 눈으로 대조할 곳조차 없다. 그것이
// 심층 노드 넷이 이름과 색만 심층이던 상태의 정확한 원인이다.

describe('등급↔접미사 전사 — 잇는 자리가 하나뿐이어야 한다', () => {
  it('등급 전수가 자기 접미사를 붙인 표 id 에서 그대로 되읽힌다', () => {
    // `NODE_VARIANTS` 를 도는 이유: 등급이 넷째로 늘어나는 날 이 왕복이 자동으로
    // 그 등급까지 묻는다. 셋을 손으로 적으면 그날 새 등급만 조용히 안 재인다.
    for (const variant of NODE_VARIANTS) {
      expect(variantOfTableId(`ice${suffixOfVariant(variant)}`)).toBe(variant)
    }
  })

  it('접미사가 등급마다 서로 다르다 — 둘이 같으면 되읽기가 한쪽을 영원히 삼킨다', () => {
    expect(new Set(NODE_VARIANTS.map(suffixOfVariant)).size).toBe(NODE_VARIANTS.length)
  })

  it('바깥 표만 접미사가 없다 — "접미사가 없는 표가 바깥"이라는 정의가 여기서 나온다', () => {
    expect(suffixOfVariant('normal')).toBe('')
    expect(variantOfTableId('ice')).toBe('normal')
  })

  it('두 술어는 전사 함수와 같은 답을 낸다 — 셋이 갈라지면 어느 쪽이 옳은지 물을 곳이 없다', () => {
    for (const id of ['ice', 'ice_deep', 'ice_special']) {
      expect(isDeepTableId(id)).toBe(variantOfTableId(id) === 'deep')
      expect(isSpecialTableId(id)).toBe(variantOfTableId(id) === 'special')
    }
  })

  /**
   * 접미사 문자열을 아는 소스 파일이 `gatherTables.ts` 하나뿐인지 되읽는다.
   *
   * 규범은 "전사 함수 **하나**가 등급↔접미사를 소유한다"인데, 그 규범을 무는
   * 것은 타입 검사가 아니라 이 순회뿐이다 — 다른 파일이 `id.endsWith('_deep')`
   * 를 한 줄 적어도 컴파일도 테스트도 전부 통과하고, 그 줄이 이 파일과 갈라지는
   * 날 노드 그림과 실제 분포가 어긋난다. 테스트 파일은 뺀다: 기대 문자열에 접미사가
   * 그대로 적히는 것이 오히려 검사의 값어치다(메시지가 바뀌면 빨개져야 한다).
   */
  it('접미사 문자열을 직접 적은 소스는 gatherTables.ts 하나뿐이다', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const owner = join('packages', 'data', 'src', 'gatherTables.ts')
    const skipDirs = new Set(['node_modules', 'dist', 'generated', '.git'])
    const literal = /(['"`])_(?:deep|special)\1/

    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(full)
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          const rel = relative(root, full)
          if (rel !== owner && literal.test(readFileSync(full, 'utf8'))) offenders.push(rel)
        }
      }
    }
    for (const top of ['packages', 'apps']) walk(join(root, top))

    expect(offenders).toEqual([])
  })
})

// ---- 3렌즈 리뷰가 재현한 구멍 ----
//
// 아래 넷은 전부 **리뷰어가 실제로 데이터를 고쳐 돌려 본 것**이고, 그때 빌드는
// 위반 0·경고 0 이었다. 재현을 테스트로 옮겨 두는 것이 이 수정의 값어치다 —
// 고침 자체는 몇 줄이지만, 그 몇 줄이 되돌려지는 날 말해 주는 것은 여기뿐이다.

describe('validateGatherTables — 리뷰가 재현한 구멍', () => {
  const tables = loadRealTables()
  const data = loadGameData()

  /** 출하 표의 브라켓 목록 자체를 갈아 끼운 사본 — 행을 지우는 재현에 쓴다. */
  function withBrackets(tableId: string, brackets: GatherBracketDef[]): GatherTables {
    return { ...tables, [tableId]: { ...tables[tableId]!, brackets } }
  }

  it('심층 브라켓 하나가 바깥 여럿에 걸치면 천장은 그중 가장 인색한 것을 본다 — 후한 쪽을 보면 천장이 통째로 풀린다', () => {
    // **리뷰어의 재현 그대로:** `gather_brackets.csv` 에서 ① `wood_deep,290000`
    // 행을 지우고 ② `wood_deep,500000` 의 cum2 를 34000 → 46891 로 올린다.
    // 그러면 심층 ≤500000 **하나**가 바깥 ≤290000·≤500000 **둘**에 걸치는데,
    // 옛 자(상한 쪽 = 걸친 것 중 가장 후한 곳)로는 천장이 15000 이 되어 심층이
    // 15000 을 그대로 지고도 위반 0·경고 0·×2.5 격차 테스트 통과(1.0008)였다.
    // 실제 결과는 **숙련 100,000 에서 금빛 열매가 결계 안 15.001% vs 바깥
    // 0.101%, 149배** — 나무의 절벽(290,001)이 값어치를 통째로 잃는다.
    const deep = tables['wood_deep']!
    const broken = withBrackets(
      'wood_deep',
      deep.brackets
        .filter((b) => b.bracketMax !== 290_000)
        .map((b) =>
          b.bracketMax === 500_000 ? { ...b, cumulative: [15000, 46891, 47000, 60000, 70000, 100000] } : b,
        ),
    )
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[wood_deep] 브라켓(≤500000): 최상위 티어(golden_fruit)의 누적이 15000 인데 천장은 1500 까지다 — 바깥 표 "wood" 의 ∞ 누적 15000 의 10%(1500)와 이 구간(숙련 70,001~500,000)에 걸친 바깥 브라켓 중 가장 인색한 곳(≤290000)의 100 중 큰 쪽이다. 넘으면 결계 뒤가 잭팟 자판기가 되어 절벽(∞)이 줄 것을 잃는다. 이 브라켓 하나가 바깥 브라켓 2개(≤290000, ≤500000)에 걸쳐 있다 — gather_brackets.csv 의 wood_deep 에 bracketMax 290000 행을 두어 바깥과 경계를 맞추면 구간마다 자기 천장을 갖는다. gather_brackets.csv 의 그 행 cum1 을 1500 이하로 적는다',
    ])
  })

  it('바깥과 값이 다른 브라켓은 전부 잰다 — 한 점만 재던 시절 결계 수명의 80%가 무측정이었다', () => {
    // **리뷰어의 재현:** `mineral_deep,500000` 을 `mineral,500000` 과 글자 그대로
    // 같게 적는다. 옛 검사는 표당 한 점(85,001)만 쟀고 그 점이 걸리는 브라켓은
    // `≤150000` 이라, 이 344분 동안 심층이 ×1.000 인데 위반 0 이었다(구리 손
    // 실측으로 ice·mineral·herb 는 87분만 재고 344분이 무측정).
    const outer = tables['mineral']!.brackets.find((b) => b.bracketMax === 500_000)!
    const deep = tables['mineral_deep']!
    const broken = withBrackets(
      'mineral_deep',
      deep.brackets.map((b) => (b.bracketMax === 500_000 ? { ...b, cumulative: [...outer.cumulative] } : b)),
    )
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[mineral_deep] 브라켓(≤500000): 숙련 150,001~500,000·구리 손의 분당 산출이 140,481G 로 바깥 표 "mineral" 의 같은 구간(≤500000, 140,481G)의 1.00배다 — 목표는 2.50배(±15% → 2.13~2.88배)다. 네 계열이 같은 배수를 져야 결계 하나가 계열마다 다른 값이 되지 않고, 결계 수명 전 구간이 같은 약속을 져야 문 너머가 뒤로 갈수록 싱거워지지 않는다. gather_brackets.csv 의 mineral_deep ≤500000 행 누적을 희귀 쪽으로 옮긴다',
    ])
  })

  it('무측정 구간을 천장·바닥 안에서 최대로 밀면 ×6.4 다 — 그것도 옛 검사에는 위반 0 이었다', () => {
    // 같은 구멍의 반대 끝. 천장(cum1 ≤ 1500)과 바닥(전 티어 ≥ 바깥)을 지키면서도
    // 나머지 질량을 전부 2티어로 올리면 목표의 2.6배가 나온다 — 결계 뒤가 뒤로
    // 갈수록 싱거워지는 것만 문제가 아니라 그 반대도 문제다.
    const deep = tables['herb_deep']!
    const broken = withBrackets(
      'herb_deep',
      deep.brackets.map((b) =>
        b.bracketMax === 500_000 ? { ...b, cumulative: [1500, 99994, 99995, 99996, 99997, 99998, 100000] } : b,
      ),
    )
    expect(validateGatherTables(broken, data).violations).toEqual([
      'gather[herb_deep] 브라켓(≤500000): 숙련 150,001~500,000·구리 손의 분당 산출이 957,933G 로 바깥 표 "herb" 의 같은 구간(≤500000, 150,229G)의 6.38배다 — 목표는 2.50배(±15% → 2.13~2.88배)다. 네 계열이 같은 배수를 져야 결계 하나가 계열마다 다른 값이 되지 않고, 결계 수명 전 구간이 같은 약속을 져야 문 너머가 뒤로 갈수록 싱거워지지 않는다. gather_brackets.csv 의 herb_deep ≤500000 행 누적을 흔한 쪽으로 옮긴다',
    ])
  })

  it('결계 문턱을 올리면 문턱 아래로 내려앉은 심층 브라켓이 위반이 된다 — 재는 자리가 CSV 에 묶여 있다', () => {
    // **리뷰어의 재현:** 얼음 결계의 `gateValue` 를 85,000 → 200,000 으로 올린다.
    // 옛 검사는 상수 85,001 을 재던 자리라 위반 0 이었다 — 그러면 ×2.5 를 재는
    // 자리가 **문이 안 열리는 구간**이 되고, 정작 문이 열린 뒤는 아무도 안 잰다.
    const raised = data.transitions.map((t) => (t.gateSkill === 'ice' ? { ...t, gateValue: 200_000 } : t))
    expect(validateGatherTables(tables, { ...data, transitions: raised }).violations).toEqual([
      'gather[ice_deep] 브라켓(≤150000): 숙련 10,001~150,000 는 ice 결계 문턱(200,000) 아래인데 바깥 표 "ice" 의 같은 구간(≤150000)과 값이 다르다 — 그 구간에는 문을 넘은 사람이 없으므로 이 값은 아무에게도 안 굴려지거나, 심층 배치가 결계 밖으로 새는 날 저숙련의 손에 그대로 쥐여진다(§9-앞 3). gather_brackets.csv 의 그 행을 ice 의 ≤150000 행과 같게 적거나, transitions.csv 의 ice 결계 gateValue 를 10000 이하로 내린다',
    ])
  })

  it('그 계열 결계가 아예 없으면 위반이다 — 문이 없으면 심층 표를 잴 자리도, 만날 사람도 없다', () => {
    const gone = data.transitions.filter((t) => t.gateSkill !== 'ice')
    expect(validateGatherTables(tables, { ...data, transitions: gone }).violations).toEqual([
      'gather[ice_deep]: ice 계열 결계가 transitions.csv 에 없다(gateSkill 이 ice 인 줄이 없다) — 심층 표는 그 문 뒤에서만 굴려지기로 하고 지은 것이라, 문턱이 곧 이 표의 2.50배를 재는 자리다. 문이 없으면 잴 자리도 없고 이 표는 아무도 못 만나는 표다. transitions.csv 에 그 결계 줄을 두거나 gather_tables.csv 에서 이 표를 지운다',
    ])
  })

  it('한 계열의 결계가 문턱을 둘로 말하면 위반이다 — 어느 숫자 위에서 ×2.5 인지 정해지지 않는다', () => {
    const iceGate = data.transitions.find((t) => t.gateSkill === 'ice')!
    const split = [...data.transitions, { ...iceGate, fromY: iceGate.fromY + 1, gateValue: 200_000 }]
    expect(validateGatherTables(tables, { ...data, transitions: split }).violations).toEqual([
      'gather[ice_deep]: ice 계열 결계가 문턱을 [85000, 200000] 2개로 말한다 — 어느 숫자 위에서 이 표가 2.50배를 져야 하는지 정해지지 않는다. transitions.csv 의 그 줄들 gateValue 를 하나로 맞춘다',
    ])
  })
})
