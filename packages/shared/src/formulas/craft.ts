import type { RecipeDef } from '../types.js'
import { clamp } from './clamp.js'
import {
  CHANCE_DECADES,
  CRAFT_TOOL_TIER_CHANCE_BONUS,
  MAX_SUCCESS_CHANCE,
  MIN_SUCCESS_CHANCE,
  proficiencyProgress,
} from './proficiency.js'
import { HAMMER_ENHANCE_CHANCE_BONUS } from './toolProfile.js'

export interface CraftContext {
  /** 조합 숙련도 */
  proficiency: number
  /** 착용한 망치의 등급. 없으면 0 — 맨손으로도 제작은 가능하되 성공률이 낮다. */
  toolTier: number
  /**
   * 착용한 망치의 강화 수치. 없으면 0. 보너스(+0.5%p/레벨)가 이 함수 밖이 아니라
   * calcCraftSuccess 안에 사는 이유: 서버 판정과 클라 예상치(craftCardModel)가
   * 같은 함수라는 규범(§6-앞 10) — 밖에서 더하면 언젠가 둘이 갈라진다.
   */
  enhanceLevel: number
  /**
   * `recipe.gateSkill` 계열의 **채집** 숙련도. 문턱 없는 레시피에서는 안 본다.
   *
   * 선택 칸인데도 없을 때 0 으로 읽는 이유: 문턱 있는 레시피를 판정하면서 이
   * 숫자를 안 넘긴 호출자는 버그인데, 그 버그가 문을 **여는** 쪽으로 기울면
   * 서버가 못 막은 제작이 통과한다. 닫는 쪽으로 기울면 화면이 이상해질 뿐이다.
   */
  gateProficiency?: number
  recipe: RecipeDef
}

/**
 * 제작은 도구 게이트가 없다. 문을 여는 것은 **숫자 둘**이다(설계 §6-앞 9) —
 * 조합 숙련도(`requiredSkill`)와 그 계열의 채집 숙련도(`gateValue`).
 *
 * 두 번째 숫자가 필요한 이유: 조합 숙련만 보면 같은 레시피가 플레이 순서에 따라
 * 0.2분과 11시간이 된다. 조합 25,000 인 사람도 얼음을 오늘 처음 캐면 그 재료는
 * 0.01% 드랍이라, "열렸다"고 말해 놓고 벽을 숨기는 문이 된다.
 *
 * 문턱이 없는 레시피(gateValue 없음)는 지금까지처럼 조합 하나만이 문이다 —
 * 출하된 17행이 전부 그쪽이다.
 */
export function canCraft(ctx: CraftContext): boolean {
  if (ctx.proficiency < ctx.recipe.requiredSkill) return false
  if (ctx.recipe.gateValue === undefined) return true
  return (ctx.gateProficiency ?? 0) >= ctx.recipe.gateValue
}

/**
 * 망치의 유효 성공률 보너스 — 등급과 강화가 한 숫자로 합쳐지는 유일한 자리.
 *
 * 판정(calcCraftSuccess)과 제작 후 자동 착용 비교(craftService)가 이 식 하나를
 * 나눠 읽는다. 두 벌로 적으면 판정과 비교가 서로 다른 망치를 "낫다"고 말할 수
 * 있다 — 채집 도구의 effectiveIntervalFactor 와 정확히 같은 이유다(§6-앞 2).
 *
 * 인자가 `ItemDef` 가 아니라 숫자 둘인 이유: 판정이 보는 `CraftContext` 에는
 * 정의가 없고 `toolTier` 만 있다(그 자리에는 그것으로 충분하다). 정의를 받는
 * 모양으로 바꾸면 판정 쪽에 가짜 def 를 지어내는 어댑터가 생기는데, 그 어댑터가
 * 중복보다 더 거짓말에 가깝다 — 호출자가 `def.toolTier ?? 0` 을 적는 편이 정직하다.
 *
 * 티어와 강화의 크기 관계는 상수가 지킨다(§6-앞 18, HAMMER_ENHANCE_CHANCE_BONUS).
 */
export function hammerChanceBonus(toolTier: number, enhanceLevel: number): number {
  return toolTier * CRAFT_TOOL_TIER_CHANCE_BONUS + enhanceLevel * HAMMER_ENHANCE_CHANCE_BONUS
}

/**
 * 제작 성공률. canCraft 가 false 면 0.
 *
 * 요구 숙련도를 넘어선 만큼으로 계산한다 — 갓 열린 레시피는 기본값이고,
 * 숙련도가 자릿수만큼 더 쌓이면 상한에 닿는다. 망치는 접근 게이트가 아니라
 * 성공률 보조다.
 */
export function calcCraftSuccess(ctx: CraftContext): number {
  if (!canCraft(ctx)) return 0
  const over = ctx.proficiency - ctx.recipe.requiredSkill
  const t = proficiencyProgress(over, CHANCE_DECADES)
  const base = ctx.recipe.baseChance
  const withToolBonus =
    base + (MAX_SUCCESS_CHANCE - base) * t + hammerChanceBonus(ctx.toolTier, ctx.enhanceLevel)
  return clamp(withToolBonus, MIN_SUCCESS_CHANCE, MAX_SUCCESS_CHANCE)
}
