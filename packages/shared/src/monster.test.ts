import { describe, expect, it } from 'vitest'
import {
  COMBAT_INTERVAL_MAX_MS,
  COMBAT_INTERVAL_MIN_MS,
  combatIntervalMs,
  monsterStateAt,
  withinAttackRange,
  type MonsterState,
} from './monster.js'
import type { TilePos } from './movement.js'
import type { MonsterDef } from './types.js'

/**
 * 슬롯 400ms × 10칸 = 주기 4,000ms 의 들늑대 픽스처.
 *
 * 오른쪽으로 세 걸음 걷고(슬롯 0~3), (3,0) 에 서서 공격하고(슬롯 3~7 — 같은
 * 칸을 되풀이 적으면 서 있는 것이다), 두 걸음 되돌아온다(슬롯 8~9). 마지막
 * 칸 (1,0) 에서 첫 칸 (0,0) 으로 감기는 것까지 인접 한 칸이다.
 *
 * 공격 창: 예고 [1200, 2000) → 휩쓸기 [2000, 2400). 예고 800 ≥ 700,
 * 활성 400 ≥ 400 — 설계 §3 의 하한을 지키는 값으로 재서 적었다.
 */
const 들늑대: MonsterDef = {
  id: 'wolf',
  name: '들늑대',
  periodMs: 4000,
  patrol: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 0 },
  ],
  attacks: [{ telegraphStartMs: 1200, telegraphMs: 800, activeMs: 400, direction: 'right', reach: 3 }],
}

const state = (tMs: number): MonsterState => monsterStateAt(들늑대, tMs)

const key = (t: TilePos): string => `${t.x},${t.y}`
const keysOf = (tiles: TilePos[]): string[] => tiles.map(key).sort()

/** 앵커 (3,0)·방향 오른쪽·깊이 3 의 부채꼴 — 깊이 f 에서 좌우로 f−1 칸 벌어진다. */
const 부채꼴 = keysOf([
  { x: 4, y: 0 },
  { x: 5, y: -1 },
  { x: 5, y: 0 },
  { x: 5, y: 1 },
  { x: 6, y: -2 },
  { x: 6, y: -1 },
  { x: 6, y: 0 },
  { x: 6, y: 1 },
  { x: 6, y: 2 },
])

/**
 * 세로 방향 부채꼴을 따로 문다 — 리뷰가 찾은 살아남는 돌연변이의 자리다.
 *
 * 기존 픽스처 둘이 전부 direction 'right' 라, 수직축 벌어짐(`side`)을
 * `{x:0, y:1}` 로 부숴도 19개 테스트가 전부 초록이었다. 이 기하는 C4 서버
 * 피격 판정이 읽는 shared 술어라, 세로 공격 몬스터가 데이터에 들어오기 전에
 * 축 하나가 아니라 **두 축 다** 물려 있어야 한다.
 */
const 위로늑대: MonsterDef = {
  id: 'wolf-up',
  name: '들늑대',
  periodMs: 4000,
  patrol: [
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ],
  attacks: [{ telegraphStartMs: 0, telegraphMs: 800, activeMs: 400, direction: 'up', reach: 2 }],
}

