import Phaser from 'phaser'

export interface ScrollListLine {
  text: string
  /** 이미 hex 문자열이다(예: '#e8dcc0') — Text 스타일이 그대로 받는 형식과 맞춘다. */
  color: string
  fontSize: number
}

/** 줄 사이 세로 여백. 폰트 크기와 무관하게 고정값을 쓴다 — 줄마다 폰트 크기가 달라도 리듬이 일정해야 읽기 편하다. */
const ROW_GAP = 3

/**
 * 세로로 쌓이는 텍스트 줄을 마스크 + 드래그로 스크롤한다.
 *
 * Phaser 3 에는 스크롤 리스트가 내장돼 있지 않다. 이정표 27개 × 2줄처럼
 * 화면보다 긴 목록을 세로 공간이 좁은 가로 화면에서 보여줘야 해서 직접
 * 만들었다 — PanelScene 의 숙련도·이정표·설정 탭이 전부 이것 하나를 쓴다.
 *
 * 내용이 뷰포트보다 짧은 탭(숙련도·설정)도 그냥 같은 경로를 태운다. 스크롤
 * 범위가 0으로 잘려 자연히 안 움직일 뿐이라, 탭마다 "스크롤이 필요한가"를
 * 따로 판단할 필요가 없다.
 *
 * 포인터 이벤트(pointerdown/move/up)는 마우스와 터치를 Phaser 가 이미
 * 하나로 합쳐 준다 — TouchSource 의 문서와 같은 이유로, 이 클래스는 장치를
 * 구분하지 않는다.
 */
export class ScrollList {
  private readonly container: Phaser.GameObjects.Container
  private readonly maskShape: Phaser.GameObjects.Graphics
  private readonly hitZone: Phaser.GameObjects.Zone
  private rows: Phaser.GameObjects.Text[] = []

  private viewX = 0
  private viewY = 0
  private viewW = 0
  private viewH = 0
  private contentHeight = 0
  private scrollY = 0

  /** 드래그 중인 포인터의 id. null 이면 아무 손가락도 이 리스트를 쥐고 있지 않다. */
  private dragPointerId: number | null = null
  private dragStartY = 0
  private dragStartScroll = 0

  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container(0, 0)
    this.maskShape = scene.make.graphics({}, false)
    this.container.setMask(this.maskShape.createGeometryMask())

