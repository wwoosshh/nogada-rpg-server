import { describe, expect, it } from 'vitest'
import type { GameData } from '@nogada/shared'
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
