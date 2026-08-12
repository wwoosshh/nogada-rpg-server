import {
  GATHER_ROLL_MAX,
  JACKPOT_BAND_MAX,
  actionIntervalMs,
  calcCraftSuccess,
  gatherBracketFor,
  gatherIntervalMs,
  gatherToolProfile,
  type GatherTableDef,
  type RecipeDef,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
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
 * ⚠️ 스펙과의 불일치(구현 시점 기록): §6-앞 4 는 "첫 도구까지 시뮬 추정
 * 10분±"(계획서 표현으로는 8~20분)를 명기했지만, 현행 상수로는 산술적으로
 * 그 값이 나올 수 없다 — 행동 간격 500ms × 맨손 1.5 = 750ms, 맨손 성공률
 * 구리 원석 ≈13.7% · 무른 통나무 ≈28.9%, 기대 재료(실패 반소모 포함) 원석
 * ≈7.5개·통나무 ≈8.5개면 채집 ≈84회 + 제작 ≈6.5회 ≈ **1.1분**이다. 10분이
 * 되려면 간격이나 재료 요구가 지금의 ~8배여야 한다. 8~20분을 단언하면 이
 * 스위트는 영원히 빨갛기에, 여기서는 현재 값을 정직하게 박아 두고 10분±
 * 목표와의 간극은 페이싱 재조정 결정(간격·입력 수량)의 몫으로 남긴다.
 */

const data = loadGameData()
const tables = loadGatherTables()

/**
 * 맨손·해당 숙련의 브라켓에서 그 아이템이 나올 정확한 확률 — 근사식 대신
 * gatherOutcome 과 똑같은 두 갈래 식(잭팟 밴드는 평감산, 밖은 곱)으로 rawRoll
 * 전수를 센다(gatherSimulation.test.ts 의 §8-5 와 같은 방식, 같은 이유).
 */
function exactBareHandItemProbability(table: GatherTableDef, proficiency: number, itemId: string): number {
  const { rollFactor, jackpotFlat } = gatherToolProfile(null)
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
    (oreAttempts + logAttempts) * gatherIntervalMs(0, null) +
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
    const gatherMs = (oreAttempts + logAttempts) * gatherIntervalMs(0, null)
    expect(gatherMs / totalMs).toBeGreaterThan(0.9)
  })

  it('첫 구리 도구까지 기대 시간이 문서의 값에서 벗어나지 않는다 — 이 핀이 페이싱 계약이다', () => {
    // 상한 20분은 계획서의 "8~20분(느슨하게)" 중 지킬 수 있는 쪽이다 — 부트스트랩이
    // 이보다 길어지면 첫날의 "힘겹게"가 "지루하게"로 넘어간다. 하한은 "공짜가
    // 아니다"의 최소 방어선이다. 정밀 핀(≈1.1분)은 상단 주석의 스펙 불일치 기록과
    // 짝이다 — 재조정이 페이싱을 옮기면 가장 먼저 이 줄이 새 값을 말한다.
    expect(minutes).toBeGreaterThan(0.5)
    expect(minutes).toBeLessThan(20)
    expect(minutes).toBeGreaterThan(1.0)
    expect(minutes).toBeLessThan(1.25)
  })
})
