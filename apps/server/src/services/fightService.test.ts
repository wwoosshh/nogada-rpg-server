import {
  COMBAT_INTERVAL_MAX_MS,
  combatIntervalMs,
  defaultCombatState,
  emptyDialogueHistory,
  MONSTER_RESPAWN_MS,
  type GameData,
  type GatherTables,
  type MonsterDef,
  type PlayerLocation,
  type PlayerState,
} from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { performGather } from './gatherService.js'
import { performFight, type MonsterWorld, type PerformFightArgs } from './fightService.js'

/**
 * monster.test.ts 의 들늑대와 같은 뼈대 — 슬롯 400ms × 10칸 = 주기 4,000ms.
 * (3,0) 에 서서 [1200, 3200) 동안 오른쪽 부채꼴: 예고 [1200, 2000) →
 * 휩쓸기 [2000, 2400). 부채꼴은 (4,0)·(5,−1..1)·(6,−2..2) 아홉 칸이다.
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

const data: GameData = {
  items: {
    fang: testItem('fang', { name: '늑대 송곳니', icon: 'fang', price: 30, skill: 'mineral' }),
    copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
    copper_sword: testTool('copper_sword', 'combat', 1, { name: '구리 검', icon: 'sword_copper', damage: 5 }),
    wolf_hide_armor: testTool('wolf_hide_armor', 'armor', 1, { name: '늑대 가죽옷', icon: 'wolf_hide_armor', defense: 5 }),
  },
  nodes: {
    copper_vein: {
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal', sprite: 'copper_vein',
    },
  },
  recipes: {},
  maps: {
    사냥터: { id: '사냥터', name: '사냥터', file: 'hunt.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } },
    눈의마을: { id: '눈의마을', name: '눈의 마을', file: 'world.tmx', width: 30, height: 30, spawn: { x: 5, y: 5 } },
  },
  transitions: [],
  placements: {
    // 번갈아 악용 검사(§12-앞 17)를 위해 채집 노드도 같은 맵에 둔다.
    'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', mapId: '사냥터', x: 20, y: 20 },
  },
  milestones: [],
  speakers: {},
  shops: {}, masters: [], enhanceCosts: [], collection: {},
  places: {}, schedules: {}, routes: [],
  dialogue: [],
  inns: {}, monsters: {}, monsterPlacements: {}, story: [],
}

/** 번갈아 악용 검사용 최소 채집표 — 항상 성공(copper_ore)하는 무한 브라켓 하나. */
const tables: GatherTables = {
  mineral: {
    id: 'mineral', skill: 'mineral', skillGainMin: 1, skillGainMax: 1, equity: true,
    tiers: [{ itemId: 'copper_ore' }],
    brackets: [{ bracketMax: null, cumulative: [100000] }],
  },
}

/**
 * 배치 둘 — 같은 종, 위상만 다르다(§12-앞 23). wolf-2 는 위상 2,000 이라
 * def 시각 = t + 2,000 이고, maxHp 도 달라 재교전 시 만혈 리셋이 수치로 보인다.
 */
const world: MonsterWorld = {
  defs: { wolf: 들늑대 },
  placements: {
    'wolf-1': { instanceId: 'wolf-1', monsterId: 'wolf', mapId: '사냥터', phaseOffsetMs: 0, maxHp: 10, sweepDamage: 30 },
    'wolf-2': { instanceId: 'wolf-2', monsterId: 'wolf', mapId: '사냥터', phaseOffsetMs: 2000, maxHp: 20, sweepDamage: 30 },
  },
  drops: { wolf: { monsterId: 'wolf', drops: [{ itemId: 'fang', chance: 0.3 }] } },
}

const spawn: PlayerLocation = { mapId: '눈의마을', x: 5, y: 5 }

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    gold: 0,
    instances: [{ instanceId: 's1', itemId: 'copper_sword', enhanceLevel: 0 }],
    equipped: { combat: 's1' },
    nextActionAt: 0,
    celebrated: [],
    // 사슬은 이 스위트가 보는 판정이 아니다 — PlayerState 의 필수 칸이라 채워만 둔다.
    story: 0,
    storyCount: 0,
    rewarded: [],
    weather: null,
    dialogueHistory: emptyDialogueHistory(),
    location: { mapId: '사냥터', x: 3, y: 1 },
    combat: defaultCombatState(),
    ...overrides,
  }
}

