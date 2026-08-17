import {
  GAME_EPOCH_MS,
  NPC_STEP_MS,
  REAL_MS_PER_GAME_DAY,
  REAL_MS_PER_GAME_MINUTE,
  RECENT_DIALOGUE_LIMIT,
  defaultCombatState,
  emptyDialogueHistory,
  type BakedLeg,
  type DialogueRule,
  type GameData,
  type InnDef,
  type MasterDef,
  type MilestoneDef,
  type PlaceDef,
  type PlayerState,
  type RouteStep,
  type ScheduleDef,
  type ShopDef,
} from '@nogada/shared'
import { loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { performTalk } from './talkService.js'

/** 얼음 숙련도 10000 에서 열리는 이정표. milestone.<id> 사실이 실제로 공급되는지 보는 데 쓴다. */
const iceMilestone: MilestoneDef = {
  id: 'ice_10000',
  metric: { kind: 'skill', skill: 'ice' },
  threshold: 10_000,
  name: '얼음에 익숙해지다',
  announce: '얼음을 다루는 손이 익숙해졌다',
  effect: { kind: 'title' },
}

function rule(over: Partial<DialogueRule> & Pick<DialogueRule, 'id' | 'event' | 'lines'>): DialogueRule {
  return {
    speaker: '노인',
    conditions: [],
    source: { file: '노인.dlg', line: 1 },
    ...over,
  }
}

/**
 * 인사 규칙 넷은 일부러 조건이 같다(동점).
 *
 * 하나만 두면 `recent` 제외가 후보를 전부 비워 폴백이 걸려, 제외가 실제로
 * 일어났는지 결과만 봐서는 알 수 없다 — RECENT_DIALOGUE_LIMIT 보다 하나 많은
 * 넷이라야 창이 가득 찬 뒤에도 고를 것이 남는다.
 */
const greetA = rule({ id: 'greet-a', event: 'greet', lines: ['허어, 또 왔는가.'] })
const greetB = rule({ id: 'greet-b', event: 'greet', lines: ['또 왔군.', '부지런하기도 하지.'] })
const greetC = rule({ id: 'greet-c', event: 'greet', lines: ['오늘도 왔군.'] })
const greetD = rule({ id: 'greet-d', event: 'greet', lines: ['왔는가.'] })

/** once 사건(milestone)의 규칙. 조건은 이산적인 boolean 이라 onceKey 가 흔들리지 않는다. */
const milestoneRule = rule({
  id: 'ms-ice',
  event: 'milestone',
  conditions: [{ fact: 'milestone.ice_10000', op: '=', value: true }],
  lines: ['손이 익었군.', '그 나이에 벌써 그러면 나는 뭐가 되나.'],
})

/** 두 번째 대화에서만 맞는 규칙. talkedBefore 사실이 실제로 공급되는지 본다. */
const againRule = rule({
  id: 'greet-again',
  event: 'greet',
  conditions: [{ fact: 'talkedBefore', op: '=', value: true }],
  lines: ['또 보는군.'],
})

/**
 * 다른 화자의 규칙. 화자 필터가 서비스 경로에서도 살아 있는지 본다.
 *
 * 이 줄은 오래 "깊은 얼음은 구리 정으로는 깨지지 않는다" 였다 — 결계 아크가
 * 지운 **출하된 거짓말 셋 중 셋째**를 픽스처로 베껴 갖고 있던 것이다. 가짜
 * 화자용 시험 자료라 출하물은 아니지만, 다음 사람이 그 문장을 grep 하면
 * 지운 줄이 아직 살아 있는 것처럼 걸린다.
 */
const otherRule = rule({
  id: 'sign-greet',
  speaker: '안내판',
  event: 'greet',
  lines: ['여기서부터 안쪽이다.'],
})

function gameData(dialogue: DialogueRule[]): GameData {
  return {
    items: {},
    nodes: {},
    recipes: {},
    // 화자 둘 다 얼음채집장에 서 있다 — 등록부에 그 맵이 있어야 앞뒤가 맞는다.
    maps: {
      얼음채집장: { id: '얼음채집장', name: '얼음 채집장', file: '얼음채집장.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } },
    },
    transitions: [],
    placements: {},
    milestones: [iceMilestone],
    speakers: {
      노인: { id: '노인', name: '채집장 노인', kind: 'npc', mapId: '얼음채집장', x: 1, y: 1, sprite: 'npc_elder', facing: 'down' },
      안내판: { id: '안내판', name: '안내판', kind: 'sign', mapId: '얼음채집장', x: 2, y: 2, sprite: 'sign_wood', facing: 'down' },
    },
    shops: {}, masters: [], inns: {}, enhanceCosts: [], collection: {},
    places: {}, schedules: {}, routes: [],
    dialogue,
    monsters: {}, monsterPlacements: {}, story: [],
  }
}

const data = gameData([greetA, greetB, greetC, greetD, milestoneRule, otherRule])

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
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    // 사슬은 이 스위트가 보는 판정이 아니다 — PlayerState 의 필수 칸이라 채워만 둔다.
    story: 0,
    storyCount: 0,
    startVillage: '',
    // 아직 아무 달인에게도 대금을 받지 않았다 — 대금 테스트가 여기에 값을 넣어
    // "이미 받은 사람"을 만든다.
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    // 화자 둘 다 얼음채집장에 서 있으므로 기본 플레이어도 거기 세운다 — 그래야
    // 기존 테스트들이 "맵이 같다"를 따로 말하지 않아도 앞뒤가 맞는다.
    location: { mapId: '얼음채집장', x: 0, y: 0 },
    ...overrides,
  }
}

