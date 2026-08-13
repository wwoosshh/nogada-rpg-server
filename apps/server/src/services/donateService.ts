import {
  newlyAchieved,
  type GameData,
  type ItemDef,
  type MilestoneDef,
  type PlayerState,
} from '@nogada/shared'

/**
 * 헌납 — 채집물을 수집의 방에 바쳐 그 칸의 등급을 올린다(설계 §6-앞 5·11).
 *
 * **행동 간격을 검사도 소비도 하지 않는다**(§6-앞 12). 착용·강화(equipService)·
 * 거래(tradeService)·사용(useService)과 같은 이유다: 방에 무언가를 놓는 것은
 * 노가다의 결과를 정리하는 손짓이지 그 자체가 채집·제작이 아니다. 연타로
 * 악용할 수도 없다 — 바칠 재료는 유한하고, 그것을 만드는 채집에는 이미 간격이
 * 걸려 있다.
 *
 * 난수도 없다. 등급은 `donated` 누적치와 문턱표(`GameData.collection`)만으로
 * 정해지는 순수 계산(`collectionGrade`, packages/shared)이라 서비스가 굴릴
 * 주사위가 없다 — 트레이드와 같은 이유로 시각도 받지 않는다: 방문에는
 * 상점처럼 화자가 지키는 시간이 없다.
 */

export interface PerformDonateArgs {
  player: PlayerState
  data: GameData
  itemId: string
  /** 몇 개. 스키마가 1..100000 으로 조인다(protocol.ts 의 DonateCount). */
  count: number
}

/**
 * 응답은 플레이어와 새로 달성한 이정표다(§6-앞 9) — 채집·제작과 같은 모양이다.
 * 착용·강화·거래·사용이 `{player}` 만 내는 것은 그 행동들이 이정표 지표를
 * 바꾸지 않기 때문이고, 헌납은 `donated` 를 늘려 총점(이정표 `metricKind=
 * 'collection'`, K4)을 밀어 올릴 수 있으므로 여기서도 재판정이 있어야 칭호가
 * 그 순간의 응답에 실린다 — 없으면 다음 행동(채집·제작) 때까지 조용히 미뤄진다.
 */
export interface DonateOutcome {
  player: PlayerState
  achieved: MilestoneDef[]
}

export type DonateErrorCode = 'unknown_item' | 'not_collectable' | 'missing_items'

export type DonateResult =
  | { ok: true; outcome: DonateOutcome }
  | { ok: false; code: DonateErrorCode }

/**
 * 수량이 수량인지 못박는다 — tradeService 의 requireCount 와 같은 이유의 예외다.
 *
 * 라우트는 스키마(protocol.ts 의 DonateCount)로 1..100000 을 이미 강제하므로
 * 이 검사에 걸릴 요청은 없다. 그래도 두는 이유는 여기서 새는 것이 **값**이기
 * 때문이다: 음수 수량은 헌납을 "stacks 가 늘고 donated 가 주는" 거래로 뒤집고,
 * donated 가 줄면 이미 넘긴 문턱 아래로 등급이 내려가는데도 `celebrated` 는
 * 축하한 이정표를 지우지 않는다 — "칭호는 있는데 문턱 아래"라는, 되돌릴 수
 * 없다고 약속한 헌납(설계 §7 훅)이 조용히 어기는 상태가 세이브에 남는다.
 */
function requireCount(count: number): void {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`헌납 수량이 1 이상의 정수가 아니다: ${count}`)
  }
}

/**
 * 아이템 정의를 꺼낸다. itemId 는 클라이언트가 그대로 보낸 문자열이라 hasOwn 으로
 * 읽는다 — trade·use 서비스와 같은 방어다("constructor" 같은 상속 키가 프로토타입
 * 체인에서 값을 찾아 정의 행세를 하는 것을 막는다).
 */
function itemDef(items: Record<string, ItemDef>, itemId: string): ItemDef | undefined {
  return Object.hasOwn(items, itemId) ? items[itemId] : undefined
}

/**
 * 헌납 판정 — 물건(정의) → 자격(칸인가) → 소지 순으로 거절하고, 통과하면
 * `stacks` 에서 정확히 `count` 를 옮겨 `donated` 에 태운다.
 *
 * 판정 순서가 곧 안내의 순서다(trade·use 와 같은 원칙): 없는 물건에게
 * "모자라다"고 답하면 플레이어는 가방을 뒤지지만 그 물건은 세상에 없다.
 * 칸인지를 소지보다 먼저 보는 이유도 같다 — 도구·증표를 손에 쥐고 [바치기]를
 * 눌렀을 때 "모자라다"는 안내는 거짓이다. 애초에 바칠 수 없는 물건이라
 * 몇 개를 들고 있는지는 뜻이 없다.
 */
export function performDonate(args: PerformDonateArgs): DonateResult {
  requireCount(args.count)

  const def = itemDef(args.data.items, args.itemId)
  if (!def) return { ok: false, code: 'unknown_item' }

  // 칸인지는 `data.collection` 이 정한다 — 채집물 25종 전부이고, 그 밖(도구·
  // 증표·주괴·정제품)은 전부 여기서 걸린다(§6-앞 4). hasOwn 인 이유는 위와 같다.
  if (!Object.hasOwn(args.data.collection, args.itemId)) {
    return { ok: false, code: 'not_collectable' }
  }

  const held = args.player.stacks[args.itemId] ?? 0
  if (held < args.count) return { ok: false, code: 'missing_items' }

  // 여기서부터 상태가 바뀐다 — **거절이 전부 끝난 뒤**다(§6-앞 13). 검사 사이에
  // 상태를 조금씩 고치면 거절 경로가 반쯤 바뀐 플레이어를 남긴다.
  const player = structuredClone(args.player)
  const remaining = held - args.count
  // 0 이 되면 키를 지운다 — "가진 적 없음"과 같은 모양으로 만드는 것이 제작·
  // 거래·사용 서비스의 관례이고, 가방이 0개짜리 칸으로 늘어나지 않게 하는 것도 같다.
  if (remaining > 0) player.stacks[args.itemId] = remaining
  else delete player.stacks[args.itemId]

  player.donated[args.itemId] = (player.donated[args.itemId] ?? 0) + args.count

  // 달성 재판정 — 총점이 이정표 지표가 되므로(§6-앞 8·9) 이번 헌납이 문턱을
  // 넘겼으면 이번 응답에 그 사실이 실려야 플레이어가 "이 헌납 때문에 열렸다"를
  // 느낀다. 채집·제작과 같은 자리, 같은 무조건이다.
  const achieved = newlyAchieved(args.data, player, player.celebrated)
  for (const m of achieved) player.celebrated.push(m.id)

  return { ok: true, outcome: { player, achieved } }
}
