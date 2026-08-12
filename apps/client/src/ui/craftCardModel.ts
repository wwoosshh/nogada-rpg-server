import {
  calcCraftSuccess,
  canCraft,
  equippedToolInfo,
  equippedToolTier,
  isAchieved,
  SKILL_LABELS,
  type CraftContext,
  type GameData,
  type PlayerState,
  type RecipeDef,
} from '@nogada/shared'

/**
 * 제작 패널(CraftPanel.tsx)이 그릴 카드를 만든다 — 옛 Phaser 제작 패널의
 * craftPanelContent.ts 를 잇는 파일이다. 그 파일이 ScrollListLine(문자열+색)을
 * 만들었다면 여기는 구조화된 카드 데이터를 만들고, 그리는 일은 React 가 한다.
 *
 * 클라이언트는 규칙을 판정하지 않는다 — canCraft·calcCraftSuccess 는 전부
 * packages/shared 에서 그대로 가져온다. 여기서 계산하는 것은 "재료가 몇 개
 * 있고 몇 개 필요한가" 뿐이고, 이것은 규칙이 아니라 player.stacks 와
 * recipe.inputs 를 그대로 비교하는 것이다 — craftService.ts 의 재료 검사
 * for 문과 정확히 같은 비교를, 서버가 아니라 화면에 보여주기 위해 한 번 더
 * 하는 것뿐이다. 서버가 최종 판정이고, 이 파일의 결과는 표시·전송 편의다.
 */

/** 레시피 하나의 이번-열림 누적 성적 — 스토어의 craftTally 항목과 같은 모양. */
export interface CraftCardTally {
  success: number
  fail: number
}

export interface CraftCardMaterial {
  /** 재료 아이템 id — 상세 칸의 아이콘 칩이 ItemIcon 으로 그림을 찾는 열쇠. */
  item: string
  name: string
  have: number
  need: number
  ok: boolean
}

/**
 * 카드의 상태. 잠김(숙련도)과 재료 부족은 서로 다른 문제라 한 값에 욱여넣지
 * 않는다 — 옛 패널이 1줄 헤더에서 지키던 구분을 타입이 잇는다.
 */
export type CraftCardState = 'ready' | 'no_materials' | 'locked'

/**
 * 잠긴 카드가 말할 **하나의** 숫자 — 지금 모자란 쪽의 `현재/필요`.
 *
 * 문이 둘이 된 뒤로도(조합 요구치 + 계열 문턱, §6-앞 9) 화면이 말하는 숫자는
 * 하나다: 두 개를 나란히 적으면 어느 쪽을 채워야 하는지가 흐려진다. 어느 쪽을
 * 고르는지는 lockedGateOf 가 정한다.
 */
export interface CraftCardGate {
  /** 그 숫자가 무엇의 숙련도인지 — '조합' 또는 계열 이름('얼음' 등). */
  skillLabel: string
  have: number
  need: number
}

export interface CraftCard {
  recipeId: string
  /** 산출 개수가 1 을 넘으면 이름에 ×N 을 붙인다 — 옛 nameLabel 그대로. */
  name: string
  /** 산출물 아이템 id. 그림 자체가 아니라 ItemIcon 이 아이콘을 찾는 열쇠다. */
  icon: string
  /**
   * 산출물을 지금 몇 개 갖고 있나(player.stacks). 반복 200회 동안 시선이
   * 쉴 곳은 이 올라가는 숫자다 — 가방을 열어야만 보이면 안 된다(설계 §8-앞 4).
   */
  ownedOutput: number
  state: CraftCardState
  /** 성공률(반올림 %). 잠긴 레시피는 calcCraftSuccess 정의상 0. */
  chancePct: number
  /**
   * 잠긴 이유의 숫자. 열린 카드는 null — 말할 문턱이 없다.
   * (state === 'locked' 와 정확히 같은 조건이다: 둘 다 canCraft 하나에서 나온다.)
   */
  lockedGate: CraftCardGate | null
  materials: CraftCardMaterial[]
  tally: CraftCardTally
}

export interface CraftCardSection {
  category: string
  cards: CraftCard[]
}

const ZERO_TALLY: CraftCardTally = { success: 0, fail: 0 }