/** 정해 둔 값들을 차례로 돌려주는 rng — 스윙마다 ① 숙련 증가 ② (처치 시) 드랍 순서로 소비된다. */
function seq(...values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]!
}

const fight = (over: Partial<PerformFightArgs>) =>
  performFight({
    player: player(),
    data,
    ...world,
    spawn,
    instanceId: 'wolf-1',
    claim: { x: 3, y: 1 },
    rng: seq(0),
    now: 1600,
    ...over,
  })

describe('performFight — 거절 경로', () => {
  it('없는 배치는 unknown_monster 로 거부한다', () => {
    expect(fight({ instanceId: 'ghost-1' })).toEqual({ ok: false, code: 'unknown_monster' })
  })

  // 왜: 앞칸·사거리 판정의 재료(x·y)는 주장이지만 **맵이 다르면 닿을 수 없다**는
  //     서버가 확실히 안다 — gatherService 의 wrong_map 과 같은 자리다.
  it('다른 맵의 몬스터는 wrong_map 으로 거부한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    expect(fight({ player: p })).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('간격 전의 스윙은 too_fast 로 거부한다', () => {
    const p = player({ nextActionAt: 2_000 })
    expect(fight({ player: p, now: 1_999 })).toEqual({ ok: false, code: 'too_fast' })
  })

  // 왜: 체비쇼프 자였다면 대각 5칸(=맨해튼 10칸)이 정직한 걸음의 2배속으로
  //     통과한다(§2-3 실측). 이 게임의 이동은 4방향이라 자는 맨해튼뿐이다.
  it('대각 순간이동 주장은 implausible_move 로 거부한다', () => {
    const p = player({
      combat: { ...defaultCombatState(), lastClaim: { mapId: '사냥터', x: 3, y: 1, atMs: 500 } },
    })
    // 1,100ms 만에 대각 5칸: (3,1)→(8,6). 체비쇼프 5 ≤ 5.5+여유, 맨해튼 10 > 5.5+여유.
    expect(fight({ player: p, claim: { x: 8, y: 6 }, now: 1_600 })).toEqual({ ok: false, code: 'implausible_move' })
  })

  it('첫 주장은 개연성 검사가 공회전한다 — 그동안 걸어간 것과 등가라 위협 모델 안에서 무해하다(§12-앞 7)', () => {
    const r = fight({ claim: { x: 25, y: 25 }, now: 200 })
    expect(r.ok).toBe(true)
  })

  // 왜: 직전 주장이 다른 맵이면 맨해튼을 잴 수 없다(§2-3 전환 공회전) — 이
  //     공회전이 없으면 사냥터에서 스윙하고 나갔다 되돌아온 정직한 플레이어가
  //     입구에서 거리 수십 칸으로 찍혀 몇 초 전투 불능이 된다(리뷰 재현).
  it('전환으로 나갔다 돌아온 첫 주장은 공회전한다 — 다른 맵의 좌표와 재지 않는다', () => {
    const p = player({
      combat: { ...defaultCombatState(), lastClaim: { mapId: '눈의마을', x: 3, y: 1, atMs: 500 } },
    })
    // (3,1)→(28,15) 는 맨해튼 39 — 같은 맵의 주장이었다면 확실히 거절될 거리다.
    const r = fight({ player: p, claim: { x: 28, y: 15 }, now: 1_600 })
    expect(r.ok).toBe(true)
  })
})

