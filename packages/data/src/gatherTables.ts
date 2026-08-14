import type {
  GameData,
  GatherBracketDef,
  GatherTableDef,
  GatherTables,
  GatherTierDef,
  NodeVariant,
  SkillId,
  TransitionDef,
} from '@nogada/shared'
import { NODE_VARIANTS, gatherBracketFor } from '@nogada/shared'
import { goldPerMinute, measureHand, tierChances } from './gatherMeasure.js'
import { addUnique, optionalCell, requireCell, toInt, toSkillId } from './parse.js'

type Row = Record<string, string>

/**
 * 브라켓 CSV 의 누적 칸 이름. 일곱 개인 것은 가장 긴 사다리(허브·광물 7단)에
 * 맞춘 것이다 — 짧은 사다리는 오른쪽 칸을 비워 둔다(설계 §7-앞 3).
 */
const CUM_COLUMNS = ['cum1', 'cum2', 'cum3', 'cum4', 'cum5', 'cum6', 'cum7'] as const

/** roll 의 정의역 상한. roll = floor(rng × 100001) ∈ 0~100000 이다(설계 §2). */
const ROLL_MAX = 100000

/** `equity` 칸에 적는 유일한 값. 숫자가 아니라 표시라 1 하나뿐이다. */
const EQUITY_MARK = '1'

/**
 * 심층 표의 id 접미사 — **`nodes.csv` 의 `variant=deep` 과 짝을 이루는 유일한 표시**다.
 *
 * 표에 "심층인가" 칸을 따로 두지 않는 이유: 그 칸과 노드의 variant 가 갈라지는
 * 날이 오고, 갈라져도 어느 화면 하나 이상해지지 않는다 — 마커는 심층 색으로
 * 그려지고 표는 바깥을 굴린다. 그것이 이 아크가 고치러 온 상태 그 자체다
 * (설계 계기 둘: "심층 노드가 이름과 색으로만 심층이다"). id 하나가 두 사실을
 * 지면 `validateGameData` 가 그 짝을 한 줄로 강제할 수 있다.
 */
export const DEEP_TABLE_SUFFIX = '_deep'

/** 특수 표의 id 접미사 — `variant=special` 과 짝을 이룬다. 이유는 심층과 같다. */
export const SPECIAL_TABLE_SUFFIX = '_special'

/**
 * 등급 → 접미사. **이 저장소에서 등급과 접미사를 잇는 유일한 자리다.**
 *
 * `Record<NodeVariant, string>` 인 것이 검사의 절반이다 — 등급이 넷째로 늘어나면
 * 이 객체가 컴파일 단계에서 빨개진다. 나머지 절반(되읽기가 왕복하는가, 접미사가
 * 서로 다른가, 다른 파일이 접미사를 따로 적지 않았는가)은 gatherTables.test.ts 가
 * 문다. 둘을 잇는 자리가 여럿이 되면 갈라지고, **갈라져도 어느 화면 하나
 * 이상해지지 않는다** — 확률표는 서버 전용이라 사람이 눈으로 대조할 곳조차 없다.
 *
 * `normal` 이 빈 문자열인 것에 뜻이 있다: 바깥 표의 정의가 "심층이 아닌 표"가
 * 아니라 **"접미사가 없는 표"** 라는 것. 옛 정의는 `ice_special` 이 서는 순간
 * `ice` 의 짝을 둘로 만들어 심층 검증 다섯을 한꺼번에 껐다.
 */
const SUFFIX_BY_VARIANT: Record<NodeVariant, string> = {
  normal: '',
  deep: DEEP_TABLE_SUFFIX,
  special: SPECIAL_TABLE_SUFFIX,
}

/** 그 등급의 표 id 가 져야 하는 접미사. 바깥(normal)은 빈 문자열이다. */
export function suffixOfVariant(variant: NodeVariant): string {
  return SUFFIX_BY_VARIANT[variant]
}

/**
 * 그 표 id 가 말하는 등급. 접미사가 붙은 것부터 보고, 남는 것이 바깥이다.
 *
 * 순서가 뜻을 가진다 — 접미사끼리 겹치면(예: `_deep` 과 `_x_deep`) 먼저 보는 쪽이
 * 이긴다. 겹치지 않는다는 것은 테스트가 등급 전수 왕복으로 문다.
 */
export function variantOfTableId(tableId: string): NodeVariant {
  for (const variant of NODE_VARIANTS) {
    const suffix = suffixOfVariant(variant)
    if (suffix !== '' && tableId.endsWith(suffix)) return variant
  }
  return 'normal'
}

/** 그 표 id 가 결계 뒤의 표인가. `validateGameData` 의 노드 검사도 이 술어를 부른다. */
export function isDeepTableId(tableId: string): boolean {
  return variantOfTableId(tableId) === 'deep'
}

/**
 * 그 표 id 가 조건이 열릴 때만 굴려지는 특수 표인가.
 *
 * 도감의 칸 유도가 `!table.equity` 가 아니라 이 술어로 좁혀야 하는 자리다
 * (설계 §6-5): `equity` 는 "형평을 재는 대표 표"라는 뜻이라 심층도 false 이고,
 * 그것으로 좁히면 `ice.equity=false` 같은 고장 상태가 "얼음 조각은 채집물이
 * 아니다"로 번진다.
 */
export function isSpecialTableId(tableId: string): boolean {
  return variantOfTableId(tableId) === 'special'
}

/**
 * 심층이 그 브라켓에서 져야 하는 분당 산출 배수(설계 §4·§9-앞 6).
 *
 * **최상위 티어 배수가 아니라 분당 산출인 이유**는 나무가 반증했다: 초안의
 * "심층 최상위 = 바깥의 20~25배"는 `wood,290000` 에서 tier2(나무 열매 3,200G)가
 * 이미 19% 라 회당 골드의 73% 를 지고 최상위(금빛 열매 6,500G)가 그 2.03배뿐이라,
 * 최상위만 22배로 올려도 나무는 ×1.16 인데 광물은 ×3.01 이 된다 — 같은 문인데
 * 계열마다 2.6배 불형평이다. 그래서 통제 변수를 분당 산출로 옮기고, 그 값을
 * 만드는 방법은 계열이 각자 정한다(나무는 최상위가 아니라 tier2 이하를 움직였다).
 */
export const DEEP_YIELD_TARGET = 2.5

/**
 * 목표 배수의 허용 폭. 넷이 이 안에 있으면 계열 간 격차가 최대 1.35배를 넘지 않는다.
 *
 * 출하 넷은 전부 2.500 에 붙어 있다(격차 1.0002배) — 이 대역은 표를 손보는
 * 사람에게 주는 여유이지 목표가 아니다.
 */
export const DEEP_YIELD_TOLERANCE = 0.15

/**
 * 심층 유한 브라켓의 최상위 티어 천장을 정하는 비율 — **바깥 ∞ 의 10%**(§9-앞 7).
 *
 * 초안의 불변식은 "심층 최상위가 바깥 ∞ 보다 흔하지 않다" 였는데, 그것은 얼음에서
 * 바깥 ≤150000 의 45 를 15,000 까지, 즉 **333배**까지 통과시킨다 — 자기가 막겠다는
 * 상태(결계 뒤가 잭팟 자판기가 되어 절벽이 줄 것을 잃는다)를 그대로 허용하는
 * 불변식이다. 죄는 값이어야 불변식이다.
 *
 * **실제 천장은 이 비율이 아니라 `max(바깥 ∞ × 이 비율, 걸친 바깥 중 가장 인색한
 * 브라켓)` 이다** — 왜 max 인지도, 왜 하필 **가장 인색한** 것인지도
 * validateDeepTables 의 규칙 2 주석이 적는다(요약: max 인 것은 나무처럼 절벽이
 * 이미 지나간 브라켓에는 앞당길 것이 없어서이고, 인색한 쪽을 보는 것은 이 검사의
 * 부등호가 `심층 ≤ 바깥` 이라 후한 쪽과 견주면 천장이 그만큼 풀리기 때문이다 —
 * 바닥은 부등호가 반대라 정확히 반대편을 본다).
 */
export const DEEP_TOP_TIER_CEILING = 0.1

/**
 * 특수 표의 **천장** — 그 계열 바깥 표의 같은 구간보다 낮아야 한다(설계 §6-3).
 *
 * 이것을 안 걸면 특수 노드가 보통 노드를 지배해 **표 넷과 배치 32개가 그날 죽는다**
 * (설계 §7 실패 B). 아크 A 가 여덟 노드에 얼굴을 준 그 다음 아크가 그것을 죽이는
 * 모양이 된다.
 */
