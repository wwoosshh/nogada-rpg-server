import { STEP_MS, frontTile, type Direction, type TilePos } from '@nogada/shared'

interface TileMoverOptions {
  start: TilePos
  /** 그 칸에 설 수 있는가. 맵 밖·벽·노드가 모두 여기서 걸러진다. */
  isWalkable: (p: TilePos) => boolean
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
  private current: TilePos
  private target: TilePos
  private elapsed = 0
  private stepping = false

  facing: Direction = 'down'

  constructor(opts: TileMoverOptions) {
    this.isWalkable = opts.isWalkable
    this.current = { ...opts.start }
    this.target = { ...opts.start }
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

    this.target = next
    this.stepping = true
    this.elapsed = carryMs
  }
}
