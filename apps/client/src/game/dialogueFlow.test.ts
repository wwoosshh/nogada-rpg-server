import type { SpeakerDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { DialogueFlow, speakerName } from './dialogueFlow.js'

const SPEAKER = '채집장 노인'

/** 발화 한 마디를 연 상태. 거의 모든 테스트가 여기서 시작한다. */
function opened(lines: string[], actionDown = false): DialogueFlow {
  const flow = new DialogueFlow()
  flow.begin(SPEAKER, lines, actionDown)
  return flow
}

/** 아무 일도 없는 한 프레임 — 행동키는 떼진 채다. */
const IDLE = { actionDown: false, tapped: false, closed: false } as const
/** 화면을 한 번 탭한 프레임. */
const TAP = { actionDown: false, tapped: true, closed: false } as const
/** B(또는 닫기 버튼)를 누른 프레임. */
const CLOSE = { actionDown: false, tapped: false, closed: true } as const
/** 행동키를 쥐고 있는 프레임. */
const HOLD = { actionDown: true, tapped: false, closed: false } as const

describe('DialogueFlow — 발화를 한 칸씩 넘기는 상태 기계', () => {
  it('발화를 열면 첫 칸부터 보여준다', () => {
    const flow = opened(['손이 익었군.', '그 나이에 벌써 그러면 나는 뭐가 되나.'])

    expect(flow.isOpen).toBe(true)
    expect(flow.box).toEqual({ speaker: SPEAKER, line: '손이 익었군.', index: 0, total: 2 })
  })

  it('탭 한 번이 다음 칸으로 넘긴다 — 넘김은 행동 버튼이 아니라 화면 탭이다', () => {
    const flow = opened(['첫 칸', '둘째 칸'])

    flow.step(TAP)

    expect(flow.box).toEqual({ speaker: SPEAKER, line: '둘째 칸', index: 1, total: 2 })
  })

  it('마지막 칸에서 한 번 더 넘기면 닫힌다', () => {
    const flow = opened(['첫 칸', '둘째 칸'])

    flow.step(TAP)
    flow.step(TAP)

    expect(flow.isOpen).toBe(false)
    expect(flow.box).toBeNull()
  })

  it('한 칸짜리 발화는 탭 한 번에 닫힌다', () => {
    const flow = opened(['허어, 또 왔는가.'])

    flow.step(TAP)

    expect(flow.isOpen).toBe(false)
  })

  it('닫으면 남은 칸을 건너뛴다 — B 의 뜻은 "그만 듣는다"이지 "천천히 넘긴다"가 아니다', () => {
    const flow = opened(['첫 칸', '둘째 칸', '셋째 칸'])

    flow.step(CLOSE)

    expect(flow.isOpen).toBe(false)
    expect(flow.box).toBeNull()
  })

  it('닫기와 탭이 같은 프레임에 오면 닫기가 이긴다 — 닫기 버튼 위를 탭해도 남은 칸이 넘어가면 안 된다', () => {
    const flow = opened(['첫 칸', '둘째 칸'])

    flow.step({ actionDown: false, tapped: true, closed: true })

    expect(flow.isOpen).toBe(false)
  })

  it('닫힌 뒤의 입력은 아무 일도 하지 않는다 — 창을 닫은 그 탭이 다음 대화까지 넘기면 안 된다', () => {
    const flow = opened(['한 칸뿐'])
    flow.step(TAP)

    flow.step(TAP)
    flow.step(CLOSE)

    expect(flow.isOpen).toBe(false)
    expect(flow.box).toBeNull()
  })

  it('빈 발화는 창을 열지 않는다 — 보여줄 칸이 없는데 조작만 잠그면 게임이 멈춘다', () => {
    const flow = new DialogueFlow()

    flow.begin(SPEAKER, [], false)

    expect(flow.isOpen).toBe(false)
    expect(flow.box).toBeNull()
  })
})

describe('DialogueFlow — 행동키는 한 번 떼야 먹는다', () => {
  it('대화가 열린 시점에 눌려 있던 행동키는 쥐고 있는 내내 한 칸도 안 넘긴다 — 이 게임은 A 를 쥐도록 훈련시킨다', () => {
    const flow = opened(['첫 칸', '둘째 칸', '셋째 칸'], true)

    flow.step(HOLD)
    flow.step(HOLD)
    flow.step(HOLD)

    expect(flow.box?.index).toBe(0)
  })

  it('열린 뒤 한 번 떼고 다시 누르면 그때부터 넘김으로 먹는다', () => {
    const flow = opened(['첫 칸', '둘째 칸'], true)

    flow.step(HOLD)
    flow.step(IDLE) // 뗌
    flow.step(HOLD) // 새로 누름

    expect(flow.box?.index).toBe(1)
  })

  it('열린 시점에 안 눌려 있었으면 첫 누름이 바로 먹는다', () => {
    const flow = opened(['첫 칸', '둘째 칸'], false)

    flow.step(HOLD)

    expect(flow.box?.index).toBe(1)
  })

  it('누른 채로 있는 동안은 한 번만 먹는다 — 쥐고 있는 것이 연타가 되면 발화가 한 프레임에 사라진다', () => {
    const flow = opened(['첫 칸', '둘째 칸', '셋째 칸'], false)

    flow.step(HOLD)
    flow.step(HOLD)
    flow.step(HOLD)

    expect(flow.box?.index).toBe(1)
  })

  it('창이 닫혀 있는 동안에도 행동키 상태를 따라간다 — 그래야 다음 대화가 "이미 눌려 있었다"를 정확히 안다', () => {
    const flow = new DialogueFlow()

    // 창이 없는 동안 계속 쥐고 있었다.
    flow.step(HOLD)
    flow.step(HOLD)
    // 쥔 채로 대화가 열렸다고 알린다.
    flow.begin(SPEAKER, ['첫 칸', '둘째 칸'], true)
    flow.step(HOLD)

    expect(flow.box?.index).toBe(0)
  })
})

describe('speakerName — 화자 id 를 화면에 보일 이름으로', () => {
  const speakers: Record<string, SpeakerDef> = {
    채집장노인: {
      id: '채집장노인',
      name: '채집장 노인',
      kind: 'npc',
      mapId: 'world',
      x: 16,
      y: 12,
      sprite: 'npc_elder',
    },
  }

  it('화자 정의에서 이름을 찾는다', () => {
    expect(speakerName(speakers, '채집장노인')).toBe('채집장 노인')
  })

  it('모르는 화자는 id 를 그대로 보여준다 — 서버가 아는 화자를 클라이언트 번들이 모를 수 있고, 그때 이름칸이 비면 누가 말하는지조차 사라진다', () => {
    expect(speakerName(speakers, '촌장')).toBe('촌장')
  })

  it('Object.prototype 의 이름을 화자로 착각하지 않는다', () => {
    expect(speakerName(speakers, 'constructor')).toBe('constructor')
  })
})
