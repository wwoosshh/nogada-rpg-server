import { describe, expect, it } from 'vitest'
import { padDirection } from './padDirection.js'

/** TouchSource 의 PAD_DEAD_ZONE_RADIUS 와 같은 값. 순수 함수라 여기선 그냥 인자다. */
const DEAD_ZONE = 12

describe('padDirection — 오프셋 하나에서 축 방향 하나', () => {
  it('오른쪽으로 밀면 right', () => {
    expect(padDirection(44, 0, DEAD_ZONE)).toBe('right')
  })

  it('왼쪽으로 밀면 left', () => {
    expect(padDirection(-44, 0, DEAD_ZONE)).toBe('left')
  })

  it('아래로 밀면 down', () => {
    expect(padDirection(0, 44, DEAD_ZONE)).toBe('down')
  })

  it('위로 밀면 up', () => {
    expect(padDirection(0, -44, DEAD_ZONE)).toBe('up')
  })

  it('세로 성분이 조금이라도 더 크면 가로를 이긴다 — 축은 둘 중 하나만 골라야 한다', () => {
    expect(padDirection(30, 31, DEAD_ZONE)).toBe('down')
    expect(padDirection(30, 29, DEAD_ZONE)).toBe('right')
  })
})

describe('padDirection — 데드존', () => {
  it('중심 근처면 방향을 고르지 않는다 — 엄지가 가만히 놓인 것을 한 걸음으로 읽으면 안 된다', () => {
    expect(padDirection(0, 0, DEAD_ZONE)).toBeNull()
    expect(padDirection(5, 5, DEAD_ZONE)).toBeNull() // 거리 ≈7.07
  })

  it('반경에 정확히 닿으면 이미 방향이다 — 경계가 어느 쪽에 속하는지 흔들리면 손끝에서 떨림으로 느껴진다', () => {
    expect(padDirection(DEAD_ZONE, 0, DEAD_ZONE)).toBe('right')
    expect(padDirection(DEAD_ZONE - 0.001, 0, DEAD_ZONE)).toBeNull()
  })

  it('데드존은 오프셋과 같은 좌표계로 잰다 — 반경만 키우면 같은 오프셋이 방향을 잃는다', () => {
    expect(padDirection(20, 0, DEAD_ZONE)).toBe('right')
    expect(padDirection(20, 0, 30)).toBeNull()
  })
})

describe('padDirection — 정확한 대각선', () => {
  it('|dx| 와 |dy| 가 같으면 언제나 세로를 고른다 — 갈림이 결정적이어야 프레임마다 흔들리지 않는다', () => {
    expect(padDirection(40, 40, DEAD_ZONE)).toBe('down')
    expect(padDirection(-40, 40, DEAD_ZONE)).toBe('down')
    expect(padDirection(40, -40, DEAD_ZONE)).toBe('up')
    expect(padDirection(-40, -40, DEAD_ZONE)).toBe('up')
  })
})

/**
 * 기기 픽셀비 2인 화면에서 실제로 잰 값이다.
 *
 * 812×375 CSS / 1624×750 캔버스, 카메라 zoom 2, 패드 중심의 씬 좌표 (90, 273),
 * 패드 표면은 140×140 이라 그 로컬 중심(displayOrigin)은 (70, 70) 이다.
 *
 * `local` 은 Phaser 가 pointerdown 콜백의 2·3번째 인자로 넘겨주는 값 —
 * 카메라 zoom 을 이미 되돌린 패드 로컬 좌표다. `canvasPointer` 는 같은 순간의
 * `pointer.x`/`pointer.y` 로, 캔버스 백킹스토어 픽셀이다. 예전 코드는 뒤엣것을
 * 씬 좌표인 `shape.x`/`shape.y` 와 빼서 오프셋을 만들었다 — 그것이 이 버그다.
 */
const PAD_LOCAL_CENTER = { x: 70, y: 70 } as const
const PAD_SCENE_CENTER = { x: 90, y: 273 } as const
const DPR2_PRESSES = [
  { arrow: '◀', local: { x: 26, y: 70 }, canvasPointer: { x: 92, y: 546 }, expected: 'left' },
  { arrow: '▲', local: { x: 70, y: 26 }, canvasPointer: { x: 180, y: 458 }, expected: 'up' },
  { arrow: '▶', local: { x: 114, y: 70 }, canvasPointer: { x: 268, y: 546 }, expected: 'right' },
] as const

describe('padDirection — 기기 해상도로 그리는 캔버스에서의 회귀', () => {
  for (const press of DPR2_PRESSES) {
    it(`픽셀비 2 화면에서 ${press.arrow} 를 누르면 ${press.expected} — 로컬 좌표끼리 빼면 배율이 사라진다`, () => {
      const offsetX = press.local.x - PAD_LOCAL_CENTER.x
      const offsetY = press.local.y - PAD_LOCAL_CENTER.y

      expect(padDirection(offsetX, offsetY, DEAD_ZONE)).toBe(press.expected)
    })
  }

  it('캔버스 픽셀과 씬 좌표를 섞으면 어느 화살표를 눌러도 down 이 된다 — 버그가 어떤 모습이었는지 못 박아 둔다', () => {
    for (const press of DPR2_PRESSES) {
      const mixedX = press.canvasPointer.x - PAD_SCENE_CENTER.x
      const mixedY = press.canvasPointer.y - PAD_SCENE_CENTER.y

      expect(padDirection(mixedX, mixedY, DEAD_ZONE)).toBe('down')
    }
  })
})
