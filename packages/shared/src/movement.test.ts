import { describe, expect, it } from 'vitest'
import { actionIntervalMs } from './formulas/proficiency.js'
import {
  DIRECTIONS,
  REPEAT_UNLOCK_PROFICIENCY,
  STEP_MS,
  canRepeat,
  frontTile,
  isAdjacentFacing,
  samePos,
  stepDelta,
  type Direction,
} from './movement.js'

describe('stepDelta', () => {
  it('네 방향이 서로 다른 한 칸을 가리킨다', () => {
    expect(stepDelta('up')).toEqual({ x: 0, y: -1 })
    expect(stepDelta('down')).toEqual({ x: 0, y: 1 })
    expect(stepDelta('left')).toEqual({ x: -1, y: 0 })
    expect(stepDelta('right')).toEqual({ x: 1, y: 0 })
  })

  it('어떤 방향도 대각선으로 움직이지 않는다', () => {
    // 대각선이 들어오면 앞칸이 하나로 정해지지 않아 상호작용 판정이 무너진다.
    for (const dir of DIRECTIONS) {
      const d = stepDelta(dir)
      expect(Math.abs(d.x) + Math.abs(d.y)).toBe(1)
    }
  })

  it('DIRECTIONS 는 정확히 네 방향이다', () => {
    expect([...DIRECTIONS].sort()).toEqual(['down', 'left', 'right', 'up'])
  })
})

describe('frontTile', () => {
  it('바라보는 방향의 이웃 칸을 준다', () => {
    expect(frontTile({ x: 5, y: 5 }, 'up')).toEqual({ x: 5, y: 4 })
    expect(frontTile({ x: 5, y: 5 }, 'right')).toEqual({ x: 6, y: 5 })
  })

  it('원래 위치를 변형하지 않는다', () => {
    const pos = { x: 5, y: 5 }
    frontTile(pos, 'down')
    expect(pos).toEqual({ x: 5, y: 5 })
  })
})

describe('isAdjacentFacing', () => {
  it('앞칸이면 참이다', () => {
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 2, y: 7 })).toBe(true)
  })

  it('옆에 있어도 다른 곳을 보고 있으면 거짓이다', () => {
    // 원작이 이렇다. 인접만으로는 상호작용이 되지 않는다.
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'up', { x: 2, y: 7 })).toBe(false)
  })

  it('바라보는 방향이라도 두 칸 떨어져 있으면 거짓이다', () => {
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 1, y: 7 })).toBe(false)
  })

  it('같은 칸은 거짓이다', () => {
    // 노드는 단단해서 그 칸에 설 수 없다. 같은 칸이 참이 되면 그 전제가 깨진다.
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 3, y: 7 })).toBe(false)
  })

  it('대각선으로 인접한 칸은 거짓이다', () => {
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 2, y: 6 })).toBe(false)
  })
})

describe('canRepeat', () => {
  it('문턱 미만에서는 반복할 수 없다', () => {
    expect(canRepeat(0)).toBe(false)
    expect(canRepeat(REPEAT_UNLOCK_PROFICIENCY - 1)).toBe(false)
  })

  it('문턱에 닿으면 반복할 수 있다', () => {
    expect(canRepeat(REPEAT_UNLOCK_PROFICIENCY)).toBe(true)
    expect(canRepeat(REPEAT_UNLOCK_PROFICIENCY * 100)).toBe(true)
  })

  it('문턱은 손가락이 병목이 되는 지점이다 — 초당 5회', () => {
    // 이 단정문이 문턱의 의미를 못 박는다. 값만 바꾸고 이 관계를 깨면 여기서 걸린다.
    // 초당 5회를 넘어가면 연타로 따라갈 수 없으므로 그때 해금이 온다.
    expect(actionIntervalMs(REPEAT_UNLOCK_PROFICIENCY)).toBe(200)
  })
})

describe('samePos', () => {
  it('좌표가 같으면 참이다', () => {
    expect(samePos({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
    expect(samePos({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false)
  })
})

describe('STEP_MS', () => {
  it('원작 추정값 200ms 다', () => {
    expect(STEP_MS).toBe(200)
  })
})
