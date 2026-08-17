import {
  achievedIds,
  barrierDoorsOf,
  craftIntervalMs,
  equippedToolInfo,
  gatedRecipesOf,
  gatherHandOf,
  gatherIntervalMs,
  isPureTitle,
  metricValue,
  SKILL_IDS,
  SKILL_LABELS,
  type GameData,
  type MilestoneDef,
  type MilestoneEffect,
  type PlayerState,
  type RecipeDef,
  type SkillId,
} from '@nogada/shared'
import type { ScrollListLine } from './ScrollList.js'
import { FONT_SIZE } from './gameText.js'

/**
 * 상세 메뉴(B 버튼)의 탭 정의와 각 탭이 보여줄 줄 내용을 만드는 함수들.
 *
 * PanelScene(탭 바를 그리고 전환한다)과 gameStore(상단 바 톱니가 openMenu()
 * 로 탭을 지정할 때 그 id 타입이 필요하다) 둘 다 아래 `TABS` 를 참조한다.
 * 어느 한쪽 파일 안에 두면 다른 쪽이 그 파일을 거슬러 import 해야 하는데,
 * PanelScene 은 이미 useGameStore 를 쓰고 있어(store -> PanelScene 방향으로
 * 두면) 곧바로 순환 import 가 된다. depth.ts 가 WorldScene 과 NodeMarker
 * 사이에서 하는 것과 같은 이유로, 어느 쪽에도 속하지 않는 이 작은 모듈에 둔다.
 *
 * 이 파일은 Phaser 를 import 하지 않는다 — 탭 내용은 문자열과 색·크기를
 * 묶은 순수 데이터(`ScrollListLine`)를 만들 뿐이고, 그것을 Text 오브젝트로
 * 그리는 일은 PanelScene 과 ScrollList 의 몫이다.
 */

/*
 * DIM_COLOR 만 export 한다 — PanelScene 의 나머지 부분(탭 글자 기본색)이
 * 그대로 쓴다. ControlScene 과 PanelScene 이 팔레트 리터럴을 서로 다시 옮겨
 * 적는 것(PanelScene.ts 상단 주석)과는 다른 얘기다 — 그건 별개 파일들의
 * 의도된 중복이고, 이 둘은 원래 한 파일(PanelScene.ts)이었던 코드를 구조만
 * 나눈 것이라 그대로 공유한다.
 *
 * 나머지 셋은 이 파일 안에서만 쓴다. 예전에는 제작 패널 내용
 * (craftPanelContent.ts)도 가져다 썼지만, 제작 패널이 DOM(CraftPanel.tsx)으로
 * 옮겨 가며 그쪽 색은 tokens.css 변수가 됐다.
 */
const LABEL_COLOR = '#e8dcc0'
export const DIM_COLOR = '#c9b895'
const SUCCESS_COLOR = '#7fa650'
/** tokens.css 의 --c-danger 와 같은 값이다. 재료 부족처럼 "지금 안 된다"를 숫자와 함께 알리는 줄에 쓴다. */
const DANGER_COLOR = '#b4543a'

const ROW_NAME_FONT_SIZE = FONT_SIZE.body
const ROW_DETAIL_FONT_SIZE = FONT_SIZE.body

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/** 그 총점에서 열리는 되사기 진열이 몇 상점 · 몇 종인가. `GameData.shops` 가 유일한 출처다. */
function countBuyback(data: GameData, score: number): { shops: number; items: number } {
  let shops = 0
  let items = 0
  for (const shop of Object.values(data.shops)) {
    const opened = shop.stock.filter((e) => e.unlockBy === 'collection' && e.unlockAt === score)
    if (opened.length === 0) continue
    shops += 1
    items += opened.length
  }
  return { shops, items }
}

/** ids 가 가리키는 대상의 실제 이름을 모아 사람이 읽는 목록으로 만든다. 데이터에 없으면 id 를 그대로 보여준다(조용히 지우지 않는다). */
function namesOf(ids: readonly string[], table: Record<string, { name: string }>): string {
  return ids.map((id) => table[id]?.name ?? id).join(' · ')
}

