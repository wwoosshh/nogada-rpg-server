import {
  COUNTED_GOAL_KINDS,
  DIRECTION_LABELS,
  SKILL_LABELS,
  advanceStory,
  fillArg,
  fillText,
  slotsUsedBy,
  type Direction,
  type GameData,
  type MapDef,
  type PlayerState,
  type SkillId,
  type StoryAdvance,
  type StoryCatchUpDef,
  type StoryEvent,
  type StoryGoal,
  type StoryGoalDef,
  type StoryGoalKind,
  type StorySlots,
  type StoryStep,
  type StoryStepDef,
} from '@nogada/shared'
import { DEV_ONLY_MAP_IDS, startVillages, villageField } from './maps.js'
import { toMetricKind, toMilestoneMetric } from './milestones.js'
import { optionalCell, requireCell, toInt, toSkillId } from './parse.js'

type Row = Record<string, string>

const FILE = 'story.csv'

/** `discoverable` 칸에 적는 유일한 값 — `gateTide`·`equity` 와 같은 표시형 칸이다. */
const DISCOVERABLE_MARK = '1'

const GOAL_KINDS: readonly StoryGoalKind[] = ['arrive', 'gather', 'donate', 'craft', 'reach'] as const

/**
 * 밀어올림 문턱이 쓰는 칸 이름 — `toMilestoneMetric` 이 오류 문구에 적는 것들.
 *
 * 검증과 런타임 해석이 **같은 상수**를 쓴다. 한쪽만 `metricArg` 라고 적으면
 * 작가는 빌드에서 본 칸 이름과 다른 이름으로 혼나게 된다.
 */
const CATCH_UP_FIELDS = { kind: 'catchUpKind', arg: 'catchUpArg' } as const

function toGoalKind(value: string, ctx: string): StoryGoalKind {
  if (!(GOAL_KINDS as readonly string[]).includes(value)) {
    throw new Error(`${ctx}: goalKind "${value}" 는 알 수 없다 (허용값: ${GOAL_KINDS.join(', ')})`)
  }
  return value as StoryGoalKind
}

/**
 * 조건 두 칸(종류·인자)에 세는 칸을 붙인다.
 *
 * **`goalCount` 는 세는 종류에만 있고, 안 세는 종류에는 없어야 한다**(설계 ②의
 * "세는 방식" 줄). `gateSkill`/`gateValue` 의 짝 강제와 같은 자세이고 이유도 같다:
 * `arrive` 에 40 을 적은 작가는 "마흔 번 넘어가야 한다" 고 믿는데 판정은 그 칸을
 * 아예 안 읽고, 반대로 `gather` 에 안 적으면 몇 번을 캐야 하는지 아무도 모르는
 * 마디가 선다 — 둘 다 화면 어디에도 흔적을 남기지 않는다.
 *
 * 수로 바꾸지 않고 글로 두는 이유: 이 칸에도 슬롯(`{t1}`)이 들어간다. 마을이
 * 정해져야 수가 되므로, 정수인지는 슬롯을 편 뒤 빌드 검증이 마을마다 본다.
 */
function toGoal(row: Row, ctx: string): StoryGoalDef {
  const kind = toGoalKind(requireCell(row, 'goalKind', ctx), ctx)
  const arg = requireCell(row, 'goalArg', ctx)
  const count = optionalCell(row, 'goalCount')
  const counted = COUNTED_GOAL_KINDS.includes(kind)

  if (counted && count === undefined) {
    throw new Error(
      `${ctx}: goalKind=${kind} 는 마디 시작부터의 델타를 세므로 goalCount 가 필요하다 — 몇 번을 해야 끝나는지 아무도 모르는 마디가 된다`,
    )
  }
  if (!counted && count !== undefined) {
    throw new Error(
      `${ctx}: goalKind=${kind} 는 세지 않는데 goalCount 에 "${count}" 가 적혔다 — ${kind === 'arrive' ? '한 번 넘어가면 끝이라 셀 것이 없다' : '이정표는 단조 지표라 델타가 아니라 문턱으로 판정된다'}(StoryGoalKind 참고). 조용히 무시하면 작가는 그 숫자가 무언가 한다고 믿는다`,
    )
  }

  const goal: StoryGoalDef = { kind, arg }
  if (count !== undefined) goal.count = count
  return goal
}

/**
 * 밀어올림 문턱 세 칸을 읽는다. 셋 다 비면 `undefined`(밀어 올릴 수 없는 마디다).
 *
 * `collection` 은 인자가 없는 것이 정상이라(방은 하나뿐이다) 짝 강제는 종류·문턱
 * 둘로만 건다 — 인자를 요구할지 말지는 `toMilestoneMetric` 이 종류를 보고 정한다.
 * 그 함수를 빌려 쓰는 것이 곧 **단조 지표 제한**이다(설계 ⑦).
 *
 * 다만 여기서는 아직 못 부른다 — `catchUpArg` 에 슬롯(`{계열}`)이 남아 있어서다.
 * 값으로 옮기는 것은 마을이 정해진 뒤(validateStory·런타임)의 일이고, 여기서
 * 검사할 수 있는 것은 **세 칸이 함께 있는가** 하나뿐이다.
 */
function toCatchUp(row: Row, ctx: string): StoryCatchUpDef | undefined {
  const kind = optionalCell(row, 'catchUpKind')
  const threshold = optionalCell(row, 'catchUpThreshold')
  if ((kind === undefined) !== (threshold === undefined)) {
    throw new Error(
      `${ctx}: catchUpKind 와 catchUpThreshold 는 함께 적거나 함께 비워야 한다 (지금 catchUpKind="${kind ?? ''}", catchUpThreshold="${threshold ?? ''}") — 종류 없는 숫자는 무엇의 문턱인지 모르고, 숫자 없는 종류는 얼마인지 모른다`,
    )
  }
  if (kind === undefined || threshold === undefined) return undefined

  return {
    // 종류만 여기서 좁힌다 — 인자는 슬롯이 남아 있어 아직 값이 아니다(toMetricKind 참고).
    kind: toMetricKind(kind, ctx, 'catchUpKind'),
    arg: row['catchUpArg'] ?? '',
    threshold: toInt(threshold, ctx, 'catchUpThreshold'),
  }
}

