import type { CollectionTable, GameData, GatherTableDef, GatherTables, ItemDef } from '@nogada/shared'
import { COLLECTION_MAX_GRADE, collectionScore } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { parseCollection, validateCollection } from './collection.js'
import { loadGameData } from './load.js'
import { isSpecialTableId } from './gatherTables.js'
import { loadGatherTables } from './loadGatherTables.js'

type Row = Record<string, string>

const row = (itemId: string, t1: string, t2: string, t3: string, t4: string): Row => ({ itemId, t1, t2, t3, t4 })

const shipped = loadGameData()
const tables = loadGatherTables()

/**
 * 출하 데이터를 바탕으로 **한 군데만 일부러 망가뜨린** GameData.
 *
 * 가짜 표를 새로 짓지 않는 이유는 gatherSimulation.test.ts 와 같다: 형평 검증이
 * 재는 것은 확률과 간격이라, 손으로 지은 표에서 "몇 분"은 아무 뜻이 없다.
 * 출하 표 위에서 문턱 하나만 옮기면 각 테스트가 **무엇을 바꿨을 때 무엇이
 * 빨개지는가**를 한 줄로 드러낸다. loadGameData 는 깊이 동결돼 있으므로
 * 언제나 사본을 만든다.
 */
function dataWith(collection: CollectionTable, items: Record<string, ItemDef> = shipped.items): GameData {
  return { ...shipped, items, collection }
}

/** 출하 문턱표의 한 칸만 바꾼 사본. */
function stepsOf(itemId: string, steps: [number, number, number, number]): CollectionTable {
  return { ...shipped.collection, [itemId]: { itemId, steps } }
}

const check = (
  collection: CollectionTable,
  items?: Record<string, ItemDef>,
  measured: GatherTables = tables,
): string[] => validateCollection(dataWith(collection, items), measured)

/**
 * 출하 얼음 표 옆에 심층 표 하나를 세운 사본 — B2 가 놓을 자리를 미리 흉내 낸다.
 *
 * 심층 표의 확률을 일부러 어긋나게 둔다. 첫 브라켓은 거의 아무것도 안 나오는
 * 구간이고(결계 뒤라 구리 손·숙련 0 은 여기 설 수 없다), ∞ 는 최상 티어가
 * 흔한 구간이다. 그래서 같은 표 하나로 두 가지를 한꺼번에 보인다: **재는 표가
 * 아니면 검증이 조용하고, 재는 표가 되는 순간 같은 값이 빨개진다.**
 */
function withDeepIce(equity: { outer: boolean; deep: boolean }): GatherTables {
  const outer = tables['ice']!
  const deep: GatherTableDef = {
    ...outer,
    id: 'ice_deep',
    equity: equity.deep,
    brackets: [
      { bracketMax: 85_000, cumulative: [1, 2, 3, 4, 5] },
      { bracketMax: null, cumulative: [90_000, 92_000, 94_000, 96_000, 100_000] },
    ],
  }
  return { ...tables, ice: { ...outer, equity: equity.outer }, ice_deep: deep }
}

describe('parseCollection', () => {
  it('한 줄이 한 칸이고 문턱 넷을 순서대로 읽는다 — 화면이 "0/50" 을 적으려면 요구치가 데이터에 있어야 한다(§6-앞 3)', () => {
    const table = parseCollection([row('copper_ore', '50', '130', '430', '1300')])
    expect(table['copper_ore']).toEqual({ itemId: 'copper_ore', steps: [50, 130, 430, 1300] })
  })

  it('같은 아이템을 두 줄 적으면 던진다 — 한 칸의 요구치가 둘이면 어느 쪽이 이기는지 아무도 모른다', () => {
    expect(() => parseCollection([row('copper_ore', '1', '2', '3', '4'), row('copper_ore', '5', '6', '7', '8')])).toThrow(
      /copper_ore/,
    )
  })

  it('문턱 칸이 비어 있으면 던진다 — 빈 칸을 0 으로 접으면 아무도 안 바친 칸이 등급을 갖는다', () => {
    expect(() => parseCollection([row('copper_ore', '50', '', '430', '1300')])).toThrow(/t2/)
  })

  it('숫자가 아닌 문턱은 던진다', () => {
    expect(() => parseCollection([row('copper_ore', '50', '많이', '430', '1300')])).toThrow(/t2/)
  })
})

