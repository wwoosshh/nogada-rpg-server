import { describe, expect, it } from 'vitest'
import { InputHub } from './InputState.js'

/**
 * hub 는 Phaser 를 모르는 순수 상태다(그것이 이 파일이 존재할 수 있는 이유다 —
 * 테스트 환경에는 window 도 jsdom 도 없어 Phaser 자체를 import 할 수 없다).
 * 그래서 여기서는 KeyboardSource·TouchSource 를 만들지 않고 그 둘이 hub 에게
 * 하는 말을 그대로 흉내 낸다: 소스 이름을 붙여 setButton·setDir·releaseAll 을
 * 부른다.
 */

describe('InputHub — 한 소스는 자기가 넣은 것만 도로 가져갈 수 있다', () => {
  it('키보드가 쥔 행동키는 터치 소스가 전부 놓아도 살아남는다 — 사라진 것은 화면의 버튼이지 물리 키가 아니다', () => {
    const hub = new InputHub()
    hub.setButton('keyboard', 'action', true)

    // 대사창이 열리며 ControlScene.setControllerVisible(false) 가 터치 소스를
    // 통째로 놓는 그 순간이다. 손가락 밑에서 사라진 것은 화면의 A 버튼뿐이고,
    // 스페이스바는 여전히 눌려 있다.
    hub.releaseAll('touch')

    expect(hub.isHeld('action')).toBe(true)
    expect(hub.state.action).toBe(true)
  })

  it('터치가 쥔 행동키는 자기 릴리스로 지워진다 — 버튼이 정말로 손가락 밑에서 사라졌다', () => {
    const hub = new InputHub()
    hub.setButton('touch', 'action', true)

    hub.releaseAll('touch')

    expect(hub.isHeld('action')).toBe(false)
    expect(hub.state.action).toBe(false)
  })

  it('둘 다 쥐고 있을 때 터치만 놓으면 키보드 몫이 남는다 — 섞인 경우에도 지워지는 것은 자기 몫뿐이다', () => {
    const hub = new InputHub()
    hub.setButton('keyboard', 'action', true)
    hub.setButton('touch', 'action', true)

    hub.releaseAll('touch')
    expect(hub.isHeld('action')).toBe(true)

    hub.setButton('keyboard', 'action', false)
    expect(hub.isHeld('action')).toBe(false)
  })

  it('한 소스가 놓아도 다른 소스가 아직 쥐고 있으면 뗌으로 세지 않는다 — 다시 눌렀을 때 새 누름이 한 번만 나와야 한다', () => {
    const hub = new InputHub()
    hub.setButton('keyboard', 'action', true)
    hub.beginFrame()

    hub.setButton('touch', 'action', true)
    expect(hub.state.actionPressed).toBe(false) // 이미 눌려 있던 버튼이다

    hub.setButton('touch', 'action', false)
    expect(hub.isHeld('action')).toBe(true)
  })

  it('방향도 같은 규칙이다 — 터치가 패드를 놓아도 키보드가 누르고 있는 방향은 남는다', () => {
    const hub = new InputHub()
    hub.setDir('keyboard', 'up')

    hub.releaseAll('touch')

    expect(hub.state.dir).toBe('up')
  })

  it('나중에 말한 소스가 방향을 이기고, 그 소스가 놓으면 아직 쥐고 있는 쪽으로 되돌아간다', () => {
    const hub = new InputHub()
    hub.setDir('keyboard', 'up')
    hub.setDir('touch', 'down')
    expect(hub.state.dir).toBe('down')

    hub.setDir('touch', null)
    expect(hub.state.dir).toBe('up')

    hub.setDir('keyboard', null)
    expect(hub.state.dir).toBe(null)
  })
})

/**
 * ControlScene.setControllerVisible 의 주석이 못 박아 둔 요구다. 버튼이 손가락
 * 밑에서 사라질 때 놓아 주지 않으면 hub 가 "이미 눌린 상태"로 굳어, 다음에
 * 그 버튼을 진짜로 눌러도 justPressed 가 아니라서 한 번이 통째로 삼켜진다.
 * 소스별로 나눈 뒤에도 이 성질이 그대로 남아야 한다.
 */
describe('InputHub — 터치로 연 대화 뒤 다음 A 는 반드시 새 누름으로 잡힌다', () => {
  it('터치 A 로 말을 걸고 컨트롤러가 사라진 뒤, 다시 누른 A 가 actionPressed 를 낸다', () => {
    const hub = new InputHub()

    hub.setButton('touch', 'action', true) // A 를 눌러 말을 건다
    hub.setWorldInputLocked(true) // 대사창이 열린다
    hub.releaseAll('touch') // 컨트롤러가 손가락 밑에서 사라진다
    hub.setWorldInputLocked(false) // 대사창을 닫는다
    hub.beginFrame()

    hub.setButton('touch', 'action', true) // 다시 진짜로 누른 A
    expect(hub.state.actionPressed).toBe(true)
  })
})

