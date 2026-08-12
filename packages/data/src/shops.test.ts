import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCsv } from './parse.js'
import { parseMasters, parseShops } from './shops.js'

function shopRow(overrides: Record<string, string> = {}): Record<string, string> {
  return { shopId: '얼음상점', name: '얼음 상점', speakerId: '채집장노인', skill: 'ice', unlockSkill: '5000', ...overrides }
}

function stockRow(overrides: Record<string, string> = {}): Record<string, string> {
  return { shopId: '얼음상점', itemId: 'ice_speed_token', unlockSkill: '10000', ...overrides }
}

function masterRow(overrides: Record<string, string> = {}): Record<string, string> {
  return { id: 'ice_master', speakerId: '여관안주인', skill: 'ice', threshold: '63235', gold: '1000000', ...overrides }
}

function readRealCsv(name: string): Record<string, string>[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return parseCsv(readFileSync(join(here, '..', 'csv', name), 'utf8'))
}

describe('parseShops', () => {
  it('행 하나를 ShopDef 로 만든다 — 진열이 없으면 빈 목록이다', () => {
    // 진열이 없는 상점은 정상이다: 매도는 진열을 필요로 하지 않는다(설계 §4).
    // 여기서 던지면 "아직 아무것도 안 파는 상점"을 적을 수 없다.
    expect(parseShops([shopRow()], [])).toEqual({
      얼음상점: { id: '얼음상점', name: '얼음 상점', speakerId: '채집장노인', skill: 'ice', unlockSkill: 5000, stock: [] },
    })
  })

  it('진열을 그 상점에 붙인다 — CSV 에 적힌 순서 그대로', () => {
    // 진열 순서는 화면의 목록 순서다. 정렬하면 "속도를 먼저 보여준다"는 작가의
    // 결정이 사라지고, 그것을 되돌릴 방법이 CSV 어디에도 남지 않는다.
    const shops = parseShops([shopRow()], [stockRow(), stockRow({ itemId: 'ice_sight_token', unlockSkill: '25000' })])
    expect(shops.얼음상점?.stock).toEqual([
      { itemId: 'ice_speed_token', unlockSkill: 10000 },
      { itemId: 'ice_sight_token', unlockSkill: 25000 },
    ])
  })

  it('없는 상점의 진열을 거부한다', () => {
    // 조용히 버리면 그 품목은 어느 상점에서도 안 보이는데, CSV 에는 적혀 있다 —
    // 작가가 "분명히 적었는데 안 뜬다"만 겪고 원인을 볼 곳이 없다.
    expect(() => parseShops([shopRow()], [stockRow({ shopId: '유령상점' })])).toThrow(
      'shop_stock.csv[유령상점/ice_speed_token]: 없는 상점 "유령상점" 의 진열이다 — shops.csv 의 shopId 중 하나여야 한다',
    )
  })

  it('한 상점에 같은 아이템을 두 번 진열하는 것을 거부한다', () => {
    // 목록에 같은 물건이 두 줄로 뜨고, 요구치가 다르면 어느 쪽이 그 물건의
    // 문턱인지 정해지지 않는다.
    expect(() => parseShops([shopRow()], [stockRow(), stockRow({ unlockSkill: '25000' })])).toThrow(
      'shop_stock.csv[얼음상점/ice_speed_token]: 같은 상점에 같은 아이템을 두 번 진열했다',
    )
  })

  it('다른 상점이 같은 아이템을 진열하는 것은 허용한다', () => {
    // 유일해야 하는 것은 (상점, 아이템) 짝이지 아이템이 아니다 — 두 상점이 같은
    // 물건을 파는 것은 정상이고, 여기서 막으면 마을 상점이 생길 때 걸린다.
    const shops = parseShops([shopRow(), shopRow({ shopId: '나무상점', name: '나무 상점', speakerId: '숲마을벌목꾼', skill: 'wood' })], [
      stockRow(),
      stockRow({ shopId: '나무상점' }),
    ])
    expect(shops.나무상점?.stock).toEqual([{ itemId: 'ice_speed_token', unlockSkill: 10000 }])
  })

  it('중복된 shopId 를 거부한다', () => {
    expect(() => parseShops([shopRow(), shopRow()], [])).toThrow('shops.csv: 중복된 id "얼음상점"')
  })

  it('숫자만으로 된 shopId 를 거부한다', () => {
    // Record 의 키가 되므로 순수 숫자 키는 삽입 순서를 잃는다(parse.ts 의
    // assertNotIntegerId 문서) — 화면의 상점 목록 순서가 조용히 재배열된다.
    expect(() => parseShops([shopRow({ shopId: '1' })], [])).toThrow(
      'shops.csv[1]: id "1" 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다',
    )
  })

  it('unlockSkill 0 을 허용한다 — 처음부터 열려 있는 문은 유효한 설계다', () => {
    // toInt 의 기본 최솟값은 1 이다. 그대로 쓰면 "요구치 없음"을 적을 방법이 없어
    // 작가가 1 같은 거짓 문턱을 적게 된다.
    expect(parseShops([shopRow({ unlockSkill: '0' })], [])).toMatchObject({ 얼음상점: { unlockSkill: 0 } })
    expect(parseShops([shopRow()], [stockRow({ unlockSkill: '0' })]).얼음상점?.stock).toEqual([
      { itemId: 'ice_speed_token', unlockSkill: 0 },
    ])
  })

  it('음수 unlockSkill 을 거부한다', () => {
    // 숙련도는 음수가 되지 않으므로 음수 문턱은 0 과 같은 뜻인데, 그렇게 적힌
    // 행은 "빼기를 하려던 것"일 수도 있어 작가의 뜻을 추측하게 된다.
    expect(() => parseShops([shopRow({ unlockSkill: '-1' })], [])).toThrow(
      'shops.csv[얼음상점]: unlockSkill "-1" 는 0 이상이어야 한다',
    )
  })

  it('알 수 없는 skill 을 거부한다', () => {
    // 상점의 계열은 "무엇을 사 주는가"를 통째로 정한다 — 오타 하나면 그 상점은
    // 아무것도 안 사는 상점이 되고, 화면에는 빈 목록만 뜬다.
    expect(() => parseShops([shopRow({ skill: 'icee' })], [])).toThrow('shops.csv[얼음상점]: skill "icee" 는 알 수 없다')
  })

  it('실제로 출하되는 CSV 데이터를 오류 없이 파싱한다', () => {
    const shopRows = readRealCsv('shops.csv')
    const stockRows = readRealCsv('shop_stock.csv')
    const shops = parseShops(shopRows, stockRows)

    // 상점 id 를 여기 베껴 적지 않는다(speakers.test.ts 와 같은 이유) — 행 수와
    // 정의 수가 같은지를 보면 조용히 사라진 행이 없다는 것까지 확인된다.
    expect(Object.keys(shops)).toHaveLength(shopRows.length)
    const stockCount = Object.values(shops).reduce((sum, shop) => sum + shop.stock.length, 0)
    expect(stockCount).toBe(stockRows.length)
  })
})

