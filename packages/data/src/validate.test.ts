import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DialogueRule, GameData, ItemDef, MilestoneDef, SpeakerDef } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMilestones } from './milestones.js'
import type { MapTerrain } from './placements.js'
import { parsePlacements, parseTerrain } from './placements.js'
import { parseSpeakers } from './speakers.js'
import { parseDialogue } from './dialogueParse.js'
import { collectDialogueNotices, validateGameData, validateSpeakerPlacements } from './validate.js'

/**
 * baseData()의 유일한 채집 기술(mineral)에 필요한 최소 이정표 하나.
 *
 * validateGameData 가 "채집 기술마다 repeat 이정표가 정확히 하나" 를 요구하므로,
 * 이게 없으면 이정표와 무관한 기존 검사를 위한 픽스처들까지 전부 위반이 하나씩
 * 더 생겨 정확한 개수를 기대하는 단언(.toEqual([...]))이 깨진다.
 *
 * threshold 는 임의의 숫자가 아니라 10000 이어야 한다 — validateGameData 가
 * repeat 이정표의 threshold 마다 actionIntervalMs(threshold) === 200 을 요구하므로,
 * 다른 값을 쓰면 이 "정상" 픽스처 자체가 그 검사에 걸려 baseData() 를 재사용하는
 * 여러 .toEqual([]) 단언이 깨진다.
 */
const mineralRepeatMilestone: MilestoneDef = {
  id: 'mineral_repeat', metric: { kind: 'skill', skill: 'mineral' }, threshold: 10000,
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
    // 대화 검사 대상이 없는 픽스처다 — 화자·대사가 비어 있으면 "화자마다
    // 무조건 인사가 있어야 한다" 같은 대화 검사는 순회할 대상이 없어
    // 조용히 통과하고, 이 파일의 나머지(도달 가능성 등) 테스트를 방해하지
    // 않는다.
    speakers: {},
    dialogue: [],
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
    speakers: {},
    dialogue: [],
  }
}

/** dialogue/ 아래 모든 .dlg 파일을 읽어 하나의 배열로 합친다. build.ts 와 같은 방식이다. */
function readRealDialogue(dialogueDir: string): DialogueRule[] {
  const files = readdirSync(dialogueDir).filter((f) => f.endsWith('.dlg'))
  return files.flatMap((f) => parseDialogue(readFileSync(join(dialogueDir, f), 'utf8'), f))
}

/** 실제로 출하되는 CSV·맵·대사를 그대로 파싱한 GameData. 여러 describe 가 공유한다. */
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
    speakers: parseSpeakers(readRealCsv('speakers.csv')),
    dialogue: readRealDialogue(join(here, '..', 'dialogue')),
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
      speakers: {},
      dialogue: [],
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

  it('repeat 이정표의 threshold 가 행동 간격 200ms 지점이 아니면 잡아낸다', () => {
    // 100 은 actionIntervalMs(100) = 350ms 인 지점이라, 자동 반복 해금 문턱(연타로
    // 따라잡을 수 없어지는 200ms 지점)이 아니다.
    const data = baseData()
    data.milestones = [{ ...mineralRepeatMilestone, threshold: 100 }]
    expect(validateGameData(data)).toContain(
      'milestones[mineral_repeat]: threshold(100) 의 행동 간격이 200ms 가 아니라 350ms 다 — 자동 반복 해금 문턱은 연타로 따라잡을 수 없어지는 지점이어야 한다',
    )
  })

  it('실제로 출하되는 CSV 데이터는 이정표 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData())).toEqual([])
  })
})

// ---- 대화 검사 ----
//
// 화자·대사 픽스처는 baseData() 를 베이스로 speakers·dialogue 만 바꾼다 —
// 나머지(아이템·노드·레시피·이정표)는 baseData() 가 이미 위반 0건을 보장하므로,
// 대화 검사 하나만 격리해서 볼 수 있다.

const testSpeaker: SpeakerDef = { id: '노인', name: '노인', kind: 'npc', mapId: 'world', x: 0, y: 0, sprite: 'npc' }

