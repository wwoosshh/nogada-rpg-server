/**
 * 이동과 바라봄의 방향. 네 개뿐이다.
 *
 * 대각선을 넣지 않는 것은 편의를 포기한 결정이다. 앞칸이 하나로 정해져야
 * 상호작용 대상이 모호해지지 않고, 그 명확함이 이 게임에서는 대각선 이동의
 * 편의보다 중요하다. 원작도 `Input.dir4` 만 쓴다.
 */
export type Direction = 'up' | 'down' | 'left' | 'right'

export const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right']

/**
 * 방향의 이름표 — SKILL_LABELS 와 같은 자리, 같은 이유(이름은 한 곳에서만 정한다).
 *
 * **화면의 위가 곧 북이다.** 이 게임에는 회전하는 카메라도 방위 표시도 없고,
 * 맵은 언제나 같은 방향으로 놓인다 — 그래서 "위쪽 가장자리의 문" 과 "북문" 은
 * 같은 문을 가리키는 두 이름이고, 플레이어에게 말할 때 쓰는 쪽이 뒤엣것이다
 * ("↑ 로 나가라" 는 조작 설명이지 자리 설명이 아니다).
 */
export const DIRECTION_LABELS: Record<Direction, string> = {
  up: '북',
  down: '남',
  left: '서',
  right: '동',
}

/**
 * 타일 좌표. 이것이 플레이어 위치의 정본이다.
 *
 * 픽셀 좌표는 이 값을 그리기 위한 파생물이다. 순서가 뒤집히면 위치를 서버에
 * 보낼 때 반올림 문제가 생긴다.
 */
export interface TilePos {
  x: number
  y: number
}

/** 한 걸음에 걸리는 시간. 원작의 이동 속도에서 추정한 값이라 조정 가능하다. */
export const STEP_MS = 200

const DELTAS: Record<Direction, TilePos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** 그 방향으로 한 걸음 갔을 때의 좌표 변화. 반환값은 매번 새 객체다. */
export function stepDelta(dir: Direction): TilePos {
  const d = DELTAS[dir]
  return { x: d.x, y: d.y }
}

/** 그 자리에서 그 방향을 볼 때의 앞칸. */
export function frontTile(pos: TilePos, facing: Direction): TilePos {
  const d = DELTAS[facing]
  return { x: pos.x + d.x, y: pos.y + d.y }
}

export function samePos(a: TilePos, b: TilePos): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * 두 칸 사이의 실제 걸음 수 — 이동이 4방향뿐이라 거리는 맨해튼이다.
 *
 * 체비쇼프(max)로 재면 대각 주장이 정직한 걸음의 2배속으로 통과한다(설계
 * §2-3 실측: 대각 5칸 = 맨해튼 10칸 = 정직 2,000ms 를 체비쇼프 5 는 800ms 로
 * 통과시킨다). 사거리·속도 개연성·빌드 검증 시뮬이 전부 이 하나를 불러야
 * 하는 이유다 — 어느 한 곳이 다른 자로 재는 순간 그 자리가 치트의 문이 된다.
 */
export function manhattanDistance(a: TilePos, b: TilePos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/**
 * 그 대상이 지금 상호작용할 수 있는 자리에 있는가.
 *
 * 인접한 것만으로는 부족하고 바라보고 있어야 한다 — 원작의 결정 버튼 트리거가
 * 그렇다. 서버가 위치를 알게 되면 이 함수가 그대로 서버 검증이 된다.
 */
export function isAdjacentFacing(from: TilePos, facing: Direction, target: TilePos): boolean {
  return samePos(frontTile(from, facing), target)
}
