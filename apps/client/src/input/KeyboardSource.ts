import type { Direction } from '@nogada/shared'
import type { InputButton, InputHub } from './InputState.js'

/**
 * keydown/keyup 에서 이 파일이 읽는 것만 추린 모양. 실제 KeyboardEvent 가
 * 그대로 만족한다. 따로 이름을 둔 이유는 테스트다 — 테스트 환경에는 window 도
 * jsdom 도 없어서(InputState.test.ts 첫 문단) KeyboardEvent 를 만들 수 없고,
 * 대신 이 모양의 맨 객체를 만들어 keyDown()/keyUp() 에 직접 넣는다.
 */
export interface KeyEventLike {
  code: string
  target: unknown
  preventDefault(): void
}

/** window 에서 이 파일이 쓰는 두 함수. 테스트가 가짜를 꽂기 위한 모양이다. */
export interface KeyListenerTarget {
  addEventListener(type: 'keydown' | 'keyup' | 'blur', listener: (e: KeyboardEvent) => void): void
  removeEventListener(
    type: 'keydown' | 'keyup' | 'blur',
    listener: (e: KeyboardEvent) => void,
  ): void
}

/**
 * 이 소스가 다루는 키 전부(event.code). Phaser 시절의
 * addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE,J,ESC,K,I,C') 와 같은 목록이다.
 */
const HANDLED_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'KeyJ',
  'Escape',
  'KeyK',
  'KeyI',
  'KeyC',
])

/**
 * 글자를 받는 요소인가. instanceof HTMLElement 를 쓰지 않는 이유는 테스트
 * 환경에 DOM 이 없어서다 — 모양만 보고, 실제 요소는 이 모양을 만족한다.
 */
function isEditableTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const el = target as { tagName?: unknown; isContentEditable?: unknown }
  if (el.isContentEditable === true) return true
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/**
 * PC 개발용 입력. 실기에는 키보드가 없다.
 *
 * **Phaser 의 키보드 플러그인이 아니라 window 에 직접 keydown/keyup 을 건다.**
 * Phaser 의 Key 매칭은 event.keyCode 로 도는데, 자동화 도구가 만드는 합성
 * 키 이벤트는 keyCode 0 · code "" 로 오는 일이 흔해서 Phaser 안에서 소리
 * 없이 증발한다 — DOM 패널을 열어 두고 ESC 를 눌러도 안 닫히는 "버그"를
 * 몇 시간 추적한 끝에, 실은 도구의 반쪽짜리 이벤트가 원인이었다(처음에는
 * Phaser 의 isOver 게이트를 의심했으나 3.90 소스 확인 결과 키보드 경로에
 * 그런 게이트는 없다). window 에 직접 걸면 무엇이 오는지 우리가 그대로
 * 보고, Phaser 내부 파이프라인이 어떻게 변하든 이 파일은 영향이 없다.
 * 겸사겸사 이전 구현에 없던 두 가지를 얻는다: blur 에 눌림 전부 해제(알트탭
 * 후 유령 걸음 방지), 글자 입력 요소 가드(캐릭터 삭제창에 이름을 치는 동안
 * 캐릭터가 걷지 않게). 이 클래스는 Phaser 를 아예 모른다.
 *
 * 방향키와 WASD 를 둘 다 받는 이유는 개발 중 손이 어디 있든 쓰기 위해서다.
 * 여러 방향키가 동시에 눌리면 하나만 고른다 — 대각선이 없으므로 합칠 수 없다.
 *
 * hub 에는 값이 "바뀔 때만" 쓴다. 매 프레임 무조건 쓰면(바뀌지 않았어도) 다른
 * 소스를 밀어낸다 — 키가 하나도 안 눌린 매 프레임마다 setDir(null) 을 불러서
 * TouchSource 가 이벤트로 쥐어 둔 방향을 바로 다음 프레임에 지워버린다. 실기에는
 * 키보드가 없으니 readDir() 이 항상 null 이라 이 문제가 항상 일어난다 — 개발 중에만
 * 드러나는 게 아니라 터치 입력 자체가 통째로 죽는다. 그래서 "내 마지막 읽음값과
 * 이번 읽음값이 다를 때"만 부른다: 안 눌린 채로 가만있으면 아예 아무것도 안 써서
 * 다른 소스가 쥔 값을 그대로 둔다.
 *
 * **그 대신 이 소스는 절대 다시 말해 주지 않는다.** 키를 누른 채로 가만히 있으면
 * hub 에게 하는 말은 누른 그 한 번이 전부다. 그래서 누가 hub 에서 그 값을 지워
 * 버리면 키는 눌린 채인데 hub 는 영영 false 다 — 실제로 대사창이 열릴 때
 * TouchSource 의 릴리스가 그렇게 지웠고, 대화를 마칠 때마다 쥐고 있던 행동키가
 * 죽었다. 지금은 hub 가 소스별로 몫을 따로 들고 있어(InputHub 클래스 문서) 남의
 * 몫을 지울 수 없다. 즉 이 파일의 "바뀔 때만 쓴다"와 hub 의 "자기 몫만 지운다"는
 * 한 쌍이고, 한쪽만 있으면 반드시 이 버그가 돌아온다.
 */
export class KeyboardSource {
  /** 지금 물리적으로 눌려 있는 키(event.code). Phaser 의 Key 객체를 대신한다. */
  private readonly pressed = new Set<string>()

  private lastDir: Direction | null = null
  private readonly lastButton: Record<InputButton, boolean> = {
    action: false,
    cancel: false,
    bag: false,
    craft: false,
  }

