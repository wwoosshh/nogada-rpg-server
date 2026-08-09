import { describe, expect, it } from 'vitest'
import {
  dragDistance,
  groupAtPointer,
  scrollAfterDrag,
  toSceneY,
  type ListCamera,
  type ScrollGroupBounds,
} from './scrollListGeometry.js'

/**
 * 아래 숫자는 전부 실기에서 잰 값이다.
 *
 * 기기 픽셀비 2 화면(812×420 CSS / 1624×840 캔버스), 제작 패널이 열린 상태.
 * 목록 창은 씬 좌표 y=96 에서 시작하고 높이 300 이며, 레시피 여섯 개가
 * 내용 좌표 0..231 에 쌓여 있다.
 *
 * `pointerY` 는 그 자리를 눌렀을 때 Phaser 가 준 `pointer.y` — 캔버스
 * 백킹스토어 픽셀이라 CSS 픽셀의 정확히 두 배다. `sceneY` 는 같은 순간
 * PanelScene 카메라의 `getWorldPoint()` 가 준 값이고, 목록의 viewY·scrollY·
 * 그룹 경계가 사는 좌표계다. 예전 코드는 앞엣것을 뒤엣것과 그대로 빼서
 * 내용 좌표를 만들었다 — 그것이 이 버그다.
 */
const DPR2_CAMERA: ListCamera = { zoom: 2, scrollY: 0 }
const CRAFT_VIEW = { viewY: 96, scrollY: 0 }
const CRAFT_GROUPS: readonly ScrollGroupBounds[] = [
  { id: 'copper_ingot', top: 0, bottom: 51 },
  { id: 'copper_hammer', top: 54, bottom: 87 },
  { id: 'iron_chisel', top: 90, bottom: 123 },
  { id: 'iron_axe', top: 126, bottom: 159 },
  { id: 'iron_pickaxe', top: 162, bottom: 195 },
  { id: 'iron_sickle', top: 198, bottom: 231 },
]

/** 실제로 누른 세 자리: (화면에서 본 줄, 그때의 pointer.y, 그 자리의 씬 좌표 y). */
const CRAFT_PRESSES = [
  { row: '구리 주괴', pointerY: 242, sceneY: 121, expected: 'copper_ingot' },
  { row: '철 도끼', pointerY: 476, sceneY: 238, expected: 'iron_axe' },
  { row: '철 낫', pointerY: 620, sceneY: 310, expected: 'iron_sickle' },
] as const

describe('toSceneY — 캔버스 픽셀과 씬 좌표 사이', () => {
  it('기기 픽셀비 2 화면에서 pointer.y 는 씬 좌표의 두 배다', () => {
    for (const press of CRAFT_PRESSES) {
      expect(toSceneY(press.pointerY, DPR2_CAMERA)).toBe(press.sceneY)
    }
  })

  it('배율 1(기기 픽셀비 1)이면 두 좌표계가 같다 — 데스크톱에서만 보면 버그가 안 보이던 이유다', () => {
    expect(toSceneY(242, { zoom: 1, scrollY: 0 })).toBe(242)
  })

  it('카메라가 스크롤돼 있으면 그만큼 더한다', () => {
    expect(toSceneY(242, { zoom: 2, scrollY: 50 })).toBe(171)
  })
})