/** 레시피 재료 각각을 지금 보유량과 대조한다. */
function materialStatus(
  data: GameData,
  player: PlayerState,
  recipe: RecipeDef,
): CraftCardMaterial[] {
  return recipe.inputs.map((input) => {
    const have = player.stacks[input.item] ?? 0
    return {
      item: input.item,
      name: data.items[input.item]?.name ?? input.item,
      have,
      need: input.count,
      ok: have >= input.count,
    }
  })
}

/**
 * 화면이 판정에 넘기는 값 한 벌 — 스토어의 셀렉터(selectCraftChance)도 이것을
 * 부른다. 여기 한 벌뿐이어야 하는 이유: 문턱이 하나 더 생긴 지금, 두 벌로
 * 적으면 한쪽만 계열 숙련을 안 넘겨 같은 레시피를 화면 A 는 열렸다고, 화면 B 는
 * 잠겼다고 말하는 날이 온다.
 */
export function toCraftContext(data: GameData, player: PlayerState, recipe: RecipeDef): CraftContext {
  const ctx: CraftContext = {
    proficiency: player.skills[recipe.skill],
    toolTier: equippedToolTier(player, data, recipe.skill),
    // 착용 망치의 실제 강화 수치 — calcCraftSuccess 안에서 서버와 같은 식으로
    // 보너스가 붙으므로(설계 §6-앞 10), 카드의 성공률이 곧 서버 판정과 같아진다.
    enhanceLevel: equippedToolInfo(player, recipe.skill, data.items)?.instance.enhanceLevel ?? 0,
    recipe,
  }
  // 계열 문턱이 걸린 레시피는 그 계열 채집 숙련도까지 넘긴다 — 서버(craftService)가
  // 넘기는 것과 같은 숫자다(§6-앞 9).
  if (recipe.gateSkill) ctx.gateProficiency = player.skills[recipe.gateSkill]
  return ctx
}

/**
 * 잠긴 카드가 말할 숫자를 고른다 — **모자란 쪽**이다.
 *
 * 둘 다 모자라면 **계열을 먼저** 말한다: 그것이 진짜 문턱이기 때문이다. 조합
 * 숙련은 아무 레시피나 반복하면 오르지만, 계열 숙련은 그 계열을 캐야 오르고
 * 그 숫자가 재료 드랍 브라켓까지 정한다(§6-앞 9). 조합 숫자를 먼저 말하면
 * 그것만 채우고 돌아온 사람이 또 잠긴 문을 만난다.
 *
 * canCraft 가 false 라고 말한 뒤에만 부른다 — 그래서 계열이 찼다면 모자란 것은
 * 조합이라는 소거법이 성립한다(판정을 여기서 다시 하지 않는 이유이기도 하다).
 */
function lockedGateOf(player: PlayerState, recipe: RecipeDef, proficiency: number): CraftCardGate {
  const { gateSkill, gateValue } = recipe
  if (gateSkill !== undefined && gateValue !== undefined && player.skills[gateSkill] < gateValue) {
    return { skillLabel: SKILL_LABELS[gateSkill], have: player.skills[gateSkill], need: gateValue }
  }
  return { skillLabel: SKILL_LABELS[recipe.skill], have: proficiency, need: recipe.requiredSkill }
}

/**
 * 지금 이 레시피를 서버로 보낼 값어치가 있는가 — 숙련도 게이트와 재료를 둘 다
 * 통과했는가. WorldScene.sendGather 가 nextActionAt 을 미리 확인해 거부될
 * 요청을 안 보내는 것과 같은 자세다: 서버가 최종 판정이지만, 이미 화면에
 * 보이는 이유로 거부될 게 뻔한 요청까지 굳이 왕복시키지 않는다(특히 반복
 * 제작 중에는 이 확인이 없으면 매 tick 거부 응답만 반복해서 받는다).
 */
export function canAffordCraft(data: GameData, player: PlayerState, recipeId: string): boolean {
  const recipe = data.recipes[recipeId]
  if (!recipe) return false
  if (!canCraft(toCraftContext(data, player, recipe))) return false
  return materialStatus(data, player, recipe).every((m) => m.ok)
}

