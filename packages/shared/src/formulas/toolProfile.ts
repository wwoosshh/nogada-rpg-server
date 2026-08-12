import type { ItemDef } from '../types.js'
import type { GatherHand } from './gatherHand.js'
import { ACTION_INTERVAL_MIN_MS, actionIntervalMs } from './proficiency.js'

/**
 * 도구 하나가 채집에 미치는 효과 3축(설계 §3) — 이 세 숫자는 여기서만 산다.
 * 서버 판정(gatherOutcome·간격 스탬프)과 클라 표시가 같은 프로필을 읽는다.
 */
export interface GatherToolProfile {
  /** 밴드 밖 roll 에 곱하는 배수. 1 보다 크면(맨손) 표 끝을 넘긴 몫이 실패가 된다. */
  rollFactor: number
  /** 채집 간격에 곱하는 배수. 제작 간격은 불변이다(§3). */
  intervalFactor: number
  /** 잭팟 밴드(rawRoll ≤ 10) 안에서 roll 에서 빼는 평감산 — 밴드 밖 곱과 배타다. */
  jackpotFlat: number
}

const BARE_HAND: GatherToolProfile = { rollFactor: 1.45, intervalFactor: 1.5, jackpotFlat: 0 }

/**
 * 도구 정의 → 효과 프로필. **null = 맨손**이고, 맨손은 게이트가 아니라 페널티다
 * (§2 — roll ×1.45 는 저브라켓에서도 성공을 체감되게 깎는다, §6-앞 3).
 *
 * 이 함수는 받은 정의만 본다 — **엉뚱한 기술의 도구는 호출자의 몫이다**(§6-앞 9
 * 규범): 판정자는 `equippedToolInfo(player, skill, items)` 로 조회하고, 그 조회가
 * 기술 불일치를 null 로 만들어 오므로 여기 도착하는 def 는 이미 "그 기술의
 * 도구이거나 맨손"이다. 도구가 아니거나 티어가 없는 정의도 맨손이다 — 티어 0 을
 * 조용히 ×1.0 으로 접는 기본값은 금지다(구 toolGatherFactor 의 사고 유형).
 */
export function gatherToolProfile(def: ItemDef | null): GatherToolProfile {
  if (!def || def.kind !== 'tool') return BARE_HAND
  const tier = def.toolTier ?? 0
  if (tier >= 3) return { rollFactor: 0.8, intervalFactor: 0.6, jackpotFlat: 3 }
  if (tier === 2) return { rollFactor: 0.9, intervalFactor: 0.8, jackpotFlat: 2 }
  if (tier === 1) return { rollFactor: 1.0, intervalFactor: 1.0, jackpotFlat: 0 }
  return BARE_HAND
}

/** 강화 상한. 재료가 있어도 +5 에서 멈춘다(§5) — 티어 불변식(아래)이 이 값에 걸려 있다. */
export const ENHANCE_CAP = 5

/**
 * 채집 도구 강화 +1당 간격에 곱으로 붙는 배수(§5 — +5 = ×0.86).
 *
 * 불변식(§6-앞 1): 인접 하위 티어 × 0.97^ENHANCE_CAP 보다 상위 티어 기본
 * intervalFactor 가 항상 작다 — 만강 구리(0.8587)보다 신품 철(0.8)이 빠르다.
 * 강화가 승급의 드라마를 먹어치우면 안 되기 때문이고, toolProfile.test.ts 가
 * 이 부등식을 그대로 강제한다.
 */
export const ENHANCE_INTERVAL_FACTOR = 0.97

/**
 * 망치 강화 +1당 제작 성공률 보너스(+0.3%p, §5) — 망치의 강화 축은 간격이 아니라 조합이다.
 *
 * 불변식(§6-앞 18): 만강 보너스(×ENHANCE_CAP = +1.5%p)가 티어 한 칸
 * (CRAFT_TOOL_TIER_CHANCE_BONUS = +2.0%p)보다 항상 작다 — 채집 축의 §6-앞 1 과
 * 같은 규범이 성공률 축에 걸린 것이다. +0.5%p 이던 값은 만강 구리(+4.5%p)가
 * 신품 철(+4.0%p)을 이겨 승급의 드라마를 먹어치웠기에 여기로 내렸다.
 * toolProfile.test.ts 가 두 축의 부등식을 나란히 강제한다.
 */
export const HAMMER_ENHANCE_CHANCE_BONUS = 0.003

/**
 * 유효 간격배수 — 티어(intervalFactor)와 강화(×0.97^n)를 곱한 한 숫자(§6-앞 2).
 *
 * **도구 전용이다. 증표를 여기 섞지 않는다**(§6-앞 16). 이 함수를 읽는 두
 * 자리는 둘 다 "그 도구 하나의 값"을 묻는다: 제작 후 자동 착용 비교
 * (craftService — 원시 tier 비교는 강화 투자를 신품이 덮어쓴다)와 가방 칩의
 * 배수 표기("간격 −20%"). 증표는 어느 도구를 들었든 똑같이 붙는 별개의 축이라,
 * 여기 섞으면 비교에는 상수 하나가 양변에 더 붙을 뿐이고 칩은 그 도구의 숫자를
 * 말하기를 그만둔다 — 화면이 거짓말하기 시작한다.
 *
 * 손 전체의 간격배수(증표 포함)는 `GatherHand.intervalFactor` 이고, 그것을
 * 만드는 자리는 `gatherHandOf` 하나다. 증표가 없으면 두 값은 정확히 같다.
 */
export function effectiveIntervalFactor(def: ItemDef | null, enhanceLevel: number): number {
  return gatherToolProfile(def).intervalFactor * ENHANCE_INTERVAL_FACTOR ** enhanceLevel
}

/**
 * 채집 한 번의 행동 간격 — 서버의 nextActionAt 스탬프와 클라의 숙련도 탭 표시가
 * 이 함수 하나를 부른다(§6-앞 10).
 *
 * 손(`GatherHand`)을 통째로 받는 이유는 간격의 소유자가 셋이기 때문이다: 도구
 * 티어·강화 수치·속도증표. 셋의 곱은 `gatherHandOf` 에서 한 번만 일어나고
 * (`hand.intervalFactor`), 여기서는 그것을 숙련 간격에 곱하기만 한다 — 이 함수가
 * 스스로 조회하면 조회 경로가 두 벌이 되어 서버 스탬프와 화면이 갈라질 수 있다.
 *
 * 하한(ACTION_INTERVAL_MIN_MS)은 **배수를 전부 곱한 뒤에** 클램프한다(§6-앞 6) —
 * 그래야 "초당 20회" 문서가 계속 참이고, 종반의 도구 포화는 수용한다.
 *
 * 반올림은 여기서 한다 — `actionIntervalMs` 가 이미 정수를 약속하는데 배수를
 * 곱하면 그 약속이 깨지고(구리 +5 = 429.3670128499999), 숙련도 탭이 그 꼬리를
 * 그대로 찍는다. 밖에서 각자 반올림하면 화면과 서버 스탬프가 1ms 씩 어긋날 수
 * 있으므로, 간격을 만드는 이 한 자리가 정수 계약을 함께 지킨다(§6-앞 10).
 */
export function gatherIntervalMs(proficiency: number, hand: GatherHand): number {
  return Math.max(ACTION_INTERVAL_MIN_MS, Math.round(actionIntervalMs(proficiency) * hand.intervalFactor))
}