describe('부채꼴 기하 — 세로 방향', () => {
  it('위로 나아가면 좌우(x)로 벌어진다 — 깊이 2 는 정확히 네 칸이다', () => {
    // 앵커 (5,5)·up·reach 2: 깊이 1 = (5,4), 깊이 2 = (4,3),(5,3),(6,3).
    // 벌어짐이 전진축(y)으로 새면 (5,2) 같은 칸이 대신 들어온다 — 그 돌연변이가
    // 이 전수 대조에서 갈린다.
    const s = monsterStateAt(위로늑대, 900)
    expect(s.phase).toBe('sweep')
    expect(keysOf(s.dangerTiles)).toEqual(keysOf([
      { x: 5, y: 4 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
      { x: 6, y: 3 },
    ]))
  })
})

describe('monsterStateAt — 순찰과 진행도', () => {
  // 왜: 클라 렌더가 이 진행도로 직접 보간한다(설계 §2-1 — NpcSprite 의 추격
  //     보간은 정상 상태에서 0~1칸 뒤진다). 진행도가 슬롯 안에서 단조가
  //     아니면 화면의 몬스터가 뒷걸음질친다.
  it('한 슬롯 안에서 진행도가 단조 증가하고 [0,1) 에 머문다', () => {
    const samples = [0, 100, 200, 399].map((t) => state(t).progress)
    expect(samples).toEqual([0, 0.25, 0.5, 0.9975])
    for (const p of samples) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(1)
    }
  })

  it('칸과 다음 칸을 함께 돌려준다 — 보간의 양 끝', () => {
    const s = state(500) // 슬롯 1: (1,0) → (2,0)
    expect(s.tile).toEqual({ x: 1, y: 0 })
    expect(s.nextTile).toEqual({ x: 2, y: 0 })
    expect(s.facing).toBe('right')
  })

  // 왜: t mod P 가 주기 경계에서 어긋나면 몬스터가 4초마다 순간이동한다 —
  //     마지막 슬롯의 보간 목표가 첫 칸으로 감겨야 화면이 이어진다.
  it('주기 경계가 연속이다 — 마지막 슬롯의 nextTile 이 첫 칸이고, P 에서 처음으로 돌아온다', () => {
    const 끝 = state(3999)
    expect(끝.tile).toEqual({ x: 1, y: 0 })
    expect(끝.nextTile).toEqual({ x: 0, y: 0 })
    expect(끝.progress).toBeCloseTo(399 / 400, 10)
    expect(state(4000)).toEqual(state(0))
  })

  it('되돌아오는 구간에서는 왼쪽을 본다', () => {
    expect(state(3300).facing).toBe('left') // 슬롯 8: (2,0) → (1,0)
  })

  // 왜: 공격이 끝난 뒤에도 서 있는 슬롯이 남는다(2400~3200). 같은 칸 사이의
  //     좌표차에서 방향을 억지로 뽑으면 엉뚱한 값이 나온다 — npcSchedule 의
  //     directionBetween 이 null 을 두는 것과 같은 자리다.
  it('공격 없이 서 있는 동안 facing 은 null 이다', () => {
    const s = state(2600)
    expect(s.phase).toBe('idle')
    expect(s.facing).toBeNull()
  })

  // 왜: 서버 판정과 클라 렌더가 같은 함수를 부른다(설계 §2-1). 숨은 상태가
  //     하나라도 끼면 두 호출이 갈라진다.
  it('결정론 — 같은 t 는 같은 상태, t+kP 도 같은 상태다', () => {
    expect(state(1234)).toEqual(state(1234))
    expect(state(1234)).toEqual(state(1234 + 4000 * 7))
  })

  // 왜: 클라의 worldNow() 가 재동기 직후 epoch 이전 값을 낼 일은 없지만,
  //     JS 의 % 는 음수를 음수로 돌려준다 — npcStateAt 이 음수 날짜에도 답을
  //     두는 것과 같은 방어다.
  it('음수 t 에도 답이 있다 — t=-1 은 t=P-1 과 같다', () => {
    expect(state(-1)).toEqual(state(3999))
  })

  it('반환된 칸을 고쳐도 def 의 순찰 경로가 움직이지 않는다', () => {
    const s = state(0)
    s.tile.x = 99
    expect(들늑대.patrol[0]).toEqual({ x: 0, y: 0 })
  })
})