describe('parseMasters', () => {
  it('행 하나를 MasterDef 로 만든다', () => {
    expect(parseMasters([masterRow()])).toEqual([
      { id: 'ice_master', speakerId: '여관안주인', skill: 'ice', threshold: 63235, gold: 1000000 },
    ])
  })

  it('threshold 0 을 거부한다 — 아무것도 안 한 사람에게 주는 대금은 대금이 아니다', () => {
    expect(() => parseMasters([masterRow({ threshold: '0' })])).toThrow(
      'masters.csv[ice_master]: threshold "0" 는 1 이상이어야 한다',
    )
  })

  it('gold 0 을 거부한다 — 0원을 주는 달인은 지급이 일어났는지 화면에서 구별되지 않는다', () => {
    expect(() => parseMasters([masterRow({ gold: '0' })])).toThrow('masters.csv[ice_master]: gold "0" 는 1 이상이어야 한다')
  })

  it('중복된 id 를 거부한다', () => {
    // 대금 지급 여부는 이 id 로 기억된다(PlayerState.rewarded) — 두 행이 같은
    // id 를 쓰면 한쪽을 받은 사람이 다른 쪽도 받은 것이 된다.
    expect(() => parseMasters([masterRow(), masterRow()])).toThrow('masters.csv: 중복된 id "ice_master"')
  })

  it('알 수 없는 skill 을 거부한다', () => {
    expect(() => parseMasters([masterRow({ skill: 'icee' })])).toThrow('masters.csv[ice_master]: skill "icee" 는 알 수 없다')
  })

  it('실제로 출하되는 CSV 데이터를 오류 없이 파싱한다', () => {
    const rows = readRealCsv('masters.csv')
    expect(parseMasters(rows)).toHaveLength(rows.length)
  })
})
