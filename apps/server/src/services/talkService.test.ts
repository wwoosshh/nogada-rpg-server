import {
  RECENT_DIALOGUE_LIMIT,
  emptyDialogueHistory,
  type DialogueRule,
  type GameData,
  type MilestoneDef,
  type PlayerState,
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

/** 다른 화자의 규칙. 화자 필터가 서비스 경로에서도 살아 있는지 본다. */
const otherRule = rule({
  id: 'sign-greet',
  speaker: '안내판',
  event: 'greet',
  lines: ['깊은 얼음은 구리 정으로는 깨지지 않는다.'],
})

function gameData(dialogue: DialogueRule[]): GameData {
  return {
    items: {},
    nodes: {},
    recipes: {},
    placements: {},
    milestones: [iceMilestone],
    speakers: {
      노인: { id: '노인', name: '채집장 노인', kind: 'npc', mapId: 'world', x: 1, y: 1, sprite: 'npc_elder' },
      안내판: { id: '안내판', name: '안내판', kind: 'sign', mapId: 'world', x: 2, y: 2, sprite: 'sign_wood' },
    },
    dialogue,
  }
}

const data = gameData([greetA, greetB, greetC, greetD, milestoneRule, otherRule])

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
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
    expect(r.outcome.lines).toEqual(['깊은 얼음은 구리 정으로는 깨지지 않는다.'])
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

  /** 방금 얼음 10000 을 넘긴 사람. celebrated 마지막 원소가 곧 justAchieved 다. */
  function justCrossed(celebrated: string[] = ['ice_10000']): PlayerState {
    return player({ celebrated, skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
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
    const r = talkToElder(player({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }))
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
