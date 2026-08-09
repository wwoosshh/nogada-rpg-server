import type { Direction, TilePos, TransitionDef } from '@nogada/shared'

/**
 * 이 맵 이 칸에 서 있는 사람이 바라볼 방향.
 *
 * 전환표의 `facing` 은 파싱되고 타입 검사까지 받으면서도 **아무도 읽지
 * 않았다.** 얼음채집장 (3,0) 에서 북쪽으로 걸어 나가면 눈의마을 (10,13) 에 남쪽을
 * 보고 도착했다 — 방금 나온 전환을 정면으로 마주 보면서. 채워 넣어도 아무
 * 일도 안 일어나는 열은 작가에게 없는 것만 못하다.
 *
 * `facing` 이 비어 있거나 그 칸에 도착하는 전환이 없으면 **들어온 방향을 그대로
 * 유지한다**(설계 문서 3.5). 새로고침 직후처럼 "들어온 방향"이 없으면 부르는
 * 쪽이 첫 부팅의 기본 자세를 넘긴다.
 *
 * **왜 서버가 아니라 클라이언트인가:** 바라보는 방향은 판정이 아니라 그림이다.
 * 서버가 정하는 것은 "어느 맵 어느 칸에 서는가" 이고(moveService), 그 칸에서
 * 어느 쪽을 보는지는 아무 규칙에도 쓰이지 않는다. 씬은 이미 같은 전환표를 읽어
 * 통신량을 줄이고 있으므로(WorldScene.checkTransition) 표를 새로 들여오지도
 * 않는다.
 *
 * 맵을 함께 보는 것이 중요하다 — 두 맵이 같은 좌표를 갖는 것은 규칙이 아니라
 * 우연이라, 좌표만 맞추면 다른 맵 전환의 방향을 물려받는다.
 */
export function arrivalFacing(
  transitions: readonly TransitionDef[],
  mapId: string,
  tile: TilePos,
  cameWith: Direction,
): Direction {
  const arrived = transitions.find(
    (t) => t.toMap === mapId && t.toX === tile.x && t.toY === tile.y,
  )
  return arrived?.facing ?? cameWith
}
