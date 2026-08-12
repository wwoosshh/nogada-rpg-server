import { describe, expect, it } from 'vitest'
import { testTool } from '../testing/items.js'
import type { GatherTableDef, ItemDef } from '../types.js'
import { TOKEN_SIGHT_FACTOR, type GatherHand } from './gatherHand.js'
import { gatherBracketFor, gatherOutcome } from './gatherTable.js'
import { effectiveIntervalFactor, gatherToolProfile } from './toolProfile.js'

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

const copperDef: ItemDef = testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' })
const ironDef: ItemDef = { ...copperDef, id: 'iron_pickaxe', toolTier: 2 }
const mithrilDef: ItemDef = { ...copperDef, id: 'mithril_pickaxe', toolTier: 3 }

/**
 * 증표 없는 손 하나 — 그 도구만 든 손이다(null 이면 맨손).
 *
 * `gatherHandOf` 로 만들지 않고 리터럴로 짓는 이유: 이 스위트가 보는 것은
 * **판정이 손의 프로필을 어떻게 쓰는가**이지 손을 어떻게 짓는가가 아니다.
 * 짓는 쪽(도구 조회·증표 곱)은 gatherHand.test.ts 가 증명한다.
 */
const hand = (def: ItemDef | null): GatherHand => ({
  tool: null,
  profile: gatherToolProfile(def),
  intervalFactor: effectiveIntervalFactor(def, 0),
})

const bare = hand(null)
const copper = hand(copperDef)
const iron = hand(ironDef)
const mithril = hand(mithrilDef)

/**
 * floor(rng × 100001) 이 정확히 `rawRoll` 이 되는 난수 — 밴드 소속과 도구 보정
 * **이전**의 원 roll 이다(gatherOutcome 은 이 값으로 밴드 안/밖을 가른 뒤에만
 * 평감산 또는 곱을 적용한다 — 배타적이라 둘을 동시에 겪는 값은 없다).
 * +0.5 를 심어 두면 부동소수점 오차(±ε)가 floor 경계를 흔들지 못한다.
 */
const rawRollOf = (rawRoll: number) => () => (rawRoll + 0.5) / 100001

