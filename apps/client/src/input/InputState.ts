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
 * 입력을 넣는 쪽. 지금은 둘뿐이지만 게임패드가 붙으면 여기 하나 더 는다.
 *
 * hub 가 소스 이름을 아는 이유는 하나다: **한 소스는 자기가 넣은 것만 도로
 * 가져갈 수 있어야 한다.** 이름이 없으면 그 구분을 할 수가 없다.
 */
export type InputSource = 'keyboard' | 'touch'

const SOURCES: readonly InputSource[] = ['keyboard', 'touch']

function noButtons(): Record<InputButton, boolean> {
  return { action: false, cancel: false, bag: false, craft: false }
}

/**
 * 여러 소스의 입력을 하나로 모은다.
 *
 * **소스마다 자기 몫을 따로 들고, 밖에서 읽는 값은 그 몫들에서 파생된다.**
 * 예전에는 소스가 공유 상태를 직접 덮어썼고, 그래서 한 소스가 다른 소스가
 * 넣은 것을 지울 수 있었다 — 실제로 그렇게 됐다: 대사창이 열리면
 * ControlScene.setControllerVisible(false) 가 TouchSource 를 통째로 놓는데
 * (화면의 버튼이 손가락 밑에서 사라지므로 그게 맞다), 그 릴리스가 hub 의
 * `action` 을 false 로 적어 **키보드가 누르고 있던 스페이스바까지** 놓아
 * 버렸다. KeyboardSource 는 자기 값이 바뀔 때만 쓰므로(그 파일 문서 참고)
 * 다시 말해 주지 않아, 키는 눌린 채인데 hub 는 영영 false 였다 — 대화를
 * 마칠 때마다 노가다가 조용히 멈췄다.
 *
 * 그래서 `heldBySource`·`dirBySource` 가 진실이고 `held`·`current` 는 그것을
 * 비추는 값이다. 릴리스는 자기 칸만 비우므로 남의 손가락에 닿지 않는다.
 *
 * 방향은 여전히 "마지막으로 방향을 세운 쪽이 이긴다"다(dirOwner). 달라진 것은
 * 놓을 때뿐이다 — 이긴 쪽이 놓으면 아직 쥐고 있는 다른 소스로 되돌아간다.
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

  /** 소스마다 자기가 지금 쥐고 있다고 말한 것. 이것이 진실이고 held 는 파생값이다. */
  private readonly heldBySource: Record<InputSource, Record<InputButton, boolean>> = {
    keyboard: noButtons(),
    touch: noButtons(),
  }

  /** 소스마다 자기가 지금 가리키고 있는 방향. */
  private readonly dirBySource: Record<InputSource, Direction | null> = {
    keyboard: null,
    touch: null,
  }

  /** 마지막으로 방향을 **세운** 소스. 그 소스가 놓으면 아직 쥐고 있는 쪽으로 넘어간다. */
  private dirOwner: InputSource | null = null

  /** 어느 소스든 하나라도 쥐고 있으면 참. heldBySource 에서 파생된다. */
  private readonly held: Record<InputButton, boolean> = noButtons()

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
   * 그 버튼이 **지금 물리적으로** 눌려 있는가.
   *
   * `state.action` 과 다르다. 그쪽은 setWorldInputLocked() 의 영향을 받아
   * 잠긴 동안 항상 false 지만, held 는 잠금과 무관하게 갱신된다(setButton 의
   * 이른 반환은 held 를 쓴 **뒤에** 온다). 대사창은 자기가 그 잠금을 건
   * 장본인이면서도 "행동키가 지금 눌려 있는가"를 알아야 한다 — 대화가 열린
   * 시점에 눌려 있던 키는 한 번 떼야 먹는다는 규칙(설계 문서 §10) 때문이다.
   *
   * 한 프레임짜리 신호가 아니라 **상태**라서 beginFrame() 이 지우지 않는다.
   * 그래서 프레임 루프 밖(예: talk 응답이 도착한 순간)에서 읽어도 0 이
   * 나오지 않는다 — actionPressed 를 그렇게 읽으면 언제나 false 다.
   */
  isHeld(button: InputButton): boolean {
    return this.held[button]
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

  /**
   * 그 소스가 지금 가리키는 방향을 적는다. `null` 은 "나는 놓았다"이지
   * "아무도 안 누르고 있다"가 아니다 — 그래서 다른 소스가 쥔 방향은 남는다.
   *
   * 잠겨 있어도 소스의 칸은 갱신한다. 세계에 닿지 않게 막는 것은 파생값
   * (`current.dir`)이고, 그건 applyDir() 이 잠금을 보고 정한다. 소스의 칸까지
   * 얼리면 잠긴 사이에 손을 뗀 것을 놓쳐, 풀린 뒤에도 hub 는 아직 쥐고
   * 있다고 믿는다.
   */
  setDir(source: InputSource, dir: Direction | null): void {
    this.dirBySource[source] = dir
    if (dir !== null) {
      this.dirOwner = source
    } else if (this.dirOwner === source) {
      // 이기고 있던 쪽이 놓았다 — 아직 쥐고 있는 다른 소스가 있으면 그쪽으로.
      this.dirOwner = SOURCES.find((s) => this.dirBySource[s] !== null) ?? null
    }
    this.applyDir()
  }

  setButton(source: InputSource, button: InputButton, down: boolean): void {
    this.heldBySource[source][button] = down

    const was = this.held[button]
    // 한 소스가 놓아도 다른 소스가 아직 쥐고 있으면 여전히 눌린 상태다.
    const now = SOURCES.some((s) => this.heldBySource[s][button])
    this.held[button] = now
    const justPressed = now && !was

    // action 만 잠금의 영향을 받는다. held 갱신은 이미 끝났으므로, 잠겨 있는
    // 동안 눌렸다 떼진 손가락도 held 에는 정확히 반영된다 — 그래야 패널을
    // 닫은 뒤 처음 누르는 A 가 "이미 눌려 있던 것"으로 오인되어 조용히
    // 무시되지 않는다.
    if (this.worldInputLocked && button === 'action') return

    switch (button) {
      case 'action':
        this.current.action = now
        if (justPressed) this.current.actionPressed = true
        break
      case 'cancel':
        this.current.cancel = now
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
   * **잠금은 지우는 것이 아니라 가리는 것이다.** 잠긴 동안 `current.dir` 과
   * `current.action` 은 중립으로 얼어 있지만, 소스가 넣어 둔 값(heldBySource·
   * dirBySource)은 그대로 살아 있다가 잠금이 풀리면 다시 비친다. 한때는 잠글
   * 때 아예 지웠고, 그래서 풀린 뒤에는 새 입력 이벤트가 있어야만 다시 움직였다
   * — 그런데 KeyboardSource 는 값이 바뀔 때만 쓰므로 물리적으로 계속 눌려
   * 있는 키에 대해서는 그 이벤트가 영영 오지 않는다. 대화를 마칠 때마다
   * 쥐고 있던 행동키가 죽고 노가다가 멈춘 것이 이 자리다.
   *
   * 그때 지웠던 진짜 이유는 "쥐고 있던 것이 닫히는 순간 **새로 눌린 입력**처럼
   * 새어 나간다"였고, 그 걱정은 지금도 유효하다 — 그래서 되살리는 것은 눌림
   * **상태**(action·dir)뿐이고 한 프레임짜리 에지 신호(actionPressed)는 아니다.
   * 닫자마자 한 번 채집되는 일은 여전히 없고, 쥐고 있던 손만 이어진다.
   *
   * 터치에서는 애초에 되살아날 것이 없다: 패널이나 대사창이 열리면 컨트롤러가
   * 통째로 숨으면서 TouchSource 가 자기 몫을 진짜로 놓기 때문이다
   * (ControlScene.setControllerVisible). 즉 이 완화가 실제로 달라지게 만드는
   * 것은 키가 물리적으로 계속 눌려 있는 키보드뿐이다.
   */
  setWorldInputLocked(locked: boolean): void {
    if (this.worldInputLocked === locked) return
    this.worldInputLocked = locked
    this.applyDir()
    this.current.action = locked ? false : this.held.action
    if (locked) this.current.actionPressed = false
  }

  /**
   * **그 소스가** 쥐고 있던 입력을 전부 놓는다. 다른 소스의 몫은 건드리지
   * 않는다 — 이 클래스 문서가 설명하는 버그가 정확히 그 자리였다.
   *
   * beginFrame() 까지 부르는 것은 예외다. 한 프레임짜리 에지 신호에는 주인이
   * 적혀 있지 않아 소스별로 나눌 수가 없다. 이 함수를 부르는 상황(창이 포커스를
   * 잃음, 앱이 백그라운드로 감, 컨트롤러가 손가락 밑에서 사라짐)에서는 아직
   * 소비되지 않은 탭이 뒤늦게 발화하지 않는 편이 안전하므로 그대로 둔다.
   */
  releaseAll(source: InputSource): void {
    this.setDir(source, null)
    // 버튼 이름을 여기 따로 다시 적지 않고 그 소스의 칸 키를 그대로 쓴다 —
    // 목록을 두 곳에 두면 InputButton 이 늘어날 때 한쪽만 갱신하기 쉽다.
    for (const button of Object.keys(this.heldBySource[source]) as InputButton[]) {
      this.setButton(source, button, false)
    }
    this.beginFrame()
  }

  /**
   * 소스들이 말한 방향을 하나로 모아 `current.dir` 에 비춘다.
   *
   * 잠겨 있으면 언제나 중립이다. 패드를 쥔 채 패널이 열리면 pointermove 가
   * 프레임마다 새 방향을 들이밀 수 있는데, 여기서 잠금을 보고 정하므로
   * current.dir 은 잠긴 내내 중립으로 얼어 있는다 — 소스의 칸만 조용히
   * 갱신된다.
   */
  private applyDir(): void {
    const owner = this.dirOwner
    this.current.dir = this.worldInputLocked || owner === null ? null : this.dirBySource[owner]
  }
}
