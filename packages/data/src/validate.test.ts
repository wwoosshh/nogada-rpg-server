import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { DialogueRule, GameData, GatherTables, MilestoneDef, MonsterDropTables, ShopDef, SpeakerDef } from '@nogada/shared'
import { NODE_VARIANTS, isSellTarget, sellPrice } from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMasters, parseShops } from './shops.js'
import { parseCollection } from './collection.js'
import { parseEnhanceCosts } from './enhanceCosts.js'
import { parseGatherTables, suffixOfVariant } from './gatherTables.js'
import type { ParsedMaps } from './maps.js'
import { parseMaps } from './maps.js'
import { parseMilestones } from './milestones.js'
import type { MapTerrain } from './placements.js'
import { parseSpeakers } from './speakers.js'
import { parseTransitions } from './transitions.js'
import { parseDialogue } from './dialogueParse.js'
import {
  collectDialogueNotices,
  validateGameData,
  validateMapSpawns,
  validateSpeakerPlacements,
} from './validate.js'

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
 * baseData() 의 copper_hammer 레시피(requiredSkill 3)를 싣는 recipes-이정표.
 *
 * "requiredSkill > 0 인 레시피는 정확히 하나의 recipes-이정표에 실린다"(설계
 * §7-앞 5) 검사가 생기면서, 이게 없으면 이정표와 무관한 픽스처들까지 전부
 * 위반이 하나씩 더 생겨 정확한 개수를 기대하는 단언이 깨진다 —
 * mineralRepeatMilestone 과 같은 이유의 채움용이다.
 *
 * 요구치 있는 레시피가 곡괭이가 아니라 **망치**인 이유: 곡괭이는 채집 기술
 * (mineral)의 시작 도구라 requiredSkill 0 레시피를 가져야 한다(§6-앞 8 의
 * 유도 검사). 망치는 crafting 도구이고 crafting 은 노드가 없어 그 검사 밖이다.
 */
const hammerRecipesMilestone: MilestoneDef = {
  id: 'crafting_3', metric: { kind: 'skill', skill: 'crafting' }, threshold: 3,
  name: '망치를 만들 수 있다', announce: '', effect: { kind: 'recipes', ids: ['copper_hammer'] },
}

/**
 * baseData() 의 유일한 노드(copper_vein)가 가리키는 최소 확률표.
 *
 * validateGameData 가 표를 두 번째 인자로 받게 되면서(도달 가능성이 "노드 →
 * 표 → 아이템" 사슬을 읽는다) 모든 호출부가 표를 함께 넘긴다. 티어 하나·∞
 * 브라켓 하나 — 도달 가능성 계산이 요구하는 최소 형태다.
 */
function baseTables(): GatherTables {
  return {
    mineral: {
      id: 'mineral', skill: 'mineral', skillGainMin: 1, skillGainMax: 2, equity: true,
      tiers: [{ itemId: 'copper_ore' }],
      brackets: [{ bracketMax: null, cumulative: [60000] }],
    },
  }
}

/**
 * 유일한 채집 기술(mineral)의 시작 도구 유도(§6-앞 8)까지 통과하는 최소 데이터다:
 * 1티어 광물 도구(copper_pickaxe)가 **정확히 하나** 있고 requiredSkill 0 레시피를
 * 가진다. copper_hammer(1티어 crafting 도구)는 그 검사 대상이 아니면서(crafting
 * 은 노드가 없다) requiredSkill 3 레시피라, recipes-이정표 검사들의 픽스처
 * 역할을 한다. 구 시작 도구 4종(STARTING_TOOL_IDS)은 상수와 함께 은퇴했다 —
 * 이제 도달 가능성의 시드는 도구가 아니라 맵에 놓인 노드다.
 */
function baseData(): GameData {
  return {
    monsters: {}, monsterPlacements: {},
    items: {
      // 값은 출하 items.csv 의 그것이다 — 돈복사 금지 검사(산출 매도 ≤ 입력 매도합)가
      // 이 픽스처의 구리 레시피를 그대로 보므로, 임의의 숫자를 넣으면 정상 픽스처가
      // 그 검사에 걸려 이 파일의 여러 .toEqual([]) 단언이 무너진다.
      copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
      copper_ingot: testItem('copper_ingot', { name: '구리 주괴', icon: 'ingot_copper', price: 100, skill: 'mineral' }),
      copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' }),
      copper_hammer: testTool('copper_hammer', 'crafting', 1, { name: '구리 망치', icon: 'hammer_copper' }),
    },
    nodes: {
      copper_vein: {
        id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal', sprite: 'copper_vein',
      },
    },
    recipes: {
      copper_ingot: {
        id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
        inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
      copper_pickaxe: {
        id: 'copper_pickaxe', name: '구리 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
        inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'copper_pickaxe', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
      copper_hammer: {
        id: 'copper_hammer', name: '구리 망치', category: '도구', skill: 'crafting', requiredSkill: 3, baseChance: 0.6,
        inputs: [{ item: 'copper_ingot', count: 2 }], output: { item: 'copper_hammer', count: 1 },
        skillGainMin: 10, skillGainMax: 20,
      },
    },
    // 화자(testSpeaker)와 배치가 가리키는 맵이 등록부에 있어야 한다 — 없으면
    // "없는 맵에 놓였다" 위반이 하나 더 생겨, 이 픽스처를 재사용하는 여러
    // .toEqual([]) 단언이 그것 때문에 깨진다.
    maps: { world: { id: 'world', name: '얼음 채집장', file: 'world.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } } },
    // 전환 검사는 validateTransitions 의 몫이라 이 파일의 픽스처는 비워 둔다.
    transitions: [],
    placements: {
      'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', mapId: 'world', x: 0, y: 0 },
    },
    milestones: [mineralRepeatMilestone, hammerRecipesMilestone],
    // 대화 검사 대상이 없는 픽스처다 — 화자·대사가 비어 있으면 "화자마다
    // 무조건 인사가 있어야 한다" 같은 대화 검사는 순회할 대상이 없어
    // 조용히 통과하고, 이 파일의 나머지(도달 가능성 등) 테스트를 방해하지
    // 않는다.
    speakers: {},
    // 상점·달인이 없는 픽스처다 — 등록부가 비어 있으면 그 검사들은 순회할
    // 대상이 없어 조용히 통과하고, 나머지 테스트를 방해하지 않는다. 죽은 아이템
    // 검사도 여기 아이템 전부가 레시피 재료이거나 도구라 상점 없이 통과한다.
    shops: {}, masters: [], enhanceCosts: [], collection: {},
    places: {}, schedules: {}, routes: [],
    dialogue: [],
  }
}

/**
 * 서로만 먹이는 제작 순환 — 철 원석은 철 주괴로만 만들어지는데, 그 철 주괴가
 * 하필 철 원석으로만 제작되고, 철 곡괭이는 그 주괴를 요구한다. 셋 다 레시피
 * 산출물이라 "획득 가능" 검사(참조 단계)는 통과하지만, 놓인 노드의 표에서
 * 출발하는 어떤 사슬도 이 순환에 진입할 수 없다.
 *
 * 도구 게이트까지 폐지된 세계(§6-앞 7)에서 도달 가능성 검사가 잡아야 할 남은
 * 형태가 정확히 이것이다 — 채집은 맨손이 모든 놓인 노드의 표를 여니 막힐 수
 * 없고, 막히는 것은 레시피 사슬뿐이다.
 *
 * requiredSkill 을 전부 0 으로 두는 이유: 0 초과면 "recipes-이정표에 실려야
 * 한다"(설계 §7-앞 5) 위반이 함께 나와, 이 픽스처가 보려는 도달 가능성 위반이
 * 소음에 섞인다.
 */
function craftLockedData(): GameData {
  const data = baseData()
  data.items.iron_ore = testItem('iron_ore', { name: '철 원석', icon: 'ore_iron', price: 100, skill: 'mineral' })
  // 철 주괴의 값이 철 원석 2개의 매도합(100)을 넘지 않는다 — 이 픽스처가 보려는
  // 것은 도달 가능성이지 돈복사가 아니라, 그 검사에 걸리면 위반이 섞여 흐려진다.
  data.items.iron_ingot = testItem('iron_ingot', { name: '철 주괴', icon: 'ingot_iron', price: 100, skill: 'mineral' })
  data.items.iron_pickaxe = testTool('iron_pickaxe', 'mineral', 2, { name: '철 곡괭이', icon: 'pickaxe_iron' })
  data.recipes.iron_ingot = {
    id: 'iron_ingot', name: '철 주괴', category: '제련', skill: 'crafting', requiredSkill: 0, baseChance: 0.5,
    inputs: [{ item: 'iron_ore', count: 2 }], output: { item: 'iron_ingot', count: 1 },
    skillGainMin: 10, skillGainMax: 20,
  }
  data.recipes.iron_ore = {
    id: 'iron_ore', name: '철 원석 환원', category: '제련', skill: 'crafting', requiredSkill: 0, baseChance: 0.5,
    inputs: [{ item: 'iron_ingot', count: 1 }], output: { item: 'iron_ore', count: 1 },
    skillGainMin: 10, skillGainMax: 20,
  }
  data.recipes.iron_pickaxe = {
    id: 'iron_pickaxe', name: '철 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.5,
    inputs: [{ item: 'iron_ingot', count: 3 }], output: { item: 'iron_pickaxe', count: 1 },
    skillGainMin: 10, skillGainMax: 20,
  }
  return data
}

/**
 * 전투 드랍으로만 세상에 들어오는 재료 하나와 그것을 먹는 무기 하나(전투 §4).
 *
 * 송곳니(wolf_fang)는 어느 표의 티어도, 어느 레시피의 산출물도, 어느 진열도
 * 아니다 — 획득 그물의 세 출처 전부의 바깥이라, 드랍표를 모르는 검사에게는
 * 위반으로 보이는 것이 맞다(§12-앞 2 의 위반 픽스처). 검(copper_sword)은 그
 * 송곳니를 재료로 하므로 고정점 계산도 드랍 시드에서 자라야 도달한다.
 */
function combatDropData(): GameData {
  const data = baseData()
  data.items.wolf_fang = testItem('wolf_fang', { name: '늑대 송곳니', icon: 'fang_wolf' })
  data.items.copper_sword = testTool('copper_sword', 'combat', 1, { name: '구리 검', icon: 'sword_copper', damage: 5 })
  data.recipes.copper_sword = {
    id: 'copper_sword', name: '구리 검', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
    inputs: [{ item: 'copper_ingot', count: 1 }, { item: 'wolf_fang', count: 2 }],
    output: { item: 'copper_sword', count: 1 },
    skillGainMin: 10, skillGainMax: 20,
  }
  return data
}

/** 들늑대의 최소 드랍표 — validateGameData 가 읽는 모양(MonsterDropTables)의 견본이다. C6 파서가 이 모양을 채운다. */
function fangDrops(): MonsterDropTables {
  return { wolf: { monsterId: 'wolf', drops: [{ itemId: 'wolf_fang', chance: 0.35 }] } }
}

/** dialogue/ 아래 모든 .dlg 파일을 읽어 하나의 배열로 합친다. build.ts 와 같은 방식이다. */
function readRealDialogue(dialogueDir: string): DialogueRule[] {
  const files = readdirSync(dialogueDir).filter((f) => f.endsWith('.dlg'))
  return files.flatMap((f) => parseDialogue(readFileSync(join(dialogueDir, f), 'utf8'), f))
}

/**
 * 실제로 출하되는 maps.csv 와 그것이 가리키는 `.tmx` 들. build.ts 와 같은 경로다.
 *
 * 맵 하나를 직접 읽던 시절과 달리 이제 정본은 maps.csv 다 — 여기서 목록을
 * 건너뛰고 world.tmx 만 읽으면, 맵이 늘어도 테스트는 계속 한 장만 보게 된다.
 */
function loadRealMaps(): ParsedMaps {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const mapsDir = join(here, '..', 'maps')
  const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))
  return parseMaps(
    readRealCsv('maps.csv'),
    (file) => readFileSync(join(mapsDir, file), 'utf8'),
    parseNodes(readRealCsv('nodes.csv')),
  )
}

/** 실제로 출하되는 확률표 3 CSV 를 그대로 파싱한다. build.ts 와 같은 경로다. */
function loadRealTables(): GatherTables {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))
  return parseGatherTables(
    readRealCsv('gather_tables.csv'),
    readRealCsv('gather_tiers.csv'),
    readRealCsv('gather_brackets.csv'),
  )
}

/** 실제로 출하되는 CSV·맵·대사를 그대로 파싱한 GameData. 여러 describe 가 공유한다. */
function loadRealGameData(): GameData {
  const here = dirname(fileURLToPath(import.meta.url))
  const csvDir = join(here, '..', 'csv')
  const readRealCsv = (name: string) => parseCsv(readFileSync(join(csvDir, name), 'utf8'))
  const nodes = parseNodes(readRealCsv('nodes.csv'))
  const recipes = parseRecipes(readRealCsv('recipes.csv'))
  const { maps, placements, places } = loadRealMaps()

  return {
    monsters: {}, monsterPlacements: {},
    items: parseItems(readRealCsv('items.csv')),
    nodes,
    recipes,
    maps,
    transitions: parseTransitions(readRealCsv('transitions.csv')),
    placements,
    milestones: parseMilestones(readRealCsv('milestones.csv'), recipes),
    speakers: parseSpeakers(readRealCsv('speakers.csv')),
    shops: parseShops(readRealCsv('shops.csv'), readRealCsv('shop_stock.csv')),
    masters: parseMasters(readRealCsv('masters.csv')),
    // 출하 강화표를 그대로 싣는다 — 이 픽스처의 값어치는 "지금 CSV 가 실제로
    // 검증을 통과하는가"이므로, 여기만 빈 배열이면 그 물음이 강화에는 닿지 않는다.
    enhanceCosts: parseEnhanceCosts(readRealCsv('enhance_costs.csv')),
    // 출하 문턱표도 그대로 싣는다 — 강화표와 같은 이유다.
    collection: parseCollection(readRealCsv('collection.csv')),
    // 실제 맵의 지점을 그대로 싣는다 — 일과가 들어오면 이 검사도 함께 자란다.
    places,
    schedules: {},
    routes: [],
    dialogue: readRealDialogue(join(here, '..', 'dialogue')),
  }
}

