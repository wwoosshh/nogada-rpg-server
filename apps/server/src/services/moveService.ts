import { transitionGate, type GameData, type PlayerState } from '@nogada/shared'

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

/**
 * `locked` 는 "그 문은 있는데 지금 이 사람에게는 안 열린다" 다 — 결계다(설계 §2).
 *
 * `no_transition` 과 나누는 이유는 플레이어가 할 일이 다르기 때문이다: 저쪽은
 * 애초에 문이 아닌 칸이라 화면이 말할 것이 없고, 이쪽은 **숫자를 올리면 열리는**
 * 문이라 화면이 필요치와 현재치를 말해야 한다(§5 — 밀려날 때 화면이 숫자를
 * 말한다). 그 문구를 짓는 것은 B5 의 몫이고, 여기서는 코드만 나눠 준다.
 */
export type MoveErrorCode = 'no_transition' | 'locked'

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
 * **결계에 부딪힌 요청도 마찬가지다** — 거절을 쿨다운으로 벌하면 벽 앞에서
 * 되돌아 나오는 것만으로 그 사람의 노가다가 느려진다.
 */
export function moveThroughTransition(args: MoveArgs): MoveResult {
  const player = structuredClone(args.player)

  const transition = args.data.transitions.find(
    (t) => t.fromMap === player.location.mapId && t.fromX === args.x && t.fromY === args.y,
  )
  if (!transition) return { ok: false, code: 'no_transition' }

  // 결계 판정은 **여기서 짓지 않는다.** 부등호는 shared 의 transitionGate 하나뿐이고
  // (§9-앞 13), 화면도 같은 함수를 부른다 — 서버가 여기에 `player.skills[...] >=
  // t.gateValue` 를 한 줄 더 적는 순간 화면이 열어 놓은 문을 서버가 이유 없이
  // 거절하는 날이 온다. 게이트 없는 문은 null 이라 그대로 지나간다.
  const gate = transitionGate(transition, player)
  if (gate && !gate.open) return { ok: false, code: 'locked' }

  player.location = { mapId: transition.toMap, x: transition.toX, y: transition.toY }
  return { ok: true, outcome: { player } }
}
