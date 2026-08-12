import { describe, expect, it } from 'vitest'
import { equippedToolInfo, type EquippedToolInfo } from '../equipment.js'
import type { ItemDef, PlayerState } from '../types.js'
import { emptyDialogueHistory } from '../dialogue.js'
import { actionIntervalMs } from './proficiency.js'
import {
  ENHANCE_CAP,
  ENHANCE_INTERVAL_FACTOR,
  effectiveIntervalFactor,
  gatherIntervalMs,
  gatherToolProfile,
} from './toolProfile.js'

const copper: ItemDef = {
  id: 'copper_pickaxe', name: '구리 곡괭이', kind: 'tool', toolSkill: 'mineral', toolTier: 1, icon: 'pickaxe_copper',
}
const iron: ItemDef = { ...copper, id: 'iron_pickaxe', toolTier: 2 }
const mithril: ItemDef = { ...copper, id: 'mithril_pickaxe', toolTier: 3 }

/** 착용 정보 리터럴 — gatherIntervalMs 가 보는 것은 def 의 티어와 instance 의 강화 수치뿐이다. */
function info(def: ItemDef, enhanceLevel: number): EquippedToolInfo {
  return { def, instance: { instanceId: 'i1', itemId: def.id, enhanceLevel } }
}

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
    const ore: ItemDef = { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' }
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
      instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
      equipped: { mineral: 'i1' },
      nextActionAt: 0, celebrated: [], dialogueHistory: emptyDialogueHistory(),
      location: { mapId: 'world', x: 0, y: 0 },
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
})

describe('effectiveIntervalFactor — 자동 착용 비교와 화면 표기가 읽는 유효 간격배수(§6-앞 2·13)', () => {
  it('신품은 티어 배수 그대로이고, 강화는 ×0.97^n 이 곱으로 붙는다', () => {
    expect(effectiveIntervalFactor(copper, 0)).toBe(1.0)
    expect(effectiveIntervalFactor(iron, 0)).toBe(0.8)
    expect(effectiveIntervalFactor(copper, 5)).toBeCloseTo(0.97 ** 5)
  })

  it('null(맨손)은 ×1.5 다 — 빈 슬롯과의 비교가 이 값으로 성립해 첫 도구가 자연히 착용된다', () => {
    expect(effectiveIntervalFactor(null, 0)).toBe(1.5)
  })

  it('gatherIntervalMs 가 같은 배수를 읽는다 — 비교와 스탬프가 갈라지면 "낫다"고 착용한 도구가 실제로는 더 느릴 수 있다', () => {
    expect(gatherIntervalMs(100, info(mithril, 3))).toBe(
      Math.max(50, actionIntervalMs(100) * effectiveIntervalFactor(mithril, 3)),
    )
  })
})

describe('gatherIntervalMs', () => {
  it('맨손은 숙련 간격의 ×1.5 다 — 숙련 0 이면 500ms 가 아니라 750ms(§3)', () => {
    expect(gatherIntervalMs(0, null)).toBe(750)
  })

  it('1티어 도구는 숙련 간격 그대로다 — 첫 도구의 체감은 맨손 페널티가 사라지는 것이다', () => {
    expect(gatherIntervalMs(0, info(copper, 0))).toBe(500)
  })

  it('강화 +1 마다 ×0.97 이 곱으로 붙는다 — 구리 +1 은 485ms, +5 는 ≈429ms(§5)', () => {
    expect(gatherIntervalMs(0, info(copper, 1))).toBeCloseTo(485)
    expect(gatherIntervalMs(0, info(copper, 5))).toBeCloseTo(500 * 0.97 ** 5)
  })

  it('하한 50ms 는 배수를 곱한 뒤에 클램프한다 — 기본 간격이 하한 위여도 곱이 내려가면 하한이 답이다(§6-앞 6)', () => {
    // 숙련 398,107 → actionIntervalMs = 80ms(하한 위). 미스릴 +5 의 곱
    // 80×0.6×0.97^5 ≈ 41.2ms 는 하한 아래다 — 하한을 곱 앞에 두는 구현
    // (max(50, base)×배수)이라면 41.2 가 그대로 나와 이 테스트가 깨진다.
    const prof = 398_107
    expect(gatherIntervalMs(prof, info(mithril, 5))).toBe(50)
  })

  it('숙련 최속(50ms)에서는 도구가 더 못 줄인다 — 종반 포화는 수용한다(§6-앞 6, "초당 20회"가 계속 참이다)', () => {
    expect(gatherIntervalMs(10_000_000, info(mithril, 5))).toBe(50)
  })
})