export const SPECIAL_YIELD_MAX = 1.0

/**
 * 특수 표의 **바닥** — 자기 분당 산출이 브라켓마다 최소 이만큼 오른다(설계 §6-3).
 *
 * **왜 바닥이 비가 아닌가.** 심층은 `DEEP_YIELD_TARGET ± TOLERANCE` 로 양쪽을
 * 같은 자(바깥 대비 비)로 죈다. 특수에 그 자를 쓰면 **어떤 값으로도 만족할 수
 * 없다** — 설계 §5 의 분 목표를 만족하는 얼음 특수 표를 구리손·브라켓 하한에서
 * 재면 비가 0.712 → 0.587 → 0.518 → 0.363 → 0.148 → **0.014** 로 내려가는데,
 * 마지막 계단이 ×0.09 인 것은 바깥 ∞ 가 한 칸에 **×11.4** 로 터지기 때문이다
 * (얼음의 보석이 15%). 비를 0.1 위로 유지하려면 뜨거운 얼음의 정가가 67만이
 * 되어야 하고, 그것은 "특수 노드는 골드가 아니라 열쇠를 판다"(설계 §4)를 정면으로
 * 뒤집는다.
 *
 * **그런데 같은 표의 자기 진행은 단조다**(1,958 → 3,560 → 5,062 → 6,769 →
 * 14,227 → 23,543, 계단마다 평균 ×1.7). 그래서 천장은 상대, 바닥은 절대다.
 *
 * 바닥이 없으면 천장 하나가 **×0.016 과 ×0.999 를 구별하지 않는다** — 폭 ×52.3 이
 * 전부 초록이고, 설계 §3 이 "계열마다 다른 사다리 모양"이라고 부른 조종간이
 * 통째로 검증 밖에 있게 된다. 천장만 있던 시절의 대가는 이 파일이 이미 한 번
 * 적었다(위 DEEP_TOP_TIER_CEILING 주석).
 */
export const SPECIAL_YIELD_MIN_STEP = 1.2

/**
 * 그 계열 결계의 문턱들 — `transitions.csv` 의 `gateSkill`·`gateValue` 에서 **유도한다.**
 *
 * **문이 생겼다.** 이 자리에는 `DEEP_MEASURE_PROFICIENCY = 85_001` 이 상수로 살았고,
 * 그 주석이 스스로 약속했다 — "85,000 은 B4 가 `transitions.csv` 의 `gateValue` 에
 * 적을 그 숫자다. 문이 생기면 이 값과 그 칸이 같은 숫자여야 한다." 문은 B4 에서
 * 생겼는데 **그 약속을 강제하는 것이 아무것도 없었다**: 얼음 결계의 `gateValue` 를
 * 200,000 으로 올려도 빌드가 초록이었고, 그러면 ×2.5 를 재던 자리(85,001)가
 * **문이 안 열리는 구간**이 된다 — 검증이 아무도 못 서는 자리를 재게 된다.
 *
 * 구리 손인 이유는 그대로다: 1티어는 시작 지급이라 문 앞에 선 사람이 최소한 들고
 * 있는 손이고, 배수 1.0 이라 roll 이 접히지도 늘어나지도 않아 표의 수치가 그대로
 * 확률이 된다 — 작가가 CSV 를 보며 검산할 수 있는 유일한 손이다.
 *
 * **계열마다 다를 수 있으므로 값 하나가 아니라 목록을 돌려준다.** 비어 있는 것과
 * 둘 이상인 것은 서로 다른 위반이고, 그 문장은 부르는 쪽이 자기 자리에서 쓴다.
 */
export function barrierGateValues(transitions: readonly TransitionDef[], skill: SkillId): number[] {
  const values = new Set<number>()
  for (const t of transitions) {
    if (t.gateSkill === skill && t.gateValue !== undefined) values.add(t.gateValue)
  }
  return [...values].sort((a, b) => a - b)
}

/** 배수·골드를 메시지에 적는 꼴 — 작가가 목표와 눈으로 견줄 수 있게. */
const goldText = (gold: number): string => `${Math.round(gold).toLocaleString('ko-KR')}G`
const percentText = (chance: number): string => `${(chance * 100).toFixed(3)}%`
const timesText = (ratio: number): string => `${ratio.toFixed(2)}배`

/**
 * `equity` 칸을 읽는다 — 빈 칸은 아니다, `"1"` 은 맞다, 나머지는 던진다.
 *
 * 왜 다른 값을 조용히 false 로 접지 않는가: 이 칸은 수집의 방 형평·조기도달
 * 검증이 **계열의 25칸을 어느 표로 재는가**를 정한다(결계 §9-앞 1·2).
 * `true`·`y`·`O` 를 적은 작가는 대표 표를 골랐다고 믿는데, 접어 버리면 그
 * 계열은 재는 표가 없어져 검증 자체가 사라진다 — 그 어긋남은 빌드 로그
 * 어디에도 흔적을 안 남긴다. nodes.csv 의 variant 오타를 파싱 단계에서
 * 던지는 것과 같은 자리다.
 */
function toEquity(raw: string | undefined, ctx: string): boolean {
  if (raw === undefined) return false
  if (raw !== EQUITY_MARK) {
    throw new Error(
      `${ctx}: equity "${raw}" 는 알 수 없다 — 계열의 대표 표 한 줄에만 "${EQUITY_MARK}" 을 적고 나머지는 비운다`,
    )
  }
  return true
}

/**
 * 표 셋(메타·사다리·브라켓)을 GatherTables 하나로 조립한다.
 *
 * 왜 CSV 가 셋인가: 한 줄=(표,브라켓,티어)의 세로 단조 수열 162행은 사람이 못
 * 다룬다(설계 §7-앞 3). 사다리와 브라켓을 나누면 브라켓 CSV 한 행이 원작 덤프의
 * 브라켓 블록 하나와 1:1 로 눈 대조가 된다.
 *
 * 여기서 던지는 것은 "조립 자체가 안 되는" 구조 오류다 — 없는 표를 가리키는 행,
 * 번호가 뛴 티어, 중간이 빈 누적 칸. 조립은 되지만 뜻이 어긋나는 것(순증가 위반,
 * ∞ 브라켓 규칙 등)은 validateGatherTables 가 목록으로 모아 보고한다 — 작가가
 * 한 번의 빌드에서 오류 전부를 보게 하기 위해서다.
 */
