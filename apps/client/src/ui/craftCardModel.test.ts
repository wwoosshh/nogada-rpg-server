import { emptyPlayer, loadGameData } from '@nogada/data'
import { calcCraftSuccess, craftIntervalMs, equippedToolTier, type GameData, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import {
  buildCraftCards,
  canAffordCraft,
  craftRepeatUnlocked,
  defaultCraftSelection,
  type CraftCardSection,
} from './craftCardModel.js'

/*
 * 제작 카드 모델 — 제작 패널(DOM)이 그릴 순수 데이터를 만든다.
 * 판정(canCraft·calcCraftSuccess)은 전부 shared 의 것을 그대로 쓰므로, 여기서
 * 검사하는 것은 "카드가 그 판정을 왜곡 없이 옮겨 담는가"다.
 */

const data = loadGameData()

/** 조합 숙련도와 재료만 다른 플레이어. 문턱 없는 레시피의 판정이 보는 것이 이 둘뿐이다. */
function playerWith(crafting: number, stacks: Record<string, number> = {}): PlayerState {
  const p = emptyPlayer()
  return { ...p, skills: { ...p.skills, crafting }, stacks }
}

/** 조합과 얼음 숙련을 함께 쥔 플레이어 — 문이 둘인 레시피는 두 숫자를 다 본다. */
function playerWithIce(crafting: number, ice: number): PlayerState {
  const p = emptyPlayer()
  return { ...p, skills: { ...p.skills, crafting, ice } }
}

/**
 * 계열 문턱이 걸린 합성 레시피를 얹은 데이터.
 *
 * 출하 recipes.csv 17행은 전부 문턱 칸이 비어 있으므로(C1), 두 문을 가진 카드는
 * 여기서 지어내야만 그릴 수 있다. 아이템은 실물을 가리켜 이름·아이콘 조회가
 * 실제와 같은 길을 타게 한다.
 */
const gatedData: GameData = {
  ...data,
  recipes: {
    ...data.recipes,
    fixture_ice_powder: {
      id: 'fixture_ice_powder', name: '픽스처 얼음 가루', category: '조제', skill: 'crafting',
      requiredSkill: 200, baseChance: 0.95,
      inputs: [{ item: 'ice_shard', count: 10 }], output: { item: 'pure_ice', count: 1 },
      skillGainMin: 10, skillGainMax: 20, gateSkill: 'ice', gateValue: 1000,
    },
  },
}

function findCard(sections: CraftCardSection[], recipeId: string) {
  for (const s of sections) {
    const card = s.cards.find((c) => c.recipeId === recipeId)
    if (card) return card
  }
  throw new Error(`카드 없음: ${recipeId}`)
}

describe('buildCraftCards — 목록의 모양과 순서', () => {
  // 왜: 반복 제작을 쥐고 있는 동안 손가락 아래에서 목록이 흔들리면 안 된다.
  //     카테고리는 recipes.csv 에서 처음 나타난 순서, 카드는 선언 순서 고정 —
  //     진척순 재정렬 같은 것을 하지 않는다(설계 §2 행 순서 불변).
  //     정제·조제가 도구 아래인 이유: 새 10행을 파일 끝에 붙였기 때문이고,
  //     그렇게 붙인 이유는 목록이 선택으로 자동 스크롤하지 않아서다 — 잠긴
  //     10장을 맨 위에 끼우면 첫날 만드는 구리 도구가 화면 밖으로 밀린다.
  it('카테고리는 첫 등장 순서, 카드는 선언 순서다', () => {
    const sections = buildCraftCards(data, emptyPlayer(), {})
    expect(sections.map((s) => s.category)).toEqual(['제련', '도구', '정제', '조제'])
    // 구리 4종은 copper_hammer 곁, 미스릴 위(§6-앞 15) — 카테고리 안에서
    // 요구치가 낮은 문이 위에 오는 원작의 배치를 행 순서가 그대로 나른다.
    expect(sections[1]!.cards.map((c) => c.recipeId)).toEqual([
      'copper_chisel',
      'copper_axe',
      'copper_pickaxe',
      'copper_sickle',
      'copper_hammer',
      'iron_chisel',
      'iron_axe',
      'iron_pickaxe',
      'iron_sickle',
      'mithril_pickaxe',
      'mithril_chisel',
      'mithril_axe',
      'mithril_sickle',
    ])
  })

  // 왜: 잠김(숙련도)과 재료 부족은 서로 다른 문제다 — 옛 제작 패널이 한 줄에
  //     욱여넣지 않던 구분을 카드 state 가 그대로 잇는다. 판정 자체는 shared 의
  //     canCraft 와 재료 비교 그대로여야 한다(판정 복제 금지).
  it('숙련도 미달은 locked, 열렸는데 재료가 없으면 no_materials, 둘 다 되면 ready', () => {
    const empty = buildCraftCards(data, emptyPlayer(), {})
    expect(findCard(empty, 'copper_ingot').state).toBe('no_materials')
    expect(findCard(empty, 'copper_hammer').state).toBe('locked')

    const stocked = buildCraftCards(data, playerWith(0, { copper_ore: 2 }), {})
    expect(findCard(stocked, 'copper_ingot').state).toBe('ready')
  })

  // 왜: 성공률 숫자가 shared 공식과 다르면 화면이 서버와 다른 약속을 한다.
  //     열린 레시피는 calcCraftSuccess 의 반올림 %, 잠긴 레시피는 정의상 0 이다.
  it('성공률은 calcCraftSuccess 를 그대로 % 로 옮긴 값이다', () => {
    const player = playerWith(0, { copper_ore: 2 })
    const sections = buildCraftCards(data, player, {})
    const expected = Math.round(
      calcCraftSuccess({
        proficiency: 0,
        toolTier: equippedToolTier(player, data, 'crafting'),
        enhanceLevel: 0,
        recipe: data.recipes['copper_ingot']!,
      }) * 100,
    )
    expect(findCard(sections, 'copper_ingot').chancePct).toBe(expected)
    expect(findCard(sections, 'copper_hammer').chancePct).toBe(0)
  })

  // 왜: 잠긴 카드의 요구치 숫자가 이 게임의 당근이다(§8-앞 11) — 카드가
  //     현재/필요 숙련도를 실시간 값으로 들고 있어야 주괴를 반복하는 동안
  //     옆 카드에서 그 숫자가 오르는 것이 보인다.
  it('잠긴 카드는 현재 숙련도와 요구치를 숫자로 말한다', () => {
    const sections = buildCraftCards(data, playerWith(180), {})
    const hammer = findCard(sections, 'copper_hammer')
    expect(hammer.state).toBe('locked')
    expect(hammer.lockedGate).toEqual({ skillLabel: '조합', have: 180, need: 200 })
  })

  it('열린 카드에는 말할 문턱이 없다 — lockedGate 는 null 이다', () => {
    const sections = buildCraftCards(data, playerWith(0, { copper_ore: 2 }), {})
    expect(findCard(sections, 'copper_ingot').lockedGate).toBeNull()
  })

  // 왜: 조합만 넘긴 사람에게 "열렸다"고 말하면 그 재료가 0.01% 드랍이라는
  //     사실을 카드가 숨긴다 — 잠근 쪽의 숫자를 그대로 말해야 한다(§6-앞 9).
  it('계열 숙련이 모자라면 그 계열의 숫자를 말한다', () => {
    const sections = buildCraftCards(gatedData, playerWithIce(25_000, 300), {})
    const card = findCard(sections, 'fixture_ice_powder')
    expect(card.state).toBe('locked')
    expect(card.lockedGate).toEqual({ skillLabel: '얼음', have: 300, need: 1000 })
  })

  // 왜: 둘 다 모자랄 때 조합 숫자를 먼저 말하면, 그것만 채우고 온 사람이 다시
  //     잠긴 문을 만난다. 진짜 문턱은 계열이다 — 재료 드랍 브라켓까지 그 숫자가 정한다.
  it('둘 다 모자라면 계열을 먼저 말한다', () => {
    const sections = buildCraftCards(gatedData, playerWithIce(0, 0), {})
    expect(findCard(sections, 'fixture_ice_powder').lockedGate).toEqual({
      skillLabel: '얼음', have: 0, need: 1000,
    })
  })

  it('계열은 찼고 조합만 모자라면 조합 숫자를 말한다', () => {
    const sections = buildCraftCards(gatedData, playerWithIce(150, 50_000), {})
    expect(findCard(sections, 'fixture_ice_powder').lockedGate).toEqual({
      skillLabel: '조합', have: 150, need: 200,
    })
  })

  // 왜: 화면이 보내지 않기로 한 판단과 서버 판정이 갈라지면, 반복 제작이 매
  //     tick 거부 응답만 받아 오는 상태가 된다.
  it('계열이 모자라면 canAffordCraft 도 보내지 않는다', () => {
    const iceReady = { ...playerWithIce(25_000, 300), stacks: { ice_shard: 10 } }
    expect(canAffordCraft(gatedData, iceReady, 'fixture_ice_powder')).toBe(false)
    const gateOpen = { ...playerWithIce(25_000, 1000), stacks: { ice_shard: 10 } }
    expect(canAffordCraft(gatedData, gateOpen, 'fixture_ice_powder')).toBe(true)
  })

  // 왜: 반복 200회 동안 시선이 쉴 곳이 올라가는 보유 숫자다(§8-앞 4) —
  //     가방을 열어야만 보이면 안 된다.
  it('산출물 보유 수량(ownedOutput)을 stacks 에서 읽는다', () => {
    const sections = buildCraftCards(data, playerWith(0, { copper_ingot: 7 }), {})
    expect(findCard(sections, 'copper_ingot').ownedOutput).toBe(7)
    expect(findCard(sections, 'copper_hammer').ownedOutput).toBe(0)
  })

  // 왜: 도구는 stacks 가 아니라 instances 로 보관된다(craftService.ts) — 방금
  // 만든 구리 망치를 stacks 에서만 세면 상세의 "보유"가 영원히 0 이라 재료를
  // 낭비해 여분을 또 만들게 유도한다. 6종 레시피 중 5종이 도구라 이 결함의
  // 파급이 크다.
  it('도구 산출물은 instances 개수를 보유로 센다', () => {
    const player = { ...playerWith(0), instances: [{ instanceId: 'i1', itemId: 'copper_hammer', enhanceLevel: 0 }] }
    const sections = buildCraftCards(data, player, {})
    expect(findCard(sections, 'copper_hammer').ownedOutput).toBe(1)
  })

  // 왜: 재료 칩(아이콘+보유/필요, 충족 색)은 이 배열이 전부다 — 여기의 ok 가
  //     틀리면 색이 거짓말을 하고, item 이 틀리면 엉뚱한 그림이 걸린다.
  it('재료마다 아이템 id·이름·보유·필요·충족 여부를 대조한다', () => {
    const sections = buildCraftCards(data, playerWith(0, { copper_ore: 1 }), {})
    expect(findCard(sections, 'copper_ingot').materials).toEqual([
      { item: 'copper_ore', name: '구리 원석', have: 1, need: 2, ok: false },
    ])
  })

  // 왜: 점멸 대신 누적이다(§8-앞 3). 스토어의 tally 를 카드에 옮겨 담고,
  //     아직 결과가 없는 레시피는 0/0 에서 시작해야 한다.
  // 왜: 망치 강화의 대가는 네 계열의 원재료와 골드다(§6-앞 11) — 그런데 그 보상
  //     둘 중 하나(간격)를 화면이 말하지 않으면, 플레이어는 성공률 +1.5%p 만 보고
  //     사다리를 포기한다. 성공률과 같은 슬롯에 같은 목소리로 적는 이유다(§6-앞 14).
  it('카드는 그 제작에 걸릴 간격을 말한다 — 망치 강화가 줄인 만큼 줄어든다', () => {
    const bare = playerWith(0, { copper_ore: 2 })
    const enhanced: PlayerState = {
      ...bare,
      instances: [{ instanceId: 'h1', itemId: 'copper_hammer', enhanceLevel: 5 }],
      equipped: { crafting: 'h1' },
    }

    // 서버 스탬프(craftService)와 같은 함수·같은 인자다 — 두 벌로 적으면 화면이
    // 약속한 간격과 실제로 기다리는 시간이 갈라진다(§6-앞 10).
    expect(findCard(buildCraftCards(data, bare, {}), 'copper_ingot').intervalMs).toBe(craftIntervalMs(0, null))
    expect(findCard(buildCraftCards(data, enhanced, {}), 'copper_ingot').intervalMs).toBe(429)
  })

  it('레시피별 누적 성적을 옮겨 담고, 없는 레시피는 0 이다', () => {
    const sections = buildCraftCards(data, emptyPlayer(), {
      copper_ingot: { success: 3, fail: 1 },
    })
    expect(findCard(sections, 'copper_ingot').tally).toEqual({ success: 3, fail: 1 })
    expect(findCard(sections, 'copper_hammer').tally).toEqual({ success: 0, fail: 0 })
  })
})

describe('canAffordCraft — 보낼 값어치가 있는 요청인가', () => {
  // 왜: 잠긴/재료 부족 카드를 눌러도 서버로 보내지 않는다(옛 tryCraft 와 같은
  //     문). 서버가 최종 판정이지만, 거부될 게 뻔한 왕복을 반복 중에 매 프레임
  //     만들지 않기 위한 확인이다.
  it('숙련도가 안 열렸으면 false', () => {
    expect(canAffordCraft(data, emptyPlayer(), 'copper_hammer')).toBe(false)
  })

  it('열렸어도 재료가 모자라면 false', () => {
    expect(canAffordCraft(data, emptyPlayer(), 'copper_ingot')).toBe(false)
  })

  it('숙련도와 재료가 둘 다 되면 true', () => {
    expect(canAffordCraft(data, playerWith(0, { copper_ore: 2 }), 'copper_ingot')).toBe(true)
  })

  it('없는 레시피는 false — 조용히 안 보낸다', () => {
    expect(canAffordCraft(data, emptyPlayer(), 'no_such_recipe')).toBe(false)
  })
})

describe('defaultCraftSelection — 열리는 순간 커서가 놓이는 곳(§8-뒤)', () => {
  // 왜: 좌 목록·우 상세 구조에서 "선택된 것"이 없으면 상세가 비고 제작 버튼이
  //     죽는다. 열자마자 만들 수 있는 레시피에 커서가 가 있어야 한다.
  it('첫 제작 가능(ready) 레시피를 고른다 — 선언 순서 기준', () => {
    const sections = buildCraftCards(data, playerWith(0, { copper_ore: 2 }), {})
    expect(defaultCraftSelection(sections)).toBe('copper_ingot')
  })

  // 왜: 주괴 재료는 없는데 망치 재료만 있는 플레이어라면 커서는 망치로 —
  //     "첫 번째 행"이 아니라 "첫 번째 만들 수 있는 행"이다.
  it('앞 레시피가 재료 부족이면 그 다음 ready 를 고른다', () => {
    const sections = buildCraftCards(data, playerWith(200, { copper_ingot: 2 }), {})
    expect(defaultCraftSelection(sections)).toBe('copper_hammer')
  })

  // 왜: 아무것도 못 만드는 신규 캐릭터도 상세가 비면 안 된다 — 첫 레시피를
  //     보여주고 버튼만 잠근다.
  it('ready 가 하나도 없으면 그냥 첫 레시피다', () => {
    expect(defaultCraftSelection(buildCraftCards(data, emptyPlayer(), {}))).toBe('copper_ingot')
  })

  it('레시피가 아예 없으면 null — 조용히 빈 상세', () => {
    expect(defaultCraftSelection([])).toBeNull()
  })
})

describe('craftRepeatUnlocked — 홀드 반복은 해금되는 기능이다(§8-앞 1)', () => {
  // 왜: 신규 플레이어가 1분차부터 반복을 얻으면 원작의 첫 동기부여 장치가
  //     죽는다. 문턱 숫자를 여기 적지 않고 이정표 데이터(crafting repeat)를
  //     isAchieved 로 묻는다 — WorldScene.repeatsOn 과 같은 자세다.
  it('조합 반복 이정표 전에는 false, 달성하면 true', () => {
    expect(craftRepeatUnlocked(data, playerWith(9_999))).toBe(false)
    expect(craftRepeatUnlocked(data, playerWith(10_000))).toBe(true)
  })
})
