import type {
  CollectionTable,
  CollectionThresholds,
  GameData,
  GatherTableDef,
  GatherTables,
  ItemDef,
  SkillId,
} from '@nogada/shared'
import { COLLECTION_MAX_GRADE, ENHANCE_CAP, gatherIntervalMs } from '@nogada/shared'
import { measureHand, tierChances } from './gatherMeasure.js'
import { addUnique, requireCell, toInt } from './parse.js'

type Row = Record<string, string>

const FILE = 'collection.csv'

/**
 * 위반 메시지가 가리키는 **다른** 파일 — 재는 표를 고르는 칸은 저쪽에 있다.
 *
 * 이 검증의 위반은 거의 다 collection.csv 의 문턱을 고치라는 말인데, 대표 표
 * 위반만은 gather_tables.csv 한 줄을 고치라는 말이다. 파일 이름을 안 적으면
 * 작가는 문턱표를 열고 equity 칸을 찾다가 없는 칸을 찾게 된다.
 */
const GATHER_TABLES_FILE = 'gather_tables.csv'

/**
 * 문턱표를 CSV 에서 조립한다 — 수집의 방 25칸의 요구치다(설계 §6-앞 5).
 *
 * **이 표는 GameData 에 실린다**(build.ts). 채집 확률표를 서버 전용으로 구운
 * 이유(브라켓 경계가 곧 숨은 문턱이라 F12 로 스포일된다, §7-앞 9)가 여기에는
 * 없다 — 오히려 반대다: 방은 **잠긴 칸에도 요구치를 적어야 한다**(§6-앞 3).
 * 화면이 "0/50" 을 못 적으면 플레이어는 무엇을 얼마나 모아야 하는지 모른 채
 * 칸만 보게 된다. 강화 비용표(enhanceCosts)를 싣는 것과 같은 자리이고,
 * 채집 표와 정확히 반대편 결정이다.
 *
 * 여기서 던지는 것은 "조립 자체가 안 되는" 구조 오류다(빈 칸, 숫자가 아닌 값,
 * 같은 아이템 두 줄). 조립은 되지만 뜻이 어긋나는 것(칸 목록 불일치, 순증가
 * 위반, 형평 이탈)은 `validateCollection` 이 목록으로 모아 보고한다 — 작가가
 * 한 번의 빌드에서 오류 전부를 보게 하려는 것이고, 이 갈래는 gatherTables.ts ·
 * enhanceCosts.ts 와 같다.
 */
export function parseCollection(rows: Row[]): CollectionTable {
  const out: CollectionTable = {}

  for (const raw of rows) {
    const itemId = requireCell(raw, 'itemId', FILE)
    const ctx = `${FILE}[${itemId}]`
    // min 0 으로 읽는다 — "t1 이 0" 은 조립 불능이 아니라 뜻이 어긋나는 것이라
    // (아무도 안 바쳐도 1등급인 칸) validateCollection 이 다른 위반들과 함께
    // 한 목록에서 보고한다.
    const steps: [number, number, number, number] = [
      toInt(requireCell(raw, 't1', ctx), ctx, 't1', 0),
      toInt(requireCell(raw, 't2', ctx), ctx, 't2', 0),
      toInt(requireCell(raw, 't3', ctx), ctx, 't3', 0),
      toInt(requireCell(raw, 't4', ctx), ctx, 't4', 0),
    ]
    const def: CollectionThresholds = { itemId, steps }
    addUnique(out, itemId, def, FILE)
  }

  return out
}

/**
 * 형평의 목표 — **최적손이 최종 브라켓에서 4단을 채우는 데 드는 분**(§6-앞 5).
 *
 * 왜 30분 하나를 겨냥하는가: 채집은 칸마다 확률이 다르므로 **균일 문턱은 곧
 * 불형평**이다. 출하 표로 재면 가장 흔한 칸(금 원석 536.8개/분)과 가장 드문 칸
 * (은 원석 40.9개/분)이 **13.1배** 갈린다 — 같은 4단인데 어떤 칸은 30분,
 * 어떤 칸은 6시간이 된다. 그래서 문턱은 확률에 반비례해 적고, 이 검증이 그
 * 반비례가 지켜졌는지를 시간으로 되잰다. `enhance_costs` 의 계열 회전 검증과
 * 같은 자세다: 표 안만 보면 온전한데 게임에서는 기울어져 있는 것을 잡는다.
 *
 * 대역이 25~35 인 이유: 출하 값은 30분을 겨냥해 두 자리 유효숫자로 반올림했고,
 * 그 흔들림이 실측 29.33~30.75분이다 — 관측을 감싸는 가장 가까운 5분 단위가
 * 이 대역이다. 스펙 §6-앞 5 가 예로 든 15~45 를 쓰지 않는 이유는 그 폭(3배)
 * 자체가 칸 사이 3배 불형평을 허용하기 때문이다: 막으라는 것이 13.1배인데
 * 3배를 통과시키면 이 검증은 그 문제의 4분의 1만 잡는다.
 */
