import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GameData, ItemDef, MilestoneDef } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMilestones } from './milestones.js'
import { parsePlacements } from './placements.js'
import { validateGameData } from './validate.js'

/**
 * baseData()의 유일한 채집 기술(mineral)에 필요한 최소 이정표 하나.
 *
 * validateGameData 가 "채집 기술마다 repeat 이정표가 정확히 하나" 를 요구하므로,
 * 이게 없으면 이정표와 무관한 기존 검사를 위한 픽스처들까지 전부 위반이 하나씩
 * 더 생겨 정확한 개수를 기대하는 단언(.toEqual([...]))이 깨진다.
 */
const mineralRepeatMilestone: MilestoneDef = {
  id: 'mineral_repeat', metric: { kind: 'skill', skill: 'mineral' }, threshold: 100,
  name: '광물이 손에 익다', announce: '', effect: { kind: 'repeat', skill: 'mineral' },
}

/**
 * 시작 도구 4종(채집 기술별 1등급 도구) 전부를 포함해야 한다 — STARTING_TOOL_IDS 검사와
 * 획득 가능성 검사가 이 넷 모두를 항상 확인하므로, 하나라도 빠지면 그 자체로 위반이
 * 생겨 이 픽스처를 재사용하는 "정상 데이터" 전제가 깨진다.
 */
