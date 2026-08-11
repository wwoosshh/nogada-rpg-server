import { emptyPlayer } from '@nogada/data'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '../api/sessionToken.js'
import { useGameStore } from './gameStore.js'

/*
 * 패널 열림 상태의 유일한 주인은 스토어의 openPanel 하나다(설계 §8-앞 6).
 * Phaser(PanelScene)와 React(DOM 패널)가 같은 값을 읽으므로, 이 값의 규칙 —
 * 상호배제·tally 리셋·수명 — 이 깨지면 두 세계가 서로 다른 화면을 그린다.
 *
 * 서버는 띄우지 않는다. fetch 를 막아 서버 응답 모양(CraftOutcomeDto)을 그대로
 * 흉내 낸다 — InputState.test 가 입력 소스를 흉내 내는 것과 같은 자세다.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 서버 craft 응답(CraftOutcomeDto)의 최소 실물 — 성패만 다르게 찍는다. */
function craftOutcome(success: boolean): unknown {
  return {
    success,
    chance: 0.6,
    produced: success ? { item: 'copper_ingot', count: 1 } : null,
    consumed: [],
    skillGained: 1,
    autoEquipped: false,
    achieved: [],
    player: emptyPlayer(),
  }
}

/**
 * localStorage 흉내. 401 경로는 "토큰을 싣고 갔는데 거절당했다"일 때만
 * 관찰자를 부른다(GameClient.request) — node 에는 window 가 없어 토큰이 항상
 * null 이므로, 그 조건을 만들려면 저장소부터 세워야 한다.
 */
function fakeWindow(): { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> } {
  const mem = new Map<string, string>()
  return {
    localStorage: {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => void mem.set(key, value),
      removeItem: (key: string) => void mem.delete(key),
    },
  }
}

beforeEach(() => {
  // 게임 중인 상태에서 시작한다 — 패널은 게임 안에서만 열린다.
  useGameStore.setState({
    openPanel: null,
    craftTally: {},
    player: emptyPlayer(),
    boot: 'playing',
    connection: 'online',
    session: 'ready',
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('openPanel — 열림 상태의 주인은 스토어 하나다', () => {
  // 왜: 값이 하나라서 상호배제가 공짜다(설계 §8-앞 6). 제작을 연 채 메뉴를
  //     열면 이전 값이 덮이며 닫힌다 — 두 패널이 겹쳐 열리는 상태 자체가 없다.
  it('다른 패널을 열면 이전 패널은 그 값이 덮이며 닫힌다', () => {
    useGameStore.getState().setOpenPanel('craft')
    useGameStore.getState().setOpenPanel('menu')
    expect(useGameStore.getState().openPanel).toBe('menu')

    useGameStore.getState().setOpenPanel('bag')
    expect(useGameStore.getState().openPanel).toBe('bag')
  })

  // 왜: 톱니의 계약은 "누르면 거기 도착한다"다. 가방(DOM)이 열려 있어도 같은
  //     교체 한 번으로 닫히고 메뉴가 열려야 한다(설계 §8-앞 7).
  it('톱니의 openMenu 는 열려 있던 DOM 패널을 닫고 menu 를 연다', () => {
    useGameStore.getState().setOpenPanel('bag')
    useGameStore.getState().openMenu('settings')
    expect(useGameStore.getState().openPanel).toBe('menu')
  })
})

describe('craftTally — 제작 패널의 누적 카운터', () => {
  // 왜: 점멸 대신 누적이다(설계 §8-앞 3). craft 액션이 서버 응답의 success 로
  //     레시피별 성공/실패를 올리지 않으면 카드가 보여줄 숫자가 없다.
  it('제작 성공과 실패가 레시피별로 쌓인다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(craftOutcome(true)))
        .mockResolvedValueOnce(jsonResponse(craftOutcome(false)))
        .mockResolvedValueOnce(jsonResponse(craftOutcome(true))),
    )

    useGameStore.getState().setOpenPanel('craft')
    await useGameStore.getState().craft('copper_ingot')
    await useGameStore.getState().craft('copper_ingot')
    await useGameStore.getState().craft('copper_hammer')

    expect(useGameStore.getState().craftTally).toEqual({
      copper_ingot: { success: 1, fail: 1 },
      copper_hammer: { success: 1, fail: 0 },
    })
  })

  // 왜: 누적은 "이번에 열어 둔 동안"의 성적이다. 리셋이 없으면 어제의 실패가
  //     오늘의 카드에 계속 남는다.
  it('제작 패널을 다시 열면 tally 는 0 에서 시작한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse(craftOutcome(true))),
    )

    useGameStore.getState().setOpenPanel('craft')
    await useGameStore.getState().craft('copper_ingot')
    useGameStore.getState().setOpenPanel(null)
    useGameStore.getState().setOpenPanel('craft')

    expect(useGameStore.getState().craftTally).toEqual({})
  })

  // 왜: setOpenPanel 은 같은 값이면 무시한다. 이미 열린 패널에 '열기'가 또
  //     오는 것(예: 매 프레임 라우팅의 실수)이 진행 중인 누적을 지우면 안 된다.
  it('이미 열린 제작 패널에 같은 값이 또 와도 tally 는 살아남는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse(craftOutcome(true))),
    )

    useGameStore.getState().setOpenPanel('craft')
    await useGameStore.getState().craft('copper_ingot')
    useGameStore.getState().setOpenPanel('craft')

    expect(useGameStore.getState().craftTally).toEqual({
      copper_ingot: { success: 1, fail: 0 },
    })
  })
})

describe('openPanel 의 수명 — 게임 밖으로 나가면 닫힌다(설계 §8-앞 9)', () => {
  // 왜: 리셋이 없으면 재접속 후 새 hub 는 안 잠겼는데 DOM 패널만 열려 있는
  //     상태가 된다 — confirmingDelete 가 같은 이유로 같은 자리에서 리셋된다.
  it('로그아웃하면 열려 있던 패널이 닫힌다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().logout()

    expect(useGameStore.getState().openPanel).toBeNull()
  })

  // 왜: 401 은 게임 어느 순간에든 온다. 관찰자가 타이틀로 옮기면서 패널을
  //     안 닫으면, 만료 안내 화면 위에 가방이 떠 있게 된다.
  it('세션이 죽으면(401) 패널도 닫힌다', async () => {
    vi.stubGlobal('window', fakeWindow())
    writeToken('dead-token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'unauthorized' }, 401)),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().gather('node-1')

    expect(useGameStore.getState().openPanel).toBeNull()
    expect(useGameStore.getState().session).toBe('rejected')
  })

  // 왜: 연결 게이트로 나가는 길(서버 불통)도 같은 규칙이다 — 게이트가 화면을
  //     덮는데 패널 값이 남아 있으면 재진입 순간 그 패널이 유령처럼 돌아온다.
  it('서버와 끊겨 게이트로 나가면 패널이 닫힌다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    useGameStore.getState().setOpenPanel('craft')
    await useGameStore.getState().craft('copper_ingot')

    expect(useGameStore.getState().openPanel).toBeNull()
    expect(useGameStore.getState().boot).toBe('unreachable')
  })
})