// roll 배수·평감산의 값 자체는 gatherToolProfile(toolProfile.test.ts)이 증명한다 —
// 여기서는 그 프로필이 판정(gatherOutcome)에 실제로 배타 적용되는지를 본다.

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
    expect(gatherOutcome(table, 0, copper, rawRollOf(0))).toEqual({ itemId: 'gem', roll: 0 })
  })

  it('누적 상한과 같은 roll 은 그 티어다 — 부등호는 원작 준용 roll ≤ cum 첫 매치', () => {
    expect(gatherOutcome(table, 0, copper, rawRollOf(3))).toEqual({ itemId: 'gem', roll: 3 })
    expect(gatherOutcome(table, 0, copper, rawRollOf(4))).toEqual({ itemId: 'crystal', roll: 4 })
  })

  it('마지막 누적을 넘는 roll 은 실패다 — 실패 질량은 표의 빈 꼬리다', () => {
    expect(gatherOutcome(table, 0, copper, rawRollOf(60001))).toEqual({ itemId: null, roll: 60001 })
    expect(gatherOutcome(table, 0, copper, rawRollOf(70000))).toEqual({ itemId: null, roll: 70000 })
  })

  it('브라켓 경계 — 숙련 500 은 첫 브라켓, 501 은 다음 브라켓의 표를 굴린다', () => {
    // roll 10000 은 첫 브라켓에서는 흔한 티어(≤60000), 다음 브라켓에서는
    // 최상 티어(≤15000)다 — 같은 roll 이 브라켓에 따라 다른 답을 내야
    // "표가 통째로 바뀐다"가 증명된다.
    expect(gatherOutcome(table, 500, copper, rawRollOf(10000))).toEqual({ itemId: 'shard', roll: 10000 })
    expect(gatherOutcome(table, 501, copper, rawRollOf(10000))).toEqual({ itemId: 'gem', roll: 10000 })
  })

  it('상한 밖 숙련은 ∞ 브라켓이 받는다', () => {
    expect(gatherOutcome(table, 10_000_000, copper, rawRollOf(10000))).toEqual({ itemId: 'gem', roll: 10000 })
  })

  it('최종 브라켓의 마지막 누적이 100000 이면 최대 roll 도 실패가 아니다 — 실패 0%(§8-3)', () => {
    expect(gatherOutcome(table, 501, copper, rawRollOf(100000))).toEqual({ itemId: 'shard', roll: 100000 })
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

  it('잭팟 밴드(rawRoll ≤ 10) 안에서는 곱이 아니라 평감산만 적용된다 — 철 −2 가 티어를 바꾼다', () => {
    // rawRoll 5(밴드 안) → 곱은 아예 안 쓰고 평감산만: 5−2=3 → gem(≤3).
    // 곱까지 스택했다면(구판) crystal 이었다 — 배타 적용이 이 테스트의 요점이다.
    expect(gatherOutcome(table, 0, iron, rawRollOf(5))).toEqual({ itemId: 'gem', roll: 3 })
  })

  it('미스릴은 −3 — 밴드 상한 rawRoll 10 이 곱 없이 7 이 된다', () => {
    expect(gatherOutcome(table, 0, mithril, rawRollOf(10))).toEqual({ itemId: 'crystal', roll: 7 })
  })

  it('밴드 밖(rawRoll 11)은 평감산 없이 곱만 적용된다 — 잭팟 밴드는 정확히 rawRoll ≤ 10 이다', () => {
    // rawRoll 11 은 밴드 밖이라 평감산은 아예 안 쓰고 곱만: floor(11×0.8)=8 → crystal.
    // 스택 방식(구판)이었다면 평감산 없이 11 그대로였을 값이라, 8 이 나오는 것 자체가
    // "밖에서는 곱이 있다"는 것과 "밴드 경계가 rawRoll 기준"이라는 것을 함께 증명한다.
    expect(gatherOutcome(table, 0, mithril, rawRollOf(11))).toEqual({ itemId: 'crystal', roll: 8 })
  })

  it('평감산은 0 아래로 내려가지 않는다 — rawRoll 2 에 −3 은 0 이다', () => {
    expect(gatherOutcome(table, 0, mithril, rawRollOf(2))).toEqual({ itemId: 'gem', roll: 0 })
  })

  it('구리(1등급)는 잭팟 평감산이 없다 — 밴드 안 rawRoll 이 그대로 판정된다', () => {
    expect(gatherOutcome(table, 0, copper, rawRollOf(10))).toEqual({ itemId: 'crystal', roll: 10 })
  })

  it('잭팟 확률의 정확한 값(§7-앞 18): roll≤3 은 구리 4/100001, 철 6/100001(+50%), 미스릴 7/100001(+75%)', () => {
    // 최상 티어(gem)는 이 픽스처에서 cumulative[0]=3 — roll≤3 이 곧 잭팟이다.
    // 밴드(rawRoll 0~10) 안은 평감산만 받으므로 "roll≤3 이 되는 rawRoll" 은
    // 정확히 0..flat+3 이다: 구리(flat 0) 0~3 = 4개, 철(flat 2) 0~5 = 6개,
    // 미스릴(flat 3) 0~6 = 7개. 경계(마지막으로 걸리는 rawRoll과 그 다음)를
    // 직접 굴려 못박는다 — 밴드 밖(rawRoll≥11)은 곱만 받아 floor(11×0.8)=8 이
    // 최솟값이라 roll≤3 에 닿지 못한다(이미 위 두 테스트가 증명했다).
    expect(gatherOutcome(table, 0, copper, rawRollOf(3)).roll).toBe(3) // 마지막으로 걸리는 값
    expect(gatherOutcome(table, 0, copper, rawRollOf(4)).roll).toBe(4) // 그 다음은 밖

    expect(gatherOutcome(table, 0, iron, rawRollOf(5)).roll).toBe(3) // 5−2=3, 마지막으로 걸림
    expect(gatherOutcome(table, 0, iron, rawRollOf(6)).roll).toBe(4) // 6−2=4, 그 다음은 밖

    expect(gatherOutcome(table, 0, mithril, rawRollOf(6)).roll).toBe(3) // 6−3=3, 마지막으로 걸림
    expect(gatherOutcome(table, 0, mithril, rawRollOf(7)).roll).toBe(4) // 7−3=4, 그 다음은 밖
  })
})

