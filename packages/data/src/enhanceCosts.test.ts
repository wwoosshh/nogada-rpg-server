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
    items: {
      hard_log: testItem('hard_log', { name: '단단한 통나무', price: 400, skill: 'wood' }),
      lavender: testItem('lavender', { name: '라벤더', price: 130, skill: 'herb' }),
      pure_ice: testItem('pure_ice', { name: '맑은 얼음', price: 150, skill: 'ice' }),
      iron_ore: testItem('iron_ore', { name: '철 원석', price: 100, skill: 'mineral' }),
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
