import { emptyPlayer, loadGameData } from '@nogada/data'
import {
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_DAY,
  SKILL_LABELS,
  TIDE_WINDOWS,
  type SkillId,
} from '@nogada/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeToken } from '../api/sessionToken.js'
import { resetClock } from '../time/clock.js'
import { useGameStore } from './gameStore.js'

/*
 * 패널 열림 상태의 유일한 주인은 스토어의 openPanel 하나다(설계 §8-앞 6).
 * Phaser(PanelScene)와 React(DOM 패널)가 같은 값을 읽으므로, 이 값의 규칙 —
 * 상호배제·tally 리셋·수명 — 이 깨지면 두 세계가 서로 다른 화면을 그린다.
 *
 * 서버는 띄우지 않는다. fetch 를 막아 서버 응답 모양(CraftOutcomeDto)을 그대로
 * 흉내 낸다 — InputState.test 가 입력 소스를 흉내 내는 것과 같은 자세다.
 */

/**
 * `extraHeaders` 는 서버가 얹는 헤더를 흉내 낸다 — 지금 쓰는 것은
 * `x-server-now` 하나다(app.ts 의 onSend 훅이 모든 응답에, 거절에도 싣는다).
 * 그 값이 있어야 "판정이 본 시각"으로 지어지는 문구를 시험할 수 있다.
 */
function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
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
    bagError: null,
    bagBusy: false,
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

  // 왜: 거절 문구는 **그 줄 그 수량**의 것이다. 탭을 옮기거나 다른 줄을 고르면
  //     화면의 아이콘·이름·합계가 전부 바뀌는데 그 아래 빨간 줄만 남는다 —
  //     방금 고른 물건이 거절당한 것처럼 읽힌다. 패널을 닫을 때 지우는 규칙
  //     (setOpenPanel)이 이미 있는데 패널 안에서 옮겨 다니는 경우만 빠져 있었다.
  it('선택이 옮겨지면 지난 거절 문구를 지운다', () => {
    useGameStore.getState().setOpenPanel('shop:얼음상점')
    useGameStore.setState({ tradeError: '물건이 모자란다' })

    useGameStore.getState().clearTradeError()

    expect(useGameStore.getState().tradeError).toBeNull()
    // 패널은 그대로다 — 지우는 것은 문구뿐이다.
    expect(useGameStore.getState().openPanel).toBe('shop:얼음상점')
  })
})

