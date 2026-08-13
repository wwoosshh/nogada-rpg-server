import { describe, expect, it } from 'vitest'
import { equippedToolInfo, type EquippedToolInfo } from '../equipment.js'
import { testItem, testTool } from '../testing/items.js'
import type { ItemDef, PlayerState } from '../types.js'
import { emptyDialogueHistory } from '../dialogue.js'
import { hammerChanceBonus } from './craft.js'
import {
  ACTION_INTERVAL_MAX_MS,
  ACTION_INTERVAL_MIN_MS,
  actionIntervalMs,
  CRAFT_TOOL_TIER_CHANCE_BONUS,
} from './proficiency.js'
import { TOKEN_SPEED_FACTOR, type GatherHand } from './gatherHand.js'
import {
  craftIntervalMs,
  ENHANCE_CAP,
  ENHANCE_INTERVAL_FACTOR,
  effectiveIntervalFactor,
  gatherIntervalMs,
  gatherToolProfile,
  HAMMER_ENHANCE_CHANCE_BONUS,
} from './toolProfile.js'

const copper: ItemDef = testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' })
const iron: ItemDef = { ...copper, id: 'iron_pickaxe', toolTier: 2 }
const mithril: ItemDef = { ...copper, id: 'mithril_pickaxe', toolTier: 3 }

/** 착용 정보 리터럴 — 간격이 보는 것은 def 의 티어와 instance 의 강화 수치뿐이다. */
function info(def: ItemDef, enhanceLevel: number): EquippedToolInfo {
  return { def, instance: { instanceId: 'i1', itemId: def.id, enhanceLevel } }
}

/**
 * 그 도구만 든 손(증표 없음). `gatherHandOf` 가 증표 없는 사람에게 내놓는 것과
 * 같은 값이고, 그 등식 자체는 gatherHand.test.ts 가 증명한다 — 여기서는
 * `gatherIntervalMs` 가 손의 배수를 어떻게 쓰는지만 본다.
 */
function hand(def: ItemDef | null, enhanceLevel = 0): GatherHand {
  return {
    tool: def ? info(def, enhanceLevel) : null,
    profile: gatherToolProfile(def),
    intervalFactor: effectiveIntervalFactor(def, enhanceLevel),
  }
}

/** 속도증표까지 든 손 — 간격배수에만 ×0.9 가 얹힌다(설계 §5). */
const withSpeedToken = (base: GatherHand): GatherHand => ({
  ...base,
  intervalFactor: base.intervalFactor * TOKEN_SPEED_FACTOR,
})

describe('gatherToolProfile', () => {
  it('맨손(null)은 roll ×1.45 · 간격 ×1.5 · 평감산 0 — 게이트 대신 페널티가 도구의 존재 이유다(§2·§6-앞 3)', () => {
    expect(gatherToolProfile(null)).toEqual({ rollFactor: 1.45, intervalFactor: 1.5, jackpotFlat: 0 })
  })

  it('구리 ×1.0/×1.0/0 · 철 ×0.9/×0.8/−2 · 미스릴 ×0.8/×0.6/−3 — 티어 간격은 §6-앞 1 이 벌려 두었다', () => {
    expect(gatherToolProfile(copper)).toEqual({ rollFactor: 1.0, intervalFactor: 1.0, jackpotFlat: 0 })
    expect(gatherToolProfile(iron)).toEqual({ rollFactor: 0.9, intervalFactor: 0.8, jackpotFlat: 2 })
    expect(gatherToolProfile(mithril)).toEqual({ rollFactor: 0.8, intervalFactor: 0.6, jackpotFlat: 3 })
  })

  it('도구가 아니거나 티어가 없는 정의는 맨손 프로필이다 — 조용한 ×1.0 기본값 금지(§6-앞 9)', () => {
    const ore: ItemDef = testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' })
    const tierless: ItemDef = { ...copper, id: 'broken_tool', toolTier: undefined }
    expect(gatherToolProfile(ore)).toEqual(gatherToolProfile(null))
    expect(gatherToolProfile(tierless)).toEqual(gatherToolProfile(null))
  })

  it('엉뚱한 기술의 도구는 호출자(equippedToolInfo)가 null 로 만들어 온다 — 프로필은 받은 정의만 본다(§6-앞 9)', () => {
    // 곡괭이(mineral)를 착용한 채 herb 를 물으면 착용 조회가 null 을 답하고,
    // 판정자는 그 null 을 그대로 프로필에 넘긴다 — "엉뚱한 도구 = 맨손"은
    // 프로필이 아니라 이 조회가 지키는 규범이다.
    const player: PlayerState = {
      id: 'local', name: '아무개', appearance: 'player',
      skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      stacks: {},
      donated: {},
      // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
      gold: 0,
      instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
      nextActionAt: 0, celebrated: [], rewarded: [], dialogueHistory: emptyDialogueHistory(),
      location: { mapId: 'world', x: 0, y: 0 }, weather: null,
    }
    const items = { copper_pickaxe: copper }
    const wrongSkillTool = equippedToolInfo(player, 'herb', items)
    expect(wrongSkillTool).toBeNull()
    expect(gatherToolProfile(wrongSkillTool?.def ?? null)).toEqual(gatherToolProfile(null))
  })
})

