import { emptyPlayer, loadGameData } from '@nogada/data'
import { ENHANCE_CAP, SKILL_LABELS, type GameData, type PlayerState } from '@nogada/shared'
import { testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { SETTINGS_ACTION, TABS } from './detailMenuTabs.js'

function settingsLines() {
  const tab = TABS.find((t) => t.id === 'settings')!
  return tab.buildLines(loadGameData(), emptyPlayer())
}

function skillLines(player: PlayerState, data: GameData = loadGameData()) {
  const tab = TABS.find((t) => t.id === 'skills')!
  return tab.buildLines(data, player)
}

/** 각 줄이 적은 간격 숫자만 뽑는다 — 화면에 뜨는 그 문자열 그대로다. */
function intervalTokens(player: PlayerState): string[] {
  return skillLines(player).map((line) => {
    const found = /행동 간격 (.+)ms$/.exec(line.text)
    if (!found?.[1]) throw new Error(`간격을 적지 않은 줄이 있다: ${line.text}`)
    return found[1]
  })
}

/** 광물 줄 하나 — 곡괭이(mineral)가 바뀌는 것을 보는 자리다. */
function mineralInterval(player: PlayerState): string {
  const line = skillLines(player).find((l) => l.text.startsWith(SKILL_LABELS.mineral))!
  return /행동 간격 (.+)ms$/.exec(line.text)![1]!
}

/** 조합 줄 하나 — 망치(crafting)가 바뀌는 것을 보는 자리다. */
function craftingInterval(player: PlayerState, data?: GameData): number {
  const line = skillLines(player, data).find((l) => l.text.startsWith(SKILL_LABELS.crafting))!
  return Number(/행동 간격 (.+)ms$/.exec(line.text)![1]!)
}

/** 망치 하나만 들고 있는 플레이어. */
function withHammer(itemId: string, enhanceLevel: number): PlayerState {
  return {
    ...emptyPlayer(),
    instances: [{ instanceId: 'h1', itemId, enhanceLevel }],
    equipped: { crafting: 'h1' },
  }
}

describe('숙련도 탭', () => {
  // 왜: 이 탭은 강화 직후에 확인하러 오는 자리다. 배수를 곱한 값을 그대로 찍으면
  //     "행동 간격 429.3670128499999ms" 가 뜬다 — 도구가 준 것이 무엇인지 읽을 수
  //     없는 숫자다. 맨손도 홀수 기준선(숙련 9 → 425ms)에서는 ×1.5 가 .5 를 남긴다.
  it('강화한 도구의 간격에 소수점이 없다', () => {
    const player: PlayerState = {
      ...emptyPlayer(),
      instances: [{ instanceId: 'p1', itemId: 'copper_pickaxe', enhanceLevel: ENHANCE_CAP }],
      equipped: { mineral: 'p1' },
    }
    // 500 × 0.97^5 = 429.3670128499999 → 429
    expect(mineralInterval(player)).toMatch(/^\d+$/)
    for (const token of intervalTokens(player)) expect(token).toMatch(/^\d+$/)
  })

  it('맨손의 간격에도 소수점이 없다', () => {
    // 숙련 9 의 기준선은 425ms(홀수) — 맨손 ×1.5 는 637.5 가 된다.
    const player: PlayerState = {
      ...emptyPlayer(),
      skills: { ice: 9, wood: 9, mineral: 9, herb: 9, crafting: 9 },
    }
    for (const token of intervalTokens(player)) expect(token).toMatch(/^\d+$/)
  })

  // 왜: 위 두 검사는 "간격을 아예 안 쓰거나 늘 정수 상수를 쓰는" 구현으로도
  //     통과한다. 강화가 이 줄을 실제로 움직이는지까지 봐야 §6-앞 13(화면이
  //     서버와 같은 함수를 읽는다)이 지켜진 것이다.
  it('강화가 이 줄을 실제로 움직인다 — 정수로 찍되 도구를 반영한다', () => {
    const base = { ...emptyPlayer(), instances: [{ instanceId: 'p1', itemId: 'copper_pickaxe', enhanceLevel: 0 }], equipped: { mineral: 'p1' } }
    const enhanced: PlayerState = {
      ...base,
      instances: [{ instanceId: 'p1', itemId: 'copper_pickaxe', enhanceLevel: ENHANCE_CAP }],
    }
    expect(Number(mineralInterval(enhanced))).toBeLessThan(Number(mineralInterval(base)))
  })

  // 왜: 조합 줄만 다른 함수를 쓴다(craftIntervalMs — 제작 확장 §6-앞 14). 그
  //     분기가 사라져도 위 검사들은 전부 초록이다: 숫자는 여전히 정수이고,
  //     곡괭이 강화도 여전히 광물 줄을 움직인다. 이 줄이 거짓말하는 모양은
  //     정확히 둘이고 둘 다 여기서만 잡힌다 — ① 망치 강화를 무시해 만강 망치를
  //     든 사람에게 500ms 라고 적으면서 서버는 429ms 로 스탬프하거나,
  //     ② effectiveIntervalFactor 를 불러 망치 티어까지 간격에 넣거나
  //     (티어가 사는 것은 성공률이다).
  it('조합 줄은 망치 강화로 짧아지고, 망치 티어로는 짧아지지 않는다', () => {
    const data = loadGameData()
    // 2티어 망치는 출하 데이터에 아직 없다 — "티어는 간격을 안 산다"를 물으려면
    // 티어가 다른 망치가 둘 있어야 하므로 여기서 하나를 세운다(서버의
    // craftService.test 가 같은 이유로 같은 망치를 세운다).
    const withIronHammer: GameData = {
      ...data,
      items: {
        ...data.items,
        iron_hammer: testTool('iron_hammer', 'crafting', 2, { name: '철 망치', icon: 'hammer_iron' }),
      },
    }

    const fresh = craftingInterval(withHammer('copper_hammer', 0), withIronHammer)
    const enhanced = craftingInterval(withHammer('copper_hammer', ENHANCE_CAP), withIronHammer)
    const freshIron = craftingInterval(withHammer('iron_hammer', 0), withIronHammer)

    // 500 × 0.97^5 = 429.3670128499999 → 429
    expect(enhanced).toBeLessThan(fresh)
    expect(enhanced).toBe(429)
    // 신품 철 망치는 신품 구리와 한 자릿수까지 같다 — 티어는 이 축에 한 푼도 안 낸다.
    expect(freshIron).toBe(fresh)
    expect(fresh).toBe(500)
  })
})

describe('설정 탭', () => {
  // 왜: 이 두 줄이 계정을 놓는 유일한 문이다. groupId 가 빠지면 줄은 그대로
  //     보이는데 눌리지만 않아서, 화면만 봐서는 고장인지 원래 그런 것인지
  //     구별되지 않는다 — ScrollList 는 groupId 없는 줄을 표시 전용으로 다룬다.
  it('로그아웃과 캐릭터 삭제는 누를 수 있는 줄이다', () => {
    const groups = new Set(settingsLines().map((l) => l.groupId).filter(Boolean))
    expect(groups).toContain(SETTINGS_ACTION.logout)
    expect(groups).toContain(SETTINGS_ACTION.deleteCharacter)
  })

  // 왜: 같은 groupId 를 쓰면 로그아웃을 누른 사람에게 삭제 확인 창이 뜬다.
  //     되돌릴 수 있는 일과 없는 일이 한 버튼이 되는 것이 이 검사가 막는 것이다.
  it('둘은 서로 다른 줄이다', () => {
    expect(SETTINGS_ACTION.logout).not.toBe(SETTINGS_ACTION.deleteCharacter)
  })

  // 왜: 누르기 전에 되돌릴 수 없다는 것을 말해야 한다. 누른 뒤에 처음 듣는
  //     경고는 이미 마음을 정한 사람에게 하는 확인일 뿐이다.
  it('삭제 줄이 되돌릴 수 없음을 미리 말한다', () => {
    const warning = settingsLines()
      .filter((l) => l.groupId === SETTINGS_ACTION.deleteCharacter)
      .map((l) => l.text)
      .join(' ')
    expect(warning).toContain('되돌릴 수 없습니다')
  })

  // 왜: 삭제와 로그아웃이 나란히 있는 화면에서 "지금 누구인가"를 모르면,
  //     계정을 두 개 쓰는 사람이 지우려던 것과 다른 캐릭터를 지운다.
  it('지금 누구로 놀고 있는지 함께 보여준다', () => {
    const player = { ...emptyPlayer(), name: '항구사람' }
    const tab = TABS.find((t) => t.id === 'settings')!
    const text = tab.buildLines(loadGameData(), player).map((l) => l.text).join(' ')
    expect(text).toContain('항구사람')
  })
})
