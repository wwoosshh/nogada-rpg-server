import { describe, expect, it } from 'vitest'
import {
  createRng,
  gatherOutcome,
  GATHER_ROLL_MAX,
  JACKPOT_BAND_MAX,
  jackpotFlatBonus,
  toolGatherFactor,
  type GatherTableDef,
  type ItemDef,
} from '@nogada/shared'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * 설계 §8 성공 기준 1·2·4·5 의 시뮬 증명 — **실제로 출하되는 표**를 굴린다.
 *
 * §7-앞 12 는 이 증명을 "shared 의 vitest"로 적었지만, shared 는 data 에
 * 의존할 수 없다(의존 방향: data → shared). 표의 사본을 shared 테스트에 박아
 * 두면 CSV 가 바뀔 때 사본만 조용히 낡는다 — 그래서 증명은 표를 소유한
 * packages/data 에 살고, 판정 함수(gatherOutcome)는 shared 의 실물을 그대로
 * 부른다. 경계·부등호·보정의 단위 증명은 shared 의 gatherTable.test.ts 에 있다.
 *
 * 전부 고정 시드의 결정적 시뮬이다 — 실행마다 답이 바뀌는 증명은 증명이 아니다.
 * 허용 오차는 이항 3σ: 표의 확률 p 로 N 번 굴린 관측치는 Np ± 3√(Np(1−p)) 안에
 * 있어야 한다(시드가 고정이라 이 단언은 영원히 같은 답을 낸다).
 */

const SEED = 20260812
const N = 100_000
/** roll 의 정의역 크기 — roll ∈ 0~100000 이므로 확률 분모는 100001 이다. */
const DOMAIN = 100_001

const tables = loadGatherTables()
const data = loadGameData()

const copper = data.items['copper_pickaxe']!
const iron = data.items['iron_pickaxe']!
// 3등급 도구의 실물 — G5(레시피 태스크)가 items.csv 에 추가한 mithril_pickaxe 를
// 그대로 쓴다. 판정은 도구의 등급(toolTier)만 보므로(기술 일치는 canGather·
// equippedToolTier 의 몫) 리터럴로도 충분했지만, 실물을 꿰면 items.csv 의 icon·
// toolTier 가 실제로 factor 0.8 경로에 닿는다는 것까지 증명된다.
const mithril = data.items['mithril_pickaxe']!

interface SimResult {
  counts: Map<string, number>
  failures: number
}

function simulate(table: GatherTableDef, proficiency: number, tool: ItemDef, n: number): SimResult {
  const rng = createRng(SEED)
  const counts = new Map<string, number>()
  let failures = 0
  for (let i = 0; i < n; i++) {
    const { itemId } = gatherOutcome(table, proficiency, tool, rng)
    if (itemId === null) failures += 1
    else counts.set(itemId, (counts.get(itemId) ?? 0) + 1)
  }
  return { counts, failures }
}

/** 관측치가 기대치의 이항 3σ 안에 있는지 — 벗어나면 표가 아니라 판정이 틀린 것이다. */
function expectWithin3Sigma(observed: number, n: number, p: number): void {
  const expected = n * p
  const sigma = Math.sqrt(n * p * (1 - p))
  expect(Math.abs(observed - expected)).toBeLessThanOrEqual(3 * sigma)
}

describe('§8-1 숙련 0 의 얼음 — 대부분 조각, 아주 가끔 전설', () => {
  const result = simulate(tables['ice']!, 0, copper, N)

  it('약 45% 는 얼음 조각(최하 티어)이다', () => {
    // 첫 브라켓(≤500)의 누적 [3,8,18,15018,60000] — ice_shard 의 폭은 60000−15018.
    expectWithin3Sigma(result.counts.get('ice_shard') ?? 0, N, (60000 - 15018) / DOMAIN)
  })

  it('약 15% 는 맑은 얼음(둘째 흔한 티어)이다', () => {
    expectWithin3Sigma(result.counts.get('pure_ice') ?? 0, N, (15018 - 18) / DOMAIN)
  })

  it('약 40% 는 실패다 — 첫 브라켓의 빈 꼬리', () => {
    expectWithin3Sigma(result.failures, N, (100000 - 60000) / DOMAIN)
  })

  it('숙련 0 에서도 잭팟(얼음의 보석, roll≤3 = 4/100001 ≈ 0.004%)이 실제로 터진다', () => {
    expect(result.counts.get('ice_gem') ?? 0).toBeGreaterThan(0)
  })

  it('상위 재료(얼음 결정)도 수백 번에 한 번꼴로 나온다', () => {
    expectWithin3Sigma(result.counts.get('ice_crystal') ?? 0, N, (18 - 8) / DOMAIN)
  })
})

