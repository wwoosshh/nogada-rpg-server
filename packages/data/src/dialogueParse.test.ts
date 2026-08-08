import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDialogue } from './dialogueParse.js'

describe('parseDialogue — 이어지는 발화 vs 택일', () => {
  it('규칙 머리 한 줄과 들여쓴 두 줄이 이어지는 발화 하나로 파싱된다', () => {
    // 대사창은 이 두 줄을 순서대로 넘긴다 — 택일(무작위로 하나만 고르는 것)이
    // 아니다. 파서가 이걸 규칙 두 개로 쪼개면 대화가 한 문장에서 끊긴 것처럼
    // 보인다.
    const rules = parseDialogue(
      [
        '@greet',
        '  손이 익었군.',
        '  그 나이에 벌써 그러면 나는 뭐가 되나.',
      ].join('\n'),
      'x.dlg',
    )
    expect(rules).toHaveLength(1)
    expect(rules[0]?.lines).toEqual(['손이 익었군.', '그 나이에 벌써 그러면 나는 뭐가 되나.'])
  })

  it('같은 조건의 @greet 두 개가 규칙 두 개로 파싱된다 — 동점이 되어 택일된다', () => {
    // selectDialogue 는 조건이 같은 규칙을 동점으로 보고 무작위로 고른다.
    // 이 파서가 두 규칙 머리를 하나로 합쳐버리면 택일할 대상 자체가 사라진다.
    const rules = parseDialogue(
      [
        '@greet',
        '  허어, 또 왔는가.',
        '',
        '@greet',
        '  또 왔군.',
        '  부지런하기도 하지.',
      ].join('\n'),
      'x.dlg',
    )
    expect(rules).toHaveLength(2)
    expect(rules[0]?.conditions).toEqual([])
    expect(rules[1]?.conditions).toEqual([])
    expect(rules[0]?.id).not.toBe(rules[1]?.id)
  })
})

describe('parseDialogue — 조건 파싱', () => {
  it('여러 조건이 연산자까지 파싱된다', () => {
    const rules = parseDialogue(
      ['@greet  weather=rain  affinity>=30', '  비 맞지 말고 들어오게.'].join('\n'),
      'x.dlg',
    )
    expect(rules[0]?.event).toBe('greet')
    expect(rules[0]?.conditions).toEqual([
      { fact: 'weather', op: '=', value: 'rain' },
      { fact: 'affinity', op: '>=', value: 30 },
    ])
  })

  it('true·false 값은 불리언으로, 숫자 값은 숫자로 읽는다', () => {
    const rules = parseDialogue(
      ['@milestone  justAchieved=ice_10000  talkedBefore=true', '  손이 익었군.'].join('\n'),
      'x.dlg',
    )
    expect(rules[0]?.conditions).toEqual([
      { fact: 'justAchieved', op: '=', value: 'ice_10000' },
      { fact: 'talkedBefore', op: '=', value: true },
    ])
  })
})

describe('parseDialogue — 주석과 빈 줄', () => {
  it('# 로 시작하는 줄과 빈 줄은 무시된다', () => {
    const withComments = parseDialogue(
      [
        '# 채집장 노인',
        '# 얼음채집장에 하루 종일 있다.',
        '',
        '@greet',
        '  허어, 또 왔는가.',
        '',
        '# 이것도 주석',
      ].join('\n'),
      'x.dlg',
    )
    const withoutComments = parseDialogue(['@greet', '  허어, 또 왔는가.'].join('\n'), 'x.dlg')
    expect(withComments).toHaveLength(1)
    expect(withComments[0]?.lines).toEqual(withoutComments[0]?.lines)
  })
})

