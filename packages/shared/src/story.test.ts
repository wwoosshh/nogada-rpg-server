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
    startVillage: '',
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

/**
 * 훅 한 번. `before` 를 안 적으면 **이 행동이 단조 지표를 하나도 안 바꿨다**는 뜻이다.
 *
 * 서비스에서는 둘이 늘 다른 객체다(행동이 상태를 이미 바꾼 뒤에 훅이 돈다). 여기서는
 * 대부분의 마디가 문턱을 아예 안 달고 있어 `before` 가 답을 못 바꾸므로, **바꾸는
 * 경우에만** 그 앞의 상태를 손으로 적는다 — 그 한 줄이 곧 그 검사가 재는 것이다.
 */
function advance(args: {
  chain: readonly StoryStep[]
  player: PlayerState
  event: Parameters<typeof advanceStory>[0]['event']
  before?: PlayerState
}) {
  return advanceStory({
    chain: args.chain,
    player: args.player,
    before: args.before ?? structuredClone(args.player),
    world,
    event: args.event,
  })
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
    const out = advance({ chain: ICE_CHAIN, player: p, event: { kind: 'arrive', mapId: '얼음채집장' } })
    expect(p.story).toBe(1)
    expect(out.completed.map((s) => s.step)).toEqual([0])
  })

  it('다른 맵에 도착한 것으로는 안 넘어간다 — 문 하나를 넘었다고 다 나간 것이 아니다', () => {
    const p = player()
    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'arrive', mapId: '사냥터' } })
    expect(p.story).toBe(0)
  })

  it('채집 마디는 그 계열만 센다 — 남의 계열을 캐는 것은 이 마디가 시킨 일이 아니다', () => {
    const p = player({ story: 2 })
    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'gather', skill: 'wood' } })
    expect([p.story, p.storyCount]).toEqual([2, 0])

    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([2, 1])
  })

  it('사건이 없으면(실패한 손질) 세는 마디는 그대로다', () => {
    const p = player({ story: 2, storyCount: 7 })
    advance({ chain: ICE_CHAIN, player: p, event: null })
    expect([p.story, p.storyCount]).toEqual([2, 7])
  })

  it('델타가 요구치에 닿으면 넘어가고 storyCount 는 0 으로 돌아간다', () => {
    const p = player({ story: 2, storyCount: 39 })
    const out = advance({ chain: ICE_CHAIN, player: p, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([3, 0])
    expect(out.completed.map((s) => s.step)).toEqual([2])
  })

  it('헌납은 개수를 센다 — 한 번에 통째로 바치는 손짓이라 1 이 아니다', () => {
    const p = player({ story: 3 })
    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'donate', itemId: 'ice_shard', count: 120 } })
    expect([p.story, p.storyCount]).toEqual([3, 120])
  })

  it('한 사건은 한 마디만 민다 — 넘치게 바쳐도 남는 수는 다음 마디로 안 간다', () => {
    // 마디 3(200 개) 을 400 개로 끝내고, 이어지는 마디 4 는 델타가 아니라
    // 이정표라 남는 200 이 갈 자리 자체가 없다. 그래도 storyCount 가 0 인 것을
    // 재는 이유는, 이어 붙이려면 "남은 사건" 이라는 세 번째 상태가 생기기 때문이다.
    const p = player({ story: 3 })
    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'donate', itemId: 'ice_shard', count: 400 } })
    expect([p.story, p.storyCount]).toEqual([4, 0])
  })

  it('제작 마디는 그 레시피만 센다', () => {
    const p = player({ story: 5 })
    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'craft', recipeId: 'rain_powder' } })
    expect(p.story).toBe(5)

    advance({ chain: ICE_CHAIN, player: p, event: { kind: 'craft', recipeId: 'snow_powder' } })
    expect(p.story).toBe(6)
  })
})