describe('validateCollection — 출하 데이터', () => {
  it('출하 문턱표가 검증을 통과한다', () => {
    expect(validateCollection(shipped, tables)).toEqual([])
  })

  it('칸이 채집물 25종 전부이고 만점이 100 이다 — 25 × 4(§6-앞 4)', () => {
    // **집합으로 센다.** 표가 계열마다 둘(바깥·심층)이 된 뒤로 같은 아이템이
    // 두 표의 사다리에 나타난다 — 그것이 결계의 요점이다(문 너머는 같은 25종을
    // 캐지만 분포가 다르다). 목록으로 세면 25칸이 50줄로 보이고, 그 순간 이
    // 단언은 "심층 표가 새 칸을 만들지 않았다"는 **지켜야 할 성질**을 증명하는
    // 대신 표 개수를 세는 단언이 된다.
    // **특수 표는 빼고 센다**(노드 종류 §6-5). 특수 재료는 수집물이 아니라 4단
    // 도구를 여는 열쇠라 칸을 만들지 않는다 — 세면 만점이 100 에서 움직인다.
    const gathered = new Set(
      Object.values(tables)
        .filter((t) => !isSpecialTableId(t.id))
        .flatMap((t) => t.tiers.map((tier) => tier.itemId)),
    )
    expect(Object.keys(shipped.collection).sort()).toEqual([...gathered].sort())
    const everything = Object.fromEntries([...gathered].map((id) => [id, Number.MAX_SAFE_INTEGER]))
    expect(collectionScore(everything, shipped.collection)).toBe(25 * COLLECTION_MAX_GRADE)
  })
})

describe('validateCollection — 칸 목록은 gather_tiers.csv 가 정한다(§6-앞 4)', () => {
  it('채집물인데 칸이 없으면 위반이다 — 그 재료는 캘 수 있는데 방에 자리가 없고 만점이 100 이 아니게 된다', () => {
    const { copper_ore: _removed, ...missing } = shipped.collection
    expect(check(missing)).toEqual([expect.stringContaining('copper_ore')])
  })

  it('채집물이 아닌 칸은 위반이다 — 정제품·증표는 만든 것이라 영원히 0등급인 칸이 된다(§6-앞 4)', () => {
    // t2·t3 를 t4 의 10%·30%(중간 두 단 형평의 대역 안)로 둔다 — 이 테스트가
    // 보려는 것은 "칸 목록에 없는 아이템" 위반 하나이지 형평이 아니다.
    const extra = {
      ...shipped.collection,
      mithril_ingot: { itemId: 'mithril_ingot', steps: [1, 100, 300, 1000] as [number, number, number, number] },
    }
    expect(check(extra)).toEqual([expect.stringContaining('mithril_ingot')])
  })
})

describe('validateCollection — 문턱의 모양', () => {
  it('문턱이 순증가가 아니면 위반이다 — 같은 값은 한 번 바쳐서 두 등급이 오르는 칸이다', () => {
    expect(check(stepsOf('copper_ore', [50, 130, 130, 1300]))).toEqual([expect.stringContaining('t3')])
  })

  it('문턱이 내려가면 위반이다 — 아무도 못 넘는 단이 생긴다', () => {
    expect(check(stepsOf('copper_ore', [50, 130, 430, 400]))).toEqual([expect.stringContaining('t4')])
  })

  it('t1 이 0 이면 위반이다 — 아무도 안 바친 방의 총점이 0 이 아니게 된다', () => {
    const violations = check(stepsOf('copper_ore', [0, 130, 430, 1300]))
    expect(violations).toEqual([expect.stringContaining('t1')])
  })
})