describe('validateGameData', () => {
  it('정상 데이터는 위반이 없다', () => {
    expect(validateGameData(baseData(), baseTables())).toEqual([])
  })

  it('존재하지 않는 표를 가리키는 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.tableId = 'ghost_table'
    expect(validateGameData(data, baseTables())).toContain(
      'nodes[copper_vein]: 존재하지 않는 표 "ghost_table" 를 가리킨다 — gather_tables.csv 의 tableId 중 하나여야 한다',
    )
  })

  // ---- 결계: 등급(variant)과 실제 분포(tableId)는 한 가지를 말하는 두 칸이다 ----
  //
  // 이 아크 전까지 variant 는 "표시 전용"이었고, 그 대가로 심층 노드 넷이 이름과
  // 겉모습만 심층인 채 바깥과 **같은 표**를 굴렸다(설계 계기 둘). 표가 갈라진
  // 지금은 둘이 다시 갈라지는 날을 빌드가 막는다 — 갈라져도 어느 화면 하나
  // 이상해지지 않는다는 것이 정확히 그때의 문제였다.

  it('deep 노드가 바깥 표를 가리키면 위반이다 — 화면은 심층이라 그리고 표는 바깥을 굴린다', () => {
    const data = baseData()
    data.nodes.copper_vein!.variant = 'deep'
    expect(validateGameData(data, baseTables())).toContain(
      'nodes[copper_vein]: variant("deep") 와 tableId("mineral") 가 짝이 아니다 — 등급마다 표 접미사가 하나씩 정해져 있는데(normal → 접미사 없음, deep → "_deep", special → "_special") 이 tableId 는 "normal" 등급의 표다. 갈라지면 노드 그림과 실제 분포가 어긋나는데, 그 어긋남은 어느 화면에서도 되짚을 수 없다. nodes.csv 에서 variant 를 "normal" 쪽에 맞추거나 tableId 를 "mineral_deep" 처럼 적는다',
    )
  })

  it('normal 노드가 심층 표를 가리켜도 위반이다 — 결계 앞의 노드가 결계 뒤의 분포를 낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.tableId = 'mineral_deep'
    const tables = baseTables()
    tables.mineral_deep = { ...tables.mineral!, id: 'mineral_deep', equity: false }
    expect(validateGameData(data, tables)).toContain(
      'nodes[copper_vein]: variant("normal") 와 tableId("mineral_deep") 가 짝이 아니다 — 등급마다 표 접미사가 하나씩 정해져 있는데(normal → 접미사 없음, deep → "_deep", special → "_special") 이 tableId 는 "deep" 등급의 표다. 갈라지면 노드 그림과 실제 분포가 어긋나는데, 그 어긋남은 어느 화면에서도 되짚을 수 없다. nodes.csv 에서 variant 를 "deep" 쪽에 맞추거나 tableId 를 "mineral" 처럼 적는다',
    )
  })

  // **등급이 셋이 되면서 옛 검사가 새는 자리가 생겼다.** 옛 한 줄은
  // `isDeepTableId(tableId) !== (variant === 'deep')` 이라, special + 접미사 없는
  // 표를 **양쪽 다 false** 로 읽어 통과시킨다. 아크 A 가 노드에 그림을 달았으므로
  // 그 거짓말은 이제 화면에서 보인다 — 붉은 얼음 광맥이 보통 얼음을 준다.

  it('special 노드가 바깥 표를 가리키면 위반이다 — 옛 두 값 검사가 정확히 여기서 샜다', () => {
    const data = baseData()
    data.nodes.copper_vein!.variant = 'special'
    expect(validateGameData(data, baseTables())).toContain(
      'nodes[copper_vein]: variant("special") 와 tableId("mineral") 가 짝이 아니다 — 등급마다 표 접미사가 하나씩 정해져 있는데(normal → 접미사 없음, deep → "_deep", special → "_special") 이 tableId 는 "normal" 등급의 표다. 갈라지면 노드 그림과 실제 분포가 어긋나는데, 그 어긋남은 어느 화면에서도 되짚을 수 없다. nodes.csv 에서 variant 를 "normal" 쪽에 맞추거나 tableId 를 "mineral_special" 처럼 적는다',
    )
  })

  it('normal 노드가 특수 표를 가리켜도 위반이다 — 유일 출처가 아무 노드에서나 나오면 조건이 뜻을 잃는다', () => {
    const data = baseData()
    data.nodes.copper_vein!.tableId = 'mineral_special'
    const tables = baseTables()
    tables.mineral_special = { ...tables.mineral!, id: 'mineral_special', equity: false }
    expect(validateGameData(data, tables)).toContain(
      'nodes[copper_vein]: variant("normal") 와 tableId("mineral_special") 가 짝이 아니다 — 등급마다 표 접미사가 하나씩 정해져 있는데(normal → 접미사 없음, deep → "_deep", special → "_special") 이 tableId 는 "special" 등급의 표다. 갈라지면 노드 그림과 실제 분포가 어긋나는데, 그 어긋남은 어느 화면에서도 되짚을 수 없다. nodes.csv 에서 variant 를 "special" 쪽에 맞추거나 tableId 를 "mineral" 처럼 적는다',
    )
  })

  it('짝이 맞는 세 등급은 이 검사를 통과한다 — 등급을 늘린 것이 새 거짓말을 만들면 안 된다', () => {
    for (const variant of NODE_VARIANTS) {
      const data = baseData()
      const tables = baseTables()
      const tableId = `mineral${suffixOfVariant(variant)}`
      data.nodes.copper_vein!.variant = variant
      data.nodes.copper_vein!.tableId = tableId
      tables[tableId] = { ...tables.mineral!, id: tableId, equity: tableId === 'mineral' }
      expect(validateGameData(data, tables).filter((v) => v.includes('짝이 아니다'))).toEqual([])
    }
  })

  it('없는 아이템을 재료로 쓰는 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.inputs = [{ item: 'ghost_ore', count: 1 }]
    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_ingot]: 존재하지 않는 재료 "ghost_ore" 를 요구한다',
    )
  })

  it('없는 아이템을 산출하는 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.output = { item: 'ghost_bar', count: 1 }
    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_ingot]: 존재하지 않는 아이템 "ghost_bar" 를 산출한다',
    )
  })

  // 노드의 수치 검사(yield·baseChance·skillGain)는 그 칸들이 확률표로 이사하면서
  // 함께 떠났다 — 표 쪽의 순증가·칸 수·범위 검사는 gatherTables.test.ts 가 지킨다.

  it('baseChance 가 0 초과 1 미만이 아닌 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.baseChance = 1
    expect(validateGameData(data, baseTables())).toContain('recipes[copper_ingot]: baseChance 가 0 초과 1 미만이 아니다')
  })

  it('skillGainMin 이 skillGainMax 보다 큰 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.skillGainMin = 25
    expect(validateGameData(data, baseTables())).toContain('recipes[copper_ingot]: skillGainMin 이 skillGainMax 보다 크다')
  })

  it('자기 자신을 재료로 쓰는 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.inputs = [{ item: 'copper_ingot', count: 1 }]
    expect(validateGameData(data, baseTables())).toContain('recipes[copper_ingot]: 산출물을 자기 재료로 쓴다')
  })

  // 왜: 문턱(§6-앞 9)과 산출물의 계열(§6-앞 17)은 같은 한 가지를 말하는 두 칸이다
  //     — "이건 얼음 계열의 물건이라 얼음을 5만 캔 사람이 만들고 얼음 상점이
  //     사 준다". 둘이 갈라져도 어느 화면도 이상해지지 않는다: 문은 문대로
  //     열리고, 죽은 아이템 검사는 팔 곳이 있으니 통과시킨다. 남는 것은
  //     "나무를 5만 캐야 열리는데 얼음 상점만 사 주는 물건" 하나뿐이고,
  //     그 어긋남은 데이터를 나란히 놓고 봐야만 보인다.
  it('문턱의 계열과 산출물의 계열이 갈라진 레시피를 잡아낸다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.gateSkill = 'ice'
    data.recipes.copper_ingot!.gateValue = 1000
    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_ingot]: 문턱은 ice 계열인데 산출물 "구리 주괴" 는 mineral 계열이다 — 그 계열 상점만 사 주므로(§6-앞 17) 문을 연 계열과 팔 곳이 갈라진다. recipes.csv 의 gateSkill 이나 items.csv 의 skill 중 하나를 고친다',
    )
  })

  it('문턱이 있는데 산출물에 계열이 없으면 잡아낸다 — 캔 곳은 있는데 팔 곳이 없다', () => {
    const data = baseData()
    data.recipes.copper_pickaxe!.gateSkill = 'mineral'
    data.recipes.copper_pickaxe!.gateValue = 1000
    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_pickaxe]: 문턱은 mineral 계열인데 산출물 "구리 곡괭이" 에 계열(skill)이 없다 — 그 계열 상점만 사 주므로(§6-앞 17) 문을 연 계열과 팔 곳이 갈라진다. recipes.csv 의 gateSkill 이나 items.csv 의 skill 중 하나를 고친다',
    )
  })

  it('문턱이 없는 레시피는 산출물의 계열을 묻지 않는다 — 문이 없으면 어긋날 두 칸도 없다', () => {
    // copper_pickaxe 의 산출물(도구)에는 계열이 없다. 문턱이 없는 한 그것은
    // 결손이 아니다 — 도구는 애초에 팔리지 않는다.
    expect(validateGameData(baseData(), baseTables())).toEqual([])
  })

  it('어떤 노드로도 얻을 수 없고 어떤 레시피로도 만들 수 없는 아이템을 잡아낸다', () => {
    const data = baseData()
    data.items.orphan = testItem('orphan', { name: '고아', icon: 'x' })
    expect(validateGameData(data, baseTables())).toContain(
      'items[orphan]: 채집으로도 제작으로도 구매로도 전투 드랍으로도 획득할 수 없다',
    )
  })

  it('레시피 없는 시작 도구는 이제 오탐이 아니라 결손이다 — 지급이 유도가 되면서 시드 특례가 사라졌다', () => {
    // 구 검사는 STARTING_TOOL_IDS 를 "획득 가능" 시드로 넣어 레시피 없는 시작
    // 도구를 봐줬다. 유도된 시작 도구는 requiredSkill 0 레시피가 의무이므로
    // (§6-앞 8 — 다른 마을 사람이 얻을 길이 그것뿐이다), 레시피를 지우면
    // 획득 불가로 잡히는 것이 맞다.
    const data = baseData()
    delete data.recipes.copper_pickaxe
    expect(validateGameData(data, baseTables())).toContain(
      'items[copper_pickaxe]: 채집으로도 제작으로도 구매로도 전투 드랍으로도 획득할 수 없다',
    )
  })
})

describe('validateGameData 의 전투 드랍 출처 (§12-앞 2)', () => {
  it('드랍표에 실리지 않은 전투 전용 재료는 획득 불가다 — 그물을 넓힌 뒤에도 출처 없는 아이템은 물려야 한다', () => {
    // 드랍표가 빈 세계 = 지금의 출하 상태다. 여기서 안 물리면 "전투 드랍" 출처를
    // 더한 것이 아니라 그물에 구멍을 낸 것이다(§12-앞 2 의 위반 픽스처).
    expect(validateGameData(combatDropData(), baseTables(), {})).toContain(
      'items[wolf_fang]: 채집으로도 제작으로도 구매로도 전투 드랍으로도 획득할 수 없다',
    )
  })

  it('드랍표에 실리면 획득 가능이고, 고정점도 그 시드에서 자란다 — 검이 송곳니를 거쳐 도달한다', () => {
    // .toEqual([]) 이라 두 자리를 한꺼번에 문다: 획득 검사(참조 단계)가 드랍
    // 출처를 알고, 도달 가능성 고정점도 같은 시드를 안다 — 어느 한쪽만 알면
    // wolf_fang 이나 copper_sword 가 위반으로 남는다.
    expect(validateGameData(combatDropData(), baseTables(), fangDrops())).toEqual([])
  })

  it('1티어 combat 무기는 "기술별 1티어 도구 하나" 검사 밖이다 — 시작 지급은 채집 기술의 유도이고 무기는 전투 사슬로 온다(전투 §4)', () => {
    // copper_sword(1티어 combat)와 copper_pickaxe(1티어 mineral)가 공존해도
    // "정확히 하나" 위반이 없어야 한다. 무기가 후보에 섞이는 순간 시작 지급
    // 유도(starterToolFor)가 어느 쪽을 줄지 정해지지 않는다.
    const violations = validateGameData(combatDropData(), baseTables(), fangDrops())
    expect(violations.filter((v) => v.includes('1티어 도구'))).toEqual([])
  })

  it('드랍표 인자를 생략하면 전투 없는 세계다 — 전투 이전의 픽스처들이 낡지 않는다', () => {
    expect(validateGameData(baseData(), baseTables())).toEqual([])
  })
})