/**
 * `story.csv` 를 파싱한다 — **슬롯이 남아 있는 날것**을 돌려준다.
 *
 * 여기서 던지는 것은 "행 하나만 봐도 아는" 구조 오류다(빈 칸, 모르는 종류, 짝이
 * 안 맞는 칸). 표를 다 모으거나 세계를 함께 봐야 아는 것(연속성·참조 무결성·슬롯이
 * 네 마을에서 서는가)은 `validateStory` 가 목록으로 모아 보고한다 — 작가가 한 번의
 * 빌드에서 오류 전부를 보게 하려는 것이고, 이 갈래는 collection.ts·gatherTables.ts
 * 와 같다.
 */
export function parseStory(rows: Row[]): StoryStepDef[] {
  const out: StoryStepDef[] = []

  for (const row of rows) {
    const step = toInt(requireCell(row, 'step', FILE), FILE, 'step', 0)
    const field = optionalCell(row, 'field')
    const ctx = `${FILE}[마디 ${step}${field === undefined ? '' : ` · ${field}`}]`

    const discoverableRaw = optionalCell(row, 'discoverable')
    if (discoverableRaw !== undefined && discoverableRaw !== DISCOVERABLE_MARK) {
      throw new Error(
        `${ctx}: discoverable "${discoverableRaw}" 는 알 수 없다 — 띠에 목적을 적는 마디에만 "${DISCOVERABLE_MARK}" 을 적고 나머지는 비운다. 다른 값을 조용히 거짓으로 접으면 작가는 안내가 뜬다고 믿는데 화면은 조용하다`,
      )
    }
    const discoverable = discoverableRaw === DISCOVERABLE_MARK

    const objective = optionalCell(row, 'objective') ?? ''
    const announce = optionalCell(row, 'announce') ?? ''

    // 띠에 적는 마디는 적을 글이 있어야 한다 — 없으면 띠가 빈 줄로 서서 화면의
    // 5.3% 를 아무 말 없이 가린다.
    if (discoverable && objective === '') {
      throw new Error(`${ctx}: discoverable 인데 objective 가 비어 있다 — 띠가 빈 줄로 선다`)
    }
    // 반대쪽은 announce 다. discoverable 이 아닌 마디는 화면에 아무것도 안 적고
    // 조건만 재다가 달성했을 때 announce 만 낸다(설계 ⑥ 방어①) — 그 한 줄마저
    // 없으면 상태가 조용히 바뀌고 플레이어는 무슨 일이 있었는지 알 방법이 없다.
    if (!discoverable && announce === '') {
      throw new Error(
        `${ctx}: discoverable 이 아닌데 announce 가 비어 있다 — 띠에도 안 적고 달성 뒤에도 말하지 않으면 아무도 지나간 줄 모르는 마디가 된다`,
      )
    }
    // 반대로 discoverable 인 마디의 objective 를 안 지운다 — 설계가 남긴 손잡이는
    // "이 칸 하나를 비우면 유도등이 꺼진다"이고(⑥ 방어①), 짝까지 강제하면 그
    // 손잡이가 두 칸이 된다.

    const def: StoryStepDef = {
      step,
      objective,
      goal: toGoal(row, ctx),
      announce,
      discoverable,
    }
    if (field !== undefined) def.field = toSkillId(field, `${ctx}.field`)
    const catchUp = toCatchUp(row, ctx)
    if (catchUp) def.catchUp = catchUp

    out.push(def)
  }

  return out
}

/** 그 계열의 사슬에 실제로 걸리는 마디들 — 계열 무관 행과 그 계열 행을 합친 것. */
function chainOf(story: readonly StoryStepDef[], skill: SkillId): StoryStepDef[] {
  return story.filter((def) => def.field === undefined || def.field === skill)
}

/**
 * 마을에서 채집장으로 나가는 문이 그 마을의 **어느 가장자리**에 있는가.
 *
 * `transitions.csv` 의 `facing` 칸을 안 쓰는 이유: 그 칸의 뜻은 "넘어간 뒤 어느
 * 쪽을 보고 서는가" 이지 "문이 어디 있는가" 가 아니다. 오늘은 네 마을 모두 두
 * 값이 우연히 같지만, 도착해서 왼쪽을 보게 하고 싶어 `facing` 을 고치는 날 띠는
 * 「서문으로 나가라」고 말하면서 문은 여전히 위쪽 가장자리에 있게 된다 — 그리고
 * 그 거짓말은 어느 화면에서도 되짚을 수 없다. 자리는 자리에게 묻는다.
 *
 * 가장자리가 없거나(안쪽 문) 둘이면(모서리) 방향이 하나로 안 정해져 던진다.
 */
function doorDirection(map: MapDef, x: number, y: number): Direction {
  const edges: Direction[] = []
  if (y === 0) edges.push('up')
  if (y === map.height - 1) edges.push('down')
  if (x === 0) edges.push('left')
  if (x === map.width - 1) edges.push('right')

  if (edges.length !== 1) {
    throw new Error(
      `마을 "${map.id}" 의 채집장 문 (${x}, ${y}) 이 가장자리 ${edges.length}개에 걸쳐 있다 (${map.width}×${map.height}) — ` +
        `"북문" 이라고 부를 수 있으려면 가장자리 하나 위에 있어야 한다`,
    )
  }
  return edges[0]!
}