export function parseGatherTables(metaRows: Row[], tierRows: Row[], bracketRows: Row[]): GatherTables {
  const out: GatherTables = {}

  for (const row of metaRows) {
    const id = requireCell(row, 'tableId', 'gather_tables.csv')
    const ctx = `gather_tables.csv[${id}]`
    const def: GatherTableDef = {
      id,
      skill: toSkillId(requireCell(row, 'skill', ctx), ctx),
      skillGainMin: toInt(requireCell(row, 'skillGainMin', ctx), ctx, 'skillGainMin'),
      skillGainMax: toInt(requireCell(row, 'skillGainMax', ctx), ctx, 'skillGainMax'),
      equity: toEquity(optionalCell(row, 'equity'), ctx),
      tiers: [],
      brackets: [],
    }
    addUnique(out, id, def, 'gather_tables.csv')
  }

  for (const row of tierRows) {
    const tableId = requireCell(row, 'tableId', 'gather_tiers.csv')
    const table = out[tableId]
    if (!table) {
      throw new Error(`gather_tiers.csv[${tableId}]: 존재하지 않는 표를 가리킨다 — gather_tables.csv 에 먼저 적는다`)
    }
    const ctx = `gather_tiers.csv[${tableId}]`
    // tier 번호는 자료에 남기지 않고 순서 검증에만 쓴다 — tiers 배열의 자리가
    // 곧 티어(희귀→흔함)이고, 번호를 따로 실으면 자리와 번호가 갈라질 수 있다.
    const tier = toInt(requireCell(row, 'tier', ctx), ctx, 'tier')
    const expected = table.tiers.length + 1
    if (tier !== expected) {
      throw new Error(`${ctx}: tier ${expected} 자리에 ${tier} 이 왔다 — 1부터 빈틈없이 오름차순이어야 한다`)
    }
    const itemId = requireCell(row, 'itemId', ctx)
    if (table.tiers.some((t) => t.itemId === itemId)) {
      throw new Error(`${ctx}: 아이템 "${itemId}" 이 한 표에 두 번 있다`)
    }
    const tierDef: GatherTierDef = { itemId }
    table.tiers.push(tierDef)
  }

  for (const row of bracketRows) {
    const tableId = requireCell(row, 'tableId', 'gather_brackets.csv')
    const table = out[tableId]
    if (!table) {
      throw new Error(
        `gather_brackets.csv[${tableId}]: 존재하지 않는 표를 가리킨다 — gather_tables.csv 에 먼저 적는다`,
      )
    }
    const ctx = `gather_brackets.csv[${tableId}]`
    const rawMax = optionalCell(row, 'bracketMax')
    const bracketMax = rawMax === undefined ? null : toInt(rawMax, ctx, 'bracketMax')

    // 누적 칸은 왼쪽부터 채운다. 중간이 비면 그 뒤 값이 어느 티어의 것인지
    // 자리 짝이 어긋나므로 조립 단계에서 세운다.
    const cumulative: number[] = []
    let sawEmpty: (typeof CUM_COLUMNS)[number] | null = null
    for (const column of CUM_COLUMNS) {
      const raw = optionalCell(row, column)
      if (raw === undefined) {
        sawEmpty = sawEmpty ?? column
        continue
      }
      if (sawEmpty) {
        throw new Error(`${ctx}: ${sawEmpty} 가 비어 있는데 ${column} 가 차 있다 — 빈 칸은 오른쪽 끝에만 온다`)
      }
      // 0 을 허용한다(min 0) — cum1=0 은 "최상 티어가 사실상 없다" 로 경고
      // 대상이지 조립 불능이 아니다(validateGatherTables 의 잭팟 경고).
      cumulative.push(toInt(raw, ctx, column, 0))
    }
    const bracket: GatherBracketDef = { bracketMax, cumulative }
    table.brackets.push(bracket)
  }

  for (const table of Object.values(out)) {
    if (table.tiers.length === 0) {
      throw new Error(`gather_tables.csv[${table.id}]: 티어가 한 줄도 없다 — gather_tiers.csv 에 사다리를 적는다`)
    }
    if (table.brackets.length === 0) {
      throw new Error(`gather_tables.csv[${table.id}]: 브라켓이 한 줄도 없다 — gather_brackets.csv 에 적는다`)
    }
  }

  return out
}

/** 브라켓을 메시지에서 부르는 이름 — 작가가 CSV 에서 눈으로 찾는 열쇠는 상한값이다. */
function bracketLabel(bracket: GatherBracketDef): string {
  return bracket.bracketMax === null ? '∞' : `≤${bracket.bracketMax}`
}

/** ∞ 브라켓이 마지막에 정확히 하나 있는가. 아니면 위쪽 검사가 이미 말했으니 심층 검사는 묻지 않는다. */
function hasFinalInfinite(table: GatherTableDef): boolean {
  return table.brackets.at(-1)?.bracketMax === null
}

/**
 * 브라켓 하나가 **실제로 걸리는 숙련 구간** `[lo, hi]`.
 *
 * `gatherBracketFor` 의 규칙("첫 `bracketMax ≥ 숙련`")을 구간으로 되읽은 것이다.
 * 심층 검사가 이것을 필요로 하는 이유는 아래 `spansOf` 주석이 적는다 — 두 표의
 * 브라켓 경계가 어긋나면 "같은 자리"라는 말 자체가 성립하지 않기 때문이다.
 */
interface BracketRange {
  bracket: GatherBracketDef
  lo: number
  hi: number
}

function bracketRanges(table: GatherTableDef): BracketRange[] {
  const ranges: BracketRange[] = []
  let lo = 0
  for (const bracket of table.brackets) {
    const hi = bracket.bracketMax ?? Number.MAX_SAFE_INTEGER
    ranges.push({ bracket, lo, hi })
    lo = hi + 1
  }
  // 상한이 오름차순이 아닌 표에서는 `lo > hi` 인 빈 구간이 생긴다 — 그 표는 위쪽
  // 검사(브라켓 상한 오름차순)가 이미 말했으므로 여기서 또 말하지 않는다. 빈
  // 구간은 아무것과도 안 겹치므로 아래 검사들이 조용히 건너뛴다.
  return ranges
}

/** 그 숙련 구간에 걸치는 바깥 브라켓들 — 구간이 한 칸이라도 겹치면 걸친 것이다. */
function spansOf(outerRanges: readonly BracketRange[], deep: BracketRange): BracketRange[] {
  return outerRanges.filter((o) => o.lo <= o.hi && Math.max(o.lo, deep.lo) <= Math.min(o.hi, deep.hi))
}

