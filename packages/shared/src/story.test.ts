import { describe, expect, it } from 'vitest'
import { defaultCombatState } from './combatState.js'
import { emptyDialogueHistory } from './dialogue.js'
import type { MilestoneDef, MilestoneWorld } from './milestones.js'
import { advanceStory, type StoryStep } from './story.js'
import type { PlayerState } from './types.js'

/**
 * 사슬 판정의 규칙만 본다 — 마을 유도와 슬롯 펴기는 packages/data 의 몫이라
 * (`storyChainOf`) 여기서는 **이미 펴진 마디**를 손으로 짓는다. 그래야 "얼음
 * 조각이 200 개인가" 같은 데이터 사정이 판정 규칙의 실패 원인에 섞이지 않는다.
 */

const iceNovice: MilestoneDef = {
  id: 'ice_1000',
  metric: { kind: 'skill', skill: 'ice' },
  threshold: 1000,
  name: '얼음에 익숙해지다',
  announce: '얼음에 익숙해졌다',
  effect: { kind: 'title' },
}

const world: MilestoneWorld = {
  milestones: [iceNovice],
  // 얼음 조각 하나만 있는 방. 총점 지표(collection)를 보는 밀어올림이 실제로
  // 값을 읽는지 재려면 문턱표가 비어 있으면 안 된다.
  collection: { ice_shard: { itemId: 'ice_shard', steps: [200, 1000, 5000, 20_000] } },
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    story: 0,
    storyCount: 0,
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: '눈의마을', x: 0, y: 0 },
    weather: null,
    combat: defaultCombatState(),
    ...overrides,
  }
}

/** 펴진 마디 하나. 필요한 칸만 덮어쓴다. */
function step(overrides: Partial<StoryStep> & Pick<StoryStep, 'step' | 'goal'>): StoryStep {
  return {
    objective: '무언가 하라',
    announce: '해냈다',
    discoverable: true,
    ...overrides,
  }
}

/** 설계 ③ 의 여섯 마디를 얼음 마을 값으로 편 것 — 이 스위트의 무대다. */
const ICE_CHAIN: StoryStep[] = [
  step({ step: 0, goal: { kind: 'arrive', arg: '얼음채집장' } }),
  step({ step: 1, goal: { kind: 'gather', arg: 'ice', count: 1 } }),
  step({ step: 2, goal: { kind: 'gather', arg: 'ice', count: 40 } }),
  step({ step: 3, goal: { kind: 'donate', arg: 'ice_shard', count: 200 } }),
  step({ step: 4, goal: { kind: 'reach', arg: 'ice_1000' } }),
  step({ step: 5, goal: { kind: 'craft', arg: 'snow_powder', count: 1 } }),
]

describe('advanceStory — 사건이 미는 마디', () => {
  it('도착 마디는 그 맵에 닿아야 넘어간다', () => {
    const p = player()
    const out = advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'arrive', mapId: '얼음채집장' } })
    expect(p.story).toBe(1)
    expect(out.completed.map((s) => s.step)).toEqual([0])
  })

  it('다른 맵에 도착한 것으로는 안 넘어간다 — 문 하나를 넘었다고 다 나간 것이 아니다', () => {
    const p = player()
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'arrive', mapId: '사냥터' } })
    expect(p.story).toBe(0)
  })

  it('채집 마디는 그 계열만 센다 — 남의 계열을 캐는 것은 이 마디가 시킨 일이 아니다', () => {
    const p = player({ story: 2 })
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'gather', skill: 'wood' } })
    expect([p.story, p.storyCount]).toEqual([2, 0])

    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([2, 1])
  })

  it('사건이 없으면(실패한 손질) 세는 마디는 그대로다', () => {
    const p = player({ story: 2, storyCount: 7 })
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: null })
    expect([p.story, p.storyCount]).toEqual([2, 7])
  })

  it('델타가 요구치에 닿으면 넘어가고 storyCount 는 0 으로 돌아간다', () => {
    const p = player({ story: 2, storyCount: 39 })
    const out = advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([3, 0])
    expect(out.completed.map((s) => s.step)).toEqual([2])
  })

  it('헌납은 개수를 센다 — 한 번에 통째로 바치는 손짓이라 1 이 아니다', () => {
    const p = player({ story: 3 })
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'donate', itemId: 'ice_shard', count: 120 } })
    expect([p.story, p.storyCount]).toEqual([3, 120])
  })

  it('한 사건은 한 마디만 민다 — 넘치게 바쳐도 남는 수는 다음 마디로 안 간다', () => {
    // 마디 3(200 개) 을 400 개로 끝내고, 이어지는 마디 4 는 델타가 아니라
    // 이정표라 남는 200 이 갈 자리 자체가 없다. 그래도 storyCount 가 0 인 것을
    // 재는 이유는, 이어 붙이려면 "남은 사건" 이라는 세 번째 상태가 생기기 때문이다.
    const p = player({ story: 3 })
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'donate', itemId: 'ice_shard', count: 400 } })
    expect([p.story, p.storyCount]).toEqual([4, 0])
  })

  it('제작 마디는 그 레시피만 센다', () => {
    const p = player({ story: 5 })
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'craft', recipeId: 'rain_powder' } })
    expect(p.story).toBe(5)

    advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'craft', recipeId: 'snow_powder' } })
    expect(p.story).toBe(6)
  })
})