/**
 * 그 계열에서 **가장 흔한 채집물** — 마디 3이 바치라고 말할 것.
 *
 * 수집 칸 중 그 계열의 것 하나를 고르는데, 기준이 **1단 문턱이 가장 큰 것**이다.
 * 1단은 "구리 손·첫 브라켓에서 5분 안에 닿는다" 를 겨냥해 적히므로
 * (collection.ts 의 EARLY_BUDGET_MINUTES) 그 손에서의 출현율에 비례한다 — 즉
 * 1단이 가장 큰 칸이 그 채집장에서 가장 자주 나오는 물건이다. 출하 데이터에서
 * 얼음 조각(200)·무른 통나무(200)·흔한 약초(150)·구리 원석(50) 넷이 그대로 나온다.
 *
 * **확률표에 직접 묻지 않는 이유:** 채집 확률표는 서버 전용 산출물이라 GameData 에
 * 없다(브라켓 경계가 곧 숨은 문턱이라 클라 번들에 실리면 F12 로 스포일된다). 띠는
 * 클라이언트가 그리므로 여기서 쓸 수 있는 것은 번들에 실린 것뿐이고, 수집 문턱표는
 * **잠긴 칸에도 요구치를 적기 위해** 이미 실려 있다.
 *
 * 동점이면 던진다 — 조용히 첫 번째를 고르면 마을 하나의 안내가 데이터를 고친 날
 * 아무 소리 없이 다른 물건을 가리킨다.
 */
function commonestGathered(data: GameData, skill: SkillId): { itemId: string; t1: number } {
  const mine = Object.values(data.collection)
    .filter((def) => data.items[def.itemId]?.skill === skill)
    .map((def) => ({ itemId: def.itemId, t1: def.steps[0] }))

  if (mine.length === 0) throw new Error(`계열 "${skill}" 의 수집 칸이 하나도 없다`)

  const top = Math.max(...mine.map((entry) => entry.t1))
  const winners = mine.filter((entry) => entry.t1 === top)
  if (winners.length !== 1) {
    throw new Error(
      `계열 "${skill}" 에서 1단이 가장 큰 수집 칸이 [${winners.map((w) => w.itemId).join(', ')}] ${winners.length}개다 — ` +
        `가장 흔한 채집물이 하나로 정해지지 않는다`,
    )
  }
  return winners[0]!
}

/** 그 채집장에 놓인 보통 노드 — 마디 1이 "앞에서 A" 라고 말할 것. 하나여야 한다. */
function normalNodeOf(data: GameData, mapId: string): { id: string; name: string } {
  const ids = new Set<string>()
  for (const placement of Object.values(data.placements)) {
    if (placement.mapId !== mapId) continue
    const node = data.nodes[placement.nodeId]
    // 없는 노드를 가리키는 배치는 parsePlacements 가 이미 던졌다.
    if (node?.variant === 'normal') ids.add(node.id)
  }

  if (ids.size !== 1) {
    throw new Error(
      `채집장 "${mapId}" 에 놓인 보통 노드가 [${[...ids].join(', ')}] ${ids.size}종이다 — ` +
        `첫 채집을 가리키려면 정확히 한 종이어야 한다(심층은 결계 뒤라 못 가리키고, 특수는 조건이 붙어 늘 거기 있지 않다)`,
    )
  }
  const id = [...ids][0]!
  return { id, name: data.nodes[id]!.name }
}

/**
 * 시작 마을 하나가 채우는 슬롯 전부 — **이 함수가 "사슬 한 벌"을 네 벌로 만든다**.
 *
 * 값은 어디에도 적혀 있지 않고 세계의 생김새에서 나온다(`villageField` 와 같은
 * 자세, 같은 이유). 이 대응을 `story.csv` 에 계열마다 적어 두면 마을을 하나 더
 * 그리는 날 표만 옛말을 하고, 그것보다 나쁜 것은 **적는 것을 잊은 마을이 안내를
 * 한 글자도 못 받는다**는 쪽이다 — 세 설계안이 전부 눈의마을·얼음에 못박혀 있어
 * 새 계정 넷 중 셋이 그 상태였다(설계 ①).
 *
 * 유도가 안 서면 던진다. 빌드가 네 마을 전부에서 이 함수를 돌린다(validateStory).
 */
export function storySlots(data: GameData, villageId: string): StorySlots {
  const village = data.maps[villageId]
  if (!village) throw new Error(`마을 "${villageId}" 이 맵 등록부에 없다`)

  const field = villageField(data, villageId)

  const doors = data.transitions.filter((t) => t.fromMap === villageId && t.toMap === field.map.id)
  if (doors.length !== 1) {
    throw new Error(
      `마을 "${villageId}" 에서 채집장 "${field.map.id}" 으로 가는 문이 ${doors.length}개다 — ` +
        `"어느 문으로 나가라" 를 말하려면 정확히 하나여야 한다`,
    )
  }
  const door = doors[0]!
  const direction = doorDirection(village, door.fromX, door.fromY)

  const node = normalNodeOf(data, field.map.id)
  const commonest = commonestGathered(data, field.skill)
  const item = data.items[commonest.itemId]
  if (!item) throw new Error(`수집 칸 "${commonest.itemId}" 가 items.csv 에 없다`)

  return {
    마을: { id: village.id, name: village.name },
    채집장: { id: field.map.id, name: field.map.name },
    계열: { id: field.skill, name: SKILL_LABELS[field.skill] },
    문방향: { id: direction, name: DIRECTION_LABELS[direction] },
    노드: { id: node.id, name: node.name },
    아이템: { id: item.id, name: item.name },
    // 숫자는 글로도 값으로도 같다 — 두 얼굴이 갈라질 것이 없다.
    t1: { id: String(commonest.t1), name: String(commonest.t1) },
  }
}

