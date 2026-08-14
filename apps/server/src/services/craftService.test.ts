import { calcCraftSuccess, craftIntervalMs, emptyDialogueHistory, type GameData, type MilestoneDef, type PlayerState } from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { performCraft } from './craftService.js'

const data: GameData = {
  items: {
    copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
    copper_ingot: testItem('copper_ingot', { name: '구리 주괴', icon: 'ingot_copper', price: 100, skill: 'mineral' }),
    copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' }),
    iron_pickaxe: testTool('iron_pickaxe', 'mineral', 2, { name: '철 곡괭이', icon: 'pickaxe_iron' }),
    // 3등급 — auto-equip 비교가 2등급 전용이 아니라 임의 등급 간 비교라는 것을
    // 이 픽스처로 못박는다(G5).
    mithril_pickaxe: testTool('mithril_pickaxe', 'mineral', 3, { name: '미스릴 곡괭이', icon: 'pickaxe_reinforced' }),
    starfall_pickaxe: testTool('starfall_pickaxe', 'mineral', 4, { name: '별똥 곡괭이', icon: 'pickaxe_star' }),
    // 합성 5등급 — 실제 카탈로그에 없다. 사다리가 4단에서 끝나므로(toolProfile 의
    // tier≥4) 신품 유효배수가 별똥과 0.45 로 **동률**이다: 원시 tier 비교(5>4)와
    // 유효배수 비교(§6-앞 2)가 서로 다른 답을 내는 유일한 픽스처라, "동률·열세면
    // 교체하지 않는다"를 이것으로만 못박을 수 있다. 사다리 끝이 옮겨 가면 이
    // 등급도 함께 올려야 한다 — 4단을 낼 때 3에서 여기로 옮겼다.
    legend_pickaxe: testTool('legend_pickaxe', 'mineral', 5, { name: '전설 곡괭이', icon: 'pickaxe_legend' }),
    copper_hammer: testTool('copper_hammer', 'crafting', 1, { name: '구리 망치', icon: 'hammer_copper' }),
    iron_hammer: testTool('iron_hammer', 'crafting', 2, { name: '철 망치', icon: 'hammer_iron' }),
  },
  nodes: {},
  recipes: {
    copper_ingot: {
      id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
      inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
      skillGainMin: 10, skillGainMax: 20,
    },
    iron_pickaxe: {
      id: 'iron_pickaxe', name: '철 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 500, baseChance: 0.5,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'iron_pickaxe', count: 1 },
      skillGainMin: 20, skillGainMax: 35,
    },
    mithril_pickaxe: {
      id: 'mithril_pickaxe', name: '미스릴 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 25000, baseChance: 0.4,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'mithril_pickaxe', count: 1 },
      skillGainMin: 150, skillGainMax: 250,
    },
    // 자동 착용 비교 시나리오 전용 — 요구 숙련도 0 으로 두어 비교 이외의 조건이
    // 시나리오에 끼어들지 않게 한다.
    legend_pickaxe: {
      id: 'legend_pickaxe', name: '전설 곡괭이', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.5,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'legend_pickaxe', count: 1 },
      skillGainMin: 20, skillGainMax: 35,
    },
    iron_hammer: {
      id: 'iron_hammer', name: '철 망치', category: '도구', skill: 'crafting', requiredSkill: 0, baseChance: 0.5,
      inputs: [{ item: 'copper_ingot', count: 2 }], output: { item: 'iron_hammer', count: 1 },
      skillGainMin: 20, skillGainMax: 35,
    },
    // 계열 문턱이 걸린 레시피 — 조합은 누구나 열려 있고(0) 얼음 채집 1,000 이
    // 문이다(§6-앞 9). 출하 CSV 17행은 아직 문턱이 비어 있어 이 경우는 픽스처로만 있다.
    ice_powder: {
      id: 'ice_powder', name: '얼음 가루', category: '조제', skill: 'crafting', requiredSkill: 0, baseChance: 0.95,
      inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
      skillGainMin: 10, skillGainMax: 20, gateSkill: 'ice', gateValue: 1000,
    },
  },
  // 제작 판정은 맵을 보지 않는다 — 등록부와 전환이 GameData 의 필수 칸이라 비운 채로 둔다.
  maps: {},
  transitions: [],
  placements: {},
  milestones: [],
  speakers: {},
  shops: {}, masters: [], enhanceCosts: [], collection: {},
  places: {}, schedules: {}, routes: [],
  dialogue: [],
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
    instances: [{ instanceId: 'pick1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'pick1' },
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    dialogueHistory: emptyDialogueHistory(),
    // 이 판정들은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
    ...overrides,
  }
}