describe('validateGameData 의 도달 가능성 검사', () => {
  it('서로만 먹이는 레시피 순환은 도달할 수 없다고 잡아낸다', () => {
    const violations = validateGameData(craftLockedData(), baseTables())
    // iron_ore ← iron_ingot ← iron_ore 의 상호 순환에, 그 주괴를 요구하는
    // iron_pickaxe 까지 걸려 있다 — 셋 다 레시피 산출물이라 "획득 가능" 검사는
    // 통과하지만, 놓인 노드의 표에서 출발하는 어떤 사슬도 진입하지 못한다.
    expect(violations).toContain(
      'items[iron_pickaxe]: 도달할 수 없다 — 맵에 놓인 어느 노드의 표에도 없고, 어느 상점도 팔지 않으며, 어느 드랍표에도 없고, 재료가 전부 도달 가능한 레시피도 없다',
    )
    expect(violations).toContain(
      'items[iron_ore]: 도달할 수 없다 — 맵에 놓인 어느 노드의 표에도 없고, 어느 상점도 팔지 않으며, 어느 드랍표에도 없고, 재료가 전부 도달 가능한 레시피도 없다',
    )
    expect(violations).toContain(
      'items[iron_ingot]: 도달할 수 없다 — 맵에 놓인 어느 노드의 표에도 없고, 어느 상점도 팔지 않으며, 어느 드랍표에도 없고, 재료가 전부 도달 가능한 레시피도 없다',
    )
  })

  it('맵에 놓인 노드의 표 아이템은 무조건 도달 가능하다 — 맨손 채집이 시드다(§6-앞 7)', () => {
    // 표에 아직 아무 레시피도 산출한 적 없는 아이템(silver_like)을 끼워 넣는다.
    // 게이트가 없는 세계에서는 도구 유무와 무관하게 그 표의 전 브라켓 전
    // 아이템이 열려야 한다 — 브라켓은 그라인딩으로 언젠가 닿는다.
    //
    // 광물상점을 함께 두는 것은 이 검사와 무관하다: 어느 레시피도 먹지 않는 새
    // 재료는 팔 곳이 없으면 죽은 아이템 검사(§6-앞 13)에 걸리고, 그 위반이
    // 여기서 보려는 도달 가능성 결과를 흐린다. (픽스처 registryData·mineralShop 은
    // 등록부 검사 스위트와 함께 이 파일 아래쪽에 있다 — 상점은 화자를 가리키므로
    // 화자 픽스처 옆에 두었다.)
    const data = registryData()
    data.shops = { 광물상점: mineralShop() }
    data.items.silver_like = testItem('silver_like', { name: '은 비슷한 것', icon: 'x', price: 200, skill: 'mineral' })
    const tables = baseTables()
    tables.mineral!.tiers = [{ itemId: 'silver_like' }, { itemId: 'copper_ore' }]
    tables.mineral!.brackets = [{ bracketMax: null, cumulative: [3, 60000] }]

    expect(validateGameData(data, tables)).toEqual([])
  })

  it('그 기술의 도구가 노드 산출물로만 만들어지는 자급 구조도 도달 가능하다 — 시드는 도구가 아니라 배치다(§6-앞 7)', () => {
    // 광물 도구(bronze_pickaxe)가 광물 노드의 산출물(copper_ore→copper_ingot)로만
    // 만들어진다. 도구를 시드로 삼던 옛 계산(hasCoveringTool)은 "도구가 없으니
    // 노드가 안 열리고, 노드가 안 열리니 도구를 못 만든다"는 순환으로 전부 도달
    // 불가라 답했다 — 맨손이 노드를 여는 세계에는 그 순환이 애초에 없다.
    const data = baseData()
    delete data.items.copper_pickaxe
    delete data.recipes.copper_pickaxe
    data.items.bronze_pickaxe = testTool('bronze_pickaxe', 'mineral', 1, { name: '청동 곡괭이', icon: 'pickaxe_copper' })
    data.recipes.bronze_pickaxe = {
      id: 'bronze_pickaxe', name: '청동 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'bronze_pickaxe', count: 1 },
      skillGainMin: 10, skillGainMax: 20,
    }

    expect(validateGameData(data, baseTables())).toEqual([])
  })

  // '정상 데이터는 위반이 없다' (위 baseData 스위트)와 동일한 단언이라 여기서는 생략한다 —
  // baseData 는 놓인 노드 하나에서 전부 도달 가능하므로 그 테스트가 이미 이 사실을 검증한다.

  it('실제로 출하되는 CSV 데이터는 도달 가능성 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

describe('validateGameData 의 배치 검사', () => {
  it('노드 종류가 맵 어디에도 놓이지 않으면 잡아낸다', () => {
    const data = baseData()
    // baseData() 의 유일한 노드(copper_vein)를 어느 칸에도 놓지 않은 상태로 만든다.
    // CSV 에는 있지만 맵에는 없는 노드라, 플레이어가 닿을 방법이 없다.
    data.placements = {}

    expect(validateGameData(data, baseTables())).toContain('nodes[copper_vein]: 맵 어디에도 놓이지 않았다')
  })

  it('실제로 출하되는 CSV 데이터는 노드마다 맵에 최소 한 번 놓여 있다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('맵 어디에도 놓이지 않았다'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 조합 부트스트랩 검사', () => {
  it('스킬의 모든 레시피가 requiredSkill 0 초과면 그 스킬은 영원히 부트스트랩할 수 없다고 잡아낸다', () => {
    const data = baseData()
    // crafting 스킬에서 requiredSkill 0 이던 두 레시피(copper_ingot·copper_pickaxe)를
    // 전부 1로 올린다. 조합 숙련도는 레시피 성공 경로(craftService)에서만 오르고
    // 그 경로 자체가 requiredSkill 게이트(canCraft) 뒤에 있으므로, crafting 레시피
    // 전부가 1 이상을 요구하면 숙련도 0에서 시작하는 플레이어는 어떤 레시피도
    // 영원히 열 수 없다.
    data.recipes.copper_ingot!.requiredSkill = 1
    data.recipes.copper_pickaxe!.requiredSkill = 1

    expect(validateGameData(data, baseTables())).toContain(
      'skills[crafting]: requiredSkill 0 이면서 계열 문턱도 없는 레시피가 없어 영원히 부트스트랩할 수 없다',
    )
  })

  // 왜: 계열 문턱(§6-앞 9)은 requiredSkill 0 인 레시피도 "채집 N 을 먼저 하라"로
  //     닫는다 — 문턱 뒤에 있는 문을 부트스트랩으로 세면, 조합 0 짜리 문이 전부
  //     문턱 뒤로 옮겨간 날 이 검사가 초록인 채로 숙련도가 0 에 갇힌다.
  it('계열 문턱이 걸린 requiredSkill 0 레시피는 부트스트랩으로 세지 않는다', () => {
    const data = baseData()
    data.recipes.copper_ingot!.gateSkill = 'mineral'
    data.recipes.copper_ingot!.gateValue = 1000
    data.recipes.copper_pickaxe!.gateSkill = 'mineral'
    data.recipes.copper_pickaxe!.gateValue = 1000

    expect(validateGameData(data, baseTables())).toContain(
      'skills[crafting]: requiredSkill 0 이면서 계열 문턱도 없는 레시피가 없어 영원히 부트스트랩할 수 없다',
    )
  })

  it('실제로 출하되는 CSV 데이터는 스킬마다 requiredSkill 0 인 레시피를 갖고 있다', () => {
    // skills[...] 접두사는 이 검사와 "채집 기술마다 repeat 이정표가 정확히 하나"
    // 검사가 공유한다 — 부트스트랩만 걸러 보려면 메시지 내용까지 좁혀야 한다.
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter(
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

    expect(validateGameData(data, baseTables())).toEqual([
      'recipes[copper_ingot]: 존재하지 않는 재료 "ghost_ore" 를 요구한다',
    ])
  })

})

// ---- 돈복사 금지(§6-앞 6) ----
//
// 산출물을 팔아 얻는 돈이 재료를 팔아 얻는 돈보다 크면 그 레시피 하나가 무한
// 골드 루프가 된다(스펙이 잡아낸 구리 주괴 31배가 그것이었다). 사람이 새 레시피가
// 생길 때마다 손으로 검산하는 것은 언젠가 반드시 빠지므로 빌드가 대신 센다.

describe('validateGameData 의 돈복사 검사', () => {
  it('산출물 매도가가 재료 매도가 합계보다 크면 잡아낸다', () => {
    const data = baseData()
    // 구리 주괴는 구리 원석 2개(매도 40×2=80)로 만들어진다 — 매도가가 250 이 되면
    // 캐고 만들어 파는 것만으로 골드가 불어난다.
    data.items.copper_ingot = { ...data.items.copper_ingot!, price: 500 }

    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_ingot]: 산출물 매도가(250)가 재료 매도가 합계(80)보다 크다 — 만들어서 팔기만 해도 골드가 불어난다(돈복사). items.csv 에서 "구리 주괴" 의 price 를 낮추거나 recipes.csv 에서 재료를 늘린다',
    )
  })

  // 왜: 부등식이 ≤ 이지 < 가 아니다. 딱 본전인 레시피는 골드를 만들지 않으므로
  //     막을 이유가 없고, < 로 두면 정상 데이터가 이유 없이 걸린다.
  it('산출물 매도가가 재료 매도가 합계와 같으면 통과한다 — 본전은 돈복사가 아니다', () => {
    const data = baseData()
    data.items.copper_ingot = { ...data.items.copper_ingot!, price: 160 }

    expect(validateGameData(data, baseTables())).toEqual([])
  })

  // 왜: 산출 수량을 안 곱하면 "여러 개 나오는 레시피"가 검사를 통째로 빠져나간다 —
  //     돈복사는 값보다 수량으로 만들어지는 것이 더 흔하다.
  it('산출 수량을 곱해서 센다 — 하나씩은 본전이어도 여럿 나오면 돈복사다', () => {
    const data = baseData()
    data.items.copper_ingot = { ...data.items.copper_ingot!, price: 160 }
    data.recipes.copper_ingot!.output = { item: 'copper_ingot', count: 2 }

    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_ingot]: 산출물 매도가(160)가 재료 매도가 합계(80)보다 크다 — 만들어서 팔기만 해도 골드가 불어난다(돈복사). items.csv 에서 "구리 주괴" 의 price 를 낮추거나 recipes.csv 에서 재료를 늘린다',
    )
  })

  it('실제로 출하되는 CSV 데이터에는 돈복사 레시피가 없다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

// ---- 정제품의 영구 수요(제작 확장 §6-앞 6) ----
//
// 정제품의 소비처가 강화뿐이면 그 수요는 평생 24개로 끝난다 — 3단 문을 여는 데만
// 정제 400회가 필요한데 그렇다. 그래서 미스릴 도구 4종이 raw 재료 대신 3단
// 정제품을 먹는다: 도구는 잃어버리고 다시 만들고 계열마다 한 벌씩 필요하므로,
// 그 사슬에 붙은 수요는 끝나지 않는다. 이것은 검증기가 아니라 **데이터의 사실**이라
// 여기서 출하 CSV 를 그대로 읽어 못박는다 — 누가 재료를 되돌리면 이 줄이 깨진다.

describe('출하 recipes.csv 의 미스릴 도구 — 정제품 수요가 도구 사슬에 영구히 붙는다', () => {
  const data = loadRealGameData()
  const mithrilTools = ['mithril_pickaxe', 'mithril_chisel', 'mithril_axe', 'mithril_sickle']

  it('네 종 모두 미스릴 주괴 3 + 농축 잎물 2 + 세이지 정수 2 를 먹는다', () => {
    for (const id of mithrilTools) {
      expect(data.recipes[id]!.inputs).toEqual([
        { item: 'mithril_ingot', count: 3 },
        { item: 'leaf_extract', count: 2 },
        { item: 'sage_essence', count: 2 },
      ])
    }
  })

  it('3단 정제품 둘 다 도구 레시피의 재료다 — 강화가 끝나도 남는 수요가 이것이다', () => {
    for (const refined of ['leaf_extract', 'sage_essence']) {
      const eaters = Object.values(data.recipes).filter(
        (r) => r.category === '도구' && r.inputs.some((i) => i.item === refined),
      )
      expect(eaters.length).toBeGreaterThan(0)
    }
  })

  // 왜 숫자를 박는가: 도구는 price 0(팔 수 없다)이라 돈복사 검사가 언제나
  // 0 ≤ 입력합으로 통과한다 — 그 검사만으로는 재료를 바꿔도 아무 말이 없다.
  // 원가 70,875 → 54,600 은 재료가 싸진 것이 아니라 **더 깊어진 것**이다:
  // 정제품 넷은 그 자체가 20층짜리 채집·정제의 산물이다.
  it('입력 매도합은 54,600 이고 산출은 팔 수 없다(0) — 도구는 팔아서 버는 물건이 아니다', () => {
    const sellSum = (id: string): number =>
      data.recipes[id]!.inputs.reduce((sum, i) => sum + sellPrice(data.items[i.item]!) * i.count, 0)

    for (const id of mithrilTools) {
      expect(sellSum(id)).toBe(54_600)
      expect(sellPrice(data.items[data.recipes[id]!.output.item]!)).toBe(0)
    }
  })

  // 재료에서 빠진 셋은 죽지 않는다 — 그 계열 상점이 사 주기 때문이다(§6-앞 17 과
  // 같은 자세). "레시피에서 빠지면 죽는다"가 참이면 이 교체 자체를 못 한다.
  it('빠진 raw 셋(금빛 열매·천년초 잎·아로마)은 상점이 사 주므로 죽은 아이템이 아니다', () => {
    for (const id of ['golden_fruit', 'millennium_leaf', 'aroma_herb']) {
      const item = data.items[id]!
      expect(Object.values(data.shops).some((shop) => isSellTarget(item, shop))).toBe(true)
    }
  })
})

// ---- 날씨 가루의 분당 재료 단가(제작 확장 §6-앞 1~4) ----
//
// 약과 중은 지속만 다른 **같은 하늘**이다. 그러니 둘 사이의 유일한 선택 기준은
// 분당 재료 단가인데, 출하 첫판은 중이 약을 완전히 지배했다:
//
//   약  얼음 조각 10(×50) + 맑은 얼음  5(×150) = 1,250 ÷  60분 = 20.83/분
//   중  얼음 조각 30(×50) + 맑은 얼음 10(×150) = 3,000 ÷ 180분 = 16.67/분  ← 20% 싸다
//
// 그래서 얼음 10,000(중의 문턱)을 넘는 순간 약 2종은 만들 이유가 **영원히**
// 사라졌다 — 목록에 서 있기만 하는 레시피 둘이다.
//
// 고친 것은 지속이 아니라 재료다. 중을 약의 정확히 3배로 만들면
//
//   중  얼음 조각 30(1,500) + 맑은 얼음 15(2,250) = 3,750 ÷ 180분 = 20.83/분
//
// 로 단가가 같아지고, 60분/180분이라는 읽히는 모양도 그대로 지킨다(지속을
// 180 → 144 로 깎아도 단가는 같아지지만 상단바에 "2시간 24분"이 뜬다).
//
// 단가가 같아진 뒤 약이 사는 자리는 **낱개**다: 하늘이 20분만 필요한 사람에게
// 중은 160분어치를, 약은 40분어치만 버리게 한다. 한 개보다 적게 쓸 수 없다는
// 사실이 싼 쪽의 존재 이유가 되는 것 — 이 등식이 지키는 것이 그것이다.

describe('출하 recipes.csv 의 날씨 가루 — 중이 약을 지배하지 않는다', () => {
  const data = loadRealGameData()

  /** 그 가루 한 개의 재료 정가 합을, 그것이 사 주는 게임 분으로 나눈 값. */
  const perMinute = (recipeId: string): number => {
    const recipe = data.recipes[recipeId]!
    const cost = recipe.inputs.reduce((sum, i) => sum + data.items[i.item]!.price * i.count, 0)
    const effect = data.items[recipe.output.item]!.useEffect
    if (effect?.kind !== 'weather') throw new Error(`${recipeId} 의 산출물이 날씨 가루가 아니다`)
    return cost / effect.minutes
  }

  it('중 가루의 분당 재료 단가가 약 가루보다 싸지 않다 — 싸지면 약은 만들 이유가 없어진다', () => {
    expect(perMinute('heavy_rain_powder')).toBeGreaterThanOrEqual(perMinute('rain_powder'))
    expect(perMinute('heavy_snow_powder')).toBeGreaterThanOrEqual(perMinute('snow_powder'))
  })

  it('지금 출하값에서는 둘이 정확히 같다 — 1,250÷60 = 3,750÷180 = 20.83/분', () => {
    for (const id of ['rain_powder', 'snow_powder', 'heavy_rain_powder', 'heavy_snow_powder']) {
      expect(perMinute(id)).toBeCloseTo(1250 / 60, 10)
    }
  })
})

// ---- 사다리 소속 일치(§6-앞 10) ----
//
// items.csv 의 skill 은 "어느 상점이 이것을 사 주는가"를 정하고, 채집표는 "이것이
// 실제로 어느 사다리에서 나오는가"를 안다. 둘이 갈라지면 얼음 채집장에서 캔 것을
// 얼음상점이 안 사 주는 화면이 되는데, 그 원인을 화면에서 되짚을 방법이 없다.

describe('validateGameData 의 사다리 소속 검사', () => {
  it('선언한 계열이 그 아이템이 실제로 나오는 표의 계열과 다르면 잡아낸다', () => {
    const data = baseData()
    data.items.copper_ore = { ...data.items.copper_ore!, skill: 'ice' }

    expect(validateGameData(data, baseTables())).toContain(
      'items[copper_ore]: skill 이 "ice" 인데 채집표에서는 "mineral" 사다리의 티어다 — 캔 곳과 팔 곳이 갈라진다. items.csv 의 skill 을 "mineral" 로 고친다',
    )
  })

  // 왜: 주괴는 어느 표의 티어도 아니다(캐는 것이 아니라 만드는 것이다). 사다리
  //     소속을 물을 대상이 아니므로 mineral 로 적어 광물상점이 사 주게 한다 —
  //     이 검사가 표 밖의 아이템까지 건드리면 그 결정을 되돌리게 된다. skill 값
  //     자체가 실재하는 기술인지는 parseItems 의 toSkillId 가 이미 본다.
  it('표의 티어가 아닌 아이템(주괴)은 검사 대상이 아니다', () => {
    const data = baseData()
    data.items.copper_ingot = { ...data.items.copper_ingot!, skill: 'ice' }

    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('계열을 적지 않은 아이템(도구)은 검사 대상이 아니다', () => {
    const data = baseData()
    expect(data.items.copper_pickaxe!.skill).toBeUndefined()
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('표의 티어인데 계열 칸이 비어 있으면 잡아낸다 — 캔 것을 아무도 사 주지 않는다', () => {
    // 검사가 "적힌 계열이 표와 다른가" 한 방향만 보면, **아예 안 적은** 재료가
    // 그물을 그대로 빠져나간다. 매도 판정은 `def.skill === shop.shop.skill` 이라
    // 계열이 없는 재료는 어느 상점도 사 주지 않는데(undefined 는 어느 계열과도
    // 같지 않다), 그것이 하필 레시피 재료이기도 하면 "쓸 곳도 팔 곳도 없다"
    // 검사마저 통과해 빌드가 끝까지 초록이다.
    const data = baseData()
    delete data.items.copper_ore!.skill

    expect(validateGameData(data, baseTables())).toEqual([
      'items[copper_ore]: 채집표에서는 "mineral" 사다리의 티어인데 skill 칸이 비어 있다 — 매도 판정이 아이템의 skill 과 상점의 skill 을 견주므로, 계열이 없는 재료는 어느 상점도 사 주지 않는다. 캔 것이 팔리지 않는 화면이 된다. items.csv 의 skill 을 "mineral" 로 채운다',
    ])
  })

  it('실제로 출하되는 CSV 데이터는 사다리 소속이 전부 일치한다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

// ---- 시작 도구 유도 검사(§6-앞 8) ----
//
// 시작 지급은 상수(구 STARTING_TOOL_IDS)가 아니라 유도다: villageField(마을).skill
// → starterToolFor("kind=tool ∧ toolTier=1 ∧ toolSkill=그 기술"). 유도가 성립하지
// 않는 카탈로그는 캐릭터 생성 런타임이 아니라 **빌드**에서 터져야 한다 — 채집
// 기술마다 1티어 도구가 정확히 하나 있고, 그 도구에 requiredSkill 0 레시피가 있다.

describe('validateGameData 의 시작 도구 유도 검사', () => {
  it('채집 기술의 1티어 도구가 하나도 없으면 잡아낸다 — 그 마을의 새 캐릭터가 만들어지지 않는다', () => {
    const data = baseData()
    // 유일한 채집 기술(mineral)의 1티어 도구와 그 레시피를 함께 지운다 —
    // 레시피만 남기면 "없는 아이템을 산출한다" 참조 위반이 섞여 이 검사
    // 하나만 볼 수 없다.
    delete data.items.copper_pickaxe
    delete data.recipes.copper_pickaxe

    expect(validateGameData(data, baseTables())).toEqual([
      'skills[mineral]: 1티어 도구가 정확히 하나여야 하는데 [](0개)다 — 시작 지급(starterToolFor)이 그 하나를 마을 도구로 유도한다. items.csv 의 toolTier·toolSkill 을 정리한다',
    ])
  })

  it('채집 기술의 1티어 도구가 둘이면 잡아낸다 — 무엇을 줄지 정해지지 않는다', () => {
    const data = baseData()
    // 두 번째 곡괭이에도 requiredSkill 0 레시피를 준다 — 안 주면 "획득할 수
    // 없다" 위반이 섞여 이 검사 하나만 볼 수 없다.
    data.items.bronze_pickaxe = testTool('bronze_pickaxe', 'mineral', 1, { name: '청동 곡괭이', icon: 'pickaxe_copper' })
    data.recipes.bronze_pickaxe = {
      id: 'bronze_pickaxe', name: '청동 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'bronze_pickaxe', count: 1 },
      skillGainMin: 10, skillGainMax: 20,
    }

    expect(validateGameData(data, baseTables())).toEqual([
      'skills[mineral]: 1티어 도구가 정확히 하나여야 하는데 [copper_pickaxe,bronze_pickaxe](2개)다 — 시작 지급(starterToolFor)이 그 하나를 마을 도구로 유도한다. items.csv 의 toolTier·toolSkill 을 정리한다',
    ])
  })

  it('시작 도구에 requiredSkill 0 레시피가 없으면 잡아낸다 — 다른 마을 사람이 영원히 못 만든다', () => {
    const data = baseData()
    data.recipes.copper_pickaxe!.requiredSkill = 5

    const violations = validateGameData(data, baseTables())
    expect(violations).toContain(
      'items[copper_pickaxe]: mineral 의 시작 도구인데 requiredSkill 0 이면서 계열 문턱도 없는 레시피가 없다 — 다른 마을에서 시작한 사람이 이 도구를 영원히 얻지 못한다. recipes.csv 에 requiredSkill 0·문턱 없는 레시피를 둔다',
    )
  })

  // 왜: 광물 도구를 만들려고 광물을 1,000 캐야 한다면 그 도구가 필요한 이유와
  //     조건이 같은 것을 요구하는 순환이다 — 문턱 뒤의 레시피는 공짜 문이 아니다.
  it('시작 도구 레시피에 계열 문턱이 걸려 있으면 공짜 레시피로 세지 않는다', () => {
    const data = baseData()
    data.recipes.copper_pickaxe!.gateSkill = 'mineral'
    data.recipes.copper_pickaxe!.gateValue = 1000

    expect(validateGameData(data, baseTables())).toContain(
      'items[copper_pickaxe]: mineral 의 시작 도구인데 requiredSkill 0 이면서 계열 문턱도 없는 레시피가 없다 — 다른 마을에서 시작한 사람이 이 도구를 영원히 얻지 못한다. recipes.csv 에 requiredSkill 0·문턱 없는 레시피를 둔다',
    )
  })

  it('1티어라도 채집 기술이 아닌 도구(망치)는 검사 대상이 아니다 — crafting 에는 노드가 없다', () => {
    // baseData 의 copper_hammer 는 1티어 crafting 도구인데 레시피 requiredSkill 이
    // 3 이다 — 채집 기술이었다면 위반이지만, 노드 없는 기술은 시작 지급이 없다.
    expect(validateGameData(baseData(), baseTables())).toEqual([])
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
    expect(validateGameData(data, baseTables())).toContain(
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
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('순환'))).toBe(true)
  })

  it('every 이정표가 자기 자신을 가리키면(길이 1인 순환) 잡아낸다', () => {
    const data = baseData()
    data.milestones = [
      { id: 'a', metric: { kind: 'every', of: ['a'] }, threshold: 1, name: 'A', announce: '', effect: { kind: 'title' } },
    ]
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
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
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[impossible]: threshold(2) 가 of 길이(1) 보다 크다 — 영원히 달성할 수 없다',
    )
  })

  it('recipes 효과의 threshold 가 실제 레시피 requiredSkill 과 다르면 잡아낸다', () => {
    // baseData() 의 copper_hammer 레시피는 requiredSkill 3 인데, 이 이정표는 999 를
    // 넘어야 열린다고 선언한다 — 목록이 플레이어에게 거짓 문턱을 보여주는 상황이다.
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'wrong_threshold', metric: { kind: 'skill', skill: 'crafting' }, threshold: 999,
        name: '틀린 문턱', announce: '', effect: { kind: 'recipes', ids: ['copper_hammer'] },
      },
    ]
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[wrong_threshold]: 레시피 "copper_hammer" 의 requiredSkill(3) 이 이정표 threshold(999) 와 다르다',
    )
  })

  it('recipes 효과의 threshold 가 레시피 requiredSkill 과 같으면 위반이 없다', () => {
    // baseData 의 채움용 이정표(crafting_3)를 빼고 넣는다 — 그대로 두면 같은
    // 레시피가 두 이정표에 실려 "정확히 하나" 검사(§7-앞 5)에 걸린다.
    const data = baseData()
    data.milestones = [
      mineralRepeatMilestone,
      {
        id: 'right_threshold', metric: { kind: 'skill', skill: 'crafting' }, threshold: 3,
        name: '맞는 문턱', announce: '', effect: { kind: 'recipes', ids: ['copper_hammer'] },
      },
    ]
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  // ---- requiredSkill > 0 레시피 ⊆ recipes-이정표 (역방향, 설계 §7-앞 5) ----
  //
  // 기존 검사는 이정표 → 레시피 방향만 봤다(threshold == requiredSkill). 반대
  // 방향이 비면, 요구치 있는 레시피를 만들고 이정표에 싣는 것을 잊었을 때 그
  // 레시피가 목록방에서 조용히 빠진다 — 원작의 "잠긴 것까지 보이는 목록"이
  // 말없이 구멍 나는 자리다.

  it('requiredSkill > 0 인데 어느 recipes 이정표에도 실리지 않은 레시피를 잡아낸다', () => {
    const data = baseData()
    data.milestones = [mineralRepeatMilestone] // copper_hammer(requiredSkill 3)를 싣던 이정표를 뺀다
    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_hammer]: requiredSkill(3) 이 0 보다 큰데 어느 recipes 이정표에도 실리지 않았다 — 목록방에서 조용히 빠진다. milestones.csv 에 effectKind=recipes 로 싣는다',
    )
  })

  it('한 레시피가 recipes 이정표 여럿에 실리면 잡아낸다', () => {
    const data = baseData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'crafting_3_dup', metric: { kind: 'skill', skill: 'crafting' }, threshold: 3,
        name: '중복 문턱', announce: '', effect: { kind: 'recipes', ids: ['copper_hammer'] },
      },
    ]
    expect(validateGameData(data, baseTables())).toContain(
      'recipes[copper_hammer]: recipes 이정표 [crafting_3,crafting_3_dup] 2개에 실렸다 — 정확히 하나여야 한다',
    )
  })

  it('requiredSkill 0 인 레시피는 이정표 없이도 통과한다 — 처음부터 열려 있는 문이다', () => {
    // baseData 의 copper_ingot·copper_pickaxe(requiredSkill 0)는 어느 recipes 이정표에도 없다.
    expect(validateGameData(baseData(), baseTables())).toEqual([])
  })

  it('채집 기술에 repeat 이정표가 없으면 잡아낸다', () => {
    const data = baseData()
    data.milestones = [] // mineral 채집 기술(baseData 의 유일한 노드가 쓰는 기술)의 repeat 이정표가 없다
    expect(validateGameData(data, baseTables())).toContain(
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
    expect(validateGameData(data, baseTables())).toContain(
      'skills[mineral]: repeat 이정표가 정확히 1개여야 하는데 [mineral_repeat,mineral_repeat_2](2개)다',
    )
  })

  it('repeat 이정표의 threshold 가 행동 간격 200ms 지점이 아니면 잡아낸다', () => {
    // 100 은 actionIntervalMs(100) = 350ms 인 지점이라, 자동 반복 해금 문턱(연타로
    // 따라잡을 수 없어지는 200ms 지점)이 아니다.
    const data = baseData()
    data.milestones = [{ ...mineralRepeatMilestone, threshold: 100 }]
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[mineral_repeat]: threshold(100) 의 행동 간격이 200ms 가 아니라 350ms 다 — 자동 반복 해금 문턱은 연타로 따라잡을 수 없어지는 지점이어야 한다',
    )
  })

  it('실제로 출하되는 CSV 데이터는 이정표 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

// ---- 대화 검사 ----
//
// 화자·대사 픽스처는 baseData() 를 베이스로 speakers·dialogue 만 바꾼다 —
// 나머지(아이템·노드·레시피·이정표)는 baseData() 가 이미 위반 0건을 보장하므로,
// 대화 검사 하나만 격리해서 볼 수 있다.

const testSpeaker: SpeakerDef = { id: '노인', name: '노인', kind: 'npc', mapId: 'world', x: 0, y: 0, sprite: 'npc', facing: 'down' }

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
    expect(validateGameData(data, baseTables())).toContain('dialogue[노인] 노인.dlg:1행: 선언되지 않은 사실 "affinty" 를 쓴다')
  })

  it('실제로 출하되는 대사 데이터는 전부 선언된 사실만 쓴다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('선언되지 않은 사실'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 값의 모양', () => {
  // 설계 문서 7장이 처음부터 요구한 검사다("값의 형태가 맞지 않는 조건 —
  // season=화요일"). 사실마다 "값이 무엇일 수 있는가" 가 코드에 없어서 미뤄
  // 뒀는데, FactSpec.value 가 생기면서 그 정보가 생겼다.

  it('정해진 목록 밖의 값을 쓴 조건을 잡아낸다 — season=화요일', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'tue', event: 'greet', conditions: [{ fact: 'season', op: '=', value: '화요일' }] }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('season=화요일') && v.includes('spring, summer, autumn, winter'))).toBe(
      true,
    )
  })

  it('참거짓 사실에 숫자를 건 조건을 잡아낸다 — 조용히 "절대 안 맞는 조건"이 된다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'one', event: 'greet', conditions: [{ fact: 'milestone.mineral_repeat', op: '=', value: 1 }] }),
    ]
    expect(validateGameData(data, baseTables()).some((v) => v.includes('true 또는 false'))).toBe(true)
  })

  it('숫자 사실에 문자열을 건 조건을 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'dawn', event: 'greet', conditions: [{ fact: 'hour', op: '<', value: '아침' }] }),
    ]
    expect(validateGameData(data, baseTables()).some((v) => v.includes('hour') && v.includes('숫자여야 한다'))).toBe(true)
  })

  it('공급자가 없어 값 모양이 아직 정해지지 않은 사실은 따지지 않는다 — 그 모양은 안 만든 스펙이 정한다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 's', event: 'greet', conditions: [{ fact: 'story', op: '=', value: 3 }] }),
      dRule({ id: 'q', event: 'greet', conditions: [{ fact: 'quest.촌장', op: '=', value: 3 }] }),
    ]
    expect(validateGameData(data, baseTables()).some((v) => v.includes('모양'))).toBe(false)
  })

  it('없는 날씨를 건 조건을 잡아낸다 — 공급자가 생기면서 그 값의 목록도 정해졌다', () => {
    // weather 는 오래 "모양이 정해지지 않은 사실" 쪽에 있었다(위 검사의 옛 예시가
    // 그것이었다). 하늘이 될 수 있는 것은 rain·snow 둘뿐이므로 `weather=fog` 는
    // 이제 오타이고, 안 막으면 그 대사는 어떤 상황에서도 안 나온다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'fog', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'fog' }] }),
    ]
    expect(validateGameData(data, baseTables()).some((v) => v.includes('weather') && v.includes('모양'))).toBe(true)
  })

  it('실제로 출하되는 대사 데이터는 값의 모양이 전부 맞는다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('모양'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 무조건 인사', () => {
  it('@greet 무조건 규칙이 없는 화자를 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    // greet 이 전부 조건부라 weather 가 비 오는 상태가 아니면 노인은 할 말이 없다.
    data.dialogue = [dRule({ id: 'rain', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'rain' }] })]
    expect(validateGameData(data, baseTables())).toContain(
      'dialogue[노인]: @greet 무조건 규칙이 없다 — 말을 걸어도 아무 일도 안 일어날 수 있다',
    )
  })

  it('대사 파일이 아예 없는 화자는 이 검사가 아니라 "대사 파일이 없다" 검사가 알린다', () => {
    // 같은 원인(대사가 없다)을 두 검사가 동시에 보고하면 노이즈만 커진다.
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = []
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('무조건 규칙이 없다'))).toBe(false)
    expect(violations).toContain('speakers[노인]: 대사 파일이 없다')
  })

  it('실제로 출하되는 화자는 전부 무조건 인사가 있다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('무조건 규칙이 없다'))
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
    expect(validateGameData(data, baseTables())).toContain(
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
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
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
    const violations = validateGameData(data, baseTables())
    expect(violations.filter((v) => v.startsWith('dialogue['))).toEqual([])
  })

  it('실제로 출하되는 대사 데이터는 이 검사를 통과한다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('동시에 참일 수 없다'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 크기 범위 경계값(양 끝이 같은 값)', () => {
  // contradicts 에서 가장 미묘한 분기다: 위의 100/50, 100/200 테스트는 둘 다 경계에서
  // 멀리 떨어진 값이라 "양 끝이 같은 값" 분기(validate.ts 의 lower.value === upper.value)를
  // 아예 타지 않는다. 등호 포함 여부(>= vs >, <= vs <) 네 조합을 전부 값 100 에서 박아
  // 둬야, 이 분기가 조용히 반대로 뒤집혀도(">=100" 을 빈 구간으로 잘못 판정하거나
  // ">100" 을 살아있다고 잘못 판정해도) 통과하던 스위트가 그대로 통과해 버리는
  // 사고를 막는다.

  it('>=100 과 <=100 은 100 이라는 값 하나가 둘 다 만족시켜 잡지 않는다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'closedClosed',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '>=', value: 100 },
          { fact: 'skill.ice', op: '<=', value: 100 },
        ],
      }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('동시에 참일 수 없다'))).toBe(false)
  })

  it('>100 과 <=100 은 100 을 아래쪽이 배제해 구간이 비어 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'openClosed',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '>', value: 100 },
          { fact: 'skill.ice', op: '<=', value: 100 },
        ],
      }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('"skill.ice>100" 과 "skill.ice<=100" 가 동시에 참일 수 없다'))).toBe(
      true,
    )
  })

  it('>=100 과 <100 은 100 을 위쪽이 배제해 구간이 비어 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'closedOpen',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '>=', value: 100 },
          { fact: 'skill.ice', op: '<', value: 100 },
        ],
      }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('"skill.ice>=100" 과 "skill.ice<100" 가 동시에 참일 수 없다'))).toBe(
      true,
    )
  })

  it('>100 과 <100 은 양쪽 다 열려 있어 100 도 배제해 구간이 비어 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'openOpen',
        event: 'greet',
        conditions: [
          { fact: 'skill.ice', op: '>', value: 100 },
          { fact: 'skill.ice', op: '<', value: 100 },
        ],
      }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('"skill.ice>100" 과 "skill.ice<100" 가 동시에 참일 수 없다'))).toBe(true)
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
    expect(validateGameData(data, baseTables())).toContain(
      'dialogue[노인] 노인.dlg:1행: 알 수 없는 사건 "greeet" — 쓸 수 있는 사건은 story, quest, milestone, greet 이다',
    )
  })

  it('실제로 출하되는 대사 데이터의 사건 이름은 전부 알려진 것이다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('알 수 없는 사건'))
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 다른 데이터의 오타에 가려지지 않는다', () => {
  it('참조 무결성 위반이 있어도 대사 위반을 함께 보고한다', () => {
    // 대사 검사가 이른 반환(참조 무결성 위반 시 멈춤) 뒤에 있으면, nodes.csv
    // 오타 하나가 대사 위반 전부를 조용히 덮는다 — 작가는 한 가지를 고치고
    // 다시 빌드해서야 두 번째 파도를 만난다.
    const data = baseData()
    data.nodes.copper_vein!.tableId = 'ghost_table'
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'typo', event: 'greet', conditions: [{ fact: 'affinty', op: '=', value: 30 }] }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations).toContain(
      'nodes[copper_vein]: 존재하지 않는 표 "ghost_table" 를 가리킨다 — gather_tables.csv 의 tableId 중 하나여야 한다',
    )
    expect(violations).toContain('dialogue[노인] 노인.dlg:1행: 선언되지 않은 사실 "affinty" 를 쓴다')
  })

  it('대사 위반이 있어도 도달 가능성 검사는 계속 돈다', () => {
    // 반대 방향도 같다. 이른 반환은 "참조 무결성이 깨지면 도달 가능성 계산이
    // 오염된다"를 막으려고 있는 것인데, 대사 위반에는 그 오염 관계가 없다 —
    // 그것 때문에 건너뛰면 대사 오타 하나가 아이템 데드락을 덮어 똑같이
    // 두 번 빌드하게 만든다.
    const data = craftLockedData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({ id: 'typo', event: 'greet', conditions: [{ fact: 'affinty', op: '=', value: 30 }] }),
    ]
    const violations = validateGameData(data, baseTables())
    expect(violations).toContain('dialogue[노인] 노인.dlg:1행: 선언되지 않은 사실 "affinty" 를 쓴다')
    expect(violations).toContain(
      'items[iron_pickaxe]: 도달할 수 없다 — 맵에 놓인 어느 노드의 표에도 없고, 어느 상점도 팔지 않으며, 어느 드랍표에도 없고, 재료가 전부 도달 가능한 레시피도 없다',
    )
  })
})

