import type { GameData, PlayerState } from '@nogada/shared'

export interface MoveOutcome {
  player: PlayerState
}

export interface MoveArgs {
  player: PlayerState
  data: GameData
  /** 클라이언트가 **밟았다고 주장하는** 칸. 목적지가 아니다. */
  x: number
  y: number
}

export type MoveErrorCode = 'no_transition'

export type MoveResult = { ok: true; outcome: MoveOutcome } | { ok: false; code: MoveErrorCode }

/**
 * 전환 칸을 밟았다는 요청을 판정한다.
 *
 * 클라이언트는 "어디로 가고 싶다"가 아니라 "어느 칸을 밟았다"만 말한다 —
 * 목적지를 클라이언트가 고르게 하면 요청 하나로 아무 맵 아무 칸에나 설 수
 * 있다. 그래서 이 함수가 하는 일의 전부는, 지금 플레이어가 있는 맵의 그 칸에
 * 전환이 있는지 `data.transitions` 에서 찾고 있으면 그 전환이 적어 둔 곳으로
 * 옮기는 것이다.
 *
 * **밟았다는 주장 자체는 검증하지 않는다.** 서버는 걸음마다 위치를 받지 않으니
 * (PlayerState.location 문서) 그 칸이 지금 위치의 이웃인지 알 방법이 없다.
 * 대신 갈 수 있는 곳이 전환표에 적힌 칸으로만 좁혀지므로, 최악의 경우에도
 * 걸어서 닿을 수 있는 자리로 한 번에 가는 것뿐이다.
 *
 * 채집·제작과 달리 `nextActionAt` 을 읽지도 쓰지도 않는다 — 대화와 같은
 * 이유다(talkService). 맵을 넘는 것은 아무것도 만들지 않는 이동이라 노가다
 * 속도에 묶을 것이 없고, 묶으면 가장자리를 밟는 것만으로 채집이 느려진다.
 */
export function moveThroughTransition(args: MoveArgs): MoveResult {
  const player = structuredClone(args.player)

  const transition = args.data.transitions.find(
    (t) => t.fromMap === player.location.mapId && t.fromX === args.x && t.fromY === args.y,
  )
  if (!transition) return { ok: false, code: 'no_transition' }

  player.location = { mapId: transition.toMap, x: transition.toX, y: transition.toY }
  return { ok: true, outcome: { player } }
}
