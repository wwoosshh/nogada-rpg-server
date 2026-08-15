import {
  COMBAT_MAX_HP,
  HP_REGEN_MS_PER_HP,
  defaultCombatState,
  type InnDef,
  type PlayerState,
} from '@nogada/shared'
import { emptyPlayer } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { performRest } from './innService.js'

/*
 * 여관 회복(아크 D §2) — 값을 치르고 만혈이 된다. 판정 순서가 계약이다:
 * ① 골드 → ② 만혈 → ③ 수락. 만혈 검사는 저장칸(hp)이 아니라 shared 의
 * currentHp 로 잰다 — 자연 회복은 저장되지 않으므로(전투 §6) 저장칸을 읽으면
 * 이미 다 나은 사람에게 돈을 받는 죽은 버튼의 서버판이 된다.
 */

const 여관: InnDef = { speakerId: '여관안주인', gold: 1500 }

/** 시각 하나를 고정한다 — lastHitAt 과의 차가 곧 자연 회복이다. */
const NOW = 10_000_000

function player(over: Partial<PlayerState> = {}): PlayerState {
  return { ...emptyPlayer(), ...over }
}

/** 방금(NOW 시점에) hp 로 실측된 다친 사람 — 자연 회복이 아직 0 이다. */
function hurt(hp: number, gold: number): PlayerState {
  return player({ gold, combat: { ...defaultCombatState(), hp, lastHitAt: NOW } })
}

describe('performRest', () => {
  it('골드가 값에 못 미치면 not_enough_gold — 거절은 아무것도 저장하지 않는다', () => {
    const p = hurt(40, 1_499)
    const r = performRest({ player: p, inn: 여관, now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_enough_gold' })
    // 입력 객체 무변경 — 거절 경로는 아무것도 저장하지 않는다(Global Constraints).
    expect(p.gold).toBe(1_499)
    expect(p.combat.hp).toBe(40)
  })

  // 왜: 순서가 ①골드 → ②만혈이다(계획 D2). 만혈을 먼저 보면 "돈도 없고 만혈"인
  //     사람에게 already_full 이 나가는데, 그 사람이 다친 뒤 다시 오면 문구가
  //     골드로 바뀐다 — 같은 빈 주머니에 화면이 두 말을 하게 된다.
  it('골드도 없고 만혈이어도 골드 부족을 먼저 말한다', () => {
    const r = performRest({ player: hurt(COMBAT_MAX_HP, 0), inn: 여관, now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_enough_gold' })
  })

  it('만혈이면 already_full — 회복할 것이 없는데 돈을 받으면 죽은 버튼의 서버판이다', () => {
    const p = hurt(COMBAT_MAX_HP, 5_000)
    const r = performRest({ player: p, inn: 여관, now: NOW })
    expect(r).toEqual({ ok: false, code: 'already_full' })
    expect(p.gold).toBe(5_000)
  })

  // 왜: 이것이 경합 창의 실체다 — 저장칸은 40 인데 자연 회복이 이미 다 채웠다.
  //     저장칸을 직접 읽으면(currentHp 를 안 부르면) 다 나은 사람의 돈을 받는다.
  //     화면(만혈 버튼 부재)과 서버가 같은 shared 술어를 불러야 하는 이유다.
  it('저장칸이 만혈이 아니어도 자연 회복이 다 찼으면 already_full 이다', () => {
    const healedAll = (COMBAT_MAX_HP - 40) * HP_REGEN_MS_PER_HP
    const p = player({ gold: 5_000, combat: { ...defaultCombatState(), hp: 40, lastHitAt: NOW - healedAll } })
    const r = performRest({ player: p, inn: 여관, now: NOW })
    expect(r).toEqual({ ok: false, code: 'already_full' })
  })

  it('수락 — 골드가 값만큼 줄고 hp 는 만혈, lastHitAt 은 지금이 된다', () => {
    const p = hurt(40, 1_500) // 경계값: 딱 값만큼 가진 사람도 잘 수 있다
    const r = performRest({ player: p, inn: 여관, now: NOW })
    if (!r.ok) throw new Error(`수락돼야 한다 — ${r.code}`)
    expect(r.outcome.player.gold).toBe(0)
    expect(r.outcome.player.combat.hp).toBe(COMBAT_MAX_HP)
    // lastHitAt = now — hp 칸이 지금 실측이 됐다는 표시다(전투 §6). 과거로 두면
    // currentHp 가 그 위에 회복을 또 얹는다(만혈이라 상한에 눌리지만, 실측 규약이 깨진다).
    expect(r.outcome.player.combat.lastHitAt).toBe(NOW)
    // 판정은 사본 위에서 한다 — 입력은 그대로다.
    expect(p.gold).toBe(1_500)
    expect(p.combat.hp).toBe(40)
  })

  it('반쯤 자연 회복된 사람도 수락된다 — 만혈만 아니면 값은 같다', () => {
    const p = player({
      gold: 2_000,
      combat: { ...defaultCombatState(), hp: 40, lastHitAt: NOW - 10 * HP_REGEN_MS_PER_HP },
    })
    const r = performRest({ player: p, inn: 여관, now: NOW })
    if (!r.ok) throw new Error(`수락돼야 한다 — ${r.code}`)
    expect(r.outcome.player.gold).toBe(500)
    expect(r.outcome.player.combat.hp).toBe(COMBAT_MAX_HP)
  })
})
