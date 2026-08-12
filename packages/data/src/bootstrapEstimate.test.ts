import {
  GATHER_ROLL_MAX,
  JACKPOT_BAND_MAX,
  actionIntervalMs,
  calcCraftSuccess,
  gatherBracketFor,
  gatherHandOf,
  gatherIntervalMs,
  type GatherTableDef,
  type RecipeDef,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { emptyPlayer } from './emptyPlayer.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * 부트스트랩 페이싱 계약(§6-앞 4) — **최악 마을에서 첫 구리 도구까지의 기대 시간.**
 *
 * 최악 마을은 눈의마을·항구마을이다: 자기 도구(정·낫)는 구리 원석에도 무른
 * 통나무에도 쓸모가 없어, 두 재료를 전부 **맨손으로** 모은다(§6-앞 4 의 "2필드
 * 원정" — 도보는 이 추정에 넣지 않는다, 걸음은 상수가 아니라 손이기 때문이다).
 *
 * 숫자를 어디서도 복사하지 않는다: 확률은 출하되는 표(gather-tables)를
 * gatherOutcome 과 같은 두 갈래 식으로 전수(100001가지)로 세고, 간격은
 * gatherIntervalMs·actionIntervalMs, 성공률은 calcCraftSuccess, 재료는
 * recipes.csv 를 그대로 읽는다 — **표·레시피·프로필을 재조정하면 이 추정이
 * 함께 움직인다.** 그 재조정이 페이싱을 어디로 옮겼는지 아래 핀이 말한다.
 *
 * 페이싱 목표의 재정정(§6-앞 4, 2026-08-12): 이 추정이 처음 나왔을 때 스펙은
 * "10분±"를 말했지만 현행 상수로는 산술적으로 불가능했고(≈1.1분 — 750ms 간격
 * × 원석 13.7%·통나무 28.9% × 기대 재료 16개), 검토 끝에 목표 쪽을 고쳤다:
 * 첫 도구의 서사는 채집이 아니라 **원정**이다. 순수 채집·제작 0.8~2.5분이
 * 계약이고, 체감 시간의 나머지는 두 필드를 오가는 도보가 채운다(활동 ~5분,
 * 4종 풀킷 ~15분). 긴 고통은 부트스트랩이 아니라 브라켓·강화·미스릴의 몫이다.
 */

const data = loadGameData()
const tables = loadGatherTables()

/**
 * 맨손 — 도구도 증표도 없는 사람의 손이고, 부트스트랩 시기의 손이 정확히 그것이다.
 * 리터럴로 짓지 않고 실제 조회(gatherHandOf)를 태우는 이유는 이 추정이 게임과
 * 같은 경로를 지나야 하기 때문이다(§7-앞 12).
 */
const bareHand = gatherHandOf(emptyPlayer(), 'mineral', data.items)

/**
 * 맨손·해당 숙련의 브라켓에서 그 아이템이 나올 정확한 확률 — 근사식 대신
 * gatherOutcome 과 똑같은 두 갈래 식(잭팟 밴드는 평감산, 밖은 곱)으로 rawRoll
 * 전수를 센다(gatherSimulation.test.ts 의 §8-5 와 같은 방식, 같은 이유).
 */
function exactBareHandItemProbability(table: GatherTableDef, proficiency: number, itemId: string): number {
  const { rollFactor, jackpotFlat } = bareHand.profile
  const bracket = gatherBracketFor(table, proficiency)
  let count = 0
  for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
    const roll =
      rawRoll <= JACKPOT_BAND_MAX ? Math.max(0, rawRoll - jackpotFlat) : Math.floor(rawRoll * rollFactor)
    const tierIndex = bracket.cumulative.findIndex((c) => roll <= c)
    if (tierIndex >= 0 && table.tiers[tierIndex]?.itemId === itemId) count += 1
  }
  return count / (GATHER_ROLL_MAX + 1)
}

/** 갓 열린 레시피의 성공률 — 숙련도가 요구치와 정확히 같은, 망치도 강화도 없는 손. */
function freshChance(recipe: RecipeDef): number {
  return calcCraftSuccess({ proficiency: recipe.requiredSkill, toolTier: 0, enhanceLevel: 0, recipe })
}

/**
 * 성공 1개당 기대 재료 — 실패는 절반(올림)을 소모한다(craftService 의 반소모
 * 규칙과 같은 식: 성공 count, 실패 ceil(count/2)). 성공 1개까지의 기대 실패
 * 횟수는 (1−p)/p 다.
 */
function expectedInputsPerSuccess(recipe: RecipeDef, chance: number): Map<string, number> {
  const failuresPerSuccess = (1 - chance) / chance
  const out = new Map<string, number>()
  for (const input of recipe.inputs) {
    out.set(input.item, input.count + failuresPerSuccess * Math.ceil(input.count / 2))
  }
  return out
}

describe('부트스트랩 시뮬 추정 — 최악 마을(재료 둘 다 맨손)에서 첫 구리 도구까지(§6-앞 4)', () => {
  const toolRecipe = data.recipes['copper_pickaxe']!
  const ingotRecipe = data.recipes['copper_ingot']!
  const mineralTable = tables['mineral']!
  const woodTable = tables['wood']!

  it('구리 도구 4종의 값이 같다 — 어느 마을이 무엇을 먼저 만들든 첫 도구의 비용은 하나다', () => {
    for (const id of ['copper_chisel', 'copper_axe', 'copper_sickle']) {
      const recipe = data.recipes[id]!
      expect(recipe.inputs).toEqual(toolRecipe.inputs)
      expect(recipe.baseChance).toBe(toolRecipe.baseChance)
      expect(recipe.requiredSkill).toBe(0)
    }
  })

  // ---- 기대값 계산 (전 과정 숙련 0 가정 — 아래 "첫 브라켓" 테스트가 근사의 정직함을 지킨다) ----

  const chanceTool = freshChance(toolRecipe)
  const chanceIngot = freshChance(ingotRecipe)

  const toolInputs = expectedInputsPerSuccess(toolRecipe, chanceTool)
  const ingotsNeeded = toolInputs.get('copper_ingot')!
  const logsNeeded = toolInputs.get('soft_log')!

  const ingotAttempts = ingotsNeeded / chanceIngot
  const oreNeeded = ingotsNeeded * expectedInputsPerSuccess(ingotRecipe, chanceIngot).get('copper_ore')!

  const pOre = exactBareHandItemProbability(mineralTable, 0, 'copper_ore')
  const pLog = exactBareHandItemProbability(woodTable, 0, 'soft_log')

  const oreAttempts = oreNeeded / pOre
  const logAttempts = logsNeeded / pLog

  // 채집 간격은 맨손(×1.5), 제작 간격은 도구 무관 — 서버 스탬프와 같은 함수다.
  const totalMs =
    (oreAttempts + logAttempts) * gatherIntervalMs(0, bareHand) +
    (ingotAttempts + 1 / chanceTool) * actionIntervalMs(0)
  const minutes = totalMs / 60_000

  it('추정 전 과정이 첫 브라켓 안에서 끝난다 — 숙련 0 확률로 전체를 세어도 정직한 이유', () => {
    // 숙련은 성패 무관 매 시도 오르지만(표의 skillGainMax 기준으로도), 필요한
    // 시도 수 × 최대 증가가 첫 브라켓 상한에 못 미치면 분포가 도중에 바뀌지 않는다.
    expect(oreAttempts * mineralTable.skillGainMax).toBeLessThanOrEqual(mineralTable.brackets[0]!.bracketMax!)
    expect(logAttempts * woodTable.skillGainMax).toBeLessThanOrEqual(woodTable.brackets[0]!.bracketMax!)
  })

  it('맨손 채집이 부트스트랩의 몸통이다 — 재료 모으기가 제작보다 압도적으로 길다', () => {
    // 첫 도구의 이야기가 "만들기 어려움"이 아니라 "맨손으로 힘겹게 모음"이라는
    // 설계(§1·§2)의 수치 표현이다. 제작이 몸통이 되는 순간 도구는 채집이 아니라
    // 조합의 보상이 된다.
    const gatherMs = (oreAttempts + logAttempts) * gatherIntervalMs(0, bareHand)
    expect(gatherMs / totalMs).toBeGreaterThan(0.9)
  })

  it('첫 구리 도구까지 기대 시간이 문서의 값에서 벗어나지 않는다 — 이 핀이 페이싱 계약이다', () => {
    // 스펙 §6-앞 4(2026-08-12 재정정): 첫 도구의 서사는 채집이 아니라 원정이다 —
    // 순수 채집·제작은 0.8~2.5분이 계약이고, 나머지 체감 시간은 두 필드를 오가는
    // 도보가 채운다(활동 ~5분, 4종 풀킷 ~15분). 이 범위를 벗어나면 상수 네 개
    // (맨손 배수·재료량·간격·성공률)를 함께 다시 풀어야 한다.
    expect(minutes).toBeGreaterThan(0.8)
    expect(minutes).toBeLessThan(2.5)
  })
})
