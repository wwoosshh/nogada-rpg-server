import type { TransitionDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { arrivalFacing } from './arrivalFacing.js'

const transitions: TransitionDef[] = [
  { fromMap: 'world', fromX: 3, fromY: 0, toMap: '시험숲', toX: 10, toY: 13, facing: 'up' },
  { fromMap: '시험숲', fromX: 10, fromY: 14, toMap: 'world', toX: 3, toY: 1, facing: 'down' },
  { fromMap: 'world', fromX: 0, fromY: 5, toMap: '동굴', toX: 9, toY: 5, facing: null },
]

describe('arrivalFacing', () => {
  // 왜: facing 은 파싱되고, 좋은 메시지로 타입 검사까지 받고, GameData 에
  //     실려 나가는데 **아무도 읽지 않았다.** world (3,0) 에서 북쪽으로 걸어
  //     나가면 시험숲 (10,13) 에 남쪽을 보고 도착했다 — 방금 나온 전환을
  //     정면으로 마주 보면서. 눈에 보이게 틀린 것이고, 채워 넣어도 아무 일도
  //     안 일어나는 열은 작가에게 더 나쁜 결과다.
  it('도착 칸에 적힌 facing 을 그대로 본다', () => {
    expect(arrivalFacing(transitions, '시험숲', { x: 10, y: 13 }, 'down')).toBe('up')
    expect(arrivalFacing(transitions, 'world', { x: 3, y: 1 }, 'up')).toBe('down')
  })

  // 왜: 설계 문서 3.5 가 "없으면 들어온 방향을 그대로 유지한다" 로 못박았다.
  //     빈 칸을 허용한 이유가 그것이라, 여기서 'down' 으로 뭉개면 빈 칸이
  //     "아래를 본다"가 되어 작가는 매 행에 방향을 적어야 한다.
  it('facing 이 비어 있으면 들어온 방향을 그대로 쓴다', () => {
    expect(arrivalFacing(transitions, '동굴', { x: 9, y: 5 }, 'left')).toBe('left')
  })

  // 왜: 새로고침하면 서 있던 칸이 마지막 전환 도착 칸이라 전환이 잡히지만,
  //     그 뒤로 걸어 다녔으면 아무 전환도 안 잡힌다. 그때 예외 없이 들어온
  //     방향(첫 부팅이면 아래)을 쓴다.
  it('그 칸에 도착하는 전환이 없으면 들어온 방향을 그대로 쓴다', () => {
    expect(arrivalFacing(transitions, 'world', { x: 20, y: 20 }, 'right')).toBe('right')
  })

  // 왜: 두 맵이 같은 좌표를 갖는 것은 규칙이 아니라 우연이다. 맵을 안 보면
  //     시험숲 (3,1) 에 선 사람이 world 로 들어온 전환의 방향을 물려받는다.
  it('좌표가 같아도 다른 맵의 전환은 보지 않는다', () => {
    expect(arrivalFacing(transitions, '시험숲', { x: 3, y: 1 }, 'right')).toBe('right')
  })
})
