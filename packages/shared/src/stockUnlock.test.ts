import { describe, expect, it } from 'vitest'
import type { CollectionTable } from './collection.js'
import { emptyDialogueHistory } from './dialogue.js'
import { defaultCombatState } from './combatState.js'
import { isStockUnlocked, stockProgress } from './stockUnlock.js'
import type { PlayerState, ShopDef, ShopStockEntry } from './types.js'

/*
 * 진열 게이트 — 서버의 매수 판정(tradeService)과 화면의 사기 목록(shopModel)이
 * **같은 이 함수**를 부른다(설계 §6-앞 7). 그래서 여기서 묻는 것은 두 가지다:
 * 어느 눈금을 읽는가(숙련이냐 총점이냐), 그리고 그 눈금의 지금 값이 판정이
 * 비교하는 그 값과 같은가(화면이 "8/30" 을 적었는데 서버가 다른 답을 내면
 * 플레이어에게는 이유가 없는 거절이다).
 */

const 얼음상점: ShopDef = {
  id: '얼음상점', name: '얼음 상점', speakerId: '노인', skill: 'ice', unlockSkill: 5_000, stock: [],
}

/** 칸 둘짜리 작은 방 — 만점은 2칸 × 4등급 = 8 이다. */
const collection: CollectionTable = {
  ice_shard: { itemId: 'ice_shard', steps: [1, 10, 100, 1000] },
  copper_ore: { itemId: 'copper_ore', steps: [1, 10, 100, 1000] },
}

function player(over: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: 'world', x: 0, y: 0 },
    ...over,
  }
}

const 숙련칸: ShopStockEntry = { itemId: 'ice_speed_token', unlockBy: 'skill', unlockAt: 10_000 }
const 되사기칸: ShopStockEntry = { itemId: 'ice_shard', unlockBy: 'collection', unlockAt: 4 }

/**
 * combat 계열 상점의 진열(아크 E §4) — 지금 출하 데이터에는 빈 진열이라 무증상이지만,
 * `stockProgress` 도 shopAccess 와 **같은 함정** 위에 있다: `player.skills['combat']`
 * 은 undefined 라 `undefined >= 문턱` 이 언제나 false 다. combat 분기는
 * combat.proficiency 를 읽어야 한다(새 문은 기존 문의 술어를 상속한다, 규범 3).
 */
const 사냥상점: ShopDef = {
  id: '사냥상점', name: '사냥꾼의 계산대', speakerId: '사냥꾼', skill: 'combat', unlockSkill: 1_000, stock: [],
}
const 전투숙련칸: ShopStockEntry = { itemId: 'wolf_charm', unlockBy: 'skill', unlockAt: 500 }

