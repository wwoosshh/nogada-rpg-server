import { gameTimeAt, isLowTide, TIDE_WINDOWS, type TideWindow } from './time.js'
import type { PlayerState, SkillId, TransitionDef } from './types.js'

/** 숙련 조건 — 그 문이 요구하는 숫자와 지금 손에 있는 숫자. */
export interface TransitionSkillGate {
  /** 재는 계열. 화면이 "광물 숙련" 이라고 적는 그 이름이다. */
  skill: SkillId
  /** 그 문이 요구하는 숫자. */
  need: number
  /** 지금 그 계열의 숙련도. */
  have: number
  /** `have >= need`. **이 부등호는 이 저장소에 여기 한 줄뿐이다.** */
  open: boolean
}

/** 물때 조건 — 물이 빠지는 시각과 지금 시각(설계 §6). */
export interface TransitionTideGate {
  /** 물이 빠져 있는 창들. 안내판·화면이 적는 그 숫자다(TIDE_WINDOWS). */
  windows: readonly TideWindow[]
  /** 판정이 본 게임 시각(0~23). 화면이 "지금 11시" 를 적는 값이다. */
  hour: number
  /** 지금 물이 빠져 있는가. */
  open: boolean
}

/** 문 하나가 요구하는 것과 지금 손에 있는 것. 게이트 없는 문에는 이것이 없다. */
export interface TransitionGate {
  /** 숙련을 안 재는 문이면 null. */
  skill: TransitionSkillGate | null
  /** 물때를 안 지는 문이면 null — 지금은 허브 결계 하나만 이것을 갖는다. */
  tide: TransitionTideGate | null
  /**
   * 걸린 조건이 **전부** 만족되는가. 서버가 통과를 판정하는 값이다.
   *
   * 조건별 `open` 과 따로 두는 이유는 화면이 **막힌 이유를 구별해서** 말해야
   * 하기 때문이다 — "숙련 85,000 (지금 63,240)" 과 "물이 빠질 때만 열린다" 는
   * 플레이어가 할 일이 전혀 다르다(하나는 캐면 되고 하나는 기다리면 된다).
   */
  open: boolean
}

/**
 * 이 문이 지금 이 사람에게 열리는가 — **결계 판정의 정의**(설계 §9-앞 13).
 *
 * **이 술어를 부르는 곳이 둘이다.** 서버의 이동 판정(moveService)과 밀려남을
 * 그리는 화면(gameStore)이다. `isStockUnlocked` 를 shared 하나로 합친 것과
 * 같은 자리, 같은 이유다: 부등호를 양쪽이 각자 옮겨 적으면 화면이 열린 문으로
 * 그려 놓고 서버만 `locked` 로 거절하는 날이 오고, 플레이어에게 그것은 이유가
 * 어디에도 안 적힌 거절이 된다.
 *
 * **`open` 하나만 돌려주지 않는 이유**도 같은 규범의 뒷면이다. 화면은 "결계가
 * 밀어낸다 — 광물 숙련 85,000 (지금 63,240)" 을 적어야 하는데, 여기서 참·거짓만
 * 주면 화면이 `t.gateValue` 와 `player.skills[...]` 를 다시 꺼내 두 번째 판정을
 * 짓게 된다. 판정과 표시가 같은 함수에서 나와야 둘이 갈라질 자리가 없다
 * (`stockProgress` 가 `isStockUnlocked` 와 한 파일에 사는 것과 같다).
 *
 * **게이트가 없으면 `null` 이다.** "요구치 0 의 열린 문"으로 뭉개지 않는 이유는
 * 출하된 전환 열여덟 줄이 전부 그쪽이기 때문이다 — 뭉개면 화면이 마을 입구에서도
 * 결계 문구를 조립할 수 있게 되고, 부르는 쪽마다 "0 이면 안 적는다" 는 분기를
 * 다시 쓰게 된다.
 *
 * **시각을 받는다.** 허브 결계가 숙련과 함께 물때를 지기 때문이다(설계 §6 —
 * `항구약초지기` 는 처음부터 조건 둘을 말했다: "물이 크게 빠질 때, 저 끝
 * 바위에"). 물때를 안 지는 문에는 이 인자가 아무 일도 하지 않지만, 여기서
 * 시계를 직접 읽지는 않는다 — 그러면 같은 요청 안에서 서버가 판정한 시각과
 * 화면이 적은 시각이 갈라진다(facts.ts 의 nowMs 와 같은 자세다).
 *
 * **나오는 문은 이 함수까지 오지 않는다.** 물때든 숙련이든 게이트는 들어가는
 * 문에만 걸리고(§9-앞 16·17), 빌드의 갇힘 방지 검사가 그것을 강제한다 —
 * 대사의 "욕심내다 갇힌 사람이 여럿이야" 는 남의 이야기로 남는다.
 */
export function transitionGate(
  t: TransitionDef,
  player: PlayerState,
  nowMs: number,
): TransitionGate | null {
  // 둘은 함께 있거나 함께 없다(parseTransitions 가 강제한다). 그래도 여기서
  // 둘 다 보는 이유: 이 술어는 CSV 를 거치지 않은 TransitionDef(테스트·미래의
  // 다른 출처)도 받으므로, 한쪽만 있는 값에 대해 총체적으로 답해야 한다.
  const hasSkill = t.gateSkill !== undefined && t.gateValue !== undefined
  if (!hasSkill && t.gateTide !== true) return null

  let skill: TransitionSkillGate | null = null
  if (t.gateSkill !== undefined && t.gateValue !== undefined) {
    const have = player.skills[t.gateSkill]
    skill = { skill: t.gateSkill, need: t.gateValue, have, open: have >= t.gateValue }
  }

  let tide: TransitionTideGate | null = null
  if (t.gateTide === true) {
    const { hour } = gameTimeAt(nowMs)
    tide = { windows: TIDE_WINDOWS, hour, open: isLowTide(hour) }
  }

  return { skill, tide, open: (skill?.open ?? true) && (tide?.open ?? true) }
}
