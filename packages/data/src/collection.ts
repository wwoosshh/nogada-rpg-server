import type {
  CollectionTable,
  CollectionThresholds,
  GameData,
  GatherHand,
  GatherTableDef,
  GatherTables,
  ItemDef,
  PlayerState,
  SkillId,
} from '@nogada/shared'
import {
  COLLECTION_MAX_GRADE,
  DEFAULT_APPEARANCE,
  ENHANCE_CAP,
  GATHER_ROLL_MAX,
  SKILL_IDS,
  emptyDialogueHistory,
  gatherHandOf,
  gatherIntervalMs,
  gatherRoll,
} from '@nogada/shared'
import { addUnique, requireCell, toInt } from './parse.js'

type Row = Record<string, string>

const FILE = 'collection.csv'

/** roll 의 정의역 크기 — roll ∈ 0~100000 이므로 확률의 분모는 100001 이다. */
const DOMAIN = GATHER_ROLL_MAX + 1

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
 * 형평·조기 도달을 재는 흉내 플레이어.
 *
 * `emptyPlayer()` 를 쓰지 않는 이유: 그 함수는 `loadGameData()`(구운
 * gamedata.json)를 읽는데, 이 검증은 **그 파일을 굽기 전에** 빌드 안에서
 * 돌아간다 — 지난 빌드의 산출물로 이번 표를 재게 되고, 첫 빌드(생성 폴더가
 * 비어 있는 클론)에서는 아예 못 읽는다. 손을 만드는 데 필요한 칸은 셋
 * (`equipped`·`instances`·`stacks`)뿐이고 나머지는 자리표시자다.
 */
function fakePlayer(): PlayerState {
  return {
    id: 'collection-check',
    name: '',
    appearance: DEFAULT_APPEARANCE,
    skills: Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as Record<SkillId, number>,
    stacks: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    donated: {},
    dialogueHistory: emptyDialogueHistory(),
    weather: null,
    location: { mapId: '', x: 0, y: 0 },
  }
}

/**
 * 그 계열의 손 하나를 **게임과 같은 경로로** 짓는다(`gatherHandOf`).
 *
 * 배수를 여기서 직접 곱하지 않는 이유는 gatherSimulation.test.ts 와 같다:
 * 장비 조회나 증표 곱이 깨진 날에도 이 검증만 초록이면, 검증이 현실이 아니라
 * 사본을 지키게 된다. 도구는 등급을 **카탈로그에서 유도한다** — 3티어를 상수로
 * 박으면 4티어 도구가 생기는 날 "최적손"이 조용히 옛 손이 된다.
 */
function handOf(
  skill: SkillId,
  items: Record<string, ItemDef>,
  toolTier: number | null,
  sight: boolean,
  enhanceLevel: number,
): GatherHand | null {
  const player = fakePlayer()

  if (toolTier !== null) {
    const tool = Object.values(items).find((item) => item.toolSkill === skill && item.toolTier === toolTier)
    if (!tool) return null
    player.instances = [{ instanceId: 'check', itemId: tool.id, enhanceLevel }]
    player.equipped = { [skill]: 'check' }
  }

  if (sight) {
    const token = Object.values(items).find((item) => item.tokenEffect === 'sight' && item.skill === skill)
    if (!token) return null
    player.stacks[token.id] = 1
  }

  return gatherHandOf(player, skill, items)
}

/** 그 계열 카탈로그의 가장 높은 도구 등급. 도구가 하나도 없으면 null(맨손밖에 없는 계열이다). */
function topToolTier(skill: SkillId, items: Record<string, ItemDef>): number | null {
  const tiers = Object.values(items)
    .filter((item) => item.toolSkill === skill && item.toolTier !== undefined)
    .map((item) => item.toolTier!)
  return tiers.length === 0 ? null : Math.max(...tiers)
}

