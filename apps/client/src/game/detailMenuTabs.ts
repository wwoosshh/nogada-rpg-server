import {
  achievedIds,
  actionIntervalMs,
  metricValue,
  milestoneRatio,
  SKILL_IDS,
  SKILL_LABELS,
  type GameData,
  type MilestoneDef,
  type MilestoneEffect,
  type PlayerState,
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
 * PanelScene 의 나머지 부분(가방 안내 상자 글자색, 탭 글자 기본색)도 이 두
 * 색을 그대로 쓴다 — 그래서 여기서 export 한다. ControlScene 과 PanelScene 이
 * 팔레트 리터럴을 서로 다시 옮겨 적는 것(PanelScene.ts 상단 주석)과는 다른
 * 얘기다 — 그건 별개 파일들의 의도된 중복이고, 이 둘은 원래 한 파일
 * (PanelScene.ts)이었던 코드를 구조만 나눈 것이라 그대로 공유한다.
 *
 * SUCCESS_COLOR·DANGER_COLOR 도 같은 이유로 내보낸다: 제작 패널 내용
 * (craftPanelContent.ts)이 "지금 만들 수 있다"·"재료 부족"을 이 탭의 이정표
 * 줄과 같은 색 언어로 말해야 해서, 그 파일도 이 둘을 가져다 쓴다.
 */
export const LABEL_COLOR = '#e8dcc0'
export const DIM_COLOR = '#c9b895'
export const SUCCESS_COLOR = '#7fa650'
/** tokens.css 의 --c-danger 와 같은 값이다. 재료 부족처럼 "지금 안 된다"를 숫자와 함께 알리는 줄에 쓴다. */
export const DANGER_COLOR = '#b4543a'

const ROW_NAME_FONT_SIZE = FONT_SIZE.body
const ROW_DETAIL_FONT_SIZE = FONT_SIZE.body

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/** ids 가 가리키는 대상의 실제 이름을 모아 사람이 읽는 목록으로 만든다. 데이터에 없으면 id 를 그대로 보여준다(조용히 지우지 않는다). */
function namesOf(ids: readonly string[], table: Record<string, { name: string }>): string {
  return ids.map((id) => table[id]?.name ?? id).join(' · ')
}

/**
 * 이정표 하나의 효과를 한 줄로 설명한다.
 *
 * achieved 로 시제를 가른다 — 달성한 것은 "지금 이렇다", 못한 것은 "달성하면
 * 이렇게 된다". `title` 은 achieved 여부와 무관하게 효과가 없다는 사실 자체를
 * 그대로 말한다 — 보상을 암시하고 안 주는 줄은 아예 없는 줄보다 나쁘다.
 */
function effectDescription(effect: MilestoneEffect, data: GameData, achieved: boolean): string {
  switch (effect.kind) {
    case 'repeat':
      return achieved ? '누르고 있으면 계속된다' : '달성하면 누르고 있는 것만으로 계속된다'
    case 'recipes': {
      const names = namesOf(effect.ids, data.recipes)
      return achieved ? `만들 수 있다 — ${names}` : `달성하면 만들 수 있다 — ${names}`
    }
    case 'nodes': {
      const names = namesOf(effect.ids, data.nodes)
      return achieved ? `캘 수 있다 — ${names}` : `달성하면 캘 수 있다 — ${names}`
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

interface MilestoneRow {
  def: MilestoneDef
  achieved: boolean
  current: number
  ratio: number
}

/**
 * 못한 것을 남은 비율이 작은 순(= 진척 ratio 가 큰 순)으로 먼저, 달성한 것을 뒤에 둔다.
 *
 * `data.milestones` 자체는 절대 정렬하지 않는다 — `nextMilestone` 의 동점
 * 처리와 `every` 이정표의 순환 없음 검증이 그 정의 순서에 기댄다(milestones.ts,
 * packages/data/src/validate.ts). 여기서 만드는 것은 표시 전용 사본이다.
 */
function buildMilestoneRows(data: GameData, player: PlayerState): MilestoneRow[] {
  const achieved = achievedIds(data.milestones, player)
  const rows: MilestoneRow[] = data.milestones.map((def) => ({
    def,
    achieved: achieved.has(def.id),
    current: metricValue(def, player, data.milestones),
    ratio: milestoneRatio(def, player, data.milestones),
  }))

  const pending = rows.filter((r) => !r.achieved).sort((a, b) => b.ratio - a.ratio)
  const done = rows.filter((r) => r.achieved)
  return [...pending, ...done]
}

/** 이정표 탭의 내용. 줄마다 이름+진척(또는 체크) 한 줄과 효과 설명 한 줄, 두 줄씩이다. */
function buildMilestoneLines(data: GameData, player: PlayerState): ScrollListLine[] {
  const lines: ScrollListLine[] = []
  for (const row of buildMilestoneRows(data, player)) {
    // "???" 를 쓰지 않는다 — 못한 것도 지금 값과 필요한 값을 그대로 적는다.
    const head = row.achieved
      ? `✓ ${row.def.name}`
      : `${row.def.name}   ${fmt(row.current)} / ${fmt(row.def.threshold)}`
    lines.push({
      text: head,
      color: row.achieved ? SUCCESS_COLOR : LABEL_COLOR,
      fontSize: ROW_NAME_FONT_SIZE,
    })
    lines.push({
      text: effectDescription(row.def.effect, data, row.achieved),
      color: DIM_COLOR,
      fontSize: ROW_DETAIL_FONT_SIZE,
    })
  }
  return lines
}

/** 숙련도 탭의 내용. 다섯 기술의 현재 숙련도와 그 숙련도에서의 행동 간격 — 둘 다 서버와 같은 공식(actionIntervalMs)으로 계산한다. */
function buildSkillLines(_data: GameData, player: PlayerState): ScrollListLine[] {
  return SKILL_IDS.map((skill) => {
    const value = player.skills[skill]
    const interval = actionIntervalMs(value)
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
function buildSettingsLines(_data: GameData, player: PlayerState): ScrollListLine[] {
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

type LineBuilder = (data: GameData, player: PlayerState) => ScrollListLine[]

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
