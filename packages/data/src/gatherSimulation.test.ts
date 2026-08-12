import { describe, expect, it } from 'vitest'
import {
  createRng,
  gatherBracketFor,
  gatherHandOf,
  gatherIntervalMs,
  gatherOutcome,
  GATHER_ROLL_MAX,
  JACKPOT_BAND_MAX,
  sellPrice,
  TOKEN_SPEED_FACTOR,
  type GatherHand,
  type GatherTableDef,
  type ItemDef,
  type PlayerState,
  type SkillId,
  type TokenEffect,
} from '@nogada/shared'
import { emptyPlayer } from './emptyPlayer.js'
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

/**
 * 그 기술의 그 등급 도구의 실물. 판정은 등급(toolTier)만 보지만, 손을 게임과
 * 같은 경로로 지으려면 **기술이 맞아야 한다** — 엉뚱한 기술의 도구는
 * `equippedToolInfo` 가 null(맨손)로 만든다(§6-앞 9). 실물을 꿰면 items.csv 의
 * toolSkill·toolTier 가 실제로 그 프로필 경로에 닿는다는 것까지 증명된다.
 */
const toolOf = (skill: SkillId, tier: number): ItemDef => {
  const tool = Object.values(data.items).find((item) => item.toolSkill === skill && item.toolTier === tier)
  if (!tool) throw new Error(`${skill} 기술의 ${tier}등급 도구가 items.csv 에 없다`)
  return tool
}

/** 등급으로 손을 부른다 — null 은 맨손, 숫자는 그 기술의 그 등급 도구다. */
type Grade = 1 | 2 | 3 | null

/**
 * 그 등급 도구를 들고 (선택적으로) 그 계열 증표를 가진 사람의 손.
 *
 * 손을 리터럴로 짓지 않고 `gatherHandOf` 에 흉내 낸 플레이어를 넣는 이유는
 * 이 파일의 존재 이유와 같다(§7-앞 12): 증명이 게임과 **같은 경로**를 지나야
 * 한다. 여기서 배수를 직접 곱하면 증표 조회가 망가진 날에도 이 시뮬만 초록이다.
 */
function handOf(skill: SkillId, grade: Grade, tokens: readonly TokenEffect[] = []): GatherHand {
  const player: PlayerState = emptyPlayer()
  if (grade !== null) {
    const tool = toolOf(skill, grade)
    player.instances = [{ instanceId: 'sim', itemId: tool.id, enhanceLevel: 0 }]
    player.equipped = { [skill]: 'sim' }
  }
  for (const effect of tokens) {
    const token = Object.values(data.items).find((item) => item.tokenEffect === effect && item.skill === skill)
    if (!token) throw new Error(`${skill} 계열의 ${effect} 증표가 items.csv 에 없다`)
    player.stacks[token.id] = 1
  }
  return gatherHandOf(player, skill, data.items)
}

interface SimResult {
  counts: Map<string, number>
  failures: number
}

function simulate(table: GatherTableDef, proficiency: number, grade: Grade, n: number): SimResult {
  return simulateHand(table, proficiency, handOf(table.skill, grade), n)
}

