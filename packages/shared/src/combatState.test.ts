import { describe, expect, it } from 'vitest'
import {
  armorDefenseOf,
  attackConnects,
  CLAIM_SLACK_TILES,
  claimPlausible,
  COMBAT_MAX_HP,
  currentHp,
  defaultCombatState,
  HP_REGEN_MS_PER_HP,
  JUDGE_EPSILON_MS,
  MONSTER_RESPAWN_MS,
  monsterAlive,
  rollMonsterDrop,
  swingDamage,
  swingDamageOf,
  sweepCatches,
  UNARMED_COMBAT_DAMAGE,
} from './combatState.js'
import { STEP_MS } from './movement.js'
import { testTool } from './testing/items.js'
import type { MonsterDef, PlayerState } from './types.js'

/**
 * monster.test.ts 의 들늑대와 같은 뼈대(슬롯 400ms × 10칸 = 주기 4,000ms).
 * (3,0) 에 서서 오른쪽 부채꼴 — 예고 [1200, 2000) → 휩쓸기 [2000, 2400).
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

/**
 * 예고가 ε(1,000ms)보다 긴 변주 — 휩쓸기 [2700, 3100). "예고 중 무피해"가
 * ε 스미어 밖에서 성립함을 재려면 예고 안에 t±ε 이 전부 비활성인 순간이
 * 있어야 하는데, 예고 800ms 픽스처에는 그런 순간이 없다(스윕까지 최대
 * 800ms < ε). 이 기하가 곧 ε 의 대가를 문서화한다.
 */
const 긴예고늑대: MonsterDef = {
  ...들늑대,
  id: 'slow_wolf',
  attacks: [{ telegraphStartMs: 1200, telegraphMs: 1500, activeMs: 400, direction: 'right', reach: 3 }],
}

describe('currentHp — 자연 회복은 저장하지 않고 게으르게 계산한다(§6)', () => {
  // 왜: 회복을 저장하면 "회복을 지으러 오는 작업"이 필요해진다 — activeWeather 가
  //     만료를 시각 비교로 푸는 그 자리다. hp 칸은 lastHitAt 시점의 실측일 뿐이다.
  it('맞은 뒤 시간이 흐른 만큼 회복된 값을 돌려준다', () => {
    const combat = { hp: 40, lastHitAt: 10_000 }
    expect(currentHp(combat, 10_000)).toBe(40)
    expect(currentHp(combat, 10_000 + HP_REGEN_MS_PER_HP)).toBe(41)
    expect(currentHp(combat, 10_000 + 10 * HP_REGEN_MS_PER_HP)).toBe(50)
  })

  it('최대치에서 멈춘다 — 며칠 자리를 비워도 HP 는 상한이다', () => {
    expect(currentHp({ hp: 40, lastHitAt: 0 }, Number.MAX_SAFE_INTEGER)).toBe(COMBAT_MAX_HP)
  })

  it('시계가 뒤로 가도(now < lastHitAt) 회복이 음수가 되지 않는다', () => {
    expect(currentHp({ hp: 40, lastHitAt: 10_000 }, 5_000)).toBe(40)
  })
})

describe('defaultCombatState — 구세이브가 물려받는 기본값', () => {
  it('만혈·무교전·무기록으로 시작한다', () => {
    const c = defaultCombatState()
    expect(c).toEqual({ proficiency: 0, hp: COMBAT_MAX_HP, lastHitAt: 0, lastClaim: null, hunt: null, slain: {} })
  })

  // 왜: 참조형을 리터럴로 물려주면 세이브 둘이 같은 slain 을 공유한다 —
  //     protocol.ts 의 donated·dialogueHistory 가 함수 기본값인 그 이유다.
  it('부를 때마다 새 객체다 — 두 세이브가 같은 slain 을 공유하면 안 된다', () => {
    const a = defaultCombatState()
    const b = defaultCombatState()
    a.slain['wolf-1'] = 123
    expect(b.slain).toEqual({})
  })
})

