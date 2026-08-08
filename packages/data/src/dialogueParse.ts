import type { Condition, DialogueRule, FactValue } from '@nogada/shared'

/**
 * 오류가 가리키는 위치를 적는 한 가지 꼴.
 *
 * 파서와 검증이 서로 다른 꼴(`x.dlg 5행` vs `x.dlg:5행`)을 쓰면, 같은 빌드
 * 출력 안에서 두 가지 문법이 나와 작가가 "이건 다른 종류의 문제인가"를 먼저
 * 고민하게 된다. 편집기·터미널이 링크로 잡아 주는 `파일:줄` 관례에 맞춘다.
 */
export function dialogueLocation(file: string, line: number): string {
  return `${file}:${line}행`
}

/**
 * 조건에 쓸 수 있는 연산자 전부.
 *
 * 배열로 내보내는 것은 순서가 필요해서다 — 오류 메시지와 작가용 문서
 * (dialogue/README.md)가 같은 목록을 같은 순서로 보여줘야 한다.
 */
export const DIALOGUE_OPS: readonly Condition['op'][] = ['=', '!=', '>', '>=', '<', '<='] as const

/**
 * `.dlg` 파일 하나를 파싱한다. 파일 하나 = 화자 하나다(설계 문서 5장).
 *
 * 형식:
 * ```
 * # 주석
 * @사건  fact=value  fact>=value
 *   발화 줄
 *   이어지는 발화 줄
 * ```
 *
 * - `#` 로 시작하는 줄과 빈 줄은 무시한다.
 * - `@` 로 시작하는 줄이 규칙 머리다. 그 뒤로 다음 규칙 머리(또는 파일 끝)까지
 *   나오는 줄은 전부 그 규칙의 발화다 — **이어지는 한 마디**다. 택일은
 *   새 문법이 아니라 조건이 같은 규칙 머리를 다시 쓰는 것으로 표현한다
 *   (selectDialogue 가 동점을 무작위로 고른다). 그래서 이 파서는 들여쓰기
 *   깊이를 보지 않는다 — `@` 로 시작하지 않는 줄이면 전부 "지금 열린 규칙의
 *   다음 줄"이고, 그것으로 이어지는 발화와 택일을 구분하기에 충분하다.
 *
 * `file` 은 두 가지로 쓰인다: 오류 메시지에 위치를 밝히는 데, 그리고 화자
 * id 를 얻는 데(확장자를 뗀 파일 이름 — speakerIdFromFile 참고).
 */
export function parseDialogue(text: string, file: string): DialogueRule[] {
  const speaker = speakerIdFromFile(file)
  const rawLines = text.split(/\r?\n/)
  const rules: DialogueRule[] = []
  const seenIds = new Set<string>()

  let current: OpenRule | null = null

  const flush = (): void => {
    if (!current) return
    if (current.lines.length === 0) {
      throw new Error(
        `${dialogueLocation(file, current.headLine)}: 발화 없이 규칙 머리만 있다 (@${current.event}) — 이 규칙이 할 말을 최소 한 줄 적는다`,
      )
    }

    const id = buildRuleId(speaker, current.event, current.conditions, current.lines)
    if (seenIds.has(id)) {
      throw new Error(
        `${dialogueLocation(file, current.headLine)}: 조건과 발화가 완전히 같은 규칙이 이미 있다 — 복사하고 고치는 것을 잊은 것으로 보인다`,
      )
    }
    seenIds.add(id)

    rules.push({
      id,
      speaker,
      event: current.event,
      conditions: current.conditions,
      lines: current.lines,
      source: { file, line: current.headLine },
    })
    current = null
  }

  rawLines.forEach((raw, index) => {
    const lineNo = index + 1
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return // 주석·빈 줄은 무시한다

    if (trimmed.startsWith('@')) {
      flush() // 이전 규칙 머리를 마무리한다(발화가 있었는지는 flush 안에서 검사한다)

      const tokens = trimmed
        .slice(1)
        .split(/\s+/)
        .filter((t) => t.length > 0)
      const event = tokens[0]
      if (event === undefined) {
        throw new Error(`${dialogueLocation(file, lineNo)}: 규칙 머리에 사건 이름이 없다 (예: @greet)`)
      }
      const conditions = tokens.slice(1).map((token) => parseConditionToken(token, file, lineNo))
      current = { event, conditions, lines: [], headLine: lineNo }
      return
    }

    if (!current) {
      throw new Error(`${dialogueLocation(file, lineNo)}: 규칙 머리(@사건) 없이 발화 줄이 먼저 나왔다`)
    }
    current.lines.push(trimmed)
  })

  flush() // 파일이 규칙 머리로 끝나도(다음 @ 가 없어도) 마지막 규칙을 마무리한다

  return rules
}