/** 조건의 인자가 그 종류의 등록부에 실재하는가. 실재하면 `null`. */
function goalTargetError(kind: StoryGoalKind, arg: string, data: GameData): string | null {
  if (kind === 'arrive') {
    if (!data.maps[arg]) return `맵 "${arg}" 이 maps.csv 에 없다`
    // 개발용 시험장은 눈의마을 서문에서 숙련 0 으로 걸어 들어가는 노드 13개짜리
    // 샌드박스다(설계 ⑤). 사슬이 그리로 보내면 신규가 게임 대신 시험장을 본다.
    if (DEV_ONLY_MAP_IDS.includes(arg)) return `개발용 시험장 "${arg}" 으로 보낸다 — 사슬이 가리킬 곳이 아니다`
    return null
  }
  if (kind === 'gather') {
    const placed = Object.values(data.placements).some((p) => data.nodes[p.nodeId]?.skill === arg)
    return placed ? null : `계열 "${arg}" 의 노드가 맵 어디에도 놓이지 않았다 — 캘 수 없는 계열이다`
  }
  if (kind === 'donate') {
    // items 가 아니라 collection 을 묻는다 — 수집의 방 칸이 아닌 물건은 바칠 수
    // 없으므로(정제품·가루·주괴), 그 마디는 영원히 끝나지 않는다.
    return data.collection[arg] ? null : `아이템 "${arg}" 의 수집 칸이 없다 — 바칠 수 없는 물건이라 마디가 끝나지 않는다`
  }
  if (kind === 'craft') {
    return data.recipes[arg] ? null : `레시피 "${arg}" 가 recipes.csv 에 없다`
  }
  return data.milestones.some((m) => m.id === arg)
    ? null
    : `이정표 "${arg}" 가 milestones.csv 에 없다`
}

/**
 * 글 속에서 이름을 찾을 때의 최소 길이.
 *
 * 방향 이름표는 한 글자다(북·남·동·서). 한 글자짜리를 글 속에서 찾으면 「**동**굴」
 * 「서**서**히」처럼 아무 상관 없는 낱말이 걸린다 — 한국어에는 낱말 경계가 띄어쓰기로
 * 보장되지 않으므로 정규식으로도 가를 수 없다. 그래서 글 쪽 검사는 두 글자부터 본다.
 * **인자 쪽은 이 한계가 없다** — 거기서는 값이 통째로 같은지만 보므로 `up` 을 정확히
 * 잡는다.
 */
const PIN_MIN_NAME_LENGTH = 2

/**
 * 글 쪽에서 **빼는** 주인 — 순수 수(`{t1}` 이 채우는 50·150·200).
 *
 * 위 최소 길이와 같은 성격의 한 줄이다: 두 글자 문턱은 한 글자 방향 이름표를
 * 거르려고 세운 것인데 숫자는 그 문턱을 그냥 넘는다. 「여관은 1,500 골드다」라고
 * 적으면 그 안의 「50」이 광물의 `{t1}` 로 걸려서, 계열과 아무 상관 없는 글이
 * 「광물의 {t1} 를 못박았다」는 **완전히 엉뚱한 설명**과 함께 빌드를 세운다 —
 * 작가는 자기가 무엇을 못박았는지 찾을 수 없다.
 *
 * 잃는 이빨은 없다: 숫자 슬롯의 못박기는 인자 쪽(`goalCount` 가 통째로 "200")이
 * 정확히 잡는다. 거기서는 값이 통째로 같은지만 보므로 「1,500」에 걸릴 일이 없다.
 */
const PURE_NUMBER = /^\d+$/

/**
 * 사슬 한 벌이 실제로 도는 자리 — **마을 하나**와 그 마을이 채우는 슬롯.
 *
 * 계열이 아니라 마을을 단위로 삼는 이유: 계열로 키를 잡으면 같은 계열의 마을
 * 둘째가 첫째를 덮어써서, 덮인 마을은 슬롯 유도도 못박기도 연속성도 **한 번도
 * 검사받지 않는다**. 오늘은 마을 넷 계열 넷이라 터지지 않지만 이 검사가 막겠다고
 * 한 상태가 정확히 그것이고, 다른 검사가 대신 막아 주지도 않는다 —
 * `validateVillageFields` 는 두 마을이 같은 **채집장 맵**을 대표로 삼는 것만
 * 위반으로 세므로 서로 다른 얼음 채집장 둘은 그대로 통과한다.
 */
interface Chain {
  village: MapDef
  skill: SkillId
  slots: StorySlots
}

/**
 * **행이 남의 마을에 못박혀 있는가** — 이 아크에서 가장 값이 큰 검사(설계 ⑧-2).
 *
 * 슬롯이 펴지는지만 보면 이 사고를 못 잡는다: `arrive 얼음채집장` 이라고 **이름을
 * 그대로 적은** 행은 슬롯이 하나도 없으니 무사히 펴지고, 얼음채집장은 실재하니
 * 참조 무결성도 통과한다. 그런데 그 행은 항구마을에서 시작한 사람에게 지도 반대편의
 * 채집장으로 가라고 말한다 — 심사에 올라온 설계안 셋이 전부 그 상태였고, 그대로
 * 지었으면 새 계정 넷 중 셋이 안내를 한 글자도 못 받았다.
 *
 * 그래서 **마을마다 자기가 채우는 값**(슬롯이 내놓는 id·이름 전부)을 적어 두고,
 * 행이 적은 값을 **그 행이 실제로 걸리는 마을들**과 맞춰 본다. 그중 하나라도 그
 * 값을 안 채우면 그 마을 사람은 남의 것을 가리키는 안내를 받으므로 위반이다.
 *
 * **계열 행도 함께 본다.** 계열을 적었다는 것은 "이 행은 그 계열에서만 걸린다" 이지
 * "무엇을 적어도 된다" 가 아니다. `field=ice` 행의 `ice_1000`·「얼음 조각」은 눈의마을이
 * 스스로 채우는 값이라 그대로 통과하고(마디 4·5 는 애초에 그러라고 갈라 놓은 행이다),
 * 같은 행의 `허브채집장` 만 짖는다 — 계열 행을 통째로 면제하면 눈의마을 사람이 지도
 * 반대편 허브채집장으로 불려도 위반이 0 이 된다.
 */