describe('사용 — 가방에서 쓴 가루가 하늘이 된다(설계 §6-앞 1~4)', () => {
  // 왜: 하늘의 유일한 출처는 서버가 돌려준 player.weather 다. 클라이언트가
  //     날씨를 따로 기억하면 그 사본이 새로고침·재접속에서 상태와 갈라진다 —
  //     응답 하나를 통째로 갈아 끼우는 것이 착용·강화·거래와 같은 길이다.
  it('응답의 player 를 그대로 갈아 끼운다 — 하늘도 그 안에 실려 온다', async () => {
    const rained = {
      ...emptyPlayer(),
      stacks: { rain_powder: 2 },
      weather: { kind: 'rain', untilMs: 4_000 },
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ player: rained })),
    )

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().use('rain_powder')

    expect(useGameStore.getState().player?.weather).toEqual({ kind: 'rain', untilMs: 4_000 })
    expect(useGameStore.getState().player?.stacks.rain_powder).toBe(2)
    // 쓰고 나서도 가방은 열려 있다 — 줄어든 개수를 그 자리에서 봐야 한다.
    expect(useGameStore.getState().openPanel).toBe('bag')
  })

  // 왜: 이것이 상점에서 배운 것과 같은 교훈이다 — 가방 패널이 화면을 덮은
  //     상태에서 거절을 머리 위 글자(lastAction)로 보내면 그 문구는 패널 뒤
  //     캔버스에서 뜨고 사라져 아무도 못 본다. 재현: 마지막 한 개를 두 창에서
  //     동시에 쓰면 둘째가 missing_items 로 거절된다.
  it('거절은 가방 안의 채널로 간다 — 머리 위 글자는 건드리지 않는다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'missing_items' }, 400)),
    )

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().use('rain_powder')

    expect(useGameStore.getState().bagError).toBe('물건이 모자란다')
    expect(useGameStore.getState().lastAction).toBeNull()
    expect(useGameStore.getState().openPanel).toBe('bag')
  })

  // 왜: **두 번째 요청 자체를 막는 것이 근본이다** — 상점이 tradeBusy 로 이미
  //     배운 그 교훈이다. 마지막 한 개를 두 번 빠르게 누르면 첫 요청이 아직
  //     돌아오지 않은 채 둘째가 나가고, 그 둘째는 이미 비워진 스택을 다시 쓰려
  //     해 반드시 거절된다. 가루는 더 나쁘다: 첫 요청이 성공하면 개수는 정말로
  //     줄어드는데, 화면에는 그 사이 아무 표시도 없어 "안 먹혔나" 하고 한 번
  //     더 누르게 된다.
  it('요청이 나가 있는 동안에는 잠금 신호(bagBusy)가 켜져 있다', async () => {
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

    useGameStore.getState().setOpenPanel('bag')
    const inflight = useGameStore.getState().use('rain_powder')
    expect(useGameStore.getState().bagBusy).toBe(true)

    release!()
    await inflight
    expect(useGameStore.getState().bagBusy).toBe(false)
  })

  // 왜: finally 로 풀어야 한다. 거절로 끝난 왕복이 잠금을 켜 둔 채 돌아오면
  //     가방의 세 버튼이 전부 영영 잠겨, 패널을 닫았다 열기 전에는 아무것도
  //     못 하게 된다.
  it('거절로 끝난 왕복도 잠금을 푼다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'missing_items' }, 400)),
    )

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().use('rain_powder')

    expect(useGameStore.getState().bagBusy).toBe(false)
  })

  // 왜: 착용·강화도 같은 패널의 같은 사정이다(그쪽은 오래 머리 위로 보내고
  //     있었다) — 채널이 생긴 이상 셋이 같은 자리에서 말해야, 다음 버튼이
  //     늘어날 때 어디에 적을지 고민할 일이 없다.
  it('착용·강화의 거절도 같은 자리에서 말한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'enhance_cap' }, 400)),
    )

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().enhance('some-instance')

    expect(useGameStore.getState().bagError).toBe('더 강화할 수 없다')
    expect(useGameStore.getState().lastAction).toBeNull()
  })

  // 왜: 문구는 그 순간의 것이다 — 패널을 닫았다 다시 열었는데 지난 거절이
  //     붙어 있으면 아무것도 안 했는데 실패한 화면이 된다(상점과 같은 규칙).
  it('다음 사용이 성공하거나 패널이 바뀌면 지난 거절이 지워진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(async () => jsonResponse({ code: 'not_usable' }, 400))
        .mockImplementationOnce(async () => jsonResponse({ player: emptyPlayer() })),
    )

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().use('soft_log')
    expect(useGameStore.getState().bagError).toBe('쓸 수 없는 물건')

    await useGameStore.getState().use('rain_powder')
    expect(useGameStore.getState().bagError).toBeNull()

    useGameStore.setState({ bagError: '물건이 모자란다' })
    useGameStore.getState().setOpenPanel(null)
    expect(useGameStore.getState().bagError).toBeNull()
  })
})

// 왜: 지금은 가방이 칸인 재료에만 [바치기] 를 그려 이 코드가 화면에서 나올 길이
//     없다. 그래도 넣는 이유는 not_usable 이 이미 세운 자세와 대칭이 맞아야
//     해서다 — 그 코드도 화면이 못 막는 경합(두 창)에만 오는데 문구가 있다.
//     여기는 경합보다 더 흔한 문이 하나 더 있다: collection.csv 에서 칸 하나를
//     빼고 배포한 직후, 그 탭을 이미 열어 둔 사람의 화면에는 옛 [바치기] 버튼이
//     남아 있어 이 코드가 그대로 온다. 문구가 없으면 `오류: not_collectable`
//     이라는 날것이 뜬다.
describe('헌납 — not_collectable 문구(수집의 방 설계 §6-앞 1)', () => {
  it('서버가 not_collectable 을 돌려주면 한국어 문구로 바뀐다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'not_collectable' }, 400)),
    )

    useGameStore.getState().setOpenPanel('bag')
    await useGameStore.getState().donate('copper_ore', 1)

    expect(useGameStore.getState().bagError).toBe('바칠 수 없는 물건')
  })
})