describe('performFight — 주장 좌표 상한(아크 D §4)', () => {
  // 왜: 상한이 없으면 (10⁹,10⁹) 첫 주장이 공회전 특례로 수락돼 lastClaim 에
  //     박히고, 이후의 정직한 주장이 전부 implausible_move 로 묶인다(전체 리뷰
  //     재현 — 치터 이득은 0이지만 자기 발 묶기가 가능하다). implausible_move
  //     재사용이 아닌 이유: 속도 위반은 정직한 시계 어긋남에서도 오지만 맵 밖
  //     주장은 위조 전용이라, 한 코드로 묶으면 문구와 로그 신호가 같이 오염된다.
  it('맵 밖 주장은 out_of_bounds 로 거부하고 아무것도 적지 않는다', () => {
    const p = player()
    const r = fight({ player: p, claim: { x: 1_000_000_000, y: 1_000_000_000 } })
    expect(r).toEqual({ ok: false, code: 'out_of_bounds' })
    // 거절 경로는 아무것도 저장하지 않는다(§2-2) — lastClaim 이 안 박혔으니
    // 자기 발 묶기가 원리적으로 사라진다.
    expect(p.combat.lastClaim).toBe(null)
    expect(p.nextActionAt).toBe(0)
  })

  it('경계 안 마지막 칸(width−1, height−1)은 수락한다', () => {
    const r = fight({ claim: { x: 29, y: 29 }, now: 200 })
    expect(r.ok).toBe(true)
  })

  it('x = width 는 거절한다 — 칸은 0부터라 width 자체가 첫 바깥 칸이다', () => {
    expect(fight({ claim: { x: 30, y: 1 } })).toEqual({ ok: false, code: 'out_of_bounds' })
  })

  it('y = height 도 거절한다 — 두 축이 따로 물어야 한 축 제거 돌연변이가 잡힌다', () => {
    expect(fight({ claim: { x: 3, y: 30 } })).toEqual({ ok: false, code: 'out_of_bounds' })
  })

  // 왜: 상한은 맵의 값이다 — 맵을 모르면(데이터에 없는 mapId) 재지 않고 기존
  //     흐름을 따른다. 판정을 멈추는 것은 이 검사의 몫이 아니다.
  it('맵이 data.maps 에 없으면 기존 흐름 그대로다', () => {
    const r = fight({
      data: { ...data, maps: {} },
      claim: { x: 1_000_000_000, y: 1_000_000_000 },
      now: 200,
    })
    expect(r.ok).toBe(true)
  })
})

