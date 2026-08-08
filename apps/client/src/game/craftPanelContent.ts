import {
  calcCraftSuccess,
  canCraft,
  equippedToolTier,
  isAchieved,
  SKILL_LABELS,
  type CraftContext,
  type GameData,
  type PlayerState,
  type RecipeDef,
} from '@nogada/shared'
import { DANGER_COLOR, DIM_COLOR, LABEL_COLOR, SUCCESS_COLOR } from './detailMenuTabs.js'
import type { ScrollListLine } from './ScrollList.js'

/**
 * 제작 패널(제작 토글이 여는 화면)의 줄 내용을 만든다.
 *
 * detailMenuTabs.ts 와 같은 이유로 Phaser 밖에 둔다 — 이 파일도 문자열과
 * 색·크기를 묶은 순수 데이터(ScrollListLine)만 만들고, Text 오브젝트로
 * 그리는 일은 PanelScene 과 ScrollList 의 몫이다. detailMenuTabs.ts 자체에
 * 넣지 않는 이유는 그 파일이 B 메뉴의 TABS 배열(숙련도·이정표·설정) 전용이고
 * 제작은 그 배열의 tab 이 아니라 별도 PanelId(PanelScene.ts) 이기 때문이다.
 *
 * 클라이언트는 규칙을 판정하지 않는다 — canCraft·calcCraftSuccess 는 전부
 * packages/shared 에서 그대로 가져온다. 여기서 계산하는 것은 "재료가 몇 개
 * 있고 몇 개 필요한가" 뿐이고, 이것은 규칙이 아니라 player.stacks 와
 * recipe.inputs 를 그대로 비교하는 것이다 — craftService.ts 의 재료 검사
 * for 문과 정확히 같은 비교를, 서버가 아니라 화면에 보여주기 위해 한 번 더
 * 하는 것뿐이다. 서버가 최종 판정이고, 이 파일의 결과는 표시·전송 편의다.
 */

const ROW_NAME_FONT_SIZE = 12
const ROW_DETAIL_FONT_SIZE = 10

const fmt = (n: number): string => n.toLocaleString('ko-KR')

interface MaterialStatus {
  name: string
  have: number
  need: number
  enough: boolean
}

/** 레시피 재료 각각을 지금 보유량과 대조한다. */
function materialStatus(data: GameData, player: PlayerState, recipe: RecipeDef): MaterialStatus[] {
  return recipe.inputs.map((input) => {
    const have = player.stacks[input.item] ?? 0
    return {
      name: data.items[input.item]?.name ?? input.item,
      have,
      need: input.count,
      enough: have >= input.count,
    }
  })
}

function toCraftContext(data: GameData, player: PlayerState, recipe: RecipeDef): CraftContext {
  return {
    proficiency: player.skills[recipe.skill],
    toolTier: equippedToolTier(player, data, recipe.skill),
    recipe,
  }
}

/**
 * 지금 이 레시피를 서버로 보낼 값어치가 있는가 — 숙련도 게이트와 재료를 둘 다
 * 통과했는가. WorldScene.sendGather 가 nextActionAt 을 미리 확인해 거부될
 * 요청을 안 보내는 것과 같은 자세다: 서버가 최종 판정이지만, 이미 화면에
 * 보이는 이유로 거부될 게 뻔한 요청까지 굳이 왕복시키지 않는다(특히 반복
 * 제작 중에는 이 확인이 없으면 매 프레임 거부 응답만 반복해서 받는다).
 */
export function canAffordCraft(data: GameData, player: PlayerState, recipeId: string): boolean {
  const recipe = data.recipes[recipeId]
  if (!recipe) return false
  if (!canCraft(toCraftContext(data, player, recipe))) return false
  return materialStatus(data, player, recipe).every((m) => m.enough)
}

/** 조합의 자동 반복 이정표(숙련도 10,000)를 달성했는가 — WorldScene.repeatsOn 이 노드마다 하는 질의를 조합 하나에 대해 한다. */
export function craftRepeatUnlocked(data: GameData, player: PlayerState): boolean {
  const repeatMilestone = data.milestones.find(
    (m) => m.effect.kind === 'repeat' && m.effect.skill === 'crafting',
  )
  return repeatMilestone ? isAchieved(repeatMilestone, player, data.milestones) : false
}