/*
 * 결계에 막힌 걸음은 이 저장소에서 **화면이 숫자를 말하는 유일한 거절**이다
 * (결계 설계 §5·§9-앞 13). 저숙련으로 결계를 밟았을 때 아무 말이 없으면
 * 플레이어가 보는 것은 "칸을 밟았는데 안 넘어갔다" 하나뿐이라, 그 문이
 * 숫자를 올리면 열리는 문이라는 사실이 화면 어디에도 없다.
 */
describe('결계 — 밀려날 때 화면이 숫자를 말한다(결계 설계 §5)', () => {
  /**
   * 게이트가 걸린 전환들. 넷을 손으로 적지 않는 이유는 **데이터가 진실**이기
   * 때문이다 — 결계가 하나 늘거나 요구치가 바뀌면 이 테스트가 그것을 함께 진다.
   */
  const barriers = loadGameData().transitions.flatMap((t) =>
    t.gateSkill !== undefined && t.gateValue !== undefined
      ? [{ transition: t, skill: t.gateSkill, need: t.gateValue }]
      : [],
  )

  /** 결계 앞에 선 저숙련자 한 명 — 그 계열만 need 아래로 채운다. */
  function standingAt(mapId: string, x: number, y: number, skill: SkillId, have: number): void {
    const base = emptyPlayer()
    useGameStore.setState({
      player: {
        ...base,
        skills: { ...base.skills, [skill]: have },
        location: { mapId, x, y },
      },
      notice: null,
    })
  }

  // 왜: 문구가 계열 이름과 두 숫자를 품어야 "얼마나 남았는가"가 화면에 있다.
  //     넷을 한 번에 도는 이유는 **각자의 것을 말해야** 하기 때문이다 — 한
  //     계열의 이름이나 요구치를 상수로 굳히면 나머지 셋이 남의 숫자를 말한다.
  it('네 결계가 각자의 계열 이름과 요구치·현재치를 말한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'locked' }, 400)),
    )
    expect(barriers.length).toBe(4)

    for (const { transition, skill, need } of barriers) {
      standingAt(transition.fromMap, transition.fromX, transition.fromY, skill, 63240)

      await expect(
        useGameStore.getState().move(transition.fromX, transition.fromY),
      ).rejects.toThrow()

      expect(useGameStore.getState().notice?.text).toBe(
        `결계가 밀어낸다 — ${SKILL_LABELS[skill]} 숙련 ${need.toLocaleString('ko-KR')} (지금 63,240)`,
      )
    }
  })

  // 왜: 삼키면 WorldScene 의 성공 분기가 실패를 성공으로 읽어 씬을 재시작하고,
  //     그때 스토어의 위치는 아직 옛것이라 플레이어가 **마지막 전환 도착 칸**
  //     으로 순간이동한다. 말을 세우는 것과 다시 던지는 것은 함께 가야 한다.
  it('문구를 세우고도 실패는 그대로 다시 던진다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'locked' }, 400)),
    )
    const first = barriers[0]!
    const before = emptyPlayer().location
    standingAt(first.transition.fromMap, first.transition.fromX, first.transition.fromY, first.skill, 0)

    await expect(
      useGameStore.getState().move(first.transition.fromX, first.transition.fromY),
    ).rejects.toThrow()

    // 거절된 걸음은 위치를 한 칸도 옮기지 않는다 — 서버가 준 player 가 없다.
    expect(useGameStore.getState().player?.location.mapId).toBe(first.transition.fromMap)
    expect(before.mapId).not.toBe(first.transition.fromMap)
  })

  // 왜: `no_transition` 은 클라와 서버가 서로 다른 전환표를 보고 있다는 뜻이라
  //     플레이어에게 보여 줄 숫자가 없다. 그 자리까지 문구를 지어내면 화면이
  //     "결계"라고 말해 놓고 올려야 할 숙련이 애초에 없는 상태가 된다.
  it('결계가 아닌 거절에는 말이 없다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'no_transition' }, 400)),
    )
    const first = barriers[0]!
    standingAt(first.transition.fromMap, first.transition.fromX, first.transition.fromY, first.skill, 0)

    await expect(
      useGameStore.getState().move(first.transition.fromX, first.transition.fromY),
    ).rejects.toThrow()

    expect(useGameStore.getState().notice).toBeNull()
  })
})

