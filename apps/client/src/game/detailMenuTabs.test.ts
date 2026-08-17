import { emptyPlayer, loadGameData } from '@nogada/data'
import { ENHANCE_CAP, SKILL_LABELS, type GameData, type PlayerState } from '@nogada/shared'
import { testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { MILESTONE_FOLD, SETTINGS_ACTION, TABS } from './detailMenuTabs.js'

/** 아무것도 안 펼친 상태 — 접이 머리를 쓰지 않는 탭들이 넘기는 값이다. */
const 접힘: ReadonlySet<string> = new Set()

function settingsLines() {
  const tab = TABS.find((t) => t.id === 'settings')!
  return tab.buildLines(loadGameData(), emptyPlayer(), 접힘)
}

function skillLines(player: PlayerState, data: GameData = loadGameData()) {
  const tab = TABS.find((t) => t.id === 'skills')!
  return tab.buildLines(data, player, 접힘)
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

/**
 * 이정표 탭의 효과 줄 — 이 탭이 무엇을 약속하는가.
 *
 * 결계 넷은 한동안 `title` 로 실려 있었다. 그래서 화면이 "얼음 결계를 넘을 수
 * 있다" 바로 아래에 "칭호 — 효과는 없다" 를 적었고, 두 줄이 서로를 부정했다.
 * 그 두 줄이 다시 어긋나지 않게 **화면에 뜨는 문자열 그대로** 못박는다.
 */
describe('이정표 탭 — 결계 줄', () => {
  function milestoneLines(player: PlayerState) {
    const tab = TABS.find((t) => t.id === 'milestones')!
    // 자루 둘을 펼친 채로 묻는다 — 이 판이 보는 것은 **효과 줄의 글자**이고,
    // 결계 넷은 신규에게 접힌 자루 안에 있다(첫 화면은 묶음마다 한 줄이다).
    // 접혔을 때도 그 글자가 참이어야 한다는 것이 접기와 숨기기의 차이다.
    return tab.buildLines(loadGameData(), player, new Set(Object.values(MILESTONE_FOLD)))
  }

  /** 그 이정표의 효과 줄 — 이름 줄 바로 다음 줄이다. */
  function effectLine(player: PlayerState, name: string): string {
    const lines = milestoneLines(player)
    const head = lines.findIndex((l) => l.text.startsWith(name) || l.text === `✓ ${name}`)
    if (head < 0) throw new Error(`이정표 줄을 못 찾았다: ${name}`)
    return lines[head + 1]!.text
  }

  const 초보 = emptyPlayer()
  const 장인 = {
    ...emptyPlayer(),
    skills: { ice: 85000, wood: 85000, mineral: 85000, herb: 85000, crafting: 0 },
  }

  // 왜: 못한 줄이 "칭호 — 효과는 없다" 를 적으면, 85,000 을 향해 캐는 이유가
  //     화면에서 사라진다. 어느 맵의 벽인지를 적는 것이 그 이유다.
  it('못한 결계 줄은 어느 채집장의 벽이 열리는지 적는다', () => {
    expect(effectLine(초보, '얼음 결계를 넘을 수 있다')).toBe(
      '달성하면 얼음 채집장의 결계가 더는 밀어내지 않는다',
    )
    expect(effectLine(초보, '나무 결계를 넘을 수 있다')).toBe(
      '달성하면 나무 수렵장의 결계가 더는 밀어내지 않는다',
    )
    expect(effectLine(초보, '광물 결계를 넘을 수 있다')).toBe(
      '달성하면 광물 채굴장의 결계가 더는 밀어내지 않는다',
    )
  })

  // 왜: 허브 문은 숙련만으로 열리지 않는다(물때도 진다). 그 사실을 빼면 목록이
  //     85,000 을 채운 사람에게 "열렸다" 고 말해 놓고 문은 여전히 밀어낸다.
  it('허브 줄은 물때까지 적는다 — 숙련만으로는 안 열리는 유일한 문이다', () => {
    expect(effectLine(초보, '허브 결계를 넘을 수 있다')).toBe(
      '달성하면 허브 채집장의 결계가 더는 밀어내지 않는다 — 물이 빠졌을 때만',
    )
  })

  // 왜: 달성한 줄은 시제만 다르다 — 같은 사실을 현재형으로 말한다.
  it('달성한 결계 줄은 지금 열려 있다고 말한다', () => {
    expect(effectLine(장인, '얼음 결계를 넘을 수 있다')).toBe(
      '얼음 채집장의 결계가 더는 밀어내지 않는다',
    )
    expect(effectLine(장인, '허브 결계를 넘을 수 있다')).toBe(
      '허브 채집장의 결계가 더는 밀어내지 않는다 — 물이 빠졌을 때만',
    )
  })

  // 왜: 이 아크가 지운 거짓말이 바로 이 문자열이다. 어느 결계 줄에도 다시
  //     나타나면 안 된다.
  it('결계 줄 넷 중 어느 것도 "효과는 없다" 라고 말하지 않는다', () => {
    for (const name of ['얼음', '나무', '광물', '허브']) {
      expect(effectLine(초보, `${name} 결계를 넘을 수 있다`)).not.toContain('효과는 없다')
    }
  })
})

/**
 * 이정표 탭의 40줄 벽 — 신규가 보던 첫 화면이 「칭호 — 효과는 없다」 열넷이었다.
 *
 * 정렬이 진척 비율 내림차순이었는데 신규는 40개가 전부 0.000 이라 그 정렬이
 * 무효였고, 화면 순서가 문자 그대로 CSV 행 순서였다. 여기서 못박는 것은 그
 * 화면이 다시 그렇게 되지 않는다는 것이다.
 */
describe('이정표 탭 — 묶음과 접기', () => {
  const 펼침: ReadonlySet<string> = new Set(Object.values(MILESTONE_FOLD))

  function lines(player: PlayerState, expanded: ReadonlySet<string> = 접힘) {
    const tab = TABS.find((t) => t.id === 'milestones')!
    return tab.buildLines(loadGameData(), player, expanded).map((l) => ({ ...l }))
  }

  /** 접이 머리가 아닌 줄들 — 이정표 본문 두 줄씩이다. */
  function bodyLines(player: PlayerState, expanded?: ReadonlySet<string>) {
    return lines(player, expanded).filter((l) => !l.groupId)
  }

  const 초보 = emptyPlayer()

  // 왜: **실측이 정한 수다.** 이 목록의 줄 하나는 18px 이고 뷰포트는 812×375 에서
  //     255px 다 — 열네 줄(252px)까지가 화면이고 열여섯 줄이면 288px 라 접이 머리
  //     둘이 통째로 아래로 밀려난다. 그 둘이 나머지 서른넷에 닿는 유일한 손잡이라,
  //     안 보이는 자리에 놓이면 접은 것이 아니라 지운 것이 된다.
  it('신규의 첫 화면은 12줄 + 접힌 머리 둘 — 뷰포트 255px 에 들어가는 수다', () => {
    const first = lines(초보)
    expect(first.filter((l) => l.groupId)).toHaveLength(2)
    expect(first.filter((l) => !l.groupId)).toHaveLength(12)
    // 줄 높이 15 + 줄 사이 3(ScrollList.ROW_GAP). 마지막 줄에는 뒤 여백이 없다.
    expect(first.length * 18 - 3).toBeLessThanOrEqual(255)
  })

  // 왜: 이 아크가 고치려던 것이 정확히 이 문자열의 개수다 — 열넷이었다.
  //     머리 자리에 순수 칭호를 세우지 않으므로 첫 화면에는 한 줄도 안 남는다.
  it('첫 화면에 「효과는 없다」가 한 줄도 없다 — 열넷이었다', () => {
    expect(bodyLines(초보).filter((l) => l.text.includes('효과는 없다'))).toEqual([])
  })

  // 왜: `고르게` 셋은 전부 순수 칭호라 그 묶음에는 내보일 문이 없다. 없는 문을
  //     지어내는 대신 머리를 안 내고 칭호 자루에 그대로 둔다 — 세 줄 다 거기 있다.
  it('열 문이 없는 묶음은 머리를 안 낸다 — 대신 칭호 자루에 그대로 있다', () => {
    expect(bodyLines(초보).some((l) => l.text.startsWith('고르게'))).toBe(false)
    expect(bodyLines(초보, 펼침).some((l) => l.text.startsWith('고르게 익숙해지다'))).toBe(true)
  })

  // 왜: `gatedRecipesOf` 가 없으면 이 줄은 「칭호 — 효과는 없다」로 돌아간다.
  //     얼음 1,000 은 신규가 3.4분에 처음 만나는 진짜 문이다(설계 ③ 마디 4).
  it('얼음 1,000 은 칭호가 아니라 비 가루·눈 가루의 문이라고 말한다', () => {
    const head = lines(초보).findIndex((l) => l.text.startsWith('얼음에 익숙해지다'))
    expect(head).toBeGreaterThanOrEqual(0)
    expect(lines(초보)[head + 1]!.text).toBe('달성하면 만들 수 있다 — 비 가루 · 눈 가루')
  })

  // 왜: 얼음 10,000 은 자동 반복과 레시피 둘을 **동시에** 연다. 한쪽만 적으면
  //     나머지 한쪽은 화면 어디에도 없다 — effect 칸만 읽던 시절의 손실이다.
  it('효과가 둘인 이정표는 둘 다 말한다', () => {
    const all = lines(초보, 펼침)
    const head = all.findIndex((l) => l.text.startsWith('얼음이 손에 익다'))
    expect(all[head + 1]!.text).toBe(
      '달성하면 누르고 있는 것만으로 계속된다 · 달성하면 만들 수 있다 — 굵은 비 가루 · 함박눈 가루',
    )
  })

  // 왜: groupId 가 빠지면 머리는 그대로 보이는데 눌리지만 않는다 — 그러면 나머지
  //     서른셋이 도달할 방법 없이 접힌 채로 남는다. 그건 접은 것이 아니라 지운 것이다.
  it('접이 머리 둘은 누를 수 있고, 남은 개수를 세어 말한다', () => {
    const heads = lines(초보).filter((l) => l.groupId)
    expect(heads.map((l) => l.groupId)).toEqual([MILESTONE_FOLD.gates, MILESTONE_FOLD.titles])
    // 문 23개 중 여섯이 머리로 나가 있고, 순수 칭호 17개는 하나도 안 나가 있다.
    expect(heads[0]!.text).toContain('그 뒤의 문 17개')
    expect(heads[1]!.text).toContain('칭호 17개')
    for (const head of heads) expect(head.text).toContain('[펼치기]')
  })

  // 왜: 접는 것과 숨기는 것은 다르다(설계 ④·⑥). 펼치면 40개가 전부, 잠긴 것까지
  //     이름 그대로 나와야 한다 — `???` 는 한 글자도 쓰지 않는다.
  it('펼치면 40개가 전부 나온다 — ??? 는 한 글자도 없다', () => {
    const data = loadGameData()
    const all = lines(초보, 펼침)
    for (const def of data.milestones) {
      expect(all.some((l) => l.text.startsWith(def.name) || l.text === `✓ ${def.name}`)).toBe(true)
    }
    expect(all.filter((l) => !l.groupId)).toHaveLength(data.milestones.length * 2)
    expect(all.some((l) => l.text.includes('???'))).toBe(false)
    for (const head of all.filter((l) => l.groupId)) expect(head.text).toContain('[접기]')
  })

  // 왜: 「0 / 200」만 적혀 있으면 200 이 조합 숙련인지 망치 개수인지 화면 어디에도
  //     없다. 이 탭은 무엇을 얼마나 캐야 하는지를 답하는 자리다.
  it('진척 숫자 앞에 무엇을 재는 자인지 적는다', () => {
    const all = lines(초보, 펼침).map((l) => l.text)
    expect(all).toContain('얼음에 익숙해지다   얼음 숙련 0 / 1,000')
    expect(all).toContain('구리 망치를 만들 수 있다   조합 숙련 0 / 200')
    expect(all).toContain('흔한 것을 되살 수 있다   수집 총점 0 / 30')
    expect(all).toContain('고르게 익숙해지다   이정표 0 / 4')
  })

  // 왜: 묶음 순서가 흔들리면 어제 본 자리에 오늘 다른 것이 있다. 그리고 광물·수집
  //     묶음의 머리가 각각 1,000·10(둘 다 순수 칭호)으로 돌아가면 첫 화면의
  //     「효과는 없다」가 없음에서 둘이 된다 — 머리 고르기 규칙이 사는 자리다.
  it('첫 화면의 여섯 줄은 묶음 순서대로, 묶음마다 못한 첫 「문」이다', () => {
    const heads = bodyLines(초보)
      .filter((_l, i) => i % 2 === 0)
      .map((l) => l.text)
    expect(heads).toEqual([
      '얼음에 익숙해지다   얼음 숙련 0 / 1,000',
      '나무에 익숙해지다   나무 숙련 0 / 1,000',
      '광물이 손에 익다   광물 숙련 0 / 10,000',
      '약초에 익숙해지다   허브 숙련 0 / 1,000',
      '구리 망치를 만들 수 있다   조합 숙련 0 / 200',
      '흔한 것을 되살 수 있다   수집 총점 0 / 30',
    ])
  })

  // 왜: 고인물의 첫 화면도 답이 있어야 한다. 얼음 20,000 인 사람의 얼음 줄은 이미
  //     넘긴 1,000·10,000 이 아니라 **아직 안 넘긴 문** 이어야 하고, 그 문은
  //     50,000(「얼음을 오래 다루다」— 순수 칭호)이 아니라 85,000(결계)이다.
  //     가까운 장식보다 먼 문을 고른다는 것이 이 규칙의 값이다.
  it('이미 넘긴 것은 머리가 아니고, 가까운 칭호보다 먼 문을 고른다', () => {
    const 고인물: PlayerState = {
      ...emptyPlayer(),
      skills: { ice: 20000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    }
    const 위 = bodyLines(고인물)
    expect(위[0]!.text).toBe('얼음 결계를 넘을 수 있다   얼음 숙련 20,000 / 85,000')
    expect(위[1]!.text).toBe('달성하면 얼음 채집장의 결계가 더는 밀어내지 않는다')
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
    const text = tab.buildLines(loadGameData(), player, 접힘).map((l) => l.text).join(' ')
    expect(text).toContain('항구사람')
  })
})