describe('claimPlausible — 속도 개연성(§2-3), 거리는 맨해튼이다', () => {
  const last = { mapId: '사냥터', x: 0, y: 0, atMs: 100_000 }

  it('직전 주장이 없으면(첫 주장·전환 직후) 공회전한다 — 의도다(§12-앞 7)', () => {
    expect(claimPlausible(null, '사냥터', { x: 99, y: 99 }, 0)).toBe(true)
  })

  it('정직한 걸음 속도의 주장은 통과한다', () => {
    // 2,500ms 에 맨해튼 10칸: 예산 12.5 + 여유 ≥ 10.
    expect(claimPlausible(last, '사냥터', { x: 5, y: 5 }, 100_000 + 10 * STEP_MS + 500)).toBe(true)
  })

  // 왜: 체비쇼프(max)로 재면 대각 주장이 정직한 걸음의 2배속으로 통과한다
  //     (§2-3 실측 — 대각 5칸 = 맨해튼 10칸). 이동이 4방향이므로 자는 맨해튼뿐이다.
  it('대각 순간이동은 거절한다 — 체비쇼프 자였다면 통과했을 주장이다', () => {
    // 1,100ms 에 대각 5칸: 체비쇼프 5 ≤ 5.5+여유 통과, 맨해튼 10 > 5.5+여유 거절.
    const now = 100_000 + 1_100
    expect(1_100 / STEP_MS + CLAIM_SLACK_TILES).toBeLessThan(10)
    expect(claimPlausible(last, '사냥터', { x: 5, y: 5 }, now)).toBe(false)
  })

  it('같은 거리라도 시간이 넉넉하면 통과한다 — 자르는 것은 거리가 아니라 속도다', () => {
    expect(claimPlausible(last, '사냥터', { x: 5, y: 5 }, 100_000 + 10 * STEP_MS)).toBe(true)
  })

  // 왜: 다른 맵의 좌표끼리 맨해튼을 재면 전환으로 나갔다 되돌아온 정직한
  //     플레이어가 입구에서 몇 초 전투 불능이 된다(§2-3 전환 공회전 — 리뷰가
  //     사냥터 (3,1) → 재입장 (28,15) 로 ~7초 거절을 재현했다).
  it('직전 주장이 다른 맵이면 공회전한다 — 맵끼리 거리는 못 잰다', () => {
    const cross = { mapId: '마을', x: 3, y: 1, atMs: 100_000 }
    expect(claimPlausible(cross, '사냥터', { x: 28, y: 15 }, 100_000 + 1_600)).toBe(true)
  })
})