const EQUITY_MIN_MINUTES = 25
const EQUITY_MAX_MINUTES = 35

/**
 * 1단에 쓰는 예산 — **구리 손·첫 브라켓·숙련 0** 에서 몇 분(§6-앞 6).
 *
 * 실측: 숙련 절벽(50만) 앞뒤로 최상위 티어 확률이 227배 갈린다. 1단이 높으면
 * "절벽까지 한 개도 안 바치는 것"이 지배 전략이 되고, 그러면 방에 적힌 숫자를
 * 아무도 초반에 읽지 않는다. 5분은 첫 도구를 만든 사람이 한 자리에서 앉아
 * 채울 수 있는 시간이고, 그래야 일찍 시작할 이유가 생긴다.
 */
const EARLY_BUDGET_MINUTES = 5

/**
 * "그 손으로는 몇 분에 한 개도 못 얻는" 칸의 1단은 **한 개**여야 한다.
 *
 * 잭팟 티어(첫 브라켓에서 분당 0.005개 = 한 개에 208분)는 어떤 문턱을 적어도
 * 5분 안에 닿지 않는다 — 그 칸에 5분을 요구하면 표를 고치라는 뜻이 되어 버린다.
 * 그래서 규칙을 "몇 분 안에 닿거나, **더 낮출 수 없는 값(한 개)이거나**" 로
 * 적는다. 이 예외는 무르지 않다: 미스릴 원석의 1단이 2 가 되는 순간(417분)
 * 검증이 그 자리에서 빨개진다.
 */
const EARLY_FLOOR = 1

/**
 * 중간 두 단(t2·t3)이 4단 대비 가져야 할 비율의 하한·상한(§6-앞 5).
 *
 * 화면은 등급 픽을 네 번 그린다(1단부터 4단까지 하나씩) — 중간 단이 어느 한쪽
 * 끝에 붙으면 그 픽 중 일부가 사실상 죽는다. t2 가 t4 에 가까우면(예:
 * t2=6999,t4=7100) 1단만 넘겨도 3단까지 거의 동시에 열려 네 눈금이 두 눈금이
 * 되고, 반대로 t2 가 t1 에 붙으면 3·4단이 통째로 멀어지는 것으로 같은 일이
 * 일어난다. 그래서 상한(50%) 은 4단 쪽 접힘을, 하한(5%) 은 1단 쪽 접힘을 막는다.
 *
 * 출하 25행은 전부 t2 ≈ t4×0.1, t3 ≈ t4×0.333 이라 이 대역 한가운데를 지나
 * 데이터를 한 줄도 고치지 않고 통과한다.
 */
const MID_TIER_MIN_RATIO = 0.05
const MID_TIER_MAX_RATIO = 0.5

/** 그 계열 카탈로그의 가장 높은 도구 등급. 도구가 하나도 없으면 null(맨손밖에 없는 계열이다). */
function topToolTier(skill: SkillId, items: Record<string, ItemDef>): number | null {
  const tiers = Object.values(items)
    .filter((item) => item.toolSkill === skill && item.toolTier !== undefined)
    .map((item) => item.toolTier!)
  return tiers.length === 0 ? null : Math.max(...tiers)
}

/** 최종(∞) 브라켓에 **막 들어선** 숙련 — 그보다 높아도 간격은 이미 하한(50ms)이라 답이 같다. */
function finalBracketProficiency(table: GatherTableDef): number {
  const finite = table.brackets.map((b) => b.bracketMax).filter((max): max is number => max !== null)
  return finite.length === 0 ? 0 : Math.max(...finite) + 1
}

/** 그 비율로 N 개를 모으는 데 걸리는 기대 시간(분). 확률 0 이면 영원히다. */
function minutesFor(count: number, chance: number, intervalMs: number): number {
  return chance <= 0 ? Number.POSITIVE_INFINITY : (count * intervalMs) / chance / 60_000
}

/** 메시지에 적는 분 — 작가가 대역과 눈으로 견줄 수 있게 소수 한 자리까지. */
function minutesText(minutes: number): string {
  return Number.isFinite(minutes) ? `${minutes.toFixed(1)}분` : '영원히'
}