describe('validateCollection — 형평(§6-앞 5)', () => {
  it('균일 문턱은 거절된다 — 같은 4단인데 은 원석이 금 원석보다 13배 오래 걸린다(이 검증의 존재 이유)', () => {
    const uniform: CollectionTable = Object.fromEntries(
      Object.keys(shipped.collection).map((itemId) => [itemId, { itemId, steps: [1, 100, 1000, 5000] }]),
    )
    const violations = check(uniform)
    // 가장 흔한 칸(금 원석)은 너무 빨리, 가장 드문 칸(은 원석)은 너무 오래 —
    // 균일 문턱이 기울이는 양 끝이 둘 다 이름으로 불린다.
    expect(violations.some((v) => v.includes('gold_ore'))).toBe(true)
    expect(violations.some((v) => v.includes('silver_ore'))).toBe(true)
    expect(violations.length).toBeGreaterThan(20)
  })

  // t2·t3 를 t4 와 같은 비(10%·33%)로 함께 올려 둔다 — 그러지 않으면 이 t4(13,000)
  // 앞에서 t2·t3 가 중간 두 단 형평(아래 describe)에도 걸려, 이 테스트가 보려는
  // "4단 형평" 위반보다 먼저 그 위반이 나서 307.5분 메시지 자체가 안 생긴다.
  it('4단이 대역보다 크면 위반이고, 메시지가 몇 분인지·권장 범위를 적는다 — 읽는 사람은 CSV 작가다', () => {
    const violations = check(stepsOf('copper_ore', [50, 1300, 4300, 13_000]))
    expect(violations).toEqual([expect.stringContaining('copper_ore')])
    expect(violations[0]).toMatch(/307\.5분/)
    // 작가가 "13000 × 25 / 307.5" 를 손으로 곱하지 않게, 메시지가 그 계산을
    // 대신 해서 대역 양 끝의 권장 문턱을 적는다.
    expect(violations[0]).toMatch(/→ [\d,]+~[\d,]+ 사이로 적는다/)
  })

  // t2·t3 도 t4(500)와 같은 비로 낮춰 둔다 — 안 그러면 500 앞에서 t3(430)가
  // 86%가 되어 중간 두 단 형평 위반이 먼저 나고, 이 테스트가 보려는 "너무 쉽다"
  // 라는 4단 형평 위반 자체가 안 생긴다.
  it('4단이 대역보다 작아도 위반이다 — 너무 쉬운 칸은 총점을 공짜로 만든다', () => {
    expect(check(stepsOf('copper_ore', [50, 60, 180, 500]))).toEqual([expect.stringContaining('copper_ore')])
  })

  it('선별증표가 없는 계열은 최적손을 지을 수 없어 형평을 못 잰다고 말한다 — 조용히 다른 손으로 재지 않는다', () => {
    // 손이 없으면 그 계열의 일곱 칸이 전부 "재지 못했다"인데, 원인은 하나다 —
    // 그래서 위반도 계열마다 하나다(칸마다 일곱 번 같은 말을 하지 않는다).
    const { mineral_sight_token: _removed, ...items } = shipped.items
    expect(check(shipped.collection, items)).toEqual([expect.stringContaining('최적손')])
  })
})