/** 대화 검사 테스트용 DialogueRule 을 짧게 만든다. */
function dRule(overrides: Partial<DialogueRule> & Pick<DialogueRule, 'id' | 'event' | 'conditions'>): DialogueRule {
  return {
    speaker: '노인',
    lines: ['...'],
    source: { file: '노인.dlg', line: 1 },
    ...overrides,
  }
}

/** 조건 없는 인사 규칙 — "무조건 @greet 필수" 검사를 만족시키는 채움용이다. */
function unconditionalGreet(id = 'bare'): DialogueRule {
  return dRule({ id, event: 'greet', conditions: [] })
}

describe('validateGameData 의 대화 검사 — 선언되지 않은 사실', () => {
  it('선언되지 않은 사실 이름을 쓰는 조건을 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'typo', event: 'greet', conditions: [{ fact: 'affinty', op: '=', value: 30 }] }),
    ]
    expect(validateGameData(data)).toContain('dialogue[노인] 노인.dlg:1행: 선언되지 않은 사실 "affinty" 를 쓴다')
  })

  it('실제로 출하되는 대사 데이터는 전부 선언된 사실만 쓴다', () => {
    const violations = validateGameData(loadRealGameData()).filter((v) => v.includes('선언되지 않은 사실'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 무조건 인사', () => {
  it('@greet 무조건 규칙이 없는 화자를 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    // greet 이 전부 조건부라 weather 가 비 오는 상태가 아니면 노인은 할 말이 없다.
    data.dialogue = [dRule({ id: 'rain', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'rain' }] })]
    expect(validateGameData(data)).toContain(
      'dialogue[노인]: @greet 무조건 규칙이 없다 — 말을 걸어도 아무 일도 안 일어날 수 있다',
    )
  })

  it('대사 파일이 아예 없는 화자는 이 검사가 아니라 "대사 파일이 없다" 검사가 알린다', () => {
    // 같은 원인(대사가 없다)을 두 검사가 동시에 보고하면 노이즈만 커진다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = []
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('무조건 규칙이 없다'))).toBe(false)
    expect(violations).toContain('speakers[노인]: 대사 파일이 없다')
  })

  it('실제로 출하되는 화자는 전부 무조건 인사가 있다', () => {
    const violations = validateGameData(loadRealGameData()).filter((v) => v.includes('무조건 규칙이 없다'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 스스로 모순되는 조건', () => {
  // 규칙 하나가 자기 조건끼리 어긋나면 그 규칙은 어떤 세계 상태에서도 나오지
  // 않는다. 형제 규칙과의 관계(더 구체적인 규칙이 있다)와 달리 이건 규칙
  // 하나만 보고 확실히 알 수 있어서, 오탐 없이 "죽은 규칙"이라고 말할 수 있다.

  it('같은 사실에 서로 다른 값을 요구하는 두 등호 조건을 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'twoSeasons',
        event: 'greet',
        conditions: [
          { fact: 'season', op: '=', value: 'spring' },
          { fact: 'season', op: '=', value: 'summer' },
        ],
      }),
    ]
    expect(validateGameData(data)).toContain(
      'dialogue[노인] 노인.dlg:1행: 조건 "season=spring" 과 "season=summer" 가 동시에 참일 수 없다 — 이 규칙은 어떤 상황에서도 나오지 않는다. 조건 하나를 지우거나 규칙을 둘로 나눈다',
    )
  })

  it('겹치는 구석이 없는 크기 범위를 잡아낸다', () => {
    // 100 이상이면서 동시에 50 미만인 값은 없다. 작가가 두 규칙의 조건을
    // 한 규칙에 잘못 합쳤을 때 나오는 모양이다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'emptyRange',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '>=', value: 100 },
          { fact: 'skill.ice', op: '<', value: 50 },
        ],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('"skill.ice>=100" 과 "skill.ice<50" 가 동시에 참일 수 없다'))).toBe(true)
  })

  it('같은 값을 요구하면서 동시에 아니라고 하는 조건을 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'bothWays',
        event: 'greet',
        conditions: [
          { fact: 'quest.촌장', op: '=', value: 3 },
          { fact: 'quest.촌장', op: '!=', value: 3 },
        ],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('"quest.촌장=3" 과 "quest.촌장!=3" 가 동시에 참일 수 없다'))).toBe(true)
  })

  it('등호가 짚은 값이 크기 비교를 만족하지 못하면 잡아낸다', () => {
    // skill.ice 가 정확히 100 인데 200 이상이기도 할 수는 없다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'pinnedOutOfRange',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '=', value: 100 },
          { fact: 'skill.ice', op: '>=', value: 200 },
        ],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('동시에 참일 수 없다'))).toBe(true)
  })

  it('겹치는 범위는 잡지 않는다 — 100 이상 200 미만은 정상적인 구간 표현이다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'range',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '>=', value: 100 },
          { fact: 'skill.ice', op: '<', value: 200 },
        ],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('동시에 참일 수 없다'))).toBe(false)
  })

  it('사실이 다르면 값이 어긋나 보여도 잡지 않는다', () => {
    // season 과 hour 는 서로 다른 값이라 함께 걸리는 것이 정상이다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'twoFacts',
        event: 'greet',
        conditions: [
          { fact: 'season', op: '=', value: 'spring' },
          { fact: 'hour', op: '>=', value: 10 },
        ],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('동시에 참일 수 없다'))).toBe(false)
  })

  it('조건이 다른 규칙의 부분집합인 폴백 규칙은 위반이 아니다', () => {
    // 설계 문서 §5 가 작가에게 보여주는 대표 패턴이다: 조건이 더 많은 규칙은
    // 그 조건이 전부 맞는 순간에만 이기고, 나머지 시간에는 조건이 적은 쪽이
    // 나온다. 부분집합이라는 이유만으로 죽었다고 말하면, 이 시스템이 광고하는
    // "새 상황을 조건으로 얹기"(설계 4.4절) 자체가 막힌다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'rain', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'rain' }] }),
      dRule({
        id: 'rainClose',
        event: 'greet',
        conditions: [
          { fact: 'weather', op: '=', value: 'rain' },
          { fact: 'affinity', op: '>=', value: 30 },
        ],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.filter((v) => v.startsWith('dialogue['))).toEqual([])
  })

  it('실제로 출하되는 대사 데이터는 이 검사를 통과한다', () => {
    const violations = validateGameData(loadRealGameData()).filter((v) => v.includes('동시에 참일 수 없다'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 사건 이름', () => {
  it('EVENT_ORDER 에 없는 사건 이름을 잡아낸다', () => {
    // @greeet 는 파싱도 통과하고 다른 검사도 통과하지만, selectDialogue 는
    // EVENT_ORDER 에 있는 사건만 훑으므로 영원히 선택되지 않는다 — 사실
    // 이름 오타와 완전히 같은 실패이고, @ 는 모든 규칙 머리에 있다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [unconditionalGreet(), dRule({ id: 'typo', event: 'greeet', conditions: [] })]
    expect(validateGameData(data)).toContain(
      'dialogue[노인] 노인.dlg:1행: 알 수 없는 사건 "greeet" — 쓸 수 있는 사건은 story, quest, milestone, greet 이다',
    )
  })

  it('실제로 출하되는 대사 데이터의 사건 이름은 전부 알려진 것이다', () => {
    const violations = validateGameData(loadRealGameData()).filter((v) => v.includes('알 수 없는 사건'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 다른 데이터의 오타에 가려지지 않는다', () => {
  it('참조 무결성 위반이 있어도 대사 위반을 함께 보고한다', () => {
    // 대사 검사가 이른 반환(참조 무결성 위반 시 멈춤) 뒤에 있으면, nodes.csv
    // 오타 하나가 대사 위반 전부를 조용히 덮는다 — 작가는 한 가지를 고치고
    // 다시 빌드해서야 두 번째 파도를 만난다.
    const data = baseData()
    data.nodes.copper_vein!.yieldItem = 'ghost_ore'
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'typo', event: 'greet', conditions: [{ fact: 'affinty', op: '=', value: 30 }] }),
    ]
    const violations = validateGameData(data)
    expect(violations).toContain('nodes[copper_vein]: 존재하지 않는 아이템 "ghost_ore" 를 산출한다')
    expect(violations).toContain('dialogue[노인] 노인.dlg:1행: 선언되지 않은 사실 "affinty" 를 쓴다')
  })

  it('대사 위반이 있어도 도달 가능성 검사는 계속 돈다', () => {
    // 반대 방향도 같다. 이른 반환은 "참조 무결성이 깨지면 도달 가능성 계산이
    // 오염된다"를 막으려고 있는 것인데, 대사 위반에는 그 오염 관계가 없다 —
    // 그것 때문에 건너뛰면 대사 오타 하나가 아이템 데드락을 덮어 똑같이
    // 두 번 빌드하게 만든다.
    const data = deadlockedTierData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'typo', event: 'greet', conditions: [{ fact: 'affinty', op: '=', value: 30 }] }),
    ]
    const violations = validateGameData(data)
    expect(violations).toContain('dialogue[노인] 노인.dlg:1행: 선언되지 않은 사실 "affinty" 를 쓴다')
    expect(violations).toContain('items[iron_pickaxe]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)')
  })
})

describe('validateGameData 의 대화 검사 — 화자·대사 파일 대응', () => {
  it('대사 파일이 없는 화자(배치)를 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = []
    expect(validateGameData(data)).toContain('speakers[노인]: 대사 파일이 없다')
  })

  it('화자가 없는 대사 파일을 잡아낸다', () => {
    const data = baseData()
    data.speakers = {}
    data.dialogue = [unconditionalGreet()]
    expect(validateGameData(data)).toContain('dialogue[노인]: 화자 정의(speakers.csv)가 없다')
  })

  it('실제로 출하되는 데이터는 화자·대사 파일이 서로 대응한다', () => {
    const violations = validateGameData(loadRealGameData()).filter(
      (v) => v.includes('대사 파일이 없다') || v.includes('화자 정의'),
    )
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 없는 이정표·기술 참조', () => {
  it('존재하지 않는 이정표를 가리키는 조건을 잡아낸다', () => {
    const data = baseData() // baseData 의 이정표는 mineral_repeat 하나뿐이다
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'ghost', event: 'milestone', conditions: [{ fact: 'milestone.ice_10000', op: '=', value: true }] }),
    ]
    expect(validateGameData(data)).toContain(
      'dialogue[노인] 노인.dlg:1행: 존재하지 않는 이정표 "ice_10000" 를 가리킨다',
    )
  })

  it('존재하지 않는 기술을 가리키는 조건을 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'ghost', event: 'greet', conditions: [{ fact: 'skill.mining', op: '>=', value: 10 }] }),
    ]
    expect(validateGameData(data)).toContain('dialogue[노인] 노인.dlg:1행: 존재하지 않는 기술 "mining" 를 가리킨다')
  })

  it('justAchieved 가 존재하지 않는 이정표를 가리키면 잡아낸다', () => {
    // milestone.<id> 는 이름에 id 가 들어 있어 이미 검사되지만, justAchieved 는
    // id 를 값으로 부른다 — 오타가 나면 조건 이름은 멀쩡하고 값만 틀려서
    // "이 대사가 왜 안 나오지" 가 된다. 브리프가 노인에게 요구한 형태가 바로 이것이다.
    const data = baseData() // baseData 의 이정표는 mineral_repeat 하나뿐이다
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'ghost',
        event: 'milestone',
        conditions: [{ fact: 'justAchieved', op: '=', value: 'ice_99999' }],
      }),
    ]
    expect(validateGameData(data)).toContain(
      'dialogue[노인] 노인.dlg:1행: justAchieved 가 존재하지 않는 이정표 "ice_99999" 를 가리킨다',
    )
  })

  it('justAchieved 가 존재하는 이정표를 가리키면 통과한다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'real',
        event: 'milestone',
        conditions: [{ fact: 'justAchieved', op: '=', value: 'mineral_repeat' }],
      }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('justAchieved'))).toBe(false)
  })

  it('실제로 출하되는 대사 데이터는 전부 존재하는 이정표·기술만 가리킨다', () => {
    const violations = validateGameData(loadRealGameData()).filter(
      (v) => v.includes('존재하지 않는 이정표') || v.includes('존재하지 않는 기술'),
    )
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — once 사건의 상한 없는 사실', () => {
  // 이 그룹은 Task 1 리뷰가 남긴 지적을 닫는다: onceKey 는 규칙의 조건들이
  // "지금 갖는 값"을 연산자와 무관하게 그대로 엮으므로, once 사건(story·
  // quest·milestone)의 조건이 상한 없이 계속 바뀌는 사실을 값이 고정되지
  // 않는 방식으로 걸면 매번 새 키가 생겨 "한 번만 말한다"가 깨지고 "이미
  // 말했다" 기록이 끝없이 늘어난다. 값을 고정하는 연산자는 = 하나뿐이다.

  it('once 사건 + 상한 없는 사실 + 크기 비교를 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'grind', event: 'quest', conditions: [{ fact: 'skill.ice', op: '>=', value: 1000 }] }),
    ]
    expect(validateGameData(data)).toContain(
      'dialogue[노인] 노인.dlg:1행: once 사건(quest)의 조건 "skill.ice>=1000" 이 상한 없는 사실을 = 아닌 연산자로 건다 — 그 값이 바뀔 때마다 "이미 말했다" 기록이 새로 쌓여 끝없이 늘어난다. 값을 정확히 짚는 = 를 쓰거나 이 규칙을 @greet 으로 옮긴다',
    )
  })

  it('once 사건 + 상한 없는 사실 + != 를 잡아낸다', () => {
    // 크기 비교만 세면 이게 빠진다. onceKey 는 연산자를 보지 않고 조건마다
    // 그 사실의 "지금 값"을 스냅샷하므로, skill.ice!=0 은 숙련도가 1 오를
    // 때마다 새 키를 만든다 — 크기 비교와 똑같은 무한 증식이다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'notZero', event: 'quest', conditions: [{ fact: 'skill.ice', op: '!=', value: 0 }] }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('"skill.ice!=0" 이 상한 없는 사실을 = 아닌 연산자로 건다'))).toBe(true)
  })

  it('once 사건이라도 등호는 괜찮다 — quest.촌장=3 패턴은 계속 동작해야 한다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'chief3', event: 'quest', conditions: [{ fact: 'quest.촌장', op: '=', value: 3 }] }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('상한 없는 사실'))).toBe(false)
  })

  it('상한 없는 사실이라도 등호면 once 사건에서도 괜찮다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'exact', event: 'milestone', conditions: [{ fact: 'skill.ice', op: '=', value: 10000 }] }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('상한 없는 사실'))).toBe(false)
  })

  it('greet 은 once 사건이 아니므로 크기 비교를 걸어도 괜찮다', () => {
    // 채집장노인.dlg 의 실제 규칙(@greet skill.ice>=50000)과 같은 모양이다.
    // greet 은 매번 다시 후보에 오르므로 onceKey 를 아예 안 쓴다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'veteran', event: 'greet', conditions: [{ fact: 'skill.ice', op: '>=', value: 50000 }] }),
    ]
    const violations = validateGameData(data)
    expect(violations.some((v) => v.includes('상한 없는 사실'))).toBe(false)
  })

  it('실제로 출하되는 대사 데이터는 이 검사를 통과한다', () => {
    const violations = validateGameData(loadRealGameData()).filter((v) => v.includes('상한 없는 사실'))
    expect(violations).toEqual([])
  })
})