describe('gatherOutcome — 맨손(null)', () => {
  it('밴드 밖은 roll ×1.45 다 — 같은 운이 도구가 없다는 이유로 더 나쁜 티어가 된다(§6-앞 3)', () => {
    // rawRoll 10000: 구리는 10000(첫 브라켓에서 shard), 맨손은 14500 — 같은
    // 브라켓·같은 운인데 배수가 티어를 깎는 것이 맨손 페널티의 형태다.
    expect(gatherOutcome(table, 0, bare, rawRollOf(10000))).toEqual({ itemId: 'shard', roll: 14500 })
  })

  it('최종 브라켓(실패 0%)에서도 맨손은 실패가 남는다 — 표 끝 100000 을 넘긴 몫은 실패다(§3, 도구의 영원한 존재 이유)', () => {
    // 최종 브라켓의 마지막 누적이 100000 이라 도구 손엔 어떤 roll 도 빈손이
    // 아니지만(위 §8-3 테스트), 맨손 ×1.45 는 rawRoll 68967 부터 100000 을
    // 넘긴다 — floor(68966×1.45)=100000(성공), floor(68967×1.45)=100002(실패).
    expect(gatherOutcome(table, 501, bare, rawRollOf(68966))).toEqual({ itemId: 'shard', roll: 100000 })
    expect(gatherOutcome(table, 501, bare, rawRollOf(68967))).toEqual({ itemId: null, roll: 100002 })
    expect(gatherOutcome(table, 501, bare, rawRollOf(100000))).toEqual({ itemId: null, roll: 145000 })
  })

  it('잭팟 밴드 안은 평감산 0 이라 rawRoll 이 그대로다 — 맨손도 잭팟은 원확률로 가능하다(원작 정신, §3)', () => {
    // 배타 규칙 덕에 밴드 안에서는 ×1.45 를 아예 안 겪는다 — 3 이 4.35 로
    // 불어나 gem(≤3)을 놓치는 일이 없다.
    expect(gatherOutcome(table, 0, bare, rawRollOf(3))).toEqual({ itemId: 'gem', roll: 3 })
    expect(gatherOutcome(table, 0, bare, rawRollOf(10))).toEqual({ itemId: 'crystal', roll: 10 })
  })
})

describe('gatherOutcome — 손에 실린 증표', () => {
  /** 선별증표까지 든 손. 증표는 도구와 별개의 곱셈 축이라 rollFactor 에 곱으로 얹힌다(설계 §5). */
  const withSight = (base: GatherHand): GatherHand => ({
    ...base,
    profile: { ...base.profile, rollFactor: base.profile.rollFactor * TOKEN_SIGHT_FACTOR },
  })

  it('선별증표는 밴드 밖 roll 을 ×0.95 로 낮춘다 — 판정이 손의 프로필을 그대로 읽는다는 증거', () => {
    // rawRoll 10000: 구리 손은 10000(첫 브라켓에서 shard), 선별증표를 든 구리
    // 손은 9500 이다. 이 한 줄이 "증표 효과가 판정에 닿는 유일한 문은 손"이라는
    // 이음새를 지킨다 — 손에 곱해 두지 않으면 여기서 영원히 10000 이 나온다.
    expect(gatherOutcome(table, 0, withSight(copper), rawRollOf(10_000))).toEqual({ itemId: 'shard', roll: 9500 })
    // 맨손도 같은 축을 받는다 — 1.45×0.95 = 1.3775, floor(10000×1.3775)=13775.
    expect(gatherOutcome(table, 0, withSight(bare), rawRollOf(10_000))).toEqual({ itemId: 'shard', roll: 13_775 })
  })

  it('선별증표도 잭팟 밴드 안에서는 아무 일도 하지 않는다 — 곱과 평감산의 배타는 증표에도 적용된다(§7-앞 13)', () => {
    // 밴드 안(rawRoll ≤ 10)은 평감산만 쓰는 구간이라 rollFactor 가 아예 안 읽힌다.
    expect(gatherOutcome(table, 0, withSight(copper), rawRollOf(10))).toEqual({ itemId: 'crystal', roll: 10 })
    expect(gatherOutcome(table, 0, withSight(mithril), rawRollOf(10))).toEqual({ itemId: 'crystal', roll: 7 })
  })
})