function simulateHand(table: GatherTableDef, proficiency: number, hand: GatherHand, n: number): SimResult {
  const rng = createRng(SEED)
  const counts = new Map<string, number>()
  let failures = 0
  for (let i = 0; i < n; i++) {
    const { itemId } = gatherOutcome(table, proficiency, hand, rng)
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
  const result = simulate(tables['ice']!, 0, 1, N)

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
      const atBoundary = simulate(table, boundary, 1, N)
      const pastBoundary = simulate(table, boundary + 1, 1, N)

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
      const result = simulate(table, 1_000_000, 1, 10_000)
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

  const exactRareCount = (hand: GatherHand): number => {
    const { rollFactor, jackpotFlat } = hand.profile
    let count = 0
    for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
      const roll =
        rawRoll <= JACKPOT_BAND_MAX ? Math.max(0, rawRoll - jackpotFlat) : Math.floor(rawRoll * rollFactor)
      if (roll <= rareCut) count++
    }
    return count
  }
  const pFor = (grade: Grade) => exactRareCount(handOf('ice', grade)) / DOMAIN

  const rare = (grade: Grade): number => {
    const { counts } = simulate(tables['ice']!, prof, grade, N)
    return (counts.get('ice_gem') ?? 0) + (counts.get('pure_ice_crystal') ?? 0)
  }

  const copperRare = rare(1)
  const ironRare = rare(2)
  const mithrilRare = rare(3)

  it('구리·철·미스릴 각각이 정확한 전수 확률의 3σ 안이다', () => {
    expectWithin3Sigma(copperRare, N, pFor(1))
    expectWithin3Sigma(ironRare, N, pFor(2))
    expectWithin3Sigma(mithrilRare, N, pFor(3))
  })

  it('철 > 구리, 미스릴 > 철 — 차이가 두 관측치의 합성 3σ 를 넘는 유의차다', () => {
    const sigma = (p: number) => Math.sqrt(N * p * (1 - p))
    expect(ironRare - copperRare).toBeGreaterThan(3 * Math.hypot(sigma(pFor(1)), sigma(pFor(2))))
    expect(mithrilRare - ironRare).toBeGreaterThan(3 * Math.hypot(sigma(pFor(2)), sigma(pFor(3))))
  })
})

describe('§6-앞 3 맨손 페널티 — 첫 도구를 만드는 순간이 체감되려면 맨손은 같은 자리에서 눈에 띄게 자주 빈손이어야 한다', () => {
  // mineral 첫 브라켓(≤500, 부트스트랩 시기)의 마지막 누적 — 성공은 roll ≤ 이 값.
  // 구리(×1.0)는 rawRoll 0..20000 이 성공(≈20.0%), 맨손(×1.45)은 밴드 11개 +
  // rawRoll 11..13793 만 성공(≈13.8%) — §6-앞 3 이 "저브라켓에서도 무감각하지
  // 않은 페널티"로 ×1.1 을 ×1.45 로 올린 그 수치다. §8-5 와 같은 이유로 근사식
  // 대신 gatherOutcome 과 똑같은 두 갈래 식의 전수 셈으로 정확한 확률을 낸다.
  const table = tables['mineral']!
  const successCut = table.brackets[0]!.cumulative.at(-1)!

  const exactSuccessCount = (hand: GatherHand): number => {
    const { rollFactor, jackpotFlat } = hand.profile
    let count = 0
    for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
      const roll =
        rawRoll <= JACKPOT_BAND_MAX ? Math.max(0, rawRoll - jackpotFlat) : Math.floor(rawRoll * rollFactor)
      if (roll <= successCut) count++
    }
    return count
  }
  const pFor = (grade: Grade) => exactSuccessCount(handOf('mineral', grade)) / DOMAIN

  const bareSuccesses = N - simulate(table, 0, null, N).failures
  const copperSuccesses = N - simulate(table, 0, 1, N).failures

  it('전수 확률 자체가 §6-앞 3 의 수치다 — 구리 20.0%, 맨손 13.8%(상대 −31%)', () => {
    expect(pFor(1)).toBeCloseTo(0.2, 3)
    expect(pFor(null)).toBeCloseTo(0.138, 3)
    expect((pFor(1) - pFor(null)) / pFor(1)).toBeCloseTo(0.31, 2)
  })

  it('관측이 각자의 전수 확률 3σ 안이고, 격차는 합성 3σ 를 넘는 유의차다 — 우연으로 설명되지 않는 차이', () => {
    expectWithin3Sigma(copperSuccesses, N, pFor(1))
    expectWithin3Sigma(bareSuccesses, N, pFor(null))
    const sigma = (p: number) => Math.sqrt(N * p * (1 - p))
    expect(copperSuccesses - bareSuccesses).toBeGreaterThan(
      3 * Math.hypot(sigma(pFor(1)), sigma(pFor(null))),
    )
  })
})