describe('validateCollection — 계열마다 재는 표가 하나(결계 §9-앞 1·2)', () => {
  it('계열에 재는 표가 없으면 위반이다 — 검증이 사라진 것을 아무도 모르면 그 계열의 일곱 칸이 조용히 안 재인다', () => {
    const blind = { ...tables, ice: { ...tables['ice']!, equity: false } }
    const violations = check(shipped.collection, undefined, blind)
    expect(violations).toHaveLength(1)
    // 읽는 사람은 CSV 작가다 — 어느 계열인지, 어느 파일 어느 칸에 무엇을 적는지.
    expect(violations[0]).toContain('gather_tables.csv')
    expect(violations[0]).toContain('ice')
    expect(violations[0]).toContain('equity')
  })

  it('계열에 재는 표가 둘이면 위반이다 — 한 칸의 t4 가 두 표의 ∞ 를 동시에 만족해야 해서 어떤 문턱으로도 빌드가 안 선다', () => {
    const violations = check(shipped.collection, undefined, withDeepIce({ outer: true, deep: true }))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('ice_deep')
    expect(violations[0]).toContain('equity')
  })

  it('재는 표가 아닌 표는 형평도 조기도달도 안 재인다 — 출하 25칸이 심층 표 옆에서 그대로 통과한다(회귀 0)', () => {
    expect(check(shipped.collection, undefined, withDeepIce({ outer: true, deep: false }))).toEqual([])
  })

  it('그 표가 대표가 되는 순간 같은 값이 빨개진다 — 가림이 무르지 않다는 증거', () => {
    const violations = check(shipped.collection, undefined, withDeepIce({ outer: false, deep: true }))
    // 형평(∞ 가 너무 후하다)과 조기도달(첫 브라켓이 너무 박하다)이 둘 다 뜬다 —
    // 가림이 없애는 것이 검사 하나가 아니라 안전망 둘이라는 뜻이다.
    expect(violations.some((v) => v.includes('ice_gem') && v.includes('최적손'))).toBe(true)
    expect(violations.some((v) => v.includes('ice_shard') && v.includes('구리 손'))).toBe(true)
    // 다른 세 계열은 대표 표가 그대로라 조용하다.
    expect(violations.some((v) => v.includes('copper_ore'))).toBe(false)
  })
})

describe('validateCollection — 중간 두 단(t2·t3)의 형평(§6-앞 5)', () => {
  it('t2 가 t4 의 50% 를 넘으면 위반이고 허용 범위를 숫자로 말한다 — 중간 단이 4단에 붙으면 사다리가 접힌다', () => {
    const violations = check(stepsOf('mithril_ore', [1, 6999, 7000, 7100]))
    const t2Violation = violations.find((v) => v.includes('t2('))
    expect(t2Violation).toBeDefined()
    expect(t2Violation).toContain('98.6%')
    expect(t2Violation).toContain('355~3550')
  })

  it('t2 가 t4 의 5% 미만이면 위반이다 — 반대쪽(1단)에 붙어도 같은 일이 일어난다', () => {
    const violations = check(stepsOf('copper_ore', [10, 30, 430, 1300]))
    const t2Violation = violations.find((v) => v.includes('t2('))
    expect(t2Violation).toBeDefined()
    expect(t2Violation).toContain('2.3%')
    expect(t2Violation).toContain('65~650')
  })
})

describe('validateCollection — 1단은 절벽 앞에서 닿는다(§6-앞 6)', () => {
  it('1단이 구리 손·첫 브라켓에서 5분을 넘기면 위반이다 — 절벽까지 한 개도 안 바치는 것이 지배 전략이 된다', () => {
    const violations = check(stepsOf('ice_shard', [600, 630, 2100, 6300]))
    expect(violations).toEqual([expect.stringContaining('ice_shard')])
    expect(violations[0]).toMatch(/11\.1분/)
    // 4단 형평 메시지와 같은 자세다 — 작가가 "600 × 5 / 11.1" 을 손으로
    // 곱하지 않게, 메시지가 권장 문턱 하나를 대신 계산해 적는다.
    expect(violations[0]).toMatch(/→ [\d,]+ 으로 적는다/)
  })

  it('그 손으로 몇 시간이 걸리는 잭팟 칸은 1단이 한 개면 통과한다 — 더 낮출 수 없는 값이라 표를 고치라는 뜻이 되면 안 된다', () => {
    expect(check(stepsOf('mithril_ore', [1, 710, 2400, 7100]))).toEqual([])
  })

  it('그 잭팟 칸의 1단이 2 가 되는 순간 빨개진다 — 예외가 무르지 않다는 증거', () => {
    const violations = check(stepsOf('mithril_ore', [2, 710, 2400, 7100]))
    expect(violations).toEqual([expect.stringContaining('mithril_ore')])
    expect(violations[0]).toMatch(/416\.7분/)
  })
})

// ---- 특수 표(노드 종류 §6-4·6-5) ----
//
// 특수 표는 `equity` 가 false 라 위 형평 순회에서 빠진다. 그 가림이 **칸 목록에도**
// 필요하고(특수 재료는 수집물이 아니라 열쇠다), 동시에 **형평에는 필요하지 않다** —
// 특수 표가 같은 아이템의 훨씬 빠른 출처가 되면 도감의 안전망이 조용히 무너진다.