/** 레시피 문 한 줄 — `recipes` 효과와 `gateSkill` 짝이 같은 글자를 쓴다. */
function recipeSentence(recipes: readonly RecipeDef[], achieved: boolean): string {
  const names = recipes.map((r) => r.name).join(' · ')
  return achieved ? `만들 수 있다 — ${names}` : `달성하면 만들 수 있다 — ${names}`
}

/**
 * 이정표 하나의 효과를 한 줄로 설명한다.
 *
 * achieved 로 시제를 가른다 — 달성한 것은 "지금 이렇다", 못한 것은 "달성하면
 * 이렇게 된다". `title` 은 achieved 여부와 무관하게 효과가 없다는 사실 자체를
 * 그대로 말한다 — 보상을 암시하고 안 주는 줄은 아예 없는 줄보다 나쁘다.
 *
 * **`effect` 만으로는 부족하다.** 레시피의 채집 문턱(`gateSkill`·`gateValue`)은
 * 이정표 쪽에 선언이 없어서, 여태 이 함수는 얼음 1,000 앞에서 「칭호 — 효과는
 * 없다」를 적었다 — 그 숫자가 실제로는 비 가루·눈 가루의 문인데도. `gatedRecipesOf`
 * 가 그 짝을 읽고(그 함수 문서에 CSV 를 못 고치는 이유가 적혀 있다), 여기서는
 * 두 가지로 나뉜다:
 *   - `title` 인데 여는 레시피가 있으면 **칭호 문장을 아예 버린다.** 「칭호 — 효과는
 *     없다 · 달성하면 만들 수 있다 …」는 자기 앞뒤가 서로를 부정하는 줄이다.
 *   - 그 밖의 효과(`repeat` 셋이 그렇다)는 **덧붙인다.** 얼음 10,000 은 자동 반복과
 *     굵은 비·함박눈 가루를 동시에 열고, 둘 다 참이다.
 */
function effectDescription(def: MilestoneDef, data: GameData, achieved: boolean): string {
  const gated = gatedRecipesOf(def, data.recipes)
  const effect: MilestoneEffect = def.effect
  if (effect.kind === 'title' && gated.length > 0) return recipeSentence(gated, achieved)
  const base = baseEffectDescription(def, effect, data, achieved)
  return gated.length > 0 ? `${base} · ${recipeSentence(gated, achieved)}` : base
}