describe('validateGameData 의 대화 검사 — 화자·대사 파일 대응', () => {
  it('대사 파일이 없는 화자(배치)를 잡아낸다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = []
    expect(validateGameData(data, baseTables())).toContain('speakers[노인]: 대사 파일이 없다')
  })

  it('화자가 없는 대사 파일을 잡아낸다', () => {
    const data = baseData()
    data.speakers = {}
    data.dialogue = [unconditionalGreet()]
    expect(validateGameData(data, baseTables())).toContain('dialogue[노인]: 화자 정의(speakers.csv)가 없다')
  })

  it('실제로 출하되는 데이터는 화자·대사 파일이 서로 대응한다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter(
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
    expect(validateGameData(data, baseTables())).toContain(
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
    expect(validateGameData(data, baseTables())).toContain('dialogue[노인] 노인.dlg:1행: 존재하지 않는 기술 "mining" 를 가리킨다')
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
    expect(validateGameData(data, baseTables())).toContain(
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
    const violations = validateGameData(data, baseTables())
    expect(violations.some((v) => v.includes('justAchieved'))).toBe(false)
  })

  it('실제로 출하되는 대사 데이터는 전부 존재하는 이정표·기술만 가리킨다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter(
      (v) => v.includes('존재하지 않는 이정표') || v.includes('존재하지 않는 기술'),
    )
    expect(violations).toEqual([])
  })
})

