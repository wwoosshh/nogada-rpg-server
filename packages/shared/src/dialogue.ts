/**
 * 대화 선택 규칙.
 *
 * 세계 상태(Facts)를 보고 화자가 지금 할 말(DialogueRule)을 고른다. 서버가
 * 판정을 독점하는 다른 규칙들과 같은 이유로, 난수는 여기서 만들지 않고
 * `rng` 로 주입받는다 — 이 모듈은 순수 함수만 담는다.
 *
 * 조건이 가장 많이 맞는 줄을 그냥 고르는 방식은 안 된다. 계절·시각·숙련도
 * 같은 싼 조건은 콘텐츠가 늘수록 계속 쌓이는데, 퀘스트·스토리 같은 비싼
 * 조건은 개수로 그것들을 이길 수 없다 — 그러면 대사를 열심히 쓸수록 진행의
 * 실마리가 잡담 밑에 묻힌다. 그래서 사건(event)에 서열(EVENT_ORDER)을 두고
 * 상위 사건부터 훑어 처음 후보가 있는 사건에서 멈추며, 조건 개수는 그 사건
 * 안에서만 비교한다.
 */

/** 사실 하나의 값. 비교 연산의 의미를 좁게 유지하려고 원시값만 허용한다. */
export type FactValue = string | number | boolean

/** 지금 세계 상태의 스냅샷 — 계절·시각·숙련도·퀘스트 진행 등 조건이 참조할 모든 것. */
export type Facts = Record<string, FactValue>

/**
 * 조건 하나. `fact` 가 아직 없으면(그 값을 만드는 공급자가 없으면) 어떤
 * 연산자로도 거짓이다 — matchesCondition 참고.
 */
export interface Condition {
  fact: string
  op: '=' | '!=' | '>' | '>=' | '<' | '<='
  value: FactValue
}

/**
 * 대사 규칙 하나. 화자 한 명이 특정 사건에서 조건이 전부 맞을 때 할 수 있는 말이다.
 *
 * `event` 는 자유 문자열이다. EVENT_ORDER 에 없는 값을 담아도 타입 에러는
 * 나지 않지만, selectDialogue 는 EVENT_ORDER 에 있는 사건만 훑으므로 그런
 * 규칙은 절대 선택되지 않는다 — 콘텐츠 검증은 이 모듈이 아니라 데이터
 * 파이프라인의 몫이다.
 */
export interface DialogueRule {
  id: string
  speaker: string
  event: string
  conditions: Condition[]
  lines: string[]
  /** 이 규칙이 정의된 원본 위치. 시뮬레이터·검증 도구가 사람이 찾아갈 곳을 가리키는 데 쓴다. */
  source: { file: string; line: number }
}

/**
 * 플레이어 한 명의 대화 이력.
 *
 * - `said`: onceKey 로 만든, ONCE_EVENTS 사건 규칙 중 이미 말한 것들의 키.
 * - `recent`: 화자 이름별로 최근에 나온 규칙 id — 같은 사건 안에서 방금 한
 *   말을 곧바로 반복하지 않게 한다.
 *
 * 이 모듈(selectDialogue)은 히스토리를 읽기만 한다. 고른 결과를 said·recent
 * 에 반영하는 것과 recent 를 몇 개로 잘라 무한히 자라지 않게 하는 것은 이
 * 상태를 실제로 저장하는 쪽(서버)의 몫이다.
 */
export interface DialogueHistory {
  said: string[]
  recent: Record<string, string[]>
}

export function emptyDialogueHistory(): DialogueHistory {
  return { said: [], recent: {} }
}

/**
 * 사건 서열. 앞에 올수록 중요하고, selectDialogue 는 이 순서대로 훑어 후보가
 * 하나라도 있는 첫 사건에서 멈춘다 — 배열 순서 자체가 곧 우선순위다.
 */
export const EVENT_ORDER = ['story', 'quest', 'milestone', 'greet'] as const

/**
 * 한 번 말하면 상태가 바뀌기 전까지 다시 등장하지 않는 사건들. 'greet' 만 뺀 나머지다.
 *
 * greet 까지 한 번만 말하는 것으로 치면, 퀘스트가 걸려 있는 동안(대개 대부분의
 * 시간) 잡담을 할 방법이 없어져 세계가 죽는다. 그래서 매번 다시 후보에 오를
 * 수 있는 사건을 최소 하나(greet) 남겨 둔다.
 */