/** `effect` 칸이 스스로 말하는 것만 — 레시피 짝을 얹는 일은 위 함수가 한다. */
function baseEffectDescription(
  def: MilestoneDef,
  effect: MilestoneEffect,
  data: GameData,
  achieved: boolean,
): string {
  switch (effect.kind) {
    case 'repeat':
      return achieved ? '누르고 있으면 계속된다' : '달성하면 누르고 있는 것만으로 계속된다'
    case 'recipes': {
      const names = namesOf(effect.ids, data.recipes)
      return achieved ? `만들 수 있다 — ${names}` : `달성하면 만들 수 있다 — ${names}`
    }
    case 'stock': {
      // 무엇이 열리는지는 **진열에서 센다** — 이정표 쪽에는 그 목록이 없고(효과에
      // 인자가 없다), 여기서 손으로 적으면 shop_stock.csv 가 늘어난 날 이 줄만
      // 조용히 옛 숫자를 말한다. 이름을 다 늘어놓지 않는 이유는 한 문턱에 열 줄
      // 넘게 열려서다 — 한 줄에 안 들어가는 목록은 읽히지 않는다.
      const opened = countBuyback(data, def.threshold)
      const what = `상점 ${opened.shops}곳이 채집물 ${opened.items}종을 정가에 되판다`
      return achieved ? what : `달성하면 ${what}`
    }
    case 'barrier': {
      // `stock` 과 같은 자리다 — 무엇이 열리는지는 **문이 안다**(효과에 인자가
      // 없고, 짝짓는 규칙은 shared 의 barrierDoorsOf 하나다). 여기서 맵 이름을
      // 손으로 적으면 transitions.csv 가 바뀐 날 이 줄만 옛말을 한다.
      //
      // 상점처럼 개수만 세지 않고 **어디인지를 적는** 이유: 한 문턱이 여는 문은
      // 채집장 하나뿐이라 이름이 한 줄에 들어가고, "결계 1곳" 은 플레이어를 그
      // 벽 앞으로 데려다 주지 못한다. 되사기 쪽이 세기만 하는 것은 한 문턱에 열
      // 줄 넘게 열리기 때문이지 개수가 더 낫기 때문이 아니다.
      const walls = barrierDoorsOf(def, data.transitions)
      // 문이 하나도 없는 선언은 빌드가 막는다(validate.ts 의 결계 게이트 양방향
      // 검사). 그래도 총체적으로 답해야 하므로, 지어낸 장소를 적는 대신 없다고
      // 말한다 — 보상을 암시하고 안 주는 줄은 아예 없는 줄보다 나쁘다.
      if (walls.length === 0) return '여는 결계가 없다'
      const where = walls.map((d) => data.maps[d.fromMap]?.name ?? d.fromMap).join(' · ')
      // 물때는 숙련 위에 얹힌 두 번째 조건이다(허브 결계 하나뿐). 빼면 목록이
      // 85,000 을 채운 사람에게 "열렸다" 고 말해 놓고 문은 여전히 밀어낸다.
      const tide = walls.some((d) => d.gateTide === true) ? ' — 물이 빠졌을 때만' : ''
      const what = `${where}의 결계가 더는 밀어내지 않는다${tide}`
      return achieved ? what : `달성하면 ${what}`
    }
    case 'title':
      return achieved ? '칭호. 그 외 효과는 없다' : '칭호 — 효과는 없다'
    default: {
      // MilestoneEffect 에 새 kind 가 늘었는데 위에서 못 따라가면 여기서 컴파일이
      // 깨진다 — InputHub.setButton 과 같은 자세다.
      const exhaustive: never = effect
      throw new Error(`처리하지 않은 이정표 효과: ${String(exhaustive)}`)
    }
  }
}

/**
 * 이정표 묶음의 열쇠 — 계열 다섯 + 수집의 방 + 고르게.
 *
 * **왜 「남은 분(分)」이 아니라 이것인가:** 남은 시간은 채집 네 계열에만 정의된다.
 * 조합 여덟·수집 넷·묶음 셋, 즉 40개 중 열다섯에 값이 없다. 계열 묶음은 40개
 * 전부에 정의되고, `metric` 칸 하나에서 그대로 나온다.
 */
type MilestoneGroup = SkillId | 'collection' | 'every'

/** 묶음이 화면에 서는 차례. 계열 다섯은 가방의 장비 슬롯·수집의 방과 같은 순서다. */
const GROUP_ORDER: readonly MilestoneGroup[] = [...SKILL_IDS, 'collection', 'every']

function groupOf(def: MilestoneDef): MilestoneGroup {
  return def.metric.kind === 'skill' ? def.metric.skill : def.metric.kind
}

/**
 * 「0 / 1,000」이 **무엇의** 숫자인지 — 진척 앞에 붙는 자의 이름.
 *
 * 예전에는 이름 뒤에 벌거벗은 두 숫자만 있었다. 이름이 계열을 말해 주는 줄
 * (「얼음에 익숙해지다」)에서는 그것으로 됐지만, 「구리 망치를 만들 수 있다
 * 0 / 200」은 200 이 조합 숙련인지 망치 개수인지 화면 어디에도 없었다.
 */
function metricLabel(def: MilestoneDef): string {
  const m = def.metric
  if (m.kind === 'skill') return `${SKILL_LABELS[m.skill]} 숙련`
  if (m.kind === 'collection') return '수집 총점'
  return '이정표'
}

interface MilestoneRow {
  def: MilestoneDef
  group: MilestoneGroup
  achieved: boolean
  current: number
  /** 아무것도 안 여는 순수 칭호인가 — 접히는 자루를 가르는 자(shared 의 `isPureTitle`). */
  pure: boolean
}

