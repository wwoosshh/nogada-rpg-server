import type { ItemDef, ShopDef } from './types.js'

/**
 * 이 상점이 이것을 사 주는가 — **매도 대상의 정의**(설계 §6-앞 13).
 *
 * 네 조건이 각각 무엇을 막는지: `material` 은 도구를(강화 재료를 실수로 파는
 * 사고가 크다), `!tokenEffect` 는 증표를(수십만 골드짜리 되팔기 창구가 열린다),
 * `price > 0` 은 값이 없는 것을(0원은 "공짜로 팔린다"가 아니라 **팔 수 없다**는
 * 뜻이다), `skill` 일치는 남의 계열을 막는다(남의 계열을 팔려면 그 마을에 가야
 * 한다 — 월드가 살아 있는 이유다).
 *
 * **이 술어를 부르는 곳이 셋이다.** 서버의 매도 판정(tradeService), 빌드의 "쓸
 * 곳도 팔 곳도 없는 아이템" 검사(packages/data 의 validate), 그리고 상점 패널의
 * 팔기 목록(apps/client 의 shopModel)이다. 한때 이것은 서버 안에 있었고 나머지
 * 둘이 같은 conjunction 을 각자 옮겨 적었다 — 그러면 셋이 갈라지는 날 빌드는
 * "팔 데가 있다"며 통과시키고 화면은 목록에 그려 두는데 서버만 `not_sellable`
 * 로 거절하는, 화면 어디에도 이유가 안 적히는 상태가 된다. 규칙은 shared 하나가
 * 소유한다.
 */
export function isSellTarget(def: ItemDef, shop: ShopDef): boolean {
  return def.kind === 'material' && !def.tokenEffect && def.price > 0 && def.skill === shop.skill
}
