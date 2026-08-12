import { describe, expect, it } from 'vitest'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'

describe('parseCsv', () => {
  it('헤더를 키로 하는 객체 배열을 만든다', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('빈 줄을 무시한다', () => {
    expect(parseCsv('a\n1\n\n2\n')).toEqual([{ a: '1' }, { a: '2' }])
  })

  it('빈 칸은 빈 문자열이 된다', () => {
    expect(parseCsv('a,b\n1,')).toEqual([{ a: '1', b: '' }])
  })

  it('헤더보다 칸이 많은 행을 거부한다', () => {
    expect(() => parseCsv('a,b\n1,2,3')).toThrow(
      '2행: 칸 개수가 헤더와 다르다 (헤더 2개, 이 행 3개)',
    )
  })

  it('헤더보다 칸이 적은 행을 거부한다', () => {
    expect(() => parseCsv('a,b\n1')).toThrow(
      '2행: 칸 개수가 헤더와 다르다 (헤더 2개, 이 행 1개)',
    )
  })
})

describe('parseItems', () => {
  it('재료는 도구 필드가 없다', () => {
    const items = parseItems([
      { id: 'copper_ore', name: '구리 원석', kind: 'material', toolSkill: '', toolTier: '', icon: 'ore_copper' },
    ])
    expect(items.copper_ore).toEqual({
      id: 'copper_ore',
      name: '구리 원석',
      kind: 'material',
      icon: 'ore_copper',
    })
  })

  it('도구는 숙련 종류와 등급을 갖는다', () => {
    const items = parseItems([
      { id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool', toolSkill: 'mineral', toolTier: '2', icon: 'pickaxe_iron' },
    ])
    expect(items.iron_pickaxe).toEqual({
      id: 'iron_pickaxe',
      name: '철 곡괭이',
      kind: 'tool',
      toolSkill: 'mineral',
      toolTier: 2,
      icon: 'pickaxe_iron',
    })
  })

  it('알 수 없는 toolSkill 값을 거부한다', () => {
    expect(() =>
      parseItems([
        { id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool', toolSkill: 'minig', toolTier: '2', icon: 'pickaxe_iron' },
      ]),
    ).toThrow('items.csv[iron_pickaxe]: skill "minig" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })

  it('toolTier 가 0 이하이면 거부한다', () => {
    expect(() =>
      parseItems([
        { id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool', toolSkill: 'mineral', toolTier: '0', icon: 'pickaxe_iron' },
      ]),
    ).toThrow('items.csv[iron_pickaxe]: toolTier "0" 는 1 이상이어야 한다')
  })

  it('중복된 id 를 거부한다', () => {
    const row = { id: 'copper_ore', name: '구리 원석', kind: 'material', toolSkill: '', toolTier: '', icon: 'ore_copper' }
    expect(() => parseItems([row, row])).toThrow('items.csv: 중복된 id "copper_ore"')
  })

  it('정수형 id 를 거부한다 — Record 키 순서가 JSON 왕복에서 깨진다', () => {
    expect(() =>
      parseItems([{ id: '2', name: '구리 원석', kind: 'material', toolSkill: '', toolTier: '', icon: 'ore_copper' }]),
    ).toThrow('items.csv[2]: id "2" 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다')
  })
})

describe('parseNodes', () => {
  function validNodeRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal',
      ...overrides,
    }
  }

  it('표를 가리키는 노드를 파싱한다 — 산출물·수량·확률은 노드가 아니라 표의 것이다', () => {
    const nodes = parseNodes([validNodeRow()])
    expect(nodes.copper_vein).toEqual({
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal',
    })
  })

  it('알 수 없는 skill 값을 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ skill: 'minig' })])).toThrow(
      'nodes.csv[copper_vein]: skill "minig" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)',
    )
  })

  it('알 수 없는 variant 값을 거부한다 — 마커 색의 출처라 오타가 조용히 기본색이 되면 안 된다', () => {
    expect(() => parseNodes([validNodeRow({ variant: 'depe' })])).toThrow(
      'nodes.csv[copper_vein]: variant "depe" 는 알 수 없다 (허용값: normal, deep)',
    )
  })

  it('tableId 가 비어 있으면 거부한다 — 표 없는 노드는 아무것도 내놓지 못한다', () => {
    expect(() => parseNodes([validNodeRow({ tableId: '' })])).toThrow(
      'nodes.csv[copper_vein]: 필수 항목 "tableId" 가 비어 있다',
    )
  })

  it('중복된 id 를 거부한다', () => {
    expect(() => parseNodes([validNodeRow(), validNodeRow()])).toThrow(
      'nodes.csv: 중복된 id "copper_vein"',
    )
  })
})

describe('parseRecipes', () => {
  it('재료 하나를 파싱한다', () => {
    const recipes = parseRecipes([
      {
        id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: '1', baseChance: '0.6',
        inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        skillGainMin: '10', skillGainMax: '20',
      },
    ])
    expect(recipes.copper_ingot!.inputs).toEqual([{ item: 'copper_ore', count: 2 }])
    expect(recipes.copper_ingot!.output).toEqual({ item: 'copper_ingot', count: 1 })
    expect(recipes.copper_ingot!.category).toBe('제련')
  })

  it('파이프로 구분된 여러 재료를 파싱한다', () => {
    const recipes = parseRecipes([
      {
        id: 'reinforced_plate', name: '강화 판금', category: '도구', skill: 'crafting', requiredSkill: '18', baseChance: '0.5',
        inputs: 'copper_ingot:1|iron_ingot:1', outputItem: 'reinforced_plate', outputCount: '1',
        skillGainMin: '10', skillGainMax: '20',
      },
    ])
    expect(recipes.reinforced_plate!.inputs).toEqual([
      { item: 'copper_ingot', count: 1 },
      { item: 'iron_ingot', count: 1 },
    ])
  })

  it('알 수 없는 skill 값을 거부한다', () => {
    expect(() =>
      parseRecipes([
        {
          id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'smithng', requiredSkill: '1', baseChance: '0.6',
          inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        },
      ]),
    ).toThrow('recipes.csv[copper_ingot]: skill "smithng" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })

  function validRecipeRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: '1', baseChance: '0.6',
      inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
      skillGainMin: '10', skillGainMax: '20',
      ...overrides,
    }
  }

  it('category 칸이 없으면 거부한다', () => {
    const row = validRecipeRow()
    delete row.category
    expect(() => parseRecipes([row])).toThrow('recipes.csv[copper_ingot]: 필수 항목 "category" 가 비어 있다')
  })

  it('공백만 있는 category 셀을 거부한다 — trim 후에도 비어 있으면 안 된다', () => {
    expect(() => parseRecipes([validRecipeRow({ category: ' ' })])).toThrow(
      'recipes.csv[copper_ingot]: category 가 공백뿐이다 — 분류 이름을 채워야 한다',
    )
  })

  it('정수형 id 를 거부한다 — Record 키 순서가 JSON 왕복에서 깨진다', () => {
    expect(() => parseRecipes([validRecipeRow({ id: '2' })])).toThrow(
      'recipes.csv[2]: id "2" 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다',
    )
  })

  it('requiredSkill 은 0 을 허용한다', () => {
    const recipes = parseRecipes([
      {
        id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: '0',
        baseChance: '0.6', inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        skillGainMin: '10', skillGainMax: '20',
      },
    ])
    expect(recipes.copper_ingot!.requiredSkill).toBe(0)
  })

  it('outputCount 가 0 이하이면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ outputCount: '0' })])).toThrow(
      'recipes.csv[copper_ingot]: outputCount "0" 는 1 이상이어야 한다',
    )
  })

  it('재료 개수가 0 이하이면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ inputs: 'copper_ore:0' })])).toThrow(
      'recipes.csv[copper_ingot]: inputs(copper_ore) "0" 는 1 이상이어야 한다',
    )
  })

  it('중복된 id 를 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow(), validRecipeRow()])).toThrow(
      'recipes.csv: 중복된 id "copper_ingot"',
    )
  })
})
