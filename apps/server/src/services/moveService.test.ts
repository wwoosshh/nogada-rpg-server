import { emptyDialogueHistory, type GameData, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { moveThroughTransition } from './moveService.js'

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
  ],
  placements: {},
  milestones: [],
  speakers: {},
  shops: {}, masters: [], enhanceCosts: [], collection: {},
  places: {}, schedules: {}, routes: [],
  dialogue: [],
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
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: '얼음채집장', x: 3, y: 1 },
    ...overrides,
  }
}

describe('moveThroughTransition', () => {
  it('전환 칸을 밟으면 그 전환의 도착 맵·칸으로 옮긴다', () => {
    const r = moveThroughTransition({ player: player(), data, x: 3, y: 0 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '눈의마을', x: 10, y: 13 })
  })

  // 왜: 목적지를 요청이 정하게 하면 클라이언트가 아무 맵 아무 칸으로나
  //     순간이동할 수 있다. 요청은 "어느 칸을 밟았다"만 말하고, 그 칸에서
  //     어디로 가는지는 서버가 data.transitions 에서 찾는다.
  it('전환이 없는 칸을 밟았다고 하면 거절한다', () => {
    const r = moveThroughTransition({ player: player(), data, x: 3, y: 5 })
    expect(r).toEqual({ ok: false, code: 'no_transition' })
  })

  // 왜: 전환은 출발 맵에 매여 있다. 맵을 보지 않고 좌표만 맞추면 눈의마을
  //     (3,0) 에 서서 얼음채집장의 전환을 탈 수 있다 — 두 맵이 같은 좌표를 갖는
  //     것은 규칙이 아니라 우연이다.
  it('좌표는 같아도 다른 맵의 전환은 타지 못한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 3, y: 0 } })
    const r = moveThroughTransition({ player: p, data, x: 3, y: 0 })
    expect(r).toEqual({ ok: false, code: 'no_transition' })
  })

  it('되돌아오는 전환도 같은 방식으로 판정한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 10, y: 13 } })
    const r = moveThroughTransition({ player: p, data, x: 10, y: 14 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '얼음채집장', x: 3, y: 1 })
  })

  // 왜: 다른 서비스들과 같은 약속이다. 인자로 받은 상태를 제자리에서 고치면
  //     라우트가 저장에 실패했을 때 저장소 안의 플레이어만 조용히 움직여 있다.
  it('넘겨받은 플레이어를 제자리에서 고치지 않는다', () => {
    const p = player()
    moveThroughTransition({ player: p, data, x: 3, y: 0 })
    expect(p.location).toEqual({ mapId: '얼음채집장', x: 3, y: 1 })
  })

  // 왜: 위치 말고는 아무것도 달라지지 않아야 한다. 걸어서 맵을 넘는 것은
  //     행동이 아니라 이동이라, 채집·제작의 간격에 묶이면 가장자리를 밟는
  //     것만으로 노가다 속도가 느려진다.
  it('행동 간격을 건드리지 않는다', () => {
    const p = player({ nextActionAt: 9999 })
    const r = moveThroughTransition({ player: p, data, x: 3, y: 0 })
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

    const r = moveThroughTransition({ player: p, data, x: 5, y: 4 })
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

    const r = moveThroughTransition({ player: p, data, x: 5, y: 4 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    // 위치 말고는 아무것도 달라지지 않는다 — 결계를 넘는 것도 이동일 뿐이다.
    expect(r.outcome.player).toEqual(expected)
  })

  // 왜: 경계값이 어느 쪽인지는 데이터 작가와 화면이 함께 믿어야 하는 사실이다.
  //     이 저장소의 모든 문이 `>=` 로 열린다(진열·레시피 문턱).
  it('정확히 85,000 은 열린다 — 84,999 는 아니다', () => {
    expect(moveThroughTransition({ player: atGate(85_000), data, x: 5, y: 4 }).ok).toBe(true)
    expect(moveThroughTransition({ player: atGate(84_999), data, x: 5, y: 4 }).ok).toBe(false)
  })

  // 왜: 나오는 문에 게이트를 걸면 결계 안의 세이브가 영구히 갇힌다(§9-앞 16).
  //     빌드가 그것을 막지만(validateTransitions), 서버도 게이트 없는 전환을
  //     조건 없이 통과시켜야 그 규범이 실제로 성립한다.
  it('나오는 문은 숙련과 무관하게 열린다', () => {
    const p = player({ location: { mapId: '얼음채집장', x: 5, y: 3 } })
    const r = moveThroughTransition({ player: p, data, x: 5, y: 2 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '얼음채집장', x: 5, y: 4 })
  })

  // 왜: 맵을 넘는 것은 아무것도 만들지 않는 이동이라 노가다 속도에 묶을 것이
  //     없다(이 파일 머리의 주석). 거절도 마찬가지다 — 결계에 부딪힌 것을
  //     쿨다운으로 벌하면 가장자리를 밟는 것만으로 채집이 느려진다.
  it('거절도 통과도 행동 간격을 건드리지 않는다', () => {
    const blocked = player({ nextActionAt: 9999, location: { mapId: '얼음채집장', x: 5, y: 5 } })
    moveThroughTransition({ player: blocked, data, x: 5, y: 4 })
    expect(blocked.nextActionAt).toBe(9999)

    const p = atGate(90_000)
    p.nextActionAt = 9999
    const r = moveThroughTransition({ player: p, data, x: 5, y: 4 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.nextActionAt).toBe(9999)
  })
})
