import { loadGameData, parseStory, validateStory } from '@nogada/data'
import { loadBarrierRegions } from '@nogada/data/barriers'
import { loadGatherTables } from '@nogada/data/gather-tables'
import type { GameData, PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { createInitialPlayer } from '../state/newCharacter.js'
import { performCraft } from './craftService.js'
import { performDonate } from './donateService.js'
import { performGather } from './gatherService.js'
import { moveThroughTransition } from './moveService.js'

/**
 * 판정 훅 넷이 실제로 사슬을 미는가(설계 ⑧-4).
 *
 * **세계를 손으로 짓지 않고 출하 데이터 위에 표만 얹는다.** 사슬은 마을에서
 * 유도되므로(`storyVillage`) 두 칸짜리 리터럴 세계에서는 애초에 설 수가 없고,
 * 그런 세계로 재면 "훅이 붙었다"만 확인하고 "그 사람의 사슬이 맞게 폈다"는 못
 * 본다 — 이 아크가 실제로 틀릴 수 있는 자리는 후자다.
 *
 * 마디 표는 여기서만 산다. 출하 `story.csv` 에 임시 행을 넣으면 게임에 진짜로
 * 그 마디가 서고 플레이어가 그것을 읽는다.
 */

const tables = loadGatherTables()
const barriers = loadBarrierRegions()

/** 마을 넷 전부에서 서는 마디 넷 — 도착 · 채집 · 헌납 · 제작, 훅 하나씩이다. */
const ROWS = [
  {
    step: '0', field: '', objective: '{마을} {문방향}문으로 나가라',
    goalKind: 'arrive', goalArg: '{채집장}', goalCount: '', announce: '',
    discoverable: '1', catchUpKind: 'skill', catchUpArg: '{계열}', catchUpThreshold: '1',
  },
  {
    // 문턱이 1 이 아니라 1,000 인 이유가 이 표의 유일한 판단이다: 채집은 **실패한
    // 손질도** 숙련을 올리므로, 「캐라」 마디에 `>=1` 을 걸면 첫 헛손질이 그 마디를
    // 끝낸 것이 아니라 **지나친** 것으로 만든다(StoryCatchUp 의 "그 마디가 스스로
    // 만드는 값보다 위여야 한다"). 여기서 그것을 실제로 재는 검사가 아래에 있다.
    step: '1', field: '', objective: '{노드} 앞에서 A',
    goalKind: 'gather', goalArg: '{계열}', goalCount: '1', announce: '',
    discoverable: '1', catchUpKind: 'skill', catchUpArg: '{계열}', catchUpThreshold: '1000',
  },
  {
    step: '2', field: '', objective: '{아이템} 을 {t1} 개 바쳐라',
    goalKind: 'donate', goalArg: '{아이템}', goalCount: '{t1}', announce: '',
    discoverable: '1', catchUpKind: 'collection', catchUpArg: '', catchUpThreshold: '1',
  },
  {
    // 제작만 슬롯이 아니라 고정 레시피다 — 이 스위트가 재는 것은 훅이지 표가 아니고,
    // 구리 주괴는 요구 숙련 0 이라 어느 마을 사람이든 그 자리에서 만들 수 있다.
    step: '3', field: '', objective: '구리 주괴를 만들어라',
    goalKind: 'craft', goalArg: 'copper_ingot', goalCount: '1', announce: '',
    discoverable: '1', catchUpKind: 'skill', catchUpArg: '{계열}', catchUpThreshold: '1000',
  },
]

const data: GameData = { ...loadGameData(), story: parseStory(ROWS) }

/** 눈의마을에서 난 신규. 사슬의 첫 마디에 서 있고 아무것도 안 캤다. */
function novice(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    ...createInitialPlayer({ id: 'local', name: '아무개', appearance: 'player', village: '눈의마을' }),
    ...overrides,
  }
}

/** 얼음 채집장의 얼음 광맥 하나 — 마을에서 문을 넘으면 그 앞에 서는 노드다. */
const iceVein = Object.values(data.placements).find(
  (p) => p.mapId === '얼음채집장' && data.nodes[p.nodeId]?.skill === 'ice' && data.nodes[p.nodeId]?.variant === 'normal',
)!

/** 문을 넘어 채집장에 막 도착한 자리 — 결계 바깥이다. */
const arrival = data.transitions.find((t) => t.fromMap === '눈의마을' && t.toMap === '얼음채집장')!

describe('스토리 훅 — 전제', () => {
  it('이 표는 빌드를 통과한다 — 통과 못 하는 표로 훅을 재면 뜻이 없다', () => {
    expect(validateStory(data)).toEqual([])
  })

  it('출하 표가 비어 있어도 훅은 아무것도 안 한다 — 마디를 아직 안 쓴 오늘이 그 상태다', () => {
    const player = novice()
    const result = moveThroughTransition({ player, data: loadGameData(), now: 0, x: 15, y: 0 })
    expect(result.ok && result.outcome.player.story).toBe(0)
  })
})