/**
 * 실측 분을 목표 분으로 스케일링한 권장 문턱 — "현재 문턱 × 목표분 ÷ 실측분".
 *
 * 형평·조기 도달 위반 메시지는 지금 몇 분 걸리는지와 목표 대역을 둘 다 적지만,
 * 그 둘에서 "그럼 얼마로 고치나"로 가려면 작가가 손으로 곱셈을 해야 했다.
 * 시간이 문턱에 선형이라는 사실(minutesFor 가 count 에 비례한다) 하나만 있으면
 * 그 계산을 메시지가 대신 할 수 있다 — 그래서 여기서 한 번만 하고 양쪽
 * 위반(형평·조기 도달)이 나눠 쓴다.
 *
 * 실측이 무한대(그 브라켓에서 확률 0)면 스케일 자체가 뜻이 없어 null 을
 * 돌려준다 — 그때는 권장 문턱이 아니라 표(확률)를 먼저 고쳐야 한다.
 */
function recommendedThreshold(current: number, measuredMinutes: number, targetMinutes: number): number | null {
  if (!Number.isFinite(measuredMinutes) || measuredMinutes <= 0) return null
  return Math.max(1, Math.round((current * targetMinutes) / measuredMinutes))
}

/**
 * 문턱표의 뜻을 검사한다. 위반 목록을 돌려준다(빌드가 다른 검사들과 함께 인쇄한다).
 *
 * 채집 표를 함께 받는 이유: 문턱은 **표와의 관계**로만 뜻을 갖는다. 표를 안 보면
 * "3,000개"가 30분인지 6시간인지 알 수 없고, 칸 목록이 맞는지도 물을 수 없다
 * — 칸의 출처가 `gather_tiers.csv` 이기 때문이다(§6-앞 4). 표가 GameData 에
 * 안 실리므로(클라 번들 금지) validateGatherTables 처럼 인자로 받는다.
 */
