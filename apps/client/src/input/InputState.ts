import type { Direction } from '@nogada/shared'

/**
 * 장치를 모르는 입력 상태.
 *
 * 게임 로직은 키보드인지 터치인지 게임패드인지 묻지 않는다. 그래서 나중에
 * 게임패드를 붙일 때 이 파일 아래쪽만 늘어나고 게임 쪽은 그대로다.
 *
 * `*Pressed` 는 "이번 프레임에 새로 눌렸는가" 다. 누르고 있는 상태(`action`)와
 * 구분하는 이유는, 기본 채집이 누를 때마다 한 번이고 자동 반복만 누르고 있는
 * 것을 보기 때문이다.
 */
export interface InputState {
  dir: Direction | null
  action: boolean
  actionPressed: boolean
  cancel: boolean
  cancelPressed: boolean
  toggleBagPressed: boolean
  toggleCraftPressed: boolean
}

export type InputButton = 'action' | 'cancel' | 'bag' | 'craft'

/**
 * 여러 소스의 입력을 하나로 모은다.
 *
 * 두 소스가 동시에 말하면 마지막으로 바뀐 쪽이 이긴다. 병합 규칙을 복잡하게
 * 만들지 않는 이유는 실기에 키보드가 없고 PC 에 터치가 없어서, 두 소스가
 * 진짜로 경쟁하는 상황이 개발 중 실수 말고는 없기 때문이다.
 */
export class InputHub {
  private readonly current: InputState = {
    dir: null,
    action: false,
    actionPressed: false,
    cancel: false,
    cancelPressed: false,
    toggleBagPressed: false,
    toggleCraftPressed: false,
  }

  private readonly held: Record<InputButton, boolean> = {
    action: false,
    cancel: false,
    bag: false,
    craft: false,
  }

  /**
   * 패널이 열려 있는 동안 참이다. dir 과 action 만 이 값의 영향을 받는다 —
   * cancel·bag·craft 까지 막으면 패널을 닫거나 바꿀 방법이 없어진다.
   * setWorldInputLocked() 의 문서를 참고.
   */
  private worldInputLocked = false

  get state(): Readonly<InputState> {
    return this.current
  }

  /**
   * 프레임 시작. 한 프레임짜리 신호를 지운다.
   *
   * 게임의 update() 맨 앞에서 부른다. 여기서 지우지 않으면 한 번 누른 것이
   * 여러 프레임 동안 참으로 읽혀 한 번의 누름이 여러 번의 행동이 된다.
   */
  beginFrame(): void {
    this.current.actionPressed = false
    this.current.cancelPressed = false
    this.current.toggleBagPressed = false
    this.current.toggleCraftPressed = false
  }

  setDir(dir: Direction | null): void {
    // 잠겨 있으면 방향을 아예 받지 않는다. 패드를 쥔 채 패널이 열리면
    // pointermove 가 프레임마다 새 방향을 들이밀 수 있으므로, current.dir 이
    // 잠긴 내내 중립으로 얼어 있어야 한다 — 한 번만 지우고 말면, 그 뒤로도
    // 계속 오는 pointermove 가 다시 방향을 채워 넣어 패널이 열려 있는데도
    // 캐릭터가 움직인다.
    if (this.worldInputLocked) return
    this.current.dir = dir
  }

  setButton(button: InputButton, down: boolean): void {
    const was = this.held[button]
    this.held[button] = down
    const justPressed = down && !was

    // action 만 잠금의 영향을 받는다. held 갱신은 이미 끝났으므로, 잠겨 있는
    // 동안 눌렸다 떼진 손가락도 held 에는 정확히 반영된다 — 그래야 패널을
    // 닫은 뒤 처음 누르는 A 가 "이미 눌려 있던 것"으로 오인되어 조용히
    // 무시되지 않는다.
    if (this.worldInputLocked && button === 'action') return

    switch (button) {
      case 'action':
        this.current.action = down
        if (justPressed) this.current.actionPressed = true
        break
      case 'cancel':
        this.current.cancel = down
        if (justPressed) this.current.cancelPressed = true
        break
      case 'bag':
        if (justPressed) this.current.toggleBagPressed = true
        break
      case 'craft':
        if (justPressed) this.current.toggleCraftPressed = true
        break
      default: {
        // InputButton 에 새 멤버가 추가되는데 위 case 들이 못 따라가면 여기서
        // 컴파일이 깨진다 — button 이 never 로 좁혀지지 않기 때문이다.
        const exhaustive: never = button
        throw new Error(`처리하지 않은 버튼: ${String(exhaustive)}`)
      }
    }
  }

  /**
   * 이동(dir)과 행동(action)을 켜고 잠근다. cancel·bag·craft 는 건드리지
   * 않는다 — 패널을 닫거나 바꾸는 유일한 통로라서, 그것들까지 막으면 패널을
   * 다시 열 방법이 없어진다.
   *
   * 이 판단을 WorldScene 이 아니라 여기서 하는 이유: 지금은 이동·행동을
   * 읽는 코드가 WorldScene 뿐이지만, 나중에 새로 생기는 어떤 코드도 "패널이
   * 열렸는가"를 따로 검사해야 한다면 그 검사를 잊을 수 있다 — 이 작업이
   * 고치는 버그(버튼은 다 연결됐는데 아무도 안 읽음)와 같은 모양이다. 여기
   * hub 에서 한 번만 막으면, hub.state 를 읽는 코드는 어디서 생기든 저절로
   * 안전하다. 그 대가로 hub 는 "패널"이라는 개념까지는 몰라도 "지금 세계에
   * 영향을 주는 입력을 막아야 하는가"는 알게 된다.
   *
   * 잠글 때 현재 상태를 중립으로 되돌리는 이유: 패널이 열리기 전부터 쥐고
   * 있던 방향/행동을 그대로 얼리면, 패널이 닫히는 순간 그 값이 "방금 새로
   * 눌린 입력"처럼 그대로 새어 나간다(예: 누른 채로 패널을 열고 쥔 채로
   * 닫으면 닫자마자 한 걸음 걷거나 채집한다). 중립으로 되돌린 뒤 setDir·
   * setButton 을 잠그면, 닫힌 뒤에는 반드시 새 입력 이벤트가 있어야만
   * 다시 움직인다 — 쥐고 있던 것을 그대로 이어받지 않는다.
   */
  setWorldInputLocked(locked: boolean): void {
    if (this.worldInputLocked === locked) return
    this.worldInputLocked = locked
    if (!locked) return
    this.current.dir = null
    this.current.action = false
    this.current.actionPressed = false
  }

  /** 모든 입력을 놓은 상태로 되돌린다. 패널이 열릴 때처럼 입력을 끊어야 할 때 쓴다. */
  releaseAll(): void {
    this.setDir(null)
    // 버튼 이름을 여기 따로 다시 적지 않고 held 의 키를 그대로 쓴다 — 목록을
    // 두 곳에 두면 InputButton 이 늘어날 때 한쪽만 갱신하기 쉽다.
    for (const button of Object.keys(this.held) as InputButton[]) {
      this.setButton(button, false)
    }
    this.beginFrame()
  }
}
