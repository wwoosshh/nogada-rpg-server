import { collectionScore, type CollectionTable } from './collection.js'
import type { PlayerState, ShopDef, ShopStockEntry } from './types.js'

/**
 * 이 진열 칸이 지금 열려 있는가 — **진열 게이트의 정의**(설계 §6-앞 7).
 *
 * **이 술어를 부르는 곳이 둘이다.** 서버의 매수 판정(tradeService.performBuy)과
 * 상점 패널의 사기 목록(apps/client 의 shopModel.buyRows)이다. 한때 그 규칙은
 * 부등호 한 줄이라 양쪽이 각자 옮겨 적고 있었는데(`skills[shop.skill] >=
 * entry.unlockSkill`), 문이 둘이 되는 순간 그 중복은 더 이상 사소하지 않다:
 * 화면이 열린 칸으로 그려 놓고 서버만 `item_locked` 로 거절하면, 플레이어에게는
 * 이유가 어디에도 안 적힌 거절이 된다. `isSellTarget` 이 shared 하나로 합쳐진
 * 것과 같은 자리, 같은 이유다.
 *
 * 총점을 매번 다시 세는 것(칸 25개 순회)이 아깝지 않은 이유: 진열은 상점당 열
 * 줄 안팎이고, 이 계산을 밖에서 한 번 해 넘기게 만들면 부르는 쪽마다 "그 점수를
 * 어디서 가져왔나"가 생겨 결국 두 벌이 된다.
 */
export function isStockUnlocked(
  entry: ShopStockEntry,
  shop: ShopDef,
  player: PlayerState,
  collection: CollectionTable,
): boolean {
  return stockProgress(entry, shop, player, collection) >= entry.unlockAt
}

/**
 * 그 문턱을 재는 눈금의 **지금 값** — 잠긴 칸이 적는 `현재/필요` 중 현재다.
 *
 * 판정과 표시가 같은 함수에서 나온다: `isStockUnlocked` 가 이 값을 그대로
 * 비교하므로, 화면이 "8/30" 을 적었는데 서버가 열어 주는(혹은 그 반대) 어긋남이
 * 생길 자리가 없다.
 */
export function stockProgress(
  entry: ShopStockEntry,
  shop: ShopDef,
  player: PlayerState,
  collection: CollectionTable,
): number {
  return entry.unlockBy === 'skill'
    ? player.skills[shop.skill]
    : collectionScore(player.donated, collection)
}
