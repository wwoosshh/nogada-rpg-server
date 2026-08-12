import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import type { PlayerState } from './types.js'
import {
  achievedIds,
  isAchieved,
  metricValue,
  milestoneRatio,
  newlyAchieved,
  type MilestoneDef,
} from './milestones.js'

function player(skills: Partial<PlayerState['skills']> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...skills },
    stacks: {},
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
    // 이 판정들은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
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

/**
 * every 분기는 지금까지 nextMilestone 비교를 통해서만 간접적으로 돌았다 —
 * 직접 값을 확인하는 테스트가 없었다. 이 분기는 목록 정렬(buildMilestoneRows,
 * apps/client/src/game/detailMenuTabs.ts)이 화면 순서를 정하는 데도 그대로
 * 쓰이고, 병목(최솟값) 규칙은 이 모듈에서 가장 미묘한 설계 결정이다 — 그래서
 * 따로 판을 짠다.
 */
describe('milestoneRatio — every', () => {
  it('둘이 다르게 진행 중이면 더 처진 쪽(최솟값)을 쓴다 — 평균이나 최댓값이 아니다', () => {
    // ice 500/1000=0.5, mineral 200/1000=0.2 → 병목은 mineral 이다.
    expect(milestoneRatio(bothNovice, player({ ice: 500, mineral: 200 }), all)).toBe(0.2)
  })
  it('하나가 0이면 나머지가 얼마든 전체는 0이다', () => {
    // mineral 은 이미 문턱을 넘겼어도(비율 1) ice 가 0 이면 병목은 ice 다.
    // metricValue(달성 개수)/threshold 였다면 여기서 0.5(둘 중 하나 달성)를
    // 보고했을 자리다 — milestoneRatio 문서가 경고하는 바로 그 오판이다.
    expect(milestoneRatio(bothNovice, player({ ice: 0, mineral: 1000 }), all)).toBe(0)
  })
  it('하나가 이미 완료여도 나머지가 병목이면 나머지의 비율을 그대로 쓴다', () => {
    // ice 는 완료(비율 1), mineral 은 300/1000=0.3 진행 중 → 0.3 이어야 한다.
    // "하나는 끝났으니 절반은 왔다"는 개수 비율의 착시를 피하는 것이 이
    // 규칙의 존재 이유다.
    expect(milestoneRatio(bothNovice, player({ ice: 1000, mineral: 300 }), all)).toBe(0.3)
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
