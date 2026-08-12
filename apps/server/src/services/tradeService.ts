import {
  buyPrice,
  sellPrice,
  shopAccess,
  type GameData,
  type ItemDef,
  type PlayerState,
  type ShopAccess,
  type ShopDef,
} from '@nogada/shared'

/**
 * 거래 — 캔 것을 팔아 골드가 되고, 그 골드가 다음 손을 산다(설계 §2).
 *
 * **행동 간격을 검사도 소비도 하지 않는다**(§6-앞 18). 착용·강화와 같은 이유다:
 * 정리와 거래는 행동이 아니라 노가다 사이의 손짓이고, 거기에 세금을 붙이면
 * 가방을 비우는 것만으로 채집이 느려진다. 매도를 무한 연타로 악용할 수도 없다 —
 * 팔 물건은 유한하고, 캐는 것에는 이미 간격이 걸려 있다. 매수는 골드가 그
 * 자리를 대신한다.
 *
 * 난수도 없다. 무엇을 얼마에 사고파는가는 전부 등록부와 가격 함수가 정하므로
 * 서비스가 굴릴 주사위가 없다 — 시각만 받는데, 그것은 **상점 문이 시각에 따라
 * 닫히기 때문**이다(화자가 밤에 실내로 들어간다, §6-앞 4).
 */

export interface PerformTradeArgs {
  player: PlayerState
  data: GameData
  shopId: string
  itemId: string
  /** 몇 개. 스키마가 1..999 로 조인다(protocol.ts 의 TradeCount). */
  count: number
  /** 상점 접근 판정에 쓰는 시각. 라우트가 넣어 준 것을 그대로 쓴다. */
  now: number
}

/** 응답은 플레이어 통째 하나다 — 착용·강화와 같은 모양이라 클라이언트의 적용 경로가 하나다. */
export interface TradeOutcome {
  player: PlayerState
}

/**
 * 상점 문이 안 열린 네 가지. `shopAccess` 의 코드를 **번역하지 않고 그대로**
 * 낸다(§6-앞 3) — 여기서 이름을 갈면 화면의 안내와 판정이 갈라진다.
 */
export type ShopAccessErrorCode = Exclude<ShopAccess, 'ok'>

export type SellErrorCode = ShopAccessErrorCode | 'unknown_item' | 'not_sellable' | 'missing_items'

export type BuyErrorCode =
  | ShopAccessErrorCode
  | 'unknown_item'
  | 'item_locked'
  | 'not_enough_gold'
  | 'already_owned'

export type SellResult = { ok: true; outcome: TradeOutcome } | { ok: false; code: SellErrorCode }
export type BuyResult = { ok: true; outcome: TradeOutcome } | { ok: false; code: BuyErrorCode }

/**
 * 이 상점이 이것을 사 주는가 — **매도 대상의 정의**(설계 §6-앞 13).
 *
 * 네 조건이 각각 무엇을 막는지: `material` 은 도구를(강화 재료를 실수로 파는
 * 사고가 크다), `!tokenEffect` 는 증표를(수십만 골드짜리 되팔기 창구가 열린다),
 * `price > 0` 은 값이 없는 것을(0원은 "공짜로 팔린다"가 아니라 **팔 수 없다**는
 * 뜻이다), `skill` 일치는 남의 계열을 막는다(남의 계열을 팔려면 그 마을에 가야
 * 한다 — 월드가 살아 있는 이유다).
 *
 * **빌드 검증(packages/data 의 validate.ts)이 같은 conjunction 을 쓴다.** 그쪽은
 * "쓸 곳도 팔 곳도 없는 아이템"을 잡을 때 이 정의로 묻는다. 둘이 갈라지면 빌드는
 * "이건 팔 데가 있다"며 통과시키는데 서버는 `not_sellable` 로 거절하는, 화면
 * 어디에도 이유가 안 적히는 상태가 된다 — 고칠 때는 반드시 두 곳을 함께 고친다.
 */
export function isSellTarget(def: ItemDef, shop: ShopDef): boolean {
  return def.kind === 'material' && !def.tokenEffect && def.price > 0 && def.skill === shop.skill
}

/**
 * 수량이 수량인지 못 박는다 — **오류 코드가 아니라 예외다.**
 *
 * 라우트는 스키마(protocol.ts 의 `TradeCount`)로 1..999 를 이미 강제하므로 이
 * 검사에 걸릴 요청은 없다. 그래도 두는 이유는 여기서 새는 것이 **값**이기
 * 때문이다: 음수 수량이면 매도가 "스택이 늘고 골드가 줄어드는" 거래가 되고,
 * 매수는 스택을 음수로 만들어 그 세이브를 다음 파싱에서 읽을 수 없게 만든다
 * (stacks 의 `min(0)` — 캐릭터가 통째로 500 이 된다).
 *
 * 거절 코드를 새로 만들지 않는 것이 요점이다. 오류 코드 목록(§6-앞 18)은 **게임
 * 규칙의 답**이고 화면이 그것으로 안내를 그린다. 정수가 아닌 수량은 규칙 밖의
 * 일 — 우리 코드가 잘못 부른 것이므로, 조용한 400 이 아니라 시끄러운 예외로
 * 남아야 사람이 본다. 상한(999)은 여기서 보지 않는다: 그것은 요청 하나가 만들 수
 * 있는 총액을 묶는 프로토콜의 정책이지, 산술이 깨지는 지점이 아니다.
 */
function requireCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`거래 수량이 1 이상의 정수가 아니다: ${count}`)
  }
}

