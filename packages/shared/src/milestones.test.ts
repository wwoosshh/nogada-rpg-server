import { describe, expect, it } from 'vitest'
import type { PlayerState } from './types.js'
import {
  achievedIds,
  isAchieved,
  metricValue,
  milestoneRatio,
  newlyAchieved,
  nextMilestone,
  type MilestoneDef,
} from './milestones.js'

function player(skills: Partial<PlayerState['skills']> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...skills },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
  }
}

const iceNovice: MilestoneDef = {
  id: 'ice-1000', metric: { kind: 'skill', skill: 'ice' }, threshold: 1000,
  name: '얼음에 익숙해지다', announce: '얼음에 익숙해졌다', effect: { kind: 'title' },
}
const mineralNovice: MilestoneDef = {
  id: 'mineral-1000', metric: { kind: 'skill', skill: 'mineral' }, threshold: 1000,
  name: '광물에 익숙해지다', announce: '광물에 익숙해졌다', effect: { kind: 'title' },
}
const bothNovice: MilestoneDef = {
  id: 'both-1000', metric: { kind: 'every', of: ['ice-1000', 'mineral-1000'] }, threshold: 2,
  name: '고르게 익숙해지다', announce: '두 기술이 고르게 올랐다', effect: { kind: 'title' },
}
const all = [iceNovice, mineralNovice, bothNovice]

describe('isAchieved — skill', () => {
  it('문턱 미만이면 달성이 아니다', () => {
    expect(isAchieved(iceNovice, player({ ice: 999 }), all)).toBe(false)
  })
  it('문턱에 닿으면 달성이다', () => {
    expect(isAchieved(iceNovice, player({ ice: 1000 }), all)).toBe(true)
  })
  it('다른 기술은 보지 않는다', () => {
    expect(isAchieved(iceNovice, player({ mineral: 999999 }), all)).toBe(false)
  })
})

describe('isAchieved — every', () => {
  it('하나만 채우면 달성이 아니다', () => {
    expect(isAchieved(bothNovice, player({ ice: 5000 }), all)).toBe(false)
  })
  it('둘 다 채우면 달성이다', () => {
    expect(isAchieved(bothNovice, player({ ice: 1000, mineral: 1000 }), all)).toBe(true)
  })
  it('없는 이정표를 가리키면 달성될 수 없다', () => {
    // 데이터 검증이 막지만, 막지 못했을 때 조용히 참이 되면 안 된다.
    const ghost: MilestoneDef = {
      ...bothNovice, id: 'ghost', metric: { kind: 'every', of: ['nope'] }, threshold: 1,
    }
    expect(isAchieved(ghost, player({ ice: 999999, mineral: 999999 }), [...all, ghost])).toBe(false)
  })
})

describe('metricValue', () => {
  it('기술은 그 숙련도다', () => {
    expect(metricValue(iceNovice, player({ ice: 42 }), all)).toBe(42)
  })
  it('합산은 달성한 개수다', () => {
    expect(metricValue(bothNovice, player({ ice: 1000 }), all)).toBe(1)
    expect(metricValue(bothNovice, player({ ice: 1000, mineral: 1000 }), all)).toBe(2)
  })
})

describe('milestoneRatio', () => {
  it('0 에서 0, 문턱에서 1 이다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 0 }), all)).toBe(0)
    expect(milestoneRatio(iceNovice, player({ ice: 1000 }), all)).toBe(1)
  })
  it('문턱을 넘어도 1 을 넘지 않는다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 99999 }), all)).toBe(1)
  })
  it('절반이면 0.5 다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 500 }), all)).toBe(0.5)
  })
})

describe('achievedIds', () => {
  it('달성한 것만 담는다', () => {
    const ids = achievedIds(all, player({ ice: 1000 }))
    expect([...ids].sort()).toEqual(['ice-1000'])
  })
  it('합산 이정표도 함께 잡힌다', () => {
    const ids = achievedIds(all, player({ ice: 1000, mineral: 1000 }))
    expect([...ids].sort()).toEqual(['both-1000', 'ice-1000', 'mineral-1000'])
  })
})

describe('newlyAchieved', () => {
  it('축하하지 않은 것만 준다', () => {
    const fresh = newlyAchieved(all, player({ ice: 1000 }), ['ice-1000'])
    expect(fresh).toEqual([])
  })
  it('축하 이력이 비어 있으면 달성한 것을 전부 준다', () => {
    const fresh = newlyAchieved(all, player({ ice: 1000 }), [])
    expect(fresh.map((m) => m.id)).toEqual(['ice-1000'])
  })
  it('축하 이력에 없는 id 가 있어도 무시한다', () => {
    // 이정표를 지운 뒤에도 옛 세이브가 살아 있어야 한다.
    const fresh = newlyAchieved(all, player({ ice: 1000 }), ['사라진것'])
    expect(fresh.map((m) => m.id)).toEqual(['ice-1000'])
  })
})

describe('nextMilestone', () => {
  it('가장 가까운 것을 준다', () => {
    // ice 900/1000 = 0.9, mineral 100/1000 = 0.1 → 얼음이 더 가깝다
    const next = nextMilestone(all, player({ ice: 900, mineral: 100 }))
    expect(next?.id).toBe('ice-1000')
  })
  it('이미 달성한 것은 고르지 않는다', () => {
    const next = nextMilestone(all, player({ ice: 1000, mineral: 100 }))
    expect(next?.id).toBe('mineral-1000')
  })
  it('전부 달성했으면 null 이다', () => {
    expect(nextMilestone(all, player({ ice: 9999, mineral: 9999 }))).toBeNull()
  })
  it('같은 비율이면 순서가 흔들리지 않는다', () => {
    // 매 프레임 다른 것을 보여주면 상단 바가 깜빡인다.
    const p = player({ ice: 500, mineral: 500 })
    expect(nextMilestone(all, p)?.id).toBe(nextMilestone(all, p)?.id)
  })
})