function collectPinnedViolations(story: readonly StoryStepDef[], chains: readonly Chain[]): string[] {
  /** 값 → 그 값을 실제로 채우는 마을들. */
  const owners = new Map<string, Set<Chain>>()
  /** 값 → 사람이 읽는 주인 이름들. 계열이 아니라 마을까지 적는다(Chain 참고). */
  const labels = new Map<string, Set<string>>()
  const remember = (value: string, chain: Chain, slotName: string): void => {
    const by = owners.get(value) ?? new Set<Chain>()
    by.add(chain)
    owners.set(value, by)
    // id 와 이름이 같은 슬롯(숫자)도 있어 집합으로 모은다 — 같은 주인을 두 번 적지 않는다.
    const text = labels.get(value) ?? new Set<string>()
    text.add(`${chain.skill}(${chain.village.id}) 의 {${slotName}}`)
    labels.set(value, text)
  }
  for (const chain of chains) {
    for (const [name, slot] of Object.entries(chain.slots)) {
      remember(slot.id, chain, name)
      remember(slot.name, chain, name)
    }
  }
  const ownerText = (value: string): string => [...(labels.get(value) ?? [])].join(' · ')
  const villageText = (list: readonly Chain[]): string =>
    list.map((c) => `${c.skill}(${c.village.id})`).join(' · ')

  /** 이 행이 실제로 걸리는 마을들 — 계열이 안 적혔으면 전부다. */
  const scopeOf = (def: StoryStepDef): Chain[] =>
    chains.filter((chain) => def.field === undefined || chain.skill === def.field)

  /** 그 값을 안 채우는데도 이 행이 걸리는 마을들. 비어 있으면 못박기가 아니다. */
  const strangersOf = (value: string, def: StoryStepDef): Chain[] => {
    const by = owners.get(value)
    return by ? scopeOf(def).filter((chain) => !by.has(chain)) : []
  }

  const violations: string[] = []
  for (const def of story) {
    const at = `${FILE}[마디 ${def.step}${def.field === undefined ? '' : ` · ${def.field}`}]`

    // 인자 쪽 — 값이 통째로 같은지만 본다.
    for (const [field, raw] of [
      ['goalArg', def.goal.arg],
      ['goalCount', def.goal.count],
      ['catchUpArg', def.catchUp?.arg],
    ] as const) {
      if (raw === undefined || raw === '') continue
      const strangers = strangersOf(raw, def)
      if (strangers.length === 0) continue
      violations.push(
        `${at}: ${field} 에 "${raw}" 가 그대로 적혔다 — 그것은 ${ownerText(raw)} 가 채우는 값인데, 이 행은 ${villageText(strangers)} 에서도 걸린다. 그 마을 사람은 남의 마을을 가리키는 안내를 받는다. 슬롯으로 적거나 field 칸에 그 계열을 적는다`,
      )
    }

    // 글 쪽 — 낱말이 문장 안에 섞여 있으므로 품고 있는지를 본다.
    for (const [field, raw] of [
      ['objective', def.objective],
      ['announce', def.announce],
    ] as const) {
      const hits = [...owners.keys()].filter(
        (value) =>
          value.length >= PIN_MIN_NAME_LENGTH &&
          !PURE_NUMBER.test(value) &&
          raw.includes(value) &&
          strangersOf(value, def).length > 0,
      )
      // 「얼음 조각」이 걸리면 「얼음」도 함께 걸린다 — 원인은 하나이므로 가장 긴
      // 것만 말한다(collection.ts 가 순증가 위반 뒤의 비율을 안 묻는 것과 같은 저울).
      for (const value of hits.filter((v) => !hits.some((other) => other !== v && other.includes(v)))) {
        violations.push(
          `${at}: ${field} 이 "${value}" 를 그대로 적는다 — 그것은 ${ownerText(value)} 가 채우는 이름인데, 이 행은 ${villageText(strangersOf(value, def))} 에서도 걸린다. 그 마을에서 화면이 거짓말을 한다`,
        )
      }
    }
  }
  return violations
}

/**
 * `reach` 가 **남의 계열**의 이정표를 요구하는가 — 요구하면 그 계열, 아니면 `null`.
 *
 * 이정표 id 는 슬롯이 채우는 값이 아니라서(`ice_1000` 은 어느 슬롯의 얼굴도 아니다)
 * 위 못박기 검사의 그물을 그냥 지나간다. 그런데 광물 마을 사람에게 `ice_1000` 을
 * 요구하는 행은 정확히 같은 사고다 — 자기 계열에 없는 이정표라 사슬이 그 자리에서
 * 영원히 멈추고, 화면에도 빌드에도 흔적이 없다.
 *
 * **시작 마을의 계열이 아닌 지표는 남의 것이 아니다.** 설계 ③ 이 광물의 마디 4·5 를
 * 조합 200(`crafting_200`)으로 보내기 때문이다 — 광물에는 1,000 짜리 문이 없다.
 * 조합은 어느 마을의 대표 계열도 아니므로 네 사슬 누구나 가리킬 수 있다.
 */
function foreignReachField(
  data: GameData,
  milestoneId: string,
  mine: SkillId,
  fields: ReadonlySet<SkillId>,
): SkillId | null {
  const metric = data.milestones.find((m) => m.id === milestoneId)?.metric
  if (metric?.kind !== 'skill') return null
  if (metric.skill === mine || !fields.has(metric.skill)) return null
  return metric.skill
}

/**
 * 스토리 표의 뜻을 검사한다. 위반 목록을 돌려준다(빌드가 다른 검사들과 함께 인쇄한다).
 *
 * 검사 넷 중 **가장 값이 큰 것은 세 번째**다(설계 ⑧-2): 슬롯이 네 시작 마을
 * 전부에서 유도되는가. 설계안 셋이 전부 사슬을 눈의마을·얼음에 못박아 뒀고, 그대로
 * 지었으면 새 계정 넷 중 셋이 안내를 한 글자도 못 받았다. 이 검사가 그것을 영구히
 * 막는다 — 마을을 다섯째로 그리는 날에도 그렇다.
 *
 * 표가 비어 있으면 위반도 없다. 마디를 아직 안 쓴 상태에서도 빌드는 서야 한다.
 */
