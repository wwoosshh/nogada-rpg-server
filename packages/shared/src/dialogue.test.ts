import { describe, expect, it } from 'vitest'
import {
  DECLARED_FACTS,
  EVENT_ORDER,
  ONCE_EVENTS,
  emptyDialogueHistory,
  factValueFitsShape,
  findFactSpec,
  matchesCondition,
  onceKey,
  ruleMatches,
  selectDialogue,
  type DialogueRule,
  type Facts,
} from './dialogue.js'
import { SEASONS } from './time.js'

/** 조건 하나짜리 규칙을 짧게 만든다. */
function rule(
  id: string,
  event: string,
  conditions: DialogueRule['conditions'],
  lines: string[] = ['...'],
): DialogueRule {
  return { id, speaker: '노인', event, conditions, lines, source: { file: 'x.dlg', line: 1 } }
}

const always = () => 0

describe('EVENT_ORDER', () => {
  it('중요한 사건이 앞에 온다', () => {
    expect([...EVENT_ORDER]).toEqual(['story', 'quest', 'milestone', 'greet'])
  })

  it('greet 만 매번 말한다', () => {
    // 상위 사건이 매번 말하면 퀘스트가 걸린 동안 잡담을 못 한다 — 죽은 세계다.
    expect(ONCE_EVENTS.has('greet')).toBe(false)
    expect(ONCE_EVENTS.has('quest')).toBe(true)
    expect(ONCE_EVENTS.has('story')).toBe(true)
    expect(ONCE_EVENTS.has('milestone')).toBe(true)
  })
})

describe('matchesCondition', () => {
  const facts: Facts = { season: 'spring', 'skill.ice': 15000, done: true }

  it('같음을 본다', () => {
    expect(matchesCondition({ fact: 'season', op: '=', value: 'spring' }, facts)).toBe(true)
    expect(matchesCondition({ fact: 'season', op: '=', value: 'winter' }, facts)).toBe(false)
  })

  it('숫자 비교를 본다', () => {
    expect(matchesCondition({ fact: 'skill.ice', op: '>=', value: 10000 }, facts)).toBe(true)
    expect(matchesCondition({ fact: 'skill.ice', op: '>=', value: 20000 }, facts)).toBe(false)
  })

  it('없는 사실은 맞지 않는다', () => {
    // 공급자가 아직 없는 사실을 쓴 규칙은 조용히 선택되지 않아야 한다.
    expect(matchesCondition({ fact: 'weather', op: '=', value: 'rain' }, facts)).toBe(false)
  })

  it('없는 사실은 != 로도 맞지 않는다', () => {
    // "비가 아닐 때" 가 날씨 없이 참이 되면, 날씨를 넣는 순간 대사가 뒤집힌다.
    expect(matchesCondition({ fact: 'weather', op: '!=', value: 'rain' }, facts)).toBe(false)
  })

  it('숫자가 아닌 값에 크기 비교를 하면 맞지 않는다', () => {
    expect(matchesCondition({ fact: 'season', op: '>=', value: 3 }, facts)).toBe(false)
  })
})

describe('ruleMatches', () => {
  it('조건이 전부 맞아야 한다', () => {
    const r = rule('a', 'greet', [
      { fact: 'season', op: '=', value: 'spring' },
      { fact: 'skill.ice', op: '>=', value: 10000 },
    ])
    expect(ruleMatches(r, { season: 'spring', 'skill.ice': 15000 })).toBe(true)
    expect(ruleMatches(r, { season: 'spring', 'skill.ice': 5000 })).toBe(false)
  })

  it('조건이 없으면 항상 맞는다', () => {
    expect(ruleMatches(rule('a', 'greet', []), {})).toBe(true)
  })
})