describe('performFight — 명중과 헛스윙(§2-2 갱신본)', () => {
  it('사거리 안(맨해튼 1)의 스윙은 무기 피해만큼 몬스터 HP 를 깎고 교전을 기록한다', () => {
    const r = fight({ now: 1600 })
    if (!r.ok) throw new Error('명중이어야 한다')
    expect(r.outcome.hit).toBe(true)
    expect(r.outcome.monsterHp).toBe(5)
    expect(r.outcome.player.combat.hunt).toEqual({ instanceId: 'wolf-1', monsterHp: 5 })
    // 간격 스탬프는 채집과 같은 필드다(§12-앞 17) — 숙련 0 이면 상한 800ms.
    expect(r.outcome.player.nextActionAt).toBe(1600 + COMBAT_INTERVAL_MAX_MS)
  })

  it('숙련은 성패 무관 회당 +1~2 오른다(§5) — 헛스윙도 한 번의 스윙이다', () => {
    const miss = fight({ claim: { x: 25, y: 25 }, now: 200, rng: seq(0.99) })
    if (!miss.ok) throw new Error('헛스윙도 ok 여야 한다')
    expect(miss.outcome.skillGained).toBe(2)
    expect(miss.outcome.player.combat.proficiency).toBe(2)
  })

  // 왜(§2-2 갱신본, 커밋 3d3bfaf): 사거리 밖 스윙을 거절로 두면 "구역에 덮이지만
  //     그 순간 사거리 밖인 칸"의 방치자는 스윙이 전부 거절이라 영원히 무피격인
  //     자판기 칸이 된다. 헛스윙 의미론이 위험의 정의를 하나로 만든다 —
  //     위험은 구역이고, 사거리는 명중에만 관여한다.
  it('사거리 밖 스윙은 거절이 아니라 헛스윙이다 — ok:true, 간격 소모, 몬스터 무피해', () => {
    // (6,0): (3,0) 에서 맨해튼 3 — t±ε 어디서도 사거리 밖. 부채꼴 안이기는 하다(아래 테스트).
    const r = fight({ claim: { x: 6, y: 0 }, now: 1600 })
    if (!r.ok) throw new Error('헛스윙은 거절이 아니다')
    expect(r.outcome.hit).toBe(false)
    expect(r.outcome.monsterHp).toBe(10)
    expect(r.outcome.player.combat.hunt).toBe(null)
    expect(r.outcome.player.nextActionAt).toBe(1600 + COMBAT_INTERVAL_MAX_MS)
  })

  it('휩쓸기 활성 중의 헛스윙이라면 피격은 그대로 실린다 — 위험은 구역이다', () => {
    const r = fight({ claim: { x: 6, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('헛스윙은 거절이 아니다')
    expect(r.outcome.hit).toBe(false)
    expect(r.outcome.monsterHp).toBe(10)
    expect(r.outcome.tookHit).toBe(true)
    expect(r.outcome.playerHp).toBe(70)
  })
})

describe('performFight — 위험 창(§3)과 피격', () => {
  it('휩쓸기 활성 중 부채꼴 안에서의 공격은 명중과 피격이 같이 실린다', () => {
    // (4,0): 몬스터 (3,0) 에서 거리 1(사거리 안)이면서 부채꼴 깊이 1 칸이다.
    const r = fight({ claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('명중이어야 한다')
    expect(r.outcome.hit).toBe(true)
    expect(r.outcome.tookHit).toBe(true)
    expect(r.outcome.playerHp).toBe(70)
    expect(r.outcome.player.combat.hp).toBe(70)
    expect(r.outcome.player.combat.lastHitAt).toBe(2200)
  })

  // 왜: 예고 중 공격은 자유다(결정 3) — 마지막까지 때리는 탐욕이 이 전투의
  //     긴장이다. 단 ε 는 구간이라(§2-5) 실효 위험 창이 활성 ± ε 로 붇는다:
  //     예고가 ε(1,000ms)보다 짧은 몬스터는 무사한 예고 순간이 아예 없다.
  //     그래서 예고 1,500ms 변주로 잰다(C6 저작 제약: 예고 ≥ ε + 700ms 가
  //     이 픽스처 조건의 일반형이다) — t=1,600 은 t+ε(2,600)도 휩쓸기
  //     시작(2,700) 전이다.
  it('예고 중(휩쓸기에서 ε 밖)의 공격은 무피해다', () => {
    const 긴예고 = {
      ...들늑대,
      attacks: [{ telegraphStartMs: 1200, telegraphMs: 1500, activeMs: 400, direction: 'right' as const, reach: 3 }],
    }
    // 배치 하나로 고립한다 — 피격은 표적 무관하게 맵의 전 배치 구역을 재므로,
    // 겹쳐 선 wolf-2(위상 2,000)를 두면 그쪽 휩쓸기가 이 단언을 덮는다.
    const r = fight({
      defs: { wolf: 긴예고 },
      placements: { 'wolf-1': world.placements['wolf-1']! },
      claim: { x: 4, y: 0 },
      now: 1600,
    })
    if (!r.ok) throw new Error('명중이어야 한다')
    expect(r.outcome.hit).toBe(true)
    expect(r.outcome.tookHit).toBe(false)
    expect(r.outcome.playerHp).toBe(100)
  })

  it('부채꼴 밖의 칸은 활성 중에도 무사하다', () => {
    const r = fight({ claim: { x: 3, y: 1 }, now: 2200 })
    if (!r.ok) throw new Error('명중이어야 한다')
    expect(r.outcome.tookHit).toBe(false)
  })

  // 왜: 위험은 구역이다(§2-2) — **표적과 무관하게**. 표적의 구역만 재면 위험의
  //     정의가 표적 선택에 묶여, 늑대 B 의 구역에 서서 먼 늑대 A 를 향해
  //     헛스윙하는 사람을 B 의 휩쓸기가 영영 못 문다(C7 브라우저 재현 — 검사
  //     2·3 이 끊은 순환 위임의 서버판). 피해량도 걸린 구역의 주인 것이어야
  //     화면의 "-N" 이 참말이 된다.
  it('표적이 아닌 몬스터의 활성 구역에 서 있어도 걸린다 — 위험은 표적과 무관한 구역이다', () => {
    // t=2,200: wolf-1(위상 0)은 활성 [2,000, 2,400) — (6,0) 은 그 부채꼴 안.
    // wolf-2(위상 2,000)의 def 시각은 4,200 이라 ±ε 어디에도 활성이 없다.
    // 표적은 wolf-2: (6,0) 에서 wolf-2 의 칸까지 멀어 헛스윙이다.
    const r = fight({ instanceId: 'wolf-2', claim: { x: 6, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('헛스윙은 거절이 아니다')
    expect(r.outcome.hit).toBe(false)
    expect(r.outcome.tookHit).toBe(true)
    expect(r.outcome.tookDamage).toBe(30)
    expect(r.outcome.playerHp).toBe(70)
  })
})

describe('performFight — 오차 주입(§12-앞 3): 앵커 ±1초를 ε 가 삼킨다', () => {
  // 왜: 동기화 백스톱(RESYNC_THRESHOLD_MS)은 ±2초를 상시 용인하고, RTT 스파이크
  //     중 잡힌 나쁜 앵커의 ~1초 오차는 다음 주기 동기(5분)까지 지속된다(§2-5).
  //     같은 t 를 넣는 결정론 테스트는 이 결함을 못 문다 — 클라 시계를 1초
  //     어긋내고 서버 판정이 그 주장을 받아 주는지를 직접 잰다.
  it('클라 시계가 1초 늦어 몬스터가 떠난 뒤 도착한 스윙도 t−ε 에 닿았으면 명중이다', () => {
    // 클라는 자기 시각 2,600(몬스터 (3,0) 옆)에 휘둘렀지만 서버 도착 시각은 3,600 —
    // 서버 시각의 몬스터는 (1,0)(거리 3)이다. t−1,000=2,600 이 닿는다.
    const r = fight({ claim: { x: 3, y: 1 }, now: 3600 })
    if (!r.ok) throw new Error('오차가 삼켜져야 한다')
    expect(r.outcome.hit).toBe(true)
    expect(r.outcome.monsterHp).toBe(5)
  })

  it('클라 시계가 1초 빨라 활성이 끝난 서버 시각에 도착한 회피 실패도 피격이다 — 오차는 양쪽으로 삼킨다', () => {
    const r = fight({ claim: { x: 6, y: 0 }, now: 3200 })
    if (!r.ok) throw new Error('헛스윙은 거절이 아니다')
    expect(r.outcome.tookHit).toBe(true)
  })
})

describe('performFight — 처치·드랍·리스폰(§4)', () => {
  const engaged = () =>
    player({ combat: { ...defaultCombatState(), hunt: { instanceId: 'wolf-1', monsterHp: 5 } } })

  it('HP 를 0 이하로 깎으면 처치 — slain 기록·hunt 해제·드랍 굴림', () => {
    const r = fight({ player: engaged(), now: 1600, rng: seq(0, 0.1) })
    if (!r.ok) throw new Error('처치여야 한다')
    expect(r.outcome.slainNow).toBe(true)
    expect(r.outcome.monsterHp).toBe(0)
    expect(r.outcome.gained).toEqual({ itemId: 'fang', count: 1 })
    expect(r.outcome.player.stacks['fang']).toBe(1)
    expect(r.outcome.player.combat.slain['wolf-1']).toBe(1600)
    expect(r.outcome.player.combat.hunt).toBe(null)
  })

  it('드랍 굴림이 누적 질량 밖이면 빈손 처치다', () => {
    const r = fight({ player: engaged(), now: 1600, rng: seq(0, 0.9) })
    if (!r.ok) throw new Error('처치여야 한다')
    expect(r.outcome.slainNow).toBe(true)
    expect(r.outcome.gained).toBe(null)
  })

  // 왜: 처치 기록이 hunt 밖에 있어야 하는 이유(§12-앞 11) — hunt 단수에 처치
  //     시각을 실으면 다른 늑대와 교전하는 순간 기록이 사라져 리스폰 대기가
  //     무효가 된다. A처치→B교전→A재교전이 그 붕괴 경로 그대로다.
  it('A 처치 → B 교전 → A 재교전: 리스폰 대기가 유지되고, 지나면 만혈로 돌아온다', () => {
    // A(wolf-1) 처치.
    const slay = fight({ player: engaged(), now: 1600, rng: seq(0, 0.9) })
    if (!slay.ok) throw new Error('처치여야 한다')

    // B(wolf-2) 교전 — 위상 2,000 이라 t=3,600 의 def 시각은 5,600 → (3,0).
    const engageB = fight({ player: slay.outcome.player, instanceId: 'wolf-2', now: 3600 })
    if (!engageB.ok) throw new Error('명중이어야 한다')
    expect(engageB.outcome.monsterHp).toBe(15)
    // B 와 교전해도 A 의 처치 기록은 남아 있다 — hunt 밖이므로.
    expect(engageB.outcome.player.combat.slain['wolf-1']).toBe(1600)

    // 리스폰 대기 중의 A 재공격: 부재라 헛스윙이고, B 교전도 깨지지 않는다.
    const tooSoon = fight({ player: engageB.outcome.player, now: 5600 })
    if (!tooSoon.ok) throw new Error('부재 스윙도 거절이 아니다')
    expect(tooSoon.outcome.hit).toBe(false)
    expect(tooSoon.outcome.monsterHp).toBe(null)
    expect(tooSoon.outcome.player.combat.hunt).toEqual({ instanceId: 'wolf-2', monsterHp: 15 })

    // 리스폰이 지난 A: 만혈(10)에서 다시 시작한다.
    const again = fight({ player: tooSoon.outcome.player, now: 1600 + MONSTER_RESPAWN_MS + 4000 })
    if (!again.ok) throw new Error('명중이어야 한다')
    expect(again.outcome.monsterHp).toBe(5)
    expect(again.outcome.player.combat.hunt).toEqual({ instanceId: 'wolf-1', monsterHp: 5 })
  })

  it('교전 상대를 바꾸면 이전 몬스터는 만혈로 돌아간다 — 한 번에 하나의 값이다(§4)', () => {
    // B 를 반쯤 깎아 두고(hunt=B 15) A 와 교전, 다시 B 를 치면 만혈 20 에서 시작한다.
    const p = player({ combat: { ...defaultCombatState(), hunt: { instanceId: 'wolf-2', monsterHp: 15 } } })
    const hitA = fight({ player: p, now: 1600 })
    if (!hitA.ok) throw new Error('명중이어야 한다')
    const backToB = fight({ player: hitA.outcome.player, instanceId: 'wolf-2', now: 3600 })
    if (!backToB.ok) throw new Error('명중이어야 한다')
    // 만혈 20 에서 5 를 깎은 15 다 — 리셋이 없었다면 15에서 이어져 10 이 나온다.
    expect(backToB.outcome.monsterHp).toBe(15)
    expect(hitA.outcome.player.combat.hunt).toEqual({ instanceId: 'wolf-1', monsterHp: 5 })
  })
})

describe('performFight — 강화가 피해를 산다(아크 D §1): 식은 shared 의 swingDamageOf 하나다', () => {
  /** 들늑대 출하값(HP 8) 상당의 배치 — +3 검(피해 8)의 1스윙 문턱을 서버 판정으로 잰다. */
  const hp8 = { 'wolf-1': { ...world.placements['wolf-1']!, maxHp: 8 } }

  it('+3 검은 HP 8 배치를 한 스윙에 처치한다 — 강화 사다리의 2스윙→1스윙 문턱', () => {
    const p = player({ instances: [{ instanceId: 's1', itemId: 'copper_sword', enhanceLevel: 3 }] })
    const r = fight({ player: p, placements: hp8, now: 1600, rng: seq(0, 0.9) })
    if (!r.ok) throw new Error('처치여야 한다')
    expect(r.outcome.slainNow).toBe(true)
    expect(r.outcome.monsterHp).toBe(0)
    expect(r.outcome.player.combat.slain['wolf-1']).toBe(1600)
  })

  // 왜: 문턱이 +3 "부터"라는 것의 반쪽 — +0 검(피해 5)이 같은 배치에 두 스윙이어야
  //     위 단언이 강화의 값이지 픽스처의 우연이 아니다.
  it('+0 검(피해 5)은 같은 HP 8 배치를 한 스윙에 못 잡는다 — 3 이 남는다', () => {
    const r = fight({ placements: hp8, now: 1600 })
    if (!r.ok) throw new Error('명중이어야 한다')
    expect(r.outcome.slainNow).toBe(false)
    expect(r.outcome.monsterHp).toBe(3)
  })
})

describe('performFight — 경감(아크 E §2): 식은 shared 의 armorDefenseOf 한 벌, 하한 1', () => {
  /** 설계 §2 산술의 그 값(늑대 sweepDamage 20) — -15/-10 이 픽스처 우연이 아니라 식에서 나온다. */
  const sweep20 = { 'wolf-1': { ...world.placements['wolf-1']!, sweepDamage: 20 } }
  /** 가죽옷(defense 5)을 +n 으로 입은 사람 — 검은 그대로다(경감은 armor 슬롯만 산다). */
  const armored = (enhanceLevel: number) =>
    player({
      instances: [
        { instanceId: 's1', itemId: 'copper_sword', enhanceLevel: 0 },
        { instanceId: 'a1', itemId: 'wolf_hide_armor', enhanceLevel },
      ],
      equipped: { combat: 's1', armor: 'a1' },
    })

  it('+0 가죽옷(defense 5)은 휩쓸기 20 을 15 로 경감한다', () => {
    const r = fight({ player: armored(0), placements: sweep20, claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.tookHit).toBe(true)
    expect(r.outcome.tookDamage).toBe(15)
    expect(r.outcome.playerHp).toBe(85)
    expect(r.outcome.player.combat.hp).toBe(85)
  })

  // 왜: 강화 수치는 정의가 아니라 인스턴스에 있다(equipment.ts) — 판정이 def 만
  //     보면 +5 가죽옷이 +0 과 똑같이 맞아 강화 수요의 보상이 죽는다(무기의
  //     아크 D §0-1 그대로). 20−5−5=10 이 §2 산술의 ~33s ≈ 설계 35s 를 되산다.
  it('+5 가죽옷은 10 으로 경감한다 — 강화 사다리가 설계 숫자를 되사 온다(§2 산술)', () => {
    const r = fight({ player: armored(5), placements: sweep20, claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.tookDamage).toBe(10)
    expect(r.outcome.playerHp).toBe(90)
  })

  // 왜: 경감이 피해를 0 으로 만들면 "회피 안 하면 맞는다"(§3·검사 3)가 장비로
  //     무력화된다 — 위험은 언제나 아프다, 덜 아플 뿐이다(규범 2).
  it('경감이 휩쓸기를 덮어도 피해는 하한 1 이다 — 위험은 언제나 아프다', () => {
    const weak = { 'wolf-1': { ...world.placements['wolf-1']!, sweepDamage: 4 } }
    const r = fight({ player: armored(0), placements: weak, claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.tookHit).toBe(true)
    expect(r.outcome.tookDamage).toBe(1)
    expect(r.outcome.playerHp).toBe(99)
  })

  it('맨몸은 무영향 — 경감 0 이라 휩쓸기 값 그대로 맞는다', () => {
    const r = fight({ placements: sweep20, claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.tookDamage).toBe(20)
    expect(r.outcome.playerHp).toBe(80)
  })

  // 왜: 피격은 표적 무관하게 맵의 전 배치 구역을 합산한다(④) — 하한 1 을 합에
  //     걸면 max(1, 24−10)=14 같은 엉뚱한 수가 되고, 걸린 배치마다 걸어야
  //     15+1=16 이 나온다. t=3200 은 wolf-1(위상 0)과 wolf-2(위상 2,000)의
  //     활성이 ±ε 안에서 함께 무는 유일한 자리다(구간 겹침 [3000, 3400)).
  it('다중 구역 피격은 각 배치가 개별로 클램프된다 — 합산 뒤 클램프가 아니다', () => {
    const both = {
      'wolf-1': { ...world.placements['wolf-1']!, sweepDamage: 20 },
      'wolf-2': { ...world.placements['wolf-2']!, sweepDamage: 4 },
    }
    const r = fight({ player: armored(0), placements: both, claim: { x: 6, y: 0 }, now: 3200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.tookHit).toBe(true)
    // max(1, 20−5) + max(1, 4−5) = 15 + 1.
    expect(r.outcome.tookDamage).toBe(16)
    expect(r.outcome.playerHp).toBe(84)
  })
})

describe('performFight — 죽음(§6): 처치가 먼저, 귀환은 그 다음이다', () => {
  it('휩쓸기가 HP 를 0 으로 만들면 마을 스폰으로 귀환하고 hunt 가 풀린다', () => {
    const p = player({ combat: { ...defaultCombatState(), hp: 10, lastHitAt: 2200 } })
    const r = fight({ player: p, claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.died).toBe(true)
    expect(r.outcome.playerHp).toBe(0)
    expect(r.outcome.player.location).toEqual(spawn)
    expect(r.outcome.player.combat.hunt).toBe(null)
    // 귀환은 순간이동이다 — 방금 찍힌 주장이 남으면 스폰이 같은 맵인 날 부활
    // 직후의 정직한 스윙이 implausible_move 가 된다(§2-3 전환 공회전).
    expect(r.outcome.player.combat.lastClaim).toBe(null)
  })

  // 왜: 한 요청이 처치와 죽음을 같이 내면 처치가 먼저다(§2-2) — 드랍과 처치
  //     기록이 실리고 나서 귀환한다. 잡고 죽은 사람이 빈손이면 안 된다.
  it('처치와 죽음이 한 요청에 같이 오면 드랍을 쥐고 귀환한다', () => {
    const p = player({
      combat: { ...defaultCombatState(), hp: 10, lastHitAt: 2200, hunt: { instanceId: 'wolf-1', monsterHp: 5 } },
    })
    const r = fight({ player: p, claim: { x: 4, y: 0 }, now: 2200, rng: seq(0, 0.1) })
    if (!r.ok) throw new Error('처치여야 한다')
    expect(r.outcome.slainNow).toBe(true)
    expect(r.outcome.gained).toEqual({ itemId: 'fang', count: 1 })
    expect(r.outcome.player.stacks['fang']).toBe(1)
    expect(r.outcome.player.combat.slain['wolf-1']).toBe(2200)
    expect(r.outcome.died).toBe(true)
    expect(r.outcome.player.location).toEqual(spawn)
  })

  it('죽어도 잃는 것은 없다 — 인벤토리·숙련이 그대로다(§6 무손실)', () => {
    const p = player({ stacks: { copper_ore: 7 }, combat: { ...defaultCombatState(), hp: 10, lastHitAt: 2200 } })
    const r = fight({ player: p, claim: { x: 4, y: 0 }, now: 2200 })
    if (!r.ok) throw new Error('피격은 ok 경로다')
    expect(r.outcome.player.stacks['copper_ore']).toBe(7)
  })
})

describe('performFight — 자연 회복은 게으르다(§6)', () => {
  it('판정 시각의 HP 는 lastHitAt 이후의 회복을 반영하되, 저장칸은 실측 그대로다', () => {
    const p = player({ combat: { ...defaultCombatState(), hp: 40, lastHitAt: 0 } })
    // t=1,000,000: 회복량이 상한을 넘겨 만혈이다. 몬스터와 무관한 칸이라 헛스윙.
    const r = fight({ player: p, claim: { x: 25, y: 25 }, now: 1_000_000 })
    if (!r.ok) throw new Error('헛스윙은 거절이 아니다')
    expect(r.outcome.playerHp).toBe(100)
    // 맞지 않았으므로 저장칸(hp·lastHitAt)은 건드리지 않는다 — 게으른 계산의 뜻이다.
    expect(r.outcome.player.combat.hp).toBe(40)
    expect(r.outcome.player.combat.lastHitAt).toBe(0)
  })
})

describe('전투와 채집은 같은 간격 필드를 쓴다(§12-앞 17)', () => {
  // 왜: nextActionAt 이 채집과 같은 필드라는 것의 뜻이 이 검사다 — 두 동사를
  //     번갈아 눌러 배속하는 악용이 원리적으로 불가능해야 한다.
  it('전투 직후의 채집은 too_fast 다', () => {
    const swing = fight({ now: 1600 })
    if (!swing.ok) throw new Error('명중이어야 한다')
    const gather = performGather({
      player: swing.outcome.player, data, tables, barriers: [],
      instanceId: 'copper_vein-1', rng: () => 0, now: 1601,
    })
    expect(gather).toEqual({ ok: false, code: 'too_fast' })
  })

  it('채집 직후의 전투도 too_fast 다', () => {
    const gather = performGather({
      player: player(), data, tables, barriers: [],
      instanceId: 'copper_vein-1', rng: () => 0, now: 1600,
    })
    if (!gather.ok) throw new Error('채집이 성공해야 한다')
    const swing = fight({ player: gather.outcome.player, now: 1601 })
    expect(swing).toEqual({ ok: false, code: 'too_fast' })
  })

  it('번갈아 연타가 단독 연타보다 빠르지 않다 — 간격의 합이 그대로다', () => {
    // 전투(800) → 채집(그 뒤에야 가능) → 전투 … 각 스탬프가 이전 스탬프 이후에만
    // 찍히는지 본다. 필드가 갈라져 있었다면 t=1600 에 전투·채집 둘 다 성립했다.
    const first = fight({ now: 1600 })
    if (!first.ok) throw new Error('명중이어야 한다')
    const afterFight = first.outcome.player.nextActionAt
    expect(afterFight).toBe(1600 + combatIntervalMs(0))

    const gather = performGather({
      player: first.outcome.player, data, tables, barriers: [],
      instanceId: 'copper_vein-1', rng: () => 0, now: afterFight,
    })
    if (!gather.ok) throw new Error('채집이 성공해야 한다')
    // 채집 스탬프도 전투 스탬프 위에 쌓인다 — 합산이지 병렬이 아니다.
    expect(gather.outcome.player.nextActionAt).toBeGreaterThan(afterFight)
  })
})