describe('validateSpeakerPlacements', () => {
  // speakers.csv 는 화자를 타일 좌표로 놓는데, 그 좌표가 맞는지는 맵을 봐야
  // 안다 — 그래서 GameData 만 보는 validateGameData 와 달리 지형을 함께 받는다.
  // 벽 속이나 맵 밖에 놓인 화자는 화면에 나오긴 해도 옆에 설 수 없어 말을
  // 걸 방법이 없다. 노드와 겹치면 그 칸에서 무엇이 반응할지 정해지지 않는다.

  const terrain: MapTerrain = { width: 30, height: 30, walls: new Set(['5,5']) }

  function speakerAt(x: number, y: number): Record<string, SpeakerDef> {
    return { 노인: { ...testSpeaker, x, y } }
  }

  it('맵 밖에 놓인 화자를 잡아낸다', () => {
    const data = baseData()
    data.speakers = speakerAt(30, 3)
    data.placements = {}
    expect(validateSpeakerPlacements(data, terrain)).toContain(
      'speakers[노인]: 맵 밖 칸 (30, 3) 에 놓였다 — 맵은 가로 30, 세로 30 칸이라 x 는 0~29, y 는 0~29 이다',
    )
  })

  it('벽 칸에 놓인 화자를 잡아낸다', () => {
    const data = baseData()
    data.speakers = speakerAt(5, 5)
    data.placements = {}
    expect(validateSpeakerPlacements(data, terrain)).toContain(
      'speakers[노인]: 벽 칸 (5, 5) 에 놓였다 — 벽 속에 서 있는 셈이다. speakers.csv 의 x·y 를 빈 칸으로 옮긴다',
    )
  })

  it('노드와 같은 칸에 놓인 화자를 잡아낸다', () => {
    const data = baseData() // baseData 의 copper_vein-1 은 (0,0) 에 있다
    data.speakers = speakerAt(0, 0)
    expect(validateSpeakerPlacements(data, terrain)).toContain(
      'speakers[노인]: 노드 copper_vein-1 와 같은 칸에 있다: (0, 0) — 그 칸을 향했을 때 어느 쪽이 반응할지 정해지지 않는다',
    )
  })

  it('빈 칸에 놓인 화자는 통과한다', () => {
    const data = baseData()
    data.speakers = speakerAt(10, 10)
    expect(validateSpeakerPlacements(data, terrain)).toEqual([])
  })

  it('실제로 출하되는 화자 배치는 통과한다', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const mapJson: unknown = JSON.parse(readFileSync(join(here, '..', 'maps', 'world.json'), 'utf8'))
    expect(validateSpeakerPlacements(loadRealGameData(), parseTerrain(mapJson))).toEqual([])
  })
})

