import { emptyPlayer, loadGameData } from '@nogada/data'
import { sellPrice, type PlayerState, type ShopDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import {
  buyRows,
  clampCount,
  formatGold,
  maxBuyCount,
  maxSellCount,
  sellRows,
  tradeTotal,
  MAX_TRADE_COUNT,
} from './shopModel.js'

/*
 * 상점 모델 — 상점 패널(DOM)이 그릴 순수 데이터를 만든다.
 * 판정(isSellTarget·sellPrice·buyPrice)은 전부 shared 의 것을 그대로 쓰므로,
 * 여기서 검사하는 것은 "화면이 그 판정과 등록부를 왜곡 없이 옮겨 담는가"다.
 * 실물 데이터를 쓰는 이유는 craftCardModel.test 와 같다: 화면이 진짜로 마주칠
 * 등록부가 이것이고, CSV 가 바뀌면 여기가 먼저 아파야 한다.
 */

const data = loadGameData()
const iceShop = data.shops['얼음상점']!
const mineralShop = data.shops['광물상점']!

function playerWith(stacks: Record<string, number>, gold = 0, ice = 0): PlayerState {
  const p = emptyPlayer()
  return { ...p, stacks, gold, skills: { ...p.skills, ice } }
}

/**
 * 총점이 정확히 `4 × slots` 인 세이브를 짓는다 — 앞에서부터 그만큼의 칸을 만점으로 채운다.
 *
 * 숫자를 손으로 적지 않는 이유: 문턱은 `collection.csv` 가 소유하고 작가가
 * 조정한다(§6-앞 5). 여기에 "1,000개" 같은 값을 박아 두면 문턱이 오르는 날 이
 * 테스트는 조용히 다른 총점을 재게 된다.
 */
function donatedForSlots(slots: number): Record<string, number> {
  const donated: Record<string, number> = {}
  for (const def of Object.values(data.collection).slice(0, slots)) {
    donated[def.itemId] = def.steps[3]
  }
  return donated
}

describe('sellRows — 팔기 목록은 가방 ∩ 그 상점의 계열이다', () => {
  // 왜: 상점은 자기 계열만 산다(설계 §4). 남의 계열이 목록에 뜨면 눌러 봐야
  //     서버가 not_sellable 로 거절하는 죽은 줄이 되고, 플레이어는 "저쪽
  //     마을에 가야 한다"는 이 게임의 지리를 배우지 못한다.
  it('그 계열 재료만 오르고 남의 계열·도구·증표는 안 오른다', () => {
    const player = playerWith({
      ice_shard: 3, // 얼음 재료 — 오른다
      copper_ore: 5, // 광물 재료 — 얼음상점에는 안 오른다
      ice_speed_token: 1, // 증표 — 되팔 수 없다(§6-앞 13)
      copper_chisel: 1, // 도구 — 팔 수 없다(price 0)
    })
    expect(sellRows(data, player, iceShop).map((r) => r.itemId)).toEqual(['ice_shard'])
    expect(sellRows(data, player, mineralShop).map((r) => r.itemId)).toEqual(['copper_ore'])
  })

  // 왜: 수량 0 은 줄이 아니다. 가방과 같은 규칙이라 다 판 물건은 목록에서 사라진다.
  it('가진 게 없으면 줄이 없다', () => {
    expect(sellRows(data, emptyPlayer(), iceShop)).toEqual([])
    expect(sellRows(data, playerWith({ ice_shard: 0 }), iceShop)).toEqual([])
  })

  // 왜: 파는 동안 줄이 위아래로 흔들리면 손가락이 매번 자리를 다시 찾는다 —
  //     가방·제작 목록과 같은 이유의 고정 순서(items.csv 선언 순서)다.
  it('순서는 items.csv 선언 순서다', () => {
    const player = playerWith({ ice_gem: 1, ice_shard: 1, ice_crystal: 1, pure_ice: 1 })
    expect(sellRows(data, player, iceShop).map((r) => r.itemId)).toEqual([
      'ice_shard',
      'pure_ice',
      'ice_crystal',
      'ice_gem',
    ])
  })

  // 왜: 화면의 단가가 서버가 줄 금액과 다르면 화면이 거짓말을 한다. 매도가는
  //     shared 의 sellPrice(정가의 절반) 그대로여야 한다.
  it('단가는 sellPrice 그대로이고 보유 수량을 함께 싣는다', () => {
    const rows = sellRows(data, playerWith({ ice_shard: 7 }), iceShop)
    expect(rows[0]).toEqual({
      itemId: 'ice_shard',
      name: '얼음 조각',
      held: 7,
      unitPrice: sellPrice(data.items['ice_shard']!),
    })
  })
})

describe('buyRows — 진열은 잠긴 것까지 보인다', () => {
  // 왜: "요구치를 숫자로 말하는 문"이 이 게임의 동기부여 장치다(원작의 목록방).
  //     잠긴 칸을 지우면 언젠가 여기서 무언가를 살 수 있다는 사실 자체가
  //     화면에서 사라진다.
  it('요구치 미달 칸도 남고 현재/필요 숙련도를 싣는다', () => {
    const rows = buyRows(data, playerWith({}, 0, 5000), iceShop)
    expect(rows.filter((r) => r.unlockLabel === '얼음 숙련도').map((r) => r.itemId)).toEqual([
      'ice_speed_token',
      'ice_sight_token',
    ])
    expect(rows.every((r) => r.state === 'locked')).toBe(true)
    expect(rows[0]).toMatchObject({ unlockNow: 5000, unlockAt: 10000, unlockLabel: '얼음 숙련도' })
  })

  // 왜: 숙련이 넘으면 열린다(성공 기준 3). 요구치는 언제나 그 상점의 계열을
  //     잰다(§6-앞 14) — 얼음 진열이 나무 숙련을 볼 수는 없다.
  it('그 계열 숙련이 요구치를 넘으면 ready 가 된다', () => {
    const rows = buyRows(data, playerWith({}, 0, 10000), iceShop)
    expect(rows[0]!.state).toBe('ready')
    expect(rows[1]!.state).toBe('locked')
  })

  // 왜: 되사기 진열은 숙련이 아니라 **수집 총점**이 연다(§6-앞 7). 화면이 이
  //     칸에 숙련도 눈금을 적으면, 만렙 얼음꾼이 "얼음 숙련도 1,000,000/30" 을
  //     보면서 왜 안 열리는지 모르게 된다.
  it('되사기 칸은 수집 점수를 눈금으로 적는다 — 숙련도가 아무리 높아도 총점이 문이다', () => {
    const rows = buyRows(data, { ...playerWith({}, 0, 1_000_000), donated: donatedForSlots(7) }, iceShop)
    const buyback = rows.filter((r) => r.unlockLabel === '수집 점수')
    expect(buyback.map((r) => r.itemId)).toEqual([
      'pure_ice',
      'ice_shard',
      'ice_gem',
      'pure_ice_crystal',
      'ice_crystal',
    ])
    // 칸 일곱이 만점이면 총점 28 — 30 문턱에 두 점 모자란다.
    expect(buyback.map((r) => r.unlockNow)).toEqual([28, 28, 28, 28, 28])
    expect(buyback.map((r) => r.state)).toEqual(['locked', 'locked', 'locked', 'locked', 'locked'])
  })

  it('총점이 문턱을 넘으면 그 문턱의 되사기 칸만 열린다 — 위 단은 아직 잠겨 있다', () => {
    const rows = buyRows(data, { ...playerWith({}, 0, 0), donated: donatedForSlots(8) }, iceShop)
    const byId = new Map(rows.map((r) => [r.itemId, r]))
    // 총점 32 — 30 단(흔한 것)은 열리고 60 단(귀한 것)은 아직이다.
    expect(byId.get('pure_ice')!.state).toBe('ready')
    expect(byId.get('ice_shard')!.state).toBe('ready')
    expect(byId.get('ice_gem')!.state).toBe('locked')
    expect(byId.get('ice_gem')!.unlockAt).toBe(60)
  })

  // 왜: 증표는 하나로 충분하다(§6-앞 16 — 판정이 개수를 안 본다). 화면의
  //     "보유 중"은 서버 규칙 already_owned 의 그림자여야 한다 — 여기서
  //     ready 로 그리면 눌러도 거절만 돌아오는 죽은 버튼이 생긴다.
  it('이미 가진 증표는 owned 다 — 요구치를 넘겨도 마찬가지다', () => {
    const rows = buyRows(data, playerWith({ ice_speed_token: 1 }, 0, 99999), iceShop)
    expect(rows[0]!.state).toBe('owned')
  })
})

describe('수량 — 살 수 있는 만큼, 가진 만큼', () => {
  // 왜: 가진 것보다 많이 파는 요청은 서버가 missing_items 로 거절한다. 화면이
  //     먼저 조여야 왕복이 낭비되지 않고, 상한(999)은 서버 스키마의 것과 같아야
  //     한다 — 그 위를 고르게 두면 bad_request 라는, 사람이 고칠 방법을 모르는
  //     거절이 돌아온다.
  it('매도 상한은 보유 수량이고 요청 상한(999)을 넘지 않는다', () => {
    expect(maxSellCount({ itemId: 'x', name: 'x', held: 7, unitPrice: 25 })).toBe(7)
    expect(maxSellCount({ itemId: 'x', name: 'x', held: 5000, unitPrice: 25 })).toBe(MAX_TRADE_COUNT)
  })

  // 왜: 매수 상한은 지갑이 정한다. 증표만은 1 이다 — 둘째부터는 효과가 그대로인데
  //     돈만 배로 나가고, 서버도 already_owned 로 거절한다.
  it('매수 상한은 골드로 감당되는 만큼이고, 증표는 1, 잠긴·보유 칸은 0 이다', () => {
    const [speed, sight] = buyRows(data, playerWith({}, 0, 10000), iceShop)
    // 480,000 짜리 속도증표를 백만 골드로 — 그래도 하나다.
    expect(maxBuyCount(speed!, 1000000)).toBe(1)
    expect(maxBuyCount(speed!, 100)).toBe(0)
    // 선별증표는 숙련 25,000 이 필요해 아직 잠겨 있다 — 돈이 아무리 많아도 0.
    expect(maxBuyCount(sight!, 1000000)).toBe(0)
  })

  // 왜: 총액이 골드보다 크면 버튼이 잠기고 그 이유는 붉은 숫자가 말한다 —
  //     그러려면 감당 못 하는 수량에서도 화면이 "한 개면 얼마"를 계산할 수
  //     있어야 한다. clamp 가 0 을 돌려주면 그 자리에 0원이 뜬다.
  it('수량은 1..max 로 조이고, 고를 것이 없어도 1 은 남는다', () => {
    expect(clampCount(5, 10)).toBe(5)
    expect(clampCount(50, 10)).toBe(10)
    expect(clampCount(0, 10)).toBe(1)
    expect(clampCount(-3, 10)).toBe(1)
    expect(clampCount(2.7, 10)).toBe(2)
    expect(clampCount(5, 0)).toBe(1)
    expect(clampCount(Number.NaN, 10)).toBe(1)
  })

  it('총액은 개당 값 × 수량이다', () => {
    expect(tradeTotal(25, 12)).toBe(300)
  })
})

describe('formatGold — 자릿수가 곧 티어다', () => {
  // 왜: 천 단위 구분이 없으면 24000 과 240000 이 같은 굵기로 읽힌다. 세 화면
  //     (상단 바·가방·상점)이 같은 함수를 쓰는 이유가 이것이다.
  it('천 단위를 끊고 단위를 붙인다', () => {
    expect(formatGold(0)).toBe('0 G')
    expect(formatGold(1234)).toBe('1,234 G')
    expect(formatGold(1000000)).toBe('1,000,000 G')
  })
})
