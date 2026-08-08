import type Phaser from 'phaser'

/**
 * 캔버스를 기기 픽셀 하나당 하나씩 그리기 위한 배율.
 *
 * `Scale.RESIZE` 는 캔버스의 백킹스토어를 부모의 **CSS 픽셀** 크기로 고정한다
 * (ScaleManager.updateScale 의 RESIZE 분기가 `canvas.width = styleWidth` 로
 * 못 박고, 그 모드에서는 zoom 을 아예 읽지 않는다). 기기 픽셀비가 2 인 화면에서는
 * 절반 해상도로 그린 뒤 브라우저가 두 배로 늘리게 되고, 그래서 캔버스 안의 글자만
 * 흐리고 DOM 인 상단 바는 선명한 상태가 된다.
 *
 * 그래서 게임 크기를 기기 픽셀로 잡고(= 백킹스토어가 네이티브가 된다) 카메라 zoom
 * 으로 되돌린다. 좌표와 크기 상수는 CSS 픽셀 의미를 그대로 유지한다.
 *
 * **정수로 반올림하는 이유:** 이 게임은 32px 픽셀아트다. 배율이 정수여야 원본
 * 한 픽셀이 화면의 정수 개 픽셀로 떨어져 뭉개지지 않는다. 기기 픽셀비가 2.75 같은
 * 값이면 브라우저가 마지막에 조금 다시 늘리지만, 그건 우리가 어쩔 수 없는 부분이고
 * 지금처럼 2배로 늘어나는 것보다는 훨씬 낫다.
 *
 * 상한 3 은 메모리 때문이다 — 배율이 오르면 백킹스토어와 글리프 텍스처가 제곱으로
 * 커진다. 4배까지 가는 기기에서 3배로 그려도 육안으로는 구분되지 않는다.
 */
export function renderScale(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return Math.min(3, Math.max(1, Math.round(dpr || 1)))
}

/**
 * 레이아웃이 써야 하는 화면 크기. **게임 좌표가 아니라 CSS 픽셀이다.**
 *
 * `scene.scale.width` 는 이제 기기 픽셀이라 그대로 쓰면 배율만큼 어긋난다.
 * 버튼 지름 48 같은 상수가 물리적으로 같은 크기로 남으려면 이 값을 써야 한다.
 */
export function viewSize(scene: Phaser.Scene): { width: number; height: number } {
  const s = renderScale()
  return { width: scene.scale.width / s, height: scene.scale.height / s }
}

/**
 * 화면에 고정된 오브젝트를 **중앙 기준으로 확대되는 카메라** 안에 놓기 위한 좌표 변환.
 *
 * `setScrollFactor(0)` 은 카메라 스크롤에서만 벗어나고 zoom 에서는 벗어나지 않는다.
 * 원점이 (0.5, 0.5) 인 카메라는 화면 중앙을 기준으로 확대하므로, 화면의 (sx, sy) 에
 * 보이게 하려면 오브젝트를 중앙 쪽으로 당겨 놓아야 한다.
 *
 * UI 씬(컨트롤러·패널)은 카메라 원점을 (0, 0) 으로 두어 이 변환이 필요 없다.
 * 월드 씬만 플레이어 추적 때문에 원점이 중앙이어야 해서 이 함수를 쓴다.
 */
export function fixedToCamera(
  cam: Phaser.Cameras.Scene2D.Camera,
  sx: number,
  sy: number,
): { x: number; y: number } {
  const cx = cam.width * cam.originX
  const cy = cam.height * cam.originY
  return { x: cx + (sx - cx) / cam.zoom, y: cy + (sy - cy) / cam.zoom }
}

/**
 * Phaser `Text` 스타일에 넣을 글리프 해상도.
 *
 * Phaser 는 글자를 별도 캔버스에 그려 텍스처로 올린다. 이 값이 1 이면 CSS 픽셀
 * 크기로 그려진 글리프가 화면에서 확대되어 흐려진다. 배율과 맞춰야 1:1 로 떨어진다.
 */
export function textResolution(): number {
  return renderScale()
}
