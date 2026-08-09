import { emptyDialogueHistory, type GameData, type MilestoneDef, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { performCraft } from './craftService.js'

const data: GameData = {
  items: {
    copper_ore: { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' },
    copper_ingot: { id: 'copper_ingot', name: '구리 주괴', kind: 'material', icon: 'ingot_copper' },
    copper_pickaxe: {
      id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool',
      toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
    },
    iron_pickaxe: {
      id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool',
      toolSkill: 'mineral', toolTier: 2, icon: 'pickaxe_iron',
    },
  },
  nodes: {},
  recipes: {
    copper_ingot: {
      id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredSkill: 0, baseChance: 0.6,
      inputs: [{ item: 'copper_ore', count: 2 }], output: { item: 'copper_ingot', count: 1 },
      skillGainMin: 10, skillGainMax: 20,
    },
    iron_pickaxe: {
      id: 'iron_pickaxe', name: '철 곡괭이', skill: 'crafting', requiredSkill: 500, baseChance: 0.5,
      inputs: [{ item: 'copper_ingot', count: 3 }], output: { item: 'iron_pickaxe', count: 1 },
      skillGainMin: 20, skillGainMax: 35,
    },
  },
  // 제작 판정은 맵을 보지 않는다 — 등록부가 GameData 의 필수 칸이라 비운 채로 둔다.
  maps: {},
  placements: {},
  milestones: [],
  speakers: {},
  dialogue: [],
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [{ instanceId: 'pick1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'pick1' },
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
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