function baseData(): GameData {
  return {
    items: {
      copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
      copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
      copper_chisel: {
        id: 'copper_chisel', name: '구리 정', kind: 'tool',
        toolSkill: 'ice', toolTier: 1, icon: 'pickaxe_copper',
      },
      copper_axe: {
        id: 'copper_axe', name: '구리 도끼', kind: 'tool',
        toolSkill: 'wood', toolTier: 1, icon: 'pickaxe_copper',
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
        toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
      },
      copper_sickle: {
        id: 'copper_sickle', name: '구리 낫', kind: 'tool',
        toolSkill: 'herb', toolTier: 1, icon: 'pickaxe_copper',
      },
    },
    nodes: {
      copper_vein: {
        id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1, baseChance: 0.5,
        yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3,
        skillGainMin: 1, skillGainMax: 2,
      },
    },
    recipes: {
      copper_ingot: {
        id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
        inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', skill: 'crafting', requiredSkill: 3, baseChance: 0.6,
        inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'copper_pickaxe', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
    },
    placements: {
      'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 0, y: 0 },
    },
    milestones: [mineralRepeatMilestone],
  }
}

/**
 * 광석(iron_ore)이 등급 2 채집 노드에서만 나오는데, 그 노드를 캘 유일한 방법인
 * 등급 2 도구(iron_pickaxe)가 하필 그 광석으로만 제작되는 순환 — 계획서 초안의
 * CSV 설계가 갖고 있던 결함을 그대로 축소 재현한 픽스처. 실제로 출하된 CSV는
 * iron_pickaxe 를 구리만으로 제작해 이 데드락을 피해 간다.
 *
 * copper_chisel·copper_axe·copper_sickle 은 이 데드락과 무관하지만, STARTING_TOOL_IDS
 * 검사가 넷 모두의 존재를 요구하므로 빠지면 그 자체로 위반이 생겨 참조 무결성
 * 검사에서 조기 반환되고 만다 — 그러면 이 테스트가 실제로 보려는 도달 가능성
 * 위반이 계산되지 않는다. 같은 이유로 copper_ingot 의 requiredSkill 도 0 이다 —
 * 부트스트랩 검사 위반까지 섞이면 똑같이 조기 반환되어 도달 가능성 위반을 가린다.
 */
function deadlockedTierData(): GameData {
  return {
    items: {
      copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
      copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
      iron_ore: { id: 'iron_ore', name: '철 원석', kind: 'material', icon: 'ore_iron' },
      iron_ingot: { id: 'iron_ingot', name: '철 주괴', kind: 'material', icon: 'ingot_iron' },
      copper_chisel: {
        id: 'copper_chisel', name: '구리 정', kind: 'tool',
        toolSkill: 'ice', toolTier: 1, icon: 'pickaxe_copper',
      },
      copper_axe: {
        id: 'copper_axe', name: '구리 도끼', kind: 'tool',
        toolSkill: 'wood', toolTier: 1, icon: 'pickaxe_copper',
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
        toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
      },
      copper_sickle: {
        id: 'copper_sickle', name: '구리 낫', kind: 'tool',
        toolSkill: 'herb', toolTier: 1, icon: 'pickaxe_copper',
      },
      iron_pickaxe: {
        id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool',
        toolSkill: 'mineral', toolTier: 2, icon: 'pickaxe_iron',
      },
    },
    nodes: {
      copper_vein: {
        id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1, baseChance: 0.5,
        yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3,
        skillGainMin: 1, skillGainMax: 2,
      },
      iron_vein: {
        id: 'iron_vein', name: '철 광맥', skill: 'mineral', tier: 2, baseChance: 0.4,
        yieldItem: 'iron_ore', yieldMin: 1, yieldMax: 3,
        skillGainMin: 1, skillGainMax: 2,
      },
    },
    recipes: {
      copper_ingot: {
        id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
        inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', skill: 'crafting', requiredSkill: 3, baseChance: 0.6,
        inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'copper_pickaxe', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
      iron_ingot: {
        id: 'iron_ingot', name: '철 주괴', skill: 'crafting', requiredSkill: 10, baseChance: 0.5,
        inputs: [{ item: 'iron_ore', count: 2 }], output: { item: 'iron_ingot', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
      iron_pickaxe: {
        id: 'iron_pickaxe', name: '철 곡괭이', skill: 'crafting', requiredSkill: 12, baseChance: 0.5,
        inputs: [{ item: 'iron_ingot', count: 3 }], output: { item: 'iron_pickaxe', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
    },
    placements: {
      'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 0, y: 0 },
      'iron_vein-1': { instanceId: 'iron_vein-1', nodeId: 'iron_vein', x: 1, y: 0 },
    },
    milestones: [],
  }
}

/** 실제로 출하되는 CSV·맵을 그대로 파싱한 GameData. 여러 describe 가 공유한다. */
function loadRealGameData(): GameData {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))
  const nodes = parseNodes(readRealCsv('nodes.csv'))
  const recipes = parseRecipes(readRealCsv('recipes.csv'))
  const mapJson: unknown = JSON.parse(readFileSync(join(here, '..', 'maps', 'world.json'), 'utf8'))

  return {
    items: parseItems(readRealCsv('items.csv')),
    nodes,
    recipes,
    placements: parsePlacements(mapJson, nodes),
    milestones: parseMilestones(readRealCsv('milestones.csv'), nodes, recipes),
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

  it('baseChance 가 1 을 넘는 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.baseChance = 1.5
    expect(validateGameData(data)).toContain('nodes[copper_vein]: baseChance 가 0 초과 1 미만이 아니다')
  })

  // 설계 문서 §6.4: baseChance 는 0 초과 "1 미만" 이다. 1 이면 숙련도와 무관하게 항상
  // 성공하는 판정이 되어, 판정이 살아 있게 한다는 성공률 하한(MIN_SUCCESS_CHANCE)의
  // 취지와 어긋난다.
  it('baseChance 가 정확히 1 인 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.baseChance = 1
    expect(validateGameData(data)).toContain('nodes[copper_vein]: baseChance 가 0 초과 1 미만이 아니다')
  })

  it('skillGainMin 이 skillGainMax 보다 큰 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.skillGainMin = 5
    expect(validateGameData(data)).toContain('nodes[copper_vein]: skillGainMin 이 skillGainMax 보다 크다')
  })

  it('baseChance 가 0 초과 1 미만이 아닌 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.baseChance = 1
    expect(validateGameData(data)).toContain('recipes[copper_ingot]: baseChance 가 0 초과 1 미만이 아니다')
  })

  it('skillGainMin 이 skillGainMax 보다 큰 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.skillGainMin = 25
    expect(validateGameData(data)).toContain('recipes[copper_ingot]: skillGainMin 이 skillGainMax 보다 크다')
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

  it('시작 도구는 채집·제작 경로가 없어도 획득 가능한 것으로 본다', () => {
    // copper_chisel 은 baseData() 안에서 어떤 노드의 산출물도, 어떤 레시피의 산출물도
    // 아니다 — STARTING_TOOL_IDS 로 캐릭터 생성 시 바로 지급되는 것이 유일한 출처다.
    // 이 시드가 없으면 매번 "채집으로도 제작으로도 획득할 수 없다"로 오탐된다.
    expect(validateGameData(baseData())).not.toContain(
      'items[copper_chisel]: 채집으로도 제작으로도 획득할 수 없다',
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

  // '정상 데이터는 위반이 없다' (위 baseData 스위트)와 동일한 단언이라 여기서는 생략한다 —
  // baseData 는 시작 도구만으로 전부 도달 가능하므로 그 테스트가 이미 이 사실을 검증한다.

  it('실제로 출하되는 CSV 데이터는 도달 가능성 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData())).toEqual([])
  })
})

describe('validateGameData 의 배치 검사', () => {
  it('노드 종류가 맵 어디에도 놓이지 않으면 잡아낸다', () => {
    const data = baseData()
    // baseData() 의 유일한 노드(copper_vein)를 어느 칸에도 놓지 않은 상태로 만든다.
    // CSV 에는 있지만 맵에는 없는 노드라, 플레이어가 닿을 방법이 없다.
    data.placements = {}

    expect(validateGameData(data)).toContain('nodes[copper_vein]: 맵 어디에도 놓이지 않았다')
  })

  it('실제로 출하되는 CSV 데이터는 노드마다 맵에 최소 한 번 놓여 있다', () => {
    const violations = validateGameData(loadRealGameData()).filter((v) => v.includes('맵 어디에도 놓이지 않았다'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 조합 부트스트랩 검사', () => {
  it('스킬의 모든 레시피가 requiredSkill 0 초과면 그 스킬은 영원히 부트스트랩할 수 없다고 잡아낸다', () => {
    const data = baseData()
    // crafting 스킬의 두 레시피 중 requiredSkill 0 이던 copper_ingot 마저 1로 올린다.
    // 조합 숙련도는 레시피 성공 경로(craftService)에서만 오르고 그 경로 자체가
    // requiredSkill 게이트(canCraft) 뒤에 있으므로, crafting 레시피 전부가 1 이상을
    // 요구하면 숙련도 0에서 시작하는 플레이어는 어떤 레시피도 영원히 열 수 없다.
    data.recipes.copper_ingot!.requiredSkill = 1

    expect(validateGameData(data)).toContain(
      'skills[crafting]: requiredSkill 0 인 레시피가 없어 영원히 부트스트랩할 수 없다',
    )
  })

  it('실제로 출하되는 CSV 데이터는 스킬마다 requiredSkill 0 인 레시피를 갖고 있다', () => {
    // skills[...] 접두사는 이 검사와 "채집 기술마다 repeat 이정표가 정확히 하나"
    // 검사가 공유한다 — 부트스트랩만 걸러 보려면 메시지 내용까지 좁혀야 한다.
    const violations = validateGameData(loadRealGameData()).filter(
      (v) => v.startsWith('skills[') && v.includes('부트스트랩'),
    )
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 조기 반환', () => {
  it('참조 무결성 위반이 있으면 도달 가능성 검사를 건너뛰어 연쇄 보고를 막는다', () => {
    const data = baseData()
    // copper_ingot 레시피의 재료를 오타로 망가뜨린다. 고치지 않으면 copper_ingot 과
    // 그걸 재료로 쓰는 copper_pickaxe 까지 도달 불가로 잡혀 오타 하나가 3줄이 된다.
    data.recipes.copper_ingot!.inputs = [{ item: 'ghost_ore', count: 1 }]

    expect(validateGameData(data)).toEqual([
      'recipes[copper_ingot]: 존재하지 않는 재료 "ghost_ore" 를 요구한다',
    ])
  })

  it('STARTING_TOOL_IDS 항목이 가리키는 아이템이 없으면 그 사실 하나만 보고한다', () => {
    // CSV에서 copper_pickaxe 를 renamed_pickaxe 로 참조까지 전부 일관되게 개명했지만
    // 코드의 STARTING_TOOL_IDS 상수(copper_pickaxe)는 갱신을 놓친 상황을 재현한다.
    // 고치지 않으면 시드가 빈 채로 도달 가능성 계산이 돌아 데이터의 모든 아이템이
    // "도달 불가"로 잡힌다. 나머지 시작 도구 셋(chisel·axe·sickle)은 정상이라
    // 노이즈 없이 이 위반 하나만 나와야 한다. copper_ingot 의 requiredSkill 이 0 인
    // 것도 같은 이유다 — 1 이면 crafting 스킬에 부트스트랩 레시피가 없어져 그
    // 위반까지 섞인다. milestones 에 mineral 의 repeat 이정표를 둔 것도 같은 이유다 —
    // 없으면 이 데이터의 유일한 채집 기술(mineral)이 repeat 이정표 없음 위반을 더한다.
    const data: GameData = {
      items: {
        copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
        copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
        copper_chisel: {
          id: 'copper_chisel', name: '구리 정', kind: 'tool',
          toolSkill: 'ice', toolTier: 1, icon: 'pickaxe_copper',
        },
        copper_axe: {
          id: 'copper_axe', name: '구리 도끼', kind: 'tool',
          toolSkill: 'wood', toolTier: 1, icon: 'pickaxe_copper',
        },
        copper_sickle: {
          id: 'copper_sickle', name: '구리 낫', kind: 'tool',
          toolSkill: 'herb', toolTier: 1, icon: 'pickaxe_copper',
        },
        renamed_pickaxe: {
          id: 'renamed_pickaxe', name: '개명된 곡괭이', kind: 'tool',
          toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
        },
      },
      nodes: {
        copper_vein: {
          id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1, baseChance: 0.5,
          yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3,
          skillGainMin: 1, skillGainMax: 2,
        },
      },
      recipes: {
        copper_ingot: {
          id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
          inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
          skillGainMin: 10, skillGainMax: 20,
        },
        renamed_pickaxe: {
          id: 'renamed_pickaxe', name: '개명된 곡괭이', skill: 'crafting', requiredSkill: 3, baseChance: 0.6,
          inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'renamed_pickaxe', count: 1 },
          skillGainMin: 10, skillGainMax: 20,
        },
      },
      placements: {
        'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 0, y: 0 },
      },
      milestones: [mineralRepeatMilestone],
    }

    expect(validateGameData(data)).toEqual([
      'STARTING_TOOL_IDS: 존재하지 않는 아이템 "copper_pickaxe" 를 가리킨다',
    ])
  })

  it('STARTING_TOOL_IDS 항목이 도구가 아니면 그 사실 하나만 보고한다', () => {
    const data = baseData()
    // copper_pickaxe 를 material 로 바꾼다. output/재료 참조는 여전히 유효하므로
    // (recipes.copper_pickaxe 는 그대로 이 id 를 산출한다) 다른 참조 무결성 위반은
    // 섞이지 않고 "도구가 아니다" 검사 하나만 측정한다.
    const notATool: ItemDef = { id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'material', icon: 'pickaxe_copper' }
    data.items.copper_pickaxe = notATool

    expect(validateGameData(data)).toEqual(['STARTING_TOOL_IDS: "copper_pickaxe" 는 도구가 아니다'])
  })
})

describe('validateGameData 의 이정표 검사', () => {
  it('every 이정표가 없는 id 를 가리키면 잡아낸다', () => {
    // 이정표는 게이트를 선언할 뿐이므로 합산 대상도 실재해야 한다 — 안 그러면
    // metricValue(packages/shared)가 그 참조를 조용히 무시하고 영원히 못 세는
    // 합산 이정표가 목록에 남는다.
    const data = baseData()
    data.milestones = [
      {
        id: 'every_ghost', metric: { kind: 'every', of: ['nope'] }, threshold: 1,
        name: '고스트', announce: '', effect: { kind: 'title' },
      },
    ]
    expect(validateGameData(data)).toContain(
      'milestones[every_ghost]: 존재하지 않는 이정표 "nope" 를 가리킨다',
    )
  })

  it('every 이정표 둘이 서로를 가리키면(순환, 깊이 2) 잡아낸다', () => {
    // isAchieved 가 metricValue 를 부르고 metricValue 가 every 의 각 원소에 대해
    // 다시 isAchieved 를 부른다(packages/shared/src/milestones.ts) — 방문 집합이
    // 없으므로 A→B→A 순환은 그 재귀를 무한히 되풀이해 스택을 터뜨린다. 이 테스트가
    // 타임아웃이나 크래시 없이 끝난다는 사실 자체가 검사가 순환을 따라가다 멈춘다는
    // 증거다.
    const data = baseData()
    data.milestones = [
      { id: 'a', metric: { kind: 'every', of: ['b'] }, threshold: 1, name: 'A', announce: '', effect: { kind: 'title' } },
      { id: 'b', metric: { kind: 'every', of: ['a'] }, threshold: 1, name: 'B', announce: '', effect: { kind: 'title' } },
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('순환'))).toBe(true)
  })

  it('every 이정표 셋이 순환하면(A→B→C→A, 깊이 3) 잡아낸다', () => {
    // 한 단계만 보는 검사(예: "내 of 안에 내 id 가 있는가")는 깊이 2 테스트도
    // 통과시키지 못하지만, "내 of 가 가리키는 것의 of 안에 내가 있는가" 처럼 딱
    // 두 단계만 보는 검사라면 깊이 2는 통과해도 이 깊이 3 은 그냥 지나친다.
    // findEveryCycle 은 고정 깊이가 아니라 방문 집합을 쓴 DFS라 깊이와 무관하게 잡는다.
    const data = baseData()
    data.milestones = [
      { id: 'a', metric: { kind: 'every', of: ['b'] }, threshold: 1, name: 'A', announce: '', effect: { kind: 'title' } },
      { id: 'b', metric: { kind: 'every', of: ['c'] }, threshold: 1, name: 'B', announce: '', effect: { kind: 'title' } },
      { id: 'c', metric: { kind: 'every', of: ['a'] }, threshold: 1, name: 'C', announce: '', effect: { kind: 'title' } },
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('순환'))).toBe(true)
  })

  it('every 이정표가 자기 자신을 가리키면(길이 1인 순환) 잡아낸다', () => {
    const data = baseData()
    data.milestones = [
      { id: 'a', metric: { kind: 'every', of: ['a'] }, threshold: 1, name: 'A', announce: '', effect: { kind: 'title' } },
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('순환'))).toBe(true)
  })

  it('every 이정표 여럿이 같은 대상을 가리켜도(다이아몬드) 순환으로 오판하지 않는다', () => {
    // a와 b 둘 다 c를 가리키는 것은 순환이 아니다 — "같은 것을 두 번 방문"과
    // "자신에게 되돌아옴"을 구분 못 하면 이 정상 데이터가 오탐된다.
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      { id: 'c', metric: { kind: 'skill' as const, skill: 'wood' as const }, threshold: 10, name: 'C', announce: '', effect: { kind: 'title' } },
      { id: 'a', metric: { kind: 'every', of: ['c'] }, threshold: 1, name: 'A', announce: '', effect: { kind: 'title' } },
      { id: 'b', metric: { kind: 'every', of: ['c'] }, threshold: 1, name: 'B', announce: '', effect: { kind: 'title' } },
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('순환'))).toBe(false)
  })

  it('every 의 threshold 가 of 길이보다 크면 잡아낸다', () => {
    // of 가 하나뿐인데 threshold 가 2 면, 그 이정표는 무엇을 달성해도 절대
    // threshold 에 닿지 못한다 — 영원히 달성 불가능한 줄이 목록에 남는다.
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'impossible', metric: { kind: 'every', of: ['mineral_repeat'] }, threshold: 2,
        name: '불가능', announce: '', effect: { kind: 'title' },
      },
    ]
    expect(validateGameData(data)).toContain(
      'milestones[impossible]: threshold(2) 가 of 길이(1) 보다 크다 — 영원히 달성할 수 없다',
    )
  })

  it('recipes 효과의 threshold 가 실제 레시피 requiredSkill 과 다르면 잡아낸다', () => {
    // baseData() 의 copper_pickaxe 레시피는 requiredSkill 3 인데, 이 이정표는 999 를
    // 넘어야 열린다고 선언한다 — 목록이 플레이어에게 거짓 문턱을 보여주는 상황이다.
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'wrong_threshold', metric: { kind: 'skill', skill: 'crafting' }, threshold: 999,
        name: '틀린 문턱', announce: '', effect: { kind: 'recipes', ids: ['copper_pickaxe'] },
      },
    ]
    expect(validateGameData(data)).toContain(
      'milestones[wrong_threshold]: 레시피 "copper_pickaxe" 의 requiredSkill(3) 이 이정표 threshold(999) 와 다르다',
    )
  })

  it('recipes 효과의 threshold 가 레시피 requiredSkill 과 같으면 위반이 없다', () => {
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'right_threshold', metric: { kind: 'skill', skill: 'crafting' }, threshold: 3,
        name: '맞는 문턱', announce: '', effect: { kind: 'recipes', ids: ['copper_pickaxe'] },
      },
    ]
    expect(validateGameData(data)).toEqual([])
  })

  it('채집 기술에 repeat 이정표가 없으면 잡아낸다', () => {
    const data = baseData()
    data.milestones = [] // mineral 채집 기술(baseData 의 유일한 노드가 쓰는 기술)의 repeat 이정표가 없다
    expect(validateGameData(data)).toContain(
      'skills[mineral]: repeat 이정표가 정확히 1개여야 하는데 [](0개)다',
    )
  })

  it('채집 기술에 repeat 이정표가 여러 개면 잡아낸다', () => {
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'mineral_repeat_2', metric: { kind: 'skill', skill: 'mineral' }, threshold: 200,
        name: '광물이 손에 또 익다', announce: '', effect: { kind: 'repeat', skill: 'mineral' },
      },
    ]
    expect(validateGameData(data)).toContain(
      'skills[mineral]: repeat 이정표가 정확히 1개여야 하는데 [mineral_repeat,mineral_repeat_2](2개)다',
    )
  })

  it('실제로 출하되는 CSV 데이터는 이정표 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData())).toEqual([])
  })
})