export function validateStory(data: GameData): string[] {
  const violations: string[] = []

  let villages: MapDef[]
  try {
    villages = startVillages(data)
  } catch (err) {
    return [`${FILE}: 시작 마을 목록을 만들 수 없다: ${(err as Error).message}`]
  }

  // ---- 3. 슬롯이 네 시작 마을 전부에서 유도되는가 ----
  //
  // **마을마다 한 벌씩 쌓는다**(계열로 키를 잡지 않는다 — Chain 참고). 마을을
  // 다섯째로 그리는 날 그 마을의 계열이 이미 있는 것이어도 이 목록에서 빠지지
  // 않는다.
  const chains: Chain[] = []
  for (const village of villages) {
    try {
      const field = villageField(data, village.id)
      chains.push({ village, skill: field.skill, slots: storySlots(data, village.id) })
    } catch (err) {
      violations.push(`${FILE}: 마을 "${village.id}" 의 슬롯을 유도할 수 없다 — ${(err as Error).message}`)
    }
  }
  // 슬롯이 안 서면 아래 검사는 전부 그 그림자다(위반 하나가 마디 수만큼 불어난다) —
  // validate.ts 가 참조 위반이 있으면 도달 가능성 검사를 미루는 것과 같은 저울이다.
  if (violations.length > 0) return violations

  // ---- 1'. field 칸이 실제로 있는 계열인가 ----
  //
  // 참조 무결성의 첫 줄이다. 없는 계열을 적은 행은 어느 마을의 사슬에도 안 실려
  // 조용히 죽고, 그 자리에 있어야 할 마디는 아래 연속성 검사에서 "빠졌다" 로만
  // 드러난다 — 원인을 이름으로 말한다.
  const fields = new Set(chains.map((chain) => chain.skill))
  for (const def of data.story) {
    if (def.field === undefined || fields.has(def.field)) continue
    violations.push(
      `${FILE}[마디 ${def.step} · ${def.field}]: "${def.field}" 은 어느 시작 마을의 계열도 아니다 (있는 것: ${[...fields].join(', ')}) — 이 행은 아무의 사슬에도 안 실린다`,
    )
  }

  violations.push(...collectPinnedViolations(data.story, chains))

  // ---- 2'. 계열마다 사슬 길이가 같은가 ----
  //
  // 연속성은 계열마다 따로 세므로 **한 계열의 마지막 마디를 통째로 빠뜨린 표**는
  // 아래 검사를 그냥 통과한다: 광물의 마디 1 이 없으면 광물 사슬은 "길이 1, 0부터
  // 연속" 으로 멀쩡하다. 그런데 설계 ③ 은 네 계열 전부 마디 0~5 를 걷게 되어 있고,
  // 마디 4·5 는 계열별 8행이라 **한 계열 두 행을 빠뜨리는 것이 가장 흔한 사고**다.
  // 그때 그 마을 사람만 3.5분짜리 유도등이 두 마디 일찍 꺼지는데, 화면에도 빌드에도
  // 흔적이 없다.
  //
  // 행 수가 아니라 **마디 수**(step 의 가짓수)를 센다 — 같은 마디가 두 행인 사고는
  // 바로 아래 연속성 검사가 이름으로 말하므로, 여기서 그 그림자를 한 번 더 세면
  // 원인 하나가 위반 둘로 불어난다.
  const lengths = new Map<SkillId, number>()
  for (const skill of fields) {
    lengths.set(skill, new Set(chainOf(data.story, skill).map((def) => def.step)).size)
  }
  if (new Set(lengths.values()).size > 1) {
    violations.push(
      `${FILE}: 계열마다 사슬 길이가 다르다 (${[...lengths].map(([skill, n]) => `${skill} ${n}마디`).join(' · ')}) — 네 계열은 같은 수의 마디를 걷는다(설계 ③). 짧은 쪽은 마디가 통째로 빠진 것이고, 그 계열로 시작한 사람만 유도등이 일찍 꺼진다`,
    )
  }

  for (const { village, skill, slots } of chains) {
    const chain = chainOf(data.story, skill)
    const label = `${skill}(${village.id})`

    // ---- 2. step 이 0부터 빈틈없이 연속인가 ----
    //
    // **계열마다 따로 센다.** 마디 4·5 는 계열별 행이라(광물에는 1,000 짜리 문이
    // 없다) 표 전체로 세면 같은 step 이 넷씩 나온다. 사슬은 마을 하나에서 도는
    // 것이므로, 물어야 하는 것은 "이 마을에서 0부터 끝까지 이어지는가" 다.
    const byStep = new Map<number, StoryStepDef[]>()
    for (const def of chain) {
      const list = byStep.get(def.step)
      if (list) list.push(def)
      else byStep.set(def.step, [def])
    }
    for (let step = 0; step < chain.length; step++) {
      const here = byStep.get(step) ?? []
      if (here.length === 1) continue
      violations.push(
        here.length === 0
          ? `${FILE}(${label}): 마디 ${step} 이 없다 — step 은 0부터 빈틈없이 이어져야 한다. 비면 그 앞 마디를 끝낸 사람의 사슬이 그 자리에서 멈춘다`
          : `${FILE}(${label}): 마디 ${step} 이 ${here.length}행이다 (field: ${here.map((d) => d.field ?? '전부').join(', ')}) — 계열마다 정확히 하나여야 한다. 둘이면 어느 것이 걸릴지 정해지지 않는다`,
      )
    }
    // 위 순환은 0..길이-1 만 본다 — 그 밖의 step 은 여기서 잡는다(예: 0,1,3 이면
    // 2 가 없다는 위반과 3 이 범위 밖이라는 위반이 같은 구멍의 양면이다).
    for (const step of [...byStep.keys()].sort((a, b) => a - b)) {
      if (step < chain.length) continue
      violations.push(
        `${FILE}(${label}): 마디 ${step} 이 사슬 길이(${chain.length})를 넘는다 — 앞에 빈 자리가 있다는 뜻이다`,
      )
    }

    for (const def of chain) {
      const at = `${FILE}[마디 ${def.step}${def.field === undefined ? '' : ` · ${def.field}`}](${label})`

      // ---- 3'. 그 마을에서 모든 칸의 슬롯이 펴지는가 ----
      const templates = [def.objective, def.announce, def.goal.arg, def.goal.count ?? '', def.catchUp?.arg ?? '']
      const unknown = templates
        .flatMap((template) => slotsUsedBy(template))
        .filter((name) => !Object.hasOwn(slots, name))
      if (unknown.length > 0) {
        violations.push(
          `${at}: 슬롯 [${[...new Set(unknown)].map((n) => `{${n}}`).join(', ')}] 을 이 마을에서 펼 수 없다 (아는 것: ${Object.keys(slots).map((n) => `{${n}}`).join(', ')})`,
        )
        continue
      }

      // ---- 1. 조건의 인자가 실재하는가 ----
      const arg = fillArg(def.goal.arg, slots)
      const targetError = goalTargetError(def.goal.kind, arg, data)
      if (targetError) violations.push(`${at}: goalKind=${def.goal.kind} 인데 ${targetError}`)

      // 실재하는 이정표를 가리키더라도 **그 이정표가 남의 계열**일 수 있다
      // (foreignReachField 참고). 참조 무결성이 통과한 뒤에만 묻는다 — 없는
      // 이정표는 위에서 이미 이름으로 말했다.
      if (!targetError && def.goal.kind === 'reach') {
        const foreign = foreignReachField(data, arg, skill, fields)
        if (foreign) {
          violations.push(
            `${at}: reach 가 ${foreign} 계열의 이정표 "${arg}" 를 가리킨다 — 이 사슬은 ${skill} 로 돈다. 그 마을 사람은 자기가 캐지도 않는 계열의 문턱을 요구받고 사슬이 그 자리에서 멈춘다. 슬롯 {계열} 로 적거나 field 칸에 그 계열을 적는다`,
          )
        }
      }

      if (def.goal.count !== undefined) {
        const count = Number(fillArg(def.goal.count, slots))
        if (!Number.isInteger(count) || count < 1) {
          violations.push(
            `${at}: goalCount 가 "${fillArg(def.goal.count, slots)}" 로 펴진다 — 1 이상의 정수여야 한다`,
          )
        }
      }

      // ---- 4. catchUp 이 단조 지표인가 ----
      if (def.catchUp) {
        try {
          const metric = toMilestoneMetric(
            def.catchUp.kind,
            fillArg(def.catchUp.arg, slots),
            at,
            CATCH_UP_FIELDS,
          )
          // `every` 가 가리키는 이정표는 표 전체가 모여야 판단할 수 있어(전방 참조)
          // 지표를 만든 뒤에 본다 — milestones.ts 가 같은 이유로 미뤄 둔 검사다.
          if (metric.kind === 'every') {
            for (const id of metric.of) {
              if (data.milestones.some((m) => m.id === id)) continue
              violations.push(`${at}: catchUpArg 가 없는 이정표 "${id}" 를 가리킨다`)
            }
          }
        } catch (err) {
          violations.push((err as Error).message)
        }
      } else if (def.discoverable) {
        // 띠에 뜨는 마디에 밀어올림이 없으면 얼음 200,000 인 테스터에게
        // 「마을 북문으로 나가라」가 뜬다 — 게임은 이미 공개돼 돌고 있고 친구들
        // 계정이 살아 있다(설계 ⑦, 실기 확인 1번). 안 보이는 마디는 밀어 올릴
        // 것이 없어도 되지만, 안내를 적는 마디는 지나쳤다고 볼 근거가 있어야 한다.
        violations.push(
          `${at}: discoverable 인데 catchUp 이 없다 — 이미 그 마디를 지나친 사람에게도 초보 안내가 뜬다. 단조 지표 문턱 하나(catchUpKind·catchUpArg·catchUpThreshold)를 적는다`,
        )
      }

      // 글 쪽도 실제로 펴 본다 — 슬롯 이름은 위에서 봤지만, 펴는 함수가 던지는지는
      // 부르기 전에는 알 수 없다(두 얼굴 중 name 쪽만 비어 있는 경우 등).
      fillText(def.objective, slots)
      fillText(def.announce, slots)
    }
  }

  return violations
}

