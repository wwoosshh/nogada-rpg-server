import {
  COMBAT_SKILL_GAIN_MAX,
  COMBAT_SKILL_GAIN_MIN,
  MONSTER_RESPAWN_MS,
  UNARMED_COMBAT_DAMAGE,
  combatIntervalMs,
  sellPrice,
  swingDamageOf,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { loadGameData } from './load.js'
import { loadMonsterDrops } from './loadMonsterDrops.js'

/**
 * **첫 가죽옷까지의 분-자**(아크 E §3) — 검 부트스트랩에 **이어지는 증분**으로
 * 전투 활동 2~6분.
 *
 * combatBootstrap(첫 검 3~8분)과 같은 문법의 자인데 재사용할 수 없는 이유가
 * 스펙에 적혀 있다: 저쪽은 맨손 모형 하드코딩이다. 여기는 검을 쥔 손의
 * 모형이고, 두 수가 저쪽과 다르다 —
 *
 * - **시작 숙련은 0 이 아니라 검 부트스트랩 모형의 종료 숙련이다.** 가죽옷
 *   레시피가 구리 주괴(= 구리 검과 같은 부트스트랩 시기의 재료)를 물고
 *   있어도, 가죽 8장을 떨구는 늑대는 검의 재료였던 송곳니를 떨구는 그
 *   늑대다 — 이 자가 재는 사람은 검을 이미 만든 사람이다. 상수 240 을
 *   복사하지 않고 저쪽 모형(송곳니 N ÷ chance × 맨손 스윙, 스윙당 기대
 *   +1.5)을 그대로 다시 계산해 유도한다: 드랍률·레시피·상수를 재조정하면
 *   저쪽 자와 이 자가 **같은 값에서 함께** 움직인다.
 * - **처치당 스윙은 맨손이 아니라 미강화 검이다.** ⌈maxHp ÷ swingDamageOf
 *   (구리 검, +0)⌉ — 회당 피해를 정의(damage 칸)에서 읽는 그 shared 식이다.
 *   현행 데이터로 ⌈8÷5⌉ = 2스윙/처치.
 *
 * 나머지는 저쪽과 같은 상수·같은 적분이다: 스윙 간격은 combatIntervalMs 를
 * 스윙마다 갱신, 처치당 부대시간 5,000ms(모형의 유일한 자체 상수 — 브라우저
 * 실측 대상), 기대 처치 = 가죽 N ÷ 드랍 chance, 리스폰 대기 0 의 전제는
 * 아래 테스트가 그 자리에서 검산한다.
 *
 * 숫자를 어디서도 복사하지 않는다: 가죽 수량은 recipes.csv, 드랍 chance 는
 * monster_drops.csv, maxHp 는 monster_placements.csv, 검 피해는 items.csv 의
 * damage 칸(swingDamageOf 경유), 간격·숙련 증가는 shared 의 그 상수·그 함수다.
 */

const ARMOR_MIN_MINUTES = 2
const ARMOR_MAX_MINUTES = 6

/** 처치당 부대시간(접근·회피) — combatBootstrap 과 같은 모형 상수다. */
const OVERHEAD_MS_PER_KILL = 5_000

/** 스윙당 기대 숙련 증가 — 상수 둘의 평균(+1.5)을 리터럴 없이 유도한다. */
const SKILL_PER_SWING = (COMBAT_SKILL_GAIN_MIN + COMBAT_SKILL_GAIN_MAX) / 2

describe('첫 가죽옷까지의 분-자 — 검에 이어 전투 활동 2~6분(아크 E §3)', () => {
  const data = loadGameData()
  const drops = loadMonsterDrops()

  const armorRecipe = data.recipes['wolf_hide_armor']!
  const swordRecipe = data.recipes['copper_sword']!
  const placements = Object.values(data.monsterPlacements)
  const maxHp = placements[0]?.maxHp ?? 0

  const dropChanceOf = (itemId: string): number =>
    Object.values(drops)[0]?.drops.find((d) => d.itemId === itemId)?.chance ?? 0

  it('첫 가죽옷은 게이트 뒤에 있지 않다 — 검과 같은 부트스트랩 자세다', () => {
    expect(armorRecipe, 'wolf_hide_armor 레시피').toBeDefined()
    expect(armorRecipe.requiredSkill).toBe(0)
    expect(armorRecipe.gateValue).toBeUndefined()
  })

  it('가죽 드랍도 종 표 하나를 배치마다 건다 — chance 가 배치 사이에서 갈리면 이 자가 무엇을 재는지 모호해진다', () => {
    const chances = new Set(
      Object.values(drops).map((t) => t.drops.find((d) => d.itemId === 'wolf_pelt')?.chance),
    )
    expect(chances.size).toBe(1)
  })

  // ── 시작 숙련: combatBootstrap 모형의 종료 숙련을 다시 계산한다 ──
  // 저쪽 적분은 스윙마다 +SKILL_PER_SWING 이므로 종료 숙련 = 총 스윙 × 그 값 —
  // 루프의 끝 상태를 닫힌 식으로 적은 것뿐, 같은 모형이다.
  const fangsNeeded = swordRecipe.inputs.find((i) => i.item === 'wolf_fang')?.count ?? 0
  const unarmedSwingsPerKill = Math.ceil(maxHp / UNARMED_COMBAT_DAMAGE)
  const swordBootstrapSwings = Math.ceil((fangsNeeded / dropChanceOf('wolf_fang')) * unarmedSwingsPerKill)
  const startProficiency = swordBootstrapSwings * SKILL_PER_SWING

  // ── 증분: 미강화 검을 쥔 손으로 가죽 8장 ──
  const peltsNeeded = armorRecipe.inputs.find((i) => i.item === 'wolf_pelt')?.count ?? 0
  const sword = data.items['copper_sword']!
  const swingsPerKill = Math.ceil(maxHp / swingDamageOf(sword, 0))
  const expectedKills = peltsNeeded / dropChanceOf('wolf_pelt')
  const totalSwings = Math.ceil(expectedKills * swingsPerKill)

  let proficiency = startProficiency
  let combatMs = 0
  for (let i = 0; i < totalSwings; i++) {
    combatMs += combatIntervalMs(proficiency)
    proficiency += SKILL_PER_SWING
  }
  combatMs += expectedKills * OVERHEAD_MS_PER_KILL
  const minutes = combatMs / 60_000

  it('리스폰 대기는 0 이다 — 검을 쥔 가장 빠른 손으로도 배치 셋 한 바퀴가 리스폰보다 길다', () => {
    // combatBootstrap 의 그 검산을 이 모형의 끝 숙련·검 스윙 수로 다시 한다:
    // 검이 처치를 8스윙 → 2스윙으로 줄였는데도 한 바퀴가 대기보다 길어야,
    // 모형이 리스폰 대기를 0 으로 접는 전제가 이 자에서도 산다.
    const fastestKillMs = swingsPerKill * combatIntervalMs(proficiency) + OVERHEAD_MS_PER_KILL
    expect(fastestKillMs * placements.length).toBeGreaterThan(MONSTER_RESPAWN_MS)
  })

  it('첫 가죽옷까지 기대 전투 활동 증분이 2~6분 안이다 — 이 핀이 방어구 페이싱 계약이다', () => {
    const at = `가죽 ${peltsNeeded}장 ÷ chance ${dropChanceOf('wolf_pelt')} = 기대 처치 ${expectedKills.toFixed(1)}회, 검 ${swingsPerKill}스윙/처치 → 스윙 ${totalSwings}회, 시작 숙련 ${startProficiency} → ${minutes.toFixed(1)}분`
    expect(minutes, at).toBeGreaterThanOrEqual(ARMOR_MIN_MINUTES)
    expect(minutes, at).toBeLessThanOrEqual(ARMOR_MAX_MINUTES)
  })

  it('가죽의 매도가는 20 이다 — 스펙의 "매도가 20"은 정가 칸이 아니라 절반 규칙의 출력이다', () => {
    // items.csv 의 price 칸은 **정가**이고 매도가는 sellPrice(정가 절반·내림)가
    // 유도한다(설계 §2). 그래서 아크 E §3 의 "매도가 20"을 데이터로 옮기면
    // price 칸에는 40 을 적는다 — 20 을 그대로 적으면 상점이 사 주는 값은
    // 10 이 되어 스펙의 절반이 된다. 이 핀이 그 번역을 못박는다.
    expect(sellPrice(data.items['wolf_pelt']!)).toBe(20)
  })
})