describe('monsterStateAt — 공격 국면과 위험 구역', () => {
  it('국면 경계가 정확하다 — 예고 [1200,2000) · 휩쓸기 [2000,2400)', () => {
    expect(state(1199).phase).toBe('idle')
    expect(state(1200).phase).toBe('telegraph')
    expect(state(1999).phase).toBe('telegraph')
    expect(state(2000).phase).toBe('sweep')
    expect(state(2399).phase).toBe('sweep')
    expect(state(2400).phase).toBe('idle')
  })

  // 왜: 결정 3 — 예고 중 공격은 자유다. 예고 구역을 위험 구역에 실으면
  //     서버 판정(C4)이 예고 중 공격을 피격으로 잘못 깎는다. 경고는 별도
  //     필드로만 나간다.
  it('위험 구역은 sweep 국면에만 비지 않는다', () => {
    for (let t = 0; t < 4000; t += 50) {
      const s = state(t)
      expect(s.dangerTiles.length > 0, `t=${t}`).toBe(s.phase === 'sweep')
    }
  })

  it('경고 구역은 telegraph 국면에만 비지 않는다', () => {
    for (let t = 0; t < 4000; t += 50) {
      const s = state(t)
      expect(s.warningTiles.length > 0, `t=${t}`).toBe(s.phase === 'telegraph')
    }
  })

  // 왜: 경고가 거짓말하면 회피 축이 무너진다 — 플레이어는 예고 장판을 보고
  //     피하는데, 휩쓸기가 다른 칸을 치면 "본 대로 피했는데 맞았다"가 된다.
  it('경고 구역과 휩쓸기 구역이 같은 칸 집합이다', () => {
    expect(keysOf(state(1500).warningTiles)).toEqual(keysOf(state(2100).dangerTiles))
  })

  // 왜: 부채꼴의 앵커는 예고 시작 시점의 칸이다 — 예고가 뜬 뒤에 구역이
  //     움직이면 700ms 를 준 뜻이 없다.
  it('부채꼴은 예고 시작 칸 (3,0) 앞에 깊이만큼 벌어진다', () => {
    expect(keysOf(state(2100).dangerTiles)).toEqual(부채꼴)
  })

  it('예고·휩쓸기 동안 공격 방향을 본다', () => {
    expect(state(1500).facing).toBe('right')
    expect(state(2100).facing).toBe('right')
  })

  // 왜: 들늑대 픽스처는 공격 내내 서 있어서 "앵커 = 예고 시작 칸"과 "앵커 =
  //     지금 칸"이 구별되지 않는다 — 걷는 중에 예고가 뜨는 놈으로만 물 수
  //     있는 규칙이다. 구역이 예고 뒤에 따라 움직이면 700ms 를 준 뜻이 없다.
  it('걷는 중에 예고가 떠도 구역은 예고 시작 칸에 못박힌다', () => {
    const 걷는놈: MonsterDef = {
      id: 'walker',
      name: '걷는놈',
      periodMs: 1600,
      patrol: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 0 },
      ],
      // 예고 [0,800) 동안 (0,0)→(2,0) 으로 걷고, 휩쓸기 [800,1200) 는 (2,0) 에서 맞는다.
      attacks: [{ telegraphStartMs: 0, telegraphMs: 800, activeMs: 400, direction: 'right', reach: 1 }],
    }
    // 예고 시작 칸 (0,0) 의 앞칸 하나 — 몬스터가 어디까지 걸었든 변하지 않는다.
    expect(keysOf(monsterStateAt(걷는놈, 0).warningTiles)).toEqual(['1,0'])
    expect(keysOf(monsterStateAt(걷는놈, 700).warningTiles)).toEqual(['1,0'])
    expect(keysOf(monsterStateAt(걷는놈, 900).dangerTiles)).toEqual(['1,0'])
  })
})