describe('attackConnects — 사거리 판정에 t±ε 허용폭(§2-5)', () => {
  it('판정 시각에 사거리 안이면 닿는다', () => {
    expect(attackConnects(들늑대, 0, { x: 3, y: 1 }, 2_200)).toBe(true)
  })

  // 왜: 동기화 백스톱은 ±2초를 상시 용인하고, 나쁜 앵커의 ~1초 오차는 다음 주기
  //     동기(5분)까지 지속된다(§2-5). ε 없이 t 한 점으로 판정하면 그 5분 동안
  //     화면에 붙어 있는 늑대가 서버에서는 이미 떠난 자리다.
  it('서버 시각에는 빗나가도 t−ε 에 닿았으면 인정한다 — 시계 오차 1초를 삼킨다', () => {
    // t=3,600: 몬스터는 (1,0)(거리 3, 밖). t−1,000=2,600: (3,0)(거리 1, 안).
    expect(attackConnects(들늑대, 0, { x: 3, y: 1 }, 3_600)).toBe(true)
    expect(JUDGE_EPSILON_MS).toBeGreaterThanOrEqual(1_000)
  })

  it('t±ε 어디에서도 닿지 않으면 헛스윙이다', () => {
    expect(attackConnects(들늑대, 0, { x: 9, y: 9 }, 2_200)).toBe(false)
  })

  // 왜: ε 는 구간이다(§2-5 문면). 세 점(t−ε·t·t+ε)만 표본하면 상태가 400ms
  //     계단 함수라 표본 사이에만 성립하는 슬롯을 통째로 놓친다 — 나쁜 앵커의
  //     오차는 0~1초 어디에나 오는데 세 점은 그중 세 근방만 삼킨다(리뷰 재현).
  it('세 점 표본 사이의 슬롯도 삼킨다 — 오차 ~650ms 의 정직한 스윙이다', () => {
    // t=1,250: 세 점은 250(슬롯0 (0,0))·1,250(슬롯3 (3,0))·2,250(슬롯5 (3,0)) —
    // 주장 (1,1) 에서 전부 밖. 그러나 구간 [250, 2,250] 안의 슬롯1 [400, 800) 은
    // (1,0) 이라 거리 1 — 구간 판정이면 닿는다.
    expect(attackConnects(들늑대, 0, { x: 1, y: 1 }, 1_250)).toBe(true)
  })

  it('배치 위상 오프셋이 패턴을 민다 — 같은 t 라도 배치마다 다른 자리다(§12-앞 23)', () => {
    // 오프셋 2,000: t=200 의 상태는 def 시각 2,200 — (3,0) 이다.
    expect(attackConnects(들늑대, 2_000, { x: 3, y: 1 }, 200)).toBe(true)
  })
})

describe('sweepCatches — 피격 판정에도 t±ε(§2-5), 위험은 구역이다(§2-2)', () => {
  it('휩쓸기 활성 중 부채꼴 안의 주장은 걸린다', () => {
    expect(sweepCatches(들늑대, 0, { x: 5, y: 0 }, 2_200)).toBe(true)
  })

  it('부채꼴 밖은 활성 중에도 걸리지 않는다', () => {
    expect(sweepCatches(들늑대, 0, { x: 0, y: 5 }, 2_200)).toBe(false)
  })

  // 왜: 예고 중 공격은 자유다(결정 3) — 단, ε 완화가 피격에도 걸리므로 이
  //     보장은 휩쓸기 경계에서 ε 바깥의 예고 순간에만 온전하다. 그래서 예고가
  //     ε 보다 긴 픽스처로 잰다 — 이 기하 조건 자체가 ε 의 문서화다.
  it('예고 중(휩쓸기 경계에서 ε 밖)의 주장은 무사하다', () => {
    // t=1,500: t−1,000=500(대기), t=1,500(예고), t+1,000=2,500(예고 — 휩쓸기는 2,700부터).
    expect(sweepCatches(긴예고늑대, 0, { x: 5, y: 0 }, 1_500)).toBe(false)
  })

  it('서버 시각에는 활성이 끝났어도 t−ε 에 걸렸으면 걸린다 — 오차는 양쪽으로 삼킨다', () => {
    // t=3,200: 활성 [2,000, 2,400) 밖. t−1,000=2,200: 안.
    expect(sweepCatches(들늑대, 0, { x: 5, y: 0 }, 3_200)).toBe(true)
  })

  // 왜: 활성 창(400ms)이 표본 간격(1,000ms)보다 좁아, 세 점 표본은 구간이
  //     창을 완전히 덮는데도 세 점이 전부 창 밖인 t 를 놓친다 — 회피 실패가
  //     t 에 따라 걸렸다 안 걸렸다 하는 비단조가 된다(리뷰 재현).
  it('세 점 표본 사이의 활성 창도 잡는다 — 구간이 창을 덮으면 걸린 것이다', () => {
    // t=1,600: 세 점은 600(대기)·1,600(예고)·2,600(활성 끝 뒤) — 전부 창 밖.
    // 그러나 구간 [600, 2,600] 은 활성 [2,000, 2,400) 을 통째로 품는다.
    expect(sweepCatches(들늑대, 0, { x: 5, y: 0 }, 1_600)).toBe(true)
  })
})