/**
 * 접을 수 있는 머리의 id — PanelScene 이 `ScrollList.consumeTap()` 으로 받는다.
 *
 * SETTINGS_ACTION 과 같은 자리, 같은 이유다: 문자열을 두 파일에 각각 적으면 한쪽
 * 오타가 "눌러도 아무 일도 없는 줄"이 되고, 그건 화면만 봐서는 고장인지 원래
 * 그런 것인지 알 수 없다.
 */
export const MILESTONE_FOLD = {
  gates: 'milestones:gates',
  titles: 'milestones:titles',
} as const

/** 이정표 한 개가 차지하는 두 줄 — 이름+진척(또는 체크), 그리고 효과 설명. */
function milestoneRowLines(row: MilestoneRow, data: GameData): ScrollListLine[] {
  // "???" 를 쓰지 않는다 — 못한 것도, 접힌 자루에서 꺼낸 것도 지금 값과 필요한
  // 값을 그대로 적는다. 접는 것과 숨기는 것은 다르다.
  const head = row.achieved
    ? `✓ ${row.def.name}`
    : `${row.def.name}   ${metricLabel(row.def)} ${fmt(row.current)} / ${fmt(row.def.threshold)}`
  return [
    {
      text: head,
      color: row.achieved ? SUCCESS_COLOR : LABEL_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
    },
    {
      text: effectDescription(row.def, data, row.achieved),
      color: DIM_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
    },
  ]
}

/** 접힌 자루 하나 — 머리 한 줄(개수를 세어 말한다) + 펼쳤을 때의 내용. */
function foldLines(
  id: string,
  label: string,
  rows: readonly MilestoneRow[],
  open: boolean,
  data: GameData,
): ScrollListLine[] {
  // 비어 있으면 머리도 안 낸다 — 「칭호 0개 [펼치기]」는 눌러도 아무 일도 없는 줄이다.
  if (rows.length === 0) return []
  const lines: ScrollListLine[] = [
    {
      text: `─── ${label} ${rows.length}개   ${open ? '[접기]' : '[펼치기]'}`,
      color: DIM_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
      groupId: id,
    },
  ]
  if (!open) return lines
  for (const row of rows) lines.push(...milestoneRowLines(row, data))
  return lines
}

/**
 * 이정표 탭의 내용 — 묶음마다 **지금 걸린 문 하나**, 나머지는 접힌 자루 둘에.
 *
 * **여태 무엇이 잘못됐는가.** 40항목 × 2줄 = 80줄이 한 덩어리였고, 정렬은 진척
 * 비율 내림차순이었다. 신규는 40개가 **전부 비율 0.000** 이라 그 정렬이 무효가
 * 되어 화면 순서가 문자 그대로 CSV 행 순서였고, 그래서 첫 다섯 줄이 전부
 * 「칭호 — 효과는 없다」였다 — 그 문구가 한 화면에 열네 번 나왔다. 목록방이 잠긴
 * 문 대신 잠긴 장식을 보여 주고 있었다.
 *
 * **묶음의 머리를 고르는 규칙: 못한 것 중 문턱이 가장 낮은 「문」.** 신규 화면에서
 * 이 한 줄이 광물 묶음의 머리를 `mineral_1000`(칭호)에서 `mineral_10000`(자동
 * 반복)으로, 수집 묶음을 `collection_10`(칭호)에서 `collection_30`(되사기 진열)으로
 * 옮긴다. 여섯 줄이 전부 실제로 열리는 것을 말한다.
 *
 * **열 문이 안 남은 묶음은 머리를 아예 안 낸다.** `고르게`(every 셋)가 그렇다 —
 * 전부 순수 칭호라 내보일 문이 하나도 없고, 없는 문을 지어내는 대신 그 셋을 칭호
 * 자루에 그대로 둔다. 이 규칙에는 잰 근거가 하나 더 있다: 일곱 묶음이면 줄이
 * 열여섯(288px)인데 목록 뷰포트는 812×375 에서 **255px** 이라, 접이 머리 둘이
 * 통째로 화면 아래로 밀려난다(실측). 나머지 서른넷에 닿는 유일한 손잡이가 안
 * 보이는 자리에 놓이는 것이다. 여섯 묶음이면 열넷(252px)이라 딱 들어간다.
 * 다 캔 사람의 화면이 머리 없이 자루 둘만 남는 것도 참말이다 — 그에게는 열 문이
 * 정말 없다.
 *
 * **접는 것과 숨기는 것은 다르다.** 남은 것은 사라지지 않고 자루 둘에 들어가며,
 * 머리가 몇 개인지 세어 말하고, 펼치면 잠긴 것까지 전부 지금 값과 함께 나온다.
 * `???` 는 한 글자도 없다.
 *
 * 문 목록은 줄이지 않는다 — 칭호를 접고 나면 남는 문이 스물셋뿐이라 애초에 40줄
 * 벽이 없고, 목록방의 힘은 "내가 아직 못 여는 것이 저기 있다"를 **묻지 않아도
 * 보는 것**이기 때문이다.
 *
 * `data.milestones` 자체는 절대 정렬하지 않는다 — `every` 이정표의 순환 없음
 * 검증이 그 정의 순서에 기댄다(packages/data/src/validate.ts). 여기서 만드는 것은
 * 표시 전용 사본이고, 같은 문턱끼리는 안정 정렬이 CSV 행 순서를 그대로 지킨다.
 */
