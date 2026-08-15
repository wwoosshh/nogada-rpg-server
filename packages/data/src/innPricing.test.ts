import { COMBAT_MAX_HP, HP_REGEN_MS_PER_HP, gatherBracketFor } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { goldPerMinute, measureHand } from './gatherMeasure.js'
import { variantOfTableId } from './gatherTables.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * **여관 회복비 — 값 결정과 기록**(전투 설계 §6). 기계(서버 route·화면)는 이
 * 아크 밖이고 다음 아크의 씨앗이다 — 여기서는 부등식과 값만 못박는다.
 *
 * §6 의 부등식: **여관비 ≤ 자연 회복을 기다리는 동안 벌 수 있는 골드** —
 * 아니면 아무도 안 산다. 변들의 출처:
 * - 대기 시간: 0 → 만혈이 COMBAT_MAX_HP(100) × HP_REGEN_MS_PER_HP(3,000ms)
 *   = 300,000ms = 5분(§6 "만혈까지 5분").
 * - 벌이: 초반 손(구리 도구 1티어·증표 없음·강화 0·숙련 0)의 분당 산출을
 *   gatherMeasure 의 goldPerMinute 로 잰다 — 검증들이 표를 재는 그 자 하나다.
 *   네 계열 중 **가장 인색한 계열**이 기준이다: 어느 마을에서 시작했든 부등식이
 *   서야 하므로 최악의 손이 변이다.
 *
 * 결정(2026-08-15 실측): 구리 손·숙련 0 의 분당 산출은 ice 2,765 · wood 2,734 ·
 * mineral 1,027 · herb 3,683 G — 최악은 광물 1,027 G/분이고 5분 벌이는 약
 * 5,137 G 다. **여관비는 500 G 로 정한다**: 천장의 약 1/10 이라 표를 재조정해도
 * 부등식이 넉넉히 버티고, "잠깐 쉬거나 여관"의 저울(§6)에서 여관이 사치가 아닌
 * 선택지로 남는 값이다. 아래 테스트가 이 산술을 재므로, 표·회복 상수가 움직여
 * 부등식이 깨지면 이 파일이 빨개진다 — 그때는 값을 다시 정한다(가루 저울의 교훈).
 */
const INN_RECOVERY_GOLD = 500

describe('여관 회복비 — §6 부등식을 못박는다 (기계는 다음 아크)', () => {
  const data = loadGameData()
  const tables = loadGatherTables()

  /** 바깥 표 넷 — 접미사 없는 표가 바깥이다(gatherTables 의 그 정의). */
  const outers = Object.values(tables).filter((t) => variantOfTableId(t.id) === 'normal')

  it('초반 손의 벌이를 잴 표가 네 계열 다 있다', () => {
    expect(outers).toHaveLength(4)
  })

  it('여관비 ≤ 자연 회복 대기(만혈 5분) 동안의 최악 벌이', () => {
    const perMinute = outers.map((table) => {
      const hand = measureHand(table.skill, data.items, 1, false, 0)
      if (!hand) throw new Error(`${table.skill} 계열의 1티어 도구가 없어 잴 수 없다`)
      return goldPerMinute(table, gatherBracketFor(table, 0), 0, hand, data.items)
    })
    const worst = Math.min(...perMinute)
    // 부등식이 공허하지 않다 — 벌이가 0 이면 어떤 값도 못 정한 것이다.
    expect(worst).toBeGreaterThan(0)

    const waitMinutes = (COMBAT_MAX_HP * HP_REGEN_MS_PER_HP) / 60_000
    const budget = Math.floor(worst * waitMinutes)
    expect(INN_RECOVERY_GOLD, `천장 ${budget}G (최악 ${worst.toFixed(0)}G/분 × ${waitMinutes}분)`).toBeLessThanOrEqual(budget)
    expect(INN_RECOVERY_GOLD).toBeGreaterThan(0)
  })
})
