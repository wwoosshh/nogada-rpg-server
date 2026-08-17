import { loadGameData, parseStory, runStoryHook, validateStory, WORLD_MAP_ID } from '@nogada/data'
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

  // 왜: 마디를 다 쓴 지금도 이 갈래는 살아 있어야 한다 — `storyChainOf` 는 표가
  //     비면 마을 유도를 아예 안 돌고, 그 한 줄이 세계를 두 칸짜리 리터럴로 짓는
  //     다른 서비스 테스트들을 `startVillages` 의 던짐에서 지킨다.
  it('표를 비우면 훅이 아무것도 안 한다', () => {
    const empty: GameData = { ...loadGameData(), story: [] }
    const result = moveThroughTransition({ player: novice(), data: empty, now: 0, x: 15, y: 0 })
    expect(result.ok && result.outcome.player.story).toBe(0)
  })

  // 왜: 위아래의 검사들은 전부 **이 파일이 지은 표**를 민다. 출하 표가 실제로 훅에
  //     걸리는지는 그것과 다른 물음이고, 그 답이 아니면 게임 안에서는 아무 일도 안
  //     일어난다 — 마디 12행이 선 지금 그 물음을 여기서 한 번 묻는다.
  it('출하 표에서도 문을 넘으면 마디 0 이 끝난다', () => {
    const result = moveThroughTransition({ player: novice(), data: loadGameData(), now: 0, x: 15, y: 0 })
    expect(result.ok && result.outcome.player.story).toBe(1)
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
    // **거절에는 응답에 실릴 플레이어 자체가 없다** — 그것이 이 성질의 전부다.
    // 입력 `player` 를 재는 것은 뜻이 없다: 이 함수는 첫 줄에서 `structuredClone`
    // 하므로 훅을 어디로 옮기든, 아예 지우든 입력은 안 바뀐다. 그래서 반환값이
    // `{ok:false, code}` 하나뿐이라는 것을 통째로 못박는다.
    expect(result).toEqual({ ok: false, code: 'locked' })
  })

  // 왜: 훅은 **자리를 옮긴 뒤**에 돌아야 한다(moveService 의 훅 자리 주석). 그
  //     한 줄을 위로 올려도 2,300 이 전부 초록이던 자리다.
  //
  //     이 검사가 재는 사람은 **시작 마을이 안 적힌 옛 세이브**(친구들 계정)다 —
  //     아크 F 가 그 칸을 늘린 뒤로 순서가 값을 바꾸는 사람이 그들뿐이기 때문이다.
  //     적힌 사람은 유도가 아예 안 돌아 어디서 부르든 같은 사슬이 서고, 안 적힌
  //     사람에게만 유도가 서 있는 자리를 본다(`storyVillage` 의 ②). 훅을 위에서
  //     부르면 그 사람은 월드맵에 서 있고, 월드맵에는 어느 마을에서 났는지 말해
  //     주는 정보가 없어 유도가 늘 같은 답(눈의마을)으로 떨어진다.
  it('훅은 자리를 옮긴 뒤에 돈다 — 옛 세이브의 사슬은 도착한 마을 것이다', () => {
    // 마디 0 을 「{마을}에 닿아라」로 둔다. 사슬이 어느 마을 것으로 폈는지가
    // 그대로 값이 된다 — 눈의마을 것으로 폈으면 항구마을 도착은 아무것도 안 끝낸다.
    const rows = [{ ...ROWS[0]!, goalArg: '{마을}', objective: '{마을}로 돌아가라' }]
    const homeward: GameData = { ...data, story: parseStory(rows) }
    expect(validateStory(homeward)).toEqual([])

    const door = data.transitions.find((t) => t.fromMap === WORLD_MAP_ID && t.toMap === '항구마을')!
    // 숙련이 전부 0 · 시작 마을 미기록이라 유도는 오직 서 있는 자리로만 갈린다.
    const player = novice({
      startVillage: '',
      location: { mapId: WORLD_MAP_ID, x: door.fromX, y: door.fromY },
    })

    const result = moveThroughTransition({ player, data: homeward, now: 0, x: door.fromX, y: door.fromY })
    expect(result.ok && result.outcome.player.story).toBe(1)
    // 그리고 같은 순서가 **못박기**도 진다: 도착한 자리가 유도에 근거를 준다.
    expect(result.ok && result.outcome.player.startVillage).toBe('항구마을')
  })

  // 왜: 위 검사의 반대편이다 — 시작 마을이 **적힌** 사람은 남의 마을에 넘어가도
  //     자기 사슬을 걷는다. 이것이 없으면 `storyVillage` 가 저장된 값을 무시하고
  //     유도로 되돌아가도 아무도 안 짖는다(월드맵→항구마을 이동은 유도 ② 로도
  //     항구마을을 내므로, 위 검사만으로는 두 구현이 구별되지 않는다).
  it('시작 마을이 적힌 사람은 남의 마을에 넘어가도 자기 사슬이다', () => {
    const rows = [{ ...ROWS[0]!, goalArg: '{마을}', objective: '{마을}로 돌아가라' }]
    const homeward: GameData = { ...data, story: parseStory(rows) }

    const door = data.transitions.find((t) => t.fromMap === WORLD_MAP_ID && t.toMap === '항구마을')!
    // 눈의마을에서 난 사람이다(novice). 숙련은 전부 0 이라 유도라면 도착한
    // 항구마을을 낼 자리인데, 적힌 값이 있으므로 사슬은 여전히 눈의마을 것이다.
    const player = novice({ location: { mapId: WORLD_MAP_ID, x: door.fromX, y: door.fromY } })

    const result = moveThroughTransition({ player, data: homeward, now: 0, x: door.fromX, y: door.fromY })
    expect(result.ok && result.outcome.player.story).toBe(0)
    expect(result.ok && result.outcome.player.startVillage).toBe('눈의마을')
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

  // 왜: ②의 숙련 증가는 **성패 무관**이라 헛손질 하나가 문턱을 넘긴다. 훅에게
  //     지금 숙련을 넘기면 그 헛손질이 「이 사람은 예전부터 문턱 위였다」로 읽혀서,
  //     아직 얼음 조각을 한 번도 못 캔 사람의 「{노드} 앞에서 A」가 조용히 사라진다.
  //     마디 1 의 문턱을 1 이 아니라 1,000 으로 적은 것(위 ROWS 주석)은 이 새는
  //     자리를 **표 쪽에서** 좁힌 것이고, 이 검사는 **배선 쪽**이 같은 자리를
  //     닫는지를 본다.
  it('손질 앞의 숙련을 훅에게 넘긴다 — 헛손질이 자기 마디를 지나친 것으로 만들지 않는다', () => {
    const player = novice({
      story: 1,
      skills: { ice: 999, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      location: { mapId: '얼음채집장', x: arrival.toX, y: arrival.toY },
    })
    const result = gatherAt(player, () => 0.999_999)
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

  // 왜: 이 서비스가 훅에게 넘기는 것은 **바치기 전**의 `donated` 여야 한다. 지금
  //     것을 넘기면 이 헌납이 방금 채운 첫 단(마디 2 의 문턱이 정확히
  //     `collection>=1` 이다)이 「예전부터 그랬다」로 읽혀서, 아직 델타를 절반밖에
  //     못 채운 사람의 마디가 그 자리에서 `skipped` 로 사라진다 — 수집의 방 첫 별
  //     축하가 통째로 없어지고, 그 사고는 화면 어디에도 오류로 안 보인다.
  //     100 개를 미리 바쳐 둔 사람이 나머지를 채우는 이 배선이 그것을 값으로 가른다.
  it('바치기 전의 방을 훅에게 넘긴다 — 방금 채운 첫 단이 그 사람의 마디를 집어 가지 않는다', () => {
    const player = novice({ story: 2, stacks: { ice_shard: 100 }, donated: { ice_shard: 100 } })
    const result = performDonate({ player, data, itemId: 'ice_shard', count: 100 })
    // 델타는 100 뿐이라 마디 2(200)는 아직 안 끝났다. 지금 상태로 밀어올림을 재면
    // 여기서 story 가 3 으로 튄다 — 바친 적 없는 마디를 지나쳤다고 세는 것이다.
    expect(result.ok && [result.outcome.player.story, result.outcome.player.storyCount]).toEqual([2, 100])
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

  // 왜: 제작은 조합 숙련을 올린다 — 훅에게 지금 숙련을 넘기면 이번 제작이 방금
  //     넘긴 문턱이 「예전부터 그랬다」로 읽혀서, 이 제작과 상관없는 마디가 조용히
  //     지나간 것이 된다. **목표를 다른 레시피로 둬야** 그 차이가 값으로 갈린다:
  //     같은 레시피면 사건이 어차피 그 마디를 끝내므로 두 배선이 같은 수를 낸다.
  it('제작 앞의 숙련을 훅에게 넘긴다 — 이번 제작이 넘긴 문턱은 밀어올림이 아니다', () => {
    const rows = [{
      ...ROWS[3]!, step: '0', objective: '무언가 만들어라', goalArg: 'snow_powder',
      catchUpKind: 'skill', catchUpArg: 'crafting', catchUpThreshold: '200',
    }]
    const world: GameData = { ...data, story: parseStory(rows) }
    expect(validateStory(world)).toEqual([])

    // 조합 195 — 구리 주괴 하나가 10~20 을 올리므로 이 제작이 문턱(200)을 넘긴다.
    const player = novice({
      skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 195 },
      stacks: { copper_ore: 2 },
    })
    const result = performCraft({
      player, data: world, recipeId: 'copper_ingot', rng: () => 0, newId: () => 'x', now: 1,
    })
    expect(result.ok && result.outcome.player.skills.crafting).toBeGreaterThanOrEqual(200)
    expect(result.ok && result.outcome.player.story).toBe(0)
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

  // 왜: 고인물의 **가장 흔한 첫 훅이 마을 문을 나서는 것**이고, 마디 0 이 하필
  //     「{마을} {방향}문으로 나가라」다. `story` 만 재면 이 사고가 안 보인다 —
  //     끝냈든 지나쳤든 그 사람은 사슬 끝에 선다. 갈리는 것은 **무엇으로 세는가**
  //     이고, Q6 이 `completed` 의 `announce` 를 띄우는 순간 그 차이가 화면에 뜬다.
  //     `StoryAdvance` 자신이 「`skipped` 는 말하면 안 되는 것」이라 적어 놓았다.
  it('고인물이 문을 나서도 마디 0 은 해낸 것이 아니다 — 초보 안내를 축하로 받지 않는다', () => {
    const player = veteran()
    const out = runStoryHook({
      data,
      player,
      before: structuredClone(player),
      event: { kind: 'arrive', mapId: '얼음채집장' },
    })
    expect(out.completed).toEqual([])
    expect(out.skipped.map((s) => s.step)).toEqual([0, 1, 2, 3])
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
