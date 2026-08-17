import { emptyPlayer, loadGameData } from '@nogada/data'
import { ENHANCE_CAP, SKILL_LABELS, type GameData, type PlayerState } from '@nogada/shared'
import { testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { MILESTONE_FOLD, SETTINGS_ACTION, TABS } from './detailMenuTabs.js'
import { FONT_SIZE } from './gameText.js'
import { panelListRect } from './panelBox.js'
import { ROW_GAP } from './scrollListGeometry.js'

/** 아무것도 안 펼친 상태 — 접이 머리를 쓰지 않는 탭들이 넘기는 값이다. */
const 접힘: ReadonlySet<string> = new Set()

/**
 * 한 줄이 화면에서 차지하는 높이(px). **글자 크기에 딸린 값이라 상수가 아니다.**
 *
 * Phaser 의 `Text.height` 는 그 글꼴의 **어센트+디센트**이고(MeasureText), 그것은
 * 이 판이 브라우저 없이 구할 수 없다. 그래서 실측을 적되 **그때의 글자 크기와
 * 함께** 적고 `FONT_SIZE.body` 로 다시 곱한다 — 15 하나만 적어 두면 크기를 올린
 * 날 이 판이 옛 높이로 재고, 뷰포트 여유가 3px 뿐이라 그날 스크롤이 생기는데도
 * 초록이 된다.
 *
 * **비례가 성립하는 것도 잰 것이다**(브라우저, Neo둥근모 Pro):
 * 16px → 어센트 12 + 디센트 3 = 15 · 32px → 24 + 6 = 30 · 12px → 9 + 2 = 11.
 * 어센트가 0.75·크기, 디센트가 0.1875·크기로 딱 떨어진다 — 16 단위 격자로 설계된
 * 비트맵 계열이라 그렇고(tokens.css 의 글꼴 주석), 이 프로젝트가 16 의 배수만 쓰는
 * 이유도 같다.
 */
const 줄높이 = (FONT_SIZE.body * 15) / 16

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

  /**
   * **펼친 자루 하나의 내용만** — 그 머리 다음 줄부터 다음 머리 직전까지.
   *
   * 줄 배열은 평평하다(머리에만 groupId 가 붙는다). 자루의 경계를 여기서 자르지
   * 않으면 「40개가 전부 나온다」처럼 **존재만** 보는 판이 되고, 그러면 두 자루의
   * 내용물을 통째로 맞바꿔도 아무 판도 안 문다 — 실제로 그랬다.
   */
  function 자루(player: PlayerState, id: string) {
    const all = lines(player, 펼침)
    const head = all.findIndex((l) => l.groupId === id)
    if (head < 0) throw new Error(`자루 머리를 못 찾았다: ${id}`)
    const after = all.slice(head + 1)
    const next = after.findIndex((l) => l.groupId)
    return next < 0 ? after : after.slice(0, next)
  }

  /** 자루 안의 이름 줄(짝수)만 / 효과 줄(홀수)만 — 이정표 하나가 두 줄이다. */
  const 이름줄 = (bag: readonly { text: string }[]) =>
    bag.filter((_l, i) => i % 2 === 0).map((l) => l.text)
  const 효과줄 = (bag: readonly { text: string }[]) =>
    bag.filter((_l, i) => i % 2 === 1).map((l) => l.text)

  const 초보 = emptyPlayer()

  // 왜: **실측이 정한 수다.** 첫 화면이 뷰포트를 넘으면 나머지 서른넷에 닿는
  //     손잡이 둘이 처음에 안 보인다(사라지지는 않는다 — 이 목록은 끌어서 도는
  //     ScrollList 다). 열네 줄까지가 화면이다.
  //
  //     **두 수를 여기서 손으로 다시 적지 않는다.** 뷰포트 높이는 화면이 쓰는 그
  //     함수(panelListRect)에서, 줄 사이 여백은 ScrollList 가 쓰는 그 상수에서
  //     그대로 가져온다 — 여백·헤더·패널 여백 중 무엇이 바뀌어도 화면과 이 판이
  //     같이 움직여야 한다. 옮겨 적던 시절 이 식은 실제 contentHeight 보다 3px
  //     작았다(buildRows 는 마지막 줄 뒤에도 ROW_GAP 을 더한다).
  //
  //     **줄 높이도 이제 상수가 아니다.** 15 를 그대로 적어 두던 동안 이 판은
  //     `FONT_SIZE.body` 를 올려도 초록이었다 — 여유가 3px 뿐이라(14줄 × 18px =
  //     252, 뷰포트 255) 글자를 한 단계만 키워도 스크롤이 생기는데 아무도 안 짖는
  //     자리였다. 아래 `줄높이` 를 참고.
  it('신규의 첫 화면은 12줄 + 접힌 머리 둘 — 뷰포트에 스크롤 없이 들어간다', () => {
    const first = lines(초보)
    expect(first.filter((l) => l.groupId)).toHaveLength(2)
    expect(first.filter((l) => !l.groupId)).toHaveLength(12)
    expect(first.length * (줄높이 + ROW_GAP)).toBeLessThanOrEqual(panelListRect(812, 375).height)
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

  // 왜: **두 자루의 내용을 통째로 맞바꿔도 나머지 판이 전부 초록이었다.** 신규
  //     상태에서 두 자루가 우연히 정확히 17개씩이라 개수 판이 못 갈랐고, 「펼치면
  //     40개가 전부 나온다」는 존재만 보고 어느 자루에서 나왔는지는 안 봤다. 즉
  //     순수 칭호 열일곱이 「그 뒤의 문」에 들어가고 실제 문 열일곱이 「칭호」에
  //     들어가는 — 이 아크가 고치려던 것을 정확히 뒤집은 — 화면이 관문을 통과했다.
  //     자루의 이름과 내용을 여기서 못박는다.
  it('자루 둘의 내용이 이름과 맞물린다 — 문 자루에 칭호가 없고, 칭호 자루는 전부 칭호다', () => {
    const 문 = 자루(초보, MILESTONE_FOLD.gates)
    const 칭호 = 자루(초보, MILESTONE_FOLD.titles)
    expect(이름줄(문)).toHaveLength(17)
    expect(이름줄(칭호)).toHaveLength(17)

    // 문 자루의 효과 줄은 무엇이 열리는지를 말한다 — '칭호' 라는 글자가 한 번도
    // 안 나온다(순수 칭호만 그 문장을 쓴다).
    expect(효과줄(문).filter((t) => t.includes('칭호'))).toEqual([])
    // 칭호 자루는 반대로 **전부** 그 문장이다.
    expect(효과줄(칭호).every((t) => t.startsWith('칭호'))).toBe(true)

    // 각 자루의 첫 항목까지 못박는다 — 묶음 순서(얼음이 먼저)와 자루 소속이
    // 한 줄에 같이 걸린다.
    expect(이름줄(문)[0]).toBe('얼음이 손에 익다   얼음 숙련 0 / 10,000')
    expect(이름줄(칭호)[0]).toBe('얼음을 오래 다루다   얼음 숙련 0 / 50,000')
  })

  // 왜: **정렬 호출을 통째로 지워도 관문이 초록이었다.** 화면은 실제로 달라진다 —
  //     milestones.csv 의 조합 행 순서는 200·500·1500·5000·10000(주괴)·25000·
  //     10000(자동 반복, 18행)·100000·50000(파일 맨 끝)이라, 정렬이 없으면 펼친
  //     자루에서 25,000 다음에 10,000 이 온다. 「정렬을 반대로 한 것」은 첫 화면
  //     머리가 바뀌어 잡히지만 「정렬을 안 한 것」은 여기서만 잡힌다. 지금 화면이
  //     옳은 것은 CSV 행 순서가 대체로 오름차순이라는 우연 위에 서 있고,
  //     milestones.csv 는 정렬을 요구받지 않는 파일이다.
  it('펼친 자루 안에서 같은 묶음의 문턱은 오름차순이다', () => {
    const 조합 = 이름줄(자루(초보, MILESTONE_FOLD.gates))
      .filter((t) => t.includes('조합 숙련'))
      .map((t) => Number(/\/ ([\d,]+)$/.exec(t)![1]!.replace(/,/g, '')))
    // 200 은 이 묶음의 머리라 자루에 없다. 같은 10,000 둘(미스릴 주괴·자동 반복)은
    // 안정 정렬이라 CSV 행 순서를 그대로 지킨다.
    expect(조합).toEqual([500, 1500, 5000, 10000, 10000, 25000, 50000])
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

  // 왜: 머리가 자루에 담긴 **전부**를 세던 시절, 신규는 40개가 다 미달성이라 두
  //     수가 우연히 같아서 그 어긋남이 안 보였다. 지금 서버에 살아 있는 얼음
  //     200,000 테스터에게는 「그 뒤의 문 N개」의 N 안에 **이미 연 문**이 섞인다 —
  //     이름과 수가 어긋나는 것이다. 그렇다고 넘은 것을 아예 안 적으면 「15개」라고
  //     써 놓고 펼치면 열여덟 줄이 나온다. 그래서 남은 수를 앞에, 넘은 몫을 ✓ 로
  //     뒤에 적는다. 이 판은 **고인물 상태**로만 물 수 있다.
  it('머리는 남은 개수를 세고, 이미 넘은 것은 ✓ 로 따로 적는다', () => {
    const 얼음장인: PlayerState = {
      ...emptyPlayer(),
      skills: { ice: 200000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    }
    const heads = lines(얼음장인).filter((l) => l.groupId)
    // 얼음 묶음은 열 문이 안 남아 머리가 없다 — 문 셋(1,000·10,000·85,000)이
    // 전부 자루로 들어가고 그 셋은 이미 열려 있다.
    expect(heads[0]!.text).toContain('그 뒤의 문 15개 ✓3')
    expect(heads[1]!.text).toContain('칭호 15개 ✓2')
    // 신규에게는 넘은 것이 없으므로 ✓ 조각 자체가 안 붙는다.
    for (const head of lines(초보).filter((l) => l.groupId)) {
      expect(head.text).not.toContain('✓')
    }
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