describe('validateGameData 의 대화 검사 — 한 번만 하는 말의 조건은 전부 =', () => {
  // onceKey 는 규칙의 조건들이 "지금 갖는 값"을 연산자와 무관하게 그대로
  // 엮는다. 그러니 물어야 할 것은 그 사실의 정의역에 상한이 있는가가 아니라
  // **규칙이 맞고 있는 동안 그 값이 달라질 수 있는가**이고, 값을 하나로
  // 못박는 연산자는 = 하나뿐이다. 상한 유무로 묻던 시절에는 hour·season 이
  // 상한이 있다는 이유로 그냥 통과했다 — 아래 첫 테스트가 그 구멍이다.

  /** 이 검사가 낸 위반만 고른다 — 다른 검사의 위반과 섞이면 무엇을 봤는지 흐려진다. */
  const onceViolations = (data: GameData): string[] =>
    validateGameData(data, baseTables()).filter((v) => v.includes('한 번만 하는 말'))

  function withRule(rule: DialogueRule): GameData {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [unconditionalGreet(), rule]
    return data
  }

  it('상한이 있는 사실이라도 잡아낸다 — "밤에만"을 붙인 한 마디가 밤마다 다시 나오면 안 된다', () => {
    // hour 는 0~23 로 상한이 있어 예전 검사(FactSpec.unbounded)를 그냥
    // 통과했다. 그런데 값은 매 시각 달라지므로 onceKey 는 시각마다 새 키를
    // 만들고, 그 한 마디는 밤마다 한 번씩 영원히 나온다.
    const violations = onceViolations(
      withRule(
        dRule({
          id: 'atNight',
          event: 'milestone',
          conditions: [
            { fact: 'justAchieved', op: '=', value: 'mineral_repeat' },
            { fact: 'hour', op: '>=', value: 12 },
          ],
        }),
      ),
    )
    expect(violations).toEqual([
      'dialogue[노인] 노인.dlg:1행: 한 번만 하는 말(@milestone)의 조건에 = 아닌 연산자를 썼다: "hour>=12" — 한 번만 하는 말은 조건에 건 사실의 "지금 값"까지 함께 기억해 두었다가 그 값이 달라지면 다시 말한다. = 이 아닌 조건은 값이 달라져도 계속 맞으므로, 그 사실이 바뀔 때마다 같은 말을 처음부터 다시 하게 된다. 값을 하나로 못박는 = 로 바꾼다. 범위 그대로 말하고 싶으면 이 규칙을 @greet 으로 옮긴다 — @greet 만 매번 다시 후보에 올라서 어떤 연산자든 쓸 수 있다',
    ])
  })

  it('숙련도 문턱에는 바꿔 쓸 이정표 id 를 짚어 준다 — 거절만 하면 "그럼 못 쓰는 건가"로 읽힌다', () => {
    // baseData 의 유일한 이정표가 mineral 10000 이라 그 문턱을 쓴다.
    const violations = onceViolations(
      withRule(dRule({ id: 'grind', event: 'story', conditions: [{ fact: 'skill.mineral', op: '>=', value: 10000 }] })),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('"milestone.mineral_repeat=true" 로 바꾼다')
  })

  it('그 문턱의 이정표가 아직 없으면 id 를 지어내지 않는다 — 없는 id 를 권하면 다음 빌드가 또 막는다', () => {
    const violations = onceViolations(
      withRule(dRule({ id: 'grind', event: 'story', conditions: [{ fact: 'skill.ice', op: '>=', value: 50000 }] })),
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('csv/milestones.csv 에 이정표로 먼저 적고')
    expect(violations[0]).not.toContain('milestone.ice_50000=true')
  })

  it('!= 도 잡아낸다 — onceKey 는 연산자를 보지 않으므로 크기 비교와 똑같이 값이 갈아치워진다', () => {
    const violations = onceViolations(
      withRule(dRule({ id: 'notZero', event: 'quest', conditions: [{ fact: 'skill.ice', op: '!=', value: 0 }] })),
    )
    expect(violations.some((v) => v.includes('"skill.ice!=0"'))).toBe(true)
  })

  it('조건이 여럿이면 = 아닌 것마다 한 줄씩 나온다 — 한 줄만 고치고 다시 막히지 않게', () => {
    const violations = onceViolations(
      withRule(
        dRule({
          id: 'both',
          event: 'quest',
          conditions: [
            { fact: 'hour', op: '>=', value: 12 },
            { fact: 'dayOfSeason', op: '<', value: 5 },
          ],
        }),
      ),
    )
    expect(violations).toHaveLength(2)
  })

  it('= 는 괜찮다 — quest.촌장=3 패턴은 계속 동작해야 한다', () => {
    const data = withRule(dRule({ id: 'chief3', event: 'quest', conditions: [{ fact: 'quest.촌장', op: '=', value: 3 }] }))
    expect(onceViolations(data)).toEqual([])
  })

  it('숙련도처럼 계속 오르는 사실도 = 면 괜찮다 — 값이 하나로 못박혀 키가 고정된다', () => {
    const data = withRule(dRule({ id: 'exact', event: 'milestone', conditions: [{ fact: 'skill.ice', op: '=', value: 10000 }] }))
    expect(onceViolations(data)).toEqual([])
  })

  it('@greet 은 매번 다시 후보에 오르므로 어떤 연산자든 쓸 수 있다', () => {
    // 채집장노인.dlg 의 실제 규칙(@greet skill.ice>=50000)과 같은 모양이다.
    const data = withRule(dRule({ id: 'veteran', event: 'greet', conditions: [{ fact: 'skill.ice', op: '>=', value: 50000 }] }))
    expect(onceViolations(data)).toEqual([])
  })

  it('실제로 출하되는 대사 데이터는 이 검사를 통과한다', () => {
    expect(onceViolations(loadRealGameData())).toEqual([])
  })
})

// ---- 등록부 검사(설계 §4·§6-앞 2·11·12·13) ----
//
// 상점과 달인 대금은 대사가 아니라 등록부가 소유한다(§6-앞 1·2). 그래서 오타의
// 증상이 전부 "말은 걸리는데 가게가 안 열린다"·"문턱을 넘었는데 대금이 안 온다"
// 처럼 화면에서 원인을 되짚을 수 없는 모양이라, 빌드가 대신 본다.
//
// 이 자리가 대화 검사 뒤인 것은 픽스처 때문이다 — 상점은 화자를 가리키므로
// 위(testSpeaker·unconditionalGreet)에서 만들어 둔 화자 픽스처를 그대로 쓴다.

/** 상점·달인 픽스처의 바탕 — 화자 하나와 그 화자의 무조건 인사가 있다. */
function registryData(): GameData {
  const data = baseData()
  data.speakers = { 노인: testSpeaker }
  data.dialogue = [unconditionalGreet()]
  return data
}

/** baseData 의 유일한 계열(mineral)을 사 주는 상점 하나. */
function mineralShop(overrides: Partial<ShopDef> = {}): ShopDef {
  return { id: '광물상점', name: '광물 상점', speakerId: '노인', skill: 'mineral', unlockSkill: 5000, stock: [], ...overrides }
}

describe('validateGameData 의 상점 등록부 검사', () => {
  it('상점만 더해도 위반이 없다', () => {
    const data = registryData()
    data.shops = { 광물상점: mineralShop() }
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('없는 화자를 가리키는 상점을 잡아낸다', () => {
    // 화자가 없으면 그 상점을 열 문이 세상에 없다 — 상점은 화자에게 말을 걸어야
    // 열리므로(§6-앞 1), 오타는 "데이터에는 있는데 아무도 못 여는 가게"가 된다.
    const data = registryData()
    data.shops = { 광물상점: mineralShop({ speakerId: '유령' }) }
    expect(validateGameData(data, baseTables())).toEqual([
      'shops[광물상점]: 없는 화자 "유령" 를 가리킨다 — speakers.csv 의 id 중 하나여야 한다',
    ])
  })

  it('한 화자가 두 상점을 열면 잡아낸다', () => {
    // talkService 는 speakerId 로 상점을 찾는다 — 둘이면 어느 쪽이 열릴지
    // 정해지지 않고, 그 선택은 레코드의 순회 순서라는 아무 뜻 없는 것에 걸린다.
    const data = registryData()
    data.shops = {
      광물상점: mineralShop(),
      얼음상점: mineralShop({ id: '얼음상점', name: '얼음 상점', skill: 'ice' }),
    }
    expect(validateGameData(data, baseTables())).toContain(
      'shops[얼음상점]: 화자 "노인" 는 이미 상점 "광물상점" 을 연다 — 한 화자가 두 상점을 열 수는 없다',
    )
  })

  it('없는 아이템을 진열한 상점을 잡아낸다', () => {
    // 진열은 화면의 목록이 되고 매수 판정의 대상이 된다 — 없는 id 는 살 수 없는
    // 칸으로 조용히 남는다.
    const data = registryData()
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: '유령증표', unlockBy: 'skill', unlockAt: 10000 }] }) }
    expect(validateGameData(data, baseTables())).toContain(
      'shops[광물상점]: 없는 아이템 "유령증표" 를 진열한다 — items.csv 의 id 중 하나여야 한다',
    )
  })

  it('도구를 진열한 상점을 잡아낸다', () => {
    // 매수(tradeService.performBuy)는 무엇을 사든 player.stacks 에 넣는다 —
    // 도구가 진열되면 골드만 줄고 산 도구는 stacks 에 쌓이는데, 가방(BagPanel)은
    // 재료를 stacks 에서, 도구는 instances 에서만 그린다. 그래서 산 도구는 가방
    // 어디에도 나타나지 않고 조용히 사라진다 — E4 가 미룬 구멍(§progress.md).
    const data = registryData()
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: 'copper_pickaxe', unlockBy: 'skill', unlockAt: 10000 }] }) }
    expect(validateGameData(data, baseTables())).toContain(
      'shops[광물상점]: "copper_pickaxe" 는 도구라 진열할 수 없다 — 매수는 무엇을 사든 가방의 재료 칸(player.stacks)에 넣는데, 가방 화면은 도구를 그 칸이 아니라 instances 에서만 그린다. 산 도구는 골드만 줄이고 가방 어디에도 나타나지 않는다. 진열은 kind 가 material 인 아이템만 할 수 있다',
    )
  })

  it('값이 0 인 아이템을 진열한 상점을 잡아낸다', () => {
    // price 0 은 "팔 수 없다"는 뜻이지 "공짜"가 아니다(설계 §2). 그런데 진열에
    // 놓이면 그 뜻이 뒤집힌다: 화면은 총액 0 을 적은 채 [사기] 를 살려 두고
    // (maxBuyCount 가 0 을 돌려줘도 clampCount 는 1 을 돌려준다) 서버의
    // `gold < cost` 검사도 0 앞에서는 통과한다 — 무한 무료 아이템이 된다.
    const data = registryData()
    data.items.gravel = testItem('gravel', { name: '자갈', icon: 'ore_copper', price: 0, skill: 'mineral' })
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: 'gravel', unlockBy: 'skill', unlockAt: 10000 }] }) }
    expect(validateGameData(data, baseTables())).toEqual([
      'shops[광물상점]: "gravel" 은 price 가 0 이라 진열할 수 없다 — price 0 은 "팔 수 없다"는 뜻이지 "공짜"가 아니다. 값이 0 이면 매수 총액이 0 이라 골드 검사가 언제나 통과해 누구나 무한히 가져간다. items.csv 의 price 를 1 이상으로 올리거나 shop_stock.csv 에서 그 줄을 지운다',
    ])
  })

  it('남의 계열 아이템을 진열한 상점을 잡아낸다', () => {
    // 숙련 잠금 칸의 요구치(unlockSkill)도 화면의 "현재/필요"도 전부 **상점의
    // 계열**을 잰다(§6-앞 14). 그래서 나무 증표를 얼음상점에 놓으면 그것이 얼음
    // 숙련도로 열리고 화면은 "얼음 0/10,000"을 적는다 — 데이터에 적힌 계열과
    // 화면이 말하는 계열이 갈라지는데, 그 어긋남을 화면에서 되짚을 방법이 없다.
    const data = registryData()
    data.items.ice_shard = testItem('ice_shard', { name: '얼음 조각', icon: 'shard_ice', price: 50, skill: 'ice' })
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: 'ice_shard', unlockBy: 'skill', unlockAt: 10000 }] }) }
    expect(validateGameData(data, baseTables())).toEqual([
      'shops[광물상점]: "ice_shard" 는 "ice" 계열인데 이 상점은 "mineral" 계열이다 — 숙련 잠금 칸이면 요구치와 화면의 "현재/필요"가 상점 계열의 숙련도를 재는데 엉뚱한 계열의 문턱이 되고, 수집 잠금(되사기) 칸이면 "자기 계열만 되판다"는 규칙이 깨진다. shop_stock.csv 에서 그 줄을 "ice" 상점으로 옮기거나 items.csv 의 skill 을 고친다',
    ])
  })

  it('실제로 출하되는 CSV 데이터는 상점 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

/**
 * 되사기 게이트(§6-앞 7) — 이정표의 선언과 진열의 실물이 맞물리는가.
 *
 * `recipes` 이정표를 양방향으로 보는 검사와 같은 자세다: 이정표는 **새 게이트를
 * 만들지 않고 이미 데이터가 강제하는 게이트를 선언**한다. 한쪽만 있으면 증상이
 * 둘로 갈린다 — 선언만 있으면 목록에 열리지 않는 문이 뜨고, 진열만 있으면
 * 플레이어는 그 문이 있는 줄도 모른 채 지나간다.
 */
describe('validateGameData 의 되사기 게이트 검사', () => {
  /** 총점 30 에서 열리는 되사기 진열과, 그것을 선언하는 이정표 — 맞물린 한 쌍. */
  function buybackData(): GameData {
    const data = registryData()
    data.collection = { copper_ore: { itemId: 'copper_ore', steps: [1, 10, 100, 1000] } }
    data.shops = {
      광물상점: mineralShop({ stock: [{ itemId: 'copper_ore', unlockBy: 'collection', unlockAt: 4 }] }),
    }
    data.milestones = [
      ...data.milestones,
      {
        id: 'collection_4', metric: { kind: 'collection' }, threshold: 4,
        name: '흔한 것을 되살 수 있다', announce: '', effect: { kind: 'stock' },
      },
    ]
    return data
  }

  it('맞물린 한 쌍은 위반이 없다', () => {
    expect(validateGameData(buybackData(), baseTables())).toEqual([])
  })

  it('선언만 있고 그 총점에서 열리는 진열이 없으면 잡아낸다', () => {
    const data = buybackData()
    data.shops = { 광물상점: mineralShop() }
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[collection_4]: 총점 4 에서 열리는 진열이 하나도 없다 — shop_stock.csv 의 unlockCollection 에 4 인 행이 있어야 이 선언이 실물을 가리킨다',
    )
  })

  it('진열만 있고 선언이 없으면 잡아낸다 — 목록방에서 조용히 빠지는 문이다', () => {
    const data = buybackData()
    data.milestones = data.milestones.filter((m) => m.id !== 'collection_4')
    expect(validateGameData(data, baseTables())).toContain(
      'shop_stock.csv: unlockCollection 4 로 열리는 진열이 있는데 어느 stock 이정표에도 실리지 않았다 — 목록방에서 조용히 빠져 플레이어는 그 문이 있는 줄도 모른다. milestones.csv 에 metricKind=collection·threshold=4·effectKind=stock 으로 싣는다',
    )
  })

  it('같은 총점을 두 이정표가 선언하면 잡아낸다 — 목록에 같은 문이 두 번 열린다', () => {
    const data = buybackData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'collection_4_again', metric: { kind: 'collection' }, threshold: 4,
        name: '또 그 문', announce: '', effect: { kind: 'stock' },
      },
    ]
    expect(validateGameData(data, baseTables())).toContain(
      'shop_stock.csv: unlockCollection 4 가 stock 이정표 [collection_4,collection_4_again] 2개에 실렸다 — 정확히 하나여야 한다. 목록에 같은 문이 두 번 열리는 것으로 보인다',
    )
  })

  it('되사기를 선언하면서 지표가 숙련도면 잡아낸다 — 목록이 엉뚱한 눈금으로 진척을 적는다', () => {
    const data = buybackData()
    data.milestones = data.milestones.map((m) =>
      m.id === 'collection_4' ? { ...m, metric: { kind: 'skill' as const, skill: 'mineral' as const } } : m,
    )
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[collection_4]: effectKind=stock 인데 metricKind 가 "skill" 다 — 되사기 진열을 여는 것은 수집 총점이므로 metricKind 도 collection 이어야 한다',
    )
  })

  it('만점보다 큰 총점 문턱을 잡아낸다 — 방을 통째로 채워도 닿지 않는 줄이다', () => {
    const data = buybackData()
    // 칸 하나짜리 방의 만점은 1 × 4 = 4 다. 5 는 영원히 못 넘는다.
    data.milestones = data.milestones.map((m) => (m.id === 'collection_4' ? { ...m, threshold: 5 } : m))
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[collection_4]: threshold(5) 가 수집 만점(4 = 칸 1개 × 4등급)보다 크다 — 영원히 달성할 수 없다',
    )
  })

  // 왜: sage 행 하나를 collection.csv 에서 지우면 원인은 하나(칸이 빠졌다)인데,
  //     collection.ts 의 "칸 목록" 검사와 이 만점 검사가 같은 원인을 따로 알려
  //     위반이 둘로 보인다. 만점은 칸 수에서 유도되므로, 칸 수 자체가 틀린
  //     상태에서 잰 만점은 뜻이 없다 — 칸 목록이 어긋나 있으면 이 검사는
  //     묻지 않아야 한다.
  it('칸 목록이 채집표와 어긋나 있으면 만점 검사를 건너뛴다 — 원인 하나를 위반 둘로 보고하지 않는다', () => {
    const data = buybackData()
    // 표는 두 번째 채집물(silver_ore)을 아는데 방에는 그 칸이 없다 — sage 행
    // 하나를 지운 것과 같은 모양이다.
    const tables = baseTables()
    tables.mineral = { ...tables.mineral!, tiers: [...tables.mineral!.tiers, { itemId: 'silver_ore' }] }
    // 칸 하나(copper_ore)짜리 방의 만점은 4 다. 100 은 그 만점보다 훨씬 크므로,
    // 칸 목록 위반을 건너뛰지 않으면 이 검사가 여전히 빨개진다.
    data.milestones = data.milestones.map((m) => (m.id === 'collection_4' ? { ...m, threshold: 100 } : m))
    const violations = validateGameData(data, tables)
    expect(violations.some((v) => v.includes('수집 만점'))).toBe(false)
  })
})