function buildMilestoneLines(
  data: GameData,
  player: PlayerState,
  expanded: ReadonlySet<string>,
): ScrollListLine[] {
  const achieved = achievedIds(data, player)
  const rows: MilestoneRow[] = data.milestones.map((def) => ({
    def,
    group: groupOf(def),
    achieved: achieved.has(def.id),
    current: metricValue(def, player, data),
    pure: isPureTitle(def, data.recipes),
  }))

  const ordered = GROUP_ORDER.flatMap((group) =>
    rows.filter((r) => r.group === group).sort((a, b) => a.def.threshold - b.def.threshold),
  )

  const heads = new Set<string>()
  for (const group of GROUP_ORDER) {
    const head = ordered.find((r) => r.group === group && !r.achieved && !r.pure)
    if (head) heads.add(head.def.id)
  }

  const lines: ScrollListLine[] = []
  for (const row of ordered) {
    if (heads.has(row.def.id)) lines.push(...milestoneRowLines(row, data))
  }

  const rest = ordered.filter((r) => !heads.has(r.def.id))
  lines.push(
    ...foldLines(
      MILESTONE_FOLD.gates,
      '그 뒤의 문',
      rest.filter((r) => !r.pure),
      expanded.has(MILESTONE_FOLD.gates),
      data,
    ),
    ...foldLines(
      MILESTONE_FOLD.titles,
      '칭호',
      rest.filter((r) => r.pure),
      expanded.has(MILESTONE_FOLD.titles),
      data,
    ),
  )
  return lines
}

/**
 * 숙련도 탭의 내용. 다섯 기술의 현재 숙련도와 그 숙련도에서의 행동 간격.
 *
 * 채집 네 기술(ice·wood·mineral·herb)은 그 기술의 **손**(착용 도구 + 가진 증표,
 * `gatherHandOf`)까지 반영한 `gatherIntervalMs` 로 찍는다 — `actionIntervalMs`
 * 만 쓰던 예전 값은 도구 효과(§3)가 간격 축에 생긴 뒤로 거짓말이 됐고, 속도증표
 * (§5)가 생긴 지금은 손을 통째로 넘겨야 참이다(§6-앞 13, 서버 스탬프와 같은
 * 함수·같은 손이라야 이 숫자가 참이다).
 *
 * 조합도 이제 자기 함수(`craftIntervalMs`)를 갖는다 — 망치 **강화**가 제작 간격을
 * 줄이게 된 뒤로(제작 확장 §6-앞 14) `actionIntervalMs` 는 여기서도 거짓말이
 * 됐다: 만강 망치를 든 사람에게 500ms 라고 적어 놓고 서버는 429ms 로 스탬프한다.
 * 망치의 티어는 여전히 이 숫자를 안 바꾼다(티어가 사는 것은 성공률이다).
 */