describe('스토리 훅 — 이동(새 훅이다)', () => {
  it('채집장으로 나가면 마디 0 이 끝난다', () => {
    const result = moveThroughTransition({ player: novice(), data, now: 0, x: 15, y: 0 })
    expect(result.ok && result.outcome.player.story).toBe(1)
  })

  it('결계에 막힌 이동은 사슬을 안 민다 — 넘지 못한 문은 넘은 것이 아니다', () => {
    // 얼음 결계(85,000)를 숙련 0 으로 두드린다. 마디 0 을 「그 결계 너머」로 바꿔
    // 두면, 거절 경로가 사슬을 미는지 아닌지가 값으로 갈린다.
    const barrier = data.transitions.find((t) => t.gateSkill === 'ice')!
    const rows = [{ ...ROWS[0]!, goalArg: '얼음채집장', objective: '{마을} {문방향}문으로 나가라' }]
    const walled: GameData = { ...data, story: parseStory(rows) }
    const player = novice({ location: { mapId: '얼음채집장', x: arrival.toX, y: arrival.toY } })

    const result = moveThroughTransition({ player, data: walled, now: 0, x: barrier.fromX, y: barrier.fromY })
    expect(result.ok).toBe(false)
    expect(player.story).toBe(0)
  })
})

describe('스토리 훅 — 채집', () => {
  function gatherAt(player: PlayerState, rng: () => number) {
    return performGather({
      player, data, tables, barriers, instanceId: iceVein.instanceId, rng, now: 1,
    })
  }

  it('첫 채집이 마디 1 을 끝낸다', () => {
    const player = novice({
      story: 1,
      location: { mapId: '얼음채집장', x: arrival.toX, y: arrival.toY },
    })
    const result = gatherAt(player, () => 0)
    expect(result.ok && result.outcome.success).toBe(true)
    expect(result.ok && result.outcome.player.story).toBe(2)
  })

  // 왜: 숙련 증가는 **성패 무관 무조건**이라(gatherService 의 ②) 헛손질 하나가
  //     이정표 문턱을 넘길 수 있다. 훅을 성공했을 때만 부르면 그 사람의 사슬은
  //     마지막 광석을 실패로 캔 그 자리에 선 채로 남고, 다음 성공까지 띠가 거짓말을
  //     한다 — 이정표 재판정이 무조건인 것과 같은 이유, 같은 자리다.
  it('실패한 손질도 이정표 마디를 넘긴다 — 사건은 안 실어도 훅은 무조건 돈다', () => {
    const reachStep = {
      step: '0', field: '', objective: '{계열} 숙련 1,000',
      goalKind: 'reach', goalArg: '{계열}_1000', goalCount: '', announce: '',
      discoverable: '1', catchUpKind: 'every', catchUpArg: 'every_1000', catchUpThreshold: '1',
    }
    const world: GameData = { ...data, story: parseStory([reachStep]) }
    expect(validateStory(world)).toEqual([])

    const player = novice({
      skills: { ice: 999, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      location: { mapId: '얼음채집장', x: arrival.toX, y: arrival.toY },
    })
    const result = performGather({
      player, data: world, tables, barriers, instanceId: iceVein.instanceId, rng: () => 0.999_999, now: 1,
    })
    expect(result.ok && result.outcome.success).toBe(false)
    expect(result.ok && result.outcome.player.skills.ice).toBeGreaterThanOrEqual(1000)
    expect(result.ok && result.outcome.player.story).toBe(1)
  })

  it('실패한 손질은 안 센다 — 마디가 세는 것은 손에 들어온 것이다', () => {
    const player = novice({
      story: 1,
      location: { mapId: '얼음채집장', x: arrival.toX, y: arrival.toY },
    })
    // 가장 높은 굴림은 어느 브라켓에서도 표 밖이라 빈손이다.
    const result = gatherAt(player, () => 0.999_999)
    expect(result.ok && result.outcome.success).toBe(false)
    expect(result.ok && [result.outcome.player.story, result.outcome.player.storyCount]).toEqual([1, 0])
  })
})

describe('스토리 훅 — 헌납', () => {
  it('바친 개수가 마디 2 를 끝낸다', () => {
    const player = novice({ story: 2, stacks: { ice_shard: 200 } })
    const result = performDonate({ player, data, itemId: 'ice_shard', count: 200 })
    expect(result.ok && result.outcome.player.story).toBe(3)
  })

  it('모자라게 바치면 델타만 오른다', () => {
    const player = novice({ story: 2, stacks: { ice_shard: 50 } })
    const result = performDonate({ player, data, itemId: 'ice_shard', count: 50 })
    expect(result.ok && [result.outcome.player.story, result.outcome.player.storyCount]).toEqual([2, 50])
  })
})

describe('스토리 훅 — 제작', () => {
  it('그 레시피를 만들면 마디 3 이 끝나고 사슬이 끝난다', () => {
    const player = novice({ story: 3, stacks: { copper_ore: 2 } })
    const result = performCraft({
      player, data, recipeId: 'copper_ingot', rng: () => 0, newId: () => 'x', now: 1,
    })
    expect(result.ok && result.outcome.success).toBe(true)
    expect(result.ok && result.outcome.player.story).toBe(4)
  })

  it('사슬이 끝난 뒤에는 더 안 나아간다', () => {
    const player = novice({ story: 4, stacks: { copper_ore: 2 } })
    const result = performCraft({
      player, data, recipeId: 'copper_ingot', rng: () => 0, newId: () => 'x', now: 1,
    })
    expect(result.ok && [result.outcome.player.story, result.outcome.player.storyCount]).toEqual([4, 0])
  })
})

describe('스토리 훅 — 밀어올림', () => {
  /** 얼음 200,000 인 테스터. 게임은 이미 공개돼 있고 이 사람의 계정이 살아 있다. */
  function veteran(): PlayerState {
    return novice({
      skills: { ice: 200_000, wood: 0, mineral: 0, herb: 0, crafting: 5000 },
      donated: { ice_shard: 20_000 },
      stacks: { copper_ore: 2 },
    })
  }

  // 왜: 안 밀어 올리면 그 사람에게 「눈의 마을 북문으로 나가라」가 뜬다(설계 ⑦,
  //     실기 확인 1번). 그리고 그것은 아무 화면에도 오류로 안 보인다 — 그냥
  //     오래 논 사람이 초보 안내를 읽는다.
  it('첫 판정 훅이 기존 캐릭터를 사슬 끝까지 민다', () => {
    const player = veteran()
    const result = performCraft({
      player, data, recipeId: 'copper_ingot', rng: () => 0, newId: () => 'x', now: 1,
    })
    expect(result.ok && result.outcome.player.story).toBe(data.story.length)
  })

  it('이동 훅도 같은 자리를 민다 — 훅마다 따로 배선하지 않았다', () => {
    const result = moveThroughTransition({ player: veteran(), data, now: 0, x: 15, y: 0 })
    expect(result.ok && result.outcome.player.story).toBe(data.story.length)
  })

  it('신규는 하나도 안 밀린다 — 밀어올림은 이미 지나친 사람만 태운다', () => {
    const result = moveThroughTransition({ player: novice(), data, now: 0, x: 15, y: 0 })
    // 마디 0 은 이 이동이 실제로 끝낸 것이고, 마디 1 의 문턱(얼음 1)은 아직 멀다.
    expect(result.ok && result.outcome.player.story).toBe(1)
  })
})

describe('스토리 훅 — 사슬은 그 사람의 마을 것이다', () => {
  it('허브 마을 사람은 허브 채집장으로 나가야 마디 0 이 끝난다', () => {
    const player = novice({
      ...createInitialPlayer({ id: 'p', name: '아무개', appearance: 'player', village: '항구마을' }),
    })
    const gate = data.transitions.find((t) => t.fromMap === '항구마을' && t.toMap === '허브채집장')!
    const result = moveThroughTransition({ player, data, now: 0, x: gate.fromX, y: gate.fromY })
    expect(result.ok && result.outcome.player.story).toBe(1)
  })

  it('허브 마을 사람이 바칠 것은 흔한 약초 150 개다 — 얼음 조각이 아니다', () => {
    const player = {
      ...createInitialPlayer({ id: 'p', name: '아무개', appearance: 'player', village: '항구마을' }),
      story: 2,
      // 자기 계열을 캐 온 사람이다 — 그래야 사슬이 허브 마을 것으로 유도된다.
      skills: { ice: 0, wood: 0, mineral: 0, herb: 500, crafting: 0 },
      // 얼음 조각 50 은 첫 단(200)에 못 미쳐 방의 총점을 못 올린다 — 밀어올림
      // 문턱(collection>=1)이 아니라 **다른 물건이라서** 안 세는 것을 재려는 것이다.
      stacks: { common_herb: 150, ice_shard: 50 },
    }

    const wrong = performDonate({ player, data, itemId: 'ice_shard', count: 50 })
    expect(wrong.ok && [wrong.outcome.player.story, wrong.outcome.player.storyCount]).toEqual([2, 0])

    const right = performDonate({ player, data, itemId: 'common_herb', count: 150 })
    expect(right.ok && right.outcome.player.story).toBe(3)
  })
})