export function validateCollection(data: GameData, tables: GatherTables): string[] {
  const violations: string[] = []
  const collection = data.collection

  // ---- 칸 목록 = 채집물 전부(§6-앞 4) ----
  //
  // 손으로 적은 목록이 아니라 `gather_tiers.csv` 에서 유도한 집합과 견준다.
  // 빠짐과 잉여를 **둘 다** 위반으로 보는 것이 요점이다: 빠지면 그 재료는
  // 캘 수 있는데 방에 자리가 없고(만점이 100 이 아니게 된다), 잉여면 방에
  // 자리가 있는데 아무도 캘 수 없다(영원히 0등급인 칸 — 화면이 "0/50"을
  // 적어 놓고 아무도 채울 수 없다).
  const gathered = new Map<string, { table: GatherTableDef; tierIndex: number }>()
  for (const table of Object.values(tables)) {
    table.tiers.forEach((tier, tierIndex) => gathered.set(tier.itemId, { table, tierIndex }))
  }

  for (const itemId of gathered.keys()) {
    if (!Object.hasOwn(collection, itemId)) {
      violations.push(
        `${FILE}: 채집물 "${itemId}" 의 칸이 없다 — 방의 칸은 gather_tiers.csv 의 채집물 전부여야 한다(만점 = 칸 수 × ${COLLECTION_MAX_GRADE})`,
      )
    }
  }
  for (const itemId of Object.keys(collection)) {
    if (!gathered.has(itemId)) {
      violations.push(
        `${FILE}[${itemId}]: 채집물이 아니다 — gather_tiers.csv 에 없는 아이템은 캘 수 없으니 영원히 0등급인 칸이 된다. 정제품·가루·주괴·증표는 "모았다"가 아니라 "만들었다"라 칸이 아니다`,
      )
    }
  }

  // ---- 문턱의 모양 ----
  for (const def of Object.values(collection)) {
    const at = `${FILE}[${def.itemId}]`
    const [t1, t2, t3, t4] = def.steps

    if (t1 <= 0) {
      violations.push(`${at}: t1 이 ${t1} 이다 — 아무도 안 바친 칸이 1등급이 되어 총점이 처음부터 0 이 아니게 된다`)
    }

    let increasing = true
    for (let i = 1; i < def.steps.length; i++) {
      const prev = def.steps[i - 1]!
      const cur = def.steps[i]!
      if (cur <= prev) {
        increasing = false
        violations.push(
          `${at}: 문턱이 순증가가 아니다 — t${i + 1}(${cur}) 가 t${i}(${prev}) 이하다. 한 번 바쳐서 두 등급이 오르거나, 아무도 못 넘는 단이 생긴다`,
        )
      }
    }

    // 중간 두 단(t2·t3)이 4단에 붙어 사다리가 사실상 두 눈금이 되는 것을 막는다
    // (§6-앞 5, MID_TIER_MIN_RATIO 문서). 순증가가 이미 깨진 줄에는 묻지 않는다 —
    // 그 경우 t4 기준으로 잰 비율 자체가 뜻이 없고, 위의 증가 위반이 원인을 이미
    // 짚었다. 원인 하나(문턱이 어긋났다)를 위반 둘로 보고하지 않는다.
    if (increasing) {
      for (const [label, value] of [
        ['t2', t2],
        ['t3', t3],
      ] as const) {
        const ratio = value / t4
        if (ratio < MID_TIER_MIN_RATIO || ratio > MID_TIER_MAX_RATIO) {
          const min = Math.round(t4 * MID_TIER_MIN_RATIO)
          const max = Math.round(t4 * MID_TIER_MAX_RATIO)
          violations.push(
            `${at}: ${label}(${value}) 가 t4(${t4}) 의 ${(ratio * 100).toFixed(1)}% 다 — 중간 두 단은 4단의 5~50%(${min}~${max}) 여야 한다. 등급 픽 4개가 실제로 네 번 켜지려면 중간 단이 양 끝에 붙으면 안 된다`,
          )
        }
      }
    }
  }

  // ---- 계열마다 "재는 표"가 정확히 하나(결계 §9-앞 1·2) ----
  //
  // 아래 시간 검사는 표를 순회하며 **같은 25칸 문턱**을 잰다. 계열에 표가 둘이
  // 되면(바깥·심층) 한 칸의 t4 가 두 표의 ∞ 양쪽에서 25~35분 대역을 동시에
  // 만족해야 하는데, 실측 허용창은 0.84×~1.23× 라 **어떤 문턱을 적어도 빌드가
  // 안 서는 교착**이 된다. 그래서 계열마다 하나만 잰다.
  //
  // 0개도 위반인 이유는 반대쪽이다: 그 계열의 칸들이 아무에게도 안 재이는데
  // **아무 소리도 안 난다.** 검증이 사라진 것은 검증이 알려야 한다.
  const bySkill = new Map<SkillId, GatherTableDef[]>()
  for (const table of Object.values(tables)) {
    const list = bySkill.get(table.skill)
    if (list) list.push(table)
    else bySkill.set(table.skill, [table])
  }
  for (const [skill, all] of bySkill) {
    const measuring = all.filter((t) => t.equity)
    if (measuring.length === 1) continue
    const at = `${GATHER_TABLES_FILE}(${skill} 계열)`
    const ids = all.map((t) => t.id).join(', ')
    violations.push(
      measuring.length === 0
        ? `${at}: equity 칸이 "1" 인 표가 없다 — 이 계열의 칸들이 형평·조기도달 검증을 아무 소리 없이 통째로 건너뛴다. 이 계열 표(${ids}) 중 바깥 표 한 줄의 equity 칸에 1 을 적는다`
        : `${at}: equity 칸이 "1" 인 표가 ${measuring.length}개다(${measuring.map((t) => t.id).join(', ')}) — 한 칸의 t4 가 두 표의 ∞ 양쪽에서 ${EQUITY_MIN_MINUTES}~${EQUITY_MAX_MINUTES}분을 동시에 만족해야 해서 어떤 문턱으로도 빌드가 서지 않는다. 대표 표 한 줄만 남기고 나머지 줄의 equity 칸을 비운다`,
    )
  }

  // 칸 목록이나 재는 표가 어긋난 채로 시간을 재면 "없는 표의 칸"을 묻거나 같은
  // 칸을 두 표로 재게 되어 원인 하나가 위반 여럿이 된다 — validate.ts 가 참조
  // 위반이 있으면 도달 가능성 검사를 미루는 것과 같은 저울이다.
  if (violations.length > 0) return violations

  // 시간은 **표 단위로** 잰다(칸 단위가 아니라). 손과 확률은 계열이 소유하는
  // 것이라 한 표의 일곱 칸이 같은 답을 나눠 쓰고, 전수 셈(100,001회)은 손마다
  // 한 번이면 된다 — 칸마다 다시 세면 같은 답을 25번 만든다.
  for (const table of Object.values(tables)) {
    // 계열의 대표 표 하나만 잰다(결계 §9-앞 1·2) — 위 검사가 "정확히 하나"를
    // 이미 보장했다.
    //
    // 형평은 위에 적은 교착 때문이고, 조기 도달은 이유가 하나 더 있다:
    // 그 검사는 `table.brackets[0]` 을 **구리 손·숙련 0** 으로 재는데, 심층
    // 표의 첫 브라켓은 숙련 85,000 결계 뒤에 있어 그 손이 영영 서 볼 수 없는
    // 자리다. 가리지 않으면 검사는 계속 도는데 그것이 지키던 것("절벽까지 한
    // 개도 안 바치는 것이 지배 전략이 되지 않게")은 새 표 위에서 아무 뜻도
    // 없어진다 — **안전망이 새 표에서만 조용히 사라지고**, 작가는 그 자리를
    // 초록으로 만들려고 닿을 수 없는 구간의 확률을 고치게 된다.
    if (!table.equity) continue

    const skill = table.skill
    const at = `${FILE}(${table.id} 계열)`

    const topTier = topToolTier(skill, data.items)
    const best = topTier === null ? null : measureHand(skill, data.items, topTier, true, ENHANCE_CAP)
    if (!best) {
      violations.push(
        `${at}: ${skill} 계열의 최적손(가장 높은 등급 도구 + 선별증표)을 items.csv 에서 찾을 수 없어 형평을 잴 수 없다`,
      )
      continue
    }
    const copper = measureHand(skill, data.items, 1, false, 0)
    if (!copper) {
      violations.push(`${at}: ${skill} 계열의 1티어 도구를 items.csv 에서 찾을 수 없어 1단 도달 시간을 잴 수 없다`)
      continue
    }

    const bestChances = tierChances(table.brackets.at(-1)!.cumulative, best)
    const bestInterval = gatherIntervalMs(finalBracketProficiency(table), best)
    const earlyChances = tierChances(table.brackets[0]!.cumulative, copper)
    const earlyInterval = gatherIntervalMs(0, copper)

    table.tiers.forEach((tier, tierIndex) => {
      const def = collection[tier.itemId]!
      const slot = `${FILE}[${def.itemId}]`
      const top = def.steps[COLLECTION_MAX_GRADE - 1]!
      const first = def.steps[0]!

      // ---- 형평(§6-앞 5) — 최적손·자기 최종 브라켓에서 4단까지 몇 분인가 ----
      const bestMinutes = minutesFor(top, bestChances[tierIndex]!, bestInterval)
      if (bestMinutes < EQUITY_MIN_MINUTES || bestMinutes > EQUITY_MAX_MINUTES) {
        // 작가가 "13000 × 25 / 307.5" 를 손으로 곱하지 않게, 대역 양 끝을
        // recommendedThreshold 로 스케일링해 권장 범위를 함께 적는다.
        const lo = recommendedThreshold(top, bestMinutes, EQUITY_MIN_MINUTES)
        const hi = recommendedThreshold(top, bestMinutes, EQUITY_MAX_MINUTES)
        const fix = lo !== null && hi !== null ? ` → ${lo.toLocaleString('ko-KR')}~${hi.toLocaleString('ko-KR')} 사이로 적는다` : ''
        violations.push(
          `${slot}: 4단(${top}개)이 최적손·최종 브라켓에서 ${minutesText(bestMinutes)} 걸린다 — 목표 대역은 ${EQUITY_MIN_MINUTES}~${EQUITY_MAX_MINUTES}분이다. 문턱은 그 칸의 드랍 비율에 반비례해야 하고, 균일 문턱은 계열·티어 사이를 13배까지 기울인다${fix}`,
        )
      }

      // ---- 1단은 절벽 앞에서 닿는다(§6-앞 6) — 구리 손·첫 브라켓·숙련 0 ----
      const earlyMinutes = minutesFor(first, earlyChances[tierIndex]!, earlyInterval)
      if (first > EARLY_FLOOR && earlyMinutes > EARLY_BUDGET_MINUTES) {
        // 위 형평 메시지와 같은 자세다 — 목표는 대역이 아니라 예산 하나(5분)라
        // 권장 값도 하나다.
        const rec = recommendedThreshold(first, earlyMinutes, EARLY_BUDGET_MINUTES)
        const fix = rec !== null ? ` → ${rec.toLocaleString('ko-KR')} 으로 적는다` : ''
        violations.push(
          `${slot}: 1단(${first}개)이 구리 손·첫 브라켓에서 ${minutesText(earlyMinutes)} 걸린다 — ${EARLY_BUDGET_MINUTES}분 안에 닿거나, 더 낮출 수 없는 ${EARLY_FLOOR}개여야 한다. 1단이 멀면 절벽(숙련 50만)까지 한 개도 안 바치는 것이 지배 전략이 되어 방의 숫자를 초반에 아무도 안 읽는다${fix}`,
        )
      }
    })
  }

  return violations
}
