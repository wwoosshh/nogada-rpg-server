import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { transitionGate } from './transitionGate.js'
import type { PlayerState, TransitionDef } from './types.js'

const door: TransitionDef = {
  fromMap: '얼음채집장', fromX: 5, fromY: 4,
  toMap: '얼음채집장', toX: 5, toY: 2,
  facing: 'up',
  gateSkill: 'ice',
  gateValue: 85000,
}

/** 나오는 문 — 게이트가 없다. 결계 안의 사람은 숙련과 무관하게 걸어 나온다. */
const backDoor: TransitionDef = {
  fromMap: '얼음채집장', fromX: 5, fromY: 2,
  toMap: '얼음채집장', toX: 5, toY: 4,
  facing: 'down',
}

function player(ice: number): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    weather: null,
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: '얼음채집장', x: 5, y: 4 },
  }
}

describe('transitionGate', () => {
  // 왜: 게이트 없는 문이 대다수다(출하된 전환 18줄). 그 문들에 대해 "열려 있다"
  //     라는 진척을 지어 내면 화면이 아무 문 앞에서나 숫자를 말하게 된다.
  it('게이트가 없으면 null 이다 — 잴 것이 없다', () => {
    expect(transitionGate(backDoor, player(0))).toBeNull()
  })

  // 왜: 화면이 "결계가 밀어낸다 — 얼음 숙련 85,000 (지금 12,340)" 을 조립하려면
  //     필요치와 현재치를 둘 다 받아야 한다. 열림 여부만 돌려주면 화면이 부등호를
  //     다시 갖게 되고, 그러면 서버와 갈라지는 날이 온다(§9-앞 13).
  it('막힌 문은 필요치와 현재치를 함께 돌려준다', () => {
    expect(transitionGate(door, player(12340))).toEqual({
      skill: 'ice', need: 85000, have: 12340, open: false,
    })
  })

  // 왜: 경계값이 어느 쪽인지는 데이터 작가와 화면이 함께 믿어야 하는 사실이다.
  //     정확히 85,000 인 사람은 통과한다 — 상점 진열(isStockUnlocked)·레시피
  //     문턱과 같은 `>=` 다. 이 저장소의 모든 문이 같은 방향으로 열린다.
  it('정확히 요구치면 열린다 (>=)', () => {
    expect(transitionGate(door, player(85000))?.open).toBe(true)
    expect(transitionGate(door, player(84999))?.open).toBe(false)
  })

  it('넘으면 열린 채로 숫자도 그대로 준다', () => {
    expect(transitionGate(door, player(120000))).toEqual({
      skill: 'ice', need: 85000, have: 120000, open: true,
    })
  })

  // 왜: 재는 숙련은 언제나 그 문이 적어 둔 계열이다. 다른 계열이 아무리 높아도
  //     얼음 결계는 얼음으로 연다 — shopAccess 가 상점 계열만 재는 것과 같다.
  it('그 문이 적어 둔 계열만 잰다', () => {
    const p = player(0)
    p.skills.mineral = 999999
    expect(transitionGate(door, p)?.open).toBe(false)
  })
})