describe('§8-2 브라켓 경계의 계단 — 숙련 1 차이가 분포를 통째로 바꾼다', () => {
  // 표별 **실제** 경계로 검증한다(§7-앞 19 — 나무는 15만 경계가 없고 70k 다).
  // below/above 는 그 경계 양쪽 브라켓에서 해당 티어가 갖는 누적 폭(CSV 원문 수치)이다.
  const stairs = [
    { tableId: 'ice', boundary: 150_000, itemId: 'pure_ice_crystal', below: 145 - 45, above: 10_065 - 65 },
    { tableId: 'wood', boundary: 70_000, itemId: 'tree_fruit', below: 200 - 65, above: 19_100 - 100 },
    { tableId: 'mineral', boundary: 150_000, itemId: 'gold_ore', below: 250 - 45, above: 35_065 - 65 },
    { tableId: 'herb', boundary: 150_000, itemId: 'aroma_herb', below: 145 - 45, above: 10_065 - 65 },
  ] as const

  for (const { tableId, boundary, itemId, below, above } of stairs) {
    it(`${tableId}: 숙련 ${boundary} 와 ${boundary + 1} 에서 ${itemId} 의 폭이 ${below} → ${above} 로 뛴다`, () => {
      const table = tables[tableId]!
      const atBoundary = simulate(table, boundary, copper, N)
      const pastBoundary = simulate(table, boundary + 1, copper, N)

      expectWithin3Sigma(atBoundary.counts.get(itemId) ?? 0, N, below / DOMAIN)
      expectWithin3Sigma(pastBoundary.counts.get(itemId) ?? 0, N, above / DOMAIN)
      // 계단의 방향 자체도 못박는다 — 두 3σ 구간이 겹치지 않는 것은 수치의
      // 우연이 아니라 "경계를 넘는 순간 어제 없던 재료가 쏟아진다"(§6)는 설계다.
      expect(pastBoundary.counts.get(itemId) ?? 0).toBeGreaterThan(atBoundary.counts.get(itemId) ?? 0)
    })
  }
})

describe('§8-4 네 표 전 티어가 실제로 드랍된다', () => {
  // ∞ 브라켓(최종 표)에서는 모든 티어의 폭이 수천 이상이라 1만 번이면 전부 나온다.
  // "어느 숙련에서도 안 나오는 티어"는 폭 0 인데, 그건 빌드 검증(순증가)이 먼저
  // 막고, 여기서는 실제 판정 경로로 한 번 더 증명한다.
  for (const tableId of ['ice', 'wood', 'mineral', 'herb'] as const) {
    it(`${tableId}: 최종 브라켓에서 사다리의 전 티어가 나오고 실패는 0% 다(§8-3)`, () => {
      const table = tables[tableId]!
      const result = simulate(table, 1_000_000, copper, 10_000)
      for (const tier of table.tiers) {
        expect(result.counts.get(tier.itemId) ?? 0).toBeGreaterThan(0)
      }
      // 최종 브라켓의 마지막 누적은 100000 — 어떤 roll 도 빈손이 아니다.
      expect(result.failures).toBe(0)
    })
  }
})

describe('§8-5 도구 등급이 희귀 티어를 체감되게 더 뽑는다', () => {
  // 얼음 ≤500000 브라켓(숙련 20만): 상위 두 티어(ice_gem + pure_ice_crystal)의
  // 누적 상한이 10065 다.
  //
  // §7-앞 13 의 배타 보정(gatherTable.ts) 아래서는 이 확률이 factor 에 정확히
  // 반비례하지 않는다 — rawRoll ≤ JACKPOT_BAND_MAX(10) 구간은 곱이 아니라
  // 평감산만 받고, rawRoll 이 정수이므로(연속均등이 아니라 이산 균등) 곱을
  // 적용하는 밖 구간도 factor 별로 깔끔한 반비례가 아니다. 근사식 대신
  // gatherOutcome 과 똑같은 두 갈래 식으로 rawRoll 100001 가지를 전수 세어
  // "정확한" 확률을 낸다 — 근사가 실제 판정과 갈라질 여지를 아예 없앤다.
  const prof = 200_000
  const rareCut = 10_065

  const exactRareCount = (tool: ItemDef): number => {
    const factor = toolGatherFactor(tool)
    const flat = jackpotFlatBonus(tool)
    let count = 0
    for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
      const roll = rawRoll <= JACKPOT_BAND_MAX ? Math.max(0, rawRoll - flat) : Math.floor(rawRoll * factor)
      if (roll <= rareCut) count++
    }
    return count
  }
  const pFor = (tool: ItemDef) => exactRareCount(tool) / DOMAIN

  const rare = (tool: ItemDef): number => {
    const { counts } = simulate(tables['ice']!, prof, tool, N)
    return (counts.get('ice_gem') ?? 0) + (counts.get('pure_ice_crystal') ?? 0)
  }

  const copperRare = rare(copper)
  const ironRare = rare(iron)
  const mithrilRare = rare(mithril)

  it('구리·철·미스릴 각각이 정확한 전수 확률의 3σ 안이다', () => {
    expectWithin3Sigma(copperRare, N, pFor(copper))
    expectWithin3Sigma(ironRare, N, pFor(iron))
    expectWithin3Sigma(mithrilRare, N, pFor(mithril))
  })

  it('철 > 구리, 미스릴 > 철 — 차이가 두 관측치의 합성 3σ 를 넘는 유의차다', () => {
    const sigma = (p: number) => Math.sqrt(N * p * (1 - p))
    expect(ironRare - copperRare).toBeGreaterThan(3 * Math.hypot(sigma(pFor(copper)), sigma(pFor(iron))))
    expect(mithrilRare - ironRare).toBeGreaterThan(3 * Math.hypot(sigma(pFor(iron)), sigma(pFor(mithril))))
  })
})