describe('티어 대 강화의 불변식 — 강화가 승급의 드라마를 먹어치우면 안 된다(§6-앞 1)', () => {
  const maxEnhance = ENHANCE_INTERVAL_FACTOR ** ENHANCE_CAP

  it('구리를 +5 로 만강해도 신품 철이 더 빠르다 — 철 0.6~0.8 이 아니라 0.8 < 1.0×0.97^5(≈0.8587)', () => {
    expect(gatherToolProfile(iron).intervalFactor).toBeLessThan(
      gatherToolProfile(copper).intervalFactor * maxEnhance,
    )
  })

  it('철을 +5 로 만강해도 신품 미스릴이 더 빠르다 — 0.6 < 0.8×0.97^5(≈0.687)', () => {
    expect(gatherToolProfile(mithril).intervalFactor).toBeLessThan(
      gatherToolProfile(iron).intervalFactor * maxEnhance,
    )
  })

  // 망치 축에도 같은 규범이 걸린다(§6-앞 18). 이 부등식이 없던 시절
  // (+0.5%p/레벨)에는 만강 구리 망치(+4.5%p)가 신품 철 망치(+4.0%p)를 이겨,
  // 승급이 강화보다 못한 선택이 됐다 — 간격 축에서 §6-앞 1 이 금지한 바로 그 일이다.
  it('상위 티어 망치 기본 보너스 > 하위 티어 만강 보너스 — 승급이 강화에 먹히지 않는다', () => {
    expect(hammerChanceBonus(2, 0)).toBeGreaterThan(hammerChanceBonus(1, ENHANCE_CAP))
    expect(hammerChanceBonus(3, 0)).toBeGreaterThan(hammerChanceBonus(2, ENHANCE_CAP))
    // 티어 한 칸이 만강 한 벌보다 크다는 상수 사이의 부등식이 위 둘의 근거다 —
    // 티어가 몇 개로 늘어도 이 한 줄이 성립하는 한 불변식은 유지된다.
    expect(CRAFT_TOOL_TIER_CHANCE_BONUS).toBeGreaterThan(ENHANCE_CAP * HAMMER_ENHANCE_CHANCE_BONUS)
  })
})

describe('effectiveIntervalFactor — 자동 착용 비교와 가방 칩이 읽는 도구 전용 배수(§6-앞 2·16)', () => {
  it('신품은 티어 배수 그대로이고, 강화는 ×0.97^n 이 곱으로 붙는다', () => {
    expect(effectiveIntervalFactor(copper, 0)).toBe(1.0)
    expect(effectiveIntervalFactor(iron, 0)).toBe(0.8)
    expect(effectiveIntervalFactor(copper, 5)).toBeCloseTo(0.97 ** 5)
  })

  it('null(맨손)은 ×1.5 다 — 빈 슬롯과의 비교가 이 값으로 성립해 첫 도구가 자연히 착용된다', () => {
    expect(effectiveIntervalFactor(null, 0)).toBe(1.5)
  })

  it('gatherIntervalMs 가 같은 배수를 읽는다 — 비교와 스탬프가 갈라지면 "낫다"고 착용한 도구가 실제로는 더 느릴 수 있다', () => {
    expect(gatherIntervalMs(100, hand(mithril, 3))).toBe(
      Math.max(ACTION_INTERVAL_MIN_MS, Math.round(actionIntervalMs(100) * effectiveIntervalFactor(mithril, 3))),
    )
  })
})

