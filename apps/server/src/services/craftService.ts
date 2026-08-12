import {
  actionIntervalMs,
  calcCraftSuccess,
  canCraft,
  EFFICIENCY_MULTIPLIER,
  effectiveIntervalFactor,
  equippedToolInfo,
  hammerChanceBonus,
  newlyAchieved,
  rollInt,
  type EquippedToolInfo,
  type GameData,
  type ItemDef,
  type MilestoneDef,
  type PlayerState,
  type RecipeInput,
  type SkillId,
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
 * 효과로 견준다 — 축은 기술마다 다르다. 망치는 성공률(등급·강화가 더하기로
 * 쌓인다), 채집 도구는 간격(곱하기로 쌓이고 작을수록 빠르다).
 *
 * 동률이면 바꾸지 않는다. 나아지는 것이 없는데 강화 수치만 0 으로 잃는다.
 *
 * 두 식 모두 shared 의 것을 그대로 부른다 — 여기 사본을 두면 "낫다"의 정의가
 * 판정(calcCraftSuccess)·화면(BagPanel)과 갈라져, 화면이 더 좋다고 적은 도구를
 * 서비스가 착용하지 않는 날이 온다(§6-앞 2).
 */
function isBetterTool(skill: SkillId, next: ItemDef, current: EquippedToolInfo | null): boolean {
  if (!current) return true
  if (skill === 'crafting') {
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
  // 등급은 정의에, 강화 수치는 인스턴스에 있다 — 성공률은 둘 다 먹으므로 한 쌍으로 읽는다.
  const hammer = equippedToolInfo(player, recipe.skill, data.items)
  const ctx = {
    proficiency,
    toolTier: hammer?.def.toolTier ?? 0,
    enhanceLevel: hammer?.instance.enhanceLevel ?? 0,
    recipe,
  }

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

  player.nextActionAt = args.now + actionIntervalMs(proficiency)

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
  const achieved = newlyAchieved(data.milestones, player, player.celebrated)
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