/**
 * 레시피 하나를 2~3줄로 설명한다 — detailMenuTabs.ts 의 이정표 줄과 같은 문법을 쓴다.
 *
 * 1줄(이름+상태): 지금 만들 수 있으면 ✓, 숙련도가 모자라면 그 숫자, 숙련도는
 *   열렸는데 재료가 없으면 "재료 부족"(정확한 부족량은 2줄에 있다) — 한 줄에
 *   서로 다른 두 이유를 욱여넣지 않는다. "???" 를 쓰지 않는다는 원칙(카탈로그와
 *   같다)을 지키면서도, 숙련도와 재료가 "서로 다른 문제"임을 플레이어가 한눈에
 *   구분하게 한다.
 * 2줄(재료): 항상 보여준다 — 숙련도가 아직 안 열렸어도 무엇을 모아 둬야
 *   할지는 미리 알 수 있어야 한다.
 * 3줄(성공률): 숙련도가 열렸을 때만 보여준다. calcCraftSuccess 는 안 열리면
 *   정의상 0 을 돌려주므로(그 문서 참고), 안 열린 레시피에 굳이 "성공률 0%"
 *   를 적어 봐야 정보가 아니라 1줄의 숫자를 그대로 되풀이할 뿐이다.
 */
function buildRecipeLines(data: GameData, player: PlayerState, recipe: RecipeDef): ScrollListLine[] {
  const ctx = toCraftContext(data, player, recipe)
  const skillOpen = canCraft(ctx)
  const materials = materialStatus(data, player, recipe)
  const materialsReady = materials.every((m) => m.enough)
  const ready = skillOpen && materialsReady

  const nameLabel = recipe.output.count > 1 ? `${recipe.name} ×${recipe.output.count}` : recipe.name

  const header = ready
    ? `✓ ${nameLabel}`
    : skillOpen
      ? `${nameLabel}   재료 부족`
      : `${nameLabel}   ${SKILL_LABELS[recipe.skill]} 숙련도 ${fmt(ctx.proficiency)} / ${fmt(recipe.requiredSkill)}`

  const materialText = materials.map((m) => `${m.name} ${fmt(m.have)}/${fmt(m.need)}`).join(' · ')

  const lines: ScrollListLine[] = [
    {
      text: header,
      color: ready ? SUCCESS_COLOR : LABEL_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
      groupId: recipe.id,
    },
    {
      text: `재료 — ${materialText}`,
      color: materialsReady ? DIM_COLOR : DANGER_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
      groupId: recipe.id,
    },
  ]

  if (skillOpen) {
    const chance = Math.round(calcCraftSuccess(ctx) * 100)
    lines.push({
      text: `성공률 ${chance}%`,
      color: LABEL_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
      groupId: recipe.id,
    })
  }

  return lines
}

/**
 * 제작 패널 전체 내용 — 레시피마다 buildRecipeLines() 를 이어 붙인다.
 *
 * 순서는 recipes.csv 선언 순서(Record 삽입 순서와 같다 — parseRecipes 가 행
 * 순서대로 채운다)를 그대로 쓴다. 이정표 탭처럼 진척순으로 다시 정렬하지
 * 않는 이유: 반복 제작을 쥐고 있는 동안 그 레시피가 화면에서 위아래로
 * 움직이면 안 된다. groupId(=recipe.id) 로 눌림을 추적하므로 순서가 바뀌어도
 * 논리적으로는 안전하지만, 손가락 아래에서 목록이 흔들리는 것 자체가 나쁜
 * 경험이라 애초에 안정된 순서를 쓴다.
 */
export function buildCraftLines(data: GameData, player: PlayerState): ScrollListLine[] {
  const lines: ScrollListLine[] = []
  for (const recipe of Object.values(data.recipes)) {
    lines.push(...buildRecipeLines(data, player, recipe))
  }
  return lines
}
