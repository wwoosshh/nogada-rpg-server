import { emptyDialogueHistory, type GameData, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { moveThroughTransition } from './moveService.js'

const data: GameData = {
  items: {},
  nodes: {},
  recipes: {},
  maps: {
    world: { id: 'world', name: '얼음 채집장', file: 'world.tmx', width: 30, height: 30, spawn: { x: 15, y: 16 } },
    시험숲: { id: '시험숲', name: '시험 숲', file: '시험숲.tmx', width: 20, height: 15, spawn: { x: 10, y: 7 } },
  },
  transitions: [
    { fromMap: 'world', fromX: 3, fromY: 0, toMap: '시험숲', toX: 10, toY: 13, facing: 'up' },
    { fromMap: '시험숲', fromX: 10, fromY: 14, toMap: 'world', toX: 3, toY: 1, facing: 'down' },
  ],
  placements: {},
  milestones: [],
  speakers: {},
  dialogue: [],
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: 'world', x: 3, y: 1 },
    ...overrides,
  }
}

describe('moveThroughTransition', () => {
  it('전환 칸을 밟으면 그 전환의 도착 맵·칸으로 옮긴다', () => {
    const r = moveThroughTransition({ player: player(), data, x: 3, y: 0 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: '시험숲', x: 10, y: 13 })
  })

  // 왜: 목적지를 요청이 정하게 하면 클라이언트가 아무 맵 아무 칸으로나
  //     순간이동할 수 있다. 요청은 "어느 칸을 밟았다"만 말하고, 그 칸에서
  //     어디로 가는지는 서버가 data.transitions 에서 찾는다.
  it('전환이 없는 칸을 밟았다고 하면 거절한다', () => {
    const r = moveThroughTransition({ player: player(), data, x: 3, y: 5 })
    expect(r).toEqual({ ok: false, code: 'no_transition' })
  })

  // 왜: 전환은 출발 맵에 매여 있다. 맵을 보지 않고 좌표만 맞추면 시험숲
  //     (3,0) 에 서서 world 의 전환을 탈 수 있다 — 두 맵이 같은 좌표를 갖는
  //     것은 규칙이 아니라 우연이다.
  it('좌표는 같아도 다른 맵의 전환은 타지 못한다', () => {
    const p = player({ location: { mapId: '시험숲', x: 3, y: 0 } })
    const r = moveThroughTransition({ player: p, data, x: 3, y: 0 })
    expect(r).toEqual({ ok: false, code: 'no_transition' })
  })

  it('되돌아오는 전환도 같은 방식으로 판정한다', () => {
    const p = player({ location: { mapId: '시험숲', x: 10, y: 13 } })
    const r = moveThroughTransition({ player: p, data, x: 10, y: 14 })
    if (!r.ok) throw new Error(`성공해야 한다: ${r.code}`)
    expect(r.outcome.player.location).toEqual({ mapId: 'world', x: 3, y: 1 })
  })

  // 왜: 다른 서비스들과 같은 약속이다. 인자로 받은 상태를 제자리에서 고치면
  //     라우트가 저장에 실패했을 때 저장소 안의 플레이어만 조용히 움직여 있다.
  it('넘겨받은 플레이어를 제자리에서 고치지 않는다', () => {
    const p = player()
    moveThroughTransition({ player: p, data, x: 3, y: 0 })
    expect(p.location).toEqual({ mapId: 'world', x: 3, y: 1 })
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