describe('isStockUnlocked — 숙련으로 열리는 칸', () => {
  it('그 상점 계열의 숙련도를 읽는다 — 남의 계열은 아무리 높아도 열지 못한다', () => {
    expect(isStockUnlocked(숙련칸, 얼음상점, player({ skills: { ice: 0, wood: 999_999, mineral: 999_999, herb: 999_999, crafting: 999_999 } }), collection)).toBe(false)
  })

  it('문턱에 닿으면 열린다 — 상점의 요구 숙련·강화 재료와 같은 부등호다', () => {
    const 미달 = player({ skills: { ice: 9_999, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const 경계 = player({ skills: { ice: 10_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    expect(isStockUnlocked(숙련칸, 얼음상점, 미달, collection)).toBe(false)
    expect(isStockUnlocked(숙련칸, 얼음상점, 경계, collection)).toBe(true)
  })

  it('바친 것은 이 칸을 열지 못한다 — 문이 하나라는 뜻이 이것이다', () => {
    expect(isStockUnlocked(숙련칸, 얼음상점, player({ donated: { ice_shard: 1000, copper_ore: 1000 } }), collection)).toBe(false)
  })
})

describe('isStockUnlocked — combat 상점의 숙련 칸은 전투 숙련을 잰다(아크 E)', () => {
  // 왜: 분기 없이 skills[shop.skill] 을 읽으면 undefined >= 500 이 언제나 false 라
  //     이 칸이 영원히 잠긴다 — 반대로 shopAccess 쪽 함정은 "항상 열림"이다.
  //     같은 undefined 가 문마다 다른 방향으로 미치므로 양쪽 다 물어 둔다
  //     (분기 제거 돌연변이 → "닿으면 열린다" red).
  it('전투 숙련이 문턱에 닿으면 열린다 — 미달은 잠긴다', () => {
    const 미달 = player({ combat: { ...defaultCombatState(), proficiency: 499 } })
    const 경계 = player({ combat: { ...defaultCombatState(), proficiency: 500 } })
    expect(isStockUnlocked(전투숙련칸, 사냥상점, 미달, collection)).toBe(false)
    expect(isStockUnlocked(전투숙련칸, 사냥상점, 경계, collection)).toBe(true)
  })

  it('생활기술은 이 칸을 열지 못한다 — 다섯이 만렙이어도 전투 숙련 0 이면 잠긴다', () => {
    const 채집만렙 = player({
      skills: { ice: 999_999, wood: 999_999, mineral: 999_999, herb: 999_999, crafting: 999_999 },
    })
    expect(isStockUnlocked(전투숙련칸, 사냥상점, 채집만렙, collection)).toBe(false)
  })

  it('화면이 적는 "현재"도 전투 숙련이다 — stockProgress 가 판정과 같은 눈금을 돌려준다', () => {
    const p = player({ combat: { ...defaultCombatState(), proficiency: 321 } })
    expect(stockProgress(전투숙련칸, 사냥상점, p, collection)).toBe(321)
  })
})

describe('isStockUnlocked — 수집 총점으로 열리는 칸(되사기 진열)', () => {
  it('숙련도를 아예 보지 않는다 — 만렙 채집꾼도 바치지 않았으면 못 산다', () => {
    const 만렙 = player({ skills: { ice: 1_000_000, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    expect(isStockUnlocked(되사기칸, 얼음상점, 만렙, collection)).toBe(false)
  })

  it('총점이 문턱에 닿으면 열린다', () => {
    // 얼음 조각 100개 = 3등급, 구리 원석 1개 = 1등급 → 총점 4 = 문턱.
    const 셋 = player({ donated: { ice_shard: 100 } })
    const 넷 = player({ donated: { ice_shard: 100, copper_ore: 1 } })
    expect(isStockUnlocked(되사기칸, 얼음상점, 셋, collection)).toBe(false)
    expect(isStockUnlocked(되사기칸, 얼음상점, 넷, collection)).toBe(true)
  })

  it('문턱표가 비면 총점이 0 이라 열리지 않는다 — 표가 판정의 절반이다', () => {
    expect(isStockUnlocked(되사기칸, 얼음상점, player({ donated: { ice_shard: 1000 } }), {})).toBe(false)
  })
})

describe('stockProgress — 화면이 적는 "현재"가 판정이 비교하는 그 값이다', () => {
  it('숙련 칸은 그 계열 숙련도를, 되사기 칸은 총점을 돌려준다', () => {
    const p = player({ skills: { ice: 7_000, wood: 0, mineral: 0, herb: 0, crafting: 0 }, donated: { ice_shard: 10 } })
    expect(stockProgress(숙련칸, 얼음상점, p, collection)).toBe(7_000)
    expect(stockProgress(되사기칸, 얼음상점, p, collection)).toBe(2)
  })

  it('그 값이 문턱 이상인 것과 열린 것이 정확히 같다 — 두 답이 갈라질 자리가 없다', () => {
    const 세이브들: Record<string, number>[] = [{}, { ice_shard: 1 }, { ice_shard: 100 }, { ice_shard: 1000, copper_ore: 1000 }]
    for (const donated of 세이브들) {
      const p = player({ donated })
      expect(isStockUnlocked(되사기칸, 얼음상점, p, collection)).toBe(
        stockProgress(되사기칸, 얼음상점, p, collection) >= 되사기칸.unlockAt,
      )
    }
  })
})
