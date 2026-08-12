import {
  buyPrice,
  isSellTarget,
  sellPrice,
  SKILL_LABELS,
  type GameData,
  type PlayerState,
  type ShopDef,
} from '@nogada/shared'

/**
 * 상점 패널(ShopPanel.tsx)이 그릴 순수 데이터를 만든다 — craftCardModel.ts 의
 * 자리와 같은 자리다.
 *
 * **규칙을 여기서 다시 짓지 않는다.** 무엇을 사 주는가는 shared 의
 * `isSellTarget`(서버의 매도 판정이 부르는 바로 그 함수), 값은 `sellPrice`·
 * `buyPrice`, 진열과 요구치는 `GameData.shops` 다. 이 파일이 하는 일은 그것들을
 * 화면이 읽을 수 있는 줄로 옮기고, 수량을 **살 수 있는·가진 만큼**으로 조이는
 * 것뿐이다 — 그 조임도 판정이 아니라 요청을 미리 걸러 서버에 거절될 게 뻔한
 * 왕복을 안 보내는 것이고, 최종 판정은 언제나 서버다.
 */

/**
 * 요청 하나가 나를 수 있는 최대 수량 — 서버 스키마(protocol.ts 의 `TradeCount`)의
 * 상한과 같은 값이다. 화면이 이 위를 고르게 두면 서버가 `bad_request` 로 거절하는데,
 * 그건 플레이어가 고칠 방법을 알 수 없는 거절이다.
 */
export const MAX_TRADE_COUNT = 999

/** 팔기 목록 한 줄 — 가방에 있고 이 상점이 사 주는 것. */
export interface ShopSellRow {
  itemId: string
  name: string
  /** 지금 가진 개수. 수량 상한이자 목록의 `보유 N`. */
  held: number
  /** 개당 매도가(정가의 절반). */
  unitPrice: number
}

/**
 * 진열 한 칸의 상태.
 * - `ready` — 지금 살 수 있다(골드는 별개다: 그건 총액이 말한다).
 * - `locked` — 요구치 미달. **숨기지 않고 요구치 숫자와 함께 보인다**(원작의 그 문).
 * - `owned` — 증표를 이미 갖고 있다. 서버 규칙(`already_owned`)의 그림자다.
 */
export type ShopBuyState = 'ready' | 'locked' | 'owned'

/** 사기 목록 한 줄 — 상점이 적어 둔 진열 그대로(잠긴 것도 그대로 있다). */
export interface ShopBuyRow {
  itemId: string
  name: string
  /** 개당 매수가(정가). */
  unitPrice: number
  state: ShopBuyState
  /** 이 칸이 열리는 숙련도. 잠긴 칸이 말하는 요구치. */
  unlockSkill: number
  /** 지금 그 계열 숙련도 — 잠긴 칸의 `현재/필요` 중 현재. */
  proficiency: number
  /** 요구치 옆에 붙는 기술 이름(그 상점의 계열). */
  skillLabel: string
  /**
   * 증표인가 — 증표는 **하나로 충분하다**(판정이 개수를 안 본다, 설계 §6-앞 16).
   * 서버가 `count > 1` 을 `already_owned` 로 거절하므로 화면도 수량을 안 고른다.
   */
  token: boolean
}

/**
 * 팔기 목록 = 가방 ∩ 이 상점의 매도 대상.
 *
 * 순서는 `items.csv` 선언 순서(= `data.items` 키 순서)로 고정한다 — 가방 재료
 * 리스트·제작 목록과 같은 이유다: 파는 동안 줄이 위아래로 흔들리면 손가락이
 * 매번 자리를 다시 찾는다. 수량 0 은 줄이 없다(스택에 키가 없다).
 */
export function sellRows(data: GameData, player: PlayerState, shop: ShopDef): ShopSellRow[] {
  const rows: ShopSellRow[] = []
  for (const id of Object.keys(data.items)) {
    const def = data.items[id]
    if (def === undefined || !isSellTarget(def, shop)) continue
    const held = player.stacks[id] ?? 0
    if (held <= 0) continue
    rows.push({ itemId: id, name: def.name, held, unitPrice: sellPrice(def) })
  }
  return rows
}

