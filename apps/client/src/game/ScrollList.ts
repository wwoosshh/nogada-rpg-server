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
    // pointerdown 만 hitZone 에 붙인다 — 드래그는 그 좁은 사각형 안에서
    // 시작해야 하지만, 일단 시작하면 그 밖까지 이어져야 한다. move/up 을
    // 씬 전체에 붙이는 이유는 handlePointerDown 문서 참고.
    this.hitZone.on('pointerdown', this.handlePointerDown, this)
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

  /**
   * 줄(Text 오브젝트)을 지금 당장 놓아준다. setLines() 도 다음 내용을 그리기
   * 전에 기존 줄을 지우지만, 메뉴가 닫힌 채로 있는 동안까지(다음에 열리거나
   * 씬이 통째로 사라질 때까지) 그 오브젝트들을 붙잡아 둘 이유가 없다 —
   * PanelScene.render() 가 메뉴를 닫을 때 이것을 부른다.
   *
   * 드래그 추적 상태도 함께 지운다(endDrag()). 그렇지 않으면: 리스트가 보이는
   * 동안 드래그가 시작되고(scene.input 에 move/up 리스너가 붙고) 손을 떼기
   * 전에 메뉴가 닫히면, 그 사이의 pointerup 은 handlePointerUp 의 visible
   * 가드에 막혀 무시되고 dragPointerId 도 scene.input 의 리스너도 지워지지
   * 않은 채 남는다. 마우스는 항상 id 1 이므로, 다음에 메뉴를 열었을 때
   * 버튼을 누르지 않고 그 위를 지나가기만 해도(hover 로 오는 pointermove 도
   * 같은 id 1) 남아있던 값과 우연히 일치해 리스트가 저 혼자 스크롤될 수
   * 있다 — 게다가 리스너가 중복으로 남아 있으면 다음 드래그의 pointermove
   * 가 두 번 계산된다. endDrag() 가 이 경로를 전부 끊는다.
   */
  clear(): void {
    for (const row of this.rows) row.destroy()
    this.rows = []
    this.contentHeight = 0
    this.scrollY = 0
    this.endDrag()
  }

  destroy(): void {
    this.hitZone.off('pointerdown', this.handlePointerDown, this)
    this.scene.input.off('wheel', this.handleWheel, this)
    this.clear()
    this.container.destroy()
    this.maskShape.destroy()
    this.hitZone.destroy()
  }

  // 세 핸들러(down/move/up) 모두 컨테이너가 안 보이면 아무 일도 하지 않는다.
  // hitZone 자체는 container.visible 과 무관하게 항상 그 자리에서 입력을
  // 받는다(별도 오브젝트라 setVisible(false) 의 영향을 안 받는다) — 그래서
  // 이 가드가 없으면 메뉴가 닫힌 뒤에도 숨은 리스트의 스크롤 위치가 계속
  // 바뀔 수 있다(clear() 의 endDrag() 가 리스너를 실제로 떼어내는 쪽을
  // 맡고, 이 가드들은 떼어내기 전 그 사이에 일어나는 계산 자체를 막는
  // 두 번째 방어선이다).
  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.container.visible) return
    this.dragPointerId = pointer.id
    this.dragStartY = pointer.y
    this.dragStartScroll = this.scrollY
    // move/up 은 hitZone 이 아니라 씬 전체(scene.input)에 붙인다. hitZone 은
    // 뷰포트만큼만 크고(가로 화면이라 세로로 좁다 — PanelScene 의
    // MENU_BOTTOM_RESERVE 주석 참고) 자연스러운 스와이프는 손가락이 시작
    // 지점보다 한참 아래로 내려가 그 좁은 띠를 쉽게 벗어난다. 예전에는
    // pointerout 이 그 순간 드래그를 끊어 긴 스와이프가 여러 번의 짧은
    // 드래그로 조각났다 — 지금은 pointerout 자체를 쓰지 않는다.
    // off 를 먼저 부르는 것은 이미 붙어 있어도 중복 등록하지 않기 위해서다
    // (예: 드래그 도중 다른 손가락의 pointerdown 이 또 오는 경우) — 안
    // 그러면 다음 pointermove 가 두 번 계산된다.
    this.scene.input.off('pointermove', this.handlePointerMove, this)
    this.scene.input.off('pointerup', this.handlePointerUp, this)
    this.scene.input.on('pointermove', this.handlePointerMove, this)
    this.scene.input.on('pointerup', this.handlePointerUp, this)
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.container.visible) return
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
    if (!this.container.visible) return
    if (this.dragPointerId !== pointer.id) return
    this.endDrag()
  }

  /** 드래그를 끝낸다 — id 를 지우고 scene.input 에 붙였던 move/up 리스너를 뗀다. */
  private endDrag(): void {
    this.dragPointerId = null
    this.scene.input.off('pointermove', this.handlePointerMove, this)
    this.scene.input.off('pointerup', this.handlePointerUp, this)
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