/**
 * 그 브라켓에서 그 손이 각 티어를 뽑을 **정확한** 확률.
 *
 * 표본이 아니라 전수다(rawRoll 100001 가지) — 확률이 걸린 검증에서 "안 나왔다"와
 * "못 나온다"를 구별하지 못하면 곱하기 하나가 틀린 표가 조용히 통과한다.
 * 판정과 같은 함수(`gatherRoll`)를 부르는 것도 같은 이유다(설계 §6-앞 14 의 교훈).
 */
function tierChances(cumulative: readonly number[], hand: GatherHand): number[] {
  const counts = new Array<number>(cumulative.length).fill(0)
  for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
    const roll = gatherRoll(rawRoll, hand.profile)
    const index = cumulative.findIndex((cum) => roll <= cum)
    if (index >= 0) counts[index]! += 1
  }
  return counts.map((count) => count / DOMAIN)
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
    const [t1] = def.steps

    if (t1 <= 0) {
      violations.push(`${at}: t1 이 ${t1} 이다 — 아무도 안 바친 칸이 1등급이 되어 총점이 처음부터 0 이 아니게 된다`)
    }

    for (let i = 1; i < def.steps.length; i++) {
      const prev = def.steps[i - 1]!
      const cur = def.steps[i]!
      if (cur <= prev) {
        violations.push(
          `${at}: 문턱이 순증가가 아니다 — t${i + 1}(${cur}) 가 t${i}(${prev}) 이하다. 한 번 바쳐서 두 등급이 오르거나, 아무도 못 넘는 단이 생긴다`,
        )
      }
    }
  }

  // 칸 목록이 어긋난 채로 시간을 재면 "없는 표의 칸"을 묻게 되어 원인 하나가
  // 위반 여럿이 된다 — validate.ts 가 참조 위반이 있으면 도달 가능성 검사를
  // 미루는 것과 같은 저울이다.
  if (violations.length > 0) return violations

  // 시간은 **표 단위로** 잰다(칸 단위가 아니라). 손과 확률은 계열이 소유하는
  // 것이라 한 표의 일곱 칸이 같은 답을 나눠 쓰고, 전수 셈(100,001회)은 손마다
  // 한 번이면 된다 — 칸마다 다시 세면 같은 답을 25번 만든다.
  for (const table of Object.values(tables)) {
    const skill = table.skill
    const at = `${FILE}(${table.id} 계열)`

    const topTier = topToolTier(skill, data.items)
    const best = topTier === null ? null : handOf(skill, data.items, topTier, true, ENHANCE_CAP)
    if (!best) {
      violations.push(
        `${at}: ${skill} 계열의 최적손(가장 높은 등급 도구 + 선별증표)을 items.csv 에서 찾을 수 없어 형평을 잴 수 없다`,
      )
      continue
    }
    const copper = handOf(skill, data.items, 1, false, 0)
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
        violations.push(
          `${slot}: 4단(${top}개)이 최적손·최종 브라켓에서 ${minutesText(bestMinutes)} 걸린다 — 목표 대역은 ${EQUITY_MIN_MINUTES}~${EQUITY_MAX_MINUTES}분이다. 문턱은 그 칸의 드랍 비율에 반비례해야 하고, 균일 문턱은 계열·티어 사이를 13배까지 기울인다`,
        )
      }

      // ---- 1단은 절벽 앞에서 닿는다(§6-앞 6) — 구리 손·첫 브라켓·숙련 0 ----
      const earlyMinutes = minutesFor(first, earlyChances[tierIndex]!, earlyInterval)
      if (first > EARLY_FLOOR && earlyMinutes > EARLY_BUDGET_MINUTES) {
        violations.push(
          `${slot}: 1단(${first}개)이 구리 손·첫 브라켓에서 ${minutesText(earlyMinutes)} 걸린다 — ${EARLY_BUDGET_MINUTES}분 안에 닿거나, 더 낮출 수 없는 ${EARLY_FLOOR}개여야 한다. 1단이 멀면 절벽(숙련 50만)까지 한 개도 안 바치는 것이 지배 전략이 되어 방의 숫자를 초반에 아무도 안 읽는다`,
        )
      }
    })
  }

  return violations
}
