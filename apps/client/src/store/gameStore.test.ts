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

/** 서버 talk 응답(TalkOutcomeDto)의 최소 실물 — 상점·대금만 얹어 가른다. */
function talkOutcome(extra: Record<string, unknown> = {}): unknown {
  return { speaker: '채집장노인', lines: ['어서 오시게.'], player: emptyPlayer(), ...extra }
}

beforeEach(() => {
  // 게임 중인 상태에서 시작한다 — 패널은 게임 안에서만 열린다.
  useGameStore.setState({
    openPanel: null,
    pendingShop: null,
    craftTally: {},
    lastAction: null,
    notice: null,
    tradeError: null,
    tradeBusy: false,
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

describe('상점 — 문은 대사가 끝난 뒤에 열린다(설계 §6-앞 20)', () => {
  // 왜: talk 응답이 바로 패널을 열면 그 직후 닫힌다 — DialogueScene 의 발화
  //     구독이 가장 먼저 setOpenPanel(null) 을 부르기 때문이다(대사가 화면의
  //     단독 소유자). 그래서 상점은 pendingShop 에서 기다린다.
  it('talk 의 shop 은 pendingShop 에 담기고 그 자리에서 열리지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(talkOutcome({ shop: '얼음상점' }))))

    await useGameStore.getState().talk('채집장노인')

    expect(useGameStore.getState().pendingShop).toBe('얼음상점')
    expect(useGameStore.getState().openPanel).toBeNull()
  })

  // 왜: 대사창이 닫히는 그 순간이 "말이 끝났다"를 아는 유일한 자리이고,
  //     열림 값은 상점 id 를 품은 문자열 키다(항등 가드를 살리려고, ShopPanelKey).
  it('openPendingShop 이 그 상점을 열고 채널을 비운다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(talkOutcome({ shop: '얼음상점' }))))

    await useGameStore.getState().talk('채집장노인')
    useGameStore.getState().openPendingShop()

    expect(useGameStore.getState().openPanel).toBe('shop:얼음상점')
    expect(useGameStore.getState().pendingShop).toBeNull()
    // 대사창은 상점과 무관한 말에도 매번 닫힌다 — 두 번째 호출은 아무 일도 없다.
    useGameStore.getState().setOpenPanel(null)
    useGameStore.getState().openPendingShop()
    expect(useGameStore.getState().openPanel).toBeNull()
  })

  // 왜: 문이 안 열리는 대화(숙련 미달·다른 화자)가 앞선 대화의 상점을 물려받으면,
  //     아무 말이나 걸어도 상점이 열린다.
  it('상점 없는 대화는 기다리던 상점을 지운다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(talkOutcome({ shop: '얼음상점' })))
        .mockResolvedValueOnce(jsonResponse(talkOutcome())),
    )

    await useGameStore.getState().talk('채집장노인')
    await useGameStore.getState().talk('여관안주인')

    expect(useGameStore.getState().pendingShop).toBeNull()
  })

  // 왜: 달인 대금은 새 채널을 만들지 않는다(§6-앞 20 배선) — 머리 위 피드백
  //     그대로다. 금액을 서버가 실어 보내는 이유는 화면이 차액을 계산하지
  //     않기 위해서다(같은 응답에 매도 대금이 섞이는 날 조용히 틀린다).
  it('달인 대금은 머리 위 피드백으로 +금액 을 말한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(talkOutcome({ reward: { id: 'ice_master', gold: 1000000 } }))),
    )

    await useGameStore.getState().talk('여관안주인')

    expect(useGameStore.getState().lastAction?.text).toBe('+1,000,000 G')
    expect(useGameStore.getState().lastAction?.tone).toBe('good')
  })
})