describe('collectDialogueNotices', () => {
  it('공급자가 없는 사실을 쓴 대사의 줄 수를 안내로 센다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'rain',
        event: 'greet',
        conditions: [{ fact: 'weather', op: '=', value: 'rain' }],
        lines: ['이런 날엔 얼음이 잘 안 잡히지.'],
      }),
    ]
    expect(collectDialogueNotices(data)).toContain('대사 1줄이 weather 를 기다린다')
  })

  it('같은 사실을 쓰는 규칙이 여럿이면 줄 수를 합산한다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'rain1', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'rain' }], lines: ['한 줄'],
      }),
      dRule({
        id: 'rain2', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'snow' }],
        lines: ['두 줄', '세 줄'],
      }),
    ]
    expect(collectDialogueNotices(data)).toContain('대사 3줄이 weather 를 기다린다')
  })

  it('공급자가 있는 사실만 쓰면 안내가 없다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [unconditionalGreet()]
    expect(collectDialogueNotices(data)).toEqual([])
  })

  it('실제로 출하되는 대사 데이터는 weather 대기 안내를 낸다', () => {
    // 채집장노인.dlg 의 "@greet weather=rain" 규칙(대사 1줄)이 근거다 — 날씨
    // 스펙이 아직 없으므로 이 대사는 지금 절대 나오지 않는다.
    const notices = collectDialogueNotices(loadRealGameData())
    expect(notices).toContain('대사 1줄이 weather 를 기다린다')
  })
})
