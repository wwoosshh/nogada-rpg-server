import { STEP_MS, type TilePos } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { TileMover } from './TileMover.js'

function walkAnywhere(): (p: TilePos) => boolean {
  return () => true
}

describe('TileMover', () => {
  // 왜: 걸음이 끝나는 것과 다음 걸음이 시작되는 것은 같은 update() 안에서
  //     연달아 일어난다. 그래서 밖에서 "칸이 바뀌었네"를 알아챘을 때는 이미
  //     다음 걸음이 시작된 뒤이고, 그 순간 입력을 잠가도 그 한 걸음은 끝까지
  //     간다. 브라우저에서 실제로 그렇게 보였다 — 전환 칸을 밟고도 한 칸 더
  //     걸어 나간 뒤에 맵이 바뀌었다.
  it('올라선 칸에서 stop 이 오면 방향을 쥐고 있어도 다음 걸음을 잇지 않는다', () => {
    const arrived: TilePos[] = []
    const mover = new TileMover({
      start: { x: 0, y: 0 },
      isWalkable: walkAnywhere(),
      onArrive: (tile) => {
        arrived.push(tile)
        return 'stop'
      },
    })

    mover.update(STEP_MS, 'right') // 첫 걸음 시작
    mover.update(STEP_MS, 'right') // (1,0) 도착

    expect(arrived).toEqual([{ x: 1, y: 0 }])
    expect(mover.tile).toEqual({ x: 1, y: 0 })
    expect(mover.moving).toBe(false)
  })

  // 왜: 위 테스트가 "원래도 안 걷는다"를 확인하는 것으로 조용히 바뀌지 않도록,
  //     막지 않았을 때는 실제로 이어 걷는다는 것을 같은 자리에서 못 박는다.
  it('stop 이 없으면 도착과 동시에 다음 걸음을 잇는다', () => {
    const mover = new TileMover({ start: { x: 0, y: 0 }, isWalkable: walkAnywhere() })

    mover.update(STEP_MS, 'right')
    mover.update(STEP_MS, 'right')

    expect(mover.tile).toEqual({ x: 1, y: 0 })
    expect(mover.moving).toBe(true)
  })

  // 왜: 방향만 바꾼 것은 도착이 아니다. 벽을 보고 방향키를 누르고 있는 동안
  //     도착이 계속 불리면, 전환 칸에 서서 벽을 향해 누르는 것만으로 요청이
  //     프레임마다 날아간다.
  it('벽에 막혀 못 움직이면 도착을 알리지 않는다', () => {
    let count = 0
    const mover = new TileMover({
      start: { x: 0, y: 0 },
      isWalkable: () => false,
      onArrive: () => {
        count += 1
      },
    })

    mover.update(STEP_MS, 'right')
    mover.update(STEP_MS, 'right')

    expect(count).toBe(0)
    expect(mover.tile).toEqual({ x: 0, y: 0 })
  })
})