/**
 * 이 게임의 핵심 루프는 행동키를 **쥐고 있는** 것이다. 대화를 마친 뒤에도
 * 쥐고 있던 키가 그대로 이어져야 노가다가 끊기지 않는다.
 *
 * 잠금이 풀릴 때 되살리는 것은 눌림 **상태**(action)뿐이고 한 프레임짜리
 * 새 누름 신호(actionPressed)는 아니다. setWorldInputLocked 의 원래 걱정
 * ("쥔 채로 닫으면 닫자마자 한 번 채집한다")은 그 에지 신호가 새어 나가는
 * 것이었고, 그건 여전히 새지 않는다.
 */
describe('InputHub — 잠금은 지우는 것이 아니라 가리는 것이다', () => {
  it('키보드로 쥔 채 잠갔다 풀면 눌림 상태가 되살아난다 — 대화를 마치면 노가다가 이어져야 한다', () => {
    const hub = new InputHub()
    hub.setButton('keyboard', 'action', true)

    hub.setWorldInputLocked(true)
    expect(hub.state.action).toBe(false) // 잠긴 동안은 세계에 닿지 않는다
    expect(hub.isHeld('action')).toBe(true) // 물리적으로는 여전히 눌려 있다

    hub.setWorldInputLocked(false)
    expect(hub.state.action).toBe(true)
    expect(hub.state.actionPressed).toBe(false) // 새로 누른 것은 아니다
  })

  it('잠긴 사이에 키를 떼었으면 풀려도 눌린 상태가 아니다 — 되살리는 것은 지금 눌려 있는 것뿐이다', () => {
    const hub = new InputHub()
    hub.setButton('keyboard', 'action', true)
    hub.setWorldInputLocked(true)

    hub.setButton('keyboard', 'action', false)
    hub.setWorldInputLocked(false)

    expect(hub.state.action).toBe(false)
  })

  it('터치로 연 대화는 잠금이 풀려도 되살아날 것이 없다 — 컨트롤러가 사라지며 터치가 진짜로 놓았기 때문이다', () => {
    const hub = new InputHub()
    hub.setButton('touch', 'action', true)

    hub.setWorldInputLocked(true)
    hub.releaseAll('touch')
    hub.setWorldInputLocked(false)

    expect(hub.state.action).toBe(false)
  })

  it('방향도 같다 — 키보드로 걷던 중 대화가 열렸다 닫히면 계속 걷는다', () => {
    const hub = new InputHub()
    hub.setDir('keyboard', 'up')

    hub.setWorldInputLocked(true)
    expect(hub.state.dir).toBe(null)

    hub.setWorldInputLocked(false)
    expect(hub.state.dir).toBe('up')
  })
})

/**
 * 여기까지가 실기에서 잰 그대로다(기기 픽셀비 2, 812×420 화면, 채집장노인).
 * 스페이스바를 쥔 채 말을 걸고, 떼지 않은 채 대사창을 닫으면 예전에는
 * action·actionPressed·held 셋 다 false 로 굳어 700ms 동안 그대로였다.
 */
describe('InputHub — 대사창을 지나는 동안 쥐고 있던 행동키(실측 회귀)', () => {
  it('스페이스바를 떼지 않고 대화를 열었다 닫으면 여전히 눌린 상태다', () => {
    const hub = new InputHub()

    // 1. 스페이스바를 누른 채로 둔다. KeyboardSource 는 값이 바뀔 때만 쓰므로
    //    이 한 번이 이 소스가 hub 에 하는 말의 전부다 — 다시 말해 주지 않는다.
    hub.setButton('keyboard', 'action', true)

    // 2. 말을 건다 → 대사창이 열리며 잠기고, 컨트롤러가 사라지며 터치 소스가
    //    자기가 쥔 것을 전부 놓는다(ControlScene.setControllerVisible).
    hub.setWorldInputLocked(true)
    hub.releaseAll('touch')

    // 3. 떼지 않은 채 닫는다.
    hub.setWorldInputLocked(false)

    // 4. 프레임이 몇 번 지나도(키보드는 아무 말도 하지 않는다) 그대로여야 한다.
    for (let i = 0; i < 7; i += 1) {
      hub.beginFrame()
      expect(hub.isHeld('action')).toBe(true)
      expect(hub.state.action).toBe(true)
    }
  })
})