/**
 * 얼음 특수 표 하나를 세운 사본. **∞ 에서 잡티어(얼음 조각)가 차지하는 몫**을
 * 인자로 받는다 — 그 몫이 곧 이 표가 그 칸의 얼마나 빠른 출처인가다.
 *
 * **최적손은 roll 을 접으므로**(rollFactor × 선별) 바깥 표의 마지막 티어는 그 접힘
 * 위쪽을 잃는데, 특수 표의 두 칸짜리 사다리는 전부 접힘 아래라 몫을 그대로 지킨다.
 * 그래서 "바깥과 같은 31%" 로는 모자라고 실측 상한이 약 16,000 이다. 특수 표가 그보다 두껍게 주면
 * 그 칸의 t4 문턱이 대표 표만 보고 정해진 뜻을 잃는다.
 */
function withIceSpecial(shardShareAtInfinite: number): GatherTables {
  const outer = tables['ice']!
  const cum1 = [20, 25, 31, 38, 46, 61]
  const special: GatherTableDef = {
    ...outer,
    id: 'ice_special',
    equity: false,
    tiers: [{ itemId: 'hot_ice' }, { itemId: 'ice_shard' }],
    brackets: outer.brackets.map((bracket, i) => ({
      bracketMax: bracket.bracketMax,
      cumulative: [
        cum1[i]!,
        bracket.bracketMax === null ? cum1[i]! + shardShareAtInfinite : bracket.cumulative.at(-1)!,
      ],
    })),
  }
  return { ...tables, ice_special: special }
}

describe('validateCollection — 특수 표는 칸을 안 만들고, 그래도 형평에는 재인다', () => {
  /**
   * 칸 유도를 좁히는 술어가 `!table.equity` 면 안 되는 이유를 이 스위트가 진다.
   * `equity` 는 "형평을 재는 대표 표"라는 뜻이라 심층 표도 false 다 — 그것으로
   * 좁히면 `ice.equity=false` 같은 **고장 상태**에서 원인 하나(대표 표가 없다)가
   * "얼음 조각은 채집물이 아니다" 다섯 줄을 더 낳는다. 이 파일 자신이 금지한
   * 자세다(원인 하나를 위반 둘로 보고하지 않는다).
   */
  it('대표 표가 없는 고장 상태에서도 위반은 한 줄이다 — 칸 목록이 equity 에 딸려 오면 안 된다', () => {
    const blind = { ...tables, ice: { ...tables['ice']!, equity: false } }
    expect(check(shipped.collection, undefined, blind)).toHaveLength(1)
  })

  it('특수 표만 가진 아이템은 칸이 없어도 된다 — 특수 재료는 수집물이 아니라 열쇠다', () => {
    // `hot_ice` 는 `collection.csv` 에 없다. 특수 표를 칸 유도에서 안 빼면
    // "채집물인데 칸이 없다"로 빌드가 선다.
    expect(check(shipped.collection, undefined, withIceSpecial(15_000))).toEqual([])
  })

  /**
   * **천장을 잘 통과할수록 형평이 더 깨진다.** 특수 표의 ∞ 를 얼음 조각으로 채우면
   * 그 표의 분당 골드는 바깥의 0.01배로 내려가(천장 통과) 도감 t4 도달은
   * 29.8분 → 5.3분이 된다. 형평이 대표 표만 보면 이 표는 초록이다.
   */
  it('특수 표가 같은 칸의 훨씬 빠른 출처가 되면 위반이다 — 형평은 특수 표까지 봐야 한다', () => {
    const violations = check(shipped.collection, undefined, withIceSpecial(99_000))
    expect(violations.join('\n')).toMatch(/ice_shard[\s\S]*ice_special/)
  })

  it('특수 표가 대표 표보다 느린 출처면 아무 말도 안 한다 — 옆길은 느려도 된다', () => {
    expect(check(shipped.collection, undefined, withIceSpecial(15_000))).toEqual([])
  })
})