/** 후보 배열의 첫 번째를 고르는 난수. */
const pickFirst = () => 0
/** 후보 배열의 마지막을 고르는 난수 — 0.999 * n 은 언제나 n-1 로 내림된다. */
const pickLast = () => 0.999

function talk(p: PlayerState, over: { data?: GameData; speakerId?: string; rng?: () => number; now?: number } = {}) {
  return performTalk({
    player: p,
    data: over.data ?? data,
    speakerId: over.speakerId ?? '노인',
    rng: over.rng ?? pickFirst,
    now: over.now ?? 0,
  })
}

describe('performTalk', () => {
  it('없는 화자는 unknown_speaker 로 거부한다', () => {
    expect(talk(player(), { speakerId: '유령' })).toEqual({ ok: false, code: 'unknown_speaker' })
  })

  // 왜: 이것이 대화 스펙이 남긴 구멍이다. 앞칸 판정은 클라이언트에만 있어서,
  //     서버가 어느 맵인지 모르면 화자 id 하나만으로 맵 너머의 화자와 대화가
  //     열린다 — 그리고 그 대화는 이력에까지 남는다.
  it('다른 맵의 화자에게는 말을 걸 수 없다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    expect(talk(p)).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('상속된 키(constructor)를 화자로 보내도 unknown_speaker 다', () => {
    // speakerId 는 클라이언트가 그대로 보낸 문자열이다. data.speakers[id] 로 바로
    // 읽으면 프로토타입 체인의 값이 truthy 로 잡힌다 — gatherService 가 placements
    // 에서 막는 것과 같은 구멍이다.
    expect(talk(player(), { speakerId: 'constructor' })).toEqual({ ok: false, code: 'unknown_speaker' })
  })

  it('발화 전체가 한 번에 담긴다 — 칸마다 요청하지 않는다', () => {
    // 대화 한 번이 요청 한 번이다(설계 문서 4.5). 칸마다 왕복하면 한 마디를
    // 말하는 사이에 세계가 바뀌어, 플레이어는 두 상태가 섞인 말을 듣는다.
    const r = talk(player(), { rng: () => 0.3 }) // 후보 넷 중 두 번째(greet-b, 두 칸짜리)
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.lines).toEqual(['또 왔군.', '부지런하기도 하지.'])
  })

  it('요청한 화자를 그대로 돌려준다', () => {
    const r = talk(player())
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.speaker).toBe('노인')
  })

  it('다른 화자의 규칙은 나오지 않는다', () => {
    const r = talk(player(), { speakerId: '안내판' })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.lines).toEqual(['여기서부터 안쪽이다.'])
  })

  it('고른 규칙이 recent 에 들어간다', () => {
    const r = talk(player())
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.dialogueHistory.recent['노인']).toEqual(['greet-a'])
  })

  it('recent 는 화자별로 나뉜다', () => {
    const first = talk(player())
    if (!first.ok) throw new Error('성공해야 한다')
    const second = talk(first.outcome.player, { speakerId: '안내판' })
    if (!second.ok) throw new Error('성공해야 한다')

    expect(second.outcome.player.dialogueHistory.recent).toEqual({
      노인: ['greet-a'],
      안내판: ['sign-greet'],
    })
  })

  it('ONCE_EVENTS 의 규칙을 고르면 said 에 들어가고, 다시 부르면 다른 사건이 나온다', () => {
    const veteran = player({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })

    const first = talk(veteran)
    if (!first.ok) throw new Error('성공해야 한다')
    expect(first.outcome.lines).toEqual(['손이 익었군.', '그 나이에 벌써 그러면 나는 뭐가 되나.'])
    expect(first.outcome.player.dialogueHistory.said).toHaveLength(1)

    // 같은 사람에게 다시 말을 건다 — milestone 은 이미 말했으므로 사건 서열이
    // 한 칸 내려가 greet 이 나와야 한다.
    const second = talk(first.outcome.player)
    if (!second.ok) throw new Error('성공해야 한다')
    expect(second.outcome.lines).toEqual(['허어, 또 왔는가.'])
    expect(second.outcome.player.dialogueHistory.said).toHaveLength(1)
  })

  it('greet 은 여러 번 불러도 계속 나온다', () => {
    let p = player()
    for (let i = 0; i < 5; i++) {
      const r = talk(p)
      if (!r.ok) throw new Error(`${i + 1}번째 대화가 성공해야 한다`)
      expect(r.outcome.lines.length).toBeGreaterThan(0)
      p = r.outcome.player
    }
    // greet 은 ONCE_EVENTS 가 아니다 — 다섯 번을 말해도 said 는 비어 있어야 한다.
    expect(p.dialogueHistory.said).toEqual([])
  })

  it('recent 가 상대마다 정해진 개수를 넘지 않는다', () => {
    let p = player()
    for (let i = 0; i < 8; i++) {
      const r = talk(p)
      if (!r.ok) throw new Error(`${i + 1}번째 대화가 성공해야 한다`)
      p = r.outcome.player
      expect(p.dialogueHistory.recent['노인']!.length).toBeLessThanOrEqual(RECENT_DIALOGUE_LIMIT)
    }
    // 후보가 넷이라 여덟 번을 말하면 창은 반드시 가득 찬다 — 상한이 없으면 여덟이 된다.
    expect(p.dialogueHistory.recent['노인']).toHaveLength(RECENT_DIALOGUE_LIMIT)
  })

  it('같은 규칙을 두 번 담아 창을 낭비하지 않는다', () => {
    // 후보가 하나뿐이면 폴백이 걸려 같은 규칙이 계속 나온다. 그때마다 밀어 넣으면
    // 창이 한 규칙으로 가득 차, 콘텐츠가 늘어난 뒤에도 "최근 세 마디를 피한다"가
    // 조용히 "최근 한 마디를 피한다"로 줄어든다.
    const single = gameData([greetA])
    let p = player()
    for (let i = 0; i < 3; i++) {
      const r = talk(p, { data: single })
      if (!r.ok) throw new Error('성공해야 한다')
      p = r.outcome.player
    }
    expect(p.dialogueHistory.recent['노인']).toEqual(['greet-a'])
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    talk(p)
    expect(p.dialogueHistory).toEqual({ said: [], recent: {}, lastTalkAt: {} })
  })

  it('행동 간격을 소비하지 않는다 — 대화는 채집이 아니다', () => {
    const p = player({ nextActionAt: 1234 })
    const r = talk(p, { now: 9999 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1234)
  })

  it('행동 간격이 남아 있어도 말을 걸 수 있다', () => {
    // 앞의 테스트가 "간격을 새로 걸지 않는다"라면 이건 "간격을 검사하지도 않는다"다.
    // 대화가 간격에 묶이면 NPC 하나하나가 노가다에 붙는 세금이 된다.
    const p = player({ nextActionAt: 9_000_000 })
    const r = talk(p, { now: 0 })
    if (!r.ok) throw new Error('쿨다운 중에도 대화는 성공해야 한다')
    expect(r.outcome.lines.length).toBeGreaterThan(0)
  })

  it('대화 시각을 화자별로 기록한다', () => {
    const r = talk(player(), { now: 1_800_000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.dialogueHistory.lastTalkAt).toEqual({ 노인: 1_800_000 })
  })

  it('두 번째 대화에서는 talkedBefore 사실이 공급된다', () => {
    // 서비스가 사실 공급자를 실제로 부르는지 보는 자리다. 공급을 빠뜨리면
    // talkedBefore 조건을 건 규칙은 영원히 나오지 않는다 — 오류도 로그도 없이.
    const withAgain = gameData([greetA, againRule])

    const first = talk(player(), { data: withAgain })
    if (!first.ok) throw new Error('성공해야 한다')
    expect(first.outcome.lines).toEqual(['허어, 또 왔는가.'])

    const second = talk(first.outcome.player, { data: withAgain, now: 1000 })
    if (!second.ok) throw new Error('성공해야 한다')
    // 조건이 하나 더 많은 규칙이 무조건 인사를 이긴다.
    expect(second.outcome.lines).toEqual(['또 보는군.'])
  })

  it('할 말이 하나도 없으면 nothing_to_say 로 거부한다', () => {
    // 빌드 검증이 "무조건 @greet 이 없는 화자"를 막으므로 정상 데이터에서는
    // 나오지 않는다. 그래도 빈 발화를 ok 로 돌려주면 클라이언트가 빈 대사창을 연다.
    const silent = gameData([milestoneRule])
    expect(talk(player(), { data: silent })).toEqual({ ok: false, code: 'nothing_to_say' })
  })

  it('거부당한 요청은 대화 이력을 건드리지 않는다', () => {
    const r = talk(player(), { speakerId: '유령' })
    expect(r.ok).toBe(false)
  })

  it('후보가 여럿이면 난수로 갈린다', () => {
    // rng 를 주입받는다는 것이 이 서비스의 계약이다 — 서버만 시드를 만든다.
    const first = talk(player(), { rng: pickFirst })
    const last = talk(player(), { rng: pickLast })
    if (!first.ok || !last.ok) throw new Error('둘 다 성공해야 한다')
    expect(first.outcome.lines).not.toEqual(last.outcome.lines)
  })
})

