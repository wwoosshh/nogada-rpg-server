import { describe, expect, it } from 'vitest'
import { facingToward } from './speakerFacing.js'

describe('facingToward', () => {
  it('바로 앞칸의 상대를 정면으로 본다', () => {
    // 말을 거는 순간이 정확히 이 경우다 — 앞칸 판정 덕에 플레이어는 반드시
    // 인접해 있으므로, 실제로 쓰이는 입력은 네 방향의 이 넷뿐이다.
    const npc = { x: 5, y: 5 }
    expect(facingToward(npc, { x: 5, y: 4 })).toBe('up')
    expect(facingToward(npc, { x: 5, y: 6 })).toBe('down')
    expect(facingToward(npc, { x: 4, y: 5 })).toBe('left')
    expect(facingToward(npc, { x: 6, y: 5 })).toBe('right')
  })

  it('멀리 있어도 더 크게 벌어진 축을 택한다', () => {
    // 일과표가 화자를 옮기기 시작하면 "저쪽에 있는 것을 본다"가 필요해진다.
    // 지금 쓰이지 않아도 규칙이 정해져 있어야, 그때 이 함수를 다시 짜면서
    // 말 걸 때의 방향까지 같이 바뀌는 일이 없다.
    expect(facingToward({ x: 0, y: 0 }, { x: 1, y: 5 })).toBe('down')
    expect(facingToward({ x: 0, y: 0 }, { x: -5, y: 1 })).toBe('left')
  })

  it('정확히 대각선이면 가로를 택한다', () => {
    // 넷뿐인 방향으로는 대각선을 표현할 수 없어 둘 중 하나를 골라야 한다.
    // 가로인 이유는 화면이 가로로 넓어서다 — 옆으로 도는 편이 덜 어색하다.
    expect(facingToward({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe('right')
    expect(facingToward({ x: 0, y: 0 }, { x: -3, y: -3 })).toBe('left')
  })

  it('같은 칸이면 볼 방향이 없다', () => {
    // null 을 돌려주는 것이 중요하다. 아무 방향이나 (예: down) 돌려주면
    // 부르는 쪽은 "돌 곳이 없다"와 "아래를 보라"를 구별할 수 없어, 겹친 순간에
    // 화자가 이유 없이 몸을 돌린다.
    expect(facingToward({ x: 2, y: 3 }, { x: 2, y: 3 })).toBeNull()
  })
})