describe('validateGameData 의 결계 게이트 검사', () => {
  /**
   * 결계 하나 — 문(transitions)과 그것을 선언하는 이정표(milestones) 한 쌍.
   *
   * 되사기(buybackData)와 같은 모양의 픽스처다. 저쪽이 `shop_stock.csv` 의
   * `unlockCollection` 과 짝이라면 이쪽은 `transitions.csv` 의 `gateSkill`·
   * `gateValue` 와 짝이고, 검사가 묻는 것도 같다 — **선언과 실물이 서로를 아는가**.
   */
  function barrierData(): GameData {
    const data = registryData()
    data.transitions = [
      { fromMap: 'world', fromX: 5, fromY: 4, toMap: 'world', toX: 5, toY: 2, facing: 'up', gateSkill: 'mineral', gateValue: 85000 },
      // 나오는 문 — 게이트가 없으므로 이 검사의 대상이 아니다(§9-앞 16).
      { fromMap: 'world', fromX: 5, fromY: 2, toMap: 'world', toX: 5, toY: 4, facing: 'down' },
    ]
    data.milestones = [
      ...data.milestones,
      {
        id: 'mineral_85000', metric: { kind: 'skill', skill: 'mineral' }, threshold: 85000,
        name: '광물 결계를 넘을 수 있다', announce: '', effect: { kind: 'barrier' },
      },
    ]
    return data
  }

  it('맞물린 한 쌍은 위반이 없다', () => {
    expect(validateGameData(barrierData(), baseTables())).toEqual([])
  })

  it('선언만 있고 그 숫자를 요구하는 문이 없으면 잡아낸다', () => {
    const data = barrierData()
    data.transitions = data.transitions.filter((t) => t.gateSkill === undefined)
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[mineral_85000]: 숙련 mineral 85000 에서 열리는 결계 문이 하나도 없다 — transitions.csv 에 gateSkill=mineral·gateValue=85000 인 행이 있어야 이 선언이 실물을 가리킨다',
    )
  })

  // 왜: **이것이 이 검사의 존재 이유다.** 결계 넷을 출하하고도 85,000 이 어느
  //     목록에도 없던 그 구멍이 이 방향이다 — 문은 서 있는데 목록방이 그 숫자를
  //     한 번도 말하지 않으면, 플레이어는 벽 앞에 서고 나서야 처음 그 숫자를 읽는다.
  it('문만 있고 선언이 없으면 잡아낸다 — 목록방에서 조용히 빠지는 문이다', () => {
    const data = barrierData()
    data.milestones = data.milestones.filter((m) => m.id !== 'mineral_85000')
    expect(validateGameData(data, baseTables())).toContain(
      'transitions.csv[world (5, 4)]: gateSkill=mineral·gateValue=85000 인 문이 어느 barrier 이정표에도 실리지 않았다 — 목록방에서 조용히 빠져 플레이어는 그 숫자를 결계 앞에서야 처음 읽는다. milestones.csv 에 metricKind=skill·metricArg=mineral·threshold=85000·effectKind=barrier 로 싣는다',
    )
  })

  it('같은 문을 두 이정표가 선언하면 잡아낸다 — 목록에 같은 문이 두 번 열린다', () => {
    const data = barrierData()
    data.milestones = [
      ...data.milestones,
      {
        id: 'mineral_85000_again', metric: { kind: 'skill', skill: 'mineral' }, threshold: 85000,
        name: '또 그 벽', announce: '', effect: { kind: 'barrier' },
      },
    ]
    expect(validateGameData(data, baseTables())).toContain(
      'transitions.csv[world (5, 4)]: gateSkill=mineral·gateValue=85000 인 문이 barrier 이정표 [mineral_85000,mineral_85000_again] 2개에 실렸다 — 정확히 하나여야 한다. 목록에 같은 벽이 두 번 열리는 것으로 보인다',
    )
  })

  it('결계를 선언하면서 지표가 총점이면 잡아낸다 — 짝지을 계열이 없다', () => {
    const data = barrierData()
    data.milestones = data.milestones.map((m) =>
      m.id === 'mineral_85000' ? { ...m, metric: { kind: 'collection' as const } } : m,
    )
    expect(validateGameData(data, baseTables())).toContain(
      'milestones[mineral_85000]: effectKind=barrier 인데 metricKind 가 "collection" 다 — 결계 문이 요구하는 것은 계열 숙련도이므로 metricKind 도 skill 이어야 한다. 그래야 transitions.csv 의 gateSkill 과 짝지을 수 있다',
    )
  })

  // 왜: 계열을 잘못 적으면 "허브 85,000" 을 광물 문에 걸어 둔 목록이 된다 — 두 줄
  //     다 참인 숫자를 적으면서 서로 다른 것을 가리키고, 어느 화면도 이상해지지
  //     않는다. 양방향이라 위반이 둘 뜬다(선언은 실물이 없고, 실물은 선언이 없다).
  it('계열이 어긋나면 양쪽에서 잡아낸다', () => {
    const data = barrierData()
    data.milestones = data.milestones.map((m) =>
      m.id === 'mineral_85000' ? { ...m, metric: { kind: 'skill' as const, skill: 'herb' as const } } : m,
    )
    const violations = validateGameData(data, baseTables())
    expect(violations).toContain(
      'milestones[mineral_85000]: 숙련 herb 85000 에서 열리는 결계 문이 하나도 없다 — transitions.csv 에 gateSkill=herb·gateValue=85000 인 행이 있어야 이 선언이 실물을 가리킨다',
    )
    expect(violations.some((v) => v.startsWith('transitions.csv[world (5, 4)]:'))).toBe(true)
  })

  // 왜: 물때는 숙련 문턱 위에 얹힌 두 번째 조건이지 짝의 열쇠가 아니다(허브 결계).
  //     열쇠로 세면 같은 85,000 문이 물때 유무로 둘로 갈라져, 물때 문 하나가
  //     "선언이 없다" 라고 잘못 고발된다.
  it('물때까지 지는 문도 숙련 문턱 하나로 짝지어진다', () => {
    const data = barrierData()
    data.transitions = data.transitions.map((t) =>
      t.gateSkill === undefined ? t : { ...t, gateTide: true },
    )
    expect(validateGameData(data, baseTables())).toEqual([])
  })
})