function buildSkillLines(
  data: GameData,
  player: PlayerState,
  _expanded: ReadonlySet<string>,
): ScrollListLine[] {
  return SKILL_IDS.map((skill) => {
    const value = player.skills[skill]
    const interval =
      skill === 'crafting'
        ? craftIntervalMs(value, equippedToolInfo(player, skill, data.items))
        : gatherIntervalMs(value, gatherHandOf(player, skill, data.items))
    return {
      text: `${SKILL_LABELS[skill]}   숙련도 ${fmt(value)}   행동 간격 ${interval}ms`,
      color: LABEL_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
    }
  })
}

/**
 * 이 게임이 쓰는 남의 저작물.
 *
 * 게임 안에서 보여주는 이유는 두 가지다. OFL 은 저작권 표시를 유지할 것을
 * 요구하는데, 저장소의 CREDITS.md 는 플레이어가 볼 수 없다. 그리고 무엇을
 * 빌려 썼는지는 만든 사람이 숨길 일이 아니다.
 *
 * 자산을 더할 때 이 목록도 함께 늘린다 — assets/CREDITS.md 와 같은 내용이어야
 * 한다. 한쪽만 고치면 게임 안과 저장소가 다른 말을 하게 된다.
 */
const CREDITS: readonly { name: string; detail: string }[] = [
  {
    name: 'Neo둥근모 Pro',
    detail:
      '1990년대 김중태의 둥근모꼴을 Dalgona 가 변환·확장. SIL Open Font License 1.1.',
  },
  {
    name: 'Pipoya 무료 소재',
    detail: '타일셋과 캐릭터 스프라이트. 자세한 조건은 저장소의 CREDITS.md 참고.',
  },
  {
    name: 'game-icons.net',
    detail: '아이템 아이콘. 자세한 조건은 저장소의 CREDITS.md 참고.',
  },
]

/**
 * 설정 탭에서 누를 수 있는 줄의 id.
 *
 * PanelScene 이 `ScrollList.consumeTap()` 으로 받아 스토어에 넘긴다 — 제작
 * 패널의 레시피 줄과 같은 통로(`groupId`)를 쓴다. 여기 상수로 두는 이유는
 * 문자열을 두 파일에 각각 적으면 한쪽 오타가 "눌러도 아무 일도 없는 줄"이
 * 되기 때문이다. 그건 화면만 봐서는 고장인지 원래 그런 것인지 알 수 없다.
 */
export const SETTINGS_ACTION = {
  logout: 'settings:logout',
  deleteCharacter: 'settings:delete-character',
} as const

/**
 * 설정 탭의 내용.
 *
 * 조절할 수 있는 설정은 아직 없다 — 그 사실을 bag 과 같은 자세로 정직하게
 * 말하고, 대신 지금 확실히 보여줄 수 있는 것(누구로 놀고 있는지, 계정을 놓는
 * 두 가지 방법, 만든 사람과 빌려 쓴 것)을 싣는다.
 *
 * **계정을 다루는 두 줄이 여기 있는 이유:** 상단 바에 버튼으로 두면 게임 중에
 * 늘 눌릴 자리에 "지운다"가 놓인다. 톱니 → 설정은 이미 "지금 하던 것을 멈추고
 * 들여다보는" 자리라, 되돌릴 수 없는 일이 있어야 할 곳이 있다면 여기다.
 */
