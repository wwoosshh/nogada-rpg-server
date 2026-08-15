import { JUDGE_EPSILON_MS, monsterStateAt, type MonsterDef, type MonsterPlacement } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { monsterHpOf, monsterPixelCenter, warningStyle } from './monsterView.js'

/*
 * 몬스터 렌더의 순수 계산(설계 §12-앞 16 — 추격 보간 금지).
 *
 * NpcSprite 의 추격 보간(목표를 향해 초당 일정 픽셀)은 정상 상태에서 수학
 * 위치보다 0~1칸 뒤진다(추격 속도 = 목표 속도, 실측). 화면의 늑대가 뒤지면
 * 장판과 몸이 어긋나 "본 대로 피했는데 맞았다"가 되므로, 몬스터의 픽셀 위치는
 * `monsterStateAt` 의 진행도로 **그 자리에서** 계산해야 한다 — 같은 t 를 넣으면
 * 언제나 같은 픽셀이 나오는, 지연이 낄 자리가 없는 함수다.
 */

const TILE = 32

/** 두 칸을 400ms 씩 왕복하는 최소 순찰 — 진행도가 0→1 로 자라는 것을 보기 좋다. */
const def: MonsterDef = {
  id: 'wolf',
  name: '들늑대',
  periodMs: 800,
  patrol: [
    { x: 2, y: 3 },
    { x: 3, y: 3 },
  ],
  attacks: [],
}

describe('monsterPixelCenter — 진행도 직접 보간(§12-앞 16)', () => {
  // 왜: 추격 보간으로 바꾸는 돌연변이는 "t 를 넣으면 수학 위치가 나온다"를
  //     깨뜨린다 — 추격은 이전 프레임 위치라는 숨은 상태를 요구하므로, 순수
  //     함수 하나로 픽셀이 결정된다는 이 단언 자체가 그 금지를 문다.
  it('슬롯 중간 시각의 픽셀은 tile→nextTile 을 progress 로 섞은 정확히 그 자리다', () => {
    // t=100: 첫 슬롯(0~400ms)의 1/4 지점 — x 는 2에서 3으로 1/4 만큼 갔다.
    const state = monsterStateAt(def, 100)
    expect(state.progress).toBeCloseTo(0.25)
    expect(monsterPixelCenter(state)).toEqual({
      x: (2 + 0.25) * TILE + TILE / 2,
      y: 3 * TILE + TILE / 2,
    })
  })

  // 왜: 주기의 마지막 슬롯은 첫 칸으로 감아 돌아온다(monsterStateAt 의 nextTile).
  //     여기서 보간을 멈추면 경계마다 한 칸을 순간이동한다.
  it('마지막 슬롯에서는 첫 칸을 향해 되돌아가며 보간한다', () => {
    // t=600: 둘째 슬롯(400~800ms)의 절반 — x 는 3에서 2로 절반 돌아왔다.
    const state = monsterStateAt(def, 600)
    expect(monsterPixelCenter(state)).toEqual({
      x: (3 - 0.5) * TILE + TILE / 2,
      y: 3 * TILE + TILE / 2,
    })
  })

  // 왜: 제자리 몬스터(순찰 한 칸)는 진행도와 무관하게 그 칸의 중심이어야 한다 —
  //     보간식이 nextTile 을 잘못 읽으면 여기가 먼저 흔들린다.
  it('한 칸짜리 순찰은 언제나 그 칸의 중심이다', () => {
    const still: MonsterDef = { ...def, patrol: [{ x: 5, y: 7 }], periodMs: 400 }
    for (const t of [0, 133, 399]) {
      expect(monsterPixelCenter(monsterStateAt(still, t))).toEqual({
        x: 5 * TILE + TILE / 2,
        y: 7 * TILE + TILE / 2,
      })
    }
  })
})

const placement: MonsterPlacement = {
  instanceId: 'wolf-1',
  monsterId: 'wolf',
  mapId: '사냥터',
  phaseOffsetMs: 0,
  maxHp: 30,
  sweepDamage: 5,
}

/**
 * 예고 1,800ms 의 제자리 몬스터 — C6 저작 제약(예고 ≥ ε + 700ms)을 지키는
 * 값이라 'safe' 구간(앞 800ms)과 'smear' 구간(뒤 ε=1,000ms)이 둘 다 실존한다.
 * 예고 [0, 1800) → 휩쓸기 [1800, 2200).
 */
const 예고긴놈: MonsterDef = {
  id: 'wolf-long',
  name: '들늑대',
  periodMs: 4000,
  patrol: [{ x: 0, y: 0 }],
  attacks: [{ telegraphStartMs: 0, telegraphMs: 1800, activeMs: 400, direction: 'right', reach: 1 }],
}

describe('warningStyle — 예고의 마지막 ε 는 이미 위험이다(§2-5 스미어)', () => {
  // 왜: 판정(sweepCatches)은 [t−ε, t+ε] 구간을 보므로 실제 안전 경계는
  //     "휩쓸기 시작 − ε"다. 그 경계를 화면이 모르면 예고의 마지막 1초가
  //     옅은 장판인 채 확정 피격 구간이 된다 — 본 대로 피했는데 맞았다.
  it('휩쓸기까지 ε 넘게 남은 예고는 safe 다', () => {
    expect(warningStyle(monsterStateAt(예고긴놈, 0))).toBe('safe') // 1800 남음
    expect(warningStyle(monsterStateAt(예고긴놈, 799))).toBe('safe') // 1001 남음 — 경계 바로 위
  })

  // 왜: sweepCatches 는 t+ε 가 활성 시작과 같을 때 구간 [t−ε, t+ε] 의 끝점이
  //     활성 첫 순간을 포함한다 — epsilonSampleTimes 가 t ≤ end 를 포함하는
  //     그 부등호다. 그래서 남은 시간이 정확히 ε 인 순간도 이미 위험이고,
  //     경계를 < 로 좁히는 돌연변이는 여기서 갈린다.
  it('남은 시간이 정확히 JUDGE_EPSILON_MS 인 순간은 이미 smear 다', () => {
    expect(warningStyle(monsterStateAt(예고긴놈, 1800 - JUDGE_EPSILON_MS))).toBe('smear')
  })

  it('휩쓸기까지 ε 안쪽의 예고는 smear 다', () => {
    expect(warningStyle(monsterStateAt(예고긴놈, 1500))).toBe('smear') // 300 남음
    expect(warningStyle(monsterStateAt(예고긴놈, 1799))).toBe('smear') // 1 남음
  })

  it('telegraph 가 아니면 null 이다 — 휩쓸기도 대기도', () => {
    expect(warningStyle(monsterStateAt(예고긴놈, 1900))).toBeNull() // sweep
    expect(warningStyle(monsterStateAt(예고긴놈, 2500))).toBeNull() // idle
  })
})

describe('monsterHpOf — 교전 중인 그 배치만 깎인 HP 를 보인다(§4 hunt 단수)', () => {
  // 왜: hunt 는 단수라 다른 배치는 전부 만혈이다 — 서버(fightService)가 hpBefore
  //     를 정하는 그 분기와 같은 답을 화면이 내야 HP 바가 거짓말하지 않는다.
  it('hunt 가 이 배치를 가리키면 hunt 의 HP, 아니면 만혈이다', () => {
    expect(monsterHpOf(placement, { instanceId: 'wolf-1', monsterHp: 12 })).toBe(12)
    expect(monsterHpOf(placement, { instanceId: 'wolf-2', monsterHp: 12 })).toBe(30)
    expect(monsterHpOf(placement, null)).toBe(30)
  })
})