describe('거래 — 화자가 자리를 뜨면 패널이 닫힌다(설계 §6-앞 4)', () => {
  // 왜: 상점 넷 중 셋은 화자의 일과에 실내 지점이 있어 밤이면 not_here 가 된다.
  //     그건 버그가 아니라 세계가 살아 있다는 증거이고, 화면이 할 일은 패널을
  //     닫고 **대화와 똑같은 안내**를 띄우는 것이다.
  it('매도가 not_here 로 거절되면 패널이 닫히고 안내가 뜬다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'not_here' }, 400)),
    )

    useGameStore.getState().setOpenPanel('shop:얼음상점')
    await useGameStore.getState().sell('얼음상점', 'ice_shard', 3)

    expect(useGameStore.getState().openPanel).toBeNull()
    expect(useGameStore.getState().notice?.text).toBe('지금 여기 없는 것 같다.')
  })

  // 왜: 거절 문구가 캔버스 플로터(lastAction)로 나가면 아무도 못 본다 — 거래는
  //     상점 패널이 화면을 덮은 상태에서만 일어나기 때문이다. 그래서 거절은
  //     패널 안에서 말한다(tradeError). 재현: 보유량 전부로 두 번 빠르게 팔면
  //     두 번째가 missing_items 로 거절되는데 화면에 아무 일도 안 일어났다.
  it('거래 거절은 패널 안의 채널로 간다 — 머리 위 글자는 건드리지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'missing_items' }, 400)),
    )

    useGameStore.getState().setOpenPanel('shop:얼음상점')
    await useGameStore.getState().sell('얼음상점', 'ice_shard', 3)

    expect(useGameStore.getState().tradeError).toBe('물건이 모자란다')
    expect(useGameStore.getState().lastAction).toBeNull()
    expect(useGameStore.getState().openPanel).toBe('shop:얼음상점')
  })

  // 왜: 남아 있는 거절 문구는 다음 거래가 성공한 뒤에도 화면에 붙어 있으면
  //     방금 성공한 거래를 실패로 읽게 만든다.
  it('다음 거래가 성공하면 지난 거절 문구가 지워진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(async () => jsonResponse({ code: 'not_enough_gold' }, 400))
        .mockImplementationOnce(async () => jsonResponse({ player: emptyPlayer() })),
    )

    useGameStore.getState().setOpenPanel('shop:얼음상점')
    await useGameStore.getState().buy('얼음상점', 'ice_speed_token', 1)
    expect(useGameStore.getState().tradeError).toBe('골드 부족')

    await useGameStore.getState().buy('얼음상점', 'ice_speed_token', 1)
    expect(useGameStore.getState().tradeError).toBeNull()
  })

  // 왜: 문구는 그 상점 그 순간의 것이다 — 패널을 닫았다 다시 열었는데 지난
  //     거절이 그대로 붙어 있으면, 아무것도 안 했는데 실패한 화면이 된다.
  it('패널을 닫으면 거절 문구도 함께 지워진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'item_locked' }, 400)),
    )

    useGameStore.getState().setOpenPanel('shop:얼음상점')
    await useGameStore.getState().buy('얼음상점', 'ice_sight_token', 1)
    expect(useGameStore.getState().tradeError).toBe('아직 살 수 없는 물건')

    useGameStore.getState().setOpenPanel(null)
    expect(useGameStore.getState().tradeError).toBeNull()
  })

  // 왜: **두 번째 요청 자체를 막는 것이 근본이다.** 보유량 전부로 두 번 빠르게
  //     누르면 첫 요청이 아직 돌아오지 않은 채 두 번째가 나가고, 그 둘째는 이미
  //     비워진 스택을 다시 팔려 해 반드시 거절된다. 버튼을 잠그면 그 거절이
  //     애초에 생기지 않는다.
  it('요청이 나가 있는 동안에는 잠금 신호(tradeBusy)가 켜져 있다', async () => {
    let release: (() => void) | null = null
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        await held
        return jsonResponse({ player: emptyPlayer() })
      }),
    )

    useGameStore.getState().setOpenPanel('shop:얼음상점')
    const inflight = useGameStore.getState().sell('얼음상점', 'ice_shard', 3)
    expect(useGameStore.getState().tradeBusy).toBe(true)

    release!()
    await inflight
    expect(useGameStore.getState().tradeBusy).toBe(false)
  })

  // 왜: 거래의 응답은 { player } 하나다(착용·강화와 같은 모양) — 그 하나를
  //     갈아 끼우는 것이 골드와 스택이 화면에서 움직이는 전부다.
  it('매수 성공은 응답의 player 를 그대로 갈아 끼운다', async () => {
    const bought = { ...emptyPlayer(), gold: 520000, stacks: { ice_speed_token: 1 } }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ player: bought })),
    )

    useGameStore.getState().setOpenPanel('shop:얼음상점')
    await useGameStore.getState().buy('얼음상점', 'ice_speed_token', 1)

    expect(useGameStore.getState().player?.gold).toBe(520000)
    expect(useGameStore.getState().openPanel).toBe('shop:얼음상점')
  })
})