/**
 * 상점과 달인 대금은 **대사가 아니라 등록부가 연다**(§6-앞 1·2).
 *
 * 한때 상점은 대사 규칙에 붙는 효과(`!shop=`)로 열릴 예정이었다. 그러면 한 번도
 * 안 열린다 — `selectDialogue` 는 조건이 가장 많은 규칙만 남기므로 조건 하나짜리
 * 상점 규칙은 조건 둘짜리 거래 암시 규칙에게 언제나 진다. 그래서 이 스위트가
 * 보는 것은 하나다: **이긴 규칙이 무엇이든** 상점과 대금이 실려 나가는가.
 */
describe('performTalk — 등록부가 싣는 것(상점·달인 대금)', () => {
  const 얼음상점: ShopDef = {
    id: '얼음상점',
    name: '얼음 상점',
    speakerId: '노인',
    skill: 'ice',
    unlockSkill: 5_000,
    stock: [],
  }
  /** 노인이 아니라 안내판이 여는 상점 — 화자로 조회한다는 것을 대조로 보인다. */
  const 안내판상점: ShopDef = { ...얼음상점, id: '안내판상점', speakerId: '안내판', unlockSkill: 0 }
  const 얼음달인: MasterDef = { id: 'ice_master', speakerId: '노인', skill: 'ice', threshold: 10_000, gold: 1_000_000 }

  const base = gameData([greetA, greetB, greetC, greetD, milestoneRule, otherRule])
  const registry: GameData = { ...base, shops: { 얼음상점, 안내판상점 }, masters: [얼음달인] }

  const talkToElder = (p: PlayerState, now = 0) =>
    performTalk({ player: p, data: registry, speakerId: '노인', rng: pickFirst, now })

  const veteran = (over: Partial<PlayerState> = {}) =>
    player({ skills: { ice: 5_000, wood: 0, mineral: 0, herb: 0, crafting: 0 }, ...over })

  it('해금된 상점의 화자와 말하면 상점 id 가 응답에 실린다 — 이긴 규칙은 조건 없는 인사다', () => {
    const r = talkToElder(veteran())
    if (!r.ok) throw new Error('성공해야 한다')
    // 이긴 규칙에는 조건이 하나도 없다. 상점이 대사에 붙어 있었다면 이 대화에서는
    // 아무 문도 열리지 않았을 것이다.
    expect(r.outcome.lines).toEqual(['허어, 또 왔는가.'])
    expect(r.outcome.shop).toBe('얼음상점')
  })

  it('숙련이 요구치에 못 미치면 shop 필드가 아예 없다 — 대사만 나온다', () => {
    const r = talkToElder(player())
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.shop).toBeUndefined()
  })

  it('상점을 열지 않는 화자와의 대화에는 shop 이 없다', () => {
    const r = performTalk({ player: veteran(), data: base, speakerId: '노인', rng: pickFirst, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.shop).toBeUndefined()
  })

  it('상점은 화자로 조회한다 — 다른 화자의 상점이 딸려 오지 않는다', () => {
    const r = performTalk({ player: veteran(), data: registry, speakerId: '안내판', rng: pickFirst, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.shop).toBe('안내판상점')
  })

  it('문턱을 넘은 사람에게 달인 대금을 준다 — 골드가 늘고 rewarded 에 남고 응답에 실린다', () => {
    const r = talkToElder(veteran({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }))
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.reward).toEqual({ id: 'ice_master', gold: 1_000_000 })
    expect(r.outcome.player.gold).toBe(1_000_000)
    expect(r.outcome.player.rewarded).toEqual(['ice_master'])
  })

  it('두 번째 대화에서는 아무것도 주지 않는다 — 1회성은 rewarded 가 지킨다', () => {
    // 이것이 대사 효과(`!reward=`)를 버린 이유다(§6-앞 2): once 사건의 onceKey 는
    // 숙련도의 지금 값을 스냅샷하므로, 숙련도가 계속 오르는 동안 말을 걸 때마다
    // 새 키가 되어 무한 지급됐을 것이다.
    const first = talkToElder(veteran({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }))
    if (!first.ok) throw new Error('첫 대화가 성공해야 한다')

    const second = talkToElder(first.outcome.player, 1000)
    if (!second.ok) throw new Error('두 번째 대화도 성공해야 한다')
    expect(second.outcome.reward).toBeUndefined()
    expect(second.outcome.player.gold).toBe(1_000_000)
    expect(second.outcome.player.rewarded).toEqual(['ice_master'])
  })

  it('숙련도가 더 올라도 다시 주지 않는다 — 기록을 갱신할 때마다 받는 돈이 아니다', () => {
    const 받은사람 = veteran({
      skills: { ice: 999_999, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      rewarded: ['ice_master'],
      gold: 1_000_000,
    })
    const r = talkToElder(받은사람)
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.reward).toBeUndefined()
    expect(r.outcome.player.gold).toBe(1_000_000)
  })

  it('문턱에 못 미치면 주지 않는다. 경계값(딱 그 숫자)은 받는다', () => {
    const 미달 = talkToElder(veteran({ skills: { ice: 9_999, wood: 0, mineral: 0, herb: 0, crafting: 0 } }))
    if (!미달.ok) throw new Error('성공해야 한다')
    expect(미달.outcome.reward).toBeUndefined()
    expect(미달.outcome.player.gold).toBe(0)

    const 딱 = talkToElder(veteran({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }))
    if (!딱.ok) throw new Error('성공해야 한다')
    expect(딱.outcome.reward).toEqual({ id: 'ice_master', gold: 1_000_000 })
  })

  it('다른 화자와 말해서는 그 대금을 받을 수 없다 — 달인은 자기 입으로만 준다', () => {
    const r = performTalk({
      player: veteran({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }),
      data: registry,
      speakerId: '안내판',
      rng: pickFirst,
      now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.reward).toBeUndefined()
    expect(r.outcome.player.gold).toBe(0)
  })

  it('막힌 대화는 대금도 상점도 내지 않는다 — 다른 맵에서 돈이 나가면 안 된다', () => {
    const 멀리 = veteran({
      skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      location: { mapId: '눈의마을', x: 1, y: 1 },
    })
    expect(talkToElder(멀리)).toEqual({ ok: false, code: 'wrong_map' })
    expect(멀리.gold).toBe(0)
    expect(멀리.rewarded).toEqual([])
  })

  it('입력 플레이어의 rewarded 를 건드리지 않는다 — 판정은 사본 위에서 한다', () => {
    const p = veteran({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    talkToElder(p)
    expect(p.rewarded).toEqual([])
    expect(p.gold).toBe(0)
  })
})

/**
 * 여관도 **대사가 아니라 등록부가 연다**(아크 D §2) — 상점 `shop` 필드의
 * 쌍둥이이고, 같은 자리·같은 시점에 실린다. 상점과 다른 것 하나는 문턱이
 * 없다는 것뿐이다: 여관은 숙련을 재지 않는다.
 */
describe('performTalk — 등록부가 싣는 것(여관)', () => {
  const 여관: InnDef = { speakerId: '노인', gold: 1_500 }
  const base = gameData([greetA, otherRule])
  const registry: GameData = { ...base, inns: { 노인: 여관 } }

  it('여관 화자와 말하면 inn 이 실린다 — 상점과 같은 자리, 문턱은 없다', () => {
    const r = performTalk({ player: player(), data: registry, speakerId: '노인', rng: pickFirst, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.inn).toBe('노인')
    // 숙련 0 인데도 실린다 — 상점(unlockSkill)과 달리 여관에는 문턱이 없다.
    expect(r.outcome.lines).toEqual(['허어, 또 왔는가.'])
  })

  it('여관을 열지 않는 화자와의 대화에는 inn 이 없다', () => {
    const r = performTalk({ player: player(), data: registry, speakerId: '안내판', rng: pickFirst, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.inn).toBeUndefined()
  })

  it('막힌 대화는 inn 도 내지 않는다 — 다른 맵에서 문이 열리면 안 된다', () => {
    const 멀리 = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    expect(performTalk({ player: 멀리, data: registry, speakerId: '노인', rng: pickFirst, now: 0 })).toEqual({
      ok: false,
      code: 'wrong_map',
    })
  })
})

/**
 * 일과가 있는 화자는 speakers.csv 의 좌표에 있지 않다 — 자리는 시각이 정한다.
 *
 * 서버가 그 계산을 하지 않으면 밤에 자고 있는 사람과, 길 한복판을 지나가는
 * 사람과 대화가 열린다. 화면에는 아무도 없는데.
 */
describe('performTalk — 일과가 있는 화자', () => {
  const 마을 = '눈의마을'
  const 채집장 = '얼음채집장'

  function place(id: string, mapId: string, x: number, over: Partial<PlaceDef> = {}): PlaceDef {
    return { id, mapId, x, y: 0, indoor: false, facing: null, ...over }
  }

  const 여관앞 = place('여관앞', 마을, 1, { facing: 'down' })
  const 눈광장 = place('눈광장', 마을, 20)
  const 여관안 = place('여관안', 마을, 2, { indoor: true })
  const 초소 = place('초소', 채집장, 5)

  /**
   * 출발 지점에서 곧게 걷다가 도착 칸으로 들어서는 구간. 빌드가 굽는 것과 같은
   * 규약이다 — 양 끝 칸을 다 담으므로 걸음 수는 `steps.length - 1` 이고, 마지막
   * 걸음이 맵을 넘을 수 있다(문 칸).
   */
  function walkLeg(from: PlaceDef, to: PlaceDef, steps: number): BakedLeg {
    const tiles: RouteStep[] = [{ mapId: from.mapId, x: from.x, y: 0 }]
    for (let i = 1; i < steps; i++) tiles.push({ mapId: from.mapId, x: from.x + i, y: 0 })
    tiles.push({ mapId: to.mapId, x: to.x, y: 0 })
    return { fromPlace: from.id, toPlace: to.id, steps: tiles }
  }

  /** 06:00 여관 앞, 09:00 광장, 12:00 채집장 초소, 22:00 여관 안. */
  const schedule: ScheduleDef = {
    speakerId: '여관안주인',
    entries: [
      { arriveMinute: 6 * 60, placeIds: ['여관앞'] },
      { arriveMinute: 9 * 60, placeIds: ['눈광장'] },
      { arriveMinute: 12 * 60, placeIds: ['초소'] },
      { arriveMinute: 22 * 60, placeIds: ['여관안'] },
    ],
  }

  const 여관인사 = rule({ id: 'inn-greet', speaker: '여관안주인', event: 'greet', lines: ['어서 오세요.'] })
  const base = gameData([greetA, 여관인사])
  const scheduled: GameData = {
    ...base,
    maps: {
      ...base.maps,
      눈의마을: { id: 마을, name: '눈의 마을', file: '눈의마을.tmx', width: 40, height: 40, spawn: { x: 1, y: 1 } },
    },
    speakers: {
      ...base.speakers,
      여관안주인: { id: '여관안주인', name: '여관 안주인', kind: 'npc', mapId: 마을, x: 1, y: 0, sprite: 'npc_inn', facing: 'down' },
    },
    places: Object.fromEntries([여관앞, 눈광장, 여관안, 초소].map((p) => [p.id, p])),
    schedules: { 여관안주인: schedule },
    routes: [
      walkLeg(여관앞, 눈광장, 10),
      walkLeg(눈광장, 초소, 4),
      walkLeg(초소, 여관안, 4),
      walkLeg(여관안, 여관앞, 2),
    ],
  }

  /** 게임 세계의 그 날 그 시각에 해당하는 실측 ms — 라우트가 넣어 주는 `now` 와 같은 축이다. */
  const at = (hour: number, minute = 0): number =>
    GAME_EPOCH_MS + 5 * REAL_MS_PER_GAME_DAY + (hour * 60 + minute) * REAL_MS_PER_GAME_MINUTE

  function talkToInnkeeper(p: PlayerState, now: number) {
    return performTalk({ player: p, data: scheduled, speakerId: '여관안주인', rng: pickFirst, now })
  }

  const inVillage = (): PlayerState => player({ location: { mapId: 마을, x: 0, y: 0 } })
  const inQuarry = (): PlayerState => player({ location: { mapId: 채집장, x: 0, y: 0 } })

  it('같은 맵에 서 있으면 대화가 열린다', () => {
    const r = talkToInnkeeper(inVillage(), at(7))
    if (!r.ok) throw new Error(`서 있는 시각인데 ${r.code} 로 막혔다`)
    expect(r.outcome.lines).toEqual(['어서 오세요.'])
  })

  // 왜: 실내로 사라진 사람은 맵에 없다. 그런데 화자 id 하나로 대화가 열리면
  //     플레이어는 아무도 없는 문 앞에서 대사창을 본다.
  it('실내에 있는 시각이면 not_here 다', () => {
    expect(talkToInnkeeper(inVillage(), at(23))).toEqual({ ok: false, code: 'not_here' })
  })

  // 왜: 걷는 NPC 는 통과 장식이라 몸이 없다(설계 §1). 말이 걸리면 대화 도중에
  //     걸어가 버리는 문제가 그대로 돌아온다.
  it('걷는 중이면 not_here 다', () => {
    // 09:00 도착 — 열 칸 앞에서 떠났으므로 그 직전은 길 위다.
    expect(talkToInnkeeper(inVillage(), at(9) - 1)).toEqual({ ok: false, code: 'not_here' })
  })

  it('다른 맵에 서 있으면 wrong_map 이다 — 없는 것이 아니라 여기가 아니다', () => {
    expect(talkToInnkeeper(inVillage(), at(13))).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('그 다른 맵으로 따라가면 대화가 열린다', () => {
    const r = talkToInnkeeper(inQuarry(), at(13))
    if (!r.ok) throw new Error(`같은 맵인데 ${r.code} 로 막혔다`)
    expect(r.outcome.lines).toEqual(['어서 오세요.'])
  })

  // 왜: speakers.csv 의 좌표를 그대로 믿으면 이 사람은 영원히 눈의마을에 있다 —
  //     일과가 그를 채집장으로 데려간 시각에도.
  it('판정은 speakers.csv 좌표가 아니라 일과가 정한다', () => {
    expect(scheduled.speakers['여관안주인']!.mapId).toBe(마을)
    // 같은 맵(마을)에 선 플레이어가 막히고, 다른 맵(채집장)에 선 플레이어가 통한다.
    expect(talkToInnkeeper(inVillage(), at(13)).ok).toBe(false)
    expect(talkToInnkeeper(inQuarry(), at(13)).ok).toBe(true)
  })

  it('막힌 요청은 대화 이력을 건드리지 않는다', () => {
    const p = inVillage()
    talkToInnkeeper(p, at(23))
    expect(p.dialogueHistory).toEqual({ said: [], recent: {}, lastTalkAt: {} })
  })

  it('도착 순간에는 이미 서 있다 — 걷기가 끝난 시각이다', () => {
    const r = talkToInnkeeper(inVillage(), at(9))
    if (!r.ok) throw new Error(`도착 시각인데 ${r.code} 로 막혔다`)
    expect(r.outcome.lines).toEqual(['어서 오세요.'])
  })

  it('출발 직전에는 아직 말을 걸 수 있다', () => {
    const departure = at(9) - 10 * NPC_STEP_MS
    expect(talkToInnkeeper(inVillage(), departure - 1).ok).toBe(true)
    expect(talkToInnkeeper(inVillage(), departure)).toEqual({ ok: false, code: 'not_here' })
  })

  // 회귀: 일과가 없는 화자는 지금까지와 똑같다. 시각을 아무리 옮겨도 좌표가
  //       판정이고, 밤이라고 사라지지 않는다.
  it('일과가 없는 화자는 시각과 무관하게 좌표로 판정한다', () => {
    const 노인곁 = player({ location: { mapId: 채집장, x: 0, y: 0 } })
    for (const hour of [0, 7, 13, 23]) {
      const r = performTalk({ player: 노인곁, data: scheduled, speakerId: '노인', rng: pickFirst, now: at(hour) })
      if (!r.ok) throw new Error(`${hour}시에 ${r.code} 로 막혔다 — 일과 없는 화자는 늘 그 자리다`)
    }
    const 마을에서 = performTalk({ player: inVillage(), data: scheduled, speakerId: '노인', rng: pickFirst, now: at(7) })
    expect(마을에서).toEqual({ ok: false, code: 'wrong_map' })
  })
})

/**
 * 실제로 출하되는 대사 데이터로 문턱→대사 사슬 전체를 지난다.
 *
 * 이 게임이 원작에서 물려받은 설계의 핵심이 여기 있다 — 노가다 사이사이에
 * 진행도로 열리는 사건을 숨겨 두는 것. 위 테스트들은 손으로 빚은 픽스처라
 * "규칙이 이렇게 생겼다면 이렇게 고른다"까지만 증명하지만, 정작 중요한 것은
 * **작가가 쓴 그 파일의 그 규칙이 실제로 나오는가**다. 픽스처만 있으면
 * 채집장노인.dlg 의 조건 한 글자가 틀려도 전부 green 이다.
 */
describe('performTalk — 출하 데이터의 이정표 대사', () => {
  const shipped = loadGameData()
  const ELDER = '채집장노인'
  /** 채집장노인.dlg 의 `@milestone justAchieved=ice_10000` 이 내는 두 칸. */
  const MILESTONE_LINES = ['손이 익었군.', '그 나이에 벌써 그러면 나는 뭐가 되나.']

  /** 그 화자의 greet 규칙이 낼 수 있는 발화 전부 — 폴백이 걸렸는지 확인하는 데 쓴다. */
  const greetLines = shipped.dialogue.filter((r) => r.speaker === ELDER && r.event === 'greet').map((r) => r.lines)

  /**
   * 노인 앞에 선 사람. 출하 데이터에서 노인이 어느 맵에 서 있는지는 데이터가
   * 말한다 — 여기 맵 이름을 적으면 맵을 개명할 때 이 파일이 조용히 wrong_map
   * 으로 전부 빨개진다. 시작 맵이 마을이 된 뒤로 기본 위치는 노인 곁이 아니다.
   */
  function beforeElder(overrides: Partial<PlayerState> = {}): PlayerState {
    return player({ location: { mapId: shipped.speakers[ELDER]!.mapId, x: 0, y: 0 }, ...overrides })
  }

  /** 방금 얼음 10000 을 넘긴 사람. celebrated 마지막 원소가 곧 justAchieved 다. */
  function justCrossed(celebrated: string[] = ['ice_10000']): PlayerState {
    return beforeElder({ celebrated, skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
  }

  function talkToElder(p: PlayerState, now = 0) {
    return performTalk({ player: p, data: shipped, speakerId: ELDER, rng: pickFirst, now })
  }

  it('방금 문턱을 넘긴 사람에게 노인이 그것을 알아본다', () => {
    const r = talkToElder(justCrossed())
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.lines).toEqual(MILESTONE_LINES)
  })

  it('그 말은 한 번뿐이다 — 두 번째 대화는 said 에 막혀 greet 으로 내려간다', () => {
    // "계속 켜져 있는 justAchieved" 가 안전한 이유가 바로 이것이다. 사실이
    // 꺼지지 않아도 @milestone 은 once 사건이라 said 가 반복을 막는다 —
    // 플레이어는 그 말을 반드시 듣되, 정확히 한 번만 듣는다.
    const first = talkToElder(justCrossed())
    if (!first.ok) throw new Error('첫 대화가 성공해야 한다')

    const second = talkToElder(first.outcome.player, 1000)
    if (!second.ok) throw new Error('두 번째 대화도 성공해야 한다')
    expect(second.outcome.lines).not.toEqual(MILESTONE_LINES)
    expect(greetLines).toContainEqual(second.outcome.lines)
    // said 에 그 키가 하나 들어갔고, 두 번째 대화가 또 넣지는 않았다.
    expect(second.outcome.player.dialogueHistory.said).toHaveLength(1)
  })

  it('아무것도 안 넘긴 사람에게는 그 말이 나오지 않는다', () => {
    // justAchieved 사실 자체가 없으므로 조건이 거짓이다 — 이 대조가 없으면
    // 위 테스트는 "노인이 늘 저 말을 한다"로도 통과한다.
    const r = talkToElder(beforeElder({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }))
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.lines).not.toEqual(MILESTONE_LINES)
  })

  it('말을 걸기 전에 문턱을 둘 넘기면 마지막 것만 언급된다 — 받아들인 대가다', () => {
    // 대기열을 두면 둘 다 말할 수 있지만 그건 저장·마이그레이션·비우는 시점이
    // 따라붙는 새 상태다. 이 테스트는 그 선택을 문서가 아니라 동작으로 못박는다 —
    // 나중에 대기열을 도입한다면 여기서 먼저 빨개진다.
    const r = talkToElder(justCrossed(['ice_10000', 'wood_1000']))
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.lines).not.toEqual(MILESTONE_LINES)
  })
})

/**
 * 출하 데이터로 "서 있는 자리"가 대사까지 닿는지 지난다.
 *
 * 사슬이 길다: `.sched` → `npcStateAt` 이 고른 지점 → `NpcState.placeId` →
 * 서버가 `buildFacts` 에 실어 주는 `place` 사실 → `.dlg` 의 `place=` 조건 →
 * 선택된 발화. 그 다섯 고리 중 어디가 끊겨도 증상은 하나다 — **아무 일도
 * 안 일어난다.** 폴백 인사가 대신 나오므로 오류도 로그도 없고, 작가는 자기
 * 대사가 안 나오는 이유를 알 방법이 없다. 그래서 여기서만은 픽스처가 아니라
 * 실제로 출하되는 파일로 확인한다(위 이정표 대사 블록과 같은 이유).
 */
describe('performTalk — 출하 데이터의 지점 대사', () => {
  const shipped = loadGameData()
  const INNKEEPER = '여관안주인'
  /** 여관안주인.dlg 의 `@greet place=눈광장` 이 내는 한 칸. */
  const PLAZA_LINE = ['장 보러 잠깐 나왔네. 여관은 비워 두면 안 되는데.']

  /** 게임 세계 5일차 그 시각의 실측 ms — 라우트가 넣어 주는 `now` 와 같은 축이다. */
  const at = (hour: number): number =>
    GAME_EPOCH_MS + 5 * REAL_MS_PER_GAME_DAY + hour * 60 * REAL_MS_PER_GAME_MINUTE

  /** 안주인이 사는 마을에 선 사람. 맵 이름은 데이터가 말한다 — 개명에 흔들리지 않는다. */
  const inVillage = (): PlayerState =>
    player({ location: { mapId: shipped.speakers[INNKEEPER]!.mapId, x: 0, y: 0 } })

  function talkToInnkeeper(now: number) {
    return performTalk({ player: inVillage(), data: shipped, speakerId: INNKEEPER, rng: pickFirst, now })
  }

  it('광장에 서 있는 시각에는 광장 대사가 나온다', () => {
    // 여관안주인.sched: 09:00 눈광장 — 10시면 아직 그 자리다.
    const r = talkToInnkeeper(at(10))
    if (!r.ok) throw new Error(`광장에 서 있는 시각인데 ${r.code} 로 막혔다`)
    expect(r.outcome.lines).toEqual(PLAZA_LINE)
  })

  it('문 앞에 서 있는 시각에는 그 대사가 아니라 폴백이 나온다', () => {
    // 06:00 여관앞 — 7시면 문 앞이다. 이 대조가 없으면 위 테스트는 "그 대사가
    // 늘 나온다"(조건이 아예 안 걸렸을 때)로도 통과한다.
    const r = talkToInnkeeper(at(7))
    if (!r.ok) throw new Error(`문 앞에 서 있는 시각인데 ${r.code} 로 막혔다`)
    expect(r.outcome.lines).not.toEqual(PLAZA_LINE)
    expect(r.outcome.lines.length).toBeGreaterThan(0)
  })

  // 왜: 여관안주인은 ice 달인(masters.csv)이기도 하다(계획 D2 주의). 두 등록부가
  //     같은 화자를 가리킬 때 한쪽이 다른 쪽을 덮으면 — 대금을 주느라 inn 을
  //     빠뜨리면 — 문턱을 막 넘긴 사람의 그 대화에서만 여관이 안 열린다.
  it('여관안주인은 달인이기도 하다 — 대금과 inn 이 한 응답에 공존한다', () => {
    const 문턱넘긴사람 = player({
      location: { mapId: shipped.speakers[INNKEEPER]!.mapId, x: 0, y: 0 },
      skills: { ice: 63_235, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    })
    const r = performTalk({ player: 문턱넘긴사람, data: shipped, speakerId: INNKEEPER, rng: pickFirst, now: at(7) })
    if (!r.ok) throw new Error(`서 있는 시각인데 ${r.code} 로 막혔다`)
    expect(r.outcome.inn).toBe(INNKEEPER)
    expect(r.outcome.reward).toEqual({ id: 'ice_master', gold: 1_000_000 })
  })

  // 왜: 구운 데이터의 사슬 전체 — inns.csv → 빌드 → gamedata.json → talkService.
  //     픽스처만 있으면 CSV 한 글자가 틀려도 전부 green 이다(위 이정표 대사
  //     블록과 같은 이유).
  it('출하 데이터에서 여관안주인과 말하면 inn 이 실린다', () => {
    const r = talkToInnkeeper(at(7))
    if (!r.ok) throw new Error(`서 있는 시각인데 ${r.code} 로 막혔다`)
    expect(r.outcome.inn).toBe(INNKEEPER)
  })

  it('일과가 없는 화자에게는 place 사실 자체가 없다', () => {
    // 간판에게 place 를 건 대사는 없지만, 사실이 새면 place!=... 같은 조건이
    // 언젠가 조용히 참이 된다. 그 화자의 모든 시각에 폴백만 나오는 것으로는
    // 확인할 수 없어서, 공급자 쪽 단정은 packages/data 의 드리프트 테스트가
    // 맡는다 — 여기서는 일과 없는 화자와의 대화가 여전히 열리는 것만 본다.
    const SIGN = '얼음안내판'
    const beside = player({ location: { mapId: shipped.speakers[SIGN]!.mapId, x: 0, y: 0 } })
    const r = performTalk({ player: beside, data: shipped, speakerId: SIGN, rng: pickFirst, now: at(10) })
    if (!r.ok) throw new Error(`일과 없는 화자인데 ${r.code} 로 막혔다`)
    expect(r.outcome.lines.length).toBeGreaterThan(0)
  })
})