/**
 * 이 플레이어의 사슬은 **어느 마을의 것인가**.
 *
 * 시작 마을은 어디에도 저장돼 있지 않다 — `PlayerState` 가 늘리기로 한 칸은
 * `story`·`storyCount` 둘뿐이고(설계 ⑦), 셋째를 늘리는 것은 이 아크가 안 하기로
 * 한 일이다. 그래서 세계의 생김새와 그 사람의 숫자에서 되찾는다. 순서가 곧 규칙이다:
 *
 * **① 그 계열의 숙련도.** 시작 마을을 고른다는 것은 곧 첫 숙련도를 고르는 것이고
 * (`villageField`), 그 숫자는 줄어들지 않는다. 마디 1 을 지난 사람부터는 이것 하나로
 * 답이 정해진다 — 그리고 마디 3·4·5(바칠 것 · 요구 문턱 · 레시피)가 계열을 실제로
 * 필요로 하는 것이 정확히 그 뒤다.
 *
 * **② 서 있는 자리.** ①이 못 가르는 자리는 하나뿐이다: **아직 아무것도 안 캔
 * 사람**(네 숫자가 모두 0). 그 사람은 마디 0 에 서 있고, 마디 0 은 마을 안에서
 * 시작해 채집장에서 끝나므로 그 두 맵 중 하나에 서 있다. `moveService` 가 자리를
 * 옮긴 **뒤에** 훅을 부르는 것이 이 줄과 짝이다 — 문을 넘은 사람은 이미 자기
 * 채집장에 서 있어서, 「{채집장}으로 나가라」가 방금 도착한 그 맵으로 펴진다.
 *
 * **③ 전환표 순서.** 위 둘이 다 침묵하는 경우는 하나뿐이다 — 숙련 0 인 사람이
 * 월드맵·사냥터에 서 있을 때. 그 상태에는 **이 사람이 어느 마을에서 났는지를 말해
 * 주는 정보가 세계 어디에도 없다.** 유도의 한계가 아니라 정보가 없는 것이고, 그래서
 * 여기서는 답을 지어내는 대신 늘 같은 답(전환표에 먼저 적힌 마을)을 낸다. 그 사람이
 * 자기 마을로 돌아오는 순간 ②가 답을 바로잡는다.
 *
 * 되돌아오는 대가도 정직하게 적는다: 얼음으로 시작해 나무를 더 캔 사람은 ①이
 * 숲의마을을 가리킨다. 사슬이 3.5분짜리이고(설계 ③) 그 안에서 남의 계열을 자기
 * 계열보다 많이 캘 방법이 없으므로 아크 1 에서는 일어나지 않는다. 아크 2 의 마디
 * (`discoverable=false`)까지 사슬이 길어지면 그때는 답이 흔들릴 수 있고, 그 값이
 * 셋째 상태 필드보다 비싸지는 날 필드를 늘리면 된다.
 */