describe('monsterAlive — 처치 기록과 리스폰 대기', () => {
  it('기록이 없으면 살아 있다', () => {
    expect(monsterAlive({}, 'wolf-1', 0)).toBe(true)
  })

  it('처치 직후에는 부재다 — 리스폰 대기 전에 다시 잡을 수 없다', () => {
    expect(monsterAlive({ 'wolf-1': 10_000 }, 'wolf-1', 10_000 + MONSTER_RESPAWN_MS - 1)).toBe(false)
  })

  it('리스폰 대기가 지나면 돌아온다', () => {
    expect(monsterAlive({ 'wolf-1': 10_000 }, 'wolf-1', 10_000 + MONSTER_RESPAWN_MS)).toBe(true)
  })

  // 왜: instanceId 는 클라이언트가 보낸 문자열이다 — 상속 키("constructor")가
  //     프로토타입 체인에서 값을 찾으면 그 몬스터는 영원히 부재가 된다
  //     (gatherService 의 Object.hasOwn 과 같은 자리).
  it('상속 키는 기록으로 치지 않는다', () => {
    expect(monsterAlive({}, 'constructor', 0)).toBe(true)
  })
})

describe('swingDamageOf — 강화가 피해를 산다(아크 D §1): 기본 피해 + n 선형', () => {
  const sword = testTool('copper_sword', 'combat', 1, { damage: 5 })

  it('+0 은 정의의 기본 피해 그대로다', () => {
    expect(swingDamageOf(sword, 0)).toBe(5)
  })

  // 왜: 들늑대(HP 8)는 +3 부터 1스윙이 된다 — 첫 검의 강화 사다리에 실제
  //     문턱(2스윙→1스윙)이 하나 놓이고, 그 문턱은 가방 피해 숫자가 말한다.
  it('+3 은 8 — 들늑대(HP 8)의 1스윙 경계다', () => {
    expect(swingDamageOf(sword, 3)).toBe(8)
  })

  it('+5(만강)는 10 이다', () => {
    expect(swingDamageOf(sword, 5)).toBe(10)
  })

  it('damage 칸이 빈 정의는 맨손 상수에서 출발한다 — 파서가 막지만 식도 죽지 않는다', () => {
    expect(swingDamageOf(testTool('blunt', 'combat', 1), 3)).toBe(UNARMED_COMBAT_DAMAGE + 3)
  })
})

describe('armorDefenseOf — 강화가 경감을 산다(아크 E §2): 기본 defense + n, swingDamageOf 의 쌍둥이', () => {
  const armor = testTool('wolf_hide_armor', 'armor', 1, { defense: 5 })

  it('+0 은 정의의 defense 그대로다', () => {
    expect(armorDefenseOf(armor, 0)).toBe(5)
  })

  // 왜: 늑대 sweepDamage 20 에서 +5 는 피격을 10 으로 만든다 — 방치 사망
  //     ~22s → ~33s ≈ 설계 35s(§2 산술). 그리고 20−5−n 이 매 단 1씩 줄므로
  //     검(+4·+5 죽은 단)과 달리 방어구는 전 단이 산다: 죽은 단 없는 사다리.
  it('+5(만강)는 10 이다', () => {
    expect(armorDefenseOf(armor, 5)).toBe(10)
  })

  it('defense 칸이 빈 정의는 강화만 남는다 — 파서가 막지만 식도 죽지 않는다', () => {
    expect(armorDefenseOf(testTool('rag', 'armor', 1), 3)).toBe(3)
  })
})

