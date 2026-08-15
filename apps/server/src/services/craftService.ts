import {
  armorDefenseOf,
  calcCraftSuccess,
  canCraft,
  craftIntervalMs,
  EFFICIENCY_MULTIPLIER,
  effectiveIntervalFactor,
  equippedToolInfo,
  hammerChanceBonus,
  swingDamageOf,
  newlyAchieved,
  rollInt,
  type CraftContext,
  type EquippedToolInfo,
  type EquipSlot,
  type GameData,
  type ItemDef,
  type MilestoneDef,
  type PlayerState,
  type RecipeInput,
} from '@nogada/shared'

export interface PerformCraftArgs {
  player: PlayerState
  data: GameData
  recipeId: string
  /** 서버가 시드를 독점한다. */
  rng: () => number
  /** 인스턴스 ID 생성기. 테스트에서 결정적으로 주입한다. */
  newId: () => string
  now: number
}

export interface CraftOutcome {
  success: boolean
  chance: number
  produced: RecipeInput | null
  consumed: RecipeInput[]
  skillGained: number
  autoEquipped: boolean
  /** 이번 행동으로 새로 달성된 이정표. 실패·거부 경로에서는 항상 빈 배열이다. */
  achieved: MilestoneDef[]
  player: PlayerState
}

export type CraftErrorCode = 'unknown_recipe' | 'level_too_low' | 'missing_materials' | 'too_fast'

export type CraftResult = { ok: true; outcome: CraftOutcome } | { ok: false; code: CraftErrorCode }

/** 스택에서 차감한다. 0 이 되면 키를 지워 "가진 적 없음" 과 같은 모양으로 만든다. */
function spend(player: PlayerState, item: string, count: number): void {
  const remaining = (player.stacks[item] ?? 0) - count
  if (remaining > 0) player.stacks[item] = remaining
  else delete player.stacks[item]
}

/**
 * 새로 만든 도구가 착용 중인 것보다 **실제로 나은가**(§6-앞 2).
 *
 * 등급 숫자만 견주면(옛 코드) 강화가 보이지 않아, 만강 도구를 더 느린 신품이
 * 덮어쓰고 그 투자가 조용히 사라진다. 그래서 등급이 아니라 그 도구가 내는
 * 효과로 견준다 — 축은 슬롯마다 다르다. 망치는 성공률(등급·강화가 더하기로
 * 쌓인다), 채집 도구는 간격(곱하기로 쌓이고 작을수록 빠르다), 무기는 회당
 * 피해(전투 §4 — 간격은 전투 숙련의 것이라 무기가 사는 축이 아니다), 방어구는
 * 피격 경감(아크 E §2 — 무기 축의 쌍둥이).
 *
 * 동률이면 바꾸지 않는다. 나아지는 것이 없는데 강화 수치만 0 으로 잃는다.
 *
 * 두 식 모두 shared 의 것을 그대로 부른다 — 여기 사본을 두면 "낫다"의 정의가
 * 판정(calcCraftSuccess)·화면(BagPanel)과 갈라져, 화면이 더 좋다고 적은 도구를
 * 서비스가 착용하지 않는 날이 온다(§6-앞 2).
 */
function isBetterTool(slot: EquipSlot, next: ItemDef, current: EquippedToolInfo | null): boolean {
  if (!current) return true
  if (slot === 'combat') {
    // 무기는 **실효 피해**(swingDamageOf — 강화 포함)로 견준다. 정의의 damage
    // 끼리 견주던 첫 판은 D1 이 그 셈을 만든 뒤 약속대로 교체됐다: 그대로 두면
    // +3 검(실효 8)을 기본 6짜리 상위 검이 6>5 로 덮어써 만강 투자가 증발한다
    // (D1 리뷰가 재현한 잠복 — 둘째 무기가 데이터에 오르는 날 실화한다).
    return swingDamageOf(next, 0) > swingDamageOf(current.def, current.instance.enhanceLevel)
  }
  if (slot === 'armor') {
    // 방어구는 **실효 경감**(armorDefenseOf — 강화 포함)으로 견준다(아크 E §2) —
    // 무기의 그 식과 쌍둥이다. 아래 채집 낙하(간격배수)로 떨어뜨리면 동티어
    // 방어구끼리는 언제나 동률이라 defense 6 신품이 5 를 영영 못 갈아 끼고,
    // 정의 defense 끼리 견주면 +2 가죽옷(실효 7)을 신품 6 이 덮어쓴다.
    return armorDefenseOf(next, 0) > armorDefenseOf(current.def, current.instance.enhanceLevel)
  }
  if (slot === 'crafting') {
    return (
      hammerChanceBonus(next.toolTier ?? 0, 0) >
      hammerChanceBonus(current.def.toolTier ?? 0, current.instance.enhanceLevel)
    )
  }
  return (
    effectiveIntervalFactor(next, 0) < effectiveIntervalFactor(current.def, current.instance.enhanceLevel)
  )
}

