import {
  actionIntervalMs,
  calcCraftSuccess,
  canCraft,
  EFFICIENCY_MULTIPLIER,
  equippedToolTier,
  newlyAchieved,
  rollInt,
  type GameData,
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
  const toolTier = equippedToolTier(player, data, recipe.skill)
  // enhanceLevel 0: T3 이 실값(착용 망치 인스턴스의 강화 수치)을 잇는다.
  const ctx = { proficiency, toolTier, enhanceLevel: 0, recipe }

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
      const tier = outputDef.toolTier ?? 0
      if (skill && tier > equippedToolTier(player, data, skill)) {
        // 더 좋은 도구를 만들면 바로 착용시킨다. M1 에서 장비창 UI 를 생략하기 위한 결정이다.
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
