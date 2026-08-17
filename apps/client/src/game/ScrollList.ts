import Phaser from 'phaser'
import { addText } from './gameText.js'
import {
  dragDistance,
  groupAtPointer,
  ROW_GAP,
  scrollAfterDrag,
  type ListCamera,
  type ScrollGroupBounds,
} from './scrollListGeometry.js'

export interface ScrollListLine {
  text: string
  /** 이미 hex 문자열이다(예: '#e8dcc0') — Text 스타일이 그대로 받는 형식과 맞춘다. */
  color: string
  fontSize: number
  /**
   * 이 줄이 속한 누름 그룹. 연속된 줄이 같은 groupId 를 가지면 그 줄들 전체가
   * 하나의 누를 수 있는 "행"이 된다 — 제작 패널의 레시피 한 칸이 이름·재료·
   * 성공률 여러 줄로 이루어지면서도 전체가 하나의 대상이어야 해서 생겼다.
   * null 이거나 생략하면(숙련도·이정표·설정 탭이 그렇다) 이 줄은 누를 수
   * 없다 — 그 세 탭은 순수 표시 전용이라 지금도 아무것도 안 바뀐다.
   */
  groupId?: string | null
}


/**
 * 손가락이 이 거리(px)를 넘게 움직이면 "그룹을 쥐고 있다"를 놓고 순수
 * 스크롤로 확정한다. TouchSource 의 PAD_DEAD_ZONE_RADIUS(12) 와 같은 성격의
 * 여유값이지만 가르는 것은 다르다 — 저건 "가만히 있다 vs 방향을 골랐다"를
 * 가르고, 이건 "레시피를 누르고 있다 vs 목록을 스크롤하기 시작했다"를 가른다.
 */
const PRESS_CANCEL_DISTANCE = 10

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
 *
 * **이 클래스 안의 좌표는 전부 씬 좌표다**(viewX·viewY·viewW·viewH·scrollY·
 * contentHeight·그룹 경계). Phaser 가 핸들러에 주는 `pointer.x`/`pointer.y` 만
 * 캔버스 백킹스토어 픽셀이고, 그 둘을 잇는 계산은 전부 scrollListGeometry 에
 * 있다 — 이 파일에서 두 좌표계가 섞이는 자리를 아예 없애기 위해서다. 한때
 * `pointer.y` 를 씬 좌표인 viewY 와 그대로 뺐고, 기기 픽셀비 2인 화면에서
 * 제작 레시피를 누르면 네 칸 아래가 눌리거나 아무것도 안 눌렸다.
 */
export class ScrollList {
  private readonly container: Phaser.GameObjects.Container
  private readonly maskShape: Phaser.GameObjects.Graphics
  private readonly hitZone: Phaser.GameObjects.Zone
  private rows: Phaser.GameObjects.Text[] = []
  /** buildRows() 가 채운다 — groupId 가 있는 줄들의 세로 범위. 포인터로부터 "어느 그룹을 눌렀는가"를 답하는 데 쓴다(groupAtPointer). */
  private groups: ScrollGroupBounds[] = []

  private viewX = 0
  private viewY = 0
  private viewW = 0
  private viewH = 0
  private contentHeight = 0
  private scrollY = 0

  /** 드래그 중인 포인터의 id. null 이면 아무 손가락도 이 리스트를 쥐고 있지 않다. */
  private dragPointerId: number | null = null
  /**
   * 드래그를 시작한 지점의 **캔버스 픽셀** Y(`pointer.y` 그대로).
   *
   * 씬 좌표로 미리 옮겨 두지 않는다 — 옮기는 일은 scrollListGeometry 가 하고,
   * 여기서는 원본을 그대로 들고 있다가 매번 같은 함수에 넘긴다. 한쪽만 옮겨
   * 둔 채로 다른 쪽과 빼는 것이 정확히 이 버그의 모양이었으므로, 이 클래스
   * 안에 두 좌표계가 섞여 있는 자리를 아예 만들지 않는다.
   */
  private dragStartPointerY = 0
  private dragStartScroll = 0

