import type { Direction } from '@nogada/shared'

/**
 * 패드 중심에서 손가락까지의 오프셋 하나로 축 방향 하나를 고른다.
 *
 * `TouchSource.bindPad` 의 클로저 안에 있던 계산을 떼어낸 것이다. 떼어낸 이유는
 * 이 계산이 실기에서만 드러나는 방식으로 틀렸던 적이 있어서다 — 오프셋을
 * 서로 다른 좌표계(캔버스 백킹스토어 픽셀 vs 씬 좌표)의 두 값을 빼서 만드는
 * 바람에, 기기 픽셀비가 2인 화면에서는 ◀ 나 ▲ 를 눌러도 세로 성분이 압도해
 * 늘 아래로 걸었다. 클로저 안에 묻혀 있으니 어떤 테스트도 닿지 못했고 그래서
 * 그 상태로 살아남았다. 좌표를 어느 공간에서 만들지는 Phaser 를 아는 쪽에
 * 남기고, "이 오프셋이 어느 방향이냐"는 판단만 여기로 옮겨 Phaser 없이
 * 검증한다(padDirection.test.ts).
 *
 * @param offsetX 패드 중심 기준 가로 오프셋. **offsetY·deadZoneRadius 와 같은 좌표계여야 한다.**
 * @param offsetY 패드 중심 기준 세로 오프셋.
 * @param deadZoneRadius 중심에서 이 반경 안이면 방향을 고르지 않는다(null).
 */
export function padDirection(
  offsetX: number,
  offsetY: number,
  deadZoneRadius: number,
): Direction | null {
  if (Math.hypot(offsetX, offsetY) < deadZoneRadius) return null
  // 동률(|dx| === |dy|, 정확히 대각선)이면 세로를 고른다. '>' 비교라
  // 가로가 더 클 때만 가로가 이기고, 같으면 자연히 세로 분기로
  // 떨어진다 — 프레임마다 다른 쪽으로 흔들리지 않으려면 이 갈림이
  // 결정적이어야 한다.
  if (Math.abs(offsetX) > Math.abs(offsetY)) return offsetX > 0 ? 'right' : 'left'
  return offsetY > 0 ? 'down' : 'up'
}
