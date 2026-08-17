/**
 * ScrollList 의 "어디를 눌렀는가 / 얼마나 끌었는가" 계산.
 *
 * `ScrollList` 의 포인터 핸들러 안에 있던 것을 떼어냈다. 떼어낸 이유는
 * `padDirection` 과 같다 — 이 계산이 실기에서만 드러나는 방식으로 틀렸던
 * 적이 있고, 핸들러 클로저 안에 있는 한 어떤 테스트도 닿을 수 없었다.
 * Phaser 는 테스트 환경에서 import 되지 않으므로(window 도 jsdom 도 없다)
 * 좌표를 만드는 쪽만 Phaser 를 알고, 그 좌표로 무엇을 판단하는지는 전부
 * 여기 있다.
 *
 * **이 파일이 다루는 것은 두 좌표계의 차이다.**
 *
 *  - `pointer.x`/`pointer.y` 는 **캔버스 백킹스토어 픽셀**이다. 이 게임은
 *    캔버스를 기기 해상도로 그리므로(viewport.renderScale) 기기 픽셀비 2인
 *    화면에서 이 값은 CSS 픽셀의 두 배다.
 *  - `viewY`·`scrollY`·그룹 경계는 **씬 좌표**다. UI 씬들은 카메라 zoom 을
 *    renderScale 로 걸어 그 배율을 되돌리므로(각 씬의 `setOrigin(0, 0)
 *    .setZoom(renderScale())`), 이 좌표는 CSS 픽셀 의미를 그대로 갖는다.
 *
 * 둘을 그냥 빼면 배율만큼 어긋난다. 실측(기기 픽셀비 2, 812×420, 제작 패널):
 * 목록 첫 줄인 "구리 주괴" 를 눌렀는데 네 칸 아래의 "철 도끼" 가 눌린 것으로
 * 판정됐고, 정작 "철 도끼" 와 "철 낫" 을 누르면 아무 그룹도 안 잡혔다. 드래그도
 * 같은 이유로 손가락보다 정확히 두 배 빨리 굴렀다.
 *
 * 그래서 **좌표계를 옮기는 일까지 이 파일이 한다.** 옮기는 자리를 호출자에게
 * 남겨 두면 그 자리가 다시 테스트 밖이 되고, 이 버그가 살아남은 이유가 바로
 * 그것이었다.
 */

/**
 * 줄 사이 세로 여백. 폰트 크기와 무관하게 고정값을 쓴다 — 줄마다 폰트 크기가
 * 달라도 리듬이 일정해야 읽기 편하다. `ScrollList.buildRows` 가 이 값으로 줄을
 * 쌓는다.
 *
 * **ScrollList 가 아니라 여기 있는 이유는 이 파일이 Phaser 를 안 부르기 때문이다.**
 * 「첫 화면이 스크롤 없이 들어가는가」를 무는 검사(detailMenuTabs.test.ts)가 이
 * 수를 손으로 다시 적고 있었는데, 그 검사는 node 환경이라 ScrollList 를 import
 * 하면 Phaser 가 `window` 를 찾다가 죽는다. 옮겨 적던 식은 실제 contentHeight
 * 보다 3px 작았다 — buildRows 는 **마지막 줄 뒤에도** 이만큼을 더한다.
 */
export const ROW_GAP = 3

/** 누를 수 있는 한 행이 내용 좌표에서 차지하는 세로 범위(ScrollList.buildRows 가 만든다). */
export interface ScrollGroupBounds {
  id: string
  /** 내용 맨 위(0)에서부터의 씬 좌표 거리. */
  top: number
  bottom: number
}

/**
 * 목록을 그리는 카메라 중 이 계산이 쓰는 부분.
 *
 * `zoom` 하나가 두 좌표계 사이의 배율 전부다 — 이 게임의 UI 씬 카메라는
 * 원점이 (0, 0) 이고 회전이 없어서(ControlScene·PanelScene·DialogueScene 이
 * 전부 `setOrigin(0, 0).setZoom(renderScale())` 로 만든다) `getWorldPoint()`
 * 가 이 한 줄로 줄어든다. 원점을 옮기거나 회전을 거는 카메라가 생기면 그
 * 씬은 이 함수를 쓰면 안 되고 `camera.getWorldPoint()` 를 직접 써야 한다.
 */
