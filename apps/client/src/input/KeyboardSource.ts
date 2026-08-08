import type Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputButton, InputHub } from './InputState.js'

/**
 * PC 개발용 입력. 실기에는 키보드가 없다.
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
 */
export class KeyboardSource {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>

  private lastDir: Direction | null = null
  private readonly lastButton: Record<InputButton, boolean> = {
    action: false,
    cancel: false,
    bag: false,
    craft: false,
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hub: InputHub,
  ) {
    const kb = scene.input.keyboard
    if (!kb) throw new Error('키보드 입력을 쓸 수 없다')

    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE,J,ESC,K,I,C') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >
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
      this.hub.setDir(dir)
      this.lastDir = dir
    }

    this.updateButton('action', this.down('SPACE') || this.down('J'))
    this.updateButton('cancel', this.down('ESC') || this.down('K'))
    this.updateButton('bag', this.down('I'))
    this.updateButton('craft', this.down('C'))
  }

  private updateButton(button: InputButton, down: boolean): void {
    if (down === this.lastButton[button]) return
    this.hub.setButton(button, down)
    this.lastButton[button] = down
  }

  destroy(): void {
    for (const key of Object.values(this.keys)) {
      this.scene.input.keyboard?.removeKey(key)
    }
  }

  private down(name: string): boolean {
    return this.keys[name]?.isDown ?? false
  }

  /**
   * 눌린 방향 중 하나를 고른다.
   *
   * 위·아래를 동시에 누르면 위가 이긴다. 어느 쪽이 이기든 게임에 차이가 없고,
   * 정하지 않으면 프레임마다 달라져서 캐릭터가 떨린다.
   */
  private readDir(): Direction | null {
    if (this.down('UP') || this.down('W')) return 'up'
    if (this.down('DOWN') || this.down('S')) return 'down'
    if (this.down('LEFT') || this.down('A')) return 'left'
    if (this.down('RIGHT') || this.down('D')) return 'right'
    return null
  }
}
