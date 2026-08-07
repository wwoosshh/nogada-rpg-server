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

/**
 * 이 숙련도를 넘으면 그 기술의 자동 반복이 열린다.
 *
 * 이 값에서 행동 간격이 200ms — 초당 5회다. 연타로 지속하기 어려운 경계이므로,
 * 해금이 정확히 손가락이 병목이 되는 순간에 온다. 그 전까지는 연타가 실제로
 * 가능하니 잠겨 있어도 손해가 없고, 그 뒤로는 잠겨 있으면 손해라서 열린다.
 */
export const REPEAT_UNLOCK_PROFICIENCY = 10_000

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
 * 그 대상이 지금 상호작용할 수 있는 자리에 있는가.
 *
 * 인접한 것만으로는 부족하고 바라보고 있어야 한다 — 원작의 결정 버튼 트리거가
 * 그렇다. 서버가 위치를 알게 되면 이 함수가 그대로 서버 검증이 된다.
 */
export function isAdjacentFacing(from: TilePos, facing: Direction, target: TilePos): boolean {
  return samePos(frontTile(from, facing), target)
}

/** 그 숙련도에서 누르고 있는 것만으로 반복되는가. */
export function canRepeat(proficiency: number): boolean {
  return proficiency >= REPEAT_UNLOCK_PROFICIENCY
}
