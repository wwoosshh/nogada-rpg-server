import { runStoryHook } from '@nogada/data'
import { transitionGate, type GameData, type PlayerState } from '@nogada/shared'

export interface MoveOutcome {
  player: PlayerState
}

export interface MoveArgs {
  player: PlayerState
  data: GameData
  /**
   * 판정 시각(epoch ms). 허브 결계의 물때가 이것을 본다(설계 §6).
   *
   * 채집·제작·대화와 같은 자세로 라우트가 `Date.now()` 를 넣는다 — 서비스가
   * 시계를 직접 읽으면 그 판정을 시험할 방법이 시스템 시각을 흔드는 것밖에
   * 없고, "물이 차 있을 때 거절한다" 는 실제로 그 시각까지 기다려야 확인된다.
   */
  now: number
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
  // 허브 결계의 물때(§6)도 같은 술어 안에 있다 — 여기서 시각을 따로 재면
  // 조건이 둘로 늘어난 만큼 갈라질 자리도 둘이 된다.
  const gate = transitionGate(transition, player, args.now)
  if (gate && !gate.open) return { ok: false, code: 'locked' }

  player.location = { mapId: transition.toMap, x: transition.toX, y: transition.toY }

  // 스토리 사슬의 **새 판정 자리**다(설계 ⑧-4). 채집·제작·헌납은 이미 이정표를
  // 재판정하던 자리에 한 줄이 붙었지만, 이동은 오늘까지 이정표를 아예 안 봤다 —
  // 지표가 전부 단조 증가라 문을 넘는 것으로는 아무 문턱도 안 움직였기 때문이다.
  // 사슬은 다르다: 마디 0 이 「{마을} {방향}문으로 나가라」이고, 그것을 끝내는
  // 사건은 오직 이 줄 위쪽의 전환 하나뿐이다.
  //
  // **자리를 옮긴 뒤**에 부른다. 사슬 유도가 숙련 0 인 사람에게는 서 있는 자리를
  // 보므로(`storyVillage` 의 ②), 이 순서라야 판정이 본 세계와 응답에 실려 저장되는
  // 세계가 같다 — 앞에서 부르면 사슬이 "떠나온 곳"을 기준으로 서고, 그 답이 저장된
  // 자리와 어긋나는 날 왜 그런지 되짚을 자리가 없다.
  //
  // 밀어올림이 읽는 것은 **넘기 전**의 그 사람이다(`before`) — 얼음 200,000 인
  // 테스터가 오늘도 채집장에 나가는 그 한 걸음이 마침 마디 0 을 만족시키므로,
  // 지금 상태로 재면 그 사람이 초보 마디를 「해냈다」로 받는다.
  runStoryHook({ data: args.data, player, before: args.player, event: { kind: 'arrive', mapId: transition.toMap } })

  return { ok: true, outcome: { player } }
}