export const ONCE_EVENTS: ReadonlySet<string> = new Set(
  EVENT_ORDER.filter((event) => event !== 'greet'),
)

/**
 * fact 하나를 조건과 비교한다.
 *
 * 사실이 아직 없으면(공급자가 그 fact 를 만들기 전이면) 어떤 연산자로도
 * 거짓이다 — `!=` 도 예외가 아니다. "없다"를 "다르다"로 세면, 그 fact 가
 * 나중에 생기는 순간 이미 나가 있던 대사의 조건이 조용히 뒤집힌다.
 */
export function matchesCondition(condition: Condition, facts: Facts): boolean {
  const actual = facts[condition.fact]
  if (actual === undefined) return false

  if (condition.op === '=') return actual === condition.value
  if (condition.op === '!=') return actual !== condition.value

  // 나머지 네 연산자(>, >=, <, <=)는 크기 비교이고, 양쪽이 숫자일 때만 참일 수
  // 있다. JS 는 문자열도 사전순으로 비교해 주지만, 그 결과가 작가의 의도와
  // 우연히 맞아떨어질 뿐이라 대사 조건으로는 신뢰할 수 없다.
  const { value } = condition
  if (typeof actual !== 'number' || typeof value !== 'number') return false

  if (condition.op === '>') return actual > value
  if (condition.op === '>=') return actual >= value
  if (condition.op === '<') return actual < value
  return actual <= value
}

/** 규칙의 조건이 전부 맞는가. 조건이 없으면 항상 맞는다 — "언제나 할 수 있는 말"이다. */
export function ruleMatches(rule: DialogueRule, facts: Facts): boolean {
  return rule.conditions.every((condition) => matchesCondition(condition, facts))
}

/**
 * "이미 말했다" 를 가르는 키.
 *
 * 규칙 id 만 쓰면 퀘스트가 3단계에서 4단계로 넘어가도 여전히 같은 키라 다시
 * 말하지 못한다. 그래서 그 규칙이 스스로 건 조건들의 "지금" 값을 함께 엮는다
 * — 조건 중 하나라도 값이 바뀌면 키가 바뀌어 새 대사로 취급되고, 다시 말할
 * 수 있게 된다.
 *
 * 조건이 없는 규칙은 엮을 값이 없어 키가 규칙 id 하나로 고정된다. 그런
 * 규칙은 상태와 무관하게 평생 한 번만 말한다 — 예를 들어 최초 인사말.
 * 이것은 버그가 아니라 "조건 없는 once 규칙"이 의미하는 바 그 자체다.
 */
export function onceKey(rule: DialogueRule, facts: Facts): string {
  const snapshot = rule.conditions.map((c) => [c.fact, facts[c.fact] ?? null] as const)
  return JSON.stringify({ id: rule.id, snapshot })
}

/** selectDialogue 가 훑은 사건 하나와, 그 사건에서 화자로 거르고 조건까지 맞은 규칙들(once 필터 적용 전). */
export interface DialogueTraceEntry {
  event: string
  matched: DialogueRule[]
}

export interface DialogueSelection {
  rule: DialogueRule
  trace: DialogueTraceEntry[]
}

