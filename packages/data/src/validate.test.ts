import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { validateGameData } from './validate.js'

function baseData(): GameData {
  return {
    items: {
      copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
      copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
        toolSkill: 'mining', toolTier: 1, icon: 'pickaxe_copper',
      },
    },
    nodes: {
      copper_vein: {
        id: 'copper_vein', name: '구리 광맥', skill: 'mining', tier: 1, requiredLevel: 1,
        yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3, respawnMs: 5000,
      },
    },
    recipes: {
      copper_ingot: {
        id: 'copper_ingot', name: '구리 주괴', skill: 'smithing', requiredLevel: 1,
        inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', skill: 'smithing', requiredLevel: 3,
        inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'copper_pickaxe', count: 1 },
      },
    },
  }
}

/**
 * 광석(iron_ore)이 등급 2 채집 노드에서만 나오는데, 그 노드를 캘 유일한 방법인
 * 등급 2 도구(iron_pickaxe)가 하필 그 광석으로만 제작되는 순환 — 실제로 출하된
 * CSV 가 갖고 있던 결함을 그대로 축소 재현한 픽스처.
 */
function deadlockedTierData(): GameData {
  return {
    items: {
      copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
      copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
      iron_ore: { id: 'iron_ore', name: '철 원석', kind: 'material', icon: 'ore_iron' },
      iron_ingot: { id: 'iron_ingot', name: '철 주괴', kind: 'material', icon: 'ingot_iron' },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
        toolSkill: 'mining', toolTier: 1, icon: 'pickaxe_copper',
      },
      iron_pickaxe: {
        id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool',
        toolSkill: 'mining', toolTier: 2, icon: 'pickaxe_iron',
      },
    },
    nodes: {
      copper_vein: {
        id: 'copper_vein', name: '구리 광맥', skill: 'mining', tier: 1, requiredLevel: 1,
        yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3, respawnMs: 5000,
      },
      iron_vein: {
        id: 'iron_vein', name: '철 광맥', skill: 'mining', tier: 2, requiredLevel: 10,
        yieldItem: 'iron_ore', yieldMin: 1, yieldMax: 3, respawnMs: 9000,
      },
    },
    recipes: {
      copper_ingot: {
        id: 'copper_ingot', name: '구리 주괴', skill: 'smithing', requiredLevel: 1,
        inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', skill: 'smithing', requiredLevel: 3,
        inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'copper_pickaxe', count: 1 },
      },
      iron_ingot: {
        id: 'iron_ingot', name: '철 주괴', skill: 'smithing', requiredLevel: 10,
        inputs: [{ item: 'iron_ore', count: 2 }], output: { item: 'iron_ingot', count: 1 },
      },
      iron_pickaxe: {
        id: 'iron_pickaxe', name: '철 곡괭이', skill: 'smithing', requiredLevel: 12,
        inputs: [{ item: 'iron_ingot', count: 3 }], output: { item: 'iron_pickaxe', count: 1 },
      },
    },
  }
}

describe('validateGameData', () => {
  it('정상 데이터는 위반이 없다', () => {
    expect(validateGameData(baseData())).toEqual([])
  })

  it('없는 아이템을 산출하는 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.yieldItem = 'ghost_ore'
    expect(validateGameData(data)).toContain(
      'nodes[copper_vein]: 존재하지 않는 아이템 "ghost_ore" 를 산출한다',
    )
  })

  it('없는 아이템을 재료로 쓰는 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.inputs = [{ item: 'ghost_ore', count: 1 }]
    expect(validateGameData(data)).toContain(
      'recipes[copper_ingot]: 존재하지 않는 재료 "ghost_ore" 를 요구한다',
    )
  })

  it('없는 아이템을 산출하는 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.output = { item: 'ghost_bar', count: 1 }
    expect(validateGameData(data)).toContain(
      'recipes[copper_ingot]: 존재하지 않는 아이템 "ghost_bar" 를 산출한다',
    )
  })

  it('yieldMin 이 yieldMax 보다 큰 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.yieldMin = 5
    expect(validateGameData(data)).toContain('nodes[copper_vein]: yieldMin 이 yieldMax 보다 크다')
  })

  it('자기 자신을 재료로 쓰는 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.inputs = [{ item: 'copper_ingot', count: 1 }]
    expect(validateGameData(data)).toContain('recipes[copper_ingot]: 산출물을 자기 재료로 쓴다')
  })

  it('어떤 노드로도 얻을 수 없고 어떤 레시피로도 만들 수 없는 아이템을 잡아낸다', () => {
    const data = baseData()
    data.items.orphan = { id: 'orphan', name: '고아', kind: 'material', icon: 'x' }
    expect(validateGameData(data)).toContain(
      'items[orphan]: 채집으로도 제작으로도 획득할 수 없다',
    )
  })
})

describe('validateGameData 의 도달 가능성 검사', () => {
  it('상위 등급 도구가 자신과 같은 등급의 채집으로만 나오는 재료를 요구하면 순환을 잡아낸다', () => {
    const violations = validateGameData(deadlockedTierData())
    // iron_pickaxe(등급2)는 iron_ingot 으로 제작되고, iron_ingot 은 iron_ore 로 제작되고,
    // iron_ore 는 등급2 채집 노드에서만 나오는데, 그 노드를 캘 유일한 등급2 도구가
    // 바로 iron_pickaxe 자신이다 — 시작 도구(copper_pickaxe, 등급1)로는 아무도
    // 이 순환에 진입할 수 없다.
    expect(violations).toContain(
      'items[iron_pickaxe]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)',
    )
    expect(violations).toContain(
      'items[iron_ore]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)',
    )
    expect(violations).toContain(
      'items[iron_ingot]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)',
    )
  })

  it('시작 도구만으로 도달 가능한 데이터는 위반이 없다', () => {
    expect(validateGameData(baseData())).toEqual([])
  })

  it('실제로 출하되는 CSV 데이터는 도달 가능성 검사를 통과한다', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const csvDir = join(here, '..', 'csv')
    const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))

    const data: GameData = {
      items: parseItems(readRealCsv('items.csv')),
      nodes: parseNodes(readRealCsv('nodes.csv')),
      recipes: parseRecipes(readRealCsv('recipes.csv')),
    }

    expect(validateGameData(data)).toEqual([])
  })
})
