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

  // 왜: 맵을 넘어 도착했을 때 바라볼 방향은 씬이 정한다(전환의 facing, 없으면
  //     들어온 방향). 여기가 언제나 'down' 으로 시작하면 그 계산이 첫
  //     프레임에 곧바로 덮여 아무 효과가 없다 — 실제로 그랬다: 북쪽으로 걸어
  //     나가 도착하면 남쪽을, 즉 방금 나온 전환을 마주 보고 서 있었다.
  it('시작 방향을 받으면 그대로 바라본다', () => {
    const mover = new TileMover({ start: { x: 0, y: 0 }, isWalkable: walkAnywhere(), facing: 'up' })
    expect(mover.facing).toBe('up')
  })

  it('시작 방향을 안 주면 아래를 본다 — 첫 부팅의 기본 자세다', () => {
    expect(new TileMover({ start: { x: 0, y: 0 }, isWalkable: walkAnywhere() }).facing).toBe('down')
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

  // 왜: 결계는 걸음이 끝난 **뒤에** 서버가 거절한다(결계 설계 §9-앞 14). 그 응답이
  //     올 때 플레이어는 이미 결계 칸 위에 서 있고, 되밀지 않으면 "밀려난다"고
  //     적은 설계와 성공 기준이 화면에서 거짓이 된다.
  it('되밀면 방금 걸음이 시작된 칸으로 돌아간다', () => {
    const mover = new TileMover({ start: { x: 0, y: 0 }, isWalkable: walkAnywhere() })

    mover.update(STEP_MS, 'right')
    mover.update(STEP_MS, null) // (1,0) 도착 — 방향을 놓아 다음 걸음은 잇지 않는다
    expect(mover.tile).toEqual({ x: 1, y: 0 })

    mover.stepBack()

    expect(mover.tile).toEqual({ x: 0, y: 0 })
    expect(mover.moving).toBe(false)
    // 밀려난 사람은 자기를 민 것을 그대로 마주 본다 — 방향은 되돌리지 않는다.
    expect(mover.facing).toBe('right')
  })

  // 왜: 되밀림은 지금 이 프레임의 사실이다. 반쯤 진행된 걸음을 남겨 두면 그
  //     걸음이 도착을 한 번 더 알려, 되밀린 사람이 곧바로 한 칸 더 걸어 나간다.
  //     (전환 칸에서는 onArrive 가 'stop' 을 돌려줘 이 상태가 생기지 않지만,
  //     그 계약이 깨지는 날 되밀림이 반쪽이 되는 것은 화면에서만 보인다.)
  it('되밀면 진행 중이던 걸음도 함께 버린다 — 도착은 한 번뿐이다', () => {
    const arrived: TilePos[] = []
    const mover = new TileMover({
      start: { x: 0, y: 0 },
      isWalkable: walkAnywhere(),
      onArrive: (tile) => void arrived.push(tile),
    })

    mover.update(STEP_MS, 'right')
    mover.update(STEP_MS, 'right') // (1,0) 도착 + 다음 걸음 시작
    expect(mover.moving).toBe(true)

    mover.stepBack()
    mover.update(STEP_MS, null)

    expect(mover.moving).toBe(false)
    // 무른 것은 **진행 중이던 그 걸음**이라 그 걸음이 시작된 칸으로 돌아간다.
    expect(mover.tile).toEqual({ x: 1, y: 0 })
    expect(arrived).toEqual([{ x: 1, y: 0 }])
  })
})