/**
 * 지금 할 말을 고른다. 후보가 하나도 없으면 null.
 *
 * 0) 먼저 `speaker` 로 rules 를 걸러 그 화자의 규칙만 남긴다. 이 필터가
 *    함수의 첫 줄인 것이 중요하다 — 예전에는 "지금 화자의 규칙만 추려서
 *    넘겨라"가 호출자에게 맡겨진 관례였는데, 그 관례를 어기고 화자가 섞인
 *    배열(예: GameData.dialogue 전체)을 그대로 넘기면 다른 화자의 아직
 *    안 나온 story·quest 가 사건 서열에서 이 화자의 greet 을 가로챈다.
 *    조건이 하나도 안 맞을 때와 달리 이 사고는 에러도 빈 결과도 아니고
 *    그냥 엉뚱한 화자 말투의 대사가 나오므로 테스트도 못 잡는다 — 그래서
 *    "걸러서 넘기기"를 관례가 아니라 이 함수의 구조로 만든다. 아래 1~4는
 *    전부 이 걸러진 부분집합 위에서만 일어난다.
 * 1) EVENT_ORDER 순으로 사건을 훑는다. 각 사건에서 조건까지 맞는 규칙을
 *    모으고(trace 에 기록), ONCE_EVENTS 사건이면 이미 말한(said) 것을 뺀다.
 *    남은 것이 있는 첫 사건에서 멈춘다 — 사건 서열이 조건 개수보다 먼저라는
 *    이 모듈의 핵심 규칙이다. 상위 사건을 이미 다 말했으면 자연히 다음
 *    사건으로 넘어간다.
 * 2) 멈춘 사건 안에서: 조건 개수가 가장 많은 것만 남긴다 — 가장 구체적인
 *    조건이 우선이다.
 * 3) 그중 화자가 방금 말한 것(recent)을 뺀다. 전부 빠지면 침묵보다는 반복이
 *    나으므로 빼지 않는다.
 * 4) 남은 후보에서 rng() 로 하나를 고른다.
 *
 * `speaker` 와 `facts` 는 서로 다른 것을 정한다 — 섞지 않는다. 대사창을
 * 채우는 facts 뭉치에는 (설계 문서의 "사실 뭉치"처럼) 참고용 `speaker`
 * 사실이 함께 들어갈 수도 있지만, 이 함수는 facts 안의 어떤 키도 "누구
 * 차례인가"를 정하는 데 쓰지 않는다 — 그 결정은 이 매개변수 하나가 전부
 * 한다. facts 는 `Record<string, FactValue>` 로 모양이 열려 있어 키가
 * 있다는 것도 이름이 맞다는 것도 컴파일러가 보장하지 못한다. 거기 기대어
 * `speaker` 매개변수와 맞는지 검증하기 시작하면, "규칙을 걸러서 넘겨라"
 * 였던 예전 관례가 "facts.speaker 를 정확히 채워라"는 관례로 자리만
 * 옮긴다 — 여전히 잊을 수 있는 약속이다. 진실의 출처를 하나로 두어야
 * 잊을 수 없다.
 *
 * history 는 읽기만 한다 — 고른 결과를 said·recent 에 반영하는 것은
 * 호출자(서버)의 몫이다.
 */
export function selectDialogue(
  speaker: string,
  rules: readonly DialogueRule[],
  facts: Facts,
  history: DialogueHistory,
  rng: () => number,
): DialogueSelection | null {
  // 이 필터 한 줄이 이 함수를 "화자가 섞인 배열을 넘겨도 안전"하게 만든다.
  // 아래 루프는 이 결과(speakerRules)만 보고 rules 원본을 다시 참조하지
  // 않는다 — 그래야 이 필터가 우회 가능한 지름길이 아니라 유일한 입구다.
  const speakerRules = rules.filter((r) => r.speaker === speaker)

  // recent 는 화자별로 묶여 있지만, 위 필터를 거친 뒤로는 speakerRules 의
  // 모든 규칙이 이미 이 speaker 것이다 — 그래서 규칙마다 다시 찾지 않고
  // 한 번만 꺼내 쓴다.
  const recentForSpeaker = history.recent[speaker] ?? []

  const trace: DialogueTraceEntry[] = []

  for (const event of EVENT_ORDER) {
    const matched = speakerRules.filter((r) => r.event === event && ruleMatches(r, facts))
    trace.push({ event, matched })

    const eligible = ONCE_EVENTS.has(event)
      ? matched.filter((r) => !history.said.includes(onceKey(r, facts)))
      : matched

    // 이 사건에 후보가 없으면 다음(덜 중요한) 사건으로 내려간다.
    if (eligible.length === 0) continue

    // 가장 구체적인 것 우선: 조건 개수 최댓값만 남긴다. spread 대신 reduce 를
    // 쓰는 것은 스타일이 아니라 규칙 수가 많아져도(수백 개) 인자 개수 제한에
    // 걸리지 않기 위해서다.
    const maxConditions = eligible.reduce((max, r) => Math.max(max, r.conditions.length), 0)
    const mostSpecific = eligible.filter((r) => r.conditions.length === maxConditions)

    // 화자가 방금 한 말은 잠시 뺀다. 전부 최근이면(=뺄 게 없으면) 침묵보다는
    // 반복이 나으므로 빼지 않는다.
    const fresh = mostSpecific.filter((r) => !recentForSpeaker.includes(r.id))
    const candidates = fresh.length > 0 ? fresh : mostSpecific

    const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))
    // candidates 는 이 지점에서 항상 길이 1 이상이다: eligible 이 비지 않았고,
    // mostSpecific·fresh 폴백 모두 최소 하나는 남긴다.
    const winner = candidates[index]!

    return { rule: winner, trace }
  }

  return null
}
