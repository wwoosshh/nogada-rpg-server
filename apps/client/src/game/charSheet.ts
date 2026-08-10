import type { Direction } from '@nogada/shared'

/**
 * Pipoya 32×32 캐릭터 시트의 해부학. 사람 모양으로 그려지는 모든 것이 이 값을 쓴다.
 *
 * 시트 한 장은 96×128 = **3열 × 4행**, 프레임은 32×32 다. 행 순서는
 * 아래·왼쪽·오른쪽·위이고, **가운데 열이 대기 자세**다. 걷기는 왼발·대기·
 * 오른발·대기 네 칸을 도는 RPG Maker 계열 순환이다.
 *
 * 이 계산이 여기 있는 이유는 플레이어와 NPC 가 **같은 규격의 시트**를 쓰기
 * 때문이다. 예전엔 WorldScene 안에만 있었고 그때는 사람이 플레이어 하나뿐이라
 * 맞는 자리였다. 화자가 사람 모양을 갖게 된 지금 그대로 두면 같은 표가 두 벌
 * 생기고, 언젠가 한쪽만 고쳐진다 — 그러면 NPC 만 왼쪽을 보며 오른쪽으로 걷는다.
 */
const COLUMNS = 3

/** 방향마다 시트의 몇 번째 행인가. */
export const WALK_ROW: Record<Direction, number> = { down: 0, left: 1, right: 2, up: 3 }

/** 가운데 열이 대기 자세다. */
export function idleFrame(facing: Direction): number {
  return WALK_ROW[facing] * COLUMNS + 1
}

/**
 * 걷기 한 바퀴의 프레임 번호.
 *
 * 한 걸음 → 대기 → 반대 걸음 → 대기. 대기 프레임이 두 번 나오는 것이 맞다 —
 * 그래야 발이 번갈아 나가는 것으로 보인다.
 */
export function walkFrames(facing: Direction): number[] {
  const start = WALK_ROW[facing] * COLUMNS
  return [start, start + 1, start + 2, start + 1]
}
