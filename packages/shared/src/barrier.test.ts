import { describe, expect, it } from 'vitest'
import { barrierSeparates, type BarrierRegions } from './barrier.js'

/**
 * 결계 하나가 있는 세계. 얼음 채집장 (5,4) 에서 (5,2) 로 넘는 문 뒤가 안쪽이고,
 * 안쪽 칸은 넷이다 — 실제 출하 데이터의 모양을 줄여 놓은 것이다.
 */
const regions: BarrierRegions = [
  { mapId: '얼음채집장', cells: ['5,2', '3,2', '1,1', '1,2'] },
]

const 안쪽도착칸 = { mapId: '얼음채집장', x: 5, y: 2 }
const 바깥도착칸 = { mapId: '얼음채집장', x: 15, y: 24 }
const 심층노드 = { mapId: '얼음채집장', x: 3, y: 2 }
const 바깥노드 = { mapId: '얼음채집장', x: 9, y: 21 }

describe('barrierSeparates', () => {
  // 왜: 이 아크가 만든 구멍이다. 결계는 맵 안 전환이라 맵 검사에게 안팎이 같은
  //     맵이고, 그것만으로는 벽 바깥에 선 사람이 심층 id 하나로 벽 너머를 캔다.
  it('바깥에 선 사람과 결계 뒤 노드 사이는 갈라져 있다', () => {
    expect(barrierSeparates(regions, 심층노드, 바깥도착칸)).toBe(true)
  })

  // 왜: 결계를 넘은 사람의 저장된 위치는 벽 안쪽 도착 칸이다 — 서버가 통과
  //     여부를 아는 유일한 흔적이고, 그것이 여기서 통과로 읽혀야 한다.
  it('결계를 넘은 사람과 결계 뒤 노드 사이는 갈라져 있지 않다', () => {
    expect(barrierSeparates(regions, 심층노드, 안쪽도착칸)).toBe(false)
  })

  // 왜: 저장된 x·y 는 마지막 전환 도착 칸이라 지금 실제로 서 있는 칸이 아니다.
  //     그래도 답이 맞는 이유는 구역을 바꾸는 유일한 방법이 전환이기 때문인데,
  //     그 사실은 "도착 칸이 아닌 안쪽 칸"으로 물어도 같은 답이 나와야 성립한다.
  it('안쪽 어느 칸에 서 있어도 결계 뒤 노드는 갈라져 있지 않다', () => {
    expect(barrierSeparates(regions, 심층노드, { mapId: '얼음채집장', x: 1, y: 1 })).toBe(false)
  })

  // 왜: 회귀 0 의 정의다. 결계 뒤가 아닌 노드에게는 아무것도 묻지 않으므로,
  //     바깥 노드는 서 있는 자리가 어디든 이 술어를 통과한다 — 안쪽에서 물어도.
  it('결계 뒤가 아닌 노드는 어디에 서 있든 갈라져 있지 않다', () => {
    expect(barrierSeparates(regions, 바깥노드, 바깥도착칸)).toBe(false)
    expect(barrierSeparates(regions, 바깥노드, 안쪽도착칸)).toBe(false)
    expect(barrierSeparates(regions, 바깥노드, { mapId: '눈의마을', x: 1, y: 1 })).toBe(false)
  })

  // 왜: 결계가 없는 맵(개발용 시험장)의 노드는 이 술어가 손대지 않아야 한다.
  //     구역 목록이 비면 세계 전체가 "결계 밖"이고, 그게 아크 이전의 세계다.
  it('결계가 하나도 없으면 아무것도 가르지 않는다', () => {
    expect(barrierSeparates([], 심층노드, 바깥도착칸)).toBe(false)
  })

  // 왜: 같은 좌표라도 맵이 다르면 다른 칸이다. mapId 를 안 보면 개발용 시험장의
  //     (3,2) 에 선 사람이 얼음 결계 안에 있는 것으로 읽힌다.
  it('좌표가 같아도 맵이 다르면 그 구역 안이 아니다', () => {
    expect(barrierSeparates(regions, 심층노드, { mapId: '개발맵', x: 5, y: 2 })).toBe(true)
  })

  // 왜: 옛 세이브의 위치는 벽 칸일 수 있다(resolvePlayerLocation 은 맵과 범위만
  //     본다). 그 사람은 어느 구역에도 없으므로 결계 뒤는 못 캐지만, 바깥 노드는
  //     위 "결계 뒤가 아닌 노드" 규칙에 따라 그대로 캔다 — 벽 칸 하나가 그 맵의
  //     채집 전체를 멈추면 그게 더 나쁜 회귀다.
  it('어느 구역에도 없는 자리에 선 사람은 결계 뒤와 갈라져 있다', () => {
    const 벽칸 = { mapId: '얼음채집장', x: 0, y: 0 }
    expect(barrierSeparates(regions, 심층노드, 벽칸)).toBe(true)
    expect(barrierSeparates(regions, 바깥노드, 벽칸)).toBe(false)
  })
})
