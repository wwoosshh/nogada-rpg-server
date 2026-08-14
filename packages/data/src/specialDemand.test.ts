import type { GatherTableDef, ItemDef, RecipeDef, SkillId } from '@nogada/shared'
import { gatherIntervalMs } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { measureHand, tierChances } from './gatherMeasure.js'
import { isSpecialTableId } from './gatherTables.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * **특수 재료의 고정 수요를 분으로 잰다**(설계 §5·§10-3, §13-앞 11).
 *
 * 이 검사가 없던 동안 설계는 두 아크째 "재료마다 30~60분"을 약속만 하고 자를 안
 * 들었다. 최종 리뷰가 그 자리를 C1 으로 짚었고, 실제로 `frost_bloom` 이 제작
 * 순서에 따라 상한을 넘는 것도 그때 처음 드러났다.
 *
 * **왜 다른 검사로는 못 잡는가.** `gatherTables` 의 천장·바닥은 표끼리의 관계를 재고,
 * `collection` 의 형평은 도감 칸을 잰다. 둘 다 "그 재료를 실제로 몇 개 써야 하고
 * 그것이 몇 분인가"는 안 본다 — 그 물음만이 특수 노드에 **가는 이유**의 크기를
 * 재는 자다.
 */

/** 재는 자리: 구리 손(1티어) · 증표 없음 · 강화 0 · 연속 채집 · 채집 숙련 85,000 고정. */
const MEASURE_PROFICIENCY = 85_000

/**
 * 설계 §5 의 대역. 아래면 특수 노드에 갈 이유가 얇고, 위면 세금이 된다.
 *
 * **하한과 상한이 서로 다른 자에 기대어 선다.** 하한은 이 검사 혼자 문다(실측:
 * `wood_special ≤290000` 의 `cum1` 을 42 → 48 로 되돌리면 26.5분으로 빨개진다).
 * 상한은 `gatherTables` 의 바닥(최상위 확률이 브라켓마다 ×1.2)과 울타리를 함께
 * 친다 — 재료를 상한 밖으로 밀 만큼 드물게 만들면 그전에 바닥이 먼저 짖는다.
 * 그래서 상한만 단독으로 무는 돌연변이는 만들기 어렵고, 그것은 구멍이 아니라
 * 두 검사가 겹쳐 선 자리다.
 */
const DEMAND_MIN_MINUTES = 30
const DEMAND_MAX_MINUTES = 60

/**
 * 제작 실패가 재료를 얼마나 더 먹는가 — `craftService.ts:130` 이 실패 시
 * `Math.ceil(count / 2)` 를 소모한다.
 *
 * **`count` 가 홀수면 절반이 절반이 아니다.** 4단 레시피의 재료는 전부 3개라
 * 실패 한 번이 2개를 먹는다 — 설계와 계획이 적은 `1 + 0.5·(1/c − 1)` 은 짝수
 * 전제의 식이고, 참값은 `1 + (ceil(n/2)/n)·(1/c − 1)` 이다. c=0.42 에서 적힌
 * 1.69 가 아니라 **1.92** 다. 문서 두 곳이 그래서 틀렸다(리뷰 m1).
 */
function wasteMultiplier(count: number, successChance: number): number {
  return 1 + (Math.ceil(count / 2) / count) * (1 / successChance - 1)
}

/**
 * 그 재료가 그 계열 특수 표에서 분당 몇 개 나오는가.
 *
 * **손 통과 확률로 낸다.** 표의 누적을 그대로 쓰면 접힌 손에서 틀린다 —
 * `tierChances` 주석이 아크 B 가 그 실수를 한 자리를 적어 두었다.
 */
function perMinute(table: GatherTableDef, itemId: string, items: Record<string, ItemDef>): number {
  const hand = measureHand(table.skill, items, 1, false, 0)
  if (!hand) throw new Error(`${table.skill} 계열의 1티어 도구가 없어 잴 수 없다`)
  const bracket = table.brackets.find((b) => b.bracketMax === null || b.bracketMax >= MEASURE_PROFICIENCY)
  if (!bracket) throw new Error(`${table.id} 에 숙련 ${MEASURE_PROFICIENCY} 를 받는 브라켓이 없다`)
  const index = table.tiers.findIndex((t) => t.itemId === itemId)
  if (index < 0) throw new Error(`${table.id} 의 사다리에 ${itemId} 가 없다`)
  const chance = tierChances(bracket.cumulative, hand)[index]!
  return (chance * 60_000) / gatherIntervalMs(MEASURE_PROFICIENCY, hand)
}

