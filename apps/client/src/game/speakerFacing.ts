import type { Direction, TilePos } from '@nogada/shared'

/**
 * `from` 에 선 사람이 `to` 를 보려면 어느 쪽을 향해야 하는가. 같은 칸이면 `null`.
 *
 * 말을 걸면 화자가 플레이어 쪽으로 몸을 돌리는데, 그 "어느 쪽" 하나가 이 함수다.
 * 씬 안에 두지 않고 떼어 낸 이유는 이것이 화면과 무관한 판단이기 때문이다 —
 * 이 저장소에 Phaser 테스트 하네스가 없어서, 씬 안에 두면 검증 없는 코드가 된다
 * (dialogueFlow·arrivalFacing 이 같은 이유로 밖에 나와 있다).
 *
 * **대각선이 없으므로 둘 중 하나를 골라야 한다.** 이 게임의 방향은 넷뿐이고
 * (movement.ts 의 Direction), 그래서 대각선 방향의 상대를 볼 때는 가로세로 중
 * 더 멀리 떨어진 축을 택한다. 정확히 같으면 가로다 — 화면이 가로로 넓어
 * (812×375) 옆으로 도는 편이 위아래로 도는 것보다 덜 어색하게 읽힌다.
 *
 * 실제로 말을 거는 순간에는 플레이어가 반드시 바로 앞칸에 있으므로(앞칸 판정)
 * 한 축의 차이가 0 이고, 애매한 경우는 생기지 않는다. 그래도 일반적으로 쓸 수
 * 있게 두는 것은, 나중에 일과표가 화자를 옮기면 "멀리 있는 것을 본다"가
 * 필요해지기 때문이다.
 */
export function facingToward(from: TilePos, to: TilePos): Direction | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}