describe('validateGameData 의 달인 등록부 검사', () => {
  it('없는 화자를 가리키는 달인을 잡아낸다', () => {
    const data = registryData()
    data.masters = [{ id: 'mineral_master', speakerId: '유령', skill: 'mineral', threshold: 21345, gold: 300000 }]
    expect(validateGameData(data, baseTables())).toEqual([
      'masters[mineral_master]: 없는 화자 "유령" 를 가리킨다 — speakers.csv 의 id 중 하나여야 한다',
    ])
  })

  it('한 화자에게 달인이 둘이면 잡아낸다', () => {
    // 서버는 말을 건 화자로 대금을 찾는다 — 둘이면 한 번의 대화가 무엇을
    // 지급하는지 정해지지 않는다.
    const data = registryData()
    data.masters = [
      { id: 'mineral_master', speakerId: '노인', skill: 'mineral', threshold: 21345, gold: 300000 },
      { id: 'ice_master', speakerId: '노인', skill: 'ice', threshold: 63235, gold: 1000000 },
    ]
    expect(validateGameData(data, baseTables())).toContain(
      'masters[ice_master]: 화자 "노인" 에게 이미 달인 "mineral_master" 가 있다 — 한 화자는 달인 하나다',
    )
  })

  it('한 기술에 달인이 둘이면 잡아낸다', () => {
    // 같은 기술의 문턱이 두 사람 입에 나뉘어 있으면 "이 기술의 달인"이 누구인지
    // 데이터가 두 가지로 답한다.
    const data = registryData()
    data.speakers = { 노인: testSpeaker, 안주인: { ...testSpeaker, id: '안주인', name: '안주인' } }
    data.dialogue = [unconditionalGreet(), dRule({ id: 'bare2', event: 'greet', conditions: [], speaker: '안주인' })]
    data.masters = [
      { id: 'mineral_master', speakerId: '노인', skill: 'mineral', threshold: 21345, gold: 300000 },
      { id: 'mineral_master2', speakerId: '안주인', skill: 'mineral', threshold: 40000, gold: 500000 },
    ]
    expect(validateGameData(data, baseTables())).toContain(
      'masters[mineral_master2]: 기술 "mineral" 의 달인이 이미 "mineral_master" 다 — 한 기술에 달인 하나다',
    )
  })

  it('상점 화자가 달인을 겸하는 것은 정상이다 — 넷 중 셋이 실제로 그렇다', () => {
    const data = registryData()
    data.shops = { 광물상점: mineralShop() }
    data.masters = [{ id: 'mineral_master', speakerId: '노인', skill: 'mineral', threshold: 21345, gold: 300000 }]
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('실제로 출하되는 CSV 데이터는 달인 검사를 통과한다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

// ---- 증표 제약(설계 §5·§6-앞 11) ----
//
// 증표는 새 kind 가 아니라 재료 + tokenEffect 다. 그래서 "재료라면 할 수 있는 것"
// 중 증표에게는 성립하지 않는 것들을 여기서 막는다 — 안 막으면 증표가 캐지거나
// 만들어지고, 그 순간 상점이 유일한 골드 싱크라는 설계가 조용히 무너진다.

describe('validateGameData 의 증표 제약 검사', () => {
  /** registryData 에 증표 하나와 그것을 파는 상점을 얹는다 — 진열은 획득 가능 시드다. */
  function tokenData(): GameData {
    const data = registryData()
    data.items.mineral_speed_token = testItem('mineral_speed_token', {
      name: '광물 속도증표', icon: 'feather_mineral', price: 360000, skill: 'mineral', tokenEffect: 'speed',
    })
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: 'mineral_speed_token', unlockBy: 'skill', unlockAt: 10000 }] }) }
    return data
  }

  it('상점이 파는 증표는 위반이 없다', () => {
    expect(validateGameData(tokenData(), baseTables())).toEqual([])
  })

  it('계열(skill)이 없는 증표를 잡아낸다', () => {
    // 증표의 효과는 "그 계열의 채집"에 걸린다 — 계열이 없으면 무엇이 빨라지는지
    // 정해지지 않아, 산 사람에게 아무 일도 일어나지 않는다.
    const data = tokenData()
    delete data.items.mineral_speed_token!.skill
    expect(validateGameData(data, baseTables())).toContain(
      'items[mineral_speed_token]: 증표인데 계열(skill)이 없다 — 어느 계열의 채집에 걸리는 효과인지 정해지지 않는다. items.csv 의 skill 을 채운다',
    )
  })

  it('레시피 산출물인 증표를 잡아낸다', () => {
    // 만들 수 있으면 사지 않는다 — 증표는 골드를 빼내는 싱크인데, 제작으로
    // 우회되는 순간 그 골드는 어디로도 나가지 않는다.
    const data = tokenData()
    data.recipes.mineral_speed_token = {
      id: 'mineral_speed_token', name: '광물 속도증표', category: '도구', skill: 'crafting', requiredSkill: 0,
      baseChance: 0.5, inputs: [{ item: 'copper_ingot', count: 3600 }],
      output: { item: 'mineral_speed_token', count: 1 }, skillGainMin: 10, skillGainMax: 20,
    }
    expect(validateGameData(data, baseTables())).toContain(
      'items[mineral_speed_token]: 증표가 레시피 "mineral_speed_token" 의 산출물이다 — 증표는 사는 것이지 만드는 것이 아니다. recipes.csv 에서 그 레시피를 지운다',
    )
  })

  it('채집표의 티어인 증표를 잡아낸다', () => {
    // 캐서 나오는 증표는 값이 아무리 비싸도 싱크가 아니다 — 그리고 그 계열의
    // 채집이 자기 자신을 빠르게 만드는 되먹임이 된다.
    const data = tokenData()
    const tables = baseTables()
    tables.mineral!.tiers = [{ itemId: 'mineral_speed_token' }, { itemId: 'copper_ore' }]
    tables.mineral!.brackets = [{ bracketMax: null, cumulative: [3, 60000] }]
    expect(validateGameData(data, tables)).toContain(
      'items[mineral_speed_token]: 증표가 채집표 "mineral" 의 티어다 — 증표는 캐는 것이 아니다. gather_tiers.csv 에서 그 줄을 지운다',
    )
  })

  it('toolSkill 을 가진 증표를 잡아낸다', () => {
    // 증표의 존재 이유는 슬롯 경합을 돈으로 푸는 것이다(설계 §5) — 도구가 되면
    // 착용 슬롯을 먹고, 그러면 도구와 증표가 같은 자리를 두고 다툰다.
    const data = tokenData()
    data.items.mineral_speed_token = {
      ...data.items.mineral_speed_token!, kind: 'tool', toolSkill: 'mineral', toolTier: 1,
    }
    expect(validateGameData(data, baseTables())).toContain(
      'items[mineral_speed_token]: 증표가 toolSkill 을 가진다 — 증표는 슬롯을 먹지 않는 보유 효과라 도구일 수 없다. items.csv 의 kind 를 material 로 두고 toolSkill 을 비운다',
    )
  })

  it('실제로 출하되는 증표 8종은 이 제약을 전부 지킨다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

// ---- 사용 효과 제약(설계 §6-앞 1·4) ----
//
// 쓰면 하나가 사라지는 물건은 스택이어야 한다. 도구는 인스턴스(강화 수치가 붙어
// 개별 정체성을 갖는다)라 `stacks` 에 없고, 사용 판정이 소모할 개수 자체가 없다.

describe('validateGameData 의 사용 효과 검사', () => {
  it('사용 효과를 가진 도구를 잡아낸다 — 도구는 인스턴스라 소모될 수 없다', () => {
    const data = registryData()
    data.items.copper_pickaxe = {
      ...data.items.copper_pickaxe!,
      useEffect: { kind: 'weather', weather: 'rain', minutes: 60 },
    }
    expect(validateGameData(data, baseTables())).toContain(
      'items[copper_pickaxe]: 도구에 사용 효과가 붙어 있다 — 쓰면 하나가 사라지는데 도구는 스택이 아니라 인스턴스라 소모할 개수가 없다. items.csv 의 kind 를 material 로 두거나 useEffect·useValue 를 비운다',
    )
  })

  it('실제로 출하되는 가루 4종은 이 제약을 지킨다', () => {
    expect(validateGameData(loadRealGameData(), loadRealTables())).toEqual([])
  })
})

// ---- 상점 진열은 획득·도달의 시드다(§6-앞 12) ----
//
// 이것이 없으면 증표 8종이 "채집으로도 제작으로도 획득할 수 없다"로 빌드를 세운다 —
// 증표는 캐는 것도 만드는 것도 아니고 오직 사는 것이라, 사는 것이 획득 수단으로
// 세어지지 않으면 데이터가 자기 설계와 모순된다.

describe('validateGameData 의 획득·도달 시드 — 상점 진열', () => {
  it('상점이 파는 것은 캘 수도 만들 수도 없어도 획득 가능하다', () => {
    const data = registryData()
    data.items.mineral_speed_token = testItem('mineral_speed_token', {
      name: '광물 속도증표', icon: 'feather_mineral', price: 360000, skill: 'mineral', tokenEffect: 'speed',
    })
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: 'mineral_speed_token', unlockBy: 'skill', unlockAt: 10000 }] }) }
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('어느 상점도 팔지 않으면 획득할 수 없다고 잡아낸다 — 진열을 지우면 그 물건은 세상에서 사라진다', () => {
    const data = registryData()
    data.items.mineral_speed_token = testItem('mineral_speed_token', {
      name: '광물 속도증표', icon: 'feather_mineral', price: 360000, skill: 'mineral', tokenEffect: 'speed',
    })
    data.shops = { 광물상점: mineralShop() }
    expect(validateGameData(data, baseTables())).toContain(
      'items[mineral_speed_token]: 채집으로도 제작으로도 구매로도 전투 드랍으로도 획득할 수 없다',
    )
  })
})

