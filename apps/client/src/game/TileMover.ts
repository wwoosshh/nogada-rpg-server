import { STEP_MS, frontTile, type Direction, type TilePos } from '@nogada/shared'

interface TileMoverOptions {
  start: TilePos
  /** 그 칸에 설 수 있는가. 맵 밖·벽·노드가 모두 여기서 걸러진다. */
  isWalkable: (p: TilePos) => boolean
  /**
   * 한 걸음이 끝나 **새 칸에 올라선 순간** 불린다. `'stop'` 을 돌려주면 방향을
   * 쥐고 있어도 그 자리에서 멈춘다.
   *
   * 방향만 바꾼 프레임에는 불리지 않는다 — 벽을 향해 누르고 있는 것은 도착이
   * 아니다.
   *
   * **왜 밖에서 판단하지 못하고 이 자리가 필요한가:** 걸음이 끝나는 것과 다음
   * 걸음이 시작되는 것은 아래 update() 안에서 연달아 일어난다. 그래서 씬이
   * "칸이 바뀌었네"를 알아챌 때는 이미 다음 걸음이 시작된 뒤이고, 그때 입력을
   * 잠가도 그 한 걸음은 끝까지 간다. 맵 전환에서 그것이 곧 "가장자리를 밟고도
   * 한 칸 더 걸어 나간 뒤에 화면이 바뀐다" 였다.
   */
  onArrive?: (tile: TilePos) => 'stop' | void
  /**
   * 처음 바라보는 방향. 없으면 아래 — 첫 부팅의 기본 자세다.
   *
   * 맵을 넘어 도착했을 때 어느 쪽을 볼지는 씬이 정한다(전환의 facing, 없으면
   * 들어온 방향). 여기가 언제나 'down' 으로 시작하면 그 계산이 첫 프레임에
   * 곧바로 덮여 아무 효과가 없다.
   */
  facing?: Direction
}

/**
 * 타일 단위 걸음.
 *
 * 정본은 `tile` 이고 `pixel` 은 그리기용 보간값이다. 이 순서가 뒤집히면
 * 위치를 서버에 보낼 때 반올림 문제가 생긴다.
 *
 * 걸음 중에는 방향 입력을 받지 않는다. 원작의 `moving?` 게이트와 같다 —
 * 이것이 없으면 걸음이 반쯤 진행된 상태에서 방향이 바뀌어 위치가 타일
 * 격자에서 어긋난다.
 */
export class TileMover {
  private readonly isWalkable: (p: TilePos) => boolean
  private readonly onArrive: ((tile: TilePos) => 'stop' | void) | undefined
  private current: TilePos
  private target: TilePos
  /** 방금 끝낸(또는 진행 중인) 걸음이 시작된 칸. `stepBack()` 이 되밀 자리다. */
  private steppedFrom: TilePos
  private elapsed = 0
  private stepping = false

  facing: Direction

  constructor(opts: TileMoverOptions) {
    this.isWalkable = opts.isWalkable
    this.onArrive = opts.onArrive
    this.current = { ...opts.start }
    this.target = { ...opts.start }
    this.steppedFrom = { ...opts.start }
    this.facing = opts.facing ?? 'down'
  }

  /**
   * 방금 밟은 칸에서 **직전 칸으로 되민다** — 결계가 거절한 걸음을 무르는 자리
   * (결계 설계 §9-앞 14).
   *
   * **왜 이것이 mover 의 일인가:** 전환 판정은 걸음이 끝난 뒤(onArrive) 서버
   * 왕복으로 이뤄지므로, 거절이 돌아왔을 때 플레이어는 이미 그 칸 위에 서
   * 있다. 어디로 되밀지를 씬이 계산하면(바라보는 방향의 반대 칸) 걸음이 시작된
   * 자리를 아는 유일한 주인 밖에서 그 사실을 다시 짓게 되고, 벽 속으로 되밀
   * 값을 넘길 수 있는 문도 함께 열린다. 여기가 아는 칸은 **방금 서 있던 칸**
   * 이므로 걸을 수 있는지 다시 물을 필요도 없다.
   *
   * 진행 중이던 걸음은 함께 버린다 — 남겨 두면 그 걸음이 도착을 한 번 더 알려
   * 되밀린 사람이 같은 결계를 곧바로 다시 밟는다. 바라보는 방향은 되돌리지
   * 않는다: 밀려난 사람은 자기를 민 것을 그대로 마주 보고 선다.
   */
  stepBack(): void {
    this.current = { ...this.steppedFrom }
    this.target = { ...this.steppedFrom }
    this.stepping = false
    this.elapsed = 0
  }

  get tile(): TilePos {
    return { ...this.current }
  }

  get moving(): boolean {
    return this.stepping
  }

  /** 타일 한 칸을 1 로 보는 보간 위치. 씬이 여기에 타일 픽셀 크기를 곱한다. */
  get pixel(): { x: number; y: number } {
    if (!this.stepping) return { x: this.current.x, y: this.current.y }
    const t = Math.min(1, this.elapsed / STEP_MS)
    return {
      x: this.current.x + (this.target.x - this.current.x) * t,
      y: this.current.y + (this.target.y - this.current.y) * t,
    }
  }

  update(deltaMs: number, dir: Direction | null): void {
    if (this.stepping) {
      this.elapsed += deltaMs
      if (this.elapsed < STEP_MS) return

      // 남은 시간을 버리지 않고 다음 걸음으로 넘긴다. 버리면 프레임률이 낮을 때
      // 걸음마다 조금씩 느려져서 실제 이동 속도가 STEP_MS 보다 느려진다.
      const overflow = this.elapsed - STEP_MS
      this.current = { ...this.target }
      this.stepping = false
      this.elapsed = 0
      // 다음 걸음을 잇기 **전에** 알린다. 이은 뒤에 알리면 듣는 쪽은 이미
      // 시작된 걸음을 되돌릴 방법이 없다(onArrive 문서).
      if (this.onArrive?.(this.tile) === 'stop') return
      if (dir) this.tryStep(dir, overflow)
      return
    }

    if (dir) this.tryStep(dir, 0)
  }

  /**
   * 방향을 바꾸고, 갈 수 있으면 한 걸음을 시작한다.
   *
   * 방향 전환과 이동이 분리된 것이 중요하다. 벽이나 노드를 향해 방향키를 누르면
   * 움직이지는 않지만 그쪽을 바라보게 된다 — 노드 앞에 서서 방향을 맞추는
   * 조작이 여기서 나온다. 원작도 그렇다.
   */
  private tryStep(dir: Direction, carryMs: number): void {
    this.facing = dir
    const next = frontTile(this.current, dir)
    if (!this.isWalkable(next)) return

    this.steppedFrom = { ...this.current }
    this.target = next
    this.stepping = true
    this.elapsed = carryMs
  }
}