/**
 * §6-앞 7 — **증표 가격의 근거를 테스트로 살려 둔다.**
 *
 * 스펙 원안은 속도증표를 선별증표의 절반 값에 팔았다. 평가가 그 표를 뒤집은
 * 근거가 여기 있는 두 숫자다: 속도(×0.9)는 분당 골드를 정확히 +11.1% 올리고,
 * 선별(×0.95)은 +5%대만 올린다 — 그래서 출하 가격이 속도 : 선별 = 2 : 1 이다.
 * 표나 값을 재조정한 날 이 비율이 깨지면 가격표도 함께 다시 풀어야 하고, 그
 * 사실을 사람의 기억이 아니라 이 스위트가 말한다.
 *
 * 두 겹으로 증명한다: 먼저 rawRoll 100001 가지를 전수로 세어 **정확한** 기대
 * 골드를 내고(§8-5 와 같은 이유 — 근사식은 실제 판정과 갈라질 수 있다), 그 다음
 * 실제 `gatherOutcome` 을 고정 시드로 N 번 굴린 관측이 그 기댓값의 3σ 안인지 본다.
 */
describe('§6-앞 7 증표의 값어치 — 가격을 유도한 두 숫자를 출하 표로 못박는다', () => {
  /** 증표가 진열에서 열리는 숙련도(shop_stock.csv) — 가격 유도가 상정한 그 시점의 손이다. */
  const SPEED_UNLOCK = 10_000
  const SIGHT_UNLOCK = 25_000
  const SKILLS = ['ice', 'wood', 'mineral', 'herb'] as const

  /** 한 번의 시도가 낳는 골드의 정확한 기댓값과 분산. 실패는 0 골드다. */
  function goldMoments(table: GatherTableDef, prof: number, hand: GatherHand): { mean: number; variance: number } {
    const bracket = gatherBracketFor(table, prof)
    const { rollFactor, jackpotFlat } = hand.profile
    let sum = 0
    let sumSq = 0
    for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
      const roll =
        rawRoll <= JACKPOT_BAND_MAX ? Math.max(0, rawRoll - jackpotFlat) : Math.floor(rawRoll * rollFactor)
      const tierIndex = bracket.cumulative.findIndex((c) => roll <= c)
      const itemId = tierIndex >= 0 ? table.tiers[tierIndex]?.itemId : undefined
      const gold = itemId ? sellPrice(data.items[itemId]!) : 0
      sum += gold
      sumSq += gold * gold
    }
    const mean = sum / DOMAIN
    return { mean, variance: sumSq / DOMAIN - mean * mean }
  }

  /**
   * 분당 골드 — 이것이 증표 두 종을 같은 자로 재는 유일한 축이다. 속도는 분모
   * (간격)를, 선별은 분자(회당 기대 골드)를 건드리므로, 둘 중 하나만 보면
   * 비교가 성립하지 않는다.
   */
  const goldPerMinute = (table: GatherTableDef, prof: number, hand: GatherHand): number =>
    (goldMoments(table, prof, hand).mean * 60_000) / gatherIntervalMs(prof, hand)

  /** 그 증표를 쥐면 분당 골드가 몇 배가 되는가 — 1티어 도구를 든 해금 시점의 손 기준. */
  const payoff = (skill: SkillId, prof: number, effect: TokenEffect): number => {
    const table = tables[skill]!
    return goldPerMinute(table, prof, handOf(skill, 1, [effect])) / goldPerMinute(table, prof, handOf(skill, 1))
  }

  it('속도증표는 분당 골드를 정확히 +11.1% 올린다 — 표와 무관한 산술이라 네 계열이 같은 값이다', () => {
    for (const skill of SKILLS) {
      // 간격이 ×0.9 이므로 분당 시행 수가 1/0.9 배다. 회당 기대 골드는 손도
      // 안 댄다 — 그래서 이 이득은 어느 표에서도 같고, 반올림(gatherIntervalMs)
      // 이 200→180 처럼 딱 떨어지지 않는 숙련에서만 소수점 끝이 흔들린다.
      expect(payoff(skill, SPEED_UNLOCK, 'speed')).toBeCloseTo(1 / TOKEN_SPEED_FACTOR, 3)
    }
  })

  it('속도증표는 분포를 전혀 바꾸지 않는다 — 회당 기대 골드가 글자 그대로 같다', () => {
    for (const skill of SKILLS) {
      const table = tables[skill]!
      expect(goldMoments(table, SPEED_UNLOCK, handOf(skill, 1, ['speed'])).mean).toBe(
        goldMoments(table, SPEED_UNLOCK, handOf(skill, 1)).mean,
      )
    }
  })

  it('선별증표는 분당 골드를 +5%대 올린다 — 네 계열 전부(측정: 얼음 5.37 · 나무 5.29 · 광물 5.39 · 허브 5.33%)', () => {
    for (const skill of SKILLS) {
      const gain = payoff(skill, SIGHT_UNLOCK, 'sight') - 1
      // §6-앞 7 이 가격을 유도할 때 쓴 대역이 5.0~5.5% 다. 표를 재조정해 이
      // 대역을 벗어나면 증표 가격(그리고 속도 : 선별 비율)이 함께 틀린다.
      expect(gain).toBeGreaterThan(0.05)
      expect(gain).toBeLessThan(0.055)
    }
  })

  it('선별증표는 간격을 건드리지 않는다 — 두 증표는 서로 다른 축이라 값어치를 나눠 잴 수 있다', () => {
    for (const skill of SKILLS) {
      expect(gatherIntervalMs(SIGHT_UNLOCK, handOf(skill, 1, ['sight']))).toBe(
        gatherIntervalMs(SIGHT_UNLOCK, handOf(skill, 1)),
      )
    }
  })

  it('속도가 선별보다 2배쯤 값어치가 크고, 출하 가격이 정확히 그 비율(2:1)이다 — 뒤집힌 스펙을 고친 근거(§6-앞 7)', () => {
    for (const skill of SKILLS) {
      const speedGain = payoff(skill, SIGHT_UNLOCK, 'speed') - 1
      const sightGain = payoff(skill, SIGHT_UNLOCK, 'sight') - 1
      const 값어치비 = speedGain / sightGain
      expect(값어치비).toBeGreaterThan(2)
      expect(값어치비).toBeLessThan(2.2)

      const speedToken = Object.values(data.items).find((i) => i.tokenEffect === 'speed' && i.skill === skill)!
      const sightToken = Object.values(data.items).find((i) => i.tokenEffect === 'sight' && i.skill === skill)!
      expect(speedToken.price / sightToken.price).toBe(2)
    }
  })

  it('선별증표의 관측 골드가 전수 기대의 3σ 안이다 — 전수 셈이 실제 판정 경로와 갈라지지 않았다', () => {
    // 골드는 이항이 아니다(티어마다 값이 다르다) — 그래서 σ 를 전수 셈의 분산에서
    // 직접 낸다. 시드가 고정이라 이 단언은 영원히 같은 답을 낸다.
    for (const skill of SKILLS) {
      const table = tables[skill]!
      const hand = handOf(skill, 1, ['sight'])
      const { counts, failures } = simulateHand(table, SIGHT_UNLOCK, hand, N)
      expect(failures).toBeGreaterThanOrEqual(0)
      let observed = 0
      for (const [itemId, count] of counts) observed += sellPrice(data.items[itemId]!) * count

      const { mean, variance } = goldMoments(table, SIGHT_UNLOCK, hand)
      expect(Math.abs(observed - N * mean)).toBeLessThanOrEqual(3 * Math.sqrt(N * variance))
    }
  })

  it('남의 계열 증표는 값어치가 0 이다 — 얼음 증표 둘을 들고 나무를 캐면 손이 그대로다', () => {
    const player: PlayerState = emptyPlayer()
    player.stacks = { ice_speed_token: 1, ice_sight_token: 1 }
    expect(gatherHandOf(player, 'wood', data.items)).toEqual(handOf('wood', null))
  })
})