describe('특수 재료의 고정 수요를 분으로 잰다 — 설계 §5 의 30~60분', () => {
  const data = loadGameData()
  const tables = loadGatherTables()

  /** 특수 표의 최상위 티어가 그 계열의 특수 재료다 — 표에서 유도한다(목록을 손으로 안 적는다). */
  const specials = Object.values(tables)
    .filter((t) => isSpecialTableId(t.id))
    .map((t) => ({ table: t, itemId: t.tiers[0]!.itemId }))

  it('특수 표가 계열마다 하나씩 넷이다 — 목록을 손으로 안 적으므로 여기서 센다', () => {
    expect(specials).toHaveLength(4)
    expect(new Set(specials.map((s) => s.table.skill))).toEqual(new Set<SkillId>(['ice', 'wood', 'mineral', 'herb']))
  })

  /**
   * 수요의 정의는 설계 §4 다 — **도구 넷을 각 한 자루씩.** 강화는 안 센다:
   * `enhance_costs.csv` 의 4단은 `hard_log·lavender·pure_ice·iron_ore` 만 먹고
   * 특수 재료를 안 먹는다(계획서가 "6자루 분"이라 적은 것은 낡았다, 리뷰 m2).
   */
  it('넷 다 30~60분 안이다 — 채집 비용만으로 잰다', () => {
    const recipes = Object.values(data.recipes).filter((r) => r.output.item.startsWith('starfall_'))
    expect(recipes, '4단 도구 레시피 넷').toHaveLength(4)

    const report: string[] = []
    for (const { table, itemId } of specials) {
      const needed = recipes.reduce((sum, r: RecipeDef) => {
        const input = r.inputs.find((i) => i.item === itemId)
        if (!input) return sum
        return sum + input.count
      }, 0)
      const minutes = needed / perMinute(table, itemId, data.items)
      report.push(`${itemId} ${needed.toFixed(1)}개 = ${minutes.toFixed(1)}분`)
      const at = `${itemId}(${table.id}) — 구리 손·숙련 ${MEASURE_PROFICIENCY.toLocaleString('ko-KR')}: ${report.at(-1)}`
      expect(minutes, at).toBeGreaterThanOrEqual(DEMAND_MIN_MINUTES)
      expect(minutes, at).toBeLessThanOrEqual(DEMAND_MAX_MINUTES)
    }
  })

  /**
   * **실패 소모는 대역에 안 넣는다 — 플레이어가 스스로 줄이는 축이기 때문이다.**
   *
   * 갓 열린 자리(조합 50,000·진행도 0)에서는 성공률이 `baseChance` 0.40 이라 배수가
   * ×2.0 이지만, 네 자루를 만드는 동안 `skillGain` 150~250 이 쌓여 마지막에는
   * 0.74 가 된다. 조합을 먼저 올린 사람은 0.98 이라 배수가 ×1.02 다. 즉 같은 데이터가
   * 플레이어에 따라 ×1.02~×2.0 사이를 오간다 — 그것을 대역에 넣으면 이 검사는 표가
   * 아니라 플레이 순서를 재게 된다.
   *
   * 대신 **크기를 여기서 못박는다.** 배수가 ×2 를 넘기 시작하면 위 대역이 뜻을 잃으므로
   * 그때는 대역이 아니라 이 상수(또는 레시피의 `baseChance`)를 다시 봐야 한다.
   */
  it('실패 소모 배수는 최악에서도 ×2 를 넘지 않는다 — 대역 밖의 축이지만 크기는 안다', () => {
    const recipe = Object.values(data.recipes).find((r) => r.output.item === 'starfall_chisel')!
    const worst = wasteMultiplier(3, recipe.baseChance)
    expect(worst).toBeCloseTo(2.0, 2)
  })
})