interface OpenRule {
  event: string
  conditions: Condition[]
  lines: string[]
  /** 이 규칙 머리가 있던 줄. 발화 누락·중복 오류를 이 줄에 anchor 한다. */
  headLine: number
}

/**
 * "dialogue/채집장노인.dlg" 든 "채집장노인.dlg" 든 디렉터리와 확장자를 떼서
 * 화자 id 를 얻는다. 파일 하나가 화자 하나이므로(설계 문서 5장) 별도로
 * speaker 를 인자로 받지 않고 파일 이름에서 유도한다 — 이름이 곧 화자다.
 */
function speakerIdFromFile(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file
  return base.endsWith('.dlg') ? base.slice(0, -'.dlg'.length) : base
}

const OP_CHARS = new Set(['=', '!', '<', '>'])
const VALID_OPS: ReadonlySet<string> = new Set(DIALOGUE_OPS)

/**
 * 조건 토큰(`weather=rain`, `skill.ice>=50000`) 을 fact·연산자·값으로 나눈다.
 *
 * 정규식으로 `>=|<=|!=|=|>|<` 를 앞에서부터 매치하는 방식은 쓰지 않는다 —
 * 그러면 `weather==rain` 같은 오타에서 앞의 `=` 하나만 연산자로 인식하고
 * 나머지 `=rain` 을 값으로 삼켜버려 오타가 조용히 통과한다. 대신 연산자
 * 문자(`=`·`!`·`<`·`>`)가 연달아 나오는 구간을 통째로 연산자 후보로 모은
 * 뒤 허용 목록과 대조한다 — `==` 처럼 알려지지 않은 조합은 그 자리에서
 * "알 수 없는 연산자"로 걸린다.
 */
function parseConditionToken(token: string, file: string, line: number): Condition {
  let i = 0
  while (i < token.length && !OP_CHARS.has(token[i]!)) i++
  const fact = token.slice(0, i)

  let j = i
  while (j < token.length && OP_CHARS.has(token[j]!)) j++
  const opRaw = token.slice(i, j)
  const valueRaw = token.slice(j)

  if (fact === '' || opRaw === '' || valueRaw === '') {
    throw new Error(`${dialogueLocation(file, line)}: 조건 "${token}" 의 형식을 알 수 없다 (예: weather=rain)`)
  }
  if (!VALID_OPS.has(opRaw)) {
    throw new Error(
      `${dialogueLocation(file, line)}: 조건 "${token}" 의 연산자 "${opRaw}" 를 알 수 없다 (허용: ${DIALOGUE_OPS.join(', ')})`,
    )
  }

  return { fact, op: opRaw as Condition['op'], value: parseFactValue(valueRaw) }
}

/**
 * 조건 값의 원문을 FactValue 로 바꾼다.
 *
 * "true"/"false" 는 불리언으로, 숫자로 읽히는 값은 숫자로 바꾼다 — 그래야
 * `skill.ice>=50000` 같은 크기 비교가 matchesCondition 에서 실제로 숫자
 * 비교가 된다(문자열끼리는 크기 비교를 허용하지 않는다). 그 외에는 그대로
 * 문자열이다 — `weather=rain`, `justAchieved=ice_10000` 처럼 식별자를 값으로
 * 쓰는 경우가 훨씬 많아서, 숫자로 읽히지 않는 한 원문을 그대로 믿는다.
 */
