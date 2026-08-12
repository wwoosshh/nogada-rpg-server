import { equippedToolInfo, type EquippedToolInfo } from '../equipment.js'
import type { ItemDef, PlayerState, SkillId, TokenEffect } from '../types.js'
import { effectiveIntervalFactor, gatherToolProfile, type GatherToolProfile } from './toolProfile.js'

/**
 * 속도증표가 채집 간격에 곱하는 배수(설계 §5). 분당 골드가 정확히 1/0.9 = +11.1%
 * 오른다 — 표와 무관한 산술이고, 그 숫자가 §6-앞 7 의 가격(속도 600,000 기준)을
 * 유도했다. packages/data 의 시뮬 테스트가 실제 표로 이 값을 못박는다.
 */
export const TOKEN_SPEED_FACTOR = 0.9

/**
 * 선별증표가 roll 에 곱하는 배수(설계 §5). 실제 네 표에서 분당 골드 +5%대다
 * (선별 해금 숙련 25,000·1티어 도구 기준 5.29~5.39%) — 속도의 절반 남짓이고,
 * 그래서 §6-앞 7 이 스펙의 뒤집힌 가격표(속도가 선별의 절반)를 2:1 로 고쳤다.
 */
export const TOKEN_SIGHT_FACTOR = 0.95

/**
 * "이 기술로 캐는 지금 이 손" — 도구와 증표를 합친 한 덩이다.
 *
 * 왜 합쳐서 넘기는가: 판정에 들어가는 축이 둘(간격·roll)인데 소유자가 셋(도구
 * 티어, 강화, 증표)이다. 판정 함수마다 셋을 각자 조회하면 서버 스탬프와 클라
 * 표시가 언젠가 다른 조합을 본다 — 손을 한 번 만들어 그대로 넘기면 그 여지가
 * 아예 없다(§6-앞 10).
 */
export interface GatherHand {
  /** 그 기술에 착용한 도구. null = 맨손이다(§6-앞 9). 증표는 착용하지 않으므로 여기 없다. */
  tool: EquippedToolInfo | null
  /**
   * 판정이 읽는 효과 프로필 — `rollFactor` 에는 **선별증표가 이미 곱해져 있다**.
   *
   * `profile.intervalFactor` 는 도구 티어의 날 숫자(강화도 증표도 안 붙은 값)라
   * **간격 계산에 쓰면 안 된다** — 간격은 아래 `intervalFactor` 다. 티어 사이의
   * 부등식(§6-앞 1)을 증명하는 자리만 그 날 숫자를 본다.
   */
  profile: GatherToolProfile
  /**
   * 간격에 곱할 최종 배수 — 티어 × 0.97^강화 × (속도증표면 0.9).
   *
   * 증표가 없으면 이 값은 `effectiveIntervalFactor(도구, 강화)` 와 정확히 같다.
   * 그 등식이 가방 칩("간격 −20%")을 참으로 유지한다(§6-앞 16).
   */
  intervalFactor: number
}

/** 그 기술의 그 효과 증표를 **가지고 있는가**. 개수는 보지 않는다 — 1개나 99개나 같다(설계 §5). */
function holdsToken(
  player: PlayerState,
  skill: SkillId,
  items: Record<string, ItemDef>,
  effect: TokenEffect,
): boolean {
  // 카탈로그를 돌고 스택을 조회한다(그 반대가 아니다) — 스택의 키는 세이브에서
  // 온 문자열이라, 스택을 돌면 "constructor" 같은 상속 키로 items 를 읽는 경로가
  // 생긴다. 아이템은 수십 개뿐이라 도는 비용도 문제가 아니다.
  return Object.values(items).some(
    (def) => def.tokenEffect === effect && def.skill === skill && (player.stacks[def.id] ?? 0) > 0,
  )
}

/**
 * 지금 이 사람이 그 기술로 캘 때의 손.
 *
 * **증표 효과가 판정에 들어가는 유일한 문이다**(설계 §5) — 도구는
 * `equippedToolInfo` 가, 증표는 `holdsToken` 이 조회하고, 두 축의 곱은 여기서만
 * 일어난다. 서버 판정(gatherOutcome·간격 스탬프)과 클라 표시(숙련도 탭)가 같은
 * 손을 만들어 같은 답을 본다.
 *
 * `effectiveIntervalFactor` 에 증표를 섞지 않는 이유가 여기 있다(§6-앞 16):
 * 그 함수는 **도구 전용**이고, 제작 후 자동 착용 비교와 가방 칩 표기가 그것을
 * 읽는다. 증표를 섞으면 두 도구를 비교하는 식에 도구가 아닌 값이 들어가고,
 * 칩의 "간격 −20%" 는 그 도구의 숫자이기를 그만둔다.
 */
export function gatherHandOf(player: PlayerState, skill: SkillId, items: Record<string, ItemDef>): GatherHand {
  const tool = equippedToolInfo(player, skill, items)
  const profile = gatherToolProfile(tool?.def ?? null)

  const sight = holdsToken(player, skill, items, 'sight')
  const speed = holdsToken(player, skill, items, 'speed')

  return {
    tool,
    profile: sight ? { ...profile, rollFactor: profile.rollFactor * TOKEN_SIGHT_FACTOR } : profile,
    intervalFactor:
      effectiveIntervalFactor(tool?.def ?? null, tool?.instance.enhanceLevel ?? 0) *
      (speed ? TOKEN_SPEED_FACTOR : 1),
  }
}