// ---- 죽은 아이템 검사(§6-앞 13) ----
//
// 옛 성공 기준(§9-7)의 "레시피 입력 ∨ 도구 ∨ price>0" 은 가격표를 붙이고 나면
// 항상 참이라 아무것도 못 잡는다. 실제로 물어야 할 것은 **쓸 곳도 팔 곳도 없는가**
// 이고, "팔 곳"은 값이 아니라 **그 계열을 사 주는 상점이 있는가**로 정해진다.

describe('validateGameData 의 죽은 아이템 검사', () => {
  it('캘 수는 있는데 쓸 곳도 팔 곳도 없는 아이템을 잡아낸다', () => {
    // price 0 은 "팔 수 없다"는 뜻이다(설계 §2) — 상점이 그 계열을 사 주더라도
    // 이 물건만은 사 주지 않으므로, 가방에 쌓이기만 하는 죽은 재료가 된다.
    const data = registryData()
    data.shops = { 광물상점: mineralShop() }
    data.items.gravel = testItem('gravel', { name: '자갈', icon: 'gravel', price: 0, skill: 'mineral' })
    const tables = baseTables()
    tables.mineral!.tiers = [{ itemId: 'gravel' }, { itemId: 'copper_ore' }]
    tables.mineral!.brackets = [{ bracketMax: null, cumulative: [3, 60000] }]

    expect(validateGameData(data, tables)).toEqual([
      'items[gravel]: 쓸 곳도 팔 곳도 없다 — 어느 레시피의 재료도 아니고, 도구도 증표도 아니며, 어느 상점도 사 주지 않는다(매도 대상은 price 가 0 보다 크고 그 상점과 skill 이 같은 재료다). recipes.csv 의 재료로 쓰거나, items.csv 의 price·skill 을 사 줄 상점(shops.csv)에 맞춘다',
    ])
  })

  it('값이 있어도 그 계열을 사 주는 상점이 없으면 잡아낸다 — 남의 계열은 그 마을에 가야 팔린다', () => {
    // 상점은 자기 계열만 산다(설계 §4). 그러니 "값이 있다"는 것만으로는 팔 곳이
    // 있다는 뜻이 되지 않는다 — 이 구별이 이 검사의 전부다.
    const data = registryData()
    data.shops = { 광물상점: mineralShop() }
    data.items.dried_herb = testItem('dried_herb', { name: '말린 약초', icon: 'herb_dried', price: 100, skill: 'herb' })
    data.recipes.dried_herb = {
      id: 'dried_herb', name: '말린 약초', category: '가공', skill: 'crafting', requiredSkill: 0, baseChance: 0.5,
      inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'dried_herb', count: 1 },
      skillGainMin: 10, skillGainMax: 20,
    }

    expect(validateGameData(data, baseTables())).toEqual([
      'items[dried_herb]: 쓸 곳도 팔 곳도 없다 — 어느 레시피의 재료도 아니고, 도구도 증표도 아니며, 어느 상점도 사 주지 않는다(매도 대상은 price 가 0 보다 크고 그 상점과 skill 이 같은 재료다). recipes.csv 의 재료로 쓰거나, items.csv 의 price·skill 을 사 줄 상점(shops.csv)에 맞춘다',
    ])
  })

  it('레시피 재료면 팔 곳이 없어도 통과한다 — 쓸 곳이 있으면 죽은 것이 아니다', () => {
    // baseData 의 copper_ore·copper_ingot 이 그렇다: 상점이 하나도 없어도
    // 레시피가 그것들을 먹으므로 위반이 없다(위 baseData 스위트가 이미 초록이다).
    // 원석과 주괴의 값을 함께 0 으로 내린다 — 원석만 내리면 주괴가 "재료보다
    // 비싸게 팔린다"는 돈복사 검사에 걸려, 이 테스트가 보려는 것이 흐려진다.
    const data = registryData()
    data.items.copper_ore = { ...data.items.copper_ore!, price: 0 }
    data.items.copper_ingot = { ...data.items.copper_ingot!, price: 0 }
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('증표는 팔 곳이 아니라 살 곳이 있는 물건이라 그 자체로 통과한다', () => {
    // 증표는 매도 대상이 아니다(tokenEffect 가 있으면 상점이 사 주지 않는다) —
    // 그런데도 죽은 물건이 아닌 이유는 그것이 **효과**이기 때문이다.
    const data = registryData()
    data.items.mineral_speed_token = testItem('mineral_speed_token', {
      name: '광물 속도증표', icon: 'feather_mineral', price: 360000, skill: 'mineral', tokenEffect: 'speed',
    })
    data.shops = { 광물상점: mineralShop({ stock: [{ itemId: 'mineral_speed_token', unlockBy: 'skill', unlockAt: 10000 }] }) }
    expect(validateGameData(data, baseTables())).toEqual([])
  })

  it('실제로 출하되는 CSV 데이터에는 죽은 아이템이 없다 — 주괴도 레시피 재료이면서 광물상점의 매도 대상이다', () => {
    const violations = validateGameData(loadRealGameData(), loadRealTables()).filter((v) => v.includes('쓸 곳도 팔 곳도 없다'))
    expect(violations).toEqual([])
  })
})

describe('validateSpeakerPlacements', () => {
  // speakers.csv 는 화자를 타일 좌표로 놓는데, 그 좌표가 맞는지는 맵을 봐야
  // 안다 — 그래서 GameData 만 보는 validateGameData 와 달리 지형을 함께 받는다.
  // 벽 속이나 맵 밖에 놓인 화자는 화면에 나오긴 해도 옆에 설 수 없어 말을
  // 걸 방법이 없다. 노드와 겹치면 그 칸에서 무엇이 반응할지 정해지지 않는다.

  const terrains: Record<string, MapTerrain> = {
    world: { width: 30, height: 30, walls: new Set(['5,5']) },
  }

  function speakerAt(x: number, y: number): Record<string, SpeakerDef> {
    return { 노인: { ...testSpeaker, x, y } }
  }

  it('맵 밖에 놓인 화자를 잡아낸다', () => {
    const data = baseData()
    data.speakers = speakerAt(30, 3)
    data.placements = {}
    expect(validateSpeakerPlacements(data, terrains)).toContain(
      'speakers[노인]: 맵 밖 칸 (30, 3) 에 놓였다 — 맵은 가로 30, 세로 30 칸이라 x 는 0~29, y 는 0~29 이다',
    )
  })

  it('벽 칸에 놓인 화자를 잡아낸다', () => {
    const data = baseData()
    data.speakers = speakerAt(5, 5)
    data.placements = {}
    expect(validateSpeakerPlacements(data, terrains)).toContain(
      'speakers[노인]: 벽 칸 (5, 5) 에 놓였다 — 벽 속에 서 있는 셈이다. speakers.csv 의 x·y 를 빈 칸으로 옮긴다',
    )
  })

  it('노드와 같은 칸에 놓인 화자를 잡아낸다', () => {
    const data = baseData() // baseData 의 copper_vein-1 은 (0,0) 에 있다
    data.speakers = speakerAt(0, 0)
    expect(validateSpeakerPlacements(data, terrains)).toContain(
      'speakers[노인]: 노드 copper_vein-1 와 같은 칸에 있다: (0, 0) — 그 칸을 향했을 때 어느 쪽이 반응할지 정해지지 않는다',
    )
  })

  it('빈 칸에 놓인 화자는 통과한다', () => {
    const data = baseData()
    data.speakers = speakerAt(10, 10)
    expect(validateSpeakerPlacements(data, terrains)).toEqual([])
  })

  it('다른 맵의 같은 좌표에 있는 노드는 겹침이 아니다', () => {
    // 노드 칸 색인의 키에 맵이 없으면 두 맵의 (0,0) 이 한 칸으로 뭉쳐, 숲에
    // 선 화자가 월드의 노드와 겹쳤다고 오탐된다 — 맵을 늘리는 순간 나타나는
    // 종류의 거짓 위반이고, 작가는 자기 맵에는 아무것도 없는데 겹쳤다는
    // 말을 듣게 된다.
    const data = baseData()
    data.maps = {
      ...data.maps,
      숲: { id: '숲', name: '숲', file: '숲.tmx', width: 20, height: 15, spawn: { x: 1, y: 1 } },
    }
    data.speakers = { 노인: { ...testSpeaker, mapId: '숲', x: 0, y: 0 } }
    const withForest: Record<string, MapTerrain> = {
      ...terrains,
      숲: { width: 20, height: 15, walls: new Set() },
    }
    expect(validateSpeakerPlacements(data, withForest)).toEqual([])
  })

  it('없는 맵에 놓인 화자는 여기서 또 말하지 않는다 — validateGameData 가 이미 잡았다', () => {
    // 오타 하나로 위반이 둘 나오면 작가는 두 군데를 고쳐야 하는 줄 안다.
    const data = baseData()
    data.speakers = { 노인: { ...testSpeaker, mapId: '오타맵' } }
    expect(validateSpeakerPlacements(data, terrains)).toEqual([])
    expect(validateGameData(data, baseTables())).toContain(
      'speakers[노인]: 없는 맵 "오타맵" 에 놓였다 — maps.csv 의 id 중 하나여야 한다',
    )
  })

  it('실제로 출하되는 화자 배치는 통과한다', () => {
    expect(validateSpeakerPlacements(loadRealGameData(), loadRealMaps().terrains)).toEqual([])
  })
})

/**
 * 맵의 spawn 오브젝트가 정말로 설 수 있는 칸인가.
 *
 * 이 값은 새 플레이어의 시작 칸이고, 세이브가 없어진 맵을 가리킬 때 되돌아가는
 * 자리이기도 하다 — 벽이나 노드 위를 가리키면 그 두 경우 모두가 "움직일 수 없는
 * 상태로 시작한다"가 된다. 화자 배치 검사와 같은 이유로 지형이 필요해서
 * validateGameData 와 나뉜다.
 */
describe('validateMapSpawns', () => {
  const terrains: Record<string, MapTerrain> = {
    world: { width: 30, height: 30, walls: new Set(['5,5']) },
  }

  function withSpawn(x: number, y: number): GameData {
    const data = baseData()
    data.maps = { world: { ...data.maps['world']!, spawn: { x, y } } }
    return data
  }

  it('빈 칸의 spawn 은 통과한다', () => {
    expect(validateMapSpawns(withSpawn(10, 10), terrains)).toEqual([])
  })

  it('벽 칸의 spawn 을 잡아낸다 — 시작하자마자 벽 속이다', () => {
    expect(validateMapSpawns(withSpawn(5, 5), terrains).join('\n')).toMatch(
      /maps\[world\]: 시작 칸 \(5, 5\) 이 벽이다/,
    )
  })

  it('노드 칸의 spawn 을 잡아낸다', () => {
    // baseData 의 copper_vein-1 은 world (0,0) 에 있다. 노드 칸은 걸을 수
    // 없는 칸이라(WorldScene 의 blocked) 벽과 결과가 같다.
    expect(validateMapSpawns(withSpawn(0, 0), terrains).join('\n')).toMatch(/copper_vein-1/)
  })

  it('맵 밖의 spawn 을 잡아낸다', () => {
    expect(validateMapSpawns(withSpawn(30, 0), terrains).join('\n')).toMatch(/맵 밖/)
  })

  it('화자 칸의 spawn 을 잡아낸다 — 그 칸에는 화자가 서 있다', () => {
    const data = withSpawn(7, 7)
    data.speakers = { 노인: { ...testSpeaker, x: 7, y: 7 } }
    expect(validateMapSpawns(data, terrains).join('\n')).toMatch(/노인/)
  })

  it('실제로 출하되는 맵의 시작 칸은 통과한다', () => {
    expect(validateMapSpawns(loadRealGameData(), loadRealMaps().terrains)).toEqual([])
  })
})

describe('collectDialogueNotices', () => {
  // 이 검사들이 오래 weather 를 예시로 썼다. 그 사실이 공급자를 얻으면서
  // (설계 §6-앞 1~4) 예시는 아직 공급자가 없는 affinity 로 옮겼다 — 안내라는
  // 장치 자체는 남은 다섯 사실을 위해 그대로 살아 있어야 한다.
  it('공급자가 없는 사실을 쓴 대사의 줄 수를 안내로 센다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'close',
        event: 'greet',
        conditions: [{ fact: 'affinity', op: '>=', value: 30 }],
        lines: ['자네와는 이제 편하게 말하지.'],
      }),
    ]
    expect(collectDialogueNotices(data)).toContain('대사 1줄이 affinity 를 기다린다')
  })

  it('같은 사실을 쓰는 규칙이 여럿이면 줄 수를 합산한다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [
      unconditionalGreet(),
      dRule({
        id: 'close1', event: 'greet', conditions: [{ fact: 'affinity', op: '>=', value: 30 }], lines: ['한 줄'],
      }),
      dRule({
        id: 'close2', event: 'greet', conditions: [{ fact: 'affinity', op: '>=', value: 60 }],
        lines: ['두 줄', '세 줄'],
      }),
    ]
    expect(collectDialogueNotices(data)).toContain('대사 3줄이 affinity 를 기다린다')
  })

  it('공급자가 있는 사실만 쓰면 안내가 없다', () => {
    const data = baseData()
    data.speakers = { 노인: testSpeaker }
    data.dialogue = [unconditionalGreet()]
    expect(collectDialogueNotices(data)).toEqual([])
  })

  it('실제로 출하되는 대사 데이터에는 기다리는 줄이 하나도 없다 — 마지막 한 줄이 깨어났다', () => {
    // 오래 "대사 1줄이 weather 를 기다린다" 였다(채집장노인.dlg 의
    // "@greet weather=rain"). 날씨 가루가 그 사실의 공급자가 되면서 그 줄이
    // 깨어났고, 목록이 비었다 — 그것이 이 아크가 한 일의 증거다.
    //
    // toContain 이 아니라 toEqual 로 목록 전체를 못박는다. 같은 파일의
    // "@milestone justAchieved=ice_10000"(대사 2줄)이 오래 이 목록에 있었는데,
    // 그건 안내가 아니라 결함이었다 — 이 게임의 설계를 통째로 보여주는 유일한
    // 콘텐츠가 나올 수 없는 상태였다. 목록을 통째로 단언해야 어떤 사실이 다시
    // 이 목록으로 미끄러져도 조용히 지나가지 않는다.
    const notices = collectDialogueNotices(loadRealGameData())
    expect(notices).toEqual([])
  })
})