describe('gatherIntervalMs', () => {
  it('맨손은 숙련 간격의 ×1.5 다 — 숙련 0 이면 500ms 가 아니라 750ms(§3)', () => {
    expect(gatherIntervalMs(0, hand(null))).toBe(750)
  })

  it('1티어 도구는 숙련 간격 그대로다 — 첫 도구의 체감은 맨손 페널티가 사라지는 것이다', () => {
    expect(gatherIntervalMs(0, hand(copper))).toBe(500)
  })

  it('강화 +1 마다 ×0.97 이 곱으로 붙는다 — 구리 +1 은 485ms, +5 는 429ms(§5)', () => {
    expect(gatherIntervalMs(0, hand(copper, 1))).toBe(
      Math.round(ACTION_INTERVAL_MAX_MS * ENHANCE_INTERVAL_FACTOR),
    )
    expect(gatherIntervalMs(0, hand(copper, ENHANCE_CAP))).toBe(
      Math.round(ACTION_INTERVAL_MAX_MS * ENHANCE_INTERVAL_FACTOR ** ENHANCE_CAP),
    )
  })

  it('속도증표를 든 손은 그만큼 더 짧다 — 간격의 세 소유자(티어·강화·증표)가 한 배수로 도착한다', () => {
    // 구리 맨몸 500ms → 증표 450ms. 이 함수는 곱을 스스로 하지 않는다: 손이
    // 이미 곱해 온 배수를 숙련 간격에 곱할 뿐이다.
    expect(gatherIntervalMs(0, withSpeedToken(hand(copper)))).toBe(450)
    expect(gatherIntervalMs(0, withSpeedToken(hand(null)))).toBe(675)
  })

  // 왜: 이 숫자는 숙련도 탭이 그대로 찍는다(§6-앞 13). 배수를 곱한 값을 반올림
  //     하지 않으면 강화 직후에 "행동 간격 429.3670128499999ms" 가 뜬다 —
  //     맨손도 홀수 기준선에서는 .5 가 남는다. actionIntervalMs 가 이미 정수를
  //     약속하므로, 간격을 만드는 이 함수도 같은 계약을 지켜야 한다.
  it('간격은 언제나 정수다 — 강화한 도구도 맨손도 증표를 든 손도 소수점 꼬리를 남기지 않는다', () => {
    const hands = [hand(null), hand(copper, 1), hand(copper, ENHANCE_CAP), hand(iron, 3), hand(mithril, 5)]
    for (const h of [...hands, ...hands.map(withSpeedToken)]) {
      for (const prof of [0, 1, 7, 123, 4_567, 98_765, 1_000_000]) {
        expect(Number.isInteger(gatherIntervalMs(prof, h))).toBe(true)
      }
    }
  })

  it('하한 50ms 는 배수를 곱한 뒤에 클램프한다 — 기본 간격이 하한 위여도 곱이 내려가면 하한이 답이다(§6-앞 6)', () => {
    // 숙련 398,107 → actionIntervalMs = 80ms(하한 위). 미스릴 +5 의 곱
    // 80×0.6×0.97^5 ≈ 41.2ms 는 하한 아래다 — 하한을 곱 앞에 두는 구현
    // (max(50, base)×배수)이라면 41.2 가 그대로 나와 이 테스트가 깨진다.
    const prof = 398_107
    expect(gatherIntervalMs(prof, hand(mithril, 5))).toBe(50)
  })

  it('숙련 최속(50ms)에서는 도구도 증표도 더 못 줄인다 — 종반 포화는 수용한다(§6-앞 6, "초당 20회"가 계속 참이다)', () => {
    expect(gatherIntervalMs(10_000_000, hand(mithril, 5))).toBe(50)
    expect(gatherIntervalMs(10_000_000, withSpeedToken(hand(mithril, 5)))).toBe(50)
  })
})

/**
 * 제작 간격 — 망치의 **강화만** 줄인다(제작 확장 §6-앞 14).
 *
 * 강화가 제작 간격을 무시하던 시절, 망치 +5 는 네 계열의 원재료와 골드를 다 먹고
 * 성공률 +1.5%p 만 돌려줬다 — 아무도 하지 않는 사다리였다. 간격이 붙으면 정제
 * 노가다 자체가 빨라져 그 대가가 값어치를 갖는다.
 */
