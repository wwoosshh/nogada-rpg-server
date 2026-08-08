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
import type { Condition, DialogueHistory, DialogueRule, Facts, FactValue, GameData } from '@nogada/shared'
import {
  DECLARED_FACTS,
  EVENT_ORDER,
  ONCE_EVENTS,
  buildFacts,
  createRng,
  describeFactValueShape,
  emptyDialogueHistory,
  findFactSpec,
  matchesCondition,
  onceKey,
  ruleMatches,
  selectDialogue,
} from '@nogada/shared'
import { coerceFactValue, dialogueLocation } from './dialogueParse.js'
import { emptyPlayer } from './emptyPlayer.js'
import { collectDialogueNotices, conditionText, factReferenceError, findDeadDialogueRules } from './validate.js'
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
 * **이 도구는 빌드보다 무르면 안 된다.** 그래서 세 가지를 빌드와 같은 코드로
 * 검사한다:
 *
 * 1. 이름 — findFactSpec. 빌드가 조건의 오타를 잡는 것과 같은 검사이자 같은
 *    이유다(설계 문서 6.3). `speaker` 는 이 목록에 없으므로(selectDialogue 가
 *    별도 매개변수로 받는다) 여기로 주면 오타와 똑같이 막힌다 — 의도한 동작이다.
 * 2. 값의 모양 — 사실이 선언한 모양(FactSpec.value)대로 해석한다. 모양을
 *    글자에서 추측하면 `--season=3` 이 숫자 season 을, `--hour=아침` 이 문자열
 *    hour 를 만들어 낸다. 그런 사실은 어떤 조건과도 안 맞는데(matchesCondition
 *    은 타입이 다르면 거짓이다) 도구는 "규칙 없음" 이라고 자신 있게 답한다 —
 *    작가에게는 자기 입력이 원인이었다는 신호가 없다.
 * 3. 가리키는 것 — factReferenceError(validate.ts). 빌드가 `.dlg` 조건에서
 *    막는 `skill.zzz`·`milestone.없는것` 을 여기서 받아 주면, 작가는 빌드가
 *    절대 허락하지 않을 세계 상태로 대사를 확인하게 된다.
 *
 * 거절할 때는 빌드와 같은 친절로 거절한다 — 무엇을 줬는지, 무엇이면 되는지,
 * 어디를 보면 되는지.
 */
export function parseFactOverrides(args: readonly string[], data: GameData): Facts {
  const facts: Record<string, FactValue> = {}
  for (const arg of args) {
    if (!arg.startsWith('--')) {
      throw new Error(`"${arg}" 를 이해할 수 없다 — --사실=값 형식으로 쓴다 (예: --skill.ice=15000)`)
    }
    const body = arg.slice(2)
    const eq = body.indexOf('=')
    // `--weather` 처럼 = 가 없는 것과 `--weather=` 처럼 = 뒤가 빈 것을 같이 막는다.
    // 빈 값을 빈 문자열로 받아 두면 그 사실은 어떤 조건과도 안 맞으면서 표에는
    // "준 사실: weather=" 로 찍혀, 준 것처럼 보이는데 안 맞는 상태가 된다.
    if (eq < 0 || eq === body.length - 1) {
      throw new Error(`"${arg}" 에 값이 없다 — --사실=값 형식으로 쓴다 (예: --weather=rain)`)
    }
    const fact = body.slice(0, eq)
    const raw = body.slice(eq + 1)

    const spec = findFactSpec(fact)
    if (!spec) {
      throw new Error(
        `선언되지 않은 사실 "${fact}" 다 — 쓸 수 있는 사실은 packages/data/dialogue/README.md 의 표를 본다`,
      )
    }

    const value = coerceFactValue(spec.value, raw)
    if (value === undefined) {
      throw new Error(
        `"${arg}" 인자를 쓸 수 없다 — ${fact} 사실은 ${describeFactValueShape(spec.value)}. ` +
          '사실마다 쓸 수 있는 값은 packages/data/dialogue/README.md 의 사실 표에 있다',
      )
    }

    const reference = factReferenceError(fact, value, data)
    if (reference) {
      throw new Error(`"${arg}" 인자를 쓸 수 없다 — ${reference.reason}. ${reference.allowed}`)
    }

    facts[fact] = value
  }
  return facts
}