describe('groupAtPointer — 누른 자리의 레시피 한 칸', () => {
  for (const press of CRAFT_PRESSES) {
    it(`픽셀비 2 화면에서 "${press.row}" 줄을 누르면 ${press.expected} 가 잡힌다`, () => {
      expect(groupAtPointer(CRAFT_GROUPS, press.pointerY, DPR2_CAMERA, CRAFT_VIEW)).toBe(
        press.expected,
      )
    })
  }

  it('그룹 사이의 틈(ROW_GAP)을 누르면 아무것도 아니다 — 경계가 어느 쪽에 속하는지는 결정적이어야 한다', () => {
    // 내용 좌표 52 → 씬 좌표 148 → pointer.y 296. copper_ingot(…51) 과 copper_hammer(54…) 사이.
    expect(groupAtPointer(CRAFT_GROUPS, 296, DPR2_CAMERA, CRAFT_VIEW)).toBe(null)
    // 경계 자체(top)는 이미 그 그룹이다.
    expect(groupAtPointer(CRAFT_GROUPS, (96 + 54) * 2, DPR2_CAMERA, CRAFT_VIEW)).toBe(
      'copper_hammer',
    )
  })

  it('목록이 내려가 있으면 같은 자리를 눌러도 다른 줄이다 — scrollY 도 씬 좌표다', () => {
    const scrolled = { viewY: 96, scrollY: 126 }
    // 첫 줄 자리를 눌렀지만 내용이 126 만큼 올라와 있으므로 iron_axe 다.
    expect(groupAtPointer(CRAFT_GROUPS, 242, DPR2_CAMERA, scrolled)).toBe('iron_axe')
  })

  it('캔버스 픽셀을 씬 좌표인 척 넣으면 엉뚱한 줄이 잡히거나 아무것도 안 잡힌다 — 버그가 어떤 모습이었는지 못 박아 둔다', () => {
    // 배율 1 인 카메라를 준다 = 옮기지 않고 그대로 쓴다(예전 코드가 하던 짓).
    const noConversion: ListCamera = { zoom: 1, scrollY: 0 }
    expect(groupAtPointer(CRAFT_GROUPS, 242, noConversion, CRAFT_VIEW)).toBe('iron_axe') // 구리 주괴를 눌렀는데 철 도끼
    expect(groupAtPointer(CRAFT_GROUPS, 476, noConversion, CRAFT_VIEW)).toBe(null) // 철 도끼를 눌렀는데 무반응
    expect(groupAtPointer(CRAFT_GROUPS, 620, noConversion, CRAFT_VIEW)).toBe(null) // 철 낫도 무반응
  })
})

/**
 * 이정표 탭에서 잰 값이다(같은 화면, 내용 972 / 창 300 이라 실제로 스크롤된다).
 * 씬 좌표 y=320 을 눌러 y=280 까지, 즉 위로 40 만큼 끌었다 — 목록은 40 만큼
 * 내려가야 한다. 예전에는 80 이 나왔다.
 */
describe('드래그 — 손가락이 간 만큼만 구른다', () => {
  const START_POINTER_Y = 640 // 씬 좌표 320
  const END_POINTER_Y = 560 // 씬 좌표 280

  it('위로 40 끌면 목록은 40 내려간다 — 배율만큼 빨리 구르면 손가락이 목록을 놓친다', () => {
    expect(scrollAfterDrag(0, START_POINTER_Y, END_POINTER_Y, DPR2_CAMERA)).toBe(40)
  })

  it('아래로 끌면 반대로 올라간다', () => {
    expect(scrollAfterDrag(100, START_POINTER_Y, 720, DPR2_CAMERA)).toBe(60)
  })

  it('이미 굴러 있던 자리에서 이어서 끈다', () => {
    expect(scrollAfterDrag(200, START_POINTER_Y, END_POINTER_Y, DPR2_CAMERA)).toBe(240)
  })

  it('움직인 거리도 씬 좌표다 — 누름을 취소하는 임계값(PRESS_CANCEL_DISTANCE)이 이 값과 같은 자로 재야 한다', () => {
    expect(dragDistance(START_POINTER_Y, END_POINTER_Y, DPR2_CAMERA)).toBe(-40)
    // 옮기지 않으면 같은 손가락 움직임이 두 배로 보인다 — 임계값 10 을 절반의
    // 거리에서 이미 넘어, 레시피를 누르고 있으려던 손가락이 스크롤로 새어 나갔다.
    expect(dragDistance(START_POINTER_Y, END_POINTER_Y, { zoom: 1, scrollY: 0 })).toBe(-80)
  })
})
