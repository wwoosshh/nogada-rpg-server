import type { GameData } from '@nogada/shared'
import { ENHANCE_CAP } from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { parseEnhanceCosts, validateEnhanceCosts } from './enhanceCosts.js'

type Row = Record<string, string>

function row(toolTier: string, level: string, itemId: string, count: string, gold: string): Row {
  return { toolTier, level, itemId, count, gold }
}

/**
 * 한 티어의 사다리를 통째로 적는다 — 검증의 대부분이 "1..ENHANCE_CAP 이 빠짐없이
 * 있는가"라서, 온전한 사다리를 만드는 길이 짧아야 **무엇을 일부러 망가뜨렸는지**가
 * 각 테스트에서 한 줄로 드러난다.
 */
function ladder(toolTier: number, multiplier: number): Row[] {
  const t = String(toolTier)
  return [
    row(t, '1', 'hard_log', String(5 * multiplier), String(5000 * multiplier)),
    row(t, '2', 'lavender', String(10 * multiplier), String(9000 * multiplier)),
    row(t, '3', 'pure_ice', String(15 * multiplier), String(15000 * multiplier)),
    row(t, '4', 'iron_ore', String(25 * multiplier), String(25000 * multiplier)),
    row(t, '5', 'hard_log', String(10 * multiplier), String(40000 * multiplier)),
    row(t, '5', 'lavender', String(10 * multiplier), String(40000 * multiplier)),
    row(t, '5', 'pure_ice', String(10 * multiplier), String(40000 * multiplier)),
    row(t, '5', 'iron_ore', String(10 * multiplier), String(40000 * multiplier)),
  ]
}

/** 표가 가리키는 원재료 넷과, 그 표를 쓰는 1티어 도구 하나. */
function dataWith(costs: GameData['enhanceCosts']): GameData {
  return {
    monsters: {}, monsterPlacements: {},
    items: {
      hard_log: testItem('hard_log', { name: '단단한 통나무', price: 400, skill: 'wood' }),
      lavender: testItem('lavender', { name: '라벤더', price: 130, skill: 'herb' }),
      pure_ice: testItem('pure_ice', { name: '맑은 얼음', price: 150, skill: 'ice' }),
      iron_ore: testItem('iron_ore', { name: '철 원석', price: 100, skill: 'mineral' }),
      // 계열 회전 검사만 쓰는 둘 — 계열이 없는 재료와 채집 계열이 아닌 재료다.
      // 출하 데이터에는 이런 행이 없지만, 그것이 없다는 것을 검사가 증명해야 한다.
      nameless_dust: testItem('nameless_dust', { name: '이름 없는 가루', price: 10 }),
      craft_scrap: testItem('craft_scrap', { name: '조합 부스러기', price: 10, skill: 'crafting' }),
      copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1),
    },
    nodes: {},
    recipes: {},
    maps: {},
    transitions: [],
    placements: {},
    milestones: [],
    speakers: {},
    shops: {},
    masters: [],
    places: {},
    schedules: {},
    routes: [],
    dialogue: [],
    collection: {},
    enhanceCosts: costs,
  }
}

describe('parseEnhanceCosts', () => {
  it('같은 (티어,단계)의 여러 행을 재료 목록 하나로 접는다 — +5 는 네 계열을 한꺼번에 먹는다(§6-앞 11)', () => {
    const costs = parseEnhanceCosts(ladder(1, 1))
    expect(costs).toHaveLength(ENHANCE_CAP)
    const plusFive = costs.find((c) => c.level === 5)
    expect(plusFive?.materials).toEqual([
      { item: 'hard_log', count: 10 },
      { item: 'lavender', count: 10 },
      { item: 'pure_ice', count: 10 },
      { item: 'iron_ore', count: 10 },
    ])
    // 골드는 단계의 것이지 행의 것이 아니다 — 네 줄이 40,000 을 되풀이해도 합계가 아니다.
    expect(plusFive?.gold).toBe(40_000)
  })

  it('한 단계 안에서 골드가 서로 다르면 던진다 — 어느 줄이 진짜인지 CSV 작가가 알 수 없다', () => {
    const rows = ladder(1, 1)
    rows[5] = row('1', '5', 'lavender', '10', '9999')
    expect(() => parseEnhanceCosts(rows)).toThrow(/골드/)
  })

  it('한 단계가 같은 아이템을 두 번 적으면 던진다 — 화면이 같은 재료를 두 줄로 그리게 된다', () => {
    const rows = ladder(1, 1)
    rows[5] = row('1', '5', 'hard_log', '10', '40000')
    expect(() => parseEnhanceCosts(rows)).toThrow(/두 번/)
  })

  it('음수 개수·음수 골드는 던진다', () => {
    expect(() => parseEnhanceCosts([row('1', '1', 'hard_log', '-1', '5000')])).toThrow(/count/)
    expect(() => parseEnhanceCosts([row('1', '1', 'hard_log', '1', '-5000')])).toThrow(/gold/)
  })

  it('개수 0·골드 0 은 통과한다 — "재료는 안 먹고 골드만" 같은 단계를 표가 표현할 수 있어야 한다', () => {
    const costs = parseEnhanceCosts([row('1', '1', 'hard_log', '0', '0')])
    expect(costs[0]).toEqual({ toolTier: 1, level: 1, materials: [{ item: 'hard_log', count: 0 }], gold: 0 })
  })
})