/**
 * 사기 목록 = 진열 그대로.
 *
 * **잠긴 칸을 빼지 않는다.** 요구치를 숫자로 말하는 문이 이 게임의 동기부여
 * 장치이고(원작의 목록방), 진열에서 지워 버리면 "언젠가 여기서 무언가를 살 수
 * 있다"는 사실 자체가 화면에서 사라진다.
 */
export function buyRows(data: GameData, player: PlayerState, shop: ShopDef): ShopBuyRow[] {
  const proficiency = player.skills[shop.skill]
  const rows: ShopBuyRow[] = []
  for (const entry of shop.stock) {
    const def = data.items[entry.itemId]
    if (def === undefined) continue // 없는 진열은 빌드가 막는다 — 화면은 조용히 넘긴다
    const token = def.tokenEffect !== undefined
    const owned = token && (player.stacks[entry.itemId] ?? 0) > 0
    rows.push({
      itemId: entry.itemId,
      name: def.name,
      unitPrice: buyPrice(def),
      state: owned ? 'owned' : proficiency < entry.unlockSkill ? 'locked' : 'ready',
      unlockSkill: entry.unlockSkill,
      proficiency,
      skillLabel: SKILL_LABELS[shop.skill],
      token,
    })
  }
  return rows
}

/** 이 줄을 한 번에 팔 수 있는 최대 수량 — 가진 만큼, 그리고 요청 상한까지. */
export function maxSellCount(row: ShopSellRow): number {
  return Math.min(row.held, MAX_TRADE_COUNT)
}

/**
 * 이 줄을 한 번에 살 수 있는 최대 수량 — **지금 골드로 감당되는 만큼**이다.
 *
 * 잠겼거나 이미 가진 칸은 0 이다(그 칸의 버튼은 애초에 눌리지 않는다). 증표는
 * 1 이 상한이다(§6-앞 16 — 둘째부터는 효과 없이 돈만 나간다).
 *
 * `unitPrice <= 0` 가드는 **0 으로 나누지 않기 위한 것뿐이다** — 여기서 새면
 * 화면에 Infinity 가 뜬다. 값이 0 인 진열을 막는 것은 이 가드가 아니라
 * 빌드다(validate.ts 의 진열 price 검사): 이 함수가 0 을 돌려줘도 clampCount 가
 * 1 을 돌려주므로 총액은 0 이 되고, 총액 0 은 골드보다 크지 않아 [사기] 버튼이
 * 살아 있다. 즉 화면 혼자서는 무한 무료 아이템을 막지 못한다.
 */
export function maxBuyCount(row: ShopBuyRow, gold: number): number {
  if (row.state !== 'ready' || row.unitPrice <= 0) return 0
  const cap = row.token ? 1 : MAX_TRADE_COUNT
  return Math.min(Math.floor(gold / row.unitPrice), cap)
}

/**
 * 고른 수량을 1..max 로 조인다. max 가 0 이면(살 돈도 팔 것도 없으면) 1 을
 * 돌려준다 — 화면은 그래도 "한 개면 얼마"를 말해야 하고, 그 총액이 골드보다
 * 크다는 사실이 곧 버튼이 잠긴 이유가 된다. 보내는 것은 어차피 버튼이 살아
 * 있을 때뿐이다.
 */
export function clampCount(want: number, max: number): number {
  const floor = Math.floor(want)
  if (!Number.isFinite(floor) || floor < 1) return 1
  if (max < 1) return 1
  return Math.min(floor, max)
}

/** 총액 — 개당 값 × 수량. 화면이 실시간으로 보여주는 그 숫자다. */
export function tradeTotal(unitPrice: number, count: number): number {
  return unitPrice * count
}

/**
 * 골드 한 줄 — `1,234 G`.
 *
 * 상단 바·가방·상점이 같은 함수를 쓴다. 세 곳이 각자 적으면 천 단위 구분이
 * 한 곳만 빠지는 날이 오고, 그때 화면은 24,000 과 240,000 을 같은 굵기로
 * 말하게 된다(자릿수가 곧 티어인 게임이다).
 */
export function formatGold(gold: number): string {
  return `${gold.toLocaleString('ko-KR')} G`
}