describe('parseDialogue — 형식 오류', () => {
  it('규칙 머리 없이 발화 줄이 먼저 오면 던지고, 메시지에 파일과 줄 번호가 있다', () => {
    expect(() => parseDialogue('  손이 익었군.', '채집장노인.dlg')).toThrow(/채집장노인\.dlg.*1행/)
  })

  it('발화가 없는 규칙 머리는 던진다 — 다음 규칙 머리가 바로 이어지는 경우', () => {
    expect(() =>
      parseDialogue(['@greet', '@greet', '  안녕'].join('\n'), 'x.dlg'),
    ).toThrow(/1행/)
  })

  it('발화가 없는 규칙 머리는 던진다 — 파일이 그대로 끝나는 경우', () => {
    expect(() => parseDialogue('@greet', 'x.dlg')).toThrow(/발화/)
  })

  it('모르는 연산자는 던진다', () => {
    // "==" 는 다른 언어에서 흔한 실수다. 정규식으로 앞의 "=" 하나만 연산자로
    // 읽으면 나머지 "=rain" 이 조용히 값이 되어 오타가 통과해버린다.
    expect(() =>
      parseDialogue(['@greet  weather==rain', '  대사'].join('\n'), 'x.dlg'),
    ).toThrow(/연산자/)
  })

  it('같은 파일 안에서 조건과 발화가 완전히 같은 규칙이 둘이면 던진다 — 복사 실수', () => {
    expect(() =>
      parseDialogue(
        ['@greet  weather=rain', '  이런 날엔 얼음이 잘 안 잡히지.', '', '@greet  weather=rain', '  이런 날엔 얼음이 잘 안 잡히지.'].join(
          '\n',
        ),
        'x.dlg',
      ),
    ).toThrow()
  })
})

describe('parseDialogue — 규칙 id', () => {
  it('규칙을 파일 안에서 재배치해도 id 가 바뀌지 않는다', () => {
    // id 가 파일 안 순서에서 나오면, 작가가 블록 위치만 옮겨도
    // dialogueHistory.said 에 저장된 "이미 말했다" 기록이 전부 어긋난다.
    const a = ['@milestone  justAchieved=ice_10000', '  손이 익었군.', '', '@greet', '  허어, 또 왔는가.'].join('\n')
    const b = ['@greet', '  허어, 또 왔는가.', '', '@milestone  justAchieved=ice_10000', '  손이 익었군.'].join('\n')

    const rulesA = parseDialogue(a, 'x.dlg')
    const rulesB = parseDialogue(b, 'x.dlg')

    const idsA = new Set(rulesA.map((r) => r.id))
    const idsB = new Set(rulesB.map((r) => r.id))
    expect(idsA).toEqual(idsB)
  })

  it('조건이 달라지면 id 도 달라진다', () => {
    const base = parseDialogue(['@greet  weather=rain', '  대사'].join('\n'), 'x.dlg')
    const changed = parseDialogue(['@greet  weather=snow', '  대사'].join('\n'), 'x.dlg')
    expect(base[0]?.id).not.toBe(changed[0]?.id)
  })

  it('화자(파일)가 다르면 조건·발화가 같아도 id 가 다르다', () => {
    // 화자를 해시에 안 넣으면, 서로 다른 두 화자가 우연히 같은 대사를 쓸 때
    // onceKey 가 같아져 한쪽이 "말했다"로 기록되는 순간 다른 화자의 대사도
    // 조용히 막힌다.
    const text = ['@greet', '  안녕하세요.'].join('\n')
    const a = parseDialogue(text, '노인.dlg')
    const b = parseDialogue(text, '상인.dlg')
    expect(a[0]?.id).not.toBe(b[0]?.id)
  })

  it('파일 이름(확장자 제외)이 speaker 가 된다', () => {
    const rules = parseDialogue(['@greet', '  안녕.'].join('\n'), '채집장노인.dlg')
    expect(rules[0]?.speaker).toBe('채집장노인')
  })
})

describe('parseDialogue — 출하 데이터', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const dialogueDir = join(here, '..', 'dialogue')

  it('채집장노인.dlg 가 오류 없이 파싱된다', () => {
    const text = readFileSync(join(dialogueDir, '채집장노인.dlg'), 'utf8')
    const rules = parseDialogue(text, '채집장노인.dlg')
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.every((r) => r.speaker === '채집장노인')).toBe(true)
  })

  it('얼음안내판.dlg 가 오류 없이 파싱된다', () => {
    const text = readFileSync(join(dialogueDir, '얼음안내판.dlg'), 'utf8')
    const rules = parseDialogue(text, '얼음안내판.dlg')
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.every((r) => r.speaker === '얼음안내판')).toBe(true)
  })
})
