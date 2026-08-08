import { describe, expect, it } from 'vitest'
import {
  EVENT_ORDER,
  ONCE_EVENTS,
  emptyDialogueHistory,
  matchesCondition,
  onceKey,
  ruleMatches,
  selectDialogue,
  type DialogueRule,
  type Facts,
} from './dialogue.js'

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
    const got = selectDialogue([weatherChat, questHint], facts, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('quest3')
  })

  it('상위 사건을 이미 말했으면 아래로 내려온다', () => {
    const history = emptyDialogueHistory()
    history.said.push(onceKey(questHint, facts))
    const got = selectDialogue([weatherChat, questHint], facts, history, always)
    expect(got?.rule.id).toBe('chat')
  })

  it('상태가 바뀌면 상위 사건이 다시 말한다', () => {
    const history = emptyDialogueHistory()
    history.said.push(onceKey(questHint, { ...facts, 'quest.촌장': 2 }))
    const got = selectDialogue([weatherChat, questHint], facts, history, always)
    expect(got?.rule.id).toBe('quest3')
  })

  it('greet 은 몇 번을 말해도 다시 나온다', () => {
    const only = [rule('hi', 'greet', [])]
    const history = emptyDialogueHistory()
    for (let i = 0; i < 5; i++) {
      const got = selectDialogue(only, {}, history, always)
      expect(got?.rule.id).toBe('hi')
    }
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
    expect(selectDialogue(rules, facts, emptyDialogueHistory(), always)?.rule.id).toBe('rainClose')
  })

  it('조건이 맞지 않으면 덜 구체적인 것으로 내려간다', () => {
    const got = selectDialogue(rules, { weather: 'rain', affinity: 5 }, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('rain')
  })

  it('아무 조건도 안 맞으면 무조건 규칙이 나온다', () => {
    expect(selectDialogue(rules, {}, emptyDialogueHistory(), always)?.rule.id).toBe('bare')
  })

  it('할 말이 하나도 없으면 null 이다', () => {
    expect(selectDialogue([], {}, emptyDialogueHistory(), always)).toBeNull()
  })
})

describe('selectDialogue — 동점과 반복', () => {
  const tie = [rule('a', 'greet', []), rule('b', 'greet', []), rule('c', 'greet', [])]

  it('동점이면 난수로 고른다', () => {
    expect(selectDialogue(tie, {}, emptyDialogueHistory(), () => 0)?.rule.id).toBe('a')
    expect(selectDialogue(tie, {}, emptyDialogueHistory(), () => 0.99)?.rule.id).toBe('c')
  })

  it('최근에 나온 것은 잠시 빠진다', () => {
    const history = emptyDialogueHistory()
    history.recent['노인'] = ['a']
    // a 가 빠지면 후보는 b·c 뿐이고 난수 0 은 첫 번째를 고른다.
    expect(selectDialogue(tie, {}, history, () => 0)?.rule.id).toBe('b')
  })

  it('전부 최근이면 그래도 하나는 말한다', () => {
    // 침묵하는 것보다 반복하는 편이 낫다.
    const history = emptyDialogueHistory()
    history.recent['노인'] = ['a', 'b', 'c']
    expect(selectDialogue(tie, {}, history, () => 0)).not.toBeNull()
  })
})

describe('selectDialogue — 시뮬레이터용 흔적', () => {
  it('훑은 사건과 맞은 규칙을 남긴다', () => {
    const rules = [rule('hi', 'greet', []), rule('q', 'quest', [{ fact: 'q', op: '=', value: 1 }])]
    const got = selectDialogue(rules, { q: 1 }, emptyDialogueHistory(), always)
    // 도구가 "왜 그것이 이겼는지" 를 보여주려면 선택 과정이 결과에 남아야 한다.
    expect(got?.trace.map((t) => t.event)).toEqual(['story', 'quest'])
    expect(got?.trace.at(-1)?.matched.map((r) => r.id)).toEqual(['q'])
  })
})
