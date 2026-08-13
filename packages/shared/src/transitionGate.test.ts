import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { GAME_EPOCH_MS, REAL_MS_PER_GAME_DAY, TIDE_WINDOWS } from './time.js'
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

/** 허브 결계 — 숙련과 물때를 함께 진다(설계 §6). */
const tideDoor: TransitionDef = {
  fromMap: '허브채집장', fromX: 29, fromY: 16,
  toMap: '허브채집장', toX: 29, toY: 14,
  facing: 'up',
  gateSkill: 'herb',
  gateValue: 85000,
  gateTide: true,
}

/** epoch 당일의 게임 시각 `hour` 에 해당하는 실제 시각 */
const atHour = (hour: number): number => GAME_EPOCH_MS + (hour / 24) * REAL_MS_PER_GAME_DAY

/** 물이 빠져 있는 시각 하나와 차 있는 시각 하나 — 창을 옮겨도 따라온다. */
const LOW = atHour(TIDE_WINDOWS[0]!.start)
const HIGH = atHour(TIDE_WINDOWS[0]!.end)

function player(skills: Partial<PlayerState['skills']> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...skills },
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
    expect(transitionGate(backDoor, player(), LOW)).toBeNull()
  })

  // 왜: 화면이 "결계가 밀어낸다 — 얼음 숙련 85,000 (지금 12,340)" 을 조립하려면
  //     필요치와 현재치를 둘 다 받아야 한다. 열림 여부만 돌려주면 화면이 부등호를
  //     다시 갖게 되고, 그러면 서버와 갈라지는 날이 온다(§9-앞 13).
  it('막힌 문은 필요치와 현재치를 함께 돌려준다', () => {
    expect(transitionGate(door, player({ ice: 12340 }), LOW)).toEqual({
      skill: { skill: 'ice', need: 85000, have: 12340, open: false },
      tide: null,
      open: false,
    })
  })

  // 왜: 경계값이 어느 쪽인지는 데이터 작가와 화면이 함께 믿어야 하는 사실이다.
  //     정확히 85,000 인 사람은 통과한다 — 상점 진열(isStockUnlocked)·레시피
  //     문턱과 같은 `>=` 다. 이 저장소의 모든 문이 같은 방향으로 열린다.
  it('정확히 요구치면 열린다 (>=)', () => {
    expect(transitionGate(door, player({ ice: 85000 }), LOW)?.open).toBe(true)
    expect(transitionGate(door, player({ ice: 84999 }), LOW)?.open).toBe(false)
  })

  it('넘으면 열린 채로 숫자도 그대로 준다', () => {
    expect(transitionGate(door, player({ ice: 120000 }), LOW)).toEqual({
      skill: { skill: 'ice', need: 85000, have: 120000, open: true },
      tide: null,
      open: true,
    })
  })

  // 왜: 재는 숙련은 언제나 그 문이 적어 둔 계열이다. 다른 계열이 아무리 높아도
  //     얼음 결계는 얼음으로 연다 — shopAccess 가 상점 계열만 재는 것과 같다.
  it('그 문이 적어 둔 계열만 잰다', () => {
    expect(transitionGate(door, player({ mineral: 999999 }), LOW)?.open).toBe(false)
  })

  // 왜: 물때를 안 지는 문이 시각에 흔들리면, 얼음 결계가 새벽마다 조용히 닫힌다.
  it('물때를 안 지는 문은 시각과 무관하다', () => {
    expect(transitionGate(door, player({ ice: 85000 }), HIGH)?.open).toBe(true)
    expect(transitionGate(door, player({ ice: 85000 }), HIGH)?.tide).toBeNull()
  })
})

/*
 * 허브 결계는 조건 둘을 진다 — `항구약초지기` 가 처음부터 둘을 말했기 때문이다
 * ("물이 크게 빠질 때, 저 끝 바위에"). 숙련만 걸면 그 대사는 여전히 없는
 * 것을 가리킨다(설계 §6·§9-앞 17).
 */
describe('transitionGate — 물때', () => {
  // 왜: 두 조건이 **함께** 열려야 문이 열린다. 하나만 보고 통과시키면 대사가
  //     말한 두 조건 중 하나가 장식이 된다.
  it('숙련이 되고 물이 빠져 있어야 열린다', () => {
    expect(transitionGate(tideDoor, player({ herb: 85000 }), LOW)?.open).toBe(true)
  })

  it('숙련이 돼도 물이 차 있으면 안 열린다', () => {
    const gate = transitionGate(tideDoor, player({ herb: 85000 }), HIGH)
    expect(gate?.open).toBe(false)
    expect(gate?.skill?.open).toBe(true)
    expect(gate?.tide?.open).toBe(false)
  })

  // 왜: 화면이 "숙련 때문인가 물때 때문인가"를 구별해서 말하려면 두 조건의
  //     열림이 따로 와야 한다. 합친 `open` 하나만 주면 화면이 판정을 다시
  //     짓게 되고, 그것이 §9-앞 13 이 금지한 두 번째 부등호다.
  it('막힌 이유를 조건별로 나눠 준다', () => {
    const gate = transitionGate(tideDoor, player({ herb: 1000 }), HIGH)
    expect(gate?.skill).toEqual({ skill: 'herb', need: 85000, have: 1000, open: false })
    expect(gate?.tide?.open).toBe(false)
    expect(gate?.tide?.windows).toEqual(TIDE_WINDOWS)
  })

  // 왜: 화면이 "지금 몇 시인가"를 적어야 플레이어가 얼마나 기다릴지 안다.
  //     시각을 안 주면 화면이 자기 시계를 한 번 더 읽게 되고, 그러면 판정이
  //     본 시각과 화면이 적은 시각이 갈라진다.
  it('판정이 본 시각을 그대로 돌려준다', () => {
    expect(transitionGate(tideDoor, player({ herb: 85000 }), atHour(11))?.tide?.hour).toBe(11)
  })

  // 왜: 물때는 하루 두 번 돌아온다. 첫 창만 보면 오후에 온 사람이 영영 못
  //     들어가고, 그것은 대사가 약속한 세계가 아니다.
  it('창이 둘 다 산다', () => {
    for (const w of TIDE_WINDOWS) {
      expect(transitionGate(tideDoor, player({ herb: 85000 }), atHour(w.start))?.open).toBe(true)
      expect(transitionGate(tideDoor, player({ herb: 85000 }), atHour(w.end))?.open).toBe(false)
    }
  })
})