function parseFactValue(raw: string): FactValue {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw !== '' && Number.isFinite(Number(raw))) return Number(raw)
  return raw
}

/**
 * 결정적 문자열 해시(FNV-1a). "같은 내용이면 같은 값, 다른 내용이면 다른
 * 값"만 필요해서 암호학적 해시(node:crypto)를 쓰지 않는다 — 이 모듈은
 * packages/data 의 공개 배럴(index.ts)을 거쳐 apps/client 의 타입체크에도
 * 닿는데, node:crypto 는 브라우저 타입 환경에 없어 거기서 컴파일이 깨진다.
 *
 * 시드를 바꿔 두 번 돌려 32비트 값 두 개(사실상 64비트)를 엮는다 — 이
 * 게임이 가질 규모의 대사 규칙 수(많아야 수천 개)에서 우연한 충돌
 * 확률은 무시할 만하다.
 */
function fnv1a(text: string, seed: number): number {
  let hash = seed
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) // FNV prime
  }
  return hash >>> 0
}

function fingerprint(payload: string): string {
  const a = fnv1a(payload, 0x811c9dc5) // FNV offset basis
  const b = fnv1a(payload, 0x1000193)
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/**
 * 규칙 id 를 내용(화자·사건·조건·발화)에서 만든다 — 파일 안 순서는 절대
 * 넣지 않는다.
 *
 * id 는 `dialogueHistory.said`(플레이어 세이브)에 그대로 저장된다. 순서에서
 * id 를 만들면 작가가 파일 안에서 규칙 블록의 위치만 옮겨도 세이브에 남은
 * "이미 말했다" 기록이 전부 어긋난다 — 순서를 정본으로 삼지 않는 것이 이
 * 함수가 존재하는 이유다.
 *
 * 화자를 해시에 포함하는 것은 우연한 충돌을 막기 위해서다. 서로 다른 두
 * 화자가 우연히 같은 조건·발화를 쓰면(예: 둘 다 조건 없이 "안녕하세요."
 * 한 마디), 화자 없이 해시하면 두 규칙이 같은 id 를 갖는다. onceKey 는 그
 * id 를 그대로 엮으므로, 한쪽이 "말했다"로 기록되는 순간 다른 화자의 같은
 * 대사도 조용히 막혀버린다 — 화자를 넣으면 애초에 이런 충돌이 생기지 않는다.
 *
 * 조건은 "쓰여진 순서 그대로" 해시한다(정렬하지 않는다) — 이 파서는 쓰여진
 * 내용을 정본으로 삼고, "논리적으로 같은데 순서만 다른 조건"까지 알아서
 * 같게 취급하려 하지 않는다. 그렇게 하면 "조건 순서를 바꿨는데 왜 id 가
 * 그대로지?" 처럼 작가가 예측하기 어려운 규칙이 하나 더 생긴다.
 *
 * 발화(lines)를 해시에 넣는 것은 "택일" 을 위해 꼭 필요하다 — 조건이 같은
 * 두 규칙 머리(설계 문서 5장의 "택일")를 구분할 수 있는 유일한 차이가
 * 발화 내용이기 때문이다. 그 결과 발화 문구만 고쳐도(조건은 그대로) id 가
 * 바뀌어 "이미 말했다" 가 풀리는데, 이건 버그가 아니라 자연스러운 결과다 —
 * 문구를 크게 바꾼 것은 사실상 새 대사이므로 다시 말할 수 있는 편이 낫다.
 */
function buildRuleId(speaker: string, event: string, conditions: Condition[], lines: string[]): string {
  const payload = JSON.stringify({ speaker, event, conditions, lines })
  return `${speaker}.${event}.${fingerprint(payload)}`
}
