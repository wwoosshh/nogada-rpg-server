import { weatherEndsAt, type ItemDef, type PlayerState } from '@nogada/shared'

/**
 * 사용 — 소모품 하나를 써서 그 효과를 받는다. 지금 쓸 수 있는 것은 날씨 가루
 * 4종뿐이고, 그 효과는 **연출**이다(설계 §6-앞 1~4: 원작의 날씨 가루는
 * `SetWeatherEffects` 였고 전투도 HP 도 건드리지 않았다).
 *
 * **행동 간격을 검사도 소비도 하지 않는다.** 착용·강화(equipService)·거래
 * (tradeService)와 같은 이유다 — 정리와 사용은 행동이 아니라 노가다 사이의
 * 손짓이고, 거기에 세금을 붙이면 가방을 뒤지는 것만으로 채집이 느려진다.
 * 연타로 악용할 수도 없다: 가루는 유한하고, 그것을 만드는 제작에는 이미 간격이
 * 걸려 있다.
 *
 * 난수도 없다. 무엇이 얼마나 오는가는 전부 아이템 정의가 정하므로 서비스가
 * 굴릴 주사위가 없다 — 시각만 받는데, 그것은 **언제 그치는가**를 적어야 하기
 * 때문이다.
 *
 * 동시 요청은 채집·제작과 같은 applyToCharacter 낙관 잠금이 처리한다.
 */

export interface PerformUseArgs {
  player: PlayerState
  /**
   * 카탈로그에서 items 만 본다 — 착용·강화와 같은 계약이다. 이 판정에 필요한
   * 것은 "그 물건이 무엇을 하는가" 하나뿐이라 GameData 통째가 필요 없다.
   */
  items: Record<string, ItemDef>
  itemId: string
  /** 날씨가 그치는 시각을 재는 기준. 라우트가 넣어 준 것을 그대로 쓴다. */
  now: number
}

/** 응답은 플레이어 통째 하나다 — 착용·강화·거래와 같은 모양이라 클라이언트의 적용 경로가 하나다. */
export interface UseOutcome {
  player: PlayerState
}

export type UseErrorCode = 'unknown_item' | 'not_usable' | 'missing_items'

export type UseResult = { ok: true; outcome: UseOutcome } | { ok: false; code: UseErrorCode }

/**
 * 아이템 정의를 꺼낸다. itemId 는 클라이언트가 그대로 보낸 문자열이라 hasOwn 으로
 * 읽는다 — `items[itemId]` 로 바로 읽으면 "constructor" 같은 상속 키가 프로토타입
 * 체인에서 값을 찾아 정의 행세를 한다(tradeService 가 막는 것과 같은 구멍).
 */
function itemDef(items: Record<string, ItemDef>, itemId: string): ItemDef | undefined {
  return Object.hasOwn(items, itemId) ? items[itemId] : undefined
}

/**
 * 사용 판정 — 물건(정의) → 자격(사용 효과) → 소지 순으로 거절하고, 통과하면
 * 정확히 **하나**를 소모한 뒤 날씨를 건다.
 *
 * 판정 순서가 곧 안내의 순서다(tradeService 와 같은 원칙): 없는 물건에게
 * "가진 게 없다"고 답하면 플레이어는 가방을 뒤지지만 그 물건은 세상에 없다.
 */
export function performUse(args: PerformUseArgs): UseResult {
  const def = itemDef(args.items, args.itemId)
  if (!def) return { ok: false, code: 'unknown_item' }

  // 사용 효과가 없으면 그냥 재료다. 도구도 여기서 걸린다 — 도구는 stacks 에
  // 살지 않아 소모할 개수 자체가 없고, 그래서 애초에 이 칸을 가질 수 없다
  // (packages/data 의 검증이 그런 행을 막는다).
  const effect = def.useEffect
  if (!effect) return { ok: false, code: 'not_usable' }

  const held = args.player.stacks[args.itemId] ?? 0
  if (held < 1) return { ok: false, code: 'missing_items' }

  // 여기서부터 상태가 바뀐다 — **거절이 전부 끝난 뒤**다. 검사 사이에 상태를
  // 조금씩 고치면 거절 경로가 반쯤 바뀐 플레이어를 남긴다.
  const player = structuredClone(args.player)
  const remaining = held - 1
  // 0 이 되면 키를 지운다 — "가진 적 없음"과 같은 모양으로 만드는 것이 제작·
  // 거래 서비스의 관례이고, 가방이 0개짜리 칸으로 늘어나지 않게 하는 것도 같다.
  if (remaining > 0) player.stacks[args.itemId] = remaining
  else delete player.stacks[args.itemId]

  // **기존 날씨는 덮어쓴다 — 남은 시간은 버린다.**
  //
  // 남은 시간에 더하면 가루를 쌓아 두었다가 한꺼번에 써서 하늘을 하루 종일
  // 묶어 둘 수 있고(그러면 "비 오는 날 대사"가 일상이 되어 특별할 것이 없어진다),
  // "이미 오고 있다"고 거절하면 비를 눈으로 바꾸려는 사람이 비가 그칠 때까지
  // 기다려야 한다 — 소모품을 손에 쥐고 못 쓰는 상태다. 덮어쓰기는 둘 다 피하고,
  // 규칙이 한 줄로 설명된다: **마지막으로 쓴 가루가 지금 하늘이다.**
  player.weather = { kind: effect.weather, untilMs: weatherEndsAt(args.now, effect.minutes) }
  return { ok: true, outcome: { player } }
}
