import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData, GatherTables, ItemDef, NodeDef } from '@nogada/shared'
import { testItem } from '@nogada/shared/testing'
import { parseCsv } from './parse.js'
import { parseGatherTables, validateGatherTables } from './gatherTables.js'
import { loadGatherTables } from './loadGatherTables.js'

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
      id: 'ice', skill: 'ice', skillGainMin: 1, skillGainMax: 2,
      tiers: [{ itemId: 'ice_gem' }, { itemId: 'ice_shard' }],
      brackets: [
        { bracketMax: 500, cumulative: [3, 60000] },
        { bracketMax: null, cumulative: [15000, 100000] },
      ],
    })
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
})

describe('loadGatherTables — 서버 전용 진입의 내용물', () => {
  it('빌드가 구운 네 표를 동결된 채로 돌려준다', () => {
    // gamedata.json 과 별개 파일(gather-tables.json)에서 온다 — GameData 에
    // 실리지 않는 것이 이 산출물의 존재 이유다(§7-앞 9).
    const tables = loadGatherTables()
    expect(Object.keys(tables).sort()).toEqual(['herb', 'ice', 'mineral', 'wood'])
    expect(Object.isFrozen(tables.ice!.brackets[0])).toBe(true)
  })
})
