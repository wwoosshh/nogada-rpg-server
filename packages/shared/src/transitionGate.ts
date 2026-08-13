import type { PlayerState, SkillId, TransitionDef } from './types.js'

/** 문 하나가 요구하는 것과 지금 손에 있는 것. 게이트 없는 문에는 이것이 없다. */
export interface TransitionGate {
  /** 재는 계열. 화면이 "광물 숙련" 이라고 적는 그 이름이다. */
  skill: SkillId
  /** 그 문이 요구하는 숫자. */
  need: number
  /** 지금 그 계열의 숙련도. */
  have: number
  /** `have >= need`. **이 부등호는 이 저장소에 여기 한 줄뿐이다.** */
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
 * 시각을 받지 않는다. 허브 결계의 물때(설계 §6)는 이 함수에 조건 한 칸을 더하는
 * 일이고, 그때 시각 인자가 함께 온다 — 아무도 안 읽는 인자를 미리 두면 이 술어가
 * 무엇에 의존하는지에 대해 서명이 거짓말을 한다.
 */
export function transitionGate(t: TransitionDef, player: PlayerState): TransitionGate | null {
  // 둘은 함께 있거나 함께 없다(parseTransitions 가 강제한다). 그래도 여기서
  // 둘 다 보는 이유: 이 술어는 CSV 를 거치지 않은 TransitionDef(테스트·미래의
  // 다른 출처)도 받으므로, 한쪽만 있는 값에 대해 총체적으로 답해야 한다.
  if (t.gateSkill === undefined || t.gateValue === undefined) return null

  const have = player.skills[t.gateSkill]
  return { skill: t.gateSkill, need: t.gateValue, have, open: have >= t.gateValue }
}
