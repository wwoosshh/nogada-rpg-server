import {
  defaultCombatState,
  emptyDialogueHistory,
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_DAY,
  TIDE_WINDOWS,
  type GameData,
  type PlayerState,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { moveThroughTransition } from './moveService.js'

/** epoch 당일의 게임 시각 `hour` 에 해당하는 실제 시각 */
const atHour = (hour: number): number => GAME_EPOCH_MS + (hour / 24) * REAL_MS_PER_GAME_DAY

/**
 * 물이 빠져 있는 시각. 물때를 안 지는 문의 검사는 이 값이 무엇이든 결과가
 * 같아야 하므로, 스위트 전체가 이것 하나를 쓴다.
 */
const LOW_TIDE = atHour(TIDE_WINDOWS[0]!.start)
/** 물이 차 있는 시각 — 창의 끝은 이미 물이 든 시각이다. */
const HIGH_TIDE = atHour(TIDE_WINDOWS[0]!.end)

const data: GameData = {
  items: {},
  nodes: {},
  recipes: {},
  maps: {
    얼음채집장: {
      id: '얼음채집장', name: '얼음 채집장', file: '얼음채집장.tmx', width: 30, height: 30, spawn: { x: 15, y: 16 },
    },
    눈의마을: {
      id: '눈의마을', name: '눈의 마을', file: '눈의마을.tmx', width: 30, height: 31, spawn: { x: 15, y: 20 },
    },
    허브채집장: {
      id: '허브채집장', name: '허브 채집장', file: '허브채집장.tmx', width: 34, height: 22, spawn: { x: 1, y: 11 },
    },
  },
  transitions: [
    { fromMap: '얼음채집장', fromX: 3, fromY: 0, toMap: '눈의마을', toX: 10, toY: 13, facing: 'up' },
    { fromMap: '눈의마을', fromX: 10, fromY: 14, toMap: '얼음채집장', toX: 3, toY: 1, facing: 'down' },
    // 결계 한 쌍(설계 §2·§3). `fromMap === toMap` 이다 — 새 맵이 아니라 같은
    // 맵 안에 벽으로 만든 안쪽이라, 밟으면 벽 너머로 선다.
    {
      fromMap: '얼음채집장', fromX: 5, fromY: 4, toMap: '얼음채집장', toX: 5, toY: 2, facing: 'up',
      gateSkill: 'ice', gateValue: 85_000,
    },
    { fromMap: '얼음채집장', fromX: 5, fromY: 2, toMap: '얼음채집장', toX: 5, toY: 4, facing: 'down' },
    // 허브 결계 — 숙련에 물때가 얹힌 유일한 문(설계 §6). 같은 맵 안이라는 것도
    // 위와 같지만, 맵 이름을 얼음과 나눠 두면 두 결계가 서로의 판정에 섞이지 않는다.
    {
      fromMap: '허브채집장', fromX: 29, fromY: 16, toMap: '허브채집장', toX: 29, toY: 14, facing: 'up',
      gateSkill: 'herb', gateValue: 85_000, gateTide: true,
    },
    { fromMap: '허브채집장', fromX: 29, fromY: 14, toMap: '허브채집장', toX: 29, toY: 16, facing: 'down' },
  ],
  placements: {},
  milestones: [],
  speakers: {},
  shops: {}, masters: [], enhanceCosts: [], collection: {},
  places: {}, schedules: {}, routes: [],
  dialogue: [],
  inns: {}, monsters: {}, monsterPlacements: {},
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: '얼음채집장', x: 3, y: 1 },
    ...overrides,
  }
}