/** 조합 숙련도 500 + 구리 주괴 3개 — 철 곡괭이를 만들 수 있는 상태 */
function smithReadyForIronPickaxe(overrides: Partial<PlayerState> = {}): PlayerState {
  return player({
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 500 },
    stacks: { copper_ingot: 3 },
    ...overrides,
  })
}

/**
 * 조합 숙련도 25,000 + 구리 주괴 3개, 철 곡괭이(2등급) 착용 중 — 미스릴 곡괭이를
 * 만들 수 있는 상태. auto-equip 이 2등급을 3등급으로 밀어내는지 보는 픽스처다.
 */
function smithReadyForMithrilPickaxe(overrides: Partial<PlayerState> = {}): PlayerState {
  return player({
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 25000 },
    stacks: { copper_ingot: 3 },
    instances: [{ instanceId: 'ironpick', itemId: 'iron_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'ironpick' },
    ...overrides,
  })
}

const alwaysSucceed = () => 0
const alwaysFail = () => 0.999

let idCounter = 0
const nextId = () => `id${++idCounter}`

describe('performCraft', () => {
  it('없는 레시피는 unknown_recipe 로 거부한다', () => {
    const r = performCraft({ player: player(), data, recipeId: 'ghost', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_recipe' })
  })

  it('숙련도가 모자라면 level_too_low 로 거부한다', () => {
    const p = player({ stacks: { copper_ingot: 3 } })
    const r = performCraft({ player: p, data, recipeId: 'iron_pickaxe', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(r).toEqual({ ok: false, code: 'level_too_low' })
  })

  // 왜: 판정의 주인은 서버다 — 화면이 두 숫자를 다 그려도, 계열 숙련이 모자란
  //     제작 요청을 실제로 막는 것은 여기다(§6-앞 9).
  it('계열 문턱이 있는 레시피는 그 계열 숙련이 모자라면 level_too_low 로 거부한다', () => {
    const p = player({ skills: { ice: 999, wood: 0, mineral: 0, herb: 0, crafting: 25000 }, stacks: { copper_ore: 2 } })
    const r = performCraft({ player: p, data, recipeId: 'ice_powder', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(r).toEqual({ ok: false, code: 'level_too_low' })
  })

  it('계열 숙련이 문턱에 닿으면 제작된다', () => {
    const p = player({ skills: { ice: 1000, wood: 0, mineral: 0, herb: 0, crafting: 0 }, stacks: { copper_ore: 2 } })
    const r = performCraft({ player: p, data, recipeId: 'ice_powder', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.outcome.success).toBe(true)
  })

  it('재료가 모자라면 missing_materials 로 거부한다', () => {
    const p = player({ stacks: { copper_ore: 1 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(r).toEqual({ ok: false, code: 'missing_materials' })
  })

  it('재료가 하나도 없으면 missing_materials 로 거부한다', () => {
    const r = performCraft({ player: player(), data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(r).toEqual({ ok: false, code: 'missing_materials' })
  })

  it('거부당하면 재료를 소모하지 않는다', () => {
    const p = player({ stacks: { copper_ore: 1 } })
    performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(p.stacks.copper_ore).toBe(1)
  })

  it('성공하면 재료를 전량 소모하고 산출물을 스택에 넣는다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.success).toBe(true)
    expect(r.outcome.consumed).toEqual([{ item: 'copper_ore', count: 2 }])
    expect(r.outcome.player.stacks.copper_ore).toBe(3)
    expect(r.outcome.player.stacks.copper_ingot).toBe(1)
    expect(r.outcome.skillGained).toBeGreaterThan(0)
    expect(r.outcome.player.skills.crafting).toBe(r.outcome.skillGained)
  })

  it('실패하면 재료를 절반만 소모하고 산출물이 없다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysFail, newId: nextId, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.consumed).toEqual([{ item: 'copper_ore', count: 1 }])
    expect(r.outcome.player.stacks.copper_ore).toBe(4)
    expect(r.outcome.player.stacks.copper_ingot).toBeUndefined()
    expect(r.outcome.skillGained).toBe(0)
  })

  it('도구를 만들면 스택이 아니라 인스턴스로 들어간다', () => {
    const r = performCraft({
      player: smithReadyForIronPickaxe(), data, recipeId: 'iron_pickaxe',
      rng: alwaysSucceed, newId: () => 'newpick', now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.stacks.iron_pickaxe).toBeUndefined()
    expect(r.outcome.player.instances).toContainEqual({
      instanceId: 'newpick',
      itemId: 'iron_pickaxe',
      enhanceLevel: 0,
    })
  })

  it('더 좋은 도구를 만들면 자동으로 착용한다', () => {
    const r = performCraft({
      player: smithReadyForIronPickaxe(), data, recipeId: 'iron_pickaxe',
      rng: alwaysSucceed, newId: () => 'newpick', now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(true)
    expect(r.outcome.player.equipped.mineral).toBe('newpick')
  })

  it('이미 더 좋은 도구를 착용 중이면 자동 착용하지 않는다', () => {
    const p = smithReadyForIronPickaxe({
      stacks: { copper_ingot: 6 },
      instances: [{ instanceId: 'good', itemId: 'iron_pickaxe', enhanceLevel: 0 }],
      equipped: { mineral: 'good' },
    })
    const r = performCraft({ player: p, data, recipeId: 'iron_pickaxe', rng: alwaysSucceed, newId: () => 'another', now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(false)
    expect(r.outcome.player.equipped.mineral).toBe('good')
  })

  // 사다리의 문(G5): auto-equip 비교(tier > equippedToolTier)는 2등급 전용으로
  // 짜여 있지 않다 — 3등급 도구가 등장해도 craftService.ts 는 한 글자도 안
  // 고쳤다. 이 테스트가 그 사실을 못박는다(코드 변경 없이 통과해야 정상이다).
  it('철 곡괭이(2등급) 착용 중 미스릴 곡괭이(3등급)를 만들면 자동으로 갈아 낀다', () => {
    const r = performCraft({
      player: smithReadyForMithrilPickaxe(), data, recipeId: 'mithril_pickaxe',
      rng: alwaysSucceed, newId: () => 'newmithril', now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(true)
    expect(r.outcome.player.equipped.mineral).toBe('newmithril')
  })

  it('착용 망치의 강화 수치가 성공률 판정에 실제로 들어간다(§6-앞 10)', () => {
    const p = player({
      stacks: { copper_ore: 5 },
      instances: [{ instanceId: 'h1', itemId: 'copper_hammer', enhanceLevel: 5 }],
      equipped: { crafting: 'h1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    const recipe = data.recipes.copper_ingot!
    // 예상치와 판정이 같은 함수(calcCraftSuccess)라는 규범 — 서비스가 강화 0 을
    // 넘기면(옛 코드) 아래 두 단정 중 첫째가 깨진다. +5 는 +1.5%p 차이다.
    expect(r.outcome.chance).toBe(
      calcCraftSuccess({ proficiency: 0, toolTier: 1, enhanceLevel: 5, recipe }),
    )
    expect(r.outcome.chance).not.toBe(
      calcCraftSuccess({ proficiency: 0, toolTier: 1, enhanceLevel: 0, recipe }),
    )
  })

  it('제작에 실패하면 도구를 만들지도 착용하지도 않는다', () => {
    const r = performCraft({
      player: smithReadyForIronPickaxe(), data, recipeId: 'iron_pickaxe',
      rng: alwaysFail, newId: () => 'newpick', now: 0,
    })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(false)
    expect(r.outcome.player.instances).toHaveLength(1)
    expect(r.outcome.player.equipped.mineral).toBe('pick1')
  })

  it('소모해서 0 이 된 재료는 스택에서 제거한다', () => {
    const p = player({ stacks: { copper_ore: 2 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.copper_ore).toBeUndefined()
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    expect(p.stacks.copper_ore).toBe(5)
  })

  it('성공하면 레시피가 정한 만큼 조합 숙련도가 오른다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.skillGained).toBeGreaterThanOrEqual(10)
    expect(r.outcome.skillGained).toBeLessThanOrEqual(20)
    expect(r.outcome.player.skills.crafting).toBe(r.outcome.skillGained)
  })

  it('간격이 지나지 않았으면 too_fast 로 거부한다', () => {
    const p = player({ stacks: { copper_ore: 5 }, nextActionAt: 8000 })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  // 검사 순서 자체를 못 박는다: 간격도 안 지나고 재료도 없는 상황에서
  // missing_materials 가 나와야 재료 확인이 간격보다 먼저 검사된다는 것이 증명된다.
  // 이 시나리오 없이는 개별 거부 테스트만으로 순서를 구분할 수 없다.
  it('간격도 남아 있고 재료도 없으면 missing_materials 를 우선한다', () => {
    const p = player({ nextActionAt: 8000 })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'missing_materials' })
  })

  it('숙련도 0 이면 다음 행동까지 500ms 를 기다린다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    // 성공하면 숙련도가 10~20 올라가지만, 다음 행동까지의 시간은 증가 전 숙련도(0)로
    // 계산된다. 증가 후 읽으면 약 422ms 정도가 나온다. 이것이 500 이 아니어야 이 테스트의 의미가 있다.
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('숙련도가 높으면 간격이 짧아진다', () => {
    const p = player({ skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 999_999 }, stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 50)
  })

  // 왜: 스탬프가 actionIntervalMs 를 그대로 쓰던 시절, 망치 +5 는 네 계열의
  //     원재료와 골드를 다 먹고 성공률 +1.5%p 만 돌려줬다 — 아무도 안 타는
  //     사다리였다(§6-앞 14). 간격이 붙어야 그 대가에 값어치가 생긴다.
  it('착용 망치의 강화 수치가 제작 간격을 줄인다 — +5 는 500ms 가 아니라 429ms 다(§6-앞 14)', () => {
    const p = player({
      stacks: { copper_ore: 5 },
      instances: [{ instanceId: 'h1', itemId: 'copper_hammer', enhanceLevel: 5 }],
      equipped: { crafting: 'h1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.nextActionAt).toBe(1000 + craftIntervalMs(0, { def: data.items.copper_hammer!, instance: p.instances[0]! }))
    expect(r.outcome.player.nextActionAt).toBe(1000 + 429)
  })

  // 왜: 티어는 이미 성공률을 산다. 간격까지 주면 승급 한 칸이 두 축을 동시에
  //     사서, 망치 하나가 채집 도구 넷을 합친 것보다 큰 물건이 된다.
  it('망치 티어는 제작 간격을 바꾸지 않는다 — 신품 철 망치(2등급)도 500ms 그대로다', () => {
    const p = player({
      stacks: { copper_ore: 5 },
      instances: [{ instanceId: 'h1', itemId: 'iron_hammer', enhanceLevel: 0 }],
      equipped: { crafting: 'h1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('간격 위반으로 거부당하면 아무것도 변하지 않는다', () => {
    const p = player({ stacks: { copper_ore: 5 }, nextActionAt: 8000 })
    const initialStacks = { ...p.stacks }
    const initialSkills = { ...p.skills }
    const initialNextActionAt = p.nextActionAt

    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })

    // 거부되면 입력 객체가 변경되지 않는다
    expect(p.nextActionAt).toBe(initialNextActionAt)
    expect(p.stacks).toEqual(initialStacks)
    expect(p.skills).toEqual(initialSkills)
  })
})

describe('performCraft — 자동 착용은 원시 tier 가 아니라 유효 효과로 견준다(§6-앞 2)', () => {
  it('tier 가 높아도 유효 간격배수가 나쁘면 교체하지 않는다 — 신품이 강화 투자를 덮어쓰지 못한다', () => {
    // 착용 별똥 +5 의 유효배수 0.45×0.97^5 ≈ 0.386, 신품 전설(5티어)은 0.45 —
    // 신품이 더 느리다. 원시 tier 비교(5>4)였다면 여기서 교체가 일어난다.
    const p = player({
      stacks: { copper_ingot: 3 },
      instances: [{ instanceId: 'm1', itemId: 'starfall_pickaxe', enhanceLevel: 5 }],
      equipped: { mineral: 'm1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'legend_pickaxe', rng: alwaysSucceed, newId: () => 'legend1', now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(false)
    expect(r.outcome.player.equipped.mineral).toBe('m1')
    // 착용만 안 될 뿐 인스턴스는 생긴다 — 예비 도구(강화 재료)의 정상 경로다.
    expect(r.outcome.player.instances).toContainEqual({
      instanceId: 'legend1', itemId: 'legend_pickaxe', enhanceLevel: 0,
    })
  })

  it('유효배수가 동률이면 교체하지 않는다', () => {
    // 신품 별똥(0.45) 착용 중 신품 전설(0.45) — 티어 숫자만 다르고 배수는 같다.
    const p = player({
      stacks: { copper_ingot: 3 },
      instances: [{ instanceId: 'm1', itemId: 'starfall_pickaxe', enhanceLevel: 0 }],
      equipped: { mineral: 'm1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'legend_pickaxe', rng: alwaysSucceed, newId: () => 'legend1', now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(false)
    expect(r.outcome.player.equipped.mineral).toBe('m1')
  })

  it('만강 구리도 신품 철에는 자리를 내준다 — 티어 불변식(§6-앞 1)이 승급의 드라마를 지킨다', () => {
    // 배포 상수에서 철 0.8 < 구리+5 0.97^5≈0.859 — 유효배수 비교로도 교체가 맞다.
    // 이 사실이 흔들리는 날(상수 조정)은 toolProfile 의 불변식 테스트가 먼저 깨진다.
    const p = smithReadyForIronPickaxe({
      instances: [{ instanceId: 'c1', itemId: 'copper_pickaxe', enhanceLevel: 5 }],
      equipped: { mineral: 'c1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'iron_pickaxe', rng: alwaysSucceed, newId: () => 'newpick', now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(true)
    expect(r.outcome.player.equipped.mineral).toBe('newpick')
  })

  it('만강 구리 망치도 신품 철 망치에는 자리를 내준다 — 망치 축의 티어 불변식(§6-앞 18)', () => {
    // 망치의 효과 축은 간격이 아니라 성공률이다(§5) — 그래서 비교는
    // hammerChanceBonus 로 한다(간격배수로 견주면 숫자는 나오지만 아무 효과도
    // 재지 않은 수고다). 그 축 위에서 승급이 강화를 이기는 것은 상수가 정한다:
    // 티어 한 칸(+2.0%p)이 만강(+1.5%p)보다 크므로 구리+5(+3.5%p) < 철 신품(+4.0%p).
    // 강화 보너스가 +0.5%p 이던 시절에는 이 부등식이 뒤집혀 승급이 손해였다 —
    // 그 사실이 흔들리는 날(상수 조정)은 toolProfile 의 불변식 테스트가 먼저 깨진다.
    const p = player({
      stacks: { copper_ingot: 2 },
      instances: [{ instanceId: 'h1', itemId: 'copper_hammer', enhanceLevel: 5 }],
      equipped: { crafting: 'h1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'iron_hammer', rng: alwaysSucceed, newId: () => 'newhammer', now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(true)
    expect(r.outcome.player.equipped.crafting).toBe('newhammer')
  })

  it('신품끼리는 더 나은 망치를 착용한다 — 등급이 곧 보너스 차이다', () => {
    const p = player({
      stacks: { copper_ingot: 2 },
      instances: [{ instanceId: 'h1', itemId: 'copper_hammer', enhanceLevel: 0 }],
      equipped: { crafting: 'h1' },
    })
    const r = performCraft({ player: p, data, recipeId: 'iron_hammer', rng: alwaysSucceed, newId: () => 'newhammer', now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.autoEquipped).toBe(true)
    expect(r.outcome.player.equipped.crafting).toBe('newhammer')
  })
})

describe('performCraft — 이정표 달성', () => {
  const craftingMilestone: MilestoneDef = {
    id: 'crafting-100',
    metric: { kind: 'skill', skill: 'crafting' },
    threshold: 100,
    name: '조합에 익숙해지다',
    announce: '조합하는 손이 익숙해졌다',
    effect: { kind: 'title' },
  }
  const dataWithMilestone: GameData = { ...data, milestones: [craftingMilestone] }

  /**
   * alwaysSucceed(rng() = 0)일 때 copper_ingot 의 skillGained 은 항상 최솟값 10 이다.
   * requiredSkill 이 0 이라 조합 숙련도와 무관하게 시도할 수 있다.
   */
  function playerBelowThreshold(overrides: Partial<PlayerState> = {}): PlayerState {
    return player({
      skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 90 },
      stacks: { copper_ore: 10 },
      ...overrides,
    })
  }

  it('성공한 조합이 문턱을 넘기면 outcome.achieved 에 그 이정표가 담긴다', () => {
    const r = performCraft({
      player: playerBelowThreshold(), data: dataWithMilestone,
      recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.skills.crafting).toBe(100) // 문턱에 정확히 닿았는지 전제부터 확인한다
    expect(r.outcome.achieved.map((m) => m.id)).toEqual(['crafting-100'])
  })

  it('그 이정표 id 가 outcome.player.celebrated 에 들어간다', () => {
    const r = performCraft({
      player: playerBelowThreshold(), data: dataWithMilestone,
      recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.celebrated).toEqual(['crafting-100'])
  })

  it('다음 조합에서는 다시 담기지 않는다', () => {
    const first = performCraft({
      player: playerBelowThreshold(), data: dataWithMilestone,
      recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0,
    })
    if (!first.ok) throw new Error('성공해야 한다')

    const second = performCraft({
      player: first.outcome.player, data: dataWithMilestone,
      recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: first.outcome.player.nextActionAt,
    })
    if (!second.ok) throw new Error('성공해야 한다')

    expect(second.outcome.achieved).toEqual([])
    expect(second.outcome.player.celebrated).toEqual(['crafting-100'])
  })

  it('실패한 조합은 숙련도를 올리지 않으므로 아무것도 담기지 않는다', () => {
    const r = performCraft({
      player: playerBelowThreshold(), data: dataWithMilestone,
      recipeId: 'copper_ingot', rng: alwaysFail, newId: nextId, now: 0,
    })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.achieved).toEqual([])
    expect(r.outcome.player.celebrated).toEqual([])
  })

  it('이미 문턱을 넘었어도 실패한 조합은 축하하지 않는다', () => {
    // 방어적 테스트: 실패 경로는 달성 판정 자체를 하지 않는다. gatherService.test.ts 의
    // 같은 이름 테스트와 같은 이유다.
    const p = playerBelowThreshold({ skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 100 } })
    const r = performCraft({
      player: p, data: dataWithMilestone, recipeId: 'copper_ingot', rng: alwaysFail, newId: nextId, now: 0,
    })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.achieved).toEqual([])
    expect(r.outcome.player.celebrated).toEqual([])
  })

  it('거부당한 요청은 celebrated 를 건드리지 않는다', () => {
    const p = playerBelowThreshold({
      skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 100 },
      nextActionAt: 8000,
    })
    const r = performCraft({
      player: p, data: dataWithMilestone, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 5000,
    })
    // too_fast 거부는 outcome 자체가 없다 — celebrated 를 실을 자리가 없다.
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  it('한 번의 조합으로 여러 문턱을 넘으면 전부 achieved 에 담긴다', () => {
    // 조합은 한 번에 숙련도가 수십씩 오르므로, 촘촘한 문턱 두 개를 한 번에 넘을 수 있다.
    const m95: MilestoneDef = {
      id: 'crafting-95', metric: { kind: 'skill', skill: 'crafting' }, threshold: 95,
      name: '조합에 눈뜨다', announce: '조합이 눈에 익기 시작했다', effect: { kind: 'title' },
    }
    const m100: MilestoneDef = {
      id: 'crafting-100', metric: { kind: 'skill', skill: 'crafting' }, threshold: 100,
      name: '조합에 익숙해지다', announce: '조합하는 손이 익숙해졌다', effect: { kind: 'title' },
    }
    const d: GameData = { ...data, milestones: [m95, m100] }

    const r = performCraft({
      player: playerBelowThreshold(), data: d,
      recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.skills.crafting).toBe(100)
    // 정의 순서(m95 먼저)대로 담긴다 — 클라이언트가 이 순서로 큐에 넣고 보여준다.
    expect(r.outcome.achieved.map((m) => m.id)).toEqual(['crafting-95', 'crafting-100'])
    expect(r.outcome.player.celebrated.sort()).toEqual(['crafting-100', 'crafting-95'].sort())
  })
})