export function storyVillage(data: GameData, player: PlayerState): MapDef {
  const chains = startVillages(data).map((village) => ({
    village,
    field: villageField(data, village.id),
  }))

  // ① 그 계열의 숙련도 — 최고를 가진 마을만 남긴다. 하나면 그것이 답이다.
  const top = Math.max(...chains.map((c) => player.skills[c.field.skill]))
  const leaders = chains.filter((c) => player.skills[c.field.skill] === top)

  // ② 남은 것이 여럿이면(아직 아무것도 안 캔 사람은 넷이 다 0 이다) 서 있는 자리 —
  //    마을이거나 그 마을의 채집장이거나.
  const here = leaders.find(
    (c) => c.village.id === player.location.mapId || c.field.map.id === player.location.mapId,
  )

  // ③ 그것도 침묵하면 정보가 없다. 지어내지 않고 늘 같은 답을 낸다.
  return (here ?? leaders[0]!).village
}

/** 날것 한 행의 슬롯을 그 마을 값으로 편다. */
function resolveStep(def: StoryStepDef, slots: StorySlots, ctx: string): StoryStep {
  const goal: StoryGoal = { kind: def.goal.kind, arg: fillArg(def.goal.arg, slots) }
  // 펴고 나서 수가 된다 — 정수인지는 빌드가 마을마다 이미 봤다(validateStory).
  if (def.goal.count !== undefined) goal.count = Number(fillArg(def.goal.count, slots))

  const step: StoryStep = {
    step: def.step,
    objective: fillText(def.objective, slots),
    goal,
    announce: fillText(def.announce, slots),
    discoverable: def.discoverable,
  }
  if (def.catchUp) {
    step.catchUp = {
      metric: toMilestoneMetric(def.catchUp.kind, fillArg(def.catchUp.arg, slots), ctx, CATCH_UP_FIELDS),
      threshold: def.catchUp.threshold,
    }
  }
  return step
}

/**
 * 이 플레이어가 실제로 걷는 사슬 — 마을이 정해지고 슬롯이 다 펴진 것.
 *
 * **색인이 곧 마디 번호다**(`chain[player.story]`). 그 등식을 지키는 것은 여기
 * 정렬 한 줄이 아니라 빌드다 — `validateStory` 가 계열마다 `step` 이 0 부터
 * 빈틈없이 연속인지 보고, 비면 빌드가 선다.
 *
 * **표가 비면 여기서 끝난다.** 마디를 아직 안 쓴 오늘(Q3 전)이 그 상태이고, 그때
 * 마을을 유도하는 것은 답 없는 계산일 뿐 아니라 **비용**이다 — 훅은 채집마다
 * 도는 자리다. 그리고 이 한 줄이 있어서, 세계를 두 칸짜리 리터럴로 짓는 서비스
 * 테스트들이 `startVillages` 의 "월드맵에서 나가는 전환이 하나도 없다" 에
 * 걸리지 않는다.
 *
 * 띠(설계 ⑧-6)도 이 함수를 부른다 — 화면이 적는 목적과 서버가 재는 목적이 같은
 * 자리에서 나와야 「얼음 조각 200개」를 적어 놓고 다른 것을 세는 날이 없다.
 */
export function storyChainOf(data: GameData, player: PlayerState): StoryStep[] {
  if (data.story.length === 0) return []

  const village = storyVillage(data, player)
  const slots = storySlots(data, village.id)
  const skill = villageField(data, village.id).skill

  return chainOf(data.story, skill)
    .slice()
    .sort((a, b) => a.step - b.step)
    .map((def) => resolveStep(def, slots, `${FILE}[마디 ${def.step}](${skill}(${village.id}))`))
}

/**
 * 판정 훅 하나 — **서비스가 부르는 한 줄**(설계 ⑧-4).
 *
 * 사슬을 이 플레이어의 것으로 펴서 `advanceStory`(packages/shared)에게 넘긴다.
 * 판정 규칙이 shared 에 있고 마을 유도가 여기 있는 이유는 `villageField` 가 여기
 * 있는 이유와 같다 — 규칙은 세계 데이터를 향해 의존하지 않는다.
 *
 * `player` 를 제자리에서 고친다(advanceStory 문서). 부르는 자리는 전부
 * `structuredClone` 뒤의 사본을 들고 있는 서비스다.
 */
export function runStoryHook(
  data: GameData,
  player: PlayerState,
  event: StoryEvent | null,
): StoryAdvance {
  return advanceStory({ chain: storyChainOf(data, player), player, world: data, event })
}