/*
 * 허브 결계는 조건 둘을 진다 — 숙련과 물때(결계 설계 §6·§9-앞 17). 그래서
 * 화면도 **막힌 이유를 갈라서** 말해야 한다: 하나는 캐면 열리는 문이고 하나는
 * 기다리면 열리는 문이라, 같은 문구로 뭉치면 플레이어가 할 일을 알 수 없다.
 */
describe('결계 — 물때에 막힌 것과 숙련에 막힌 것을 갈라 말한다(결계 설계 §6)', () => {
  /** 물때를 지는 문. 데이터가 진실이라 여기서도 찾아서 쓴다. */
  const tideDoor = loadGameData().transitions.find((t) => t.gateTide === true)!

  /** 결계 앞에 선 사람 — 그 계열 숙련만 채운다. */
  function standingAtTideDoor(have: number): void {
    const base = emptyPlayer()
    useGameStore.setState({
      player: {
        ...base,
        skills: { ...base.skills, [tideDoor.gateSkill!]: have },
        location: { mapId: tideDoor.fromMap, x: tideDoor.fromX, y: tideDoor.fromY },
      },
      notice: null,
    })
  }

  /** 게임 시각 `hour` 가 되는 실제 시각(epoch ms). */
  function gameHourMs(hour: number): number {
    return GAME_EPOCH_MS + (hour / 24) * REAL_MS_PER_GAME_DAY
  }

  /** 게임 시각 `hour` 에 세계를 세운다. 앵커를 버려 worldNow() 가 이 시계를 읽게 한다. */
  function atGameHour(hour: number): void {
    resetClock()
    vi.setSystemTime(gameHourMs(hour))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => jsonResponse({ code: 'locked' }, 400)),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    resetClock()
  })

  // 왜: 이 문구가 없으면 85,000 을 넘긴 사람이 보는 것은 "칸을 밟았는데 안
  //     넘어갔다" 하나뿐이다 — 방금 채운 숙련이 헛것이었다고 읽힌다.
  it('숙련이 되는데 물이 차 있으면 물때를 말한다', async () => {
    standingAtTideDoor(tideDoor.gateValue!)
    atGameHour(TIDE_WINDOWS[0]!.end)

    await expect(useGameStore.getState().move(tideDoor.fromX, tideDoor.fromY)).rejects.toThrow()

    expect(useGameStore.getState().notice?.text).toBe(
      '결계가 밀어낸다 — 물이 빠질 때만 열린다 (02시~08시 · 14시~20시, 지금 08시)',
    )
  })

  // 왜: 둘 다 막혔을 때 물때부터 말하면, 숙련 1,000 인 사람이 여섯 시간을
  //     기다렸다가 같은 자리에서 또 막힌다. 숙련은 캐면 오르는 숫자라 먼저
  //     말할 값어치가 있고, 물때는 그 숫자를 채운 뒤에야 뜻이 있다.
  it('숙련도 모자라면 물때가 아니라 숙련을 말한다', async () => {
    standingAtTideDoor(63_240)
    atGameHour(TIDE_WINDOWS[0]!.end)

    await expect(useGameStore.getState().move(tideDoor.fromX, tideDoor.fromY)).rejects.toThrow()

    expect(useGameStore.getState().notice?.text).toBe(
      `결계가 밀어낸다 — ${SKILL_LABELS[tideDoor.gateSkill!]} 숙련 ${tideDoor.gateValue!.toLocaleString('ko-KR')} (지금 63,240)`,
    )
  })

  // 왜: **열리는 경계에서 화면이 침묵하던 창**이 있었다. 세계 시각은 왕복
  //     지연과 기울임(최대 2초)만큼 서버보다 늘 나중이라, 서버가 01시로 재
  //     거절한 요청을 화면은 02시로 읽어 "물이 빠져 있다"고 판단했다 — 그러면
  //     두 분기가 다 비껴가 아무 말도 안 남고, 플레이어는 되밀린 채 이유를
  //     못 듣는다. 물때를 기다리다 열리는 순간 문을 두드리는 사람이 정확히
  //     이 창을 밟는다. 그래서 문구는 **거절이 지고 온 시각**으로 짓는다.
  it('서버가 01시로 거절했으면 화면 시계가 02시여도 그 01시를 말한다', async () => {
    const justBeforeOpen = gameHourMs(TIDE_WINDOWS[0]!.start) - 1
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        jsonResponse({ code: 'locked' }, 400, { 'x-server-now': String(justBeforeOpen) }),
      ),
    )
    standingAtTideDoor(tideDoor.gateValue!)
    atGameHour(TIDE_WINDOWS[0]!.start) // 화면 시계는 이미 물이 빠졌다고 본다

    await expect(useGameStore.getState().move(tideDoor.fromX, tideDoor.fromY)).rejects.toThrow()

    expect(useGameStore.getState().notice?.text).toBe(
      '결계가 밀어낸다 — 물이 빠질 때만 열린다 (02시~08시 · 14시~20시, 지금 01시)',
    )
  })

  // 왜: 몸이 되밀렸는데 화면이 침묵하는 것이 가장 나쁘다 — 플레이어가 보는
  //     것은 "칸을 밟았는데 아무 일도 안 일어났다"뿐이고 고장과 구별되지
  //     않는다. 시각을 못 받아 조건이 전부 열려 보이는 찰나에도 한 줄은 선다.
  it('이유를 못 대는 찰나에도 밀려났다는 말은 남는다', async () => {
    standingAtTideDoor(tideDoor.gateValue!)
    atGameHour(TIDE_WINDOWS[0]!.start) // 화면 시계로는 숙련도 물때도 열려 있다

    await expect(useGameStore.getState().move(tideDoor.fromX, tideDoor.fromY)).rejects.toThrow()

    expect(useGameStore.getState().notice?.text).toBe('결계가 밀어낸다')
  })
})