  /** 지금 손가락이 쥐고 있는 그룹. 드래그 임계값을 넘으면(스크롤로 확정되면) null 로 풀린다. */
  private heldGroupId: string | null = null
  /** 이번 눌림에서 "새로" 눌린 그룹 — 한 번 읽으면(consumeTap) 소비된다. InputState 의 actionPressed 와 같은 에지 신호다. */
  private tappedGroupId: string | null = null

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
   * 줄(Text 오브젝트)과 groups 를 통째로 다시 만든다. setLines·updateLines 가
   * 공유하는 내부 구현이다 — 둘의 차이는 이 함수가 끝난 뒤 스크롤·눌림
   * 상태를 되돌리는지 여부뿐이다(각 문서 참고).
   */
  private buildRows(lines: readonly ScrollListLine[]): void {
    for (const row of this.rows) row.destroy()
    this.rows = []
    this.groups = []

    let y = 0
    let openGroup: ScrollGroupBounds | null = null
    const wrapWidth = Math.max(0, this.viewW - 8)
    for (const line of lines) {
      const text = addText(this.scene, 4, y, line.text, {
        fontSize: `${line.fontSize}px`,
        color: line.color,
        wordWrap: { width: wrapWidth },
      }).setOrigin(0, 0)
      this.container.add(text)
      this.rows.push(text)

      const top = y
      const bottom = y + text.height
      const groupId = line.groupId ?? null
      if (groupId === null) {
        openGroup = null
      } else if (openGroup && openGroup.id === groupId) {
        // 바로 앞 줄과 같은 그룹이 이어진다 — 새 그룹을 만들지 않고 범위만 늘린다.
        openGroup.bottom = bottom
      } else {
        openGroup = { id: groupId, top, bottom }
        this.groups.push(openGroup)
      }

      y = bottom + ROW_GAP
    }

    this.contentHeight = y
  }

  /**
   * 내용을 통째로 다시 그리고 스크롤·눌림 상태를 전부 중립으로 되돌린다.
   *
   * 탭을 바꾸거나 패널을 새로 열 때만 부른다 — "새로 연다"는 선언이라 전부
   * 되돌린다. 메뉴 탭(숙련도·이정표·설정)이 열려 있는 동안은
   * hub.setWorldInputLocked() 가 이동·행동을 막아 플레이어 상태가 바뀔 수
   * 없으므로, 매 프레임 다시 그릴 이유가 없다(PanelScene.rebuildMenuContent
   * 참고). 제작 패널은 다르다 — 그 안에서 제작이라는 행동 자체가 일어나므로
   * 결과가 올 때마다 다시 그려야 하고, 그때는 이 함수가 아니라 updateLines() 를
   * 쓴다(그 문서 참고).
   */
  setLines(lines: readonly ScrollListLine[]): void {
    this.buildRows(lines)
    this.scrollY = 0
    this.heldGroupId = null
    this.tappedGroupId = null
    this.clampScroll()
    this.applyScroll()
  }

  /**
   * 내용을 다시 그리되 스크롤 위치와 눌림 상태는 그대로 둔다.
   *
   * setLines() 와 짝이지만 쓰임이 다르다: 제작 패널은 결과가 올 때마다(성공·
   * 실패 모두) 재료 수·성공률 숫자가 바뀌어 다시 그려야 하는데, 그렇다고
   * 반복 제작 중인 손가락을 스크롤 맨 위로 튕겨내거나(setLines 는 scrollY 를
   * 0 으로 되돌린다) 쥐고 있던 그룹을 놓아버리면(heldGroupId 가 풀리면 반복이
   * 뚝 끊긴다) "누르고 있으면 계속된다"는 계약이 깨진다. clampScroll() 만
   * 다시 부르는 이유는 내용 높이가 줄어들어(레시피가 화면 밖으로 밀려날 만큼)
   * 지금 scrollY 가 더는 유효하지 않을 수 있어서다.
   */
  updateLines(lines: readonly ScrollListLine[]): void {
    this.buildRows(lines)
    this.clampScroll()
    this.applyScroll()
  }

