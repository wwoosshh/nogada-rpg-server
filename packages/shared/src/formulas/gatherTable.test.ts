import { describe, expect, it } from 'vitest'
import type { GatherTableDef, ItemDef } from '../types.js'
import { gatherBracketFor, gatherOutcome, jackpotFlatBonus, toolGatherFactor } from './gatherTable.js'

// ---------------------------------------------------------------------------
// 픽스처 — 실제 표가 아니라 경계가 한눈에 보이는 작은 표를 쓴다. 실물 표에 대한
// 분포 증명은 packages/data 의 gatherSimulation.test.ts 가 한다(표는 data 가
// 소유하고 shared 는 data 에 의존할 수 없다 — 의존 방향).
// ---------------------------------------------------------------------------

const table: GatherTableDef = {
  id: 'test',
  skill: 'ice',
  skillGainMin: 1,
  skillGainMax: 2,
  // 희귀 → 흔함. gem 은 잭팟 밴드(roll ≤ 10)와 겹치는 폭 3 으로 둬서
  // 평감산이 티어를 바꾸는 것까지 보이게 한다.
  tiers: [{ itemId: 'gem' }, { itemId: 'crystal' }, { itemId: 'shard' }],
  brackets: [
    { bracketMax: 500, cumulative: [3, 18, 60000] },
    { bracketMax: null, cumulative: [15000, 49000, 100000] },
  ],
}

const copper: ItemDef = {
  id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool', toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
}
const iron: ItemDef = { ...copper, id: 'iron_pickaxe', toolTier: 2 }
const mithril: ItemDef = { ...copper, id: 'mithril_pickaxe', toolTier: 3 }

/**
 * floor(rng × 100001 × factor) 가 정확히 `roll` 이 되는 난수.
 * +0.5 를 심어 두면 부동소수점 오차(±ε)가 floor 경계를 흔들지 못한다.
 */
const rollOf = (roll: number, factor = 1) => () => (roll + 0.5) / (100001 * factor)

describe('toolGatherFactor', () => {
  it('구리(1등급) ×1.0 / 철(2등급) ×0.9 / 미스릴(3등급) ×0.8 — 설계 §3.3·§7-앞 13', () => {
    expect(toolGatherFactor(copper)).toBe(1.0)
    expect(toolGatherFactor(iron)).toBe(0.9)
    expect(toolGatherFactor(mithril)).toBe(0.8)
  })
})

describe('jackpotFlatBonus', () => {
  it('구리 0 / 철 2 / 미스릴 3 — 잭팟 밴드(roll≤10)의 평감산이다(§7-앞 13)', () => {
    expect(jackpotFlatBonus(copper)).toBe(0)
    expect(jackpotFlatBonus(iron)).toBe(2)
    expect(jackpotFlatBonus(mithril)).toBe(3)
  })
})

describe('gatherBracketFor', () => {
  it('proficiency ≤ bracketMax 인 첫 브라켓을 고른다 — 경계값은 그 브라켓에 속한다', () => {
    expect(gatherBracketFor(table, 0)).toBe(table.brackets[0])
    expect(gatherBracketFor(table, 500)).toBe(table.brackets[0])
    expect(gatherBracketFor(table, 501)).toBe(table.brackets[1])
  })

  it('∞(null) 브라켓은 어떤 숙련도 매치한다 — 상한 밖 숙련이 판정 불능이 되면 안 된다(§7-앞 4)', () => {
    expect(gatherBracketFor(table, 10_000_000)).toBe(table.brackets[1])
  })
})