describe('swingDamage — 회당 피해는 무기가 진다(§2-2), 강화는 인스턴스가 진다(아크 D §1)', () => {
  const sword = testTool('copper_sword', 'combat', 1, { damage: 5 })
  const pickaxe = testTool('copper_pickaxe', 'mineral', 1)
  const items = { copper_sword: sword, copper_pickaxe: pickaxe }
  const base = {
    instances: [
      { instanceId: 's1', itemId: 'copper_sword', enhanceLevel: 0 },
      { instanceId: 'p1', itemId: 'copper_pickaxe', enhanceLevel: 0 },
    ],
  }

  it('무기가 없으면 맨손 상수다 — 첫 늑대는 구조적으로 맨손이다(§12-앞 9)', () => {
    const player = { ...base, equipped: {} } as unknown as PlayerState
    expect(swingDamage(player, items)).toBe(UNARMED_COMBAT_DAMAGE)
  })

  it('combat 슬롯의 무기 damage 를 읽는다 — +0 은 정의 그대로다', () => {
    const player = { ...base, equipped: { combat: 's1' } } as unknown as PlayerState
    expect(swingDamage(player, items)).toBe(5)
  })

  // 왜: 강화 수치는 정의가 아니라 인스턴스에 있다(equipment.ts) — 판정이 def 만
  //     보면 +5 검이 +0 과 똑같이 때려 강화 수요 전체의 보상이 죽는다(아크 D §0-1).
  it('착용 인스턴스의 enhanceLevel 이 피해를 산다 — +3 검은 8 로 때린다', () => {
    const player = {
      ...base,
      instances: [{ instanceId: 's1', itemId: 'copper_sword', enhanceLevel: 3 }],
      equipped: { combat: 's1' },
    } as unknown as PlayerState
    expect(swingDamage(player, items)).toBe(swingDamageOf(sword, 3))
    expect(swingDamage(player, items)).toBe(8)
  })

  // 왜: "엉뚱한 슬롯의 도구 = 맨손"(§6-앞 9)이 전투에서도 같은 조회(equippedToolInfo)로
  //     지켜져야 한다 — 곡괭이를 combat 칸에 우겨 넣은 세이브가 피해를 얻으면 안 된다.
  it('combat 칸에 엉뚱한 도구가 꽂혀 있으면 맨손이다', () => {
    const player = { ...base, equipped: { combat: 'p1' } } as unknown as PlayerState
    expect(swingDamage(player, items)).toBe(UNARMED_COMBAT_DAMAGE)
  })

  // 왜: 맨손 낙하는 식보다 먼저다 — 엉뚱한 도구의 강화 수치가 맨손 위에 얹히면
  //     +5 곡괭이가 검 없이 6 을 때리는 뒷문이 된다.
  it('엉뚱한 도구는 강화돼 있어도 맨손 상수 그대로다 — 강화가 맨손을 사면 안 된다', () => {
    const player = {
      ...base,
      instances: [{ instanceId: 'p1', itemId: 'copper_pickaxe', enhanceLevel: 5 }],
      equipped: { combat: 'p1' },
    } as unknown as PlayerState
    expect(swingDamage(player, items)).toBe(UNARMED_COMBAT_DAMAGE)
  })
})

describe('rollMonsterDrop — 채집표와 같은 누적 확률, rng 주입', () => {
  const table = { monsterId: 'wolf', drops: [{ itemId: 'fang', chance: 0.2 }, { itemId: 'pelt', chance: 0.3 }] }

  it('누적 경계로 뽑는다 — roll < 누적이면 그 줄이다', () => {
    expect(rollMonsterDrop(table, () => 0.19)).toBe('fang')
    expect(rollMonsterDrop(table, () => 0.25)).toBe('pelt')
    expect(rollMonsterDrop(table, () => 0.49)).toBe('pelt')
  })

  it('누적 질량 밖의 roll 은 빈손이다', () => {
    expect(rollMonsterDrop(table, () => 0.5)).toBe(null)
  })

  it('표가 없는 몬스터는 언제나 빈손이다 — C6 전의 빈 배선이 죽지 않아야 한다', () => {
    expect(rollMonsterDrop(undefined, () => 0)).toBe(null)
  })
})