/** 두 누적이 **글자 그대로** 같은가 — 같으면 그 구간의 분당 산출 비는 산술적으로 1.000 이다. */
function sameCumulative(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/**
 * 심층 표가 자기 계열 **바깥 표에 매여 있는지** 검사한다(결계 §9-앞 1·3·6·7).
 *
 * 다섯 가지를 묻는다. 다섯 다 "표 하나만 보면 온전한데 짝과 함께 보면 어긋나는"
 * 것이라, 표 안을 보는 위쪽 검사들과 나눠 둔다.
 *
 * 1. **∞ 는 바깥의 복사본이다.** 수집의 방 형평 검증은 표를 순회하며 같은 25칸
 *    문턱을 그 표의 ∞ 로 재는데(collection.ts), 오늘은 `equity` 칸이 심층 표를
 *    그 순회에서 빼 준다. 그 가림이 걷히는 날 — 누가 equity 를 옮기거나 대표 표
 *    규칙을 손보는 날 — 한 칸의 t4 가 두 표의 25~35분 대역을 동시에 만족해야 하는
 *    교착이 돌아온다(실측 허용창 0.84×~1.23×). ∞ 가 복사본인 한 그 교착은
 *    산술적으로 일어날 수 없다. **가림에 기대지 않고 성질로 막는다.**
 * 2. **유한 브라켓의 최상위에 천장이 있다.** 위 DEEP_TOP_TIER_CEILING 참고.
 * 3. **어느 티어에서도 바깥보다 드물지 않다**(바닥).
 * 4. **문이 열리는 자리에서 심층이 실제로 바깥과 갈라진다.**
 * 5. **바깥과 값이 다른 모든 구간에서 분당 산출이 목표 배수다.** 위 DEEP_YIELD_TARGET 참고.
 *
 * **2·3 과 5 가 "구간"으로 말하는 이유:** 두 표의 브라켓 경계가 어긋나면 심층
 * 브라켓 하나가 바깥 브라켓 **여럿**에 걸친다. 그러면 "같은 자리의 바깥 브라켓"
 * 이라는 말이 성립하지 않으므로, 검사마다 걸친 것들 중 무엇과 견줄지를 자기
 * 목적에 맞게 골라야 한다(2 는 가장 인색한 것, 3 은 가장 후한 것, 5 는 걸친 것
 * 전부). 그 선택을 한 문장으로 뭉뚱그렸던 것이 이 파일의 결함이었다.
 *
 * "유한 브라켓을 500,000 까지 깐다"(§9-앞 3)를 여기서 안 묻는 이유: 그것은 심층
 * 표만의 규칙이 아니라 **바깥과 같은 사다리 모양**이라는 더 큰 성질의 한 조각이고,
 * 형평 검증이 `유한 상한 최댓값 + 1` 로 간격을 재기 때문에 뜻이 생긴다 —
 * gatherTables.test.ts 가 출하 수치로 못박는다.
 */
function validateDeepTables(tables: GatherTables, data: GameData): string[] {
  const violations: string[] = []

  const outerBySkill = new Map<SkillId, GatherTableDef[]>()
  for (const table of Object.values(tables)) {
    // **바깥은 "심층이 아닌 표"가 아니라 "접미사가 없는 표"다.** 부정으로 적던
    // 시절에는 `ice_special` 이 서는 순간 `ice` 의 짝이 둘이 되고, 바로 아래
    // `candidates.length !== 1` 의 continue 가 ∞복사·천장·바닥·결계문·배수
    // **다섯을 한꺼번에** 건너뛴다 — 심층 검증 전체가 조용히 꺼지는데 꺼졌다는
    // 말은 어디에도 안 뜬다(위반은 짝짓기 실패 한 줄로만 남는다).
    if (variantOfTableId(table.id) !== 'normal') continue
    const list = outerBySkill.get(table.skill)
    if (list) list.push(table)
    else outerBySkill.set(table.skill, [table])
  }

  for (const deep of Object.values(tables)) {
    if (!isDeepTableId(deep.id)) continue
    const at = `gather[${deep.id}]`
    const candidates = outerBySkill.get(deep.skill) ?? []

    if (candidates.length !== 1) {
      violations.push(
        candidates.length === 0
          ? `${at}: 같은 계열(${deep.skill})의 바깥 표가 없다 — 심층 표는 바깥 표의 ∞ 를 복사하고 그 분당 산출의 ${DEEP_YIELD_TARGET}배를 져야 하므로 짝이 반드시 있어야 한다. gather_tables.csv 에 "${DEEP_TABLE_SUFFIX}" 이 아닌 ${deep.skill} 계열 표를 둔다`
          : `${at}: 같은 계열(${deep.skill})의 바깥 표가 [${candidates.map((t) => t.id).join(', ')}] ${candidates.length}개다 — 어느 것의 ∞ 를 복사하고 어느 것의 몇 배인지 정해지지 않는다. gather_tables.csv 에서 그 계열의 "${DEEP_TABLE_SUFFIX}" 아닌 표를 하나로 줄인다`,
      )
      continue
    }
    const outer = candidates[0]!

    // ∞ 가 없거나 마지막이 아닌 표는 위쪽 검사가 이미 말했다 — 그 위에서 "복사본인가"
    // 를 또 물으면 원인 하나가 위반 둘이 된다.
    if (!hasFinalInfinite(deep) || !hasFinalInfinite(outer)) continue
    const deepInfinite = deep.brackets.at(-1)!.cumulative
    const outerInfinite = outer.brackets.at(-1)!.cumulative

    // ---- 1. ∞ 는 바깥의 복사본이다 ----
    const tierName = (index: number): string => deep.tiers[index]?.itemId ?? outer.tiers[index]?.itemId ?? '(없는 티어)'
    for (let i = 0; i < Math.max(deepInfinite.length, outerInfinite.length); i++) {
      const mine = deepInfinite[i]
      const theirs = outerInfinite[i]
      if (mine === theirs) continue
      violations.push(
        `${at} ∞ 브라켓: 티어 ${i + 1}(${tierName(i)})의 누적이 ${mine ?? '(빈 칸)'} 인데 바깥 표 "${outer.id}" 의 ∞ 는 ${theirs ?? '(빈 칸)'} 이다 — 심층 ∞ 는 바깥 ∞ 의 복사본이어야 한다. 수집의 방 형평 검증은 표를 순회하며 같은 25칸 문턱을 그 표의 ∞ 로 재므로, 둘이 갈라지면 한 칸의 t4 가 두 표의 25~35분 대역을 동시에 만족해야 하는 교착이 된다. gather_brackets.csv 의 ${deep.id} ∞ 행을 ${outer.id} 의 ∞ 행과 같게 적는다`,
      )
    }

    // 두 표의 브라켓을 **숙련 구간으로** 늘어놓는다. 심층 브라켓 하나가 걸치는
    // 바깥 브라켓은 하나일 수도 여럿일 수도 있고, 아래 세 검사는 걸친 것들 중
    // **각자 다른 것**과 견준다.
    //
    // **왜 자가 하나가 아닌가.** 예전에는 `gatherBracketFor(outer, 상한)` 하나로
    // "같은 자리"를 뽑았고, 주석이 그 이유를 이렇게 적었다 — "심층 브라켓 하나가
    // 바깥 브라켓 여럿에 걸치는데, 그중 가장 좋은 것과 견주는 편이 아래 두
    // 검사(천장·바닥)를 무르지 않게 한다." **그 한 문장이 한 검사에는 맞고 다른
    // 검사에는 정확히 반대였다.** 바닥은 `심층 ≥ 바깥` 이라 후한 바깥과 견줄수록
    // 죄이지만, 천장은 `심층 ≤ 바깥` 이라 후한 바깥과 견주면 그만큼 **풀린다.**
    //
    // 풀린 채로 출하됐다: `wood_deep,290000` 행 하나를 지우고 `wood_deep,500000`
    // 의 cum2 만 손보면 심층 ≤500000 하나가 바깥 ≤290000·≤500000 **둘**에 걸치는데,
    // 천장이 후한 쪽(≤500000 의 15000)을 보므로 심층이 15000 을 그대로 지고도
    // 위반 0·경고 0 이다 — 숙련 100,000 에서 금빛 열매가 결계 안 15.001% vs 바깥
    // 0.101%, **149배**다. 나무의 절벽(290,001)이 값어치를 통째로 잃는다.
    const deepRanges = bracketRanges(deep)
    const outerRanges = bracketRanges(outer)

    // ---- 2. 유한 브라켓의 최상위 천장 ----
    //
    // 천장은 `max(바깥 ∞ 의 10%, 바깥 같은 자리 브라켓)` 이다. **max 인 것은
    // 천장이 느슨해진 것이 아니라 천장의 목적을 정확히 적은 것이다.**
    //
    // 이 천장이 막으려는 것은 하나뿐이다 — **절벽을 앞당기는 것**. ∞ 가 주기로
    // 되어 있는 잭팟을 심층이 미리 나눠 주면, 수백 분을 들여 닿은 절벽이 줄
    // 것을 잃는다. 그런데 **절벽이 이미 지나간 자리에는 앞당길 것이 없다.**
    // 나무가 그 자리다: 나무의 절벽은 500,001 이 아니라 290,001 이고
    // (`wood,500000` 행과 `wood,` 행이 바이트 단위로 같다 — §9-앞 8), 그래서
    // `wood,500000` 은 이미 ∞ 값이다. 거기에 ∞×10% 를 강제하면 심층이 바깥보다
    // **10.7배 드문** 표가 되어(금빛 열매 15% → 1.4%) 문 너머가 함정이 된다.
    // 골드는 같아도 수집의 방 칸은 그 자리에서 멀어진다.
    //
    // 즉 이 천장은 "바깥보다 얼마나 더 줄 수 있는가"의 상한이지 "얼마나 줄 수
    // 있는가"의 상한이 아니다. 바깥이 이미 주는 것을 심층이 못 주게 만드는
    // 순간, 천장은 아래 바닥 검사와 정면으로 부딪친다.
    //
    // **걸친 것 중에서는 가장 인색한 것(최상위 누적이 가장 작은 것)을 본다.**
    // 이 검사는 "그 구간의 **어느 숙련에서 보아도** 절벽을 앞당기지 않는다"를
    // 요구하므로, 걸친 바깥 브라켓 중 하나라도 아직 절벽 앞이면 그 자리가 기준이다.
    // 바닥(아래 3)이 정반대로 가장 후한 것을 보는 것과 짝이다 — 두 검사는 부등호
    // 방향이 반대라 보수적인 쪽도 반대편에 있다.
    const outerTop = outerInfinite[0]
    if (outerTop !== undefined) {
      const infiniteCeiling = Math.floor(outerTop * DEEP_TOP_TIER_CEILING)
      for (const range of deepRanges) {
        if (range.bracket.bracketMax === null) continue
        const spans = spansOf(outerRanges, range)
        if (spans.length === 0) continue
        const peer = spans.reduce((worst, s) =>
          (s.bracket.cumulative[0] ?? 0) < (worst.bracket.cumulative[0] ?? 0) ? s : worst,
        )
        const peerTop = peer.bracket.cumulative[0] ?? 0
        const ceiling = Math.max(infiniteCeiling, peerTop)
        const top = range.bracket.cumulative[0]
        if (top === undefined || top <= ceiling) continue
        // 걸친 것이 여럿이면 진짜 처방은 cum1 을 낮추는 것이 아니라 **경계를
        // 바깥과 맞추는 것**이다 — 그래야 구간마다 자기 천장을 갖는다.
        const straddle =
          spans.length > 1
            ? ` 이 브라켓 하나가 바깥 브라켓 ${spans.length}개(${spans.map((s) => bracketLabel(s.bracket)).join(', ')})에 걸쳐 있다 — gather_brackets.csv 의 ${deep.id} 에 bracketMax ${spans
                .slice(0, -1)
                .map((s) => s.hi)
                .join('·')} 행을 두어 바깥과 경계를 맞추면 구간마다 자기 천장을 갖는다.`
            : ''
        // 숫자 뒤에 조사·서술격을 직접 붙이면 자릿수에 따라 문법이 어긋나므로
        // (1500 은 "이다", 2 는 "다") 언제나 맞는 "까지다"·"이하"로 적는다.
        violations.push(
          `${at} 브라켓(${bracketLabel(range.bracket)}): 최상위 티어(${tierName(0)})의 누적이 ${top} 인데 천장은 ${ceiling} 까지다 — 바깥 표 "${outer.id}" 의 ∞ 누적 ${outerTop} 의 ${DEEP_TOP_TIER_CEILING * 100}%(${infiniteCeiling})와 이 구간(숙련 ${range.lo.toLocaleString('ko-KR')}~${range.hi.toLocaleString('ko-KR')})에 걸친 바깥 브라켓 중 가장 인색한 곳(${bracketLabel(peer.bracket)})의 ${peerTop} 중 큰 쪽이다. 넘으면 결계 뒤가 잭팟 자판기가 되어 절벽(∞)이 줄 것을 잃는다.${straddle} gather_brackets.csv 의 그 행 cum1 을 ${ceiling} 이하로 적는다`,
        )
      }
    }

    // ---- 3. 바닥: 심층의 **기대 골드**는 어느 브라켓에서도 바깥보다 나쁘지 않다 ----
    //
    // 천장만 있고 바닥이 없던 동안, `wood_deep ≤500000` 이 바깥의 15000 대신
    // 1400 을 지고도 빌드가 초록이었다 — 분당 산출은 ×1.00 이라 배수 검사도
    // 조용했다. **골드가 같아도 그 문은 함정이다**: 최상위 티어를 원하는 유일한
    // 이유는 수집의 방 칸인데, 154분을 들여 연 문 너머에서 그 칸이 10.7배 멀어진다.
    //
    // **이 검사가 실제로 보장하는 것.** 누적 i 는 "티어 i 이상으로 희귀한 것이
    // 나올 확률"이고, 사다리 값은 희귀→흔함 순으로 단조 감소한다(네 계열 전부
    // 그렇다 — 얼음 12000·1000·200·75·25 처럼). 그러면 회당 기대 매도가는
    // `Σ 누적_i × (값_i − 값_{i+1})` 로 다시 쓸 수 있고(아벨 합), 괄호가 전부 0
    // 이상이므로 **전 티어에서 심층 누적 ≥ 바깥 누적이면 기대 골드도 심층 ≥
    // 바깥이다.** 어느 희귀도 문턱에서 잘라 봐도 심층 쪽이 두껍다는 것도 같은
    // 말이다. 이것이 이 검사의 보장이다.
    //
    // **이 검사가 보장하지 않는 것 — 칸별로는 안 지켜진다.** 수집의 방은
    // 아이템(칸)별로 채워지는데, 누적 지배는 **칸별 확률 지배를 함의하지 않는다**:
    // 누적이 위로 올라가면 그 위 티어의 폭(= 그 칸이 나올 확률)이 줄 수 있기
    // 때문이다. 출하 데이터에서 이미 그렇다 — `herb_deep ≤500000` 의 흔한 약초는
    // 0.827% 인데 바깥은 32.435% 로 **39.2배 드물다**(`mineral_deep ≤500000` 은
    // 7티어 중 5개, `wood_deep ≤290000` 은 6티어 중 4개가 바깥보다 드물다).
    // 결계 뒤는 희귀 쪽으로 질량을 옮긴 표이지 "모든 칸이 더 잘 나오는" 표가
    // 아니다. **다음 사람이 "심층은 어느 칸에서도 나쁠 수 없다"고 믿으면 안 된다**
    // — 흔한 티어 하나를 채우러 결계에 들어가는 것은 손해이고, 그것을 막는 검사는
    // 이 저장소에 없다(막을 이유도 없다: 그 흔한 것은 결계 **밖**에 normal 노드
    // 8개가 그대로 있다 — 설계 §2, 어떤 아이템도 문 뒤로 사라지지 않는다).
    //
    // **걸친 것 중 가장 후한 바깥과 견준다** — 그 구간의 어느 숙련에서 보아도
    // 손해가 아니어야 하므로, 걸친 바깥 중 가장 잘 주는 자리가 기준이다.
    // 천장(위 2)이 정반대로 가장 인색한 것을 보는 것과 짝이다.
    //
    // ∞ 는 묻지 않는다 — 규칙 1 이 이미 글자 그대로 같기를 요구하므로, 여기서
    // 또 물으면 원인 하나가 위반 둘이 된다.
    for (const range of deepRanges) {
      if (range.bracket.bracketMax === null) continue
      const spans = spansOf(outerRanges, range)
      if (spans.length === 0) continue
      for (let i = 0; i < range.bracket.cumulative.length; i++) {
        const mine = range.bracket.cumulative[i]
        if (mine === undefined) continue
        const peer = spans.reduce((best, s) =>
          (s.bracket.cumulative[i] ?? -1) > (best.bracket.cumulative[i] ?? -1) ? s : best,
        )
        const theirs = peer.bracket.cumulative[i]
        if (theirs === undefined || mine >= theirs) continue
        const rarer = mine > 0 ? `${(theirs / mine).toFixed(1)}배 ` : ''
        violations.push(
          `${at} 브라켓(${bracketLabel(range.bracket)}): 티어 ${i + 1}(${tierName(i)})의 누적이 심층 ${mine} · 바깥 ${theirs} — 결계 너머가 ${rarer}드물다. 문을 연 사람이 어느 희귀도 문턱에서 잘라 봐도 손해를 보면(사다리 값이 희귀→흔함으로 단조 감소하므로 그때 기대 골드도 함께 진다) 그 문은 함정이고, 그것이 이 결계가 지우러 온 거짓말과 같은 종류다. gather_brackets.csv 의 ${deep.id} ${bracketLabel(range.bracket)} 행 cum${i + 1} 을 이 구간(숙련 ${range.lo.toLocaleString('ko-KR')}~${range.hi.toLocaleString('ko-KR')})에 걸친 바깥 브라켓 중 가장 후한 곳(${bracketLabel(peer.bracket)})의 ${theirs} 이상으로 적는다`,
        )
      }
    }

    // ---- 4. 문이 열리는 자리에서 심층이 실제로 바깥과 갈라진다 ----
    //
    // 재는 자리를 `transitions.csv` 에서 유도하는 것이 요점이다(barrierGateValues
    // 주석). 상수 85,001 이던 시절에는 얼음 결계의 `gateValue` 를 200,000 으로
    // 올려도 위반 0 이었다 — 검증이 **문이 안 열리는 구간**을 재게 되고, 정작
    // 문이 열린 뒤의 구간은 아무도 안 잰다.
    const gates = barrierGateValues(data.transitions, deep.skill)
    if (gates.length === 0) {
      violations.push(
        `${at}: ${deep.skill} 계열 결계가 transitions.csv 에 없다(gateSkill 이 ${deep.skill} 인 줄이 없다) — 심층 표는 그 문 뒤에서만 굴려지기로 하고 지은 것이라, 문턱이 곧 이 표의 ${timesText(DEEP_YIELD_TARGET)}를 재는 자리다. 문이 없으면 잴 자리도 없고 이 표는 아무도 못 만나는 표다. transitions.csv 에 그 결계 줄을 두거나 gather_tables.csv 에서 이 표를 지운다`,
      )
    } else if (gates.length > 1) {
      violations.push(
        `${at}: ${deep.skill} 계열 결계가 문턱을 [${gates.join(', ')}] ${gates.length}개로 말한다 — 어느 숫자 위에서 이 표가 ${timesText(DEEP_YIELD_TARGET)}를 져야 하는지 정해지지 않는다. transitions.csv 의 그 줄들 gateValue 를 하나로 맞춘다`,
      )
    }
    const gate = gates.length === 1 ? gates[0]! : null
    if (gate !== null) {
      const opensAt = gate + 1
      const deepAt = gatherBracketFor(deep, opensAt)
      const outerAt = gatherBracketFor(outer, opensAt)
      if (sameCumulative(deepAt.cumulative, outerAt.cumulative)) {
        violations.push(
          `${at}: 결계가 열리는 숙련 ${opensAt.toLocaleString('ko-KR')}(transitions.csv 의 ${deep.skill} 결계 gateValue ${gate.toLocaleString('ko-KR')} 바로 위)에서 브라켓(${bracketLabel(deepAt)})이 바깥 표 "${outer.id}" 의 같은 자리(${bracketLabel(outerAt)})와 글자 그대로 같다 — 문을 연 사람이 첫 걸음부터 바깥과 똑같은 표를 굴린다. 문 너머에 아무 일도 안 일어나는 것이 이 아크가 지우러 온 거짓말이다. gather_brackets.csv 의 ${deep.id} ${bracketLabel(deepAt)} 행 누적을 희귀 쪽으로 옮겨 ${timesText(DEEP_YIELD_TARGET)}로 만든다`,
        )
      }
    }

    // ---- 5. 바깥과 값이 다른 **모든** 구간에서 분당 산출이 목표 배수다 ----
    //
    // 예전에는 표당 한 점(85,001)만 쟀다. 그 한 점이 걸리는 브라켓은 표당
    // 하나이고, 나머지 바뀐 브라켓(`≤500000`)은 배수를 **한 번도 안 쟀다** —
    // 구리 손 실측으로 ice·mineral·herb 는 87분만 재고 **344분이 무측정**이었다.
    // 그 344분 동안 심층을 바깥과 글자 그대로 같게 만들어도(×1.000), 반대로
    // 천장·바닥 안에서 최대로 밀어도(×6.503, 목표의 2.6배) 위반 0 이었다.
    //
    // **면제 조건 둘 다 데이터에서 유도한다 — 손으로 적은 예외 목록을 두지 않는다.**
    // 목록을 적어 두면 계열이 하나 더 생기는 날 그 목록만 안 자란다.
    //
    // ① **문턱 아래 구간**(`구간 상한 ≤ gateValue`) — 거기엔 문을 넘은 사람이
    //    없으므로 ×1.0 이 옳다(§9-앞 3). 이 구간은 면제가 아니라 **반대 요구**가
    //    된다: 바깥과 다르면 그것 자체가 위반이다.
    // ② **절벽이 이미 지나간 구간**(그 자리의 바깥 브라켓이 바깥 ∞ 와 글자 그대로
    //    같다) — 나무 ≤500000 이 그 자리다(`wood,500000` 과 `wood,` 가 바이트
    //    단위로 같다, §9-앞 8). 바깥이 이미 ∞ 를 주고 있으면 심층이 더 줄 수
    //    있는 것이 없다: 천장(위 2)이 심층 최상위를 바깥 ∞ 값으로 묶고 바닥(위 3)이
    //    그 아래로 못 내려가게 하므로 ×2.5 는 **산술적으로 불가능**하다. 설계도
    //    같은 말을 했다 — "그 위에서 심층은 바깥과 같다"(§4).
    //
    //    **"심층이 바깥과 값이 같으면 면제"가 아니다.** 그 술어를 썼다면 이 검사는
    //    자기가 잡아야 할 것을 정확히 놓친다 — `mineral_deep,500000` 을
    //    `mineral,500000` 과 글자 그대로 같게 적는 것이 바로 "344분 동안 ×1.000"
    //    이라는 결함 그 자체인데, 그 술어는 그것을 면제해 버린다. 면제의 근거는
    //    심층이 무엇을 적었는가가 아니라 **바깥이 그 자리에서 이미 절벽 뒤인가**다.
    //
    // **구간마다 재는 이유**는 배수가 구간의 함수이기 때문이다: 간격은 심층·바깥
    // 양쪽에서 같은 숙련·같은 손으로 계산되어 약분되므로, 배수는 (심층 브라켓,
    // 바깥 브라켓) 쌍이 정하는 **상수**다. 그러니 쌍 하나를 잰다는 것은 그 쌍이
    // 걸린 숙련 구간 전체를 잰 것과 같다 — 표본이 아니라 전수다.
    //
    // 손을 실물 카탈로그에서 짓는다(gatherMeasure) — 배수를 여기서 곱하면 장비
    // 조회가 깨진 날에도 이 검증만 초록이다.
    const hand = measureHand(deep.skill, data.items, 1, false, 0)
    if (!hand) {
      violations.push(
        `${at}: ${deep.skill} 계열의 1티어 도구를 items.csv 에서 찾을 수 없어 분당 산출을 잴 수 없다 — 그 손이 이 배수를 재는 기준이다`,
      )
      continue
    }
    const low = DEEP_YIELD_TARGET * (1 - DEEP_YIELD_TOLERANCE)
    const high = DEEP_YIELD_TARGET * (1 + DEEP_YIELD_TOLERANCE)
    // 문턱을 모르면 재지 않는다 — 문이 없다·문턱이 둘이다는 위 4 가 이미 말했고,
    // 여기서 또 재면 그 한 줄이 브라켓 수만큼의 "×1.00" 그림자를 거느린다
    // (문턱 아래 구간은 ×1.0 이 옳은데, 문턱을 모르면 그것을 구별할 수 없다).
    if (gate === null) continue
    for (const range of deepRanges) {
      if (range.bracket.bracketMax === null) continue
      for (const span of spansOf(outerRanges, range)) {
        const lo = Math.max(range.lo, span.lo)
        const hi = Math.min(range.hi, span.hi)

        // ① 문턱 **아래**에서 갈라지는 것은 배수 문제가 아니라 자리 문제다. 그
        //    구간에는 문을 넘은 사람이 없으므로 이 값은 아무에게도 안 굴려지거나,
        //    심층 배치가 결계 밖으로 새는 날(그것은 transitions.ts 의 배치 검사가
        //    막는다) 저숙련의 손에 그대로 쥐여진다. §9-앞 3 이 정한 자리이고,
        //    그 규범이 여기서 처음으로 **`transitions.csv` 의 숫자에 묶인다** —
        //    문턱을 옮기면 이 검사가 함께 움직이므로 규범이 상수 하나에 얹혀
        //    있지 않다.
        if (gate !== null && hi <= gate) {
          if (sameCumulative(range.bracket.cumulative, span.bracket.cumulative)) continue
          violations.push(
            `${at} 브라켓(${bracketLabel(range.bracket)}): 숙련 ${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')} 는 ${deep.skill} 결계 문턱(${gate.toLocaleString('ko-KR')}) 아래인데 바깥 표 "${outer.id}" 의 같은 구간(${bracketLabel(span.bracket)})과 값이 다르다 — 그 구간에는 문을 넘은 사람이 없으므로 이 값은 아무에게도 안 굴려지거나, 심층 배치가 결계 밖으로 새는 날 저숙련의 손에 그대로 쥐여진다(§9-앞 3). gather_brackets.csv 의 그 행을 ${outer.id} 의 ${bracketLabel(span.bracket)} 행과 같게 적거나, transitions.csv 의 ${deep.skill} 결계 gateValue 를 ${lo - 1} 이하로 내린다`,
          )
          continue
        }

        // ② 절벽이 이미 지나간 구간 — 바깥이 그 자리에서 이미 ∞ 를 준다.
        if (sameCumulative(span.bracket.cumulative, outerInfinite)) continue

        const deepGold = goldPerMinute(deep, range.bracket, lo, hand, data.items)
        const outerGold = goldPerMinute(outer, span.bracket, lo, hand, data.items)
        // 바깥이 0G 인 계열은 배수 자체가 뜻이 없다 — 그 표는 다른 검사가 말할 일이다.
        if (outerGold <= 0) continue
        const ratio = deepGold / outerGold
        if (ratio >= low && ratio <= high) continue
        violations.push(
          `${at} 브라켓(${bracketLabel(range.bracket)}): 숙련 ${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}·구리 손의 분당 산출이 ${goldText(deepGold)} 로 바깥 표 "${outer.id}" 의 같은 구간(${bracketLabel(span.bracket)}, ${goldText(outerGold)})의 ${timesText(ratio)}다 — 목표는 ${timesText(DEEP_YIELD_TARGET)}(±${DEEP_YIELD_TOLERANCE * 100}% → ${low.toFixed(2)}~${timesText(high)})다. 네 계열이 같은 배수를 져야 결계 하나가 계열마다 다른 값이 되지 않고, 결계 수명 전 구간이 같은 약속을 져야 문 너머가 뒤로 갈수록 싱거워지지 않는다. gather_brackets.csv 의 ${deep.id} ${bracketLabel(range.bracket)} 행 누적을 ${ratio < DEEP_YIELD_TARGET ? '희귀' : '흔한'} 쪽으로 옮긴다`,
        )
      }
    }
  }

  return violations
}

/**
 * 특수 표가 자기 계열 **바깥 표를 안 이기는지**, 그리고 **스스로는 계속 오르는지**
 * 검사한다(노드 종류 §6-3).
 *
 * 심층 검사(`validateDeepTables`)의 규칙 5 와 같은 구간 쌍 기계를 쓰지만 **순회를
 * 그대로 재사용하지는 않는다.** 그 순회에는 심층 전용 갈래가 여섯 있고, 넷은
 * 특수에서 뜻이 반대이거나 없다. 각각에 대해 이 함수가 내린 판단:
 *
 * | 심층의 갈래 | 특수에서 |
 * |---|---|
 * | 1티어 손이 없으면 못 잰다 | **같다** — 잴 자가 없으면 아무것도 못 묻는다 |
 * | 결계 문턱을 모르면 안 잰다 | **없다** — 특수 노드는 결계 밖이라 문턱이 이 표와 무관하다 |
 * | ∞ 브라켓은 건너뛴다 | **안 건너뛴다** — 아래 |
 * | 문턱 아래에서는 바깥과 같기를 요구한다 | **요구하지 않는다** — 아래 |
 * | 바깥이 이미 ∞ 를 주는 구간은 면제한다 | **면제하지 않는다** — 천장은 어디서나 만족 가능하다 |
 * | 바깥이 0G 면 안 잰다 | **같다** — 비의 분모가 0 이다 |
 *
 * **∞ 를 재는 이유.** 심층의 ∞ 는 바깥의 복사본이고 규칙 1 이 그것을 따로 재므로
 * 배수는 산술적으로 1.000 이다 — 거기서 또 재는 것은 같은 말을 두 번 하는 것이다.
 * 특수에는 복사 규칙이 없으므로 ∞ 를 건너뛰면 **어떤 검사도 안 받는 구간**이 되는데,
 * 플레이어가 그 노드 앞에서 보내는 시간의 **대부분이 ∞ 다**(구리손으로 숙련
 * 500,000 도달이 584.2분, 그 뒤로 영원히).
 *
 * **문턱 아래를 안 묻는 이유.** 심층에서 그 요구가 옳은 근거는 "문턱 아래에는 그
 * 표를 굴릴 사람이 없다"인데, 특수 배치는 **모든 결계 밖**이어야 하므로(설계 §6-7,
 * transitions.ts 의 배치 검사가 문다) 문턱 아래가 곧 특수 표가 실제로 굴려지는
 * 자리다. 그 요구를 복사하면 설계 §5 의 "숙련 0 에서 37.5분에 하나"가 그 자리에서
 * 위반이 된다 — 규범 둘이 서로를 부순다.
 *
 * **재는 자리는 구간의 하한이다.** 구간 안에서 간격은 줄기만 하므로(actionIntervalMs)
 * 하한이 최악이고, ∞ 는 한 숫자가 아니다 — 같은 표·같은 손으로 숙련 500,001 에서
 * 1,679,054G/분, 1,000,000 에서 2,451,419G/분이다. 점을 안 정하면 그 검사는
 * 참·거짓을 물을 수 없다.
 */
function validateSpecialTables(tables: GatherTables, data: GameData): string[] {
  const violations: string[] = []

  const outerBySkill = new Map<SkillId, GatherTableDef[]>()
  for (const table of Object.values(tables)) {
    if (variantOfTableId(table.id) !== 'normal') continue
    const list = outerBySkill.get(table.skill)
    if (list) list.push(table)
    else outerBySkill.set(table.skill, [table])
  }

  for (const special of Object.values(tables)) {
    if (!isSpecialTableId(special.id)) continue
    const at = `gather[${special.id}]`
    const candidates = outerBySkill.get(special.skill) ?? []
    if (candidates.length === 0) {
      violations.push(
        `${at}: 같은 계열(${special.skill})의 바깥 표가 없다 — 특수 표는 그 계열 바깥 표보다 낮아야 하므로 무엇보다 낮은지 물을 상대가 반드시 있어야 한다. gather_tables.csv 에 접미사 없는 ${special.skill} 계열 표를 둔다`,
      )
      continue
    }
    if (candidates.length > 1) {
      violations.push(
        `${at}: 같은 계열(${special.skill})의 바깥 표가 [${candidates.map((t) => t.id).join(', ')}] ${candidates.length}개다 — 어느 것보다 낮아야 하는지 정해지지 않는다. 접미사 없는 표는 계열마다 하나여야 한다`,
      )
      continue
    }
    const outer = candidates[0]!

    // 손을 실물 카탈로그에서 짓는다 — 심층 검사와 같은 자여야 두 규범이 같은
    // 세계를 잰다(gatherMeasure).
    const hand = measureHand(special.skill, data.items, 1, false, 0)
    if (!hand) {
      violations.push(
        `${at}: ${special.skill} 계열의 1티어 도구를 items.csv 에서 찾을 수 없어 분당 산출을 잴 수 없다 — 그 손이 천장과 바닥을 재는 기준이다`,
      )
      continue
    }

    const specialRanges = bracketRanges(special)
    const outerRanges = bracketRanges(outer)

    // ---- 천장(상대) — ∞ 를 포함한 모든 구간에서 바깥보다 낮다 ----
    for (const range of specialRanges) {
      if (range.lo > range.hi) continue
      for (const span of spansOf(outerRanges, range)) {
        const lo = Math.max(range.lo, span.lo)
        const hi = Math.min(range.hi, span.hi)
        const outerGold = goldPerMinute(outer, span.bracket, lo, hand, data.items)
        if (outerGold <= 0) continue
        const specialGold = goldPerMinute(special, range.bracket, lo, hand, data.items)
        const ratio = specialGold / outerGold
        if (ratio < SPECIAL_YIELD_MAX) continue
        violations.push(
          `${at} 브라켓(${bracketLabel(range.bracket)}): 숙련 ${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')}·구리 손의 분당 산출이 ${goldText(specialGold)} 로 바깥 표 "${outer.id}" 의 같은 구간(${bracketLabel(span.bracket)}, ${goldText(outerGold)})의 ${timesText(ratio)}다 — 천장은 ${timesText(SPECIAL_YIELD_MAX)} 미만이다. 특수 노드가 보통 노드를 이기는 순간 최적해가 하나가 되고 그 계열의 보통 배치가 전부 배경이 된다. gather_brackets.csv 의 ${special.id} ${bracketLabel(range.bracket)} 행 누적을 흔한 쪽으로 옮기거나, 잡티어를 그 계열 최저가 아이템으로 바꾼다`,
        )
      }
    }

    // ---- 바닥(절대) — 최상위 티어가 브라켓마다 더 자주 나온다 ----
    //
    // **재는 것이 골드가 아니라 최상위 티어의 확률인 이유.** 특수 표가 존재하는
    // 이유는 그 한 아이템이고(설계 §2 — 4단 도구를 여는 열쇠), 잡티어는 일부러
    // 그 계열 최저가로 채워 분당 골드를 낮게 만드는 자리다(천장). 그래서 회당
    // 기대 매도가는 잡티어가 지배하고 — 실측으로 §5 목표표의 회당 값이
    // 17.6 → 19.0 → 20.1 → 23.9G 로 ×1.1 씩만 움직인다 — 그것을 바닥으로 쓰면
    // 열쇠가 얼마나 자주 나오는지와 무관한 것을 죄게 된다.
    //
    // **간격이 아니라 확률인 이유도 같다.** 분당으로 재면 500ms 가 297ms 가 되는
    // 것만으로 ×1.68 이 되어, `cum1` 을 브라켓마다 똑같이 눕힌 표도 통과했다(실측).
    // 그것은 표가 오른 것이 아니라 숙련도가 오른 것이다. 작가가 CSV 에서 손댈 수
    // 있는 것은 이 확률 하나뿐이므로, 규범도 그것을 죄어야 고칠 자리가 분명해진다.
    let previous: { bracket: GatherBracketDef; chance: number } | null = null
    for (const range of specialRanges) {
      if (range.lo > range.hi) continue
      const chance = tierChances(range.bracket.cumulative, hand)[0] ?? 0
      if (previous !== null) {
        const step = previous.chance > 0 ? chance / previous.chance : Number.POSITIVE_INFINITY
        if (step < SPECIAL_YIELD_MIN_STEP) {
          const top = special.tiers[0]?.itemId ?? '최상위 티어'
          violations.push(
            `${at} 브라켓(${bracketLabel(range.bracket)}): 구리 손으로 ${top} 가 나올 확률이 ${percentText(chance)} 로 앞 브라켓(${bracketLabel(previous.bracket)}, ${percentText(previous.chance)})의 ${timesText(step)}다 — 바닥은 ${timesText(SPECIAL_YIELD_MIN_STEP)} 이상이다. 특수 표가 파는 것은 골드가 아니라 그 한 아이템이므로, 스스로 오르는지는 그 확률로 재야 한다(회당 골드는 잡티어가, 분당 골드는 간격이 지배한다). gather_brackets.csv 의 ${special.id} ${bracketLabel(range.bracket)} 행 첫 누적을 올린다`,
          )
        }
      }
      previous = { bracket: range.bracket, chance }
    }
  }

  return violations
}

export interface GatherTablesCheck {
  /** 빌드를 세우는 오류. */
  violations: string[]
  /** 빌드는 통과하지만 설계 의도(잭팟·최종 실패 0%)에서 벗어난 것 — 작가에게 알린다. */
  warnings: string[]
}

/**
 * 표의 뜻을 검사한다. 위반 목록과 경고 목록을 나눠 돌려준다.
 *
 * GameData 를 함께 받는 이유: 표는 GameData 에 실리지 않지만(클라이언트 번들
 * 금지, 설계 §7-앞 9) 아이템·노드와 서로를 가리키므로, 그 참조가 성립하는지는
 * 양쪽을 다 보는 자리에서만 물을 수 있다. 노드 쪽 참조(없는 tableId)는
 * validateGameData 가 본다 — 그쪽의 조기 반환(참조 위반 시 도달 가능성 생략)에
 * 끼어야 해서다.
 */
export function validateGatherTables(tables: GatherTables, data: GameData): GatherTablesCheck {
  const violations: string[] = []
  const warnings: string[] = []

  for (const table of Object.values(tables)) {
    const at = `gather[${table.id}]`

    if (table.skillGainMin > table.skillGainMax) {
      violations.push(`${at}: skillGainMin(${table.skillGainMin}) 이 skillGainMax(${table.skillGainMax}) 보다 크다`)
    }

    // ∞ 브라켓은 정확히 하나, 마지막이어야 한다(설계 §7-앞 4). 없으면 상한 밖
    // 숙련도(예: 500001)가 어느 브라켓에도 안 걸려 라이브에서 판정 불능이 된다.
    const infinite = table.brackets.filter((b) => b.bracketMax === null)
    if (infinite.length === 0) {
      violations.push(
        `${at}: bracketMax 가 빈 칸(∞)인 브라켓이 없다 — 마지막 행의 bracketMax 를 비워야 상한 밖 숙련도 판정을 받는다`,
      )
    } else if (infinite.length > 1) {
      violations.push(
        `${at}: bracketMax 가 빈 칸(∞)인 브라켓이 ${infinite.length}개다 — 정확히 하나, 마지막 행이어야 한다`,
      )
    } else if (table.brackets.at(-1)!.bracketMax !== null) {
      violations.push(`${at}: ∞ 브라켓이 마지막이 아니다 — 그 뒤의 브라켓은 영원히 선택되지 않는다`)
    }

    // 유한 상한은 순오름차순이어야 한다. 브라켓은 "첫 번째 bracketMax ≥ 숙련도"
    // 로 골라지므로, 역순이나 같은 값 뒤의 브라켓은 영원히 선택되지 않는다.
    const finite = table.brackets.map((b) => b.bracketMax).filter((m): m is number => m !== null)
    for (let i = 1; i < finite.length; i++) {
      if (finite[i]! <= finite[i - 1]!) {
        violations.push(`${at}: 브라켓 상한이 오름차순이 아니다 — ${finite[i - 1]} 다음에 ${finite[i]} 이 왔다`)
      }
    }

    for (const bracket of table.brackets) {
      const bat = `${at} 브라켓(${bracketLabel(bracket)})`

      if (bracket.cumulative.length !== table.tiers.length) {
        violations.push(
          `${bat}: 누적 칸 수(${bracket.cumulative.length})가 티어 수(${table.tiers.length})와 다르다 — 티어마다 누적 상한이 하나씩 있어야 한다`,
        )
      }

      for (let i = 0; i < bracket.cumulative.length; i++) {
        const cum = bracket.cumulative[i]!
        if (cum > ROLL_MAX) {
          violations.push(`${bat}: 누적 ${cum} 이 ${ROLL_MAX} 을 넘는다 — roll 은 0~${ROLL_MAX} 이다`)
        }
        // 순증가 검사. 같은 값은 폭 0 — "roll ≤ 상한 첫 매치" 규칙에서 앞
        // 티어가 전부 가로채므로 그 티어는 영원히 안 나온다(설계 §7-앞 5).
        if (i > 0 && cum <= bracket.cumulative[i - 1]!) {
          violations.push(
            `${bat}: 누적이 순증가가 아니다 — cum${i + 1}(${cum}) 가 cum${i}(${bracket.cumulative[i - 1]}) 이하다. 같은 값은 폭 0, 영원히 안 나오는 티어다`,
          )
        }
      }
    }

    for (let i = 0; i < table.tiers.length; i++) {
      const itemId = table.tiers[i]!.itemId
      if (!Object.hasOwn(data.items, itemId)) {
        violations.push(`${at} 티어 ${i + 1}: 존재하지 않는 아이템 "${itemId}" 을 가리킨다`)
      }
    }

    // 고아 표 — CSV 에는 있지만 어느 노드도 안 가리키면 게임에 없는 표다.
    // "노드를 놓는 것을 잊었다" 를 배치 검사가 잡는 것과 같은 부류다.
    const users = Object.values(data.nodes).filter((n) => n.tableId === table.id)
    if (users.length === 0) {
      violations.push(`${at}: 어느 노드도 이 표를 가리키지 않는다 — 플레이어가 닿을 방법이 없는 표다`)
    }

    // 한 표는 한 기술의 노드만 가리킨다(설계 §7-앞 5). 다른 기술의 노드가 이
    // 표를 굴리면 그 채집이 엉뚱한 기술의 숙련으로 브라켓을 고르게 된다.
    for (const node of users) {
      if (node.skill !== table.skill) {
        violations.push(
          `nodes[${node.id}]: 기술(${node.skill})이 표 "${table.id}" 의 기술(${table.skill})과 다르다 — 한 표는 한 기술의 노드만 가리킨다`,
        )
      }
    }

    // ---- 경고 — 빌드는 통과하지만 설계 의도에서 벗어난 모양 ----

    // 최종 브라켓 실패 0% 는 원작 준용값이지 강제가 아니다 — 다만 벗어나면
    // "끝까지 올려도 빈손이 나온다" 는 큰 체감 변화라 작가가 알아야 한다(§7-앞 5).
    //
    // **특수 표는 묻지 않는다.** 그 표의 ∞ 꼬리는 작가가 고른 것이 아니라 이미
    // 선 규범 둘이 **강제한** 결과다: 위 SPECIAL_YIELD_MAX 가 값을 바깥 아래로
    // 누르고, collection 의 형평 하한이 잡티어의 몫을 그 계열 대표 표보다 얇게
    // 묶는다(실측: 얼음 ∞ 에서 상한이 약 16%). 그 둘을 지키면 나머지는 꽝이 될
    // 수밖에 없고, 그것이 특수 노드가 "골드가 아니라 열쇠를 파는 자리"인 이유
    // 그 자체다(노드 종류 §4). 여기서 매번 경고하면 작가가 고칠 수 없는 것을
    // 고치라고 말하는 셈이고, 그런 경고는 읽히지 않는 경고가 된다.
    const last = table.brackets.at(-1)!
    const lastCum = last.cumulative.at(-1)
    if (!isSpecialTableId(table.id) && last.bracketMax === null && lastCum !== undefined && lastCum < ROLL_MAX) {
      warnings.push(
        `${at}: 최종(∞) 브라켓에 실패가 남는다 — 마지막 누적이 ${lastCum} 이라 ${ROLL_MAX - lastCum}/${ROLL_MAX + 1} 은 빈손이다. 원작 준용은 ${ROLL_MAX}(실패 0%)이다`,
      )
    }

    // 첫 브라켓의 최상 티어가 누적 0 이면 roll=0 하나(1/100001)로 줄어든다 —
    // "숙련 0 부터 아주 가끔 전설급"(설계 §1)이 사실상 사라진다.
    const first = table.brackets[0]!
    if (first.cumulative[0] === 0) {
      warnings.push(
        `${at}: 첫 브라켓(${bracketLabel(first)})의 최상 티어 누적이 0 이다 — 숙련 0 의 잭팟이 사실상 사라진다`,
      )
    }
  }

  // 표 하나만 봐서는 알 수 없는 것 — 심층 표와 그 계열 바깥 표의 관계(결계 §9-앞 1·6·7).
  violations.push(...validateDeepTables(tables, data))
  // 같은 모양의 다른 약속 — 특수 표는 바깥을 **안 이기고** 스스로는 계속 오른다(노드 종류 §6-3).
  violations.push(...validateSpecialTables(tables, data))

  return { violations, warnings }
}