/** 등록부에서 상점을 꺼내며 접근을 판정한다. 실패면 그 코드가 곧 거래의 코드다. */
function openShop(
  args: PerformTradeArgs,
): { ok: true; shop: ShopDef } | { ok: false; code: ShopAccessErrorCode } {
  const access = shopAccess(args.data, args.shopId, args.player, args.now)
  if (access !== 'ok') return { ok: false, code: access }
  // access 가 ok 라는 것은 그 상점이 등록부에 있다는 뜻이다 — 그 판정이 첫 번째로
  // 하는 일이 존재 확인이라, 여기서 다시 없을 수는 없다.
  return { ok: true, shop: args.data.shops[args.shopId]! }
}

/**
 * 아이템 정의를 꺼낸다. itemId 는 클라이언트가 그대로 보낸 문자열이라 hasOwn 으로
 * 읽는다 — `data.items[itemId]` 로 바로 읽으면 "constructor" 같은 상속 키가
 * 프로토타입 체인에서 값을 찾아 정의 행세를 한다(shopAccess 가 막는 것과 같은 구멍).
 */
function itemDef(data: GameData, itemId: string): ItemDef | undefined {
  return Object.hasOwn(data.items, itemId) ? data.items[itemId] : undefined
}

/**
 * 매도 — 그 계열의 재료를 상점에 넘기고 `sellPrice × count` 를 받는다.
 *
 * 판정 순서가 곧 안내의 순서다: 문(상점) → 물건(정의) → 자격(매도 대상) → 수량.
 * 물건을 먼저 보면 잠긴 상점 앞에서 "그건 못 파는 물건이오"를 듣게 되는데,
 * 플레이어가 할 일은 그게 아니라 숙련도를 올리는 것이다.
 */
export function performSell(args: PerformTradeArgs): SellResult {
  requireCount(args.count)
  const opened = openShop(args)
  if (!opened.ok) return opened

  const def = itemDef(args.data, args.itemId)
  if (!def) return { ok: false, code: 'unknown_item' }
  if (!isSellTarget(def, opened.shop)) return { ok: false, code: 'not_sellable' }

  const held = args.player.stacks[args.itemId] ?? 0
  if (held < args.count) return { ok: false, code: 'missing_items' }

  // 여기서부터 상태가 바뀐다 — **거절이 전부 끝난 뒤**다(§6-앞 19 ②). 검사 사이에
  // 상태를 조금씩 고치면 거절 경로가 반쯤 바뀐 플레이어를 남긴다.
  const player = structuredClone(args.player)
  const remaining = held - args.count
  // 0 이 되면 키를 지운다 — "가진 적 없음"과 같은 모양으로 만드는 것이 제작 서비스의
  // 관례이고, 가방이 0개짜리 칸으로 늘어나지 않게 하는 것도 같은 이유다.
  if (remaining > 0) player.stacks[args.itemId] = remaining
  else delete player.stacks[args.itemId]

  player.gold += sellPrice(def) * args.count
  return { ok: true, outcome: { player } }
}

/**
 * 매수 — 진열된 물건을 `buyPrice × count` 에 산다.
 *
 * 매도와 달리 **진열이 필요하다**(설계 §4): 그 계열이면 무엇이든 사 주지만,
 * 파는 것은 상점이 적어 둔 것뿐이다.
 */
export function performBuy(args: PerformTradeArgs): BuyResult {
  requireCount(args.count)
  const opened = openShop(args)
  if (!opened.ok) return opened

  const def = itemDef(args.data, args.itemId)
  if (!def) return { ok: false, code: 'unknown_item' }

  const entry = opened.shop.stock.find((e) => e.itemId === args.itemId)
  // 진열에 없는 물건과 요구치에 못 미치는 물건이 같은 코드인 이유: 플레이어에게
  // 둘은 같은 사실이다("이 상점에서는 지금 못 산다"). 코드를 나누면 클라이언트가
  // 다뤄야 할 안내가 하나 늘어나는데, 그 안내가 화면에 뜰 길이 없다 — 진열에
  // 없는 물건은 애초에 그려지지 않으므로 손으로 지은 요청으로만 닿는다.
  // 요구치 숫자는 진열(GameData)이 말하지 오류 코드가 말하지 않는다.
  if (!entry || args.player.skills[opened.shop.skill] < entry.unlockSkill) {
    return { ok: false, code: 'item_locked' }
  }

  // 증표는 하나로 충분하다 — 판정이 개수를 보지 않기 때문이다(§6-앞 16: `stacks > 0`
  // 이면 1회 적용). 이것이 **서버 규칙**이고 화면의 "보유 중"은 그 그림자다(§6-앞 14).
  // count > 1 도 같은 코드로 막는다: 요청 하나로 둘을 사면 둘째부터는 이미 가진
  // 것을 또 사는 셈이라, 효과는 그대로인데 돈만 배로 나간다.
  if (def.tokenEffect && ((args.player.stacks[args.itemId] ?? 0) > 0 || args.count > 1)) {
    return { ok: false, code: 'already_owned' }
  }

  const cost = buyPrice(def) * args.count
  if (args.player.gold < cost) return { ok: false, code: 'not_enough_gold' }

  const player = structuredClone(args.player)
  player.gold -= cost
  // 진열은 재료(증표 포함)뿐이다 — 도구를 팔기 시작하면 스택이 아니라 인스턴스로
  // 들어가야 하고, 그것은 인스턴스 id 를 만드는 일이라 라우트의 계약까지 바뀐다(훅).
  player.stacks[args.itemId] = (player.stacks[args.itemId] ?? 0) + args.count
  return { ok: true, outcome: { player } }
}