/**
 * 제작 판정. 성패를 서버가 결정하고 재료 차감까지 마친 상태를 돌려준다.
 *
 * 성공률은 `calcCraftSuccess` 하나에서 나온다 — 클라이언트가 그리는 예상치와
 * 실제 판정이 같은 함수다.
 */
export function performCraft(args: PerformCraftArgs): CraftResult {
  const { data, recipeId, rng, newId } = args
  const recipe = data.recipes[recipeId]
  if (!recipe) return { ok: false, code: 'unknown_recipe' }

  const player = structuredClone(args.player)
  const proficiency = player.skills[recipe.skill]
  // 등급은 정의에, 강화 수치는 인스턴스에 있다 — 성공률은 둘 다 먹고 간격은
  // 강화만 먹으므로(§6-앞 14), 두 축이 같은 한 쌍을 보게 한 번만 조회한다.
  const hammer = equippedToolInfo(player, recipe.skill, data.items)
  const ctx: CraftContext = {
    proficiency,
    toolTier: hammer?.def.toolTier ?? 0,
    enhanceLevel: hammer?.instance.enhanceLevel ?? 0,
    recipe,
  }
  // 문턱이 걸린 레시피는 그 계열 채집 숙련도까지 봐야 판정이 선다(§6-앞 9) —
  // 판정의 주인은 서버이므로, 화면이 무엇을 그리든 이 숫자가 문을 연다.
  if (recipe.gateSkill) ctx.gateProficiency = player.skills[recipe.gateSkill]

  if (!canCraft(ctx)) return { ok: false, code: 'level_too_low' }

  for (const input of recipe.inputs) {
    if ((player.stacks[input.item] ?? 0) < input.count) {
      return { ok: false, code: 'missing_materials' }
    }
  }

  // 채집과 같은 순서다 — 자격·재료 확인이 먼저이고, 간격은 난수보다 앞이다.
  if (args.now < player.nextActionAt) return { ok: false, code: 'too_fast' }

  const chance = calcCraftSuccess(ctx)
  const success = rng() < chance

  // 채집 스탬프와 같은 자세다(§6-앞 10): 간격을 만드는 함수는 shared 에 하나뿐이고
  // 화면(제작 패널·숙련도 탭)이 같은 함수를 불러 같은 숫자를 적는다. 망치의 강화가
  // 여기 들어오는 것이 §6-앞 14 이고, 티어는 성공률 쪽에만 남는다.
  player.nextActionAt = args.now + craftIntervalMs(proficiency, hammer)

  // 성공하면 전량, 실패하면 절반(올림)을 소모한다. 실패해도 대가가 있어야
  // 성공률을 올리는 행위(숙련도·망치)에 의미가 생긴다.
  const consumed: RecipeInput[] = recipe.inputs.map((input) => ({
    item: input.item,
    count: success ? input.count : Math.ceil(input.count / 2),
  }))
  for (const c of consumed) spend(player, c.item, c.count)

  if (!success) {
    return {
      ok: true,
      outcome: {
        success: false,
        chance,
        produced: null,
        consumed,
        skillGained: 0,
        autoEquipped: false,
        achieved: [],
        player,
      },
    }
  }

  const outputDef = data.items[recipe.output.item]
  let autoEquipped = false

  if (outputDef?.kind === 'tool') {
    // 도구는 강화 대상이므로 스택이 아니라 개별 인스턴스로 보관한다.
    for (let i = 0; i < recipe.output.count; i++) {
      const instanceId = newId()
      player.instances.push({ instanceId, itemId: recipe.output.item, enhanceLevel: 0 })

      const skill = outputDef.toolSkill
      if (skill && isBetterTool(skill, outputDef, equippedToolInfo(player, skill, data.items))) {
        // 더 나은 도구를 만들면 바로 착용시킨다. 수동 착용(POST /api/equip)이 생긴
        // 지금도 남는 이유는 첫 도구의 순간이다 — 만들자마자 손에 쥐어야 다음
        // 채집이 바로 빨라지는 것을 몸으로 안다.
        player.equipped[skill] = instanceId
        autoEquipped = true
      }
    }
  } else {
    player.stacks[recipe.output.item] =
      (player.stacks[recipe.output.item] ?? 0) + recipe.output.count
  }

  const skillGained = rollInt(rng, recipe.skillGainMin, recipe.skillGainMax) * EFFICIENCY_MULTIPLIER
  player.skills[recipe.skill] += skillGained

  // 달성 판정은 숙련도가 오른 뒤에 한다. 이번 행동으로 넘긴 것을 이번 응답에 실어야
  // 플레이어가 "그 행동 때문에 열렸다" 를 느낀다.
  const achieved = newlyAchieved(data, player, player.celebrated)
  for (const m of achieved) player.celebrated.push(m.id)

  return {
    ok: true,
    outcome: {
      success: true,
      chance,
      produced: recipe.output,
      consumed,
      skillGained,
      autoEquipped,
      achieved,
      player,
    },
  }
}
