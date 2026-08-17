/**
 * 전면 패널 껍데기가 화면의 **어디를 차지하는가** — Phaser 없는 순수 계산.
 *
 * minimap.ts 의 MINIMAP 과 같은 이유로 여기 있다: **자리를 무는 검사**가 이 수들을
 * 봐야 하고, 그 검사가 Phaser 를 켤 수는 없다. 그리는 것은 PanelScene 이다.
 *
 * **왜 이 파일이 생겼는가.** 미니맵을 눌러 지도를 여는 손이 화면 위쪽에서 통째로
 * 먹혔다 — PanelScene 은 닫혀 있어도 씬의 입력이 살아 있었고, 씬 배열이
 * [World, Hud, Panel, Control, Dialogue] 라 입력 처리 차례가 Panel → Hud 다.
 * Phaser 는 위 씬이 무언가를 잡으면 그 프레임을 통째로 아래 씬에 안 내려보낸다
 * (InputManager 의 `globalTopOnly`). 닫힌 패널이 세계의 한 조각을 먹고 있다는 것
 * 자체는 이 커밋 이전부터의 빚이고, 미니맵이 그 자리에 처음으로 **누를 것**을
 * 놓으면서 표면화했다.
 *
 * 그래서 이 파일이 가진 수들은 「패널이 닫힌 동안 입력을 먹으면 무엇이 죽는가」를
 * 잴 수 있게 하는 것이 목적이다(panelBox.test.ts).
 */

/** 화면 좌표의 사각형 하나 — 왼쪽 위 모서리와 크기. CSS 픽셀이다. */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 패널 카드의 치수 상수 — PanelScene 이 이 값들로 자기 상자를 잡는다.
 *
 * 값의 뜻은 PanelScene 안의 원래 주석 그대로다:
 * - `topMargin` 은 상단 바(약 34px)를 안 침범하려고 잡은 여백이고, DOM 쪽 전면
 *   패널(ui.css 의 `.panel`)도 같은 높이에 카드 윗변을 맞춘다.
 * - `margin` 은 나머지 세 면 — 아래쪽이 안드로이드 제스처 영역과 겹치면 드래그
 *   스크롤을 OS 가 먼저 가로챈다.
 * - `headerHeight` 는 닫기 버튼(48px)이 온전히 들어가는 줄 높이다. 탭도 같은 줄에
 *   놓이고, 탭 라벨은 작아도 손끝으로 누를 칸은 이 줄 전체 높이만큼 크다.
 * - `maxWidth` 는 데스크톱에서 개발용 창을 비정상적으로 넓게 열었을 때 목록 줄이
 *   화면 끝까지 늘어지는 것만 막는 방어값이다(실기 화면은 여기 닿지 않는다).
 */
export const PANEL_BOX = {
  topMargin: 40,
  margin: 16,
  minWidth: 240,
  minHeight: 64,
  maxWidth: 900,
  headerHeight: 48,
} as const

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/**
 * 지금 화면 크기에서 패널 카드가 놓이는 사각형.
 *
 * 위로는 상단 바만, 나머지 세 면은 `margin` 만 남기고 그 사이를 꽉 채운다 —
 * 「화면을 거의 다 쓴다」는 요구가 그대로 이 한 사각형이다.
 */
export function panelBoxRect(viewWidth: number, viewHeight: number): ScreenRect {
  const width = clamp(viewWidth - PANEL_BOX.margin * 2, PANEL_BOX.minWidth, PANEL_BOX.maxWidth)
  const height = Math.max(PANEL_BOX.minHeight, viewHeight - PANEL_BOX.topMargin - PANEL_BOX.margin)
  return { x: (viewWidth - width) / 2, y: PANEL_BOX.topMargin, width, height }
}

/**
 * 카드 안 **헤더 줄** — 탭 칸 셋과 닫기 버튼이 사는 자리.
 *
 * 이 줄을 따로 내주는 이유는 그것이 미니맵과 실제로 겹치는 첫 조각이기 때문이다.
 * 나머지(목록 뷰포트)도 겹치지만, 겹침이 가장 먼저 시작되는 곳이 여기다.
 */
export function panelHeaderRect(viewWidth: number, viewHeight: number): ScreenRect {
  const box = panelBoxRect(viewWidth, viewHeight)
  return { x: box.x, y: box.y, width: box.width, height: Math.min(PANEL_BOX.headerHeight, box.height) }
}

/** 두 사각형이 실제로 겹치는 부분. 안 겹치면 null — 「0×0 이 닿았다」와 구분한다. */
export function overlapOf(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}
