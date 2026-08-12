import { describe, expect, it } from 'vitest'
import { testItem } from '../testing/items.js'
import type { ItemDef } from '../types.js'
import { buyPrice, sellPrice } from './price.js'

/** 이 함수들이 보는 것은 price 하나뿐이다 — 나머지 칸은 팩토리의 기본값으로 둔다. */
function item(price: number): ItemDef {
  return testItem('x', { price })
}

describe('buyPrice', () => {
  it('정가 그대로다 — 상점은 값을 깎지 않는다', () => {
    expect(buyPrice(item(1100))).toBe(1100)
  })
})

describe('sellPrice', () => {
  it('정가의 절반이다 — 사고팔기를 반복하면 반드시 손해라 무한 골드 루프가 없다', () => {
    expect(sellPrice(item(1100))).toBe(550)
  })

  it('홀수는 내림이다 — 반올림하면 매도가 두 개를 합친 값이 정가를 넘는 자리가 생긴다', () => {
    expect(sellPrice(item(151))).toBe(75)
  })

  it('정가 1 은 매도가 0 이다 — 가장 싼 물건도 팔아서 돈이 되지는 않는다', () => {
    expect(sellPrice(item(1))).toBe(0)
  })

  it('정가 0 은 매도가 0 이다 — "팔 수 없다"는 값이지 계산의 예외가 아니다', () => {
    expect(sellPrice(item(0))).toBe(0)
  })
})