export interface ListCamera {
  zoom: number
  scrollY: number
}

/** 목록 창의 지금 상태. 둘 다 씬 좌표다. */
export interface ListView {
  /** 보이는 창의 위쪽 씬 좌표. */
  viewY: number
  /** 목록이 얼마나 내려가 있는가. */
  scrollY: number
}

/**
 * 포인터의 캔버스 픽셀 Y 를 씬 좌표 Y 로 옮긴다.
 *
 * **이 함수가 인자로 카메라를 받는 것이 요점이다.** `ScrollList` 의
 * pointermove·pointerup 핸들러는 개별 오브젝트가 아니라 `scene.input` 에
 * 붙어 있어서(드래그가 좁은 목록 창 밖으로 이어져야 하기 때문 —
 * `handlePointerDown` 문서), 오브젝트 히트 테스트가 주는 `localX`/`localY` 를
 * 쓸 수 없다. 그래서 방향 패드가 쓴 해법(로컬 좌표)은 여기서 쓸 수 없고,
 * 어느 카메라로 되돌릴지를 이 자리에서 골라야 한다.
 *
 * `pointer.worldY` 를 쓰지 않는 이유가 그것이다. 그 값은 포인터를 **마지막으로
 * 히트 테스트한 씬의 카메라** 로 계산된 값이라, 씬이 넷인 이 게임에서는 그때그때
 * 다른 씬의 카메라가 남긴 값일 수 있다 — 특히 WorldScene 의 카메라는 플레이어를
 * 따라 스크롤하고 원점이 화면 중앙이라 전혀 다른 수가 된다. 목록이 자기 위치를
 * 재는 데 "직전에 누가 무엇을 만졌는가" 가 끼어들면 안 된다.
 *
 * 그래서 호출자가 **자기 씬의 카메라**를 명시적으로 넘긴다. 고를 것이 남아
 * 있긴 하지만, 고르는 자리가 한 곳뿐이고 그 한 곳이 곧 이 목록이 사는 씬이다.
 */
export function toSceneY(pointerCanvasY: number, camera: ListCamera): number {
  return camera.scrollY + pointerCanvasY / camera.zoom
}

/**
 * 눌린 지점이 어느 그룹(제작 패널의 레시피 한 칸)인가. 그룹이 없는 자리(순수
 * 표시 줄, 또는 내용 밖)면 null.
 *
 * 인자가 씬 좌표가 아니라 **캔버스 픽셀 그대로**인 것에 주의 — 옮기는 일을
 * 이 함수가 직접 하는 이유는 이 파일 상단 문서에 있다.
 */
export function groupAtPointer(
  groups: readonly ScrollGroupBounds[],
  pointerCanvasY: number,
  camera: ListCamera,
  view: ListView,
): string | null {
  const contentY = toSceneY(pointerCanvasY, camera) - view.viewY + view.scrollY
  for (const g of groups) {
    if (contentY >= g.top && contentY < g.bottom) return g.id
  }
  return null
}

/**
 * 드래그가 지금까지 움직인 거리(씬 좌표). 부호는 손가락이 간 방향 그대로다 —
 * 위로 끌면 음수다.
 *
 * 두 인자 다 캔버스 픽셀이므로 빼고 나서 한 번만 나눠도 되지만, 각각 옮긴 뒤
 * 빼는 편이 "이 값은 씬 좌표다" 를 읽는 사람이 헷갈리지 않는다. 결과는 같다.
 */
export function dragDistance(
  startPointerCanvasY: number,
  pointerCanvasY: number,
  camera: ListCamera,
): number {
  return toSceneY(pointerCanvasY, camera) - toSceneY(startPointerCanvasY, camera)
}

/**
 * 드래그 뒤의 스크롤 값(자르기 전).
 *
 * 손가락이 위로(화면 y 감소) 갈수록 목록은 아래 내용을 보여줘야 하므로
 * (스크롤 값 증가) 부호를 뒤집는다 — 흔한 "내용을 손가락으로 직접 미는"
 * 스크롤 방향이다.
 */
export function scrollAfterDrag(
  startScrollY: number,
  startPointerCanvasY: number,
  pointerCanvasY: number,
  camera: ListCamera,
): number {
  return startScrollY - dragDistance(startPointerCanvasY, pointerCanvasY, camera)
}