const copperHammer: ItemDef = testTool('copper_hammer', 'crafting', 1, { name: '구리 망치', icon: 'hammer_copper' })
const ironHammer: ItemDef = { ...copperHammer, id: 'iron_hammer', toolTier: 2 }
const mithrilHammer: ItemDef = { ...copperHammer, id: 'mithril_hammer', toolTier: 3 }

describe('craftIntervalMs', () => {
  it('망치가 없으면 숙련 간격 그대로다 — 제작에 맨손 페널티는 없다(망치는 게이트가 아니라 보조다)', () => {
    expect(craftIntervalMs(0, null)).toBe(ACTION_INTERVAL_MAX_MS)
    expect(craftIntervalMs(0, null)).toBe(actionIntervalMs(0))
  })

  // 왜: 티어는 이미 성공률(CRAFT_TOOL_TIER_CHANCE_BONUS)을 산다. 간격까지 주면 한
  //     축의 승급이 두 번 계산되고, 채집 도구가 두 축(roll·간격)을 나눠 갖는 설계와
  //     달리 망치는 성공률·간격을 **혼자** 독식한다 — 망치 하나가 다른 도구 넷을
  //     합친 것보다 큰 물건이 된다. 그래서 제작 간격의 주인은 강화 하나다.
  it('망치 티어는 제작 간격을 바꾸지 않는다 — 티어가 사는 것은 성공률이고, 두 축을 다 주면 이중 계산이다', () => {
    for (const def of [copperHammer, ironHammer, mithrilHammer]) {
      expect(craftIntervalMs(0, info(def, 0))).toBe(craftIntervalMs(0, null))
    }
    // 강화가 같으면 티어가 달라도 같은 간격이다 — 곱해지는 것이 티어가 아니라는 증거.
    expect(craftIntervalMs(0, info(mithrilHammer, 5))).toBe(craftIntervalMs(0, info(copperHammer, 5)))
  })

  it('강화 +1 마다 ×0.97 이 곱으로 붙는다 — 채집과 같은 상수, 같은 규칙이다', () => {
    expect(craftIntervalMs(0, info(copperHammer, 1))).toBe(
      Math.round(ACTION_INTERVAL_MAX_MS * ENHANCE_INTERVAL_FACTOR),
    )
    expect(craftIntervalMs(0, info(copperHammer, ENHANCE_CAP))).toBe(
      Math.round(ACTION_INTERVAL_MAX_MS * ENHANCE_INTERVAL_FACTOR ** ENHANCE_CAP),
    )
    // 만강 망치는 신품보다 71ms 빠르다 — 이 체감이 §6-앞 14 가 사려던 것이다.
    expect(craftIntervalMs(0, info(copperHammer, ENHANCE_CAP))).toBe(429)
  })

  // 왜: 채집 쪽이 정확히 이 사고를 한 번 냈다 — 숙련도 탭이 "429.3670128499999ms"
  //     를 그대로 찍었다. 제작 간격도 화면이 그대로 찍으므로 같은 계약을 진다.
  it('간격은 언제나 정수다 — 강화한 망치도 맨손도 소수점 꼬리를 남기지 않는다', () => {
    for (const hammer of [null, info(copperHammer, 1), info(copperHammer, ENHANCE_CAP), info(mithrilHammer, 3)]) {
      for (const prof of [0, 1, 7, 123, 4_567, 98_765, 1_000_000]) {
        expect(Number.isInteger(craftIntervalMs(prof, hammer))).toBe(true)
      }
    }
  })

  it('하한 50ms 는 배수를 곱한 뒤에 클램프한다 — 채집과 같은 순서다', () => {
    // 숙련 857,700 → actionIntervalMs = 55ms(하한 위). 만강의 곱
    // 55×0.97^5 ≈ 47.2ms 는 하한 아래다 — 하한을 곱 앞에 두는 구현이라면
    // 47 이 그대로 나와 이 테스트가 깨진다.
    expect(craftIntervalMs(857_700, info(copperHammer, ENHANCE_CAP))).toBe(ACTION_INTERVAL_MIN_MS)
    expect(craftIntervalMs(10_000_000, info(copperHammer, ENHANCE_CAP))).toBe(ACTION_INTERVAL_MIN_MS)
  })
})