/**
 * process.argv.slice(2) 를 받아 네 명령 중 하나로 해석한다.
 *
 * `data` 가 필요한 것은 `--사실=값` 이 가리키는 이정표·기술이 실재하는지까지
 * 보기 때문이다 — 그 목록은 코드가 아니라 데이터에 있다.
 */
export function parseArgs(argv: readonly string[], data: GameData): ContentCommand {
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
    return { kind: 'dialogue', speaker, overrides: parseFactOverrides(factArgs, data) }
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
 * 여기서 사실을 직접 만들지 않는다. 서버가 대화를 판정할 때 쓰는 공급자
 * (`buildFacts`, packages/shared)를 빈 플레이어로 부를 뿐이다 — 이 도구의
 * 값어치는 "실제로 돌아가는 게임에서 무슨 말이 나오는가"를 보여주는 것이고,
 * 사실을 따로 만들면 언젠가 그 둘이 갈라져 도구가 자기만의 세계를 설명하게
 * 된다.
 *
 * 빈 플레이어에게는 `justAchieved`(방금 넘긴 문턱)와 `daysSinceLastTalk`
 * (마지막 대화로부터 며칠)가 없다 — 방금 아무것도 안 넘겼고, 애초에 마지막
 * 대화 자체가 없는 사람에게는 값을 매길 수 없다. 공급자도 같은 이유로 그
 * 둘을 넣지 않는다. matchesCondition 은 없는 사실을 항상 거짓으로 보므로, 이
 * 두 사실을 조건으로 건 규칙은 명시적으로 --사실=값 을 주기 전까지 자연히
 * 안 나온다 — 그게 "빈 플레이어"의 정확한 의미다.
 */
function defaultFacts(data: GameData, speaker: string, nowMs: number): Facts {
  return buildFacts({ speaker, player: emptyPlayer(), milestones: data.milestones, nowMs })
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

/**
 * 사건 서열 표의 한 줄이 말하는 것.
 *
 * 문장을 만들 때가 아니라 여기서 경우를 나누는 것이 중요하다. 예전에는 표의
 * 각 줄을 그 자리에서 문자열로 지었는데, "채택된 사건이 없다"(selection 이
 * null)는 경우가 어느 갈래에도 없어서 `undefined 사건이 상위라` 라는 말이
 * 그대로 찍혔다 — 아무것도 채택되지 않았다는 사실과 앞뒤가 맞지 않는 문장이
 * 작가 앞에 나갔다. 상태를 타입으로 못박아 두면 그런 문장을 만들 자리가 없다.
 */
type EventScan =
  /** 이 사건이 채택됐다. */
  | { kind: 'adopted'; matched: number }
  /** 화자가 이 사건에 규칙을 하나도 쓰지 않았다. */
  | { kind: 'noRules' }
  /** 규칙은 있는데 조건이 하나도 안 맞았다 — "규칙 없음"과 정반대의 진단이다. */
  | { kind: 'noneMatched'; ruleCount: number }
  /** once 사건이라 맞은 규칙이 전부 "이미 말한 것"이었다. */
  | { kind: 'allSaid'; matched: number }
  /** 상위 사건이 먼저 채택돼 selectDialogue 가 아예 훑지 않았다. */
  | { kind: 'notWalked'; wouldMatch: number; adopted: string }

/**
 * 사건마다 표의 한 줄이 무엇을 말할지 정한다.
 *
 * trace 는 selectDialogue 가 실제로 훑은 사건만 담고, **채택이 없으면(null)
 * 아예 없다.** 그 두 경우에 이 도구가 직접 ruleMatches 를 불러 채워 넣는다 —
 * 새 판정을 만드는 것이 아니라 엔진이 쓰는 그 함수를 그대로 다시 부를 뿐이다.
 */
function scanEvents(
  speakerRules: readonly DialogueRule[],
  facts: Facts,
  walked: ReadonlyMap<string, number>,
  adoptedEvent: string | undefined,
): Map<string, EventScan> {
  const scans = new Map<string, EventScan>()
  for (const event of EVENT_ORDER) {
    const rules = speakerRules.filter((r) => r.event === event)

    if (event === adoptedEvent) {
      scans.set(event, { kind: 'adopted', matched: walked.get(event) ?? 0 })
      continue
    }

    // 채택된 사건이 있고 이 사건이 trace 에 없다면, 순서가 뒤라 평가 자체를
    // 안 한 것이다(원인 b). 채택된 사건이 아예 없으면 selectDialogue 는 네
    // 사건을 전부 훑었으므로 이 갈래로 오지 않는다.
    if (adoptedEvent !== undefined && !walked.has(event)) {
      const wouldMatch = rules.filter((r) => ruleMatches(r, facts)).length
      scans.set(event, { kind: 'notWalked', wouldMatch, adopted: adoptedEvent })
      continue
    }

    const matched = walked.get(event) ?? rules.filter((r) => ruleMatches(r, facts)).length
    if (matched > 0) scans.set(event, { kind: 'allSaid', matched })
    else if (rules.length === 0) scans.set(event, { kind: 'noRules' })
    else scans.set(event, { kind: 'noneMatched', ruleCount: rules.length })
  }
  return scans
}

function renderEventScan(event: string, scan: EventScan): string {
  switch (scan.kind) {
    case 'adopted':
      return `← 채택 (조건 맞는 규칙 ${scan.matched}개)`
    case 'noRules':
      return `규칙 없음 — 이 화자는 ${event} 규칙을 쓰지 않았다`
    case 'noneMatched':
      // "규칙 없음"과 이 줄을 한 문장으로 뭉뚱그리면 안 된다: 앞은 "이 화자에게
      // 이런 대사를 써 준 적이 없다", 뒤는 "써 둔 대사의 조건이 지금 안 맞는다"
      // 이고, 작가가 가야 할 곳이 서로 다르다. 어느 조건이 어긋났는지는 표
      // 안에 우겨넣지 않고 아래 전용 절에서 규칙별로 짚는다 — 표는 사건 네
      // 줄로 한눈에 읽히는 것이 값어치라, 여기서 규칙마다 몇 줄씩 불어나면
      // 그 성질을 잃는다.
      return `규칙 ${scan.ruleCount}개가 있지만 조건이 하나도 안 맞음 — 아래 "조건이 안 맞은 규칙" 참고`
    case 'allSaid':
      return `조건은 맞지만 전부 이미 말해 다음 사건으로 넘어감 (규칙 ${scan.matched}개)`
    case 'notWalked':
      // "${adopted} 가/이"처럼 영문 식별자에 조사를 직접 붙이면 받침 유무에
      // 따라 문법이 어긋난다(story·quest 뒤엔 "가", milestone 뒤엔 "이") — 고정된
      // 한국어 명사 "사건"을 사이에 끼워 조사를 그 명사에 붙이면 event 값과
      // 무관하게 항상 맞는다.
      return scan.wouldMatch === 0
        ? `평가 안 함 — ${scan.adopted} 사건이 상위라 순서상 확인하지 않음`
        : `평가 안 함 — 조건 맞는 규칙 ${scan.wouldMatch}개가 있었지만 ${scan.adopted} 사건이 상위라 순서상 못 나옴`
  }
}

/**
 * 조건 하나가 왜 안 맞았는지를 지금 세계 상태에 비춰 말한다.
 *
 * "값이 없다"를 두 가지로 나누는 것이 이 함수의 값어치다. 공급자가 없는
 * 사실(weather 등)은 실제 게임에서도 안 맞으므로 작가가 할 일이 없고(빌드의
 * "안내"와 같은 원인), 공급자가 있는데 이번에 안 준 사실은 인자 하나만 더
 * 주면 바로 확인된다 — 같은 "없다"가 정반대의 할 일을 뜻한다.
 */
function conditionFailure(condition: Condition, facts: Facts): string {
  const actual = facts[condition.fact]
  if (actual !== undefined) return `지금 ${condition.fact}=${actual} 이다`
  if (findFactSpec(condition.fact)?.supplied === false) {
    return `${condition.fact} 에 값이 없다. 이 사실을 채워 주는 곳이 아직 없다 — 그 스펙이 생기기 전까지 이 조건은 어떤 값으로도 맞지 않는다`
  }
  return `${condition.fact} 에 값이 없다. 이번에 주지 않았다 — --${condition.fact}=값 으로 준다`
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
 *   - 채택된 사건보다 앞선 사건: 규칙이 아예 없거나(noRules), 규칙은 있는데
 *     조건이 안 맞았다(noneMatched, 원인 a). 이 둘을 "규칙 없음" 하나로
 *     뭉뚱그리지 않는 것이 중요하다 — 작가가 갈 곳이 서로 다르다.
 *   - 채택된 사건보다 뒤(더 낮은 우선순위): 맞았어도 상위 사건이 먼저
 *     채택돼 애초에 평가되지 않았다(원인 b) — 이건 selectDialogue 의 trace
 *     에 없는 정보라 ruleMatches 를 직접 한 번 더 불러서 확인한다
 *   - 채택된 사건 안: 승자가 아니면 조건 개수 부족·동점 탈락·이미 말함 중
 *     하나다(원인 c) — classifyMatchedRules 가 가른다
 *
 * 마지막에 "조건이 안 맞은 규칙" 절이 붙어 원인 a 를 규칙·조건 단위까지
 * 내려서 짚는다(무엇이 어긋났고 그 사실이 지금 무엇인가).
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

  const facts: Facts = { ...defaultFacts(data, speakerId, opts.now), ...overrides }
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
  const walked = new Map(trace.map((entry) => [entry.event, entry.matched.length] as const))
  const scans = scanEvents(speakerRules, facts, walked, adoptedEvent)

  out.push('사건 서열을 훑는다:')
  const maxEventLen = Math.max(...EVENT_ORDER.map((e) => e.length))
  for (const event of EVENT_ORDER) {
    const scan = scans.get(event)
    if (!scan) continue // EVENT_ORDER 로 만든 map 이라 항상 있다 — 방어적 스킵일 뿐.
    out.push(`  ${event.padEnd(maxEventLen + 2)}${renderEventScan(event, scan)}`)
  }
  out.push('')

  if (!selection) {
    out.push('말을 걸어도 지금은 할 말이 없다 — 어떤 사건에도 조건이 맞는 규칙이 없다.')
  } else {
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
  }

  // "조건이 안 맞았다"는 표에서 사건 한 줄로만 보인다. 작가가 바로 이어서 묻는
  // 것은 언제나 "그래서 어느 조건이 어긋났나"다 — 답을 표 안에 우겨넣으면 네
  // 줄짜리 서열표가 규칙 수만큼 불어나 한눈에 안 읽히므로, 답(출력) 바로
  // 아래에 따로 붙인다. 훑지 않은 사건(원인 b)의 규칙은 여기 넣지 않는다:
  // 그것들이 안 나온 이유는 조건이 아니라 서열이고, 표가 이미 그렇게 말했다.
  const unmatched = EVENT_ORDER.flatMap((event) => {
    if (scans.get(event)?.kind === 'notWalked') return []
    return speakerRules.filter((r) => r.event === event && !ruleMatches(r, facts))
  })
  if (unmatched.length > 0) {
    out.push('')
    out.push('조건이 안 맞은 규칙 — 무엇이 어긋났나:')
    for (const rule of unmatched) {
      out.push(`  ${rule.event}  ${dialogueLocation(rule.source.file, rule.source.line)}`)
      for (const condition of rule.conditions) {
        if (matchesCondition(condition, facts)) continue // 맞은 조건까지 나열하면 어긋난 것이 묻힌다
        out.push(`    ${conditionText(condition)} — ${conditionFailure(condition, facts)}`)
      }
    }
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
  // 인자 해석보다 데이터 로드가 먼저다 — `--사실=값` 이 가리키는 이정표·기술이
  // 실재하는지까지 보려면 그 목록이 필요하다. loadGameData 는 import 된 JSON 을
  // 그대로 돌려주므로 이 순서 때문에 치르는 비용이 없다.
  const data = loadGameData()

  let command: ContentCommand
  try {
    command = parseArgs(process.argv.slice(2), data)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
    return
  }

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
