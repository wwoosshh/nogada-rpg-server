/**
 * `pnpm content` — 대사 시뮬레이터와 역방향 조회.
 *
 * 이 도구가 존재하는 이유는 검증만으로는 부족해서다. 검증은 대사가 *틀렸는지*를
 * 잡지만, 작가가 정말 알고 싶은 것은 "이 상태에서 무슨 말이 나오고, 왜 그 말인가"
 * 다(설계 문서 8장). 그래서 이 파일은 게임 규칙을 다시 판정하지 않는다 —
 * `selectDialogue`(packages/shared)를 그대로 부르고, 그 결과와 같은 입력을
 * `ruleMatches`·`onceKey` 같은 엔진 함수로 한 번 더 들여다봐서 "왜"를 설명할
 * 뿐이다. 새 판정을 만들면 언젠가 엔진과 이 도구가 갈라진다.
 *
 * 이 모듈은 packages/data 의 다른 테스트들이 import 하므로(content-cli.test.ts),
 * `tsx src/content-cli.ts` 로 직접 실행될 때만 부수효과(process.argv 읽기·
 * console 출력·process.exit)가 나가야 한다 — 그래서 아래 로직은 전부 순수
 * 함수로 export 하고, 실제 실행은 파일 맨 아래 main-guard 뒤에 둔다.
 */
import { pathToFileURL } from 'node:url'
import type { DialogueHistory, DialogueRule, Facts, FactValue, GameData } from '@nogada/shared'
import {
  DECLARED_FACTS,
  EVENT_ORDER,
  ONCE_EVENTS,
  SKILL_IDS,
  createRng,
  emptyDialogueHistory,
  findFactSpec,
  gameTimeAt,
  onceKey,
  ruleMatches,
  selectDialogue,
} from '@nogada/shared'
import { dialogueLocation, parseFactValue } from './dialogueParse.js'
import { collectDialogueNotices, conditionText, findDeadDialogueRules } from './validate.js'
import { loadGameData } from './load.js'

// ---------------------------------------------------------------------------
// 명령줄 파싱
// ---------------------------------------------------------------------------

export interface DialogueCommand {
  kind: 'dialogue'
  speaker: string
  overrides: Facts
}
export interface FactsCommand {
  kind: 'facts'
}
export interface DeadCommand {
  kind: 'dead'
}
export interface WaitingCommand {
  kind: 'waiting'
}
export type ContentCommand = DialogueCommand | FactsCommand | DeadCommand | WaitingCommand

const USAGE =
  '사용법: pnpm content dialogue <화자id> [--사실=값 ...] | pnpm content facts | pnpm content dead | pnpm content waiting'

/**
 * `--사실=값` 인자들을 Facts 로 바꾼다.
 *
 * 값 해석은 dialogueParse.ts 의 parseFactValue 를 그대로 쓴다 — `.dlg` 파일의
 * 조건 값과 명령줄의 값이 같은 문법(참거짓은 불리언, 숫자는 숫자)이어야
 * 작가가 파일에서 본 값을 그대로 명령줄에 옮겨 쓸 수 있다.
 *
 * 선언되지 않은 사실은 findFactSpec 으로 거른다 — 빌드가 조건의 오타를 잡는
 * 것과 정확히 같은 검사이자 같은 이유다(설계 문서 6.3). `speaker` 는 이
 * 목록에 없으므로(selectDialogue 가 별도 매개변수로 받는다) 여기로 주면
 * 오타와 똑같이 막힌다 — 이것도 의도한 동작이다.
 */
