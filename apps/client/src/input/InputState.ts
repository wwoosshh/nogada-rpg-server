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
    this.current.dir = dir
  }

  setButton(button: InputButton, down: boolean): void {
    const was = this.held[button]
    this.held[button] = down
    const justPressed = down && !was

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