  /**
   * 이 목록을 그리는 카메라. 포인터의 캔버스 픽셀을 씬 좌표로 되돌리는 데 쓴다.
   *
   * **"내 씬의" 카메라라는 것이 요점이다.** move·up 핸들러가 `scene.input` 에
   * 붙어 있어(handlePointerDown 문서) 오브젝트 로컬 좌표를 받을 수 없으므로
   * 어느 카메라로 되돌릴지를 골라야 하는데, `pointer.worldY` 는 포인터를
   * 마지막으로 히트 테스트한 **아무 씬**의 카메라가 남긴 값이라 고를 수 없다
   * (scrollListGeometry.toSceneY 문서). 여기서 한 번만 고른다.
   */
  private get camera(): ListCamera {
    return this.scene.cameras.main
  }

  /** 이번 프레임에 새로 눌린 그룹. 한 번 읽으면 소비된다 — 다음 읽음부터는 새로 눌리기 전까지 null. */
  consumeTap(): string | null {
    const g = this.tappedGroupId
    this.tappedGroupId = null
    return g
  }

  /** 지금 손가락이 쥐고 있는 그룹(스크롤로 확정되지 않은 채 눌려 있는 동안만). */
  heldGroup(): string | null {
    return this.heldGroupId
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
    this.groups = []
    this.contentHeight = 0
    this.scrollY = 0
    this.tappedGroupId = null
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
    this.dragStartPointerY = pointer.y
    this.dragStartScroll = this.scrollY

    // 누른 자리에 그룹(예: 레시피 한 칸)이 있으면 "쥐었다"와 "새로 눌렸다"를
    // 동시에 켠다. 이 시점에는 아직 드래그인지 탭인지 모르지만, 탭은 눌린
    // 순간 바로 한 번 반응해야 자연스럽고(놓을 때까지 기다리면 반응이 늦다)
    // 스크롤로 확정되면 handlePointerMove 가 heldGroupId 만 따로 풀어준다 —
    // tappedGroupId 는 건드리지 않으므로 짧은 탭이 곧바로 스크롤 제스처로
    // 이어져도(예: 탭 직후 약간의 흔들림) 최초 한 번의 시도는 살아남는다.
    const group = groupAtPointer(this.groups, pointer.y, this.camera, {
      viewY: this.viewY,
      scrollY: this.scrollY,
    })
    this.heldGroupId = group
    this.tappedGroupId = group

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

    // 스크롤로 확정되면(임계값을 넘는 이동) 쥐고 있던 그룹을 놓는다 — 한
    // 손가락 제스처가 "레시피를 누르고 있다"와 "목록을 스크롤한다"를 동시에
    // 뜻할 수는 없으므로 하나만 살아남아야 한다. 이미 풀렸으면(null) 매
    // 프레임 다시 계산할 것도 없다. 거리는 PRESS_CANCEL_DISTANCE 와 같은
    // 씬 좌표로 재야 한다 — 예전처럼 캔버스 픽셀로 재면 기기 픽셀비 2인
    // 화면에서 절반의 거리에 이미 임계값을 넘어, 레시피를 누르고 있으려던
    // 손가락이 스크롤로 새어 나갔다.
    if (this.heldGroupId !== null) {
      const moved = dragDistance(this.dragStartPointerY, pointer.y, this.camera)
      if (Math.abs(moved) > PRESS_CANCEL_DISTANCE) this.heldGroupId = null
    }

    this.scrollY = scrollAfterDrag(
      this.dragStartScroll,
      this.dragStartPointerY,
      pointer.y,
      this.camera,
    )
    this.clampScroll()
    this.applyScroll()
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.container.visible) return
    if (this.dragPointerId !== pointer.id) return
    this.endDrag()
  }

  /**
   * 드래그를 끝낸다 — id 를 지우고 scene.input 에 붙였던 move/up 리스너를 뗀다.
   *
   * heldGroupId 도 여기서 놓는다: 손가락을 떼면(정상적인 pointerup) 반복이
   * 멈춰야 한다. tappedGroupId 는 건드리지 않는다 — 그건 "이번 눌림에서 한
   * 번은 시도했는가"를 PanelScene 이 다음 폴링에서 소비할 때까지 남아 있어야
   * 하는 에지 신호라, 아주 짧은 탭(누르자마자 뗌)도 놓치면 안 되기 때문이다.
   */
  private endDrag(): void {
    this.dragPointerId = null
    this.heldGroupId = null
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