describe('advanceStory — 상태가 미는 마디', () => {
  it('이정표 마디는 사건 없이 넘어간다 — 실패한 손질이 문턱을 넘겨도 사슬이 선 채로 남지 않는다', () => {
    const p = player({ story: 4, skills: { ice: 1000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advanceStory({ chain: ICE_CHAIN, player: p, world, event: null })
    expect(p.story).toBe(5)
    expect(out.completed.map((s) => s.step)).toEqual([4])
  })

  it('문턱에 못 미치면 그대로다', () => {
    const p = player({ story: 4, skills: { ice: 999, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    advanceStory({ chain: ICE_CHAIN, player: p, world, event: null })
    expect(p.story).toBe(4)
  })

  it('없는 이정표를 가리키면 조용히 안 넘어간다 — 조용히 달성되는 것보다 낫다', () => {
    const chain = [step({ step: 0, goal: { kind: 'reach', arg: '없는이정표' } })]
    const p = player({ skills: { ice: 999_999, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    advanceStory({ chain, player: p, world, event: null })
    expect(p.story).toBe(0)
  })

  it('마디를 끝낸 뒤 이미 넘긴 이정표가 연쇄로 넘어간다', () => {
    // 마지막 얼음 조각을 바치는 순간 이미 숙련 1,000 인 사람이다 — 마디 3 을
    // 헌납으로 끝내고, 그 뒤의 마디 4 는 물어볼 것도 없이 이미 끝나 있다.
    const p = player({ story: 3, skills: { ice: 1200, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'donate', itemId: 'ice_shard', count: 200 } })
    expect(p.story).toBe(5)
    expect(out.completed.map((s) => s.step)).toEqual([3, 4])
  })
})

describe('advanceStory — 밀어올림(catchUp)', () => {
  /** 마디 0~2 에 문턱을 단 사슬. 얼음 200,000 인 테스터가 여기 떨어진다. */
  const caught: StoryStep[] = [
    step({ step: 0, goal: { kind: 'arrive', arg: '얼음채집장' }, catchUp: { metric: { kind: 'skill', skill: 'ice' }, threshold: 1 } }),
    step({ step: 1, goal: { kind: 'gather', arg: 'ice', count: 1 }, catchUp: { metric: { kind: 'skill', skill: 'ice' }, threshold: 1 } }),
    step({ step: 2, goal: { kind: 'donate', arg: 'ice_shard', count: 200 }, catchUp: { metric: { kind: 'collection' }, threshold: 1 } }),
    step({ step: 3, goal: { kind: 'gather', arg: 'ice', count: 40 } }),
  ]

  it('이미 지나친 마디를 한 훅에 통째로 민다', () => {
    const p = player({
      skills: { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      donated: { ice_shard: 5000 },
    })
    const out = advanceStory({ chain: caught, player: p, world, event: null })
    expect(p.story).toBe(3)
    expect(out.skipped.map((s) => s.step)).toEqual([0, 1, 2])
  })

  it('민 마디는 completed 가 아니다 — 지나쳤다고 본 것을 여섯 줄로 축하하면 소음이다', () => {
    const p = player({ skills: { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advanceStory({ chain: caught, player: p, world, event: null })
    expect(out.completed).toEqual([])
  })

  it('사건은 지금 마디 하나에만 닿는다 — 고인물의 첫 채집이 초보 마디를 밟고 지나가지 않는다', () => {
    const p = player({ skills: { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advanceStory({ chain: caught, player: p, world, event: { kind: 'gather', skill: 'ice' } })
    // 마디 0 은 「나가라」라 채집이 닿을 자리가 없다. 그래서 그 채집은 아무것도
    // 끝내지 않고, 밀어올림이 그 자리에서 0·1 을 통째로 민다.
    expect([p.story, p.storyCount]).toEqual([2, 0])
    expect([out.skipped.map((s) => s.step), out.completed]).toEqual([[0, 1], []])
  })

  // 왜: 훅은 **행동이 상태를 이미 바꾼 뒤**에 돈다 — 헌납 훅이 볼 때 `donated` 에는
  //     방금 바친 200 개가 이미 들어 있다. 밀어올림을 먼저 재면 그 값이 「예전부터
  //     그랬다」로 읽혀서, 처음 별을 딴 신규가 그 마디를 끝낸 것이 아니라 지나친
  //     것이 되고 announce 가 통째로 사라진다(설계 ⑦ 이 예로 든 문턱이 그것이다).
  it('방금 그 행동이 만든 값으로 자기 마디를 지나치지 않는다 — 끝낸 사람은 끝낸 것으로 센다', () => {
    const p = player({ story: 2, donated: { ice_shard: 200 } })
    const out = advanceStory({ chain: caught, player: p, world, event: { kind: 'donate', itemId: 'ice_shard', count: 200 } })
    expect(p.story).toBe(3)
    expect([out.completed.map((s) => s.step), out.skipped]).toEqual([[2], []])
  })

  it('두 번째 훅부터는 아무 일도 안 한다 — 지표가 단조라 "첫 훅"을 기억할 필요가 없다', () => {
    const p = player({ skills: { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    advanceStory({ chain: caught, player: p, world, event: null })
    const again = advanceStory({ chain: caught, player: p, world, event: null })
    expect([again.skipped, again.completed]).toEqual([[], []])
    expect(p.story).toBe(2)
  })

  it('문턱을 안 넘은 신규는 하나도 안 밀린다', () => {
    const p = player()
    const out = advanceStory({ chain: caught, player: p, world, event: null })
    expect([p.story, out.skipped]).toEqual([0, []])
  })

  it('문턱이 없는 마디에서는 멈춘다 — 밀어올림은 적힌 데까지만이다', () => {
    const p = player({
      skills: { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      donated: { ice_shard: 5000 },
    })
    advanceStory({ chain: caught, player: p, world, event: null })
    expect(p.story).toBe(3)
  })
})

describe('advanceStory — 끝과 가장자리', () => {
  it('사슬이 끝난 뒤에는 더 안 나아간다', () => {
    const p = player({ story: ICE_CHAIN.length })
    const out = advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([ICE_CHAIN.length, 0])
    expect([out.completed, out.skipped]).toEqual([[], []])
  })

  it('세이브의 마디 번호가 사슬 길이를 넘어도 터지지 않는다 — 마디를 지운 날의 옛 세이브다', () => {
    const p = player({ story: 99 })
    expect(() =>
      advanceStory({ chain: ICE_CHAIN, player: p, world, event: { kind: 'arrive', mapId: '얼음채집장' } }),
    ).not.toThrow()
    expect(p.story).toBe(99)
  })

  it('빈 사슬에서는 아무 일도 없다 — 마디를 아직 안 쓴 표가 그 상태다', () => {
    const p = player()
    advanceStory({ chain: [], player: p, world, event: { kind: 'arrive', mapId: '얼음채집장' } })
    expect(p.story).toBe(0)
  })

  it('세는 마디에 요구치가 없으면 영원히 안 끝난다 — 0 으로 접으면 사슬이 한 번에 굴러간다', () => {
    // 빌드가 막는 데이터다(parseStory 의 짝 강제). 막지 못했을 때 어느 쪽으로
    // 무너지는지를 못박는다 — 조용히 안 끝나는 쪽이다.
    const chain = [step({ step: 0, goal: { kind: 'gather', arg: 'ice' } })]
    const p = player()
    advanceStory({ chain, player: p, world, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([0, 1])
  })
})
