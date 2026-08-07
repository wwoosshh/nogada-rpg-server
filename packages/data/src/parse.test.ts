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
})

describe('parseNodes', () => {
  it('숫자 필드를 숫자로 변환한다', () => {
    const nodes = parseNodes([
      {
        id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: '1',
        requiredLevel: '1', yieldItem: 'copper_ore', yieldMin: '1', yieldMax: '3', respawnMs: '5000',
      },
    ])
    expect(nodes.copper_vein).toEqual({
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1,
      requiredLevel: 1, yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3, respawnMs: 5000,
    })
  })

  it('알 수 없는 skill 값을 거부한다', () => {
    expect(() =>
      parseNodes([
        {
          id: 'copper_vein', name: '구리 광맥', skill: 'minig', tier: '1',
          requiredLevel: '1', yieldItem: 'copper_ore', yieldMin: '1', yieldMax: '3', respawnMs: '5000',
        },
      ]),
    ).toThrow('nodes.csv[copper_vein]: skill "minig" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })

  function validNodeRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: '1',
      requiredLevel: '1', yieldItem: 'copper_ore', yieldMin: '1', yieldMax: '3', respawnMs: '5000',
      ...overrides,
    }
  }

  it('tier 가 0 이하이면 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ tier: '0' })])).toThrow(
      'nodes.csv[copper_vein]: tier "0" 는 1 이상이어야 한다',
    )
  })

  it('requiredLevel 이 0 이하이면 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ requiredLevel: '0' })])).toThrow(
      'nodes.csv[copper_vein]: requiredLevel "0" 는 1 이상이어야 한다',
    )
  })

  it('yieldMin 이 음수이면 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ yieldMin: '-1' })])).toThrow(
      'nodes.csv[copper_vein]: yieldMin "-1" 는 1 이상이어야 한다',
    )
  })

  it('yieldMax 가 0 이하이면 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ yieldMax: '0' })])).toThrow(
      'nodes.csv[copper_vein]: yieldMax "0" 는 1 이상이어야 한다',
    )
  })

  it('respawnMs 가 0 이하이면 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ respawnMs: '0' })])).toThrow(
      'nodes.csv[copper_vein]: respawnMs "0" 는 1 이상이어야 한다',
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
        id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredLevel: '1',
        inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
      },
    ])
    expect(recipes.copper_ingot!.inputs).toEqual([{ item: 'copper_ore', count: 2 }])
    expect(recipes.copper_ingot!.output).toEqual({ item: 'copper_ingot', count: 1 })
  })

  it('파이프로 구분된 여러 재료를 파싱한다', () => {
    const recipes = parseRecipes([
      {
        id: 'reinforced_plate', name: '강화 판금', skill: 'crafting', requiredLevel: '18',
        inputs: 'copper_ingot:1|iron_ingot:1', outputItem: 'reinforced_plate', outputCount: '1',
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
          id: 'copper_ingot', name: '구리 주괴', skill: 'smithng', requiredLevel: '1',
          inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        },
      ]),
    ).toThrow('recipes.csv[copper_ingot]: skill "smithng" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })

  function validRecipeRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredLevel: '1',
      inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
      ...overrides,
    }
  }

  it('requiredLevel 이 0 이하이면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ requiredLevel: '0' })])).toThrow(
      'recipes.csv[copper_ingot]: requiredLevel "0" 는 1 이상이어야 한다',
    )
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