describe('gatherOutcome — roll 과 티어', () => {
  it('roll 0 은 최상 티어다 — 숙련 0 의 첫 손질에도 잭팟이 열려 있다(설계 §1)', () => {
    expect(gatherOutcome(table, 0, copper, rollOf(0))).toEqual({ itemId: 'gem', roll: 0 })
  })

  it('누적 상한과 같은 roll 은 그 티어다 — 부등호는 원작 준용 roll ≤ cum 첫 매치', () => {
    expect(gatherOutcome(table, 0, copper, rollOf(3))).toEqual({ itemId: 'gem', roll: 3 })
    expect(gatherOutcome(table, 0, copper, rollOf(4))).toEqual({ itemId: 'crystal', roll: 4 })
  })

  it('마지막 누적을 넘는 roll 은 실패다 — 실패 질량은 표의 빈 꼬리다', () => {
    expect(gatherOutcome(table, 0, copper, rollOf(60001))).toEqual({ itemId: null, roll: 60001 })
    expect(gatherOutcome(table, 0, copper, rollOf(70000))).toEqual({ itemId: null, roll: 70000 })
  })

  it('브라켓 경계 — 숙련 500 은 첫 브라켓, 501 은 다음 브라켓의 표를 굴린다', () => {
    // roll 10000 은 첫 브라켓에서는 흔한 티어(≤60000), 다음 브라켓에서는
    // 최상 티어(≤15000)다 — 같은 roll 이 브라켓에 따라 다른 답을 내야
    // "표가 통째로 바뀐다"가 증명된다.
    expect(gatherOutcome(table, 500, copper, rollOf(10000))).toEqual({ itemId: 'shard', roll: 10000 })
    expect(gatherOutcome(table, 501, copper, rollOf(10000))).toEqual({ itemId: 'gem', roll: 10000 })
  })

  it('상한 밖 숙련은 ∞ 브라켓이 받는다', () => {
    expect(gatherOutcome(table, 10_000_000, copper, rollOf(10000))).toEqual({ itemId: 'gem', roll: 10000 })
  })

  it('최종 브라켓의 마지막 누적이 100000 이면 최대 roll 도 실패가 아니다 — 실패 0%(§8-3)', () => {
    expect(gatherOutcome(table, 501, copper, rollOf(100000))).toEqual({ itemId: 'shard', roll: 100000 })
  })
})

describe('gatherOutcome — 도구 보정', () => {
  it('같은 난수에서 좋은 도구가 roll 을 낮춘다 — ×0.9/×0.8 은 실패를 성공으로 뒤집을 수 있다', () => {
    // u=0.7: 구리 70000(실패) / 철 63000(실패) / 미스릴 56000(성공) — 같은 운이
    // 도구에 따라 다른 결과가 되는 것이 "게이트에서 보정으로"(§3.3)의 뜻이다.
    const u = () => 0.7
    expect(gatherOutcome(table, 0, copper, u)).toEqual({ itemId: null, roll: 70000 })
    expect(gatherOutcome(table, 0, iron, u)).toEqual({ itemId: null, roll: 63000 })
    expect(gatherOutcome(table, 0, mithril, u)).toEqual({ itemId: 'shard', roll: 56000 })
  })

  it('잭팟 밴드(roll ≤ 10) 안에서는 곱이 아니라 평감산이다 — 철 −2 가 티어를 바꾼다', () => {
    // factor 적용 후 roll 5 → 5−2=3 → gem(≤3). 곱 보정만 있었다면 crystal 이었다.
    expect(gatherOutcome(table, 0, iron, rollOf(5, 0.9))).toEqual({ itemId: 'gem', roll: 3 })
  })

  it('미스릴은 −3 — 밴드 상한 roll 10 이 7 이 된다', () => {
    expect(gatherOutcome(table, 0, mithril, rollOf(10, 0.8))).toEqual({ itemId: 'crystal', roll: 7 })
  })

  it('밴드 밖(roll 11)은 평감산이 없다 — 잭팟 밴드는 정확히 roll ≤ 10 이다', () => {
    expect(gatherOutcome(table, 0, mithril, rollOf(11, 0.8))).toEqual({ itemId: 'crystal', roll: 11 })
  })

  it('평감산은 0 아래로 내려가지 않는다 — roll 2 에 −3 은 0 이다', () => {
    expect(gatherOutcome(table, 0, mithril, rollOf(2, 0.8))).toEqual({ itemId: 'gem', roll: 0 })
  })

  it('구리(1등급)는 잭팟 평감산이 없다 — 밴드 안 roll 이 그대로 판정된다', () => {
    expect(gatherOutcome(table, 0, copper, rollOf(10))).toEqual({ itemId: 'crystal', roll: 10 })
  })
})
