import { COMBAT_MAX_HP, currentHp, type InnDef, type PlayerState } from '@nogada/shared'

/**
 * 여관 회복(아크 D §2) — 값을 치르고 만혈이 된다. 죽으면 "5분 기다림"이
 * 유일하던 자리에 §6 의 저울(여관 vs 대기)을 세우는 기계다.
 *
 * **행동 간격을 검사도 소비도 하지 않는다** — 거래·착용과 같은 이유다(§6-앞 18):
 * 쉬는 것은 행동이 아니라 노가다 사이의 손짓이고, 연타로 악용할 것도 없다 —
 * 두 번째 요청은 만혈이라 already_full 로 거절된다.
 *
 * 난수도 없다. 근접 게이트도 없다 — 상점과 같은 신뢰 모델이다(현장 판정은
 * talk 가 문을 열 때 speakerPresence 로 이미 지났고, 앞칸 판정은 클라이언트의
 * 몫이다). 시각(now)은 라우트가 넣어 준 것을 그대로 쓴다: 만혈 판정과
 * lastHitAt 에 적히는 시각이 갈라지면 안 된다.
 */

export interface PerformRestArgs {
  player: PlayerState
  /** 어느 여관인가 — 값(gold)의 주인은 inns.csv 다. 라우트가 등록부에서 꺼내 준다. */
  inn: InnDef
  /** 만혈 판정과 lastHitAt 에 함께 쓰는 시각. */
  now: number
}

/** 응답은 플레이어 통째 하나다 — 착용·거래와 같은 모양이라 클라이언트의 적용 경로가 하나다. */
export interface RestOutcome {
  player: PlayerState
}

/**
 * `already_full` 이 따로 있는 이유(§2): 회복할 것이 없는데 돈을 받으면 죽은
 * 버튼의 서버판이다. 화면은 만혈이면 버튼을 안 그리지만(같은 shared 술어),
 * 회복 완료 직전에 누른 경합 창은 화면이 못 막는다 — 그 거절에 말이 있어야 한다.
 */
export type RestErrorCode = 'not_enough_gold' | 'already_full'

export type RestResult = { ok: true; outcome: RestOutcome } | { ok: false; code: RestErrorCode }

/**
 * 판정 순서가 계약이다: ① 골드 → ② 만혈 → ③ 수락. 만혈을 먼저 보면 "돈도
 * 없고 만혈"인 사람이 다친 뒤 다시 왔을 때 문구가 바뀐다 — 같은 빈 주머니에
 * 화면이 두 말을 하게 된다.
 *
 * 만혈은 저장칸(combat.hp)이 아니라 **shared 의 currentHp** 로 잰다(전투 §6) —
 * 자연 회복은 저장되지 않으므로 저장칸을 직접 읽는 판정은 회복이 그 판정에만
 * 없는 셈이 되고, 여기서는 그것이 "이미 다 나은 사람의 돈을 받는 것"이 된다.
 * 화면(만혈 버튼 부재)이 같은 술어를 부르므로 부등호는 한 벌이다.
 */
export function performRest(args: PerformRestArgs): RestResult {
  const { inn, now } = args

  if (args.player.gold < inn.gold) return { ok: false, code: 'not_enough_gold' }
  if (currentHp(args.player.combat, now) === COMBAT_MAX_HP) return { ok: false, code: 'already_full' }

  // 여기서부터 상태가 바뀐다 — 거절이 전부 끝난 뒤다(§2-2: 거절 경로는 아무것도
  // 저장하지 않는다). lastHitAt = now 는 "hp 칸이 지금 실측이 됐다"는 표시다
  // (전투 §6) — 과거로 두면 currentHp 가 그 위에 회복을 또 얹는다.
  const player = structuredClone(args.player)
  player.gold -= inn.gold
  player.combat.hp = COMBAT_MAX_HP
  player.combat.lastHitAt = now
  return { ok: true, outcome: { player } }
}