describe('moveThroughTransition', () => {
  it('전환 칸을 밟으면 그 전환의 도착 맵·칸으로 옮긴다', () => {
    const r = moveThroughTransition({ player: player(), data, now: LOW_TIDE, x: 3, y: 0 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '눈의마을', x: 10, y: 13 })
  })

  // 왜: 목적지를 요청이 정하게 하면 클라이언트가 아무 맵 아무 칸으로나
  //     순간이동할 수 있다. 요청은 "어느 칸을 밟았다"만 말하고, 그 칸에서
  //     어디로 가는지는 서버가 data.transitions 에서 찾는다.
  it('전환이 없는 칸을 밟았다고 하면 거절한다', () => {
    const r = moveThroughTransition({ player: player(), data, now: LOW_TIDE, x: 3, y: 5 })
    expect(r).toEqual({ ok: false, code: 'no_transition' })
  })

  // 왜: 전환은 출발 맵에 매여 있다. 맵을 보지 않고 좌표만 맞추면 눈의마을
  //     (3,0) 에 서서 얼음채집장의 전환을 탈 수 있다 — 두 맵이 같은 좌표를 갖는
  //     것은 규칙이 아니라 우연이다.
  it('좌표는 같아도 다른 맵의 전환은 타지 못한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 3, y: 0 } })
    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 3, y: 0 })
    expect(r).toEqual({ ok: false, code: 'no_transition' })
  })

  it('되돌아오는 전환도 같은 방식으로 판정한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 10, y: 13 } })
    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 10, y: 14 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '얼음채집장', x: 3, y: 1 })
  })

  // 왜: 다른 서비스들과 같은 약속이다. 인자로 받은 상태를 제자리에서 고치면
  //     라우트가 저장에 실패했을 때 저장소 안의 플레이어만 조용히 움직여 있다.
  it('넘겨받은 플레이어를 제자리에서 고치지 않는다', () => {
    const p = player()
    moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 3, y: 0 })
    expect(p.location).toEqual({ mapId: '얼음채집장', x: 3, y: 1 })
  })

  // 왜: 위치 말고는 아무것도 달라지지 않아야 한다. 걸어서 맵을 넘는 것은
  //     행동이 아니라 이동이라, 채집·제작의 간격에 묶이면 가장자리를 밟는
  //     것만으로 노가다 속도가 느려진다.
  it('행동 간격을 건드리지 않는다', () => {
    const p = player({ nextActionAt: 9999 })
    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 3, y: 0 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.nextActionAt).toBe(9999)
  })
})

/**
 * 결계 — 문에 걸린 숙련 게이트(설계 §2, §9-앞 13·16).
 *
 * 판정 자체는 shared 의 `transitionGate` 가 갖는다. 여기서 묻는 것은 서버가 그
 * 답을 **어떻게 쓰는가**다: 못 넘긴 요청에서 아무것도 바꾸지 않는가, 넘긴
 * 요청은 다른 전환과 똑같이 옮기는가, 그리고 나오는 문은 언제나 열려 있는가.
 */
describe('moveThroughTransition — 결계', () => {
  /** 결계 앞에 선 사람. 이 자리에서 (5,4) 를 밟는다. */
  function atGate(ice: number): PlayerState {
    return player({ location: { mapId: '얼음채집장', x: 5, y: 5 }, skills: { ice, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
  }

  // 왜: 거절은 **아무것도 만들지 않아야** 한다. 거래·헌납의 원자성 불변식과
  //     같은 자세로, 기대 상태를 통째로 지어 통째로 견준다 — 필드를 하나씩
  //     단정하면 새 필드가 생겼을 때 그것이 조용히 변해도 테스트가 초록이다.
  it('요구치에 못 미치면 locked 이고 상태가 전혀 안 바뀐다', () => {
    const p = atGate(63_240)
    const before = structuredClone(p)

    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 5, y: 4 })
    expect(r).toEqual({ ok: false, code: 'locked' })
    // 거절에는 outcome 이 없으므로 바뀐 상태를 실을 자리가 없다. 그래도 입력
    // 객체까지 보는 이유: 서비스가 사본이 아니라 원본 위에서 계산하기 시작하면
    // 거절 경로가 조용히 위치를 옮겨 놓는다.
    expect(p).toEqual(before)
  })

  it('넘기면 벽 너머로 옮겨진다', () => {
    const p = atGate(85_000)
    const expected = structuredClone(p)
    expected.location = { mapId: '얼음채집장', x: 5, y: 2 }

    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 5, y: 4 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    // 위치 말고는 아무것도 달라지지 않는다 — 결계를 넘는 것도 이동일 뿐이다.
    expect(r.outcome.player).toEqual(expected)
  })

  // 왜: 경계값이 어느 쪽인지는 데이터 작가와 화면이 함께 믿어야 하는 사실이다.
  //     이 저장소의 모든 문이 `>=` 로 열린다(진열·레시피 문턱).
  it('정확히 85,000 은 열린다 — 84,999 는 아니다', () => {
    expect(moveThroughTransition({ player: atGate(85_000), data, now: LOW_TIDE, x: 5, y: 4 }).ok).toBe(true)
    expect(moveThroughTransition({ player: atGate(84_999), data, now: LOW_TIDE, x: 5, y: 4 }).ok).toBe(false)
  })

  // 왜: 나오는 문에 게이트를 걸면 결계 안의 세이브가 영구히 갇힌다(§9-앞 16).
  //     빌드가 그것을 막지만(validateTransitions), 서버도 게이트 없는 전환을
  //     조건 없이 통과시켜야 그 규범이 실제로 성립한다.
  it('나오는 문은 숙련과 무관하게 열린다', () => {
    const p = player({ location: { mapId: '얼음채집장', x: 5, y: 3 } })
    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 5, y: 2 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '얼음채집장', x: 5, y: 4 })
  })

  // 왜: 맵을 넘는 것은 아무것도 만들지 않는 이동이라 노가다 속도에 묶을 것이
  //     없다(이 파일 머리의 주석). 거절도 마찬가지다 — 결계에 부딪힌 것을
  //     쿨다운으로 벌하면 가장자리를 밟는 것만으로 채집이 느려진다.
  it('거절도 통과도 행동 간격을 건드리지 않는다', () => {
    const blocked = player({ nextActionAt: 9999, location: { mapId: '얼음채집장', x: 5, y: 5 } })
    moveThroughTransition({ player: blocked, data, now: LOW_TIDE, x: 5, y: 4 })
    expect(blocked.nextActionAt).toBe(9999)

    const p = atGate(90_000)
    p.nextActionAt = 9999
    const r = moveThroughTransition({ player: p, data, now: LOW_TIDE, x: 5, y: 4 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.nextActionAt).toBe(9999)
  })
})

