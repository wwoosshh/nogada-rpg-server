import {
  COMBAT_SKILL_GAIN_MAX,
  COMBAT_SKILL_GAIN_MIN,
  MONSTER_RESPAWN_MS,
  UNARMED_COMBAT_DAMAGE,
  combatIntervalMs,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { loadGameData } from './load.js'
import { loadMonsterDrops } from './loadMonsterDrops.js'

/**
 * **첫 검까지의 분-자**(전투 설계 §9-7, §12-앞 10) — 전투 활동 3~8분.
 *
 * 참조는 노드 아크의 30~60분 자(specialDemand)가 아니라 부트스트랩 자
 * (bootstrapEstimate — 첫 도구 계약)다. 첫 검은 첫 도구다: 송곳니가 검의
 * 재료라 첫 늑대는 구조적으로 맨손이고(§12-앞 9), 그 맨손 구간이 얼마나
 * 긴지가 이 자 하나로 못박힌다.
 *
 * 숫자를 어디서도 복사하지 않는다: 송곳니 수량은 recipes.csv, 드랍 chance 는
 * monster_drops.csv(서버 전용 산출물), maxHp 는 monster_placements.csv 에서
 * 읽고, 간격·맨손 피해·리스폰은 shared 의 그 상수·그 함수다 — 드랍률이나
 * 레시피를 재조정하면 이 추정이 함께 움직인다.
 *
 * 모형(전부 여기 문서화된 상수다):
 * - 스윙 간격: `combatIntervalMs(누적 숙련)` 을 **스윙마다** 갱신. 숙련은
 *   성패 무관 회당 +1~2(§5)이므로 기대 +1.5/스윙 — 상수 둘의 평균으로 유도한다.
 * - 처치당 스윙: ⌈maxHp ÷ 맨손 피해(UNARMED_COMBAT_DAMAGE)⌉.
 * - 처치당 부대시간(접근·회피): 5,000ms 상수 — 휩쓸기를 피해 물러났다
 *   돌아오는 발놀림의 어림값이다(브라우저 실측 대상, C7).
 * - 기대 처치: 송곳니 N ÷ 드랍 chance.
 * - 리스폰 대기: 배치 셋을 순환하는 한 바퀴가 리스폰(MONSTER_RESPAWN_MS)보다
 *   길면 0 — 아래 테스트가 그 전제 자체를 못박는다.
 */

const BOOTSTRAP_MIN_MINUTES = 3
const BOOTSTRAP_MAX_MINUTES = 8

/** 처치당 부대시간(접근·회피) — 모형의 유일한 자체 상수. */
const OVERHEAD_MS_PER_KILL = 5_000

/** 스윙당 기대 숙련 증가 — 상수 둘의 평균(+1.5)을 리터럴 없이 유도한다. */
const SKILL_PER_SWING = (COMBAT_SKILL_GAIN_MIN + COMBAT_SKILL_GAIN_MAX) / 2

describe('첫 검까지의 분-자 — 전투 활동 3~8분(§9-7)', () => {
  const data = loadGameData()
  const drops = loadMonsterDrops()

  const recipe = data.recipes['copper_sword']!
  const placements = Object.values(data.monsterPlacements)

  it('첫 검은 게이트 뒤에 있지 않다 — 맨손→검이 부트스트랩이다', () => {
    expect(recipe, 'copper_sword 레시피').toBeDefined()
    expect(recipe.requiredSkill).toBe(0)
    expect(recipe.gateValue).toBeUndefined()
  })

  it('드랍표는 종 표 하나를 배치마다 건다 — chance 가 배치 사이에서 갈리면 이 자가 무엇을 재는지 모호해진다', () => {
    expect(placements.length).toBeGreaterThanOrEqual(3)
    const chances = new Set(
      Object.values(drops).map((t) => t.drops.find((d) => d.itemId === 'wolf_fang')?.chance),
    )
    expect(chances.size).toBe(1)
    const hps = new Set(placements.map((p) => p.maxHp))
    expect(hps.size).toBe(1)
  })

  const fangsNeeded = recipe.inputs.find((i) => i.item === 'wolf_fang')?.count ?? 0
  const dropChance = Object.values(drops)[0]?.drops.find((d) => d.itemId === 'wolf_fang')?.chance ?? 0
  const maxHp = placements[0]?.maxHp ?? 0

  const swingsPerKill = Math.ceil(maxHp / UNARMED_COMBAT_DAMAGE)
  const expectedKills = fangsNeeded / dropChance
  const totalSwings = Math.ceil(expectedKills * swingsPerKill)

  // 스윙 간격을 스윙마다 갱신하며 적분한다 — 숙련이 오르는 동안 간격이 줄어드는
  // 것까지가 이 자의 정직함이다(부트스트랩 자가 첫 브라켓 고정을 검산하는 그 자세).
  let proficiency = 0
  let combatMs = 0
  for (let i = 0; i < totalSwings; i++) {
    combatMs += combatIntervalMs(proficiency)
    proficiency += SKILL_PER_SWING
  }
  combatMs += expectedKills * OVERHEAD_MS_PER_KILL
  const minutes = combatMs / 60_000

  it('리스폰 대기는 0 이다 — 가장 빨라진 손으로도 배치 셋 한 바퀴가 리스폰보다 길다', () => {
    // 모형이 리스폰 대기를 0 으로 접는 전제를 그 자리에서 검산한다: 순환의 가장
    // 빠른 한 바퀴(끝 숙련의 간격 × 처치당 스윙 + 부대시간)조차 대기보다 길면,
    // 첫 자리로 돌아왔을 때 그 늑대는 언제나 돌아와 있다.
    const fastestKillMs = swingsPerKill * combatIntervalMs(proficiency) + OVERHEAD_MS_PER_KILL
    expect(fastestKillMs * placements.length).toBeGreaterThan(MONSTER_RESPAWN_MS)
  })

  it('첫 검까지 기대 전투 활동이 3~8분 안이다 — 이 핀이 전투 페이싱 계약이다', () => {
    const at = `송곳니 ${fangsNeeded}개 ÷ chance ${dropChance} = 기대 처치 ${expectedKills}회, 스윙 ${totalSwings}회 → ${minutes.toFixed(1)}분`
    expect(minutes, at).toBeGreaterThanOrEqual(BOOTSTRAP_MIN_MINUTES)
    expect(minutes, at).toBeLessThanOrEqual(BOOTSTRAP_MAX_MINUTES)
  })
})