describe('advanceStory — 상태가 미는 마디', () => {
  it('이정표 마디는 사건 없이 넘어간다 — 실패한 손질이 문턱을 넘겨도 사슬이 선 채로 남지 않는다', () => {
    const p = player({ story: 4, skills: { ice: 1000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advance({ chain: ICE_CHAIN, player: p, event: null })
    expect(p.story).toBe(5)
    expect(out.completed.map((s) => s.step)).toEqual([4])
  })

  it('문턱에 못 미치면 그대로다', () => {
    const p = player({ story: 4, skills: { ice: 999, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    advance({ chain: ICE_CHAIN, player: p, event: null })
    expect(p.story).toBe(4)
  })

  it('없는 이정표를 가리키면 조용히 안 넘어간다 — 조용히 달성되는 것보다 낫다', () => {
    const chain = [step({ step: 0, goal: { kind: 'reach', arg: '없는이정표' } })]
    const p = player({ skills: { ice: 999_999, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    advance({ chain, player: p, event: null })
    expect(p.story).toBe(0)
  })

  it('마디를 끝낸 뒤 이미 넘긴 이정표가 연쇄로 넘어간다', () => {
    // 마지막 얼음 조각을 바치는 순간 이미 숙련 1,000 인 사람이다 — 마디 3 을
    // 헌납으로 끝내고, 그 뒤의 마디 4 는 물어볼 것도 없이 이미 끝나 있다.
    const p = player({ story: 3, skills: { ice: 1200, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advance({ chain: ICE_CHAIN, player: p, event: { kind: 'donate', itemId: 'ice_shard', count: 200 } })
    expect(p.story).toBe(5)
    expect(out.completed.map((s) => s.step)).toEqual([3, 4])
  })
})

describe('advanceStory — 밀어올림(catchUp)', () => {
  /** 얼음 200,000 인 테스터. 게임은 이미 공개돼 있고 이 사람의 계정이 살아 있다. */
  const VETERAN_SKILLS = { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } as const

  /**
   * 마디 0~3 에 문턱을 단 사슬. 얼음 200,000 인 테스터가 여기 떨어진다.
   *
   * 마디 3 이 **이정표 마디**인 것이 이 무대의 판단이다: 고인물은 그 자리에서
   * 밀어올림(지나쳤다)과 상태 판정(문턱을 넘겼다) **둘 다 참**이라, 어느 쪽으로
   * 세는가가 「얼음에 익숙해졌다」를 오늘 처음처럼 받는가를 가른다. 문턱을 10,000
   * 으로 둔 것도 같은 이유다 — 1,000 으로 두면 이제 막 넘긴 사람과 고인물이
   * 구별되지 않아 두 갈래를 따로 잴 수가 없다.
   */
  const caught: StoryStep[] = [
    step({ step: 0, goal: { kind: 'arrive', arg: '얼음채집장' }, catchUp: { metric: { kind: 'skill', skill: 'ice' }, threshold: 1 } }),
    step({ step: 1, goal: { kind: 'gather', arg: 'ice', count: 1 }, catchUp: { metric: { kind: 'skill', skill: 'ice' }, threshold: 1 } }),
    step({ step: 2, goal: { kind: 'donate', arg: 'ice_shard', count: 200 }, catchUp: { metric: { kind: 'collection' }, threshold: 1 } }),
    step({ step: 3, goal: { kind: 'reach', arg: 'ice_1000' }, catchUp: { metric: { kind: 'skill', skill: 'ice' }, threshold: 10_000 } }),
    step({ step: 4, goal: { kind: 'gather', arg: 'ice', count: 40 } }),
  ]

  it('이미 지나친 마디를 한 훅에 통째로 민다', () => {
    const p = player({ skills: { ...VETERAN_SKILLS }, donated: { ice_shard: 5000 } })
    const out = advance({ chain: caught, player: p, event: null })
    expect(p.story).toBe(4)
    expect(out.skipped.map((s) => s.step)).toEqual([0, 1, 2, 3])
  })

  it('민 마디는 completed 가 아니다 — 지나쳤다고 본 것을 여섯 줄로 축하하면 소음이다', () => {
    const p = player({ skills: { ...VETERAN_SKILLS } })
    const out = advance({ chain: caught, player: p, event: null })
    expect(out.completed).toEqual([])
  })

  it('사건은 지금 마디 하나에만 닿는다 — 고인물의 첫 채집이 초보 마디를 밟고 지나가지 않는다', () => {
    const p = player({ skills: { ...VETERAN_SKILLS } })
    const out = advance({ chain: caught, player: p, event: { kind: 'gather', skill: 'ice' } })
    // 마디 0 은 「나가라」라 채집이 닿을 자리가 없다. 그래서 그 채집은 아무것도
    // 끝내지 않고, 밀어올림이 그 자리에서 0·1 을 통째로 민다.
    expect([p.story, p.storyCount]).toEqual([2, 0])
    expect([out.skipped.map((s) => s.step), out.completed]).toEqual([[0, 1], []])
  })

  // 왜: 고인물이 오늘도 채집장에 나가는 그 한 걸음이 **마침 마디 0 의 조건**이다
  //     (「{마을} {방향}문으로 나가라」). 사건이 밀어올림보다 먼저 닿으면 그 걸음이
  //     초보 안내를 「해냈다」로 바꿔 놓고, 그 사람은 축하 한 줄을 그대로 받는다
  //     (설계 ⑦, 실기 확인 1번). 고인물의 가장 흔한 첫 훅이 정확히 그것이다.
  it('고인물이 자기 마을 문을 나서도 마디 0 은 해낸 것이 아니다', () => {
    const p = player({ skills: { ...VETERAN_SKILLS } })
    const out = advance({ chain: caught, player: p, event: { kind: 'arrive', mapId: '얼음채집장' } })
    expect([out.skipped.map((s) => s.step), out.completed]).toEqual([[0, 1], []])
  })

  // 왜: 훅은 **행동이 상태를 이미 바꾼 뒤**에 돈다 — 헌납 훅이 볼 때 `donated` 에는
  //     방금 바친 200 개가 이미 들어 있다. 지금 상태로 밀어올림을 재면 그 값이
  //     「예전부터 그랬다」로 읽혀서, 처음 별을 딴 신규가 그 마디를 끝낸 것이 아니라
  //     지나친 것이 되고 announce 가 통째로 사라진다(설계 ⑦ 이 예로 든 문턱이 그것이다).
  //     `before` 가 그것을 가른다.
  it('방금 그 행동이 만든 값으로 자기 마디를 지나치지 않는다 — 끝낸 사람은 끝낸 것으로 센다', () => {
    const p = player({ story: 2, donated: { ice_shard: 200 } })
    const out = advance({
      chain: caught,
      player: p,
      before: player({ story: 2 }),
      event: { kind: 'donate', itemId: 'ice_shard', count: 200 },
    })
    expect(p.story).toBe(3)
    expect([out.completed.map((s) => s.step), out.skipped]).toEqual([[2], []])
  })

  // 왜: 위 검사는 **한 번에 다 바치는** 경우만 본다. 가방이 한 번에 200 을 못 채운
  //     사람은 두 번째 [바치기] 에서 `before` 로도 이미 첫 단 위에 서 있다 — 앞서
  //     자기가 바친 것이 그 문턱을 만들었기 때문이다. 그 사람을 가려내는 정보는
  //     델타뿐이고(그 마디를 이미 걷고 있다), 그것이 `caughtUp` 의 `delta > 0` 이다.
  //     `collection` 지표에서는 「문턱을 마디 위로」 라는 표 쪽 규칙이 통하지 않는다:
  //     마디를 끝내는 것과 첫 단이 채워지는 것이 같은 순간이라서다.
  it('나눠 바쳐 마디를 끝내도 끝낸 것으로 센다 — 자기가 만든 문턱이 자기 별을 뺏지 않는다', () => {
    const p = player({ story: 2, storyCount: 100, donated: { ice_shard: 300 } })
    const out = advance({
      chain: caught,
      player: p,
      // 이 [바치기] 앞에도 이미 첫 단(200)을 넘겨 둔 상태다 — 그런데 그 200 중
      // 100 은 이 마디를 걸으며 자기가 바친 것이다(storyCount 100).
      before: player({ story: 2, storyCount: 100, donated: { ice_shard: 200 } }),
      event: { kind: 'donate', itemId: 'ice_shard', count: 100 },
    })
    expect(p.story).toBe(3)
    expect([out.completed.map((s) => s.step), out.skipped]).toEqual([[2], []])
  })

  it('델타가 아직 0 이면 델타 방어가 안 걸린다 — 정말 지나친 사람은 그대로 민다', () => {
    // 위 검사의 짝. 같은 문턱·같은 상태인데 storyCount 만 0 이다 — 이 마디를
    // 아직 한 번도 안 걸은 사람이므로 첫 별은 예전에 딴 것이다.
    const p = player({ story: 2, donated: { ice_shard: 300 } })
    const out = advance({ chain: caught, player: p, event: null })
    expect(p.story).toBe(3)
    expect([out.skipped.map((s) => s.step), out.completed]).toEqual([[2], []])
  })

  // 왜: 이정표 마디에서는 고인물에게 **두 갈래가 동시에 참**이다 — 얼음 200,000 이면
  //     문턱(1,000)을 넘겼고(metByState), 지나쳤다고도 볼 수 있다(catchUp 10,000).
  //     어느 쪽을 먼저 묻는가가 그 사람이 「얼음에 익숙해졌다」를 오늘 처음처럼
  //     받는가를 가른다. 빌드가 discoverable 마디에 catchUp 을 강제하는 것이 이
  //     순서의 유일한 버팀목이었고, 그 짝이 검사로는 서 있지 않았다.
  it('고인물의 이정표 마디는 축하가 아니라 밀어올림이다', () => {
    const p = player({ story: 3, skills: { ...VETERAN_SKILLS }, donated: { ice_shard: 5000 } })
    const out = advance({ chain: caught, player: p, event: null })
    expect(p.story).toBe(4)
    expect([out.skipped.map((s) => s.step), out.completed]).toEqual([[3], []])
  })

  it('오늘 그 문턱을 처음 넘은 사람은 축하를 받는다 — 같은 마디, 다른 사람', () => {
    // 얼음 1,200 — 이정표(1,000)는 넘겼지만 밀어올림 문턱(10,000)에는 한참 못 미친다.
    const p = player({ story: 3, skills: { ice: 1200, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const out = advance({ chain: caught, player: p, event: null })
    expect(p.story).toBe(4)
    expect([out.completed.map((s) => s.step), out.skipped]).toEqual([[3], []])
  })

  it('두 번째 훅부터는 아무 일도 안 한다 — 지표가 단조라 "첫 훅"을 기억할 필요가 없다', () => {
    const p = player({ skills: { ...VETERAN_SKILLS } })
    advance({ chain: caught, player: p, event: null })
    const again = advance({ chain: caught, player: p, event: null })
    expect([again.skipped, again.completed]).toEqual([[], []])
    expect(p.story).toBe(2)
  })

  it('문턱을 안 넘은 신규는 하나도 안 밀린다', () => {
    const p = player()
    const out = advance({ chain: caught, player: p, event: null })
    expect([p.story, out.skipped]).toEqual([0, []])
  })

  it('문턱이 없는 마디에서는 멈춘다 — 밀어올림은 적힌 데까지만이다', () => {
    const p = player({ skills: { ...VETERAN_SKILLS }, donated: { ice_shard: 5000 } })
    advance({ chain: caught, player: p, event: null })
    expect(p.story).toBe(4)
  })
})

describe('advanceStory — 끝과 가장자리', () => {
  it('사슬이 끝난 뒤에는 더 안 나아간다', () => {
    const p = player({ story: ICE_CHAIN.length })
    const out = advance({ chain: ICE_CHAIN, player: p, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([ICE_CHAIN.length, 0])
    expect([out.completed, out.skipped]).toEqual([[], []])
  })

  it('세이브의 마디 번호가 사슬 길이를 넘어도 터지지 않는다 — 마디를 지운 날의 옛 세이브다', () => {
    const p = player({ story: 99 })
    expect(() =>
      advance({ chain: ICE_CHAIN, player: p, event: { kind: 'arrive', mapId: '얼음채집장' } }),
    ).not.toThrow()
    expect(p.story).toBe(99)
  })

  it('빈 사슬에서는 아무 일도 없다 — 마디를 아직 안 쓴 표가 그 상태다', () => {
    const p = player()
    advance({ chain: [], player: p, event: { kind: 'arrive', mapId: '얼음채집장' } })
    expect(p.story).toBe(0)
  })

  it('세는 마디에 요구치가 없으면 영원히 안 끝난다 — 0 으로 접으면 사슬이 한 번에 굴러간다', () => {
    // 빌드가 막는 데이터다(parseStory 의 짝 강제). 막지 못했을 때 어느 쪽으로
    // 무너지는지를 못박는다 — 조용히 안 끝나는 쪽이다.
    const chain = [step({ step: 0, goal: { kind: 'gather', arg: 'ice' } })]
    const p = player()
    advance({ chain, player: p, event: { kind: 'gather', skill: 'ice' } })
    expect([p.story, p.storyCount]).toEqual([0, 1])
  })
})
