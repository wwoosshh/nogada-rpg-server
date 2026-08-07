import type Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputHub } from './InputState.js'

/**
 * PC 개발용 입력. 실기에는 키보드가 없다.
 *
 * 방향키와 WASD 를 둘 다 받는 이유는 개발 중 손이 어디 있든 쓰기 위해서다.
 * 여러 방향키가 동시에 눌리면 하나만 고른다 — 대각선이 없으므로 합칠 수 없다.
 */
export class KeyboardSource {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>

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

  /** 매 프레임 부른다. hub.beginFrame() 뒤에 와야 한다. */
  update(): void {
    this.hub.setDir(this.readDir())
    this.hub.setButton('action', this.down('SPACE') || this.down('J'))
    this.hub.setButton('cancel', this.down('ESC') || this.down('K'))
    this.hub.setButton('bag', this.down('I'))
    this.hub.setButton('craft', this.down('C'))
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