export function parseFactOverrides(args: readonly string[]): Facts {
  const facts: Record<string, FactValue> = {}
  for (const arg of args) {
    if (!arg.startsWith('--')) {
      throw new Error(`"${arg}" 를 이해할 수 없다 — --사실=값 형식으로 쓴다 (예: --skill.ice=15000)`)
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    if (eq < 0) {
      throw new Error(`"${arg}" 에 값이 없다 — --사실=값 형식으로 쓴다 (예: --weather=rain)`)
    }
    const fact = body.slice(0, eq)
    const raw = body.slice(eq + 1)
    if (!findFactSpec(fact)) {
      throw new Error(
        `선언되지 않은 사실 "${fact}" 다 — 쓸 수 있는 사실은 packages/data/dialogue/README.md 의 표를 본다`,
      )
    }
    facts[fact] = parseFactValue(raw)
  }
  return facts
}

/** process.argv.slice(2) 를 받아 네 명령 중 하나로 해석한다. */
export function parseArgs(argv: readonly string[]): ContentCommand {
  const [command, ...rest] = argv

  if (command === 'facts' || command === 'dead' || command === 'waiting') {
    if (rest.length > 0) {
      throw new Error(`"${command}" 는 추가 인자를 받지 않는다 — 조용히 무시하면 오타를 못 알아챈다.\n${USAGE}`)
    }
    return { kind: command }
  }

  if (command === 'dialogue') {
    const [speaker, ...factArgs] = rest
    if (!speaker) {
      throw new Error(`화자 id 가 없다.\n${USAGE}`)
    }
    return { kind: 'dialogue', speaker, overrides: parseFactOverrides(factArgs) }
  }

  throw new Error(`알 수 없는 명령 "${command ?? ''}" — 쓸 수 있는 명령: dialogue, facts, dead, waiting`)
}

// ---------------------------------------------------------------------------
// dialogue — 시뮬레이터
// ---------------------------------------------------------------------------

/**
 * 시뮬레이터는 실행마다 답이 바뀌면 신뢰할 수 없다(브리프) — 그래서 매번 다른
 * Math.random 대신 고정 시드의 결정적 PRNG(createRng, packages/shared)를 쓴다.
 * rng.ts 자신의 문서 주석이 "테스트와 밸런스 시뮬레이터만 결정적 재현을 위해
 * 직접 시드를 넣는다"고 이 쓰임을 이미 예고해 두었다. 시드 값 자체엔 의미가
 * 없다 — 항상 같기만 하면 된다.
 *
 * 동점(무작위로 갈리는 상황)이 실제로 있으면 출력에서 "동점 후보 N개 중
 * 무작위" 라고 밝힌다 — 그래야 작가가 "이 시뮬레이터는 항상 이것만 나온다"고
 * 오해하지 않는다. 실제 게임은 대화할 때마다 다른 rng 값을 쓰므로 후보들
 * 사이에서 진짜로 달라진다.
 */
const SIMULATOR_SEED = 20260808

/**
 * 기본 사실 뭉치 — "지금 월드 시각 + 빈 플레이어"(브리프 Step 1).
 *
 * 빈 플레이어는 숙련도 전부 0, 이정표 전부 미달성, 대화 이력 없음(한 번도
 * 말해 본 적 없음)이다. `justAchieved`(방금 넘긴 문턱)와
 * `daysSinceLastTalk`(마지막 대화로부터 며칠)는 일부러 채우지 않는다 — 방금
 * 아무것도 안 넘겼고, 애초에 마지막 대화 자체가 없는 사람에게는 값을 매길
 * 수 없다. matchesCondition 은 없는 사실을 항상 거짓으로 보므로, 이 두
 * 사실을 조건으로 건 규칙은 명시적으로 --사실=값 을 주기 전까지 자연히
 * 안 나온다 — 그게 "빈 플레이어"의 정확한 의미다.
 */
function defaultFacts(data: GameData, nowMs: number): Facts {
  const time = gameTimeAt(nowMs)
  const facts: Record<string, FactValue> = {
    season: time.season,
    hour: time.hour,
    dayOfSeason: time.dayOfSeason,
    talkedBefore: false,
  }
  for (const skill of SKILL_IDS) facts[`skill.${skill}`] = 0
  for (const milestone of data.milestones) facts[`milestone.${milestone.id}`] = false
  return facts
}

/** 조건 없는 규칙의 라벨. 설계 문서 8.1 이 쓰는 그대로다. */
function conditionLabel(rule: DialogueRule): string {
  return rule.conditions.length === 0 ? '(무조건)' : rule.conditions.map(conditionText).join(' ')
}

type RuleStatus =
  | { kind: 'winner'; poolSize: number }
  | { kind: 'alreadySaid' }
  | { kind: 'fewerConditions'; need: number }
  | { kind: 'recentlySaid' }
  | { kind: 'lostTiebreak'; poolSize: number }

/**
 * 채택된 사건 안에서, 맞은 규칙(matched) 각각이 승자에 견줘 어느 단계에서
 * 걸러졌는지를 가른다.
 *
 * 승자 자체는 이미 selectDialogue 가 정했다(winner 인자로 받는다) — 여기서는
 * 새 판정을 하지 않는다. selectDialogue 내부의 네 단계(이미 말한 것 제외 →
 * 조건 최댓값만 남기기 → 최근 것 제외 → rng 로 선택)를 같은 순서로 다시
 * 나눠 보며, 승자가 아닌 나머지가 그중 어느 단계에서 빠졌는지만 관찰한다.
 * 이 구분이 브리프가 요구하는 "세 가지 지는 이유" 중 하나(원인 c: 조건
 * 개수 부족 / 동점 탈락 / 이미 말함)를 만든다.
 */
function classifyMatchedRules(
  event: string,
  matched: readonly DialogueRule[],
  facts: Facts,
  history: DialogueHistory,
  speaker: string,
  winner: DialogueRule,
): ReadonlyMap<string, RuleStatus> {
  const eligible = ONCE_EVENTS.has(event) ? matched.filter((r) => !history.said.includes(onceKey(r, facts))) : matched
  const maxConditions = eligible.reduce((max, r) => Math.max(max, r.conditions.length), 0)
  const mostSpecific = eligible.filter((r) => r.conditions.length === maxConditions)
  const recentForSpeaker = history.recent[speaker] ?? []
  const fresh = mostSpecific.filter((r) => !recentForSpeaker.includes(r.id))
  const candidates = fresh.length > 0 ? fresh : mostSpecific

  const result = new Map<string, RuleStatus>()
  for (const rule of matched) {
    if (rule.id === winner.id) {
      result.set(rule.id, { kind: 'winner', poolSize: candidates.length })
    } else if (!eligible.includes(rule)) {
      result.set(rule.id, { kind: 'alreadySaid' })
    } else if (!mostSpecific.includes(rule)) {
      result.set(rule.id, { kind: 'fewerConditions', need: maxConditions })
    } else if (!candidates.includes(rule)) {
      result.set(rule.id, { kind: 'recentlySaid' })
    } else {
      result.set(rule.id, { kind: 'lostTiebreak', poolSize: candidates.length })
    }
  }
  return result
}

function renderStatusSuffix(rule: DialogueRule, status: RuleStatus): string {
  const n = rule.conditions.length
  switch (status.kind) {
    case 'winner':
      return status.poolSize > 1 ? `선택됨 (조건 ${n}, 동점 후보 ${status.poolSize}개 중 무작위)` : `선택됨 (조건 ${n})`
    case 'fewerConditions':
      return `조건 ${n}개 — 더 구체적인 규칙(조건 ${status.need}개)에 밀려 후보에서 빠짐`
    case 'alreadySaid':
      return `조건 ${n}개 — 이미 말해서 값이 바뀌기 전까진 다시 안 나옴`
    case 'recentlySaid':
      return `조건 ${n}개 — 동점이지만 방금 말해서 잠시 제외됨`
    case 'lostTiebreak':
      return `조건 ${n}개 — 동점(후보 ${status.poolSize}개), 무작위 추첨에서 안 뽑힘`
  }
}

export interface DialogueRunOptions {
  /** epoch ms. "지금" 을 밖에서 주입해야 테스트가 날짜에 흔들리지 않는다. */
  now: number
  seed: number
}

/**
 * `pnpm content dialogue <화자> [--사실=값 ...]` 의 본체.
 *
 * 설계 문서 8.1 의 출력 형태(훑은 사건 → 채택한 사건 → 그 안의 후보와 조건
 * 개수 → 선택 → 최종 발화)를 따른다. 그 위에 사건 표의 각 줄마다 "왜
 * 안 됐는지"를 덧붙인다:
 *   - 채택된 사건보다 앞선 사건: 조건이 안 맞았다(원인 a) — "규칙 없음"
 *   - 채택된 사건보다 뒤(더 낮은 우선순위): 맞았어도 상위 사건이 먼저
 *     채택돼 애초에 평가되지 않았다(원인 b) — 이건 selectDialogue 의 trace
 *     에 없는 정보라 ruleMatches 를 직접 한 번 더 불러서 확인한다
 *   - 채택된 사건 안: 승자가 아니면 조건 개수 부족·동점 탈락·이미 말함 중
 *     하나다(원인 c) — classifyMatchedRules 가 가른다
 */
export function runDialogueCommand(
  data: GameData,
  speakerId: string,
  overrides: Facts,
  opts: DialogueRunOptions,
): string {
  if (!Object.hasOwn(data.speakers, speakerId)) {
    const known = Object.keys(data.speakers).sort().join(', ') || '(없음)'
    throw new Error(`화자 "${speakerId}" 를 모른다 — 있는 화자: ${known}`)
  }

  const facts: Facts = { ...defaultFacts(data, opts.now), ...overrides }
  const history = emptyDialogueHistory() // 시뮬레이터는 매번 "방금 처음 말 건" 상태를 본다 — talkedBefore=false 와 짝을 맞춘다.
  const rng = createRng(opts.seed)
  const speakerRules = data.dialogue.filter((r) => r.speaker === speakerId)

  const selection = selectDialogue(speakerId, data.dialogue, facts, history, rng)

  const out: string[] = []

  // 이번 호출에 실제로 쓰인 사실을 요약한다 — season/hour 는 실행 시각에 따라
  // 달라지는 기본값이라, 결과만 보고는 "왜 하필 이 값"인지 알 수 없다.
  const overrideText = Object.entries(overrides)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  out.push(
    `${speakerId} 에게 말을 걸었다 — 지금 시각 season=${facts.season} hour=${facts.hour} dayOfSeason=${facts.dayOfSeason}` +
      (overrideText ? `, 준 사실: ${overrideText}` : '') +
      ', 나머지는 빈 플레이어 기본값(숙련도 0·이정표 미달성·대화 이력 없음).',
  )
  out.push('')

  const trace = selection?.trace ?? []
  const adoptedEvent = selection ? trace[trace.length - 1]?.event : undefined
  const walked = new Map(trace.map((entry) => [entry.event, entry] as const))

  out.push('사건 서열을 훑는다:')
  const maxEventLen = Math.max(...EVENT_ORDER.map((e) => e.length))
  for (const event of EVENT_ORDER) {
    const label = `  ${event.padEnd(maxEventLen + 2)}`
    if (event === adoptedEvent) {
      const count = walked.get(event)?.matched.length ?? 0
      out.push(`${label}← 채택 (조건 맞는 규칙 ${count}개)`)
      continue
    }
    const entry = walked.get(event)
    if (entry) {
      // selectDialogue 가 실제로 이 사건까지 훑었지만 채택하지 않고 다음으로
      // 넘어갔다는 뜻이다 — ONCE_EVENTS 라서 맞은 규칙이 전부 이미 말한
      // 것이었을 때만 이런 일이 생긴다(matched>0인데 다음으로 넘어감).
      out.push(
        entry.matched.length === 0
          ? `${label}규칙 없음`
          : `${label}조건은 맞지만 전부 이미 말해 다음 사건으로 넘어감 (규칙 ${entry.matched.length}개)`,
      )
    } else {
      // 채택된 사건보다 순서가 뒤라 selectDialogue 는 이 사건을 아예 보지
      // 않았다. "맞았을 후보가 있었는가"는 이 도구가 별도로 확인해 알려준다
      // (원인 b) — ruleMatches 를 부를 뿐 새로운 판정 기준을 만들지 않는다.
      const wouldMatch = speakerRules.filter((r) => r.event === event && ruleMatches(r, facts))
      // "${adoptedEvent} 가/이"처럼 영문 식별자에 조사를 직접 붙이면 받침 유무에
      // 따라 문법이 어긋난다(story·quest 뒤엔 "가", milestone 뒤엔 "이") — 고정된
      // 한국어 명사 "사건"을 사이에 끼워 조사를 그 명사에 붙이면 event 값과
      // 무관하게 항상 맞는다.
      out.push(
        wouldMatch.length === 0
          ? `${label}평가 안 함 — ${adoptedEvent} 사건이 상위라 순서상 확인하지 않음`
          : `${label}평가 안 함 — 조건 맞는 규칙 ${wouldMatch.length}개가 있었지만 ${adoptedEvent} 사건이 상위라 순서상 못 나옴`,
      )
    }
  }
  out.push('')

  if (!selection) {
    out.push('말을 걸어도 지금은 할 말이 없다 — 어떤 사건에도 조건이 맞는 규칙이 없다.')
    return out.join('\n')
  }

  const lastEntry = trace[trace.length - 1]!
  const matched = lastEntry.matched
  const winner = selection.rule
  const statuses = classifyMatchedRules(lastEntry.event, matched, facts, history, speakerId, winner)

  out.push(`${lastEntry.event} 안에서 맞은 규칙 ${matched.length}개:`)
  const sorted = [...matched].sort((a, b) => b.conditions.length - a.conditions.length)
  for (const rule of sorted) {
    const status = statuses.get(rule.id)
    if (!status) continue // matched 에서 만든 map 이라 항상 있다 — 방어적 스킵일 뿐.
    const mark = status.kind === 'winner' ? '✓' : ' '
    out.push(`  ${mark} ${conditionLabel(rule)}    ${renderStatusSuffix(rule, status)}`)
  }
  out.push('')

  if (winner.lines.length === 1) {
    out.push(`출력: "${winner.lines[0]}"`)
  } else {
    out.push(`출력 (${winner.lines.length}칸, 대사창이 순서대로 넘김):`)
    winner.lines.forEach((line, i) => out.push(`  ${i + 1}. "${line}"`))
  }

  return out.join('\n')
}

// ---------------------------------------------------------------------------
// facts — 역방향 조회: 사실별로 그것을 쓰는 대사가 몇 줄인지
// ---------------------------------------------------------------------------

export function runFactsCommand(data: GameData): string {
  const counts = new Map<string, number>()
  for (const rule of data.dialogue) {
    // 한 규칙이 같은 사실을 조건 두 개로 걸어도(예: skill.ice>=100, skill.ice<200)
    // 그 규칙의 줄 수를 두 번 세지 않도록 규칙 단위로 한 번만 센다 —
    // collectDialogueNotices(validate.ts)와 같은 규칙이다.
    const usedFacts = new Set(rule.conditions.map((c) => c.fact))
    for (const fact of usedFacts) counts.set(fact, (counts.get(fact) ?? 0) + rule.lines.length)
  }

  // 아무도 안 쓴 고정 이름 사실도 0줄로 보여준다 — "쓸 수 있는데 아직 아무도
  // 안 썼다"는 것도 작가에게 유용한 정보다. 접두사 사실(skill.* 등)은 구체적
  // 이름이 열려 있어 0줄짜리를 나열하는 것 자체가 의미 없다.
  for (const spec of DECLARED_FACTS) {
    if (!spec.prefix && !counts.has(spec.name)) counts.set(spec.name, 0)
  }

  const rows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  const lines = ['사실별로 그것을 쓰는 대사 줄 수:']
  for (const [fact, count] of rows) lines.push(`  ${fact}: ${count}줄`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// dead — 역방향 조회: 어떤 조건에서도 안 나오는 대사
// ---------------------------------------------------------------------------

/**
 * findDeadDialogueRules(validate.ts)를 그대로 부른다 — 브리프: "dead 는 검증의
 * 계산을 쓴다, 두 곳에 따로 구현하지 않는다." validateGameData 의 빌드 실패
 * 메시지도 같은 함수를 쓰므로, 여기서 나오는 목록과 `pnpm data:build` 가 막는
 * 목록은 항상 같은 계산에서 나온다(우연한 일치가 아니다).
 */
export function runDeadCommand(data: GameData): string {
  const dead = findDeadDialogueRules(data.dialogue)
  if (dead.length === 0) {
    return '죽은 대사 없음 — 조건끼리 모순돼 어떤 상황에서도 나오지 않는 규칙이 없다.'
  }

  const lines = [`죽은 대사 ${dead.length}건 — 조건끼리 서로 모순돼 어떤 상황에서도 나오지 않는다:`, '']
  for (const { rule, a, b } of dead) {
    lines.push(`  ${rule.speaker} ${dialogueLocation(rule.source.file, rule.source.line)}`)
    lines.push(`    조건 "${conditionText(a)}" 과 "${conditionText(b)}" 가 동시에 참일 수 없다`)
    lines.push(`    발화: ${rule.lines.map((l) => `"${l}"`).join(' / ')}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// waiting — 역방향 조회: 공급자 없는 사실에 걸려 잠든 대사
// ---------------------------------------------------------------------------

/**
 * collectDialogueNotices(validate.ts)를 그대로 부른다 — `pnpm data:build` 가
 * 찍는 "안내" 줄과 이 명령이 다른 목록을 보여주면 둘 중 하나가 버그다. 같은
 * 함수를 호출하는 것으로 그 가능성 자체를 없앤다.
 */
export function runWaitingCommand(data: GameData): string {
  const notices = collectDialogueNotices(data)
  if (notices.length === 0) {
    return '잠들어 있는 대사 없음 — 조건에 쓰인 모든 사실에 공급자가 있다.'
  }
  return ['공급자가 아직 없는 사실에 걸려 잠든 대사:', ...notices.map((n) => `  - ${n}`)].join('\n')
}

// ---------------------------------------------------------------------------
// 실행부 — tsx src/content-cli.ts 로 직접 실행될 때만 동작한다
// ---------------------------------------------------------------------------

function main(): void {
  let command: ContentCommand
  try {
    command = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

  const data = loadGameData()

  try {
    if (command.kind === 'facts') {
      console.log(runFactsCommand(data))
    } else if (command.kind === 'dead') {
      console.log(runDeadCommand(data))
    } else if (command.kind === 'waiting') {
      console.log(runWaitingCommand(data))
    } else {
      const opts = { now: Date.now(), seed: SIMULATOR_SEED }
      console.log(runDialogueCommand(data, command.speaker, command.overrides, opts))
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}

// tsx 로 이 파일을 직접 실행했을 때만 main() 을 돌린다. content-cli.test.ts 가
// 이 모듈을 import 만 하고 실행하지는 않아야 하므로(그러면 매 테스트마다
// process.argv 를 파싱하려 들어 깨진다), import.meta.url 이 실행된 스크립트
// 자신을 가리킬 때만 참이 되는 이 비교로 "직접 실행"을 가른다.
// file:// URL 비교는 pathToFileURL 을 거쳐야 한다 — Windows 경로(백슬래시,
// 드라이브 문자)를 문자열로 그냥 이어 붙이면 URL 인코딩이 달라 항상
// 거짓이 된다.
const isMainModule = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
})()

if (isMainModule) main()