  /**
   * hub 전체가 아니라 이 클래스가 부르는 두 함수만 받는다 — 테스트가 호출을
   * 기록하는 가짜를 꽂아 "바뀔 때만 쓴다"를 확인하기 위해서다. target 의 기본값이
   * window 인 것도 같은 사정이다(KeyListenerTarget 문서).
   */
  constructor(
    private readonly hub: Pick<InputHub, 'setDir' | 'setButton'>,
    private readonly target: KeyListenerTarget = window,
  ) {
    target.addEventListener('keydown', this.keyDown)
    target.addEventListener('keyup', this.keyUp)
    target.addEventListener('blur', this.windowBlur)
  }

  /**
   * window keydown. 화살표 프로퍼티 공개 함수인 이유가 둘 다 여기 있다 —
   * removeEventListener 가 같은 참조를 요구하고, 테스트가 이벤트 모양 객체로
   * 직접 부른다(KeyEventLike 문서).
   */
  readonly keyDown = (e: KeyEventLike): void => {
    if (!HANDLED_CODES.has(e.code)) return
    // 글자를 치는 중이면 게임이 받지 않는다 — 캐릭터 삭제 대화상자
    // (DeleteCharacterDialog)의 이름 입력이 게임 화면 위에 뜨는데, 거기서
    // W 를 치는 것은 걷기가 아니고 I 를 치는 것은 가방 열기가 아니다.
    if (isEditableTarget(e.target)) return
    // Phaser 캡처가 하던 preventDefault 를 이어받는다: 방향키·스페이스가
    // 화면을 스크롤하거나, 마지막에 클릭해 포커스가 남아 있는 DOM 버튼
    // (상단 바 톱니 같은)을 스페이스가 다시 누르는 것을 막는다. 편집 필드
    // 가드 **뒤**여야 한다 — 필드 안에서는 기본 동작(글자가 찍히는 것)이
    // 그대로 일어나야 한다.
    e.preventDefault()
    // 꾹 누르면 브라우저가 repeat keydown 을 계속 보내지만, 이미 있는 값을
    // 다시 넣는 것뿐이라 새 누름으로 보이지 않는다.
    this.pressed.add(e.code)
  }

  /**
   * window keyup. keydown 과 달리 편집 필드 가드가 **없다** — 일부러다.
   * 밖에서 누른 키를 필드 안에서 떼는 일이 있는데(걷던 중 대화상자가 열려
   * 포커스를 가져간 뒤에야 손을 뗀다), 그 keyup 마저 무시하면 그 키는 영영
   * 눌린 채로 남는다. 반대 방향은 안전하다: 필드 안에서 누른 키는 애초에
   * 기록된 적이 없어, 밖에서 떼면 지울 것 없는 delete 로 끝난다.
   */
  readonly keyUp = (e: KeyEventLike): void => {
    this.pressed.delete(e.code)
  }

  /**
   * window blur. 창이 포커스를 잃으면 keyup 은 다른 창으로 가므로, 쥐고 있던
   * 키를 여기서 비우지 않으면 alt-tab 뒤에도 캐릭터가 혼자 걷는다. 예전에는
   * Phaser 가 안에서 해 주던 일이고, Phaser 를 떠났으니 우리 몫이다. hub 에는
   * 여기서 직접 쓰지 않는다 — 다음 update() 가 빈 상태를 읽고 "바뀔 때만
   * 쓴다" 규칙 그대로 알아서 놓는다.
   */
  readonly windowBlur = (): void => {
    this.pressed.clear()
  }

  /**
   * 매 프레임 부른다. WorldScene.update() 가 hub 상태를 읽기 전에는 와야
   * 하지만, hub.beginFrame() 보다는 반드시 앞이어야 한다 — beginFrame() 은
   * 이제 그 update() 의 맨 끝에서 한 번만 불린다(WorldScene.update() 참고).
   * 이 순서가 지켜져야 이번 프레임에 새로 눌린 키가 beginFrame() 에
   * 지워지기 전에 읽힌다.
   */
  update(): void {
    const dir = this.readDir()
    if (dir !== this.lastDir) {
      this.hub.setDir('keyboard', dir)
      this.lastDir = dir
    }

    this.updateButton('action', this.isDown('Space', 'KeyJ'))
    this.updateButton('cancel', this.isDown('Escape', 'KeyK'))
    this.updateButton('bag', this.isDown('KeyI'))
    this.updateButton('craft', this.isDown('KeyC'))
  }

  private updateButton(button: InputButton, down: boolean): void {
    if (down === this.lastButton[button]) return
    this.hub.setButton('keyboard', button, down)
    this.lastButton[button] = down
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.keyDown)
    this.target.removeEventListener('keyup', this.keyUp)
    this.target.removeEventListener('blur', this.windowBlur)
  }

  private isDown(...codes: readonly string[]): boolean {
    return codes.some((code) => this.pressed.has(code))
  }

  /**
   * 눌린 방향 중 하나를 고른다.
   *
   * 위·아래를 동시에 누르면 위가 이긴다. 어느 쪽이 이기든 게임에 차이가 없고,
   * 정하지 않으면 프레임마다 달라져서 캐릭터가 떨린다.
   */
  private readDir(): Direction | null {
    if (this.isDown('ArrowUp', 'KeyW')) return 'up'
    if (this.isDown('ArrowDown', 'KeyS')) return 'down'
    if (this.isDown('ArrowLeft', 'KeyA')) return 'left'
    if (this.isDown('ArrowRight', 'KeyD')) return 'right'
    return null
  }
}