/**
 * 허브 결계 — 숙련 위에 물때가 하나 더 얹힌 문(설계 §6·§9-앞 17).
 *
 * `항구약초지기` 가 처음부터 조건 **둘**을 말했기 때문에 있는 조건이다 —
 * "물이 크게 빠질 때, 저 끝 바위에"(그 줄은 처음에 "빠지는 **날**" 이었고,
 * 물때가 하루 두 번 드는 이상 "날" 이 아니라 나중에 함께 고쳤다).
 * 여기서 묻는 것은 서버가 그 둘을 **함께**
 * 요구하는가, 그리고 **나오는 문은 물때와 무관하게 열려 있는가**다. 뒤의 것이
 * 특히 중요한데, 시각은 플레이어가 올릴 수 있는 숫자가 아니라 나오는 문에
 * 걸리면 그냥 몇 시간짜리 감옥이 되기 때문이다.
 */
describe('moveThroughTransition — 허브 결계의 물때', () => {
  /** 물때 결계 앞에 선 사람. 이 자리에서 (29,16) 을 밟는다. */
  function atTideGate(herb: number): PlayerState {
    return player({
      location: { mapId: '허브채집장', x: 29, y: 17 },
      skills: { ice: 0, wood: 0, mineral: 0, herb, crafting: 0 },
    })
  }

  it('숙련이 되고 물이 빠져 있으면 넘어간다', () => {
    const r = moveThroughTransition({ player: atTideGate(85_000), data, now: LOW_TIDE, x: 29, y: 16 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '허브채집장', x: 29, y: 14 })
  })

  // 왜: 숙련만 걸면 `항구약초지기` 의 "물이 크게 빠질 때" 가 여전히 없는
  //     것을 가리킨다 — 이 아크의 계기가 정확히 그 거짓말이다.
  it('숙련이 돼도 물이 차 있으면 locked 이고 상태가 전혀 안 바뀐다', () => {
    const p = atTideGate(120_000)
    const before = structuredClone(p)

    const r = moveThroughTransition({ player: p, data, now: HIGH_TIDE, x: 29, y: 16 })
    expect(r).toEqual({ ok: false, code: 'locked' })
    expect(p).toEqual(before)
  })

  // 왜: 두 조건이 함께 걸린 문이다. 물때만 맞으면 통과시키는 순간 85,000 이
  //     장식이 된다.
  it('물이 빠져 있어도 숙련이 모자라면 안 열린다', () => {
    expect(moveThroughTransition({ player: atTideGate(63_240), data, now: LOW_TIDE, x: 29, y: 16 }).ok).toBe(false)
  })

  // 왜: **들어가는 것만 막는다**(§9-앞 17). 대사의 "욕심내다 갇힌 사람이
  //     여럿이야" 는 남의 이야기로 남는다 — 우리는 플레이어를 가두지 않는다.
  //     빌드도 이것을 강제하지만(validateTransitions), 서버가 실제로 그렇게
  //     굴러야 그 규범이 성립한다.
  it('나오는 문은 물이 차 있어도 열린다', () => {
    const p = player({ location: { mapId: '허브채집장', x: 29, y: 15 } })
    const r = moveThroughTransition({ player: p, data, now: HIGH_TIDE, x: 29, y: 14 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '허브채집장', x: 29, y: 16 })
  })

  // 왜: 물때가 허브 결계 하나만의 조건이라는 것이 데이터의 약속이다. 얼음
  //     결계가 시각에 흔들리기 시작하면 그 문은 아무 데서도 설명되지 않는다.
  it('물때를 안 지는 결계는 물이 차 있어도 열린다', () => {
    const p = player({
      location: { mapId: '얼음채집장', x: 5, y: 5 },
      skills: { ice: 85_000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    })
    expect(moveThroughTransition({ player: p, data, now: HIGH_TIDE, x: 5, y: 4 }).ok).toBe(true)
  })
})