describe('monsterStateAt — sweepInMs (휩쓸기까지 남은 시간, 화면 전용)', () => {
  // 왜: 판정(sweepCatches)은 [t−ε, t+ε] 구간을 보므로 예고의 마지막 ε 는 이미
  //     확정 피격 구간이다(§2-5). 화면이 그 경계를 알려면 "휩쓸기 시작까지
  //     남은 시간"이 상태에 실려야 한다 — 이 값이 틀리면 스미어 표시가
  //     엉뚱한 순간에 켜져 "본 대로 피했는데 맞았다"가 된다.
  //
  // 돌연변이 주의: "예고 끝까지 남은 시간"으로 바꾸는 돌연변이는 등가다
  // (sweepStart == telegraphStartMs + telegraphMs). 여기 테스트가 무는 것은
  // (1) 경과 시간(phaseMs − telegraphStartMs)으로 뒤집는 돌연변이와
  // (2) null 조건을 없애는 돌연변이다.
  it('예고 시작 순간에는 telegraphMs 전체가 남아 있다', () => {
    // 예고 [1200,2000): t=1200 에서 sweepStart 2000 까지 800ms — 경과 시간
    // 돌연변이(phaseMs − telegraphStartMs)는 여기서 0 을 내 갈린다.
    expect(state(1200).sweepInMs).toBe(800)
  })

  it('예고 중간 시각의 값이 정확하다 — 감산 하나의 정수 ms 다', () => {
    expect(state(1500).sweepInMs).toBe(500) // 2000 − 1500
    expect(state(1999).sweepInMs).toBe(1) // 마지막 예고 ms — 아직 telegraph 다
  })

  it('휩쓸기 중에는 null 이다 — 음수를 내면 안 된다', () => {
    // null 조건 제거 돌연변이(hit 면 무조건 감산)는 여기서 −100 을 내 갈린다.
    expect(state(2100).sweepInMs).toBeNull()
  })

  it('대기 중에는 null 이다', () => {
    expect(state(500).sweepInMs).toBeNull()
    expect(state(2600).sweepInMs).toBeNull()
  })

  // 왜: 클라는 monsterStateAt(def, now + phaseOffsetMs) 로 부른다(MonsterSprite).
  //     오프셋이 실려 t 가 주기를 몇 바퀴 감아도 t mod P 하나로 같은 값이
  //     나와야 배치마다 스미어 경계가 어긋나지 않는다.
  it('위상 오프셋과 합성해도 같은 값이다 — t mod P 규약', () => {
    expect(state(1500 + 4000 * 7).sweepInMs).toBe(500)
    expect(state(1500 - 4000).sweepInMs).toBe(500)
  })
})

describe('combatIntervalMs — 로그 곡선, 자체 상수', () => {
  it('숙련 0 은 상한 800ms 다', () => {
    expect(combatIntervalMs(0)).toBe(COMBAT_INTERVAL_MAX_MS)
    expect(COMBAT_INTERVAL_MAX_MS).toBe(800)
  })

  // 왜: 하한 400 은 §3 의 활성 창 하한과 같은 숫자다 — 활성 창 ≥ 공격 간격
  //     하한이어야 A 홀드 방치자가 휩쓸기를 스윙 없이 지나가지 못한다.
  it('숙련 100만부터 하한 400ms 에 닿고 그 밑으로 안 내려간다', () => {
    expect(combatIntervalMs(1_000_000)).toBe(COMBAT_INTERVAL_MIN_MS)
    expect(combatIntervalMs(1e9)).toBe(COMBAT_INTERVAL_MIN_MS)
    expect(COMBAT_INTERVAL_MIN_MS).toBe(400)
  })

  // 왜: 채집과 같은 로그 곡선(SPEED_DECADES=6)을 타는지 중간점 하나로 잰다 —
  //     숙련 999 는 진행도 정확히 0.5 라 800 과 400 의 한가운데다.
  it('숙련 999 는 곡선의 한가운데 600ms 다', () => {
    expect(combatIntervalMs(999)).toBe(600)
  })

  it('숙련이 오르면 간격은 줄기만 한다', () => {
    const points = [0, 10, 1000, 50_000, 1_000_000, 1e8].map(combatIntervalMs)
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!).toBeLessThanOrEqual(points[i - 1]!)
    }
  })
})

describe('withinAttackRange', () => {
  it('겹친 칸과 십자 이웃까지가 사거리다 — 서버 판정과 C2 검증이 같은 술어를 읽는다', () => {
    expect(withinAttackRange({ x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true)
    expect(withinAttackRange({ x: 2, y: 3 }, { x: 3, y: 3 })).toBe(true)
    expect(withinAttackRange({ x: 3, y: 2 }, { x: 3, y: 3 })).toBe(true)
  })

  it('대각 이웃은 맨해튼 2 라 사거리 밖이다 — 체비쇼프 자면 여기가 뚫린다', () => {
    // 대각을 1로 재는 순간 사거리 판 넓이가 5칸 → 9칸이 되고, 대각 주장이
    // 정직한 걸음의 2배속으로 통과한다(설계 §12-앞 6).
    expect(withinAttackRange({ x: 2, y: 2 }, { x: 3, y: 3 })).toBe(false)
    expect(withinAttackRange({ x: 5, y: 3 }, { x: 3, y: 3 })).toBe(false)
  })
})