/*
 * 노드가 지는 조건 — 날씨·시각(노드 종류 설계 §3·§9-1). 결계가 밀려날 때 숫자를
 * 말하는 그 자리와 같은 문법이고, 같은 이유로 **판정이 본 시각**으로 짓는다.
 *
 * 결계와 갈리는 지점은 하나다: 결계는 그 앞에 설 수 있는가를 막고 이것은 그 앞에
 * 선 사람이 지금 캘 수 있는가를 막는다. 그래서 문구도 "밀어낸다"가 아니라
 * "캘 수 있다"로 적힌다 — 이 사람은 밀려나지 않았고 그 자리에 그대로 서 있다.
 */
describe('노드 조건 — 닫힌 노드 앞에서 무엇이 필요한지 말한다(노드 종류 설계 §9-1)', () => {
  const 눈올때 = {
    id: 'red_ice_vein', name: '붉은 얼음 광맥', skill: 'ice' as SkillId, tableId: 'ice_special',
    variant: 'special' as const, sprite: 'red_ice_vein', requireWeather: 'snow' as const,
  }
  const 밤에 = { ...눈올때, id: 'starfall_site', requireWeather: undefined, requireTime: 'night' as const }
  const 물때에 = { ...눈올때, id: 'frost_bloom', requireWeather: undefined, requireTime: 'tide' as const }
  const 눈오는물때 = { ...눈올때, id: 'both', requireTime: 'tide' as const }
  const 비올때 = { ...눈올때, id: 'lightning_tree', requireWeather: 'rain' as const }

  /** 조건을 진 노드 넷을 세계에 얹는다 — 출하 8행은 전부 조건이 없다(그것이 이 아크의 약속이다). */
  function worldWithClosedNodes(): void {
    const base = loadGameData()
    useGameStore.setState({
      data: {
        ...base,
        nodes: {
          ...base.nodes,
          red_ice_vein: 눈올때, starfall_site: 밤에, frost_bloom: 물때에, both: 눈오는물때,
          lightning_tree: 비올때,
        },
        placements: {
          ...base.placements,
          'red_ice_vein-1': { instanceId: 'red_ice_vein-1', nodeId: 'red_ice_vein', mapId: '얼음채집장', x: 11, y: 3 },
          'starfall_site-1': { instanceId: 'starfall_site-1', nodeId: 'starfall_site', mapId: '얼음채집장', x: 12, y: 3 },
          'frost_bloom-1': { instanceId: 'frost_bloom-1', nodeId: 'frost_bloom', mapId: '얼음채집장', x: 13, y: 3 },
          'both-1': { instanceId: 'both-1', nodeId: 'both', mapId: '얼음채집장', x: 14, y: 3 },
          'lightning_tree-1': { instanceId: 'lightning_tree-1', nodeId: 'lightning_tree', mapId: '얼음채집장', x: 15, y: 3 },
        },
      },
      notice: null,
    })
  }

  function gameHourMs(hour: number): number {
    return GAME_EPOCH_MS + (hour / 24) * REAL_MS_PER_GAME_DAY
  }

  function atGameHour(hour: number): void {
    resetClock()
    vi.setSystemTime(gameHourMs(hour))
  }

  /** 그 하늘을 지금 이 사람에게 걸어 둔다. 만료는 시각 비교 하나다(weather.ts). */
  function standingWithWeather(weather: { kind: 'rain' | 'snow'; untilMs: number } | null): void {
    useGameStore.setState({ player: { ...emptyPlayer(), weather } })
  }

  function rejectClosed(serverNowMs?: number): void {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () =>
        jsonResponse(
          { code: 'node_closed' },
          400,
          serverNowMs === undefined ? {} : { 'x-server-now': String(serverNowMs) },
        ),
      ),
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    worldWithClosedNodes()
    standingWithWeather(null)
    rejectClosed()
  })

  afterEach(() => {
    vi.useRealTimers()
    resetClock()
  })

  // 왜: 이 문구가 없으면 붉은 얼음 광맥 앞에서 A 를 누른 사람이 보는 것은
  //     "아무 일도 안 일어났다" 하나뿐이고, 그것은 고장과 구별되지 않는다.
  //     조건이 §3 의 중심인데 화면이 조건을 한 번도 말하지 않는 상태가 된다.
  it('날씨 조건을 말한다', async () => {
    atGameHour(12)
    await useGameStore.getState().gather('red_ice_vein-1')
    expect(useGameStore.getState().notice?.text).toBe('눈이 올 때만 캘 수 있다')
  })

  // 왜: 하늘에는 'clear' 가 없다(weather.ts 가 자리표시를 거부한다) — 아무것도
  //     안 내릴 때 "지금 맑음"을 지어내면 화면이 데이터에 없는 낱말을 만든다.
  //     다른 하늘이 걸려 있을 때만 그 이름이 있고, 그때는 적어 줘야 한다:
  //     비 가루를 방금 쓴 사람이 왜 안 열리는지를 그 괄호가 말한다.
  it('다른 하늘이 걸려 있으면 그 하늘의 이름을 함께 적는다', async () => {
    atGameHour(12)
    standingWithWeather({ kind: 'rain', untilMs: gameHourMs(12) + 60_000 })
    await useGameStore.getState().gather('red_ice_vein-1')
    expect(useGameStore.getState().notice?.text).toBe('눈이 올 때만 캘 수 있다 (지금 비)')
  })

  // 왜: 하늘의 이름은 데이터가 준다(WEATHER_LABELS) — 그러면 조사가 그 낱말에
  //     직접 닿는다. "비이 올 때만" 이 나오는 순간 화면이 한국어를 못 쓰는
  //     것으로 보이고, 그 줄은 이 아크가 자랑하려는 바로 그 문장이다. 그래서
  //     받침 규칙을 코드가 지고, 두 하늘 다 문장으로 확인한다.
  it('받침이 없는 하늘에는 다른 조사가 붙는다 — "비가"', async () => {
    atGameHour(12)
    await useGameStore.getState().gather('lightning_tree-1')
    expect(useGameStore.getState().notice?.text).toBe('비가 올 때만 캘 수 있다')
  })

  // 왜: 물때는 기다리면 열리는 조건이라 **몇 시에** 열리는지가 곧 할 일이다.
  //     결계의 안내판이 시각을 숫자로 새긴 그 이유가 여기에도 그대로 선다.
  it('물때 조건은 창과 지금 시각을 함께 말한다', async () => {
    atGameHour(11)
    await useGameStore.getState().gather('frost_bloom-1')
    expect(useGameStore.getState().notice?.text).toBe(
      '물이 빠질 때만 캘 수 있다 (02시~08시 · 14시~20시, 지금 11시)',
    )
  })

  it('밤 조건도 창과 지금 시각을 함께 말한다', async () => {
    atGameHour(12)
    await useGameStore.getState().gather('starfall_site-1')
    expect(useGameStore.getState().notice?.text).toBe(
      '밤에만 캘 수 있다 (21시~24시 · 00시~04시, 지금 12시)',
    )
  })

  // 왜: 둘 다 막혔으면 **부를 수 있는 쪽**을 먼저 말한다. 시각은 기다리는 것
  //     말고 할 수 있는 일이 없지만 날씨는 가루로 부른다(§3) — 물때부터 말하면
  //     여섯 시간을 기다린 사람이 같은 자리에서 눈이 없어 또 막힌다. 결계가
  //     물때보다 숙련을 먼저 말하는 그 저울과 같다.
  it('둘 다 막혔으면 시각이 아니라 날씨를 먼저 말한다', async () => {
    atGameHour(11)
    await useGameStore.getState().gather('both-1')
    expect(useGameStore.getState().notice?.text).toBe('눈이 올 때만 캘 수 있다')
  })

  // 왜: 결계가 밟은 그 창이다. 세계 시각은 왕복 지연과 기울임(최대 2초)만큼
  //     서버보다 늘 나중이라, 서버가 01시로 재 거절한 요청을 화면이 02시로
  //     읽으면 조건이 열려 보여 아무 말도 안 남는다. 물때를 기다리다 열리는
  //     순간 A 를 누르는 사람이 정확히 이 창을 밟는다.
  it('서버가 01시로 거절했으면 화면 시계가 02시여도 그 01시를 말한다', async () => {
    rejectClosed(gameHourMs(TIDE_WINDOWS[0]!.start) - 1)
    atGameHour(TIDE_WINDOWS[0]!.start)

    await useGameStore.getState().gather('frost_bloom-1')

    expect(useGameStore.getState().notice?.text).toBe(
      '물이 빠질 때만 캘 수 있다 (02시~08시 · 14시~20시, 지금 01시)',
    )
  })

  // 왜: 이유를 못 대는 찰나에도 침묵하지 않는다 — 결계의 그 자리와 같은 이유다.
  //     A 를 눌렀는데 아무 일도 안 일어난 화면은 고장과 구별되지 않는다.
  //     `node_closed` 는 서버가 조건에만 쓰는 코드이므로 "지금은 캘 수 없다"는
  //     이유를 못 대도 그 자체로 참이다.
  it('이유를 못 대는 찰나에도 캘 수 없다는 말은 남는다', async () => {
    atGameHour(TIDE_WINDOWS[0]!.start) // 화면 시계로는 물이 빠져 있다
    await useGameStore.getState().gather('frost_bloom-1')
    expect(useGameStore.getState().notice?.text).toBe('지금은 캘 수 없다')
  })

  // 왜: 조건이 없는 노드에서 이 코드가 오는 것은 클라와 서버의 데이터가 갈라졌다는
  //     뜻이다. 그때도 침묵하면 안 되지만 없는 조건을 지어내서도 안 된다.
  it('조건 없는 노드가 닫혔다고 오면 조건을 지어내지 않는다', async () => {
    atGameHour(12)
    const 출하노드 = Object.values(loadGameData().placements)[0]!
    await useGameStore.getState().gather(출하노드.instanceId)
    expect(useGameStore.getState().notice?.text).toBe('지금은 캘 수 없다')
  })
})
