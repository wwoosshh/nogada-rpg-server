import type { SpeakerDef } from '@nogada/shared'

/**
 * 대사창이 지금 보여줄 한 칸.
 *
 * `index`·`total` 은 화면에 그리지 않는다 — 이 상태 기계가 어디까지 왔는지를
 * 밖에서 확인할 수 있는 유일한 값이라 남겨 둔다(테스트가 이걸 읽는다).
 */
export interface DialogueBox {
  speaker: string
  line: string
  /** 0부터. */
  index: number
  total: number
}

/**
 * 한 프레임에 들어온 넘김 입력.
 *
 * 세 가지를 한 번에 받는 이유는 우선순위가 이 안에서 결정돼야 하기 때문이다 —
 * 닫기 버튼을 탭하면 `closed` 와 `tapped` 가 같은 프레임에 함께 온다. 씬이
 * 그때그때 advance/close 를 나눠 부르면 그 우선순위가 씬 코드에 흩어져
 * 테스트할 수 없는 곳으로 새어 나간다.
 */
export interface DialogueInput {
  /** 행동키가 **지금** 눌려 있는가. "이번 프레임에 새로 눌렸는가"가 아니다 — 아래 클래스 문서 참고. */
  actionDown: boolean
  /** 화면(또는 대사창)을 탭했는가. */
  tapped: boolean
  /** B 또는 닫기 버튼. 남은 칸을 건너뛰고 닫는다. */
  closed: boolean
}

/**
 * 발화 한 마디를 한 칸씩 넘기는 상태 기계. Phaser 를 모른다.
 *
 * 그리기와 나눠 둔 이유는 여기 담긴 규칙(설계 문서 §10)이 전부 화면과 무관한
 * 판단이기 때문이다 — 지금 어느 칸인가, 탭이 무엇을 하는가, 닫으면 남은 칸은
 * 어떻게 되는가, 언제 창이 사라지는가. 이 저장소에 Phaser 테스트 하네스가
 * 없으므로, 씬 안에 두면 그 규칙 전부가 검증 없는 코드가 된다.
 *
 * **행동키를 "레벨"로 받는 이유가 이 클래스의 핵심이다.** InputHub 의
 * `actionPressed` 는 한 프레임짜리 신호라 `beginFrame()` 이 매 프레임 끝에서
 * 지운다 — 그리고 이 게임은 숙련도 10,000 이후 플레이어가 A 를 **쥐고 있도록**
 * 훈련시킨다. 쥔 채로 대화가 열리면 "눌려 있다"는 사실 하나만으로 발화가
 * 한 프레임에 통째로 넘어간다. 그래서 눌림 신호가 아니라 눌림 **상태**를 매
 * 프레임 받아, 뗐다가 새로 눌린 순간(상승 모서리)만 넘김으로 센다. 대화가
 * 열린 시점에 이미 눌려 있었으면 그 상태를 시작값으로 삼으므로 상승 모서리가
 * 생기지 않는다 — 그것이 "한 번 떼야 먹는다"의 구현이다.
 */
export class DialogueFlow {
  private speaker = ''
  private lines: readonly string[] = []
  private index = 0
  private open = false
  /** 직전 프레임의 행동키 눌림 상태. 상승 모서리를 찾는 유일한 기준이다. */
  private actionWasDown = false

  get isOpen(): boolean {
    return this.open
  }

  /** 지금 보여줄 칸. 창이 닫혀 있으면 null 이고, 대사창은 그동안 숨는다. */
  get box(): DialogueBox | null {
    if (!this.open) return null
    const line = this.lines[this.index]
    if (line === undefined) return null
    return { speaker: this.speaker, line, index: this.index, total: this.lines.length }
  }

  /**
   * 새 발화를 연다. `actionDown` 은 **여는 그 순간** 행동키가 눌려 있는지다.
   *
   * 칸이 하나도 없으면 열지 않는다. 서버는 할 말이 없으면 아예 거절하므로
   * (routes/talk.ts) 실제로는 오지 않지만, 그래도 여기서 막는다 — 보여줄
   * 칸이 없는 창이 열리면 조작만 잠기고 닫을 내용이 없다.
   */
  begin(speaker: string, lines: readonly string[], actionDown: boolean): void {
    this.actionWasDown = actionDown
    if (lines.length === 0) return
    this.speaker = speaker
    this.lines = lines
    this.index = 0
    this.open = true
  }

  /**
   * 한 프레임의 입력을 넘긴다. 창이 닫혀 있어도 매 프레임 부른다.
   *
   * 닫혀 있을 때도 행동키 상태를 계속 따라가는 이유: 그래야 다음 대화가
   * 열릴 때 `begin` 에 넘길 "지금 눌려 있는가"와 이 값이 어긋나지 않는다.
   * 한 프레임이라도 건너뛰면 그 사이의 뗌을 놓쳐 없던 상승 모서리를 만든다.
   */
  step(input: DialogueInput): void {
    const rose = input.actionDown && !this.actionWasDown
    this.actionWasDown = input.actionDown

    if (!this.open) return
    // 닫기가 넘김보다 먼저다. 닫기 버튼을 탭하면 두 신호가 같은 프레임에 온다.
    if (input.closed) {
      this.close()
      return
    }
    if (input.tapped || rose) this.advance()
  }

  /** 다음 칸으로. 마지막 칸이었으면 창이 닫힌다. */
  private advance(): void {
    if (this.index >= this.lines.length - 1) {
      this.close()
      return
    }
    this.index += 1
  }

  /** 남은 칸을 버리고 닫는다. 붙잡고 있던 발화도 여기서 놓아준다. */
  private close(): void {
    this.open = false
    this.speaker = ''
    this.lines = []
    this.index = 0
  }
}

/**
 * 화자 id 를 화면에 보일 이름으로 바꾼다.
 *
 * 서버는 발화와 함께 화자 **id** 만 보낸다(gameStore 의 Utterance 문서) —
 * 이름은 클라이언트가 자기 데이터에서 찾는다. 못 찾으면 id 를 그대로 쓴다:
 * 서버 데이터가 클라이언트 번들보다 새로울 수 있고, 그때 이름칸이 비면
 * 누가 말하는지조차 화면에서 사라진다. id 라도 보이면 무엇이 어긋났는지
 * 화면만 보고도 안다.
 *
 * `Object.hasOwn` 으로 먼저 거르는 이유: 그냥 `speakers[id]` 로 읽으면
 * `constructor`·`toString` 같은 이름이 Object.prototype 을 타고 값을 돌려주어
 * 이름칸에 "Object" 가 뜬다. 서버의 talkService 도 같은 자리에서 같은 가드를
 * 갖고 있다 — 클라이언트만 무르게 두면 서버가 거절한 이름이 화면에서는
 * 그럴듯한 이름으로 보인다.
 */
export function speakerName(speakers: Readonly<Record<string, SpeakerDef>>, speakerId: string): string {
  const found = Object.hasOwn(speakers, speakerId) ? speakers[speakerId] : undefined
  return found?.name ?? speakerId
}