describe('selectDialogue — 사건 서열', () => {
  const facts: Facts = { weather: 'rain', affinity: 40, 'quest.촌장': 3 }

  const weatherChat = rule('chat', 'greet', [
    { fact: 'weather', op: '=', value: 'rain' },
    { fact: 'affinity', op: '>=', value: 30 },
  ])
  const questHint = rule('quest3', 'quest', [{ fact: 'quest.촌장', op: '=', value: 3 }])

  it('조건이 적어도 상위 사건이 이긴다', () => {
    // 이 설계의 핵심. 조건 개수로만 고르면 날씨 잡담(2개)이 퀘스트 실마리(1개)를
    // 이겨서 진행이 영원히 묻힌다.
    const got = selectDialogue('노인', [weatherChat, questHint], facts, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('quest3')
  })

  it('상위 사건을 이미 말했으면 아래로 내려온다', () => {
    const history = emptyDialogueHistory()
    history.said.push(onceKey(questHint, facts))
    const got = selectDialogue('노인', [weatherChat, questHint], facts, history, always)
    expect(got?.rule.id).toBe('chat')
  })

  it('상태가 바뀌면 상위 사건이 다시 말한다', () => {
    const history = emptyDialogueHistory()
    history.said.push(onceKey(questHint, { ...facts, 'quest.촌장': 2 }))
    const got = selectDialogue('노인', [weatherChat, questHint], facts, history, always)
    expect(got?.rule.id).toBe('quest3')
  })

  it('greet 은 몇 번을 말해도 다시 나온다', () => {
    const only = [rule('hi', 'greet', [])]
    const history = emptyDialogueHistory()
    for (let i = 0; i < 5; i++) {
      const got = selectDialogue('노인', only, {}, history, always)
      expect(got?.rule.id).toBe('hi')
    }
  })
})

describe('selectDialogue — 화자로 거른다', () => {
  // 리뷰 지적 그 자체: 호출자가 화자를 미리 걸러서 넘기지 않고
  // GameData.dialogue 처럼 여러 화자의 규칙이 섞인 배열을 그대로 넘겨도,
  // speaker 인자가 내부에서 이 화자의 것만 추려야 한다. 안 그러면 다른
  // 화자의 아직 안 나온 quest 가 사건 서열에서 이 화자의 greet 을
  // 가로챈다 — 조건이 안 맞는 경우와 달리 에러도 실패도 없이 그냥 엉뚱한
  // 화자 말투가 나오므로, 규칙이 전부 화자 하나뿐인 테스트로는 이 경로
  // 자체가 존재하지 않아 지금까지 아무도 못 잡았다.
  it('다른 화자의 안 나온 상위 사건이 이 화자의 인사를 가리지 않는다', () => {
    const otherSpeakerQuest: DialogueRule = {
      id: 'q-상인',
      speaker: '상인',
      event: 'quest',
      conditions: [],
      lines: ['상인만 할 수 있는 대사'],
      source: { file: 'y.dlg', line: 1 },
    }
    const myGreet = rule('hi', 'greet', [])
    const got = selectDialogue('노인', [otherSpeakerQuest, myGreet], {}, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('hi')
  })

  it('이 화자 자신의 상위 사건은 다른 화자와 섞여도 정상적으로 이긴다', () => {
    // 위 테스트가 "걸러야 한다"만 증명하면, 지나치게 걸러서 이 화자 몫까지
    // 함께 지워도 (우연히) 통과할 수 있다. 이 화자의 quest 가 다른 화자의
    // greet 과 같은 배열에 있어도 여전히 서열대로 이겨야 한다.
    const myQuest = rule('q-노인', 'quest', [])
    const otherGreet: DialogueRule = {
      id: 'hi-상인',
      speaker: '상인',
      event: 'greet',
      conditions: [],
      lines: ['상인의 인사'],
      source: { file: 'y.dlg', line: 1 },
    }
    const got = selectDialogue('노인', [otherGreet, myQuest], {}, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('q-노인')
  })
})

describe('selectDialogue — 사건 안에서는 조건 개수', () => {
  const facts: Facts = { weather: 'rain', affinity: 40 }
  const rules = [
    rule('bare', 'greet', []),
    rule('rain', 'greet', [{ fact: 'weather', op: '=', value: 'rain' }]),
    rule('rainClose', 'greet', [
      { fact: 'weather', op: '=', value: 'rain' },
      { fact: 'affinity', op: '>=', value: 30 },
    ]),
  ]

  it('가장 구체적인 것이 이긴다', () => {
    expect(selectDialogue('노인', rules, facts, emptyDialogueHistory(), always)?.rule.id).toBe('rainClose')
  })

  it('조건이 맞지 않으면 덜 구체적인 것으로 내려간다', () => {
    const got = selectDialogue('노인', rules, { weather: 'rain', affinity: 5 }, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('rain')
  })

  it('아무 조건도 안 맞으면 무조건 규칙이 나온다', () => {
    expect(selectDialogue('노인', rules, {}, emptyDialogueHistory(), always)?.rule.id).toBe('bare')
  })

  it('할 말이 하나도 없으면 null 이다', () => {
    expect(selectDialogue('노인', [], {}, emptyDialogueHistory(), always)).toBeNull()
  })
})

describe('selectDialogue — 동점과 반복', () => {
  const tie = [rule('a', 'greet', []), rule('b', 'greet', []), rule('c', 'greet', [])]

  it('동점이면 난수로 고른다', () => {
    expect(selectDialogue('노인', tie, {}, emptyDialogueHistory(), () => 0)?.rule.id).toBe('a')
    expect(selectDialogue('노인', tie, {}, emptyDialogueHistory(), () => 0.99)?.rule.id).toBe('c')
  })

  it('최근에 나온 것은 잠시 빠진다', () => {
    const history = emptyDialogueHistory()
    history.recent['노인'] = ['a']
    // a 가 빠지면 후보는 b·c 뿐이고 난수 0 은 첫 번째를 고른다.
    expect(selectDialogue('노인', tie, {}, history, () => 0)?.rule.id).toBe('b')
  })

  it('전부 최근이면 그래도 하나는 말한다', () => {
    // 침묵하는 것보다 반복하는 편이 낫다.
    const history = emptyDialogueHistory()
    history.recent['노인'] = ['a', 'b', 'c']
    expect(selectDialogue('노인', tie, {}, history, () => 0)).not.toBeNull()
  })
})

describe('selectDialogue — 시뮬레이터용 흔적', () => {
  it('훑은 사건과 맞은 규칙을 남긴다', () => {
    const rules = [rule('hi', 'greet', []), rule('q', 'quest', [{ fact: 'q', op: '=', value: 1 }])]
    const got = selectDialogue('노인', rules, { q: 1 }, emptyDialogueHistory(), always)
    // 도구가 "왜 그것이 이겼는지" 를 보여주려면 선택 과정이 결과에 남아야 한다.
    expect(got?.trace.map((t) => t.event)).toEqual(['story', 'quest'])
    expect(got?.trace.at(-1)?.matched.map((r) => r.id)).toEqual(['q'])
  })
})

describe('findFactSpec', () => {
  it('고정 이름 사실을 찾는다', () => {
    expect(findFactSpec('season')).toEqual({
      name: 'season',
      prefix: false,
      supplied: true,
      unbounded: false,
      value: { kind: 'enum', values: SEASONS },
    })
  })

  it('접두사 사실을 찾는다 — 접두사 뒤는 임의의 이름이다', () => {
    expect(findFactSpec('skill.ice')?.name).toBe('skill.')
    expect(findFactSpec('milestone.ice_10000')?.name).toBe('milestone.')
    expect(findFactSpec('quest.촌장')?.name).toBe('quest.')
  })

  it('선언되지 않은 이름(오타)은 찾지 못한다', () => {
    // affinty 는 affinity 의 오타다 — 이게 조용히 "절대 안 맞는 조건"이 되면
    // 작가가 원인을 못 찾는다는 것이 이 목록이 존재하는 이유다.
    expect(findFactSpec('affinty')).toBeUndefined()
  })

  it('접두사가 아닌 사실은 접두사로 우연히 걸리지 않는다', () => {
    // 'skill' 이 'skill.' 의 부분 문자열이라고 해서 통과시키면 안 된다 —
    // 실제로 값이 채워지는 키는 항상 'skill.<기술>' 형태다.
    expect(findFactSpec('skill')).toBeUndefined()
  })

  it('공급자가 있는 사실과 없는 사실이 설계 문서 6장대로 나뉜다', () => {
    const suppliedNames = DECLARED_FACTS.filter((f) => f.supplied).map((f) => f.name)
    const unsuppliedNames = DECLARED_FACTS.filter((f) => !f.supplied).map((f) => f.name)
    expect(suppliedNames).toEqual([
      'season', 'hour', 'dayOfSeason', 'skill.', 'milestone.', 'justAchieved', 'talkedBefore', 'daysSinceLastTalk',
    ])
    expect(unsuppliedNames).toEqual(['weather', 'affinity', 'quest.', 'story', 'activity', 'location'])
  })

  it('상한 없이 계속 커지는 사실만 unbounded 다', () => {
    // skill.* 는 PlayerState.skills 문서(types.ts)가 "상한이 없다"고 명시한다.
    // daysSinceLastTalk 도 대화 없이 시간이 갈수록 계속 커진다. 나머지는 전부
    // 작은 범위를 돌거나(hour 0~23, dayOfSeason 1~28, season 4종) 이산적인
    // 상태값(milestone.*, quest.*)이라 크기 비교로 값이 끝없이 갈아치워지지 않는다.
    const unbounded = DECLARED_FACTS.filter((f) => f.unbounded).map((f) => f.name)
    expect(unbounded).toEqual(['skill.', 'daysSinceLastTalk'])
  })

  it('공급자가 없는 사실은 값의 모양도 정해 두지 않는다 — 그 모양은 안 만든 스펙이 정한다', () => {
    // 지금 추측해서 못박으면(예: story 는 숫자다) 나중에 그 스펙이 다른 모양을
    // 고르는 순간, 이미 쓰여 있던 대사들이 빌드에서 막힌다. 반대로 공급자가
    // 있는 사실은 그 공급자가 넣는 값이 곧 모양이라 비워 둘 이유가 없다.
    for (const spec of DECLARED_FACTS) {
      expect([spec.name, spec.value.kind === 'unspecified']).toEqual([spec.name, !spec.supplied])
    }
  })
})

describe('factValueFitsShape', () => {
  it('선언한 모양과 다른 타입의 값을 걸러낸다', () => {
    expect(factValueFitsShape({ kind: 'number' }, 3)).toBe(true)
    expect(factValueFitsShape({ kind: 'number' }, '3')).toBe(false)
    // 1 을 true 로 봐 주면 milestone.x=1 이 조용히 통과한 뒤 어떤 상황에서도
    // 안 맞는 조건이 된다 — matchesCondition 은 타입이 다르면 그냥 거짓이다.
    expect(factValueFitsShape({ kind: 'boolean' }, 1)).toBe(false)
    expect(factValueFitsShape({ kind: 'boolean' }, false)).toBe(true)
  })

  it('목록이 있는 사실은 목록 안의 값만 통과시킨다 — season=화요일 을 잡는 자리다', () => {
    const season = { kind: 'enum', values: SEASONS } as const
    expect(factValueFitsShape(season, 'spring')).toBe(true)
    expect(factValueFitsShape(season, '화요일')).toBe(false)
    expect(factValueFitsShape(season, 3)).toBe(false)
  })

  it('모양이 정해지지 않은 사실은 무엇이든 통과시킨다 — 없는 근거로 막지 않는다', () => {
    expect(factValueFitsShape({ kind: 'unspecified' }, 'rain')).toBe(true)
    expect(factValueFitsShape({ kind: 'unspecified' }, 40)).toBe(true)
  })
})