function buildSettingsLines(
  _data: GameData,
  player: PlayerState,
  _expanded: ReadonlySet<string>,
): ScrollListLine[] {
  const lines: ScrollListLine[] = [
    { text: '노가다 RPG 팬메이드', color: LABEL_COLOR, fontSize: ROW_NAME_FONT_SIZE },
    {
      text: '서비스 종료한 「노가다 RPG」를 팬이 다시 만드는 프로젝트입니다. 원작의 리소스와 수치는 쓰지 않고 전부 새로 만듭니다.',
      color: DIM_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
    },
    { text: '', color: DIM_COLOR, fontSize: ROW_DETAIL_FONT_SIZE },
    { text: '계정', color: LABEL_COLOR, fontSize: ROW_NAME_FONT_SIZE },
    {
      text: `  ${player.name} 으로 놀고 있습니다`,
      color: DIM_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
    },
    {
      text: '· 로그아웃',
      color: LABEL_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
      groupId: SETTINGS_ACTION.logout,
    },
    {
      text: '  이 기기에서 나갑니다. 캐릭터는 그대로 남습니다',
      color: DIM_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
      groupId: SETTINGS_ACTION.logout,
    },
    {
      text: '· 캐릭터 삭제',
      color: DANGER_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
      groupId: SETTINGS_ACTION.deleteCharacter,
    },
    {
      // 되돌릴 수 없다는 것을 누르기 **전에** 말한다. 누른 뒤에 처음 듣는
      // 경고는 이미 마음을 정한 사람에게 하는 확인일 뿐이다.
      text: '  진행도가 사라집니다. 되돌릴 수 없습니다. 계정은 남습니다',
      color: DIM_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
      groupId: SETTINGS_ACTION.deleteCharacter,
    },
    { text: '', color: DIM_COLOR, fontSize: ROW_DETAIL_FONT_SIZE },
    { text: '사용한 저작물', color: LABEL_COLOR, fontSize: ROW_NAME_FONT_SIZE },
  ]

  for (const c of CREDITS) {
    lines.push({ text: `· ${c.name}`, color: LABEL_COLOR, fontSize: ROW_NAME_FONT_SIZE })
    lines.push({ text: `  ${c.detail}`, color: DIM_COLOR, fontSize: ROW_DETAIL_FONT_SIZE })
  }

  lines.push({ text: '', color: DIM_COLOR, fontSize: ROW_DETAIL_FONT_SIZE })
  lines.push({
    text: '조절할 수 있는 설정은 아직 만들지 않았습니다.',
    color: DIM_COLOR,
    fontSize: ROW_NAME_FONT_SIZE,
  })
  return lines
}

/**
 * 탭 하나의 내용을 만드는 자.
 *
 * `expanded` 는 지금 펼쳐져 있는 접이 머리의 id 들이다 — 이정표 탭만 쓴다.
 * 이 상태를 이 모듈이 들고 있지 않는 이유: 여기 두면 모듈 전역 변수가 되어
 * 캐릭터를 바꿔도, 패널을 닫았다 열어도 지난 화면의 펼침이 따라온다. 화면
 * 상태는 화면을 소유한 쪽(PanelScene)의 것이다.
 */
type LineBuilder = (
  data: GameData,
  player: PlayerState,
  expanded: ReadonlySet<string>,
) => ScrollListLine[]

interface TabDef {
  id: string
  label: string
  buildLines: LineBuilder
}

/**
 * 상세 메뉴의 탭 목록 — 유일한 출처다.
 *
 * 이벤트·퀘스트 탭을 더할 때 여기 항목 하나(id·label·buildLines)만 늘리면
 * 된다. 탭 바 레이아웃·전환·스크롤(PanelScene 의 layoutMenu·render)은 전부
 * 이 배열의 길이와 내용에서 파생된다. `id` 의 타입인 `DetailMenuTab` 도
 * 바로 아래에서 이 배열 자체로부터 파생되므로, 다른 파일에 손으로 넓힐
 * 유니언이 없다 — `as const satisfies` 가 각 `id` 를 리터럴로 굳히고,
 * `(typeof TABS)[number]['id']` 가 그 리터럴들의 합집합을 뽑아낸다.
 */
export const TABS = [
  { id: 'skills', label: '숙련도', buildLines: buildSkillLines },
  { id: 'milestones', label: '이정표', buildLines: buildMilestoneLines },
  { id: 'settings', label: '설정', buildLines: buildSettingsLines },
] as const satisfies readonly TabDef[]

/** B 의 상세 메뉴 탭. TABS 의 id 들에서 파생된다 — TABS 에 항목을 추가하면 이 유니언도 컴파일러가 자동으로 넓힌다. */
export type DetailMenuTab = (typeof TABS)[number]['id']
