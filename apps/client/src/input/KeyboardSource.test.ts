import { describe, expect, it } from 'vitest'
import { InputHub } from './InputState.js'
import {
  KeyboardSource,
  type KeyEventLike,
  type KeyListenerTarget,
} from './KeyboardSource.js'

/**
 * 테스트 환경에는 window 도 jsdom 도 없다(InputState.test.ts 첫 문단과 같은
 * 사정). 그래서 window 대신 기록만 하는 가짜를 꽂고, 이벤트는 KeyEventLike
 * 모양의 맨 객체를 만들어 keyDown()/keyUp() 에 직접 넣는다 — 이 클래스가
 * Phaser 를 떠나 window 리스너로 옮겨 온 이유(그 파일 문서)와 같은 구조라서,
 * 리스너 등록/해제만 가짜로 확인하면 나머지는 전부 순수 로직이다.
 */

function fakeTarget(): KeyListenerTarget & { registered: Map<string, unknown[]> } {
  const registered = new Map<string, unknown[]>()
  return {
    registered,
    addEventListener(type, listener) {
      const list = registered.get(type) ?? []
      list.push(listener)
      registered.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = registered.get(type) ?? []
      const at = list.indexOf(listener)
      if (at >= 0) list.splice(at, 1)
    },
  }
}

/** setDir/setButton 호출을 순서대로 기록한다 — "바뀔 때만 쓴다" 검증용. */
function spyHub(): { hub: Pick<InputHub, 'setDir' | 'setButton'>; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    hub: {
      setDir: (_source, dir) => {
        calls.push(`dir=${String(dir)}`)
      },
      setButton: (_source, button, down) => {
        calls.push(`${button}=${String(down)}`)
      },
    },
  }
}

function key(code: string, target: unknown = null): KeyEventLike & { prevented: boolean } {
  const e = {
    code,
    target,
    prevented: false,
    preventDefault(): void {
      e.prevented = true
    },
  }
  return e
}

describe('KeyboardSource — 편집 필드 가드', () => {
  it('INPUT·TEXTAREA·SELECT·contentEditable 에서 온 keydown 은 무시한다', () => {
    const { hub, calls } = spyHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('KeyW', { tagName: 'INPUT' }))
    src.keyDown(key('ArrowUp', { tagName: 'TEXTAREA' }))
    src.keyDown(key('Escape', { tagName: 'SELECT' }))
    src.keyDown(key('KeyI', { isContentEditable: true }))
    src.update()

    expect(calls).toEqual([])
  })

  it('keyup 은 편집 필드에서 와도 항상 받는다 — 밖에서 누른 키가 안에서 떼여도 눌린 채 남지 않는다', () => {
    const hub = new InputHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('KeyW')) // 세계에서 걷기 시작
    src.update()
    expect(hub.state.dir).toBe('up')

    src.keyUp(key('KeyW', { tagName: 'INPUT' })) // 이름 입력이 포커스를 가진 채로 손을 뗐다
    src.update()
    expect(hub.state.dir).toBe(null)
  })

  it('편집 필드에서는 preventDefault 를 부르지 않는다 — 글자가 찍혀야 한다', () => {
    const src = new KeyboardSource(spyHub().hub, fakeTarget())

    const inField = key('KeyW', { tagName: 'INPUT' })
    src.keyDown(inField)
    expect(inField.prevented).toBe(false)

    const inWorld = key('KeyW')
    src.keyDown(inWorld)
    expect(inWorld.prevented).toBe(true)
  })

  it('다루지 않는 키는 건드리지 않는다 — preventDefault 도 없다', () => {
    const src = new KeyboardSource(spyHub().hub, fakeTarget())

    const e = key('KeyZ')
    src.keyDown(e)
    expect(e.prevented).toBe(false)
  })
})

describe('KeyboardSource — blur', () => {
  it('창이 포커스를 잃으면 쥐고 있던 키를 전부 놓는다', () => {
    const hub = new InputHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('KeyW'))
    src.keyDown(key('Space'))
    src.update()
    expect(hub.state.dir).toBe('up')
    expect(hub.state.action).toBe(true)

    src.windowBlur() // alt-tab — keyup 은 다른 창으로 갔다
    src.update()
    expect(hub.state.dir).toBe(null)
    expect(hub.state.action).toBe(false)
  })
})

describe('KeyboardSource — 방향 우선순위', () => {
  it('여러 방향이 눌리면 위>아래>왼>오 순서로 이긴다 — 먼저 누른 쪽이 아니다', () => {
    const hub = new InputHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('ArrowDown'))
    src.update()
    expect(hub.state.dir).toBe('down')

    src.keyDown(key('ArrowUp')) // 아래를 쥔 채로 위를 더 눌렀다
    src.update()
    expect(hub.state.dir).toBe('up')

    src.keyUp(key('ArrowUp'))
    src.update()
    expect(hub.state.dir).toBe('down')
  })

  it('방향키와 WASD 는 같은 방향이다', () => {
    const hub = new InputHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('KeyS'))
    src.keyDown(key('ArrowUp'))
    src.update()
    expect(hub.state.dir).toBe('up') // KeyS(아래)보다 ArrowUp(위)이 이긴다
  })
})

describe('KeyboardSource — hub 에는 바뀔 때만 쓴다', () => {
  it('아무 키도 안 눌린 프레임에는 아무것도 안 쓴다 — setDir(null) 로 다른 소스를 밀어내지 않는다', () => {
    const { hub, calls } = spyHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.update()
    src.update()

    expect(calls).toEqual([])
  })

  it('누른 채로 있으면 누른 그 한 번만 말한다', () => {
    const { hub, calls } = spyHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('Space'))
    src.update()
    src.update()
    src.update()

    expect(calls).toEqual(['action=true'])
  })

  it('꾹 눌러서 오는 repeat keydown 은 새 누름이 아니다', () => {
    const { hub, calls } = spyHub()
    const src = new KeyboardSource(hub, fakeTarget())

    src.keyDown(key('Space'))
    src.update()
    src.keyDown(key('Space')) // 브라우저의 auto-repeat
    src.update()

    expect(calls).toEqual(['action=true'])
  })
})

describe('KeyboardSource — 리스너 수명', () => {
  it('만들 때 keydown·keyup·blur 를 걸고, destroy() 가 전부 뗀다', () => {
    const target = fakeTarget()
    const src = new KeyboardSource(spyHub().hub, target)

    expect(target.registered.get('keydown')).toHaveLength(1)
    expect(target.registered.get('keyup')).toHaveLength(1)
    expect(target.registered.get('blur')).toHaveLength(1)

    src.destroy()
    expect(target.registered.get('keydown')).toHaveLength(0)
    expect(target.registered.get('keyup')).toHaveLength(0)
    expect(target.registered.get('blur')).toHaveLength(0)
  })
})
