import { COMBAT_MAX_HP, HP_REGEN_MS_PER_HP, gatherBracketFor } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { goldPerMinute, measureHand } from './gatherMeasure.js'
import { variantOfTableId } from './gatherTables.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'

/**
 * **여관 회복비 — §6 부등식의 자**(전투 설계 §6·아크 D §2). 기계(서버
 * `/api/inn`·여관 패널)는 아크 D 가 세웠고, 값의 주인은 이제 `inns.csv` 다
 * (씨앗 ⑦ 종결: 값은 데이터가 소유하고 검증이 데이터를 읽는다). 이 테스트는
 * **구운 데이터에서 값을 읽어** 부등식을 못박는다 — 테스트 안의 상수 사본은
 * 삭제됐다: 사본이 남아 있으면 CSV 를 고친 날 자와 값이 조용히 갈라진다.
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
 * **1,500G 인 이유**(2026-08-15 게임성 평가 산술 — 500G 결정의 갱신): 실측
 * 분당 산출은 ice 2,765 · wood 2,734 · mineral 1,027 · herb 3,683 G — 최악은
 * 광물 1,027 G/분이고 5분 천장은 약 5,137 G 다. 옛 값 500G 는 최악 벌이로도
 * **29초**라 "대기 5분 vs 여관"의 저울이 아예 안 섰다. 1,500G 는 최악 벌이
 * **약 1.46분**(1,500 ÷ 1,027) = **대기 5분의 30%** 라 진짜 선택이 되고,
 * 천장 대비 29%(1,500 ÷ 5,137)라 표를 재조정해도 부등식은 여유로 버틴다.
 * 아래 테스트가 이 산술을 재므로, 표·회복 상수·CSV 값이 움직여 부등식이
 * 깨지면 이 파일이 빨개진다 — 그때는 값을 다시 정한다(가루 저울의 교훈).
 */
describe('여관 회복비 — 구운 값이 §6 부등식을 지킨다', () => {
  const data = loadGameData()
  const tables = loadGatherTables()

  /** 바깥 표 넷 — 접미사 없는 표가 바깥이다(gatherTables 의 그 정의). */
  const outers = Object.values(tables).filter((t) => variantOfTableId(t.id) === 'normal')

  it('여관이 구워져 있다 — 값을 잴 대상이 데이터에 실재한다', () => {
    // 부등식이 공허하지 않으려면 여관이 최소 하나는 있어야 한다. 지금은
    // 여관안주인 하나다 — 여관이 늘면 아래 부등식이 전부를 잰다.
    expect(Object.keys(data.inns).length).toBeGreaterThan(0)
    expect(data.inns['여관안주인']).toBeDefined()
  })

  it('초반 손의 벌이를 잴 표가 네 계열 다 있다', () => {
    expect(outers).toHaveLength(4)
  })

  it('구운 여관비 ≤ 자연 회복 대기(만혈 5분) 동안의 최악 벌이', () => {
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
    for (const inn of Object.values(data.inns)) {
      expect(
        inn.gold,
        `inns[${inn.speakerId}] 천장 ${budget}G (최악 ${worst.toFixed(0)}G/분 × ${waitMinutes}분)`,
      ).toBeLessThanOrEqual(budget)
      expect(inn.gold).toBeGreaterThan(0)
    }
  })
})