describe('validateEnhanceCosts', () => {
  it('온전한 표는 위반이 없다', () => {
    expect(validateEnhanceCosts(dataWith(parseEnhanceCosts(ladder(1, 1))))).toEqual([])
  })

  it('단계가 하나 빠지면 위반이다 — 그 단계에서 강화가 런타임에 멈춘다', () => {
    const rows = ladder(1, 1).filter((r) => r['level'] !== '3')
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/3/)
  })

  it('상한을 넘는 단계는 위반이다 — +6 은 ENHANCE_CAP 상 존재할 수 없는 문이다', () => {
    const rows = [...ladder(1, 1), row('1', '6', 'hard_log', '10', '50000')]
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/6/)
  })

  it('없는 아이템을 가리키면 위반이다', () => {
    const rows = [row('1', '1', 'ghost_ore', '5', '5000'), ...ladder(1, 1).slice(1)]
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations.some((v) => v.includes('ghost_ore'))).toBe(true)
  })

  it('도구를 재료로 적으면 위반이다 — 도구는 스택에 살지 않아 개수로 셀 수 없다', () => {
    const rows = [row('1', '1', 'copper_pickaxe', '5', '5000'), ...ladder(1, 1).slice(1)]
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations.some((v) => v.includes('copper_pickaxe'))).toBe(true)
  })

  it('도구가 쓰는 티어에 표가 없으면 위반이다 — 그 도구는 영원히 강화할 수 없다', () => {
    const data = dataWith(parseEnhanceCosts(ladder(2, 4)))
    const violations = validateEnhanceCosts(data)
    // 1티어 구리 곡괭이가 있는데 표는 2티어 것뿐이다.
    expect(violations.some((v) => v.includes('copper_pickaxe'))).toBe(true)
  })
})

/*
 * 계열 회전(설계 §6-앞 11, 검증 요구는 §6-앞 16) — 이 표의 뼈대다.
 *
 * 위 검사들은 표가 **조립되는가**를 묻는다. 여기 넷은 표가 **원작 UL4 의 그
 * 사다리인가**를 묻는다: +1..+4 가 네 채집 계열을 하나씩 차례로 먹고, +5 가
 * 넷을 한꺼번에 먹는가. 이것이 무너져도 표는 끝까지 온전해 보인다 — 단계는
 * 빠짐없이 있고 아이템도 실재하고 골드도 갈라지지 않는다. 다만 그 도구를
 * 강화하는 사람이 어느 한 계열을 영영 캐지 않게 되고, 그 사라짐은 화면 어디에도
 * 흔적을 남기지 않는다.
 */
describe('validateEnhanceCosts 의 계열 회전', () => {
  it('+1..+4 가 같은 계열을 두 번 먹으면 위반이다 — 회전이 한 계열을 통째로 건너뛴다', () => {
    const rows = ladder(1, 1)
    rows[1] = row('1', '2', 'hard_log', '10', '9000') // +2 도 나무가 된다(원래는 허브)
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('+1')
    expect(violations[0]).toContain('wood')
  })

  it('한 단계가 두 계열을 먹으면 위반이다 — 넷을 한꺼번에 먹는 것은 +5 하나다', () => {
    const rows = [...ladder(1, 1), row('1', '1', 'lavender', '5', '5000')]
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('+1')
  })

  it('+5 가 네 계열을 다 먹지 않으면 위반이다 — 마지막 칸은 회전이 돈 계열의 합이다', () => {
    const rows = ladder(1, 1).filter((r) => !(r['level'] === '5' && r['itemId'] === 'iron_ore'))
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('+5')
    expect(violations[0]).toContain('mineral')
  })

  it('계열이 없는 재료를 먹으면 위반이다 — 어느 계열의 대가인지 정해지지 않는다', () => {
    const rows = ladder(1, 1)
    rows[0] = row('1', '1', 'nameless_dust', '5', '5000')
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations.some((v) => v.includes('nameless_dust'))).toBe(true)
  })

  it('채집 계열이 아닌 재료를 먹으면 위반이다 — 회전이 도는 것은 캐는 네 계열이다', () => {
    const rows = ladder(1, 1)
    rows[0] = row('1', '1', 'craft_scrap', '5', '5000')
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    expect(violations.some((v) => v.includes('craft_scrap'))).toBe(true)
  })

  it('사다리가 온전하지 않은 티어는 회전을 묻지 않는다 — 원인 하나가 위반 둘이 되지 않게', () => {
    const rows = ladder(1, 1).filter((r) => r['level'] !== '4')
    const violations = validateEnhanceCosts(dataWith(parseEnhanceCosts(rows)))
    // "+4 단계가 없다" 하나뿐이다 — mineral 이 회전에서 빠졌다는 파생 위반은 없다.
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('+4')
  })
})