/** 조합의 자동 반복 이정표(숙련도 10,000)를 달성했는가 — WorldScene.repeatsOn 이 노드마다 하는 질의를 조합 하나에 대해 한다. */
export function craftRepeatUnlocked(data: GameData, player: PlayerState): boolean {
  const repeatMilestone = data.milestones.find(
    (m) => m.effect.kind === 'repeat' && m.effect.skill === 'crafting',
  )
  return repeatMilestone ? isAchieved(repeatMilestone, player, data.milestones) : false
}

function buildCard(
  data: GameData,
  player: PlayerState,
  recipe: RecipeDef,
  tally: CraftCardTally,
): CraftCard {
  const ctx = toCraftContext(data, player, recipe)
  // 잠김 여부와 "말할 숫자"가 같은 판정(canCraft) 하나에서 나온다 — 따로 물으면
  // 언젠가 잠기지 않은 카드가 문턱을 말하거나 그 반대가 된다.
  const lockedGate = canCraft(ctx) ? null : lockedGateOf(player, recipe, ctx.proficiency)
  const materials = materialStatus(data, player, recipe)
  const materialsReady = materials.every((m) => m.ok)

  return {
    recipeId: recipe.id,
    name: recipe.output.count > 1 ? `${recipe.name} ×${recipe.output.count}` : recipe.name,
    icon: recipe.output.item,
    // 왜: 도구는 인스턴스로 보관된다(craftService.ts — 강화 대상이라 스택이 아니라
    // 개별 행) — stacks 만 읽으면 방금 만든 망치도 "보유 0"이라 말해 여분을
    // 재료 낭비하며 또 만들게 유도한다. 6종 레시피 중 5종이 도구다.
    ownedOutput:
      (player.stacks[recipe.output.item] ?? 0) +
      player.instances.filter((i) => i.itemId === recipe.output.item).length,
    state: lockedGate ? 'locked' : materialsReady ? 'ready' : 'no_materials',
    chancePct: Math.round(calcCraftSuccess(ctx) * 100),
    lockedGate,
    materials,
    tally,
  }
}

/**
 * 제작 패널 전체 내용 — 카테고리 섹션 아래 카드들.
 *
 * 카테고리 순서는 recipes.csv 순회 중 그 카테고리가 처음 나타난 순서, 카드
 * 순서는 선언 순서(Record 삽입 순서 — parseRecipes 가 행 순서대로 채우고,
 * 정수형 id 금지 검사가 JSON 왕복에서도 이 순서를 지킨다)다. 이정표 탭처럼
 * 진척순으로 다시 정렬하지 않는 이유: 반복 제작을 쥐고 있는 동안 그 레시피가
 * 화면에서 위아래로 움직이면 안 된다 — 손가락 아래에서 목록이 흔들리는 것
 * 자체가 나쁜 경험이라 애초에 안정된 순서를 쓴다.
 */
export function buildCraftCards(
  data: GameData,
  player: PlayerState,
  tally: Record<string, CraftCardTally>,
): CraftCardSection[] {
  const sections: CraftCardSection[] = []
  const byCategory = new Map<string, CraftCardSection>()

  for (const recipe of Object.values(data.recipes)) {
    let section = byCategory.get(recipe.category)
    if (!section) {
      section = { category: recipe.category, cards: [] }
      byCategory.set(recipe.category, section)
      sections.push(section)
    }
    section.cards.push(buildCard(data, player, recipe, tally[recipe.id] ?? ZERO_TALLY))
  }

  return sections
}

/**
 * 패널이 열리는 순간의 기본 선택 — 첫 제작 가능(ready) 레시피, 없으면 그냥
 * 첫 레시피(설계 §8-뒤). "지금 만들 수 있는 것"에 커서를 먼저 놓아야 열자마자
 * 제작 버튼이 살아 있다 — 신규 캐릭터도 광석만 있으면 구리 주괴가 잡힌다.
 * 순회는 목록과 같은 선언 순서라 "첫"의 의미가 화면과 어긋나지 않는다.
 */
export function defaultCraftSelection(sections: CraftCardSection[]): string | null {
  const flat = sections.flatMap((s) => s.cards)
  const ready = flat.find((c) => c.state === 'ready')
  return ready?.recipeId ?? flat[0]?.recipeId ?? null
}