    // origin (0,0) + x,y 를 좌상단으로 고정한다. Zone 은 히트 영역이 곧
    // width/height 그 자체라(ControlScene.setCircularHitArea 문서가 설명하는
    // Arc 의 원-vs-사각 어긋남이 여기선 아예 발생하지 않는다), 별도 보정 없이
    // setViewport 가 준 사각형과 정확히 겹친다.
    //
    // setInteractive() 를 인자 없이 부르지 않고 Rectangle 을 직접 준다 — 크기
    // 0인 Zone 에 인자 없이 호출하면(생성 시점엔 실제 뷰포트 크기를 아직 모른다)
    // Phaser 가 아예 input 을 붙이지 않는 경우가 있었다(실측: gameObject.input
    // 이 계속 undefined). 명시적 Rectangle 은 이 문제와 무관하게 항상 붙고,
    // setViewport() 가 매번 이 Rectangle 자체의 크기를 직접 갱신한다 — Zone 의
    // width/height 를 바꾸는 setSize() 는 이미 붙은 히트 영역 도형을 자동으로
    // 따라가지 않기 때문이다(같은 이유로 아래도 처리한다).
    this.hitZone = scene.add
      .zone(0, 0, 0, 0)
      .setOrigin(0, 0)
      .setInteractive(new Phaser.Geom.Rectangle(0, 0, 0, 0), Phaser.Geom.Rectangle.Contains)
    this.hitZone.on('pointerdown', this.handlePointerDown, this)
    this.hitZone.on('pointermove', this.handlePointerMove, this)
    this.hitZone.on('pointerup', this.handlePointerUp, this)
    this.hitZone.on('pointerout', this.handlePointerUp, this)
    // 휠은 데스크톱 개발 편의용이다 — 실기는 터치뿐이라 드래그가 진짜 경로다.
    scene.input.on('wheel', this.handleWheel, this)
  }

  /** 보이는 창을 화면 좌표로 잡는다. 리사이즈마다 다시 부른다. */
  setViewport(x: number, y: number, w: number, h: number): void {
    this.viewX = x
    this.viewY = y
    this.viewW = w
    this.viewH = h
    this.hitZone.setPosition(x, y).setSize(w, h)
    // Zone 의 setInteractive() 는 그 순간의 width/height 로 히트 영역을
    // 스냅샷한다(ControlScene.setCircularHitArea 문서가 설명하는 것과 같은
    // Phaser 동작 — texture 없는 도형은 setInteractive() 호출 시점의
    // Rectangle(0,0,width,height) 를 그대로 굳힌다) — 이후 setSize() 는 그
    // 스냅샷을 자동으로 따라가지 않는다. 생성 시점에는 아직 실제 크기를
    // 몰라 (0,0,0,0) 으로 만들 수밖에 없으므로, 리사이즈마다 히트 영역
    // 사각형 자체를 직접 갱신해야 한다.
    const hitArea = this.hitZone.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hitArea?.setTo(0, 0, w, h)
    this.maskShape.clear().fillStyle(0xffffff).fillRect(x, y, w, h)
    this.clampScroll()
    this.applyScroll()
  }

  /**
   * 내용을 통째로 다시 그리고 스크롤을 맨 위로 되돌린다.
   *
   * 탭을 바꾸거나 메뉴를 새로 열 때만 부른다 — 메뉴가 열려 있는 동안은
   * hub.setWorldInputLocked() 가 이동·행동을 막아 플레이어 상태가 바뀔 수
   * 없으므로, 매 프레임 다시 그릴 이유가 없다(PanelScene.renderMenu 참고).
   */
  setLines(lines: readonly ScrollListLine[]): void {
    for (const row of this.rows) row.destroy()
    this.rows = []

    let y = 0
    const wrapWidth = Math.max(0, this.viewW - 8)
    for (const line of lines) {
      const text = this.scene.add
        .text(4, y, line.text, {
          fontSize: `${line.fontSize}px`,
          color: line.color,
          wordWrap: { width: wrapWidth },
        })
        .setOrigin(0, 0)
      this.container.add(text)
      this.rows.push(text)
      y += text.height + ROW_GAP
    }

    this.contentHeight = y
    this.scrollY = 0
    this.clampScroll()
    this.applyScroll()
  }

  setVisible(visible: boolean): void {
    this.container.setVisible(visible)
  }

  destroy(): void {
    this.hitZone.off('pointerdown', this.handlePointerDown, this)
    this.hitZone.off('pointermove', this.handlePointerMove, this)
    this.hitZone.off('pointerup', this.handlePointerUp, this)
    this.hitZone.off('pointerout', this.handlePointerUp, this)
    this.scene.input.off('wheel', this.handleWheel, this)
    for (const row of this.rows) row.destroy()
    this.container.destroy()
    this.maskShape.destroy()
    this.hitZone.destroy()
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.container.visible) return
    this.dragPointerId = pointer.id
    this.dragStartY = pointer.y
    this.dragStartScroll = this.scrollY
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.dragPointerId !== pointer.id) return
    // 손가락이 위로(화면 y 감소) 갈수록 목록은 아래 내용을 보여줘야
    // 하므로(스크롤 값 증가) 부호를 뒤집는다 — 흔한 "내용을 손가락으로
    // 직접 미는" 스크롤 방향이다.
    const dy = pointer.y - this.dragStartY
    this.scrollY = this.dragStartScroll - dy
    this.clampScroll()
    this.applyScroll()
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (this.dragPointerId !== pointer.id) return
    this.dragPointerId = null
  }

  private handleWheel(
    _pointer: Phaser.Input.Pointer,
    over: Phaser.GameObjects.GameObject[],
    _deltaX: number,
    deltaY: number,
  ): void {
    if (!this.container.visible) return
    if (!over.includes(this.hitZone)) return
    this.scrollY += deltaY
    this.clampScroll()
    this.applyScroll()
  }

  private clampScroll(): void {
    const max = Math.max(0, this.contentHeight - this.viewH)
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, max)
  }

  private applyScroll(): void {
    this.container.setPosition(this.viewX, this.viewY - this.scrollY)
  }
}
