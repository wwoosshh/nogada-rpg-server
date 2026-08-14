import type {
  Condition,
  DialogueRule,
  FactValue,
  GameData,
  GatherTables,
  ItemDef,
  MapDef,
  MilestoneDef,
  SkillId,
} from '@nogada/shared'
import {
  COLLECTION_MAX_GRADE,
  EVENT_ORDER,
  NODE_VARIANTS,
  ONCE_EVENTS,
  SKILL_IDS,
  actionIntervalMs,
  barrierDoorsOf,
  describeFactValueShape,
  factValueFitsShape,
  findFactSpec,
  isSellTarget,
  matchesCondition,
  sellPrice,
  starterToolCandidates,
} from '@nogada/shared'
import { dialogueLocation } from './dialogueParse.js'
import { suffixOfVariant, variantOfTableId } from './gatherTables.js'
import { startVillages, villageField } from './maps.js'
import type { MapTerrain } from './placements.js'

/**
 * 조건 하나를 작가가 파일에 쓴 모양 그대로 되살린다 — 메시지에서 눈으로 찾을 수 있게.
 *
 * export 하는 이유는 content-cli.ts(시뮬레이터)도 조건을 똑같은 모양으로 화면에
 * 보여줘야 해서다 — 검증 메시지와 시뮬레이터 출력이 조건을 다른 글자로 적으면
 * 작가가 같은 것을 가리키는지 매번 다시 확인해야 한다.
 */
export function conditionText(condition: Condition): string {
  return `${condition.fact}${condition.op}${condition.value}`
}

/**
 * 조건이나 시뮬레이터 인자가 **없는 이정표·기술·지점**을 가리킬 때의 설명.
 *
 * 이유와 허용 목록을 나눠 담는 것은 두 부르는 쪽이 쓸 곳이 달라서다 — 빌드
 * 위반 메시지는 이미 파일과 행을 앞에 달고 있어 `reason` 한 문장이면 되고,
 * 명령줄에서 거절할 때는 "그럼 뭘 쓰면 되나"까지 그 자리에서 말해야 한다.
 */
export interface FactReferenceError {
  reason: string
  /** 무엇이면 되는가 — 목록이 짧으면 나열하고, 길면 어느 파일을 보면 되는지. */
  allowed: string
}

/**
 * 사실 이름·값이 실재하는 이정표·기술·지점을 가리키는지 본다. 맞으면 null.
 *
 * 빌드(validateGameData)와 시뮬레이터(content-cli.ts)가 이 함수 하나를 함께
 * 쓴다. 나눠 구현하면 한쪽이 무르게 되는데, 무른 쪽이 하필 디버깅 도구면
 * 작가는 빌드가 절대 허락하지 않을 세계 상태로 대사를 확인하면서 그 사실을
 * 모른다 — 도구가 자신 있게 틀린 답을 내는 가장 나쁜 모양이다.
 *
 * `justAchieved` 는 이름이 아니라 **값**으로 이정표를 부른다(justAchieved=
 * ice_10000). 그래서 값을 안 보면 오타가 조건 이름 검사도 사실 이름 검사도
 * 전부 통과해, "왜 이 대사가 안 나오지"만 남는다.
 */
export function factReferenceError(fact: string, value: FactValue, data: GameData): FactReferenceError | null {
  const milestoneExists = (id: string): boolean => data.milestones.some((m) => m.id === id)
  const milestoneHint = '이정표 id 는 csv/milestones.csv 에 있는 것이어야 한다'

  if (fact === 'justAchieved') {
    const id = String(value)
    if (milestoneExists(id)) return null
    return { reason: `justAchieved 가 존재하지 않는 이정표 "${id}" 를 가리킨다`, allowed: milestoneHint }
  }

  if (fact.startsWith('milestone.')) {
    const id = fact.slice('milestone.'.length)
    if (milestoneExists(id)) return null
    return { reason: `존재하지 않는 이정표 "${id}" 를 가리킨다`, allowed: milestoneHint }
  }

  if (fact.startsWith('skill.')) {
    const id = fact.slice('skill.'.length)
    if ((SKILL_IDS as readonly string[]).includes(id)) return null
    return { reason: `존재하지 않는 기술 "${id}" 를 가리킨다`, allowed: `쓸 수 있는 기술: ${SKILL_IDS.join(', ')}` }
  }

  // place 도 justAchieved 처럼 **값**으로 무언가를 부른다 — 지점 id 다. 지점
  // 이름은 맵 파일 안에 한국어로 적혀 있어서 오타가 나기 쉬운데, 안 막으면 그
  // 조건은 어떤 시각에도 안 맞는 조용한 죽은 대사가 된다("place 라는 사실은
  // 있다"까지는 맞으니 이름 검사도 통과한다).
  if (fact === 'place') {
    const id = String(value)
    if (Object.hasOwn(data.places, id)) return null
    return {
      reason: `place 가 존재하지 않는 지점 "${id}" 를 가리킨다`,
      allowed: '지점 id 는 맵 파일(maps/*.tmx)의 places 오브젝트 레이어에 찍힌 이름이어야 한다',
    }
  }

  return null
}

/**
 * "한 번만 하는 말에 `=` 아닌 연산자를 썼다"를 무엇으로 고쳐 쓰면 되는지.
 *
 * 막기만 하는 검사와 고쳐 쓰는 법까지 말하는 검사는 작가에게 전혀 다른
 * 물건이다. 특히 `skill.ice>=50000` 은 작가가 잘못 생각해서 쓴 것이 아니라
 * **그 뜻을 적는 옳은 방법을 아직 모르는 것**이라, 규칙만 거절하면 "그럼
 * 숙련도 문턱 대사는 못 쓰는 건가"로 읽힌다. 실제로는 쓸 수 있고 이정표가 그
 * 자리다 — 이정표는 한 번 넘기면 되돌아가지 않아(packages/shared 의 이정표
 * 판정) 값이 하나로 고정된다.
 *
 * 그 문턱을 이미 선언한 이정표가 데이터에 있으면 id 까지 짚어 준다. 없으면
 * 이름을 지어내지 않는다 — 없는 이정표 id 를 권하면 그 조건은 이번엔 "존재하지
 * 않는 이정표" 위반으로 다시 막히고, 작가는 빌드가 시킨 대로 했는데 또 막히는
 * 경험을 한다.
 */
function onceRewriteHint(condition: Condition, data: GameData): string {
  const moveToGreet =
    '범위 그대로 말하고 싶으면 이 규칙을 @greet 으로 옮긴다 — @greet 만 매번 다시 후보에 올라서 어떤 연산자든 쓸 수 있다'

  if (condition.fact.startsWith('skill.') && typeof condition.value === 'number') {
    const skill = condition.fact.slice('skill.'.length)
    const milestone = data.milestones.find(
      (m) => m.metric.kind === 'skill' && m.metric.skill === skill && m.threshold === condition.value,
    )
    const instead = milestone
      ? `"milestone.${milestone.id}=true" 로 바꾼다`
      : '그 문턱을 csv/milestones.csv 에 이정표로 먼저 적고 "milestone.<그 id>=true" 로 건다'
    return `숙련도 문턱은 이정표로 적는다 — ${instead}. 이정표는 한 번 넘기면 되돌아가지 않아 값이 하나로 고정되고, 그래서 그 말이 정확히 한 번 나온다. ${moveToGreet}`
  }

  return `값을 하나로 못박는 = 로 바꾼다. ${moveToGreet}`
}

const LOWER_OPS: ReadonlySet<string> = new Set(['>', '>='])
const UPPER_OPS: ReadonlySet<string> = new Set(['<', '<='])

/**
 * 정확한 값 하나를 못박은 조건이, 같은 사실의 다른 조건을 만족시키지 못하는가.
 *
 * 판정은 matchesCondition(게임이 실제로 쓰는 함수)에 그 값을 그대로 넣어 본다 —
 * 여기서 비교 규칙을 다시 구현하면 엔진과 검증이 갈라질 수 있다.
 *
 * 양쪽이 다 숫자일 때만 본다. 문자열에 크기 비교를 건 조건(`season>3`)은
 * 그것 하나만으로 이미 절대 참이 아니지만, 그건 "두 조건이 어긋난다"가 아니라
 * "조건 하나의 값 형태가 틀렸다"는 다른 부류다 — 이제 값 모양 검사가 따로
 * 잡는다(아래 대화 검사의 factValueFitsShape, 설계 문서 7장).
 */
function pinnedValueFails(pinned: Condition, other: Condition): boolean {
  if (typeof pinned.value !== 'number' || typeof other.value !== 'number') return false
  return !matchesCondition(other, { [other.fact]: pinned.value })
}

/**
 * 두 조건이 같은 사실에 걸려 있으면서, 어떤 값도 둘을 동시에 만족시킬 수 없는가.
 *
 * 여기서 다루는 것은 **한 규칙 안의 두 조건**뿐이다. 세 개를 엮어야 비는
 * 경우(`>=5` `<=5` `!=5`)나 서로 다른 사실 사이의 함의는 보지 않는다 —
 * 좁은 범위에서 확실히 맞는 검사가, 넓은 범위를 추측하는 검사보다 낫다.
 * 작가에게 오탐 하나는 그것이 막아 준 진짜 오류보다 비싸다.
 */
function contradicts(a: Condition, b: Condition): boolean {
  if (a.fact !== b.fact) return false

  // 정확한 값끼리 어긋난다: season=spring season=summer
  if (a.op === '=' && b.op === '=') return a.value !== b.value

  // 같은 값을 요구하면서 동시에 아니라고 한다: quest.촌장=3 quest.촌장!=3
  if (a.op === '=' && b.op === '!=') return a.value === b.value
  if (a.op === '!=' && b.op === '=') return a.value === b.value

  // 한쪽이 값을 못박았으면 그 값을 다른 조건에 그대로 넣어 본다: skill.ice=100 skill.ice>=200
  if (a.op === '=') return pinnedValueFails(a, b)
  if (b.op === '=') return pinnedValueFails(b, a)

  // 아래 방향(>,>=)과 위 방향(<,<=)이 만드는 구간이 비었는가: skill.ice>=100 skill.ice<50
  const lower = LOWER_OPS.has(a.op) ? a : LOWER_OPS.has(b.op) ? b : null
  const upper = UPPER_OPS.has(a.op) ? a : UPPER_OPS.has(b.op) ? b : null
  if (!lower || !upper) return false
  if (typeof lower.value !== 'number' || typeof upper.value !== 'number') return false
  if (lower.value > upper.value) return true
  // 양 끝이 같은 값이면, 양쪽 다 그 값을 포함할 때만(>= 와 <=) 살아남는다.
  return lower.value === upper.value && !(lower.op === '>=' && upper.op === '<=')
}

/** findDeadDialogueRules 가 찾아낸 모순 하나 — 규칙과 서로 어긋나는 조건 두 개. */
export interface DeadDialogueRule {
  rule: DialogueRule
  a: Condition
  b: Condition
}

/**
 * 자기 조건끼리 어긋나 **어떤 세계 상태에서도 나오지 않는** 규칙을 찾는다.
 *
 * validateGameData(빌드 실패)와 content-cli.ts 의 `dead` 명령(시뮬레이터 보고)이
 * 이 함수 하나를 함께 부른다 — 계산을 두 곳에 나눠 두면 언젠가 갈라져서, 빌드는
 * 통과했는데 시뮬레이터는 죽었다고 말하는(또는 그 반대인) 상황이 생긴다.
 *
 * "다른 규칙에 가려진다"는 이유로는 죽었다고 말하지 않는 것에 유의한다.
 * selectDialogue 는 **맞은 규칙들 안에서만** 조건 개수를 비교하므로, 조건이
 * 적은 규칙은 조건이 많은 형제가 함께 맞는 순간에만 지고 나머지 시간에는
 * 그대로 나온다 — 그게 폴백이고, 설계 문서 §5 가 작가에게 보여주는 대표
 * 패턴이다(설계 문서 §7). 부분집합이라는 이유로 죽었다고 말하려면 "더 많은
 * 그 조건들이 항상 참"임을 알아야 하는데, 그건 논리적 함의를 따져야 하는
 * 다른 일이라 이 함수는 다루지 않는다 — 여기서 잡는 것은 한 규칙 안에서
 * 함의 없이도 확실한 자기모순뿐이다.
 *
 * 규칙 하나에 모순 쌍이 여럿이면 전부 반환한다 — 작가가 하나만 고치고 다시
 * 돌렸을 때 남은 모순을 못 보는 것을 막기 위해서다.
 */
export function findDeadDialogueRules(dialogue: readonly DialogueRule[]): DeadDialogueRule[] {
  const dead: DeadDialogueRule[] = []
  for (const rule of dialogue) {
    for (let i = 0; i < rule.conditions.length; i++) {
      for (let j = i + 1; j < rule.conditions.length; j++) {
        const a = rule.conditions[i]!
        const b = rule.conditions[j]!
        if (contradicts(a, b)) dead.push({ rule, a, b })
      }
    }
  }
  return dead
}

/**
 * 맵에 놓인 노드의 표에서 출발해 레시피 폐포까지 확장한 "도달 가능한 아이템" 집합.
 *
 * - 채집: **맵에 놓인 노드의 표 아이템은 무조건 도달 가능하다**(§6-앞 7 — 3차
 *   재작성). 도구 게이트가 폐지되어 맨손이 모든 노드를 열므로 "그 기술의 도구가
 *   도달 가능한가"(구 hasCoveringTool)는 더 이상 조건이 아니고, 도구 시드(구
 *   STARTING_TOOL_IDS)도 함께 은퇴했다. 등급·브라켓을 보지 않는 이유는 그대로다:
 *   등급은 접근이 아니라 확률 보정이고, 브라켓은 숙련도의 함수인데 숙련은 성패
 *   무관 매 시도 오르므로 그라인딩으로 언젠가 항상 닿는다(최상 티어의 잭팟은
 *   숙련 0부터 열려 있기까지 하다). 놓이지 않은 노드는 세지 않는다 — 게임에
 *   없는 노드이고, 그 결손 자체는 배치 검사("맵 어디에도 놓이지 않았다")가
 *   먼저 말한다.
 * - 레시피: 재료(inputs)가 전부 도달 가능해지면 산출물이 도달 가능해진다.
 *
 * 제작 숙련도는 일부러 보지 않는다 — 조합 숙련도는 `craftService` 의 성공
 * 경로에서만 오르고, 그 성공 경로 자체가 `canCraft` 의 requiredSkill 게이트
 * 뒤에 있다. 즉 숙련도를 올리려면 이미 그 레시피를 열 숙련도가 있어야 하는
 * 순환이라, "그라인딩하면 언젠가 도달한다"는 채집과 달리 제작에는 그냥
 * 성립하지 않는다. 이 함수가 그래도 requiredSkill 을 보지 않아도 되는 이유는,
 * 스킬마다 requiredSkill 0 인 레시피가 최소 하나 있어야 한다는 것을 별도
 * 규칙(아래 validateGameData)이 보장하기 때문이다 — 그 보장이 없으면 이
 * fixpoint 는 아이템 참조 사슬만 보고 "도달 가능"이라 오판한다.
 */
function computeReachableItems(data: GameData, gatherTables: GatherTables): Set<string> {
  const reachable = new Set<string>()

  // 상점 진열은 노드 표와 같은 자격의 시드다(§6-앞 12). 매수는 골드를 요구하지만
  // 골드는 캔 것을 팔면 나오고, 진열의 문턱도 숙련도이거나 수집 총점이라 둘 다
  // 그라인딩으로 언젠가 닿는다(총점은 캔 것을 바치면 오르고, 바칠 것은 채집물이라
  // 이미 이 집합 안에 있다) — "언젠가 항상 닿는다"는 점에서 브라켓과 같은 성질이라
  // 조건으로 세지 않는다. 이 시드가 없으면 증표 8종처럼 **오직 사는 것**인 물건이
  // 전부 도달 불가로 잡혀, 설계가 의도한 데이터가 빌드를 세운다.
  for (const shop of Object.values(data.shops)) {
    for (const entry of shop.stock) reachable.add(entry.itemId)
  }

  const placedNodeIds = new Set(Object.values(data.placements).map((placement) => placement.nodeId))
  for (const node of Object.values(data.nodes)) {
    if (!placedNodeIds.has(node.id)) continue
    // 없는 표를 가리키는 노드는 참조 검사가 이미 잡았고, 참조 위반이 있으면
    // 이 계산 자체가 돌지 않는다(아래 조기 반환) — 그래도 이 함수는 그 경로를
    // 거치지 않은 데이터로 불릴 수 있으니 조용히 건너뛴다.
    const table = gatherTables[node.tableId]
    if (!table) continue
    for (const tier of table.tiers) reachable.add(tier.itemId)
  }

  // 노드 시드는 위에서 한 번에 끝났다 — 반복이 필요한 것은 레시피 폐포뿐이다
  // (산출물이 다른 레시피의 재료가 되는 사슬).
  let changed = true
  while (changed) {
    changed = false
    for (const recipe of Object.values(data.recipes)) {
      if (reachable.has(recipe.output.item)) continue
      const allInputsReachable = recipe.inputs.every((input) => reachable.has(input.item))
      if (allInputsReachable) {
        reachable.add(recipe.output.item)
        changed = true
      }
    }
  }

  return reachable
}

/**
 * every 이정표들이 서로를 가리키는 방향 그래프에서 순환을 찾는다.
 *
 * isAchieved 가 metricValue 를 부르고, metricValue 는 every 의 각 원소마다 다시
 * isAchieved 를 부른다(packages/shared/src/milestones.ts) — 그 재귀에는 방문 집합이
 * 없으므로 순환이 하나라도 있으면 그 함수들이 무한 재귀로 죽는다. 오늘은 이 함수들을
 * 부르는 곳이 테스트뿐이라 드러나지 않지만, 실제 채집·제작 경로에 연결되는 순간
 * 순환 데이터 하나가 그대로 서버를 죽인다 — 그래서 여기서 미리 막는다.
 *
 * 발견한 첫 순환의 경로만 보고한다. 여러 개를 전부 찾아도 고칠 곳은 데이터 한 군데다.
 */
function findEveryCycle(milestones: readonly MilestoneDef[]): string | null {
  const byId = new Map(milestones.map((m) => [m.id, m] as const))
  const state = new Map<string, 'visiting' | 'done'>()

  function visit(id: string, path: readonly string[]): string | null {
    const status = state.get(id)
    if (status === 'done') return null
    if (status === 'visiting') return [...path, id].join(' → ')

    const def = byId.get(id)
    if (!def) {
      state.set(id, 'done')
      return null
    }
    const metric = def.metric
    if (metric.kind !== 'every') {
      state.set(id, 'done')
      return null
    }

    state.set(id, 'visiting')
    for (const ref of metric.of) {
      const found = visit(ref, [...path, id])
      if (found) return found
    }
    state.set(id, 'done')
    return null
  }

  for (const milestone of milestones) {
    if (milestone.metric.kind !== 'every') continue
    const found = visit(milestone.id, [])
    if (found) return found
  }
  return null
}

/**
 * 참조 무결성과 도달 가능성을 검사한다.
 * 위반 목록을 반환하며 빈 배열이면 통과다.
 *
 * 수천 행 CSV의 오타를 런타임이 아니라 빌드 타임에 잡는 것이 목적이다.
 *
 * `gatherTables` 를 따로 받는 이유: 확률표는 GameData 에 싣지 않지만(클라이언트
 * 번들 금지, 설계 §7-앞 9) 노드가 표를, 표가 아이템을 가리키므로 도달 가능성은
 * 양쪽을 다 봐야 계산된다. 표 자체의 검사(누적 순증가, ∞ 브라켓 등)는
 * validateGatherTables(gatherTables.ts)의 몫이다.
 */
export function validateGameData(data: GameData, gatherTables: GatherTables): string[] {
  const violations: string[] = []
  const hasItem = (id: string): boolean => Object.hasOwn(data.items, id)

  // 놓이지 않은 노드는 데이터에만 있고 게임에는 없다 — 플레이어가 닿을 방법이
  // 아예 없으므로, CSV에 행을 추가하고 맵에 놓는 것을 잊은 경우를 빌드 타임에 잡는다.
  const placedNodeIds = new Set(Object.values(data.placements).map((p) => p.nodeId))

  for (const node of Object.values(data.nodes)) {
    // 없는 표를 가리키는 노드는 참조 위반이다 — 아래 도달 가능성 검사가 그 표의
    // 아이템 목록을 읽으므로, 여기서 잡아야 오타 하나가 "그 표의 아이템 전부
    // 도달 불가" 라는 그림자 위반으로 불어나지 않는다(조기 반환의 대상).
    if (!Object.hasOwn(gatherTables, node.tableId)) {
      violations.push(
        `nodes[${node.id}]: 존재하지 않는 표 "${node.tableId}" 를 가리킨다 — gather_tables.csv 의 tableId 중 하나여야 한다`,
      )
    }
    // variant 와 tableId 는 한 가지를 말하는 두 칸이다. **이 짝의 출처는 결계
    // 계획 B2 의 마지막 항목**("`variant='deep'` ⟺ `tableId` 가 `*_deep`")이고
    // 설계의 §9-앞 규범이 아니다 — 이 줄은 오래 "§9-앞 5" 로 적혀 있었는데 그
    // 번호는 전수 시뮬의 표 목록 하드코딩 얘기다.
    //
    // 이 아크 전까지 variant 는 채집 티어 스펙이 스스로 적어 둔 대로 "표시 전용"
    // 이었고, 그 대가로 심층 노드 넷이 이름과 겉모습만 심층인 채 바깥과 **같은
    // 표**를 굴렸다. 표가 갈라진 지금 이 짝이 다시 갈라지면 맵에는 심층 그림이
    // 서는데 분포는 바깥이거나 그 반대인데, **어느 화면에서도 되짚을 수
    // 없다** — 확률표는 서버 전용이라 사람이 눈으로 대조할 곳조차 없다.
    // 그래서 두 칸이 아니라 한 규칙이 되게 묶는다.
    //
    // **등급이 2값에서 3값이 되면서 이 검사의 모양이 바뀌었다.** 옛 한 줄은
    // `isDeepTableId(tableId) !== (variant === 'deep')` 이었는데, 그것은
    // `variant='special'` + 접미사 없는 표를 **양쪽 다 false** 로 읽어 통과시킨다 —
    // 부등식이라 등급이 늘어난 만큼 새는 자리가 늘어난다. 아크 A 가 노드에 그림을
    // 달았으므로 그 거짓말은 이제 화면에서 보인다(붉은 얼음 광맥이 보통 얼음을 준다).
    // 그래서 전사 함수를 부르는 **등식**으로 바꾼다: 등급이 넷째로 늘어나도 이 줄은
    // 그대로 옳다.
    const tableVariant = variantOfTableId(node.tableId)
    if (tableVariant !== node.variant) {
      // 접미사 문자열을 여기서 알지 않는다 — 전사 함수만 부른다. 그래야 고칠 자리를
      // 일러 주는 이 문장이 접미사가 바뀌는 날 함께 따라온다.
      const base = node.tableId.slice(0, node.tableId.length - suffixOfVariant(tableVariant).length)
      const suggested = `${base}${suffixOfVariant(node.variant)}`
      const menu = NODE_VARIANTS.map(
        (v) => `${v} → ${suffixOfVariant(v) === '' ? '접미사 없음' : `"${suffixOfVariant(v)}"`}`,
      ).join(', ')
      violations.push(
        // 영문 식별자에 조사를 직접 붙이면 받침 유무로 문법이 어긋나므로
        // (ice 는 "다", mineral 은 "이다") 괄호로 감싸고 조사는 한국어 낱말에 붙인다.
        // 고칠 자리를 일러 주는 끝 문장이 "쪽에 맞추거나"·"처럼"인 것도 같은 이유다 —
        // 등급 이름과 표 id 에 조사가 직접 닿지 않는다.
        `nodes[${node.id}]: variant("${node.variant}") 와 tableId("${node.tableId}") 가 짝이 아니다 — 등급마다 표 접미사가 하나씩 정해져 있는데(${menu}) 이 tableId 는 "${tableVariant}" 등급의 표다. 갈라지면 노드 그림과 실제 분포가 어긋나는데, 그 어긋남은 어느 화면에서도 되짚을 수 없다. nodes.csv 에서 variant 를 "${tableVariant}" 쪽에 맞추거나 tableId 를 "${suggested}" 처럼 적는다`,
      )
    }
    if (!placedNodeIds.has(node.id)) {
      violations.push(`nodes[${node.id}]: 맵 어디에도 놓이지 않았다`)
    }
  }

  for (const recipe of Object.values(data.recipes)) {
    for (const input of recipe.inputs) {
      if (!hasItem(input.item)) {
        violations.push(`recipes[${recipe.id}]: 존재하지 않는 재료 "${input.item}" 를 요구한다`)
      }
      if (input.item === recipe.output.item) {
        violations.push(`recipes[${recipe.id}]: 산출물을 자기 재료로 쓴다`)
      }
    }
    if (!hasItem(recipe.output.item)) {
      violations.push(`recipes[${recipe.id}]: 존재하지 않는 아이템 "${recipe.output.item}" 를 산출한다`)
    }
    if (recipe.baseChance <= 0 || recipe.baseChance >= 1) {
      violations.push(`recipes[${recipe.id}]: baseChance 가 0 초과 1 미만이 아니다`)
    }
    if (recipe.skillGainMin > recipe.skillGainMax) {
      violations.push(`recipes[${recipe.id}]: skillGainMin 이 skillGainMax 보다 크다`)
    }
    // 문턱의 계열과 산출물의 계열은 같은 한 가지를 말하는 두 칸이다(§6-앞 9·17):
    // "이건 얼음 계열의 물건이라 얼음을 캔 사람이 만들고 얼음 상점이 사 준다".
    // 둘이 갈라져도 어느 화면 하나 이상해지지 않는 것이 이 검사가 있는 이유다 —
    // 문은 문대로 열리고, 죽은 아이템 검사는 팔 곳이 있으니 통과시킨다. 남는
    // 것은 "나무를 5만 캐야 열리는데 얼음 상점만 사 주는 물건" 하나뿐이고, 그
    // 어긋남은 두 CSV 를 나란히 놓고 봐야만 보인다. 출하 데이터는 지금 이 짝을
    // 열 레시피 전부에서 지키고 있고, 이 검사가 그것을 못박는다.
    //
    // 문턱이 없으면 묻지 않는다 — 도구처럼 계열이 없는 산출물이 정상인 레시피가
    // 있고(도구는 애초에 팔리지 않는다), 문이 없으면 어긋날 두 칸도 없다.
    const gated = recipe.gateSkill
    if (gated !== undefined && hasItem(recipe.output.item)) {
      const output = data.items[recipe.output.item]!
      if (output.skill !== gated) {
        const outputLine = output.skill ? `${output.skill} 계열이다` : '계열(skill)이 없다'
        violations.push(
          `recipes[${recipe.id}]: 문턱은 ${gated} 계열인데 산출물 "${output.name}" ${output.skill ? '는' : '에'} ${outputLine} — 그 계열 상점만 사 주므로(§6-앞 17) 문을 연 계열과 팔 곳이 갈라진다. recipes.csv 의 gateSkill 이나 items.csv 의 skill 중 하나를 고친다`,
        )
      }
    }
  }

  // 조합 숙련도는 craftService 의 성공 경로에서만 오르고, 그 성공 경로 자체가
  // canCraft 의 requiredSkill 게이트 뒤에 있다 — 그라인딩으로 숙련도를 올리려면
  // 이미 그 레시피를 열 숙련도가 있어야 하는 순환이다. 스킬마다 requiredSkill 0 인
  // 레시피가 하나도 없으면 그 숙련도는 영원히 0에 머물러 어떤 레시피도 못 연다.
  // 이 상태는 위 도달 가능성 계산으로는 잡히지 않는다 — 그 계산은 아이템 참조
  // 사슬만 보고 requiredSkill 은 아예 보지 않기 때문이다.
  //
  // 계열 문턱(gateValue, §6-앞 9)이 걸린 레시피는 requiredSkill 이 0 이라도
  // 부트스트랩이 아니다 — 그 문은 채집 숙련 N 을 요구하므로 "처음부터 열려
  // 있는 문"이 아니다. 세지 않으면 조합 0 짜리 문이 전부 문턱 뒤로 옮겨간 날
  // 이 검사가 초록인 채로 숙련도가 영원히 0 에 갇힌다.
  const skillsUsedByRecipes = new Set(Object.values(data.recipes).map((recipe) => recipe.skill))
  for (const skill of skillsUsedByRecipes) {
    const hasBootstrapRecipe = Object.values(data.recipes).some(
      (recipe) => recipe.skill === skill && recipe.requiredSkill === 0 && recipe.gateValue === undefined,
    )
    if (!hasBootstrapRecipe) {
      violations.push(
        `skills[${skill}]: requiredSkill 0 이면서 계열 문턱도 없는 레시피가 없어 영원히 부트스트랩할 수 없다`,
      )
    }
  }

  // 시작 도구는 상수가 아니라 유도다(§6-앞 8): 캐릭터 생성(createInitialPlayer)은
  // villageField(마을).skill 에 대해 starterToolFor 가 유도한 "1티어 ∧ 그 기술"
  // 도구 하나를 지급한다. 유도가 성립하려면 채집 기술(노드가 존재하는 기술)마다
  // 그런 도구가 **정확히 하나**여야 하고 — 없으면 그 마을의 캐릭터 생성이
  // 런타임에 던지고, 둘이면 무엇을 줄지 정해지지 않는다 — 그 도구에
  // requiredSkill 0 레시피가 있어야 한다: 자기 마을 것이 아닌 도구를 손에 넣는
  // 길이 그 레시피뿐이기 때문이다(§2 의 부트스트랩 경로). 후보를 세는 술어는
  // 지급이 쓰는 starterToolCandidates 그대로다 — 결손이 캐릭터 생성 런타임이
  // 아니라 여기(빌드)에서 터지는 것이 이 검사의 존재 이유다.
  const gatheringSkills = new Set(Object.values(data.nodes).map((node) => node.skill))
  for (const skill of gatheringSkills) {
    const candidates = starterToolCandidates(skill, data.items)
    if (candidates.length !== 1) {
      const ids = candidates.map((tool) => tool.id).join(',')
      violations.push(
        `skills[${skill}]: 1티어 도구가 정확히 하나여야 하는데 [${ids}](${candidates.length}개)다 — 시작 지급(starterToolFor)이 그 하나를 마을 도구로 유도한다. items.csv 의 toolTier·toolSkill 을 정리한다`,
      )
      continue
    }
    const starter = candidates[0]!
    // 문턱(gateValue)이 걸린 레시피는 "공짜 레시피"가 아니다 — 남의 마을 도구를
    // 만들려고 그 계열을 먼저 1,000 캐야 한다면, 그 도구로 캐려던 계열이 바로
    // 그 계열인 경우 부트스트랩이 다시 순환한다.
    const hasFreeRecipe = Object.values(data.recipes).some(
      (recipe) =>
        recipe.output.item === starter.id && recipe.requiredSkill === 0 && recipe.gateValue === undefined,
    )
    if (!hasFreeRecipe) {
      violations.push(
        `items[${starter.id}]: ${skill} 의 시작 도구인데 requiredSkill 0 이면서 계열 문턱도 없는 레시피가 없다 — 다른 마을에서 시작한 사람이 이 도구를 영원히 얻지 못한다. recipes.csv 에 requiredSkill 0·문턱 없는 레시피를 둔다`,
      )
    }
  }

  // ---- 등록부 참조(설계 §4·§6-앞 1·2·14) ----
  //
  // 상점과 달인 대금은 대사가 아니라 등록부가 소유한다. 그 대가로 등록부는 화자·
  // 아이템을 **이름으로** 가리키므로, 오타가 나면 증상이 전부 화면에서 원인을
  // 되짚을 수 없는 모양이 된다("말은 걸리는데 가게가 안 열린다"). 아래 검사가
  // 획득 가능 검사보다 앞에 오는 이유: 진열의 아이템 오타는 그 아이템이 획득
  // 불가로도 잡히는데, 원인 한 줄이 결과보다 먼저 인쇄되어야 한다.
  const shopOfSpeaker = new Map<string, string>()
  for (const shop of Object.values(data.shops)) {
    if (!Object.hasOwn(data.speakers, shop.speakerId)) {
      violations.push(
        `shops[${shop.id}]: 없는 화자 "${shop.speakerId}" 를 가리킨다 — speakers.csv 의 id 중 하나여야 한다`,
      )
    }
    // talkService 는 speakerId 로 상점을 찾는다(§6-앞 1) — 한 화자에 둘이면 어느
    // 쪽이 열릴지 정해지지 않고, 그 선택은 레코드 순회 순서라는 아무 뜻 없는 것에
    // 걸린다.
    const owner = shopOfSpeaker.get(shop.speakerId)
    if (owner) {
      violations.push(
        `shops[${shop.id}]: 화자 "${shop.speakerId}" 는 이미 상점 "${owner}" 을 연다 — 한 화자가 두 상점을 열 수는 없다`,
      )
    } else {
      shopOfSpeaker.set(shop.speakerId, shop.id)
    }
    for (const entry of shop.stock) {
      const stockedItem = data.items[entry.itemId]
      if (!stockedItem) {
        violations.push(
          `shops[${shop.id}]: 없는 아이템 "${entry.itemId}" 를 진열한다 — items.csv 의 id 중 하나여야 한다`,
        )
        continue
      }
      // 진열이 도구를 가리키면 안 된다(E4 가 남긴 구멍): tradeService.performBuy 는
      // 무엇을 사든 player.stacks 에 넣는데, 가방(BagPanel)은 재료를 stacks 에서,
      // 도구는 instances 에서만 그린다. 그래서 산 도구는 골드만 줄이고 가방
      // 어디에도 나타나지 않은 채 조용히 사라진다 — 매수 성공 화면과 텅 빈
      // 가방 사이에서 원인을 되짚을 길이 없다.
      if (stockedItem.kind !== 'material') {
        violations.push(
          `shops[${shop.id}]: "${entry.itemId}" 는 도구라 진열할 수 없다 — 매수는 무엇을 사든 가방의 재료 칸(player.stacks)에 넣는데, 가방 화면은 도구를 그 칸이 아니라 instances 에서만 그린다. 산 도구는 골드만 줄이고 가방 어디에도 나타나지 않는다. 진열은 kind 가 material 인 아이템만 할 수 있다`,
        )
        // 도구는 값이 0 이고 계열이 비어 있는 것이 **정상**이라(팔 수 없고 상점
        // 계열을 물을 일이 없다), 아래 두 검사까지 돌리면 한 줄의 오타가 위반
        // 셋이 되어 진짜 원인이 자기 그림자에 묻힌다.
        continue
      }
      // price 0 은 "팔 수 없다"는 뜻이지 "공짜"가 아니다(설계 §2). 그런데 진열에
      // 놓이는 순간 그 뜻이 정확히 뒤집힌다: 매수 총액은 개당 값 × 수량이라 0 이
      // 되고, 서버의 `gold < cost` 검사는 0 앞에서 언제나 통과하며, 화면도 총액
      // 0 을 붉히지 않으니 [사기] 버튼이 살아 있다 — 무한 무료 아이템이다.
      // 화면 쪽 가드(maxBuyCount 의 `unitPrice <= 0`)는 수량을 0 으로 만들 뿐
      // 버튼을 잠그지 못한다(clampCount 가 1 을 돌려준다). 판정이 아니라 데이터가
      // 틀린 것이므로 여기서 막는다.
      if (stockedItem.price <= 0) {
        violations.push(
          `shops[${shop.id}]: "${entry.itemId}" 은 price 가 0 이라 진열할 수 없다 — price 0 은 "팔 수 없다"는 뜻이지 "공짜"가 아니다. 값이 0 이면 매수 총액이 0 이라 골드 검사가 언제나 통과해 누구나 무한히 가져간다. items.csv 의 price 를 1 이상으로 올리거나 shop_stock.csv 에서 그 줄을 지운다`,
        )
      }
      // 진열은 그 상점 계열의 물건이어야 한다(설계 §6-앞 14) — 숙련 잠금이든
      // 수집 잠금(되사기)이든 마찬가지다. 숙련으로 열리는 칸은 요구치와 화면의
      // "현재/필요"·기술 이름이 **상점의 계열** 숙련도를 재고(shopModel.buyRows),
      // 수집으로 열리는 되사기 칸은 "그 계열 상점이 자기 계열 채집물만 되판다"는
      // 규칙(§6-앞 7) 자체가 깨진다. 그래서 `얼음상점,wood_speed_token,10000`
      // 한 줄이면 나무 증표가 얼음 숙련도로 열리고 화면은 "얼음 0/10,000"을
      // 적는다 — 데이터가 적은 계열과 화면이 말하는 계열이 갈라지는데, 어느
      // 쪽도 화면에서 되짚을 수 없다.
      if (stockedItem.skill !== shop.skill) {
        violations.push(
          `shops[${shop.id}]: "${entry.itemId}" 는 "${stockedItem.skill ?? '(비어 있음)'}" 계열인데 이 상점은 "${shop.skill}" 계열이다 — 숙련 잠금 칸이면 요구치와 화면의 "현재/필요"가 상점 계열의 숙련도를 재는데 엉뚱한 계열의 문턱이 되고, 수집 잠금(되사기) 칸이면 "자기 계열만 되판다"는 규칙이 깨진다. shop_stock.csv 에서 그 줄을 "${stockedItem.skill ?? shop.skill}" 상점으로 옮기거나 items.csv 의 skill 을 고친다`,
        )
      }
    }
  }

  // 달인은 화자 하나·기술 하나에 한 명이다. 서버는 말을 건 화자로 대금을 찾고
  // (§6-앞 2), 사람은 "이 기술의 달인"으로 그를 부른다 — 둘 중 어느 쪽이 갈라져도
  // 같은 문턱이 두 개의 답을 갖는다.
  const masterOfSpeaker = new Map<string, string>()
  const masterOfSkill = new Map<SkillId, string>()
  for (const master of data.masters) {
    if (!Object.hasOwn(data.speakers, master.speakerId)) {
      violations.push(
        `masters[${master.id}]: 없는 화자 "${master.speakerId}" 를 가리킨다 — speakers.csv 의 id 중 하나여야 한다`,
      )
    }
    const speakerOwner = masterOfSpeaker.get(master.speakerId)
    if (speakerOwner) {
      violations.push(
        `masters[${master.id}]: 화자 "${master.speakerId}" 에게 이미 달인 "${speakerOwner}" 가 있다 — 한 화자는 달인 하나다`,
      )
    } else {
      masterOfSpeaker.set(master.speakerId, master.id)
    }
    const skillOwner = masterOfSkill.get(master.skill)
    if (skillOwner) {
      violations.push(
        `masters[${master.id}]: 기술 "${master.skill}" 의 달인이 이미 "${skillOwner}" 다 — 한 기술에 달인 하나다`,
      )
    } else {
      masterOfSkill.set(master.skill, master.id)
    }
  }

  // 채집으로 얻는 것은 노드가 가리키는 표의 전 아이템이다(설계 §7-앞 11) —
  // 노드는 이제 산출물을 직접 갖지 않는다. 없는 표(?? [])는 위 참조 검사가
  // 이미 말했으므로 여기서 그림자 위반을 만들지 않는다. 시작 도구를 따로
  // 시드하지 않는 이유(구 STARTING_TOOL_IDS 시드의 은퇴): 지급이 유도가 되면서
  // 시작 도구도 requiredSkill 0 레시피를 가져야 하고(위 검사), 그러면 레시피
  // 산출물로서 이미 여기 잡힌다 — 레시피 없는 시작 도구는 오탐이 아니라 결손이다.
  const obtainable = new Set<string>()
  for (const node of Object.values(data.nodes)) {
    for (const tier of gatherTables[node.tableId]?.tiers ?? []) obtainable.add(tier.itemId)
  }
  for (const recipe of Object.values(data.recipes)) obtainable.add(recipe.output.item)
  // 사는 것도 획득이다(§6-앞 12) — 증표는 캐지지도 만들어지지도 않으므로, 진열을
  // 세지 않으면 설계가 요구한 물건 8종이 그대로 빌드를 세운다.
  for (const shop of Object.values(data.shops)) {
    for (const entry of shop.stock) obtainable.add(entry.itemId)
  }
  for (const item of Object.values(data.items)) {
    if (!obtainable.has(item.id)) {
      violations.push(`items[${item.id}]: 채집으로도 제작으로도 구매로도 획득할 수 없다`)
    }
  }

  // 왜: mapId 는 지금까지 파싱만 되고 아무도 읽지 않아서, 오타가 빌드를 통과하고
  // 맵이 둘이 되는 순간 "NPC 가 사라졌다"로만 드러났다.
  for (const speaker of Object.values(data.speakers)) {
    if (!data.maps[speaker.mapId]) {
      violations.push(
        `speakers[${speaker.id}]: 없는 맵 "${speaker.mapId}" 에 놓였다 — maps.csv 의 id 중 하나여야 한다`,
      )
    }
  }

  // 참조 무결성 검사는 여기까지다. 아래 도달 가능성 검사를 돌릴지 말지는
  // **이 시점의** 위반 수가 정한다 — 그 사이에 끼어 있는 대사 검사가 몇 건을
  // 더하든 도달 가능성 계산에는 영향이 없기 때문이다.
  const referenceViolations = violations.length

  // ---- 대화 검사 ----
  //
  // 아래의 이른 반환보다 **먼저** 온다. 그 반환은 "오타 하나가 도달 가능성
  // 계산 전체를 오염시키는 것"을 막으려고 있는 것인데, 대사 데이터는 아이템·
  // 레시피와 서로 다른 것을 참조하므로 그런 오염 관계가 없다. 뒤에 두면
  // nodes.csv 오타 하나가 대사 위반을 통째로 덮어, 작가는 한 가지를 고치고
  // 다시 빌드해서야 두 번째 파도를 만난다. 반대로 대사 위반이 도달 가능성
  // 검사를 막아서도 안 된다 — 그래서 위에서 개수를 따로 세어 둔다.
  //
  // 이 검사들이 참조하는 것은 SKILL_IDS(코드 상수)와 이정표 id 목록뿐이다 —
  // 둘 다 위쪽 계산에 기대지 않으므로 여기로 올려도 쓰는 값이 달라지지 않는다.
  const milestoneIds = new Set(data.milestones.map((m) => m.id))
  const speakersList = Object.values(data.speakers)
  const speakerIds = new Set(speakersList.map((s) => s.id))
  const dialogueSpeakerIds = new Set(data.dialogue.map((r) => r.speaker))
  /** 위반 메시지의 앞머리. 작가가 어느 파일 몇 행을 열면 되는지가 먼저 온다. */
  const at = (rule: DialogueRule): string =>
    `dialogue[${rule.speaker}] ${dialogueLocation(rule.source.file, rule.source.line)}`

  // 선언되지 않은 사실 이름을 쓰는 조건 — 오타(affinty)가 조용히 "절대 안
  // 맞는 조건"이 되면 작가가 원인을 못 찾는다(설계 문서 6.3).
  for (const rule of data.dialogue) {
    for (const condition of rule.conditions) {
      if (!findFactSpec(condition.fact)) {
        violations.push(`${at(rule)}: 선언되지 않은 사실 "${condition.fact}" 를 쓴다`)
      }
    }
  }

  // 사건 이름 오타 — @greeet 는 파싱도 되고 다른 검사도 전부 통과하지만,
  // selectDialogue 는 EVENT_ORDER 에 있는 사건만 훑으므로 절대 선택되지
  // 않는다(packages/shared/src/dialogue.ts 가 이 검사를 데이터 파이프라인의
  // 몫으로 명시해 뒀다). 사실 이름 오타와 완전히 같은 부류이고, @ 는 모든
  // 규칙 머리에 있다.
  for (const rule of data.dialogue) {
    if (!(EVENT_ORDER as readonly string[]).includes(rule.event)) {
      violations.push(`${at(rule)}: 알 수 없는 사건 "${rule.event}" — 쓸 수 있는 사건은 ${EVENT_ORDER.join(', ')} 이다`)
    }
  }

  // @greet 무조건 규칙이 없는 화자 — 어떤 상황에서도 할 말이 없으면 말을
  // 걸어도 아무 일도 안 일어난다. 대사 파일 자체가 없는 화자(ownRules 가
  // 비어 있다)는 여기서 또 알리지 않는다 — 아래 "대사 파일이 없다" 검사가
  // 이미 같은 원인을 알려주므로, 둘 다 보고하면 노이즈만 커진다.
  for (const speaker of speakersList) {
    const ownRules = data.dialogue.filter((r) => r.speaker === speaker.id)
    if (ownRules.length === 0) continue
    const hasUnconditionalGreet = ownRules.some((r) => r.event === 'greet' && r.conditions.length === 0)
    if (!hasUnconditionalGreet) {
      violations.push(`dialogue[${speaker.id}]: @greet 무조건 규칙이 없다 — 말을 걸어도 아무 일도 안 일어날 수 있다`)
    }
  }

  // 자기 조건끼리 어긋나는 규칙 — 어떤 세계 상태에서도 나오지 않는다.
  // 계산 자체는 findDeadDialogueRules(아래) 하나뿐이다 — content-cli.ts 의
  // `dead` 명령이 이 빌드 실패와 다른 계산을 쓰면 둘이 갈라질 수 있어서,
  // 그 명령도 이 함수를 그대로 불러 쓴다.
  for (const { rule, a, b } of findDeadDialogueRules(data.dialogue)) {
    violations.push(
      `${at(rule)}: 조건 "${conditionText(a)}" 과 "${conditionText(b)}" 가 동시에 참일 수 없다 — 이 규칙은 어떤 상황에서도 나오지 않는다. 조건 하나를 지우거나 규칙을 둘로 나눈다`,
    )
  }

  // 대사 파일이 없는 화자, 화자가 없는 대사 파일 — 배치(speakers.csv)와
  // 대사(dialogue/*.dlg)는 서로 다른 파일이라 하나만 고치고 잊기 쉽다.
  for (const speaker of speakersList) {
    if (!dialogueSpeakerIds.has(speaker.id)) {
      violations.push(`speakers[${speaker.id}]: 대사 파일이 없다`)
    }
  }
  for (const id of dialogueSpeakerIds) {
    if (!speakerIds.has(id)) {
      violations.push(`dialogue[${id}]: 화자 정의(speakers.csv)가 없다`)
    }
  }

  // 조건의 **값** 을 본다 — 모양(설계 문서 7장의 "값의 형태가 맞지 않는 조건")과
  // 그 값이 가리키는 것이 실재하는가(참조).
  //
  // 값 모양 검사는 오래 미뤄져 있었다. 미룬 이유가 "사실마다 값이 무엇일 수
  // 있는지가 코드에 없다" 였는데, FactSpec.value 가 생기면서 그 정보가 생겼다.
  // 이 검사가 없으면 `season=화요일` 은 파싱도 되고 이름 검사도 통과한 뒤
  // 조용히 "절대 안 맞는 조건"이 된다 — 작가가 가장 못 찾는 종류의 오류다.
  //
  // 참조 검사는 이정표 검사에서 배운 것과 같다: 데이터가 서로를 가리키면
  // 빌드가 그 참조를 확인한다. 계산은 factReferenceError 하나뿐이고
  // content-cli.ts 의 `--사실=값` 검사도 같은 함수를 부른다.
  for (const rule of data.dialogue) {
    for (const condition of rule.conditions) {
      const shape = findFactSpec(condition.fact)?.value
      if (shape && !factValueFitsShape(shape, condition.value)) {
        // 영문 식별자에 조사를 직접 붙이면 받침 유무로 문법이 어긋난다
        // (season 은 "은", hour 는 "는") — 고정된 한국어 명사 "사실"을 사이에
        // 끼워 조사를 그 명사에 붙이면 이름과 무관하게 항상 맞는다.
        violations.push(
          `${at(rule)}: 조건 "${conditionText(condition)}" 의 값 모양이 다르다 — ${condition.fact} 사실은 ${describeFactValueShape(shape)}`,
        )
      }

      const reference = factReferenceError(condition.fact, condition.value, data)
      if (reference) violations.push(`${at(rule)}: ${reference.reason}`)
    }
  }

  // 한 번만 하는 사건(story·quest·milestone)의 조건은 **전부 `=` 여야 한다.**
  //
  // onceKey(packages/shared/src/dialogue.ts)는 **연산자를 보지 않고** 규칙의
  // 모든 조건마다 그 사실의 "지금 값"을 스냅샷해 키에 엮는다. 그러니 여기서
  // 물어야 할 것은 "그 사실이 끝없이 커지는가"(FactSpec.unbounded)가 아니라
  // **"규칙이 맞고 있는 동안 그 스냅샷 값이 달라질 수 있는가"** 이고, 값을
  // 하나로 못박는 연산자는 `=` 하나뿐이다. `=` 로 걸면 규칙이 맞는 순간의 값이
  // 언제나 그 리터럴과 같아서 키가 고정되고, 나머지 전부(`!=` 포함)는 규칙이
  // 맞는 동안에도 값이 계속 달라진다.
  //
  // 한때 이 검사는 unbounded 인 사실만 봤다. 그런데 unbounded 는 "정의역에
  // 상한이 있는가"를 뜻할 뿐이라 hour·dayOfSeason·season 은 상한이 있다는
  // 이유로 그냥 통과했고, `@quest ... hour<6`("밤에만") 한 줄이 밤마다 다시
  // 나왔다 — 설계 문서 §4.2 가 결정적이라고 못박은 "한 번 알리고 배경이 된다"가
  // 조용히 깨지는 자리다. 상한이 있어도 값은 매 시각 달라지므로 상한 유무는
  // 애초에 물어볼 것이 아니었다.
  //
  // 이 검사는 `@story skill.ice>=50000` 도 막는다. 그 규칙은 실제로 고장난
  // 규칙이고(숙련도가 1 오를 때마다 처음부터 다시 말한다), 작가가 쓰려던 것을
  // 옳게 적는 방법이 이미 있다 — `milestone.ice_50000=true` 다. 그래서 메시지는
  // 막기만 하지 않고 그 고쳐 쓰는 법까지 말한다(onceRewriteHint).
  for (const rule of data.dialogue) {
    if (!ONCE_EVENTS.has(rule.event)) continue
    for (const condition of rule.conditions) {
      if (condition.op === '=') continue
      violations.push(
        `${at(rule)}: 한 번만 하는 말(@${rule.event})의 조건에 = 아닌 연산자를 썼다: "${conditionText(condition)}" — 한 번만 하는 말은 조건에 건 사실의 "지금 값"까지 함께 기억해 두었다가 그 값이 달라지면 다시 말한다. = 이 아닌 조건은 값이 달라져도 계속 맞으므로, 그 사실이 바뀔 때마다 같은 말을 처음부터 다시 하게 된다. ${onceRewriteHint(condition, data)}`,
      )
    }
  }

  // ---- 값 검사 ----
  //
  // 대화 검사와 같은 자리에 있다(참조 위반 계수를 센 뒤, 조기 반환보다 앞).
  // 가격은 아이템 참조 사슬과 무관하므로 오타가 이 계산을 오염시키지 않고,
  // 반대로 이 위반이 도달 가능성 검사를 막아서도 안 된다.

  // 돈복사 금지(설계 §6-앞 6): 산출물을 팔아 얻는 돈이 재료를 팔아 얻는 돈보다
  // 크면, 캐서 만들어 파는 순환 하나가 무한 골드 루프가 된다(스펙의 구리 주괴는
  // 입력 원가의 31배였다 — 조합 숙련 0 에 열리는 레시피 하나로 분당 86,000G).
  // 새 레시피·새 가격마다 사람이 검산하는 것은 언젠가 반드시 빠지므로 빌드가 센다.
  for (const recipe of Object.values(data.recipes)) {
    const output = data.items[recipe.output.item]
    // 없는 아이템을 가리키는 레시피는 위 참조 검사가 이미 말했다 — 여기서 또
    // 세면 오타 하나가 위반 둘이 되어 진짜 원인이 흐려진다.
    if (!output) continue

    let inputValue = 0
    let unknownInput = false
    for (const input of recipe.inputs) {
      const def = data.items[input.item]
      if (!def) {
        unknownInput = true
        break
      }
      inputValue += sellPrice(def) * input.count
    }
    if (unknownInput) continue

    const outputValue = sellPrice(output) * recipe.output.count
    // 등호는 통과다 — 본전인 레시피는 골드를 만들지 않으므로 막을 이유가 없다.
    if (outputValue > inputValue) {
      violations.push(
        `recipes[${recipe.id}]: 산출물 매도가(${outputValue})가 재료 매도가 합계(${inputValue})보다 크다 — 만들어서 팔기만 해도 골드가 불어난다(돈복사). items.csv 에서 "${output.name}" 의 price 를 낮추거나 recipes.csv 에서 재료를 늘린다`,
      )
    }
  }

  // 사다리 소속 일치(설계 §6-앞 10): items.csv 의 skill 은 "어느 상점이 이것을
  // 사 주는가"를 정하고, 채집표는 "이것이 실제로 어느 사다리에서 나오는가"를
  // 안다. 둘이 갈라지면 얼음 채집장에서 캔 것을 얼음상점이 안 사 주는 화면이
  // 되는데, 그 원인은 화면에서 되짚을 수 없다 — 소속이 서버 전용 산출물에만
  // 있어서 사람이 눈으로 대조할 곳도 없다.
  //
  // **양방향으로 본다.** 한때 이 검사는 `if (!item.skill) continue` 로 시작해
  // "적힌 계열이 표와 다른가" 한쪽만 봤는데, 그러면 **표의 티어인데 계열 칸이
  // 빈** 재료가 그물을 그대로 빠져나갔다. 매도 판정(isSellTarget)은 아이템의
  // skill 과 상점의 skill 을 견주므로 계열 없는 재료는 어느 상점도 사 주지
  // 않는데(undefined 는 어느 계열과도 같지 않다), 그것이 하필 레시피 재료이기도
  // 하면 "쓸 곳도 팔 곳도 없다" 검사마저 통과해 빌드가 끝까지 초록이다 —
  // soft_log 의 skill 을 비우면 나무상점이 무른 통나무를 안 사는 화면이 된다.
  //
  // 표의 티어가 아닌 아이템(주괴·증표·도구)은 대상이 아니다. 사다리 밖이라
  // 대조할 상대가 없을 뿐이고, 그 skill 값 자체가 실재하는 기술인지는
  // parseItems 의 toSkillId 가 이미 본다.
  //
  // 색인을 둘 만든다: 계열은 이 검사가, 표 id 는 아래 증표 제약("증표는 캐는 것이
  // 아니다")이 쓴다 — 표를 두 번 돌 이유가 없다.
  const ladderSkillOf = new Map<string, SkillId>()
  const tableOfTier = new Map<string, string>()
  for (const table of Object.values(gatherTables)) {
    for (const tier of table.tiers) {
      ladderSkillOf.set(tier.itemId, table.skill)
      tableOfTier.set(tier.itemId, table.id)
    }
  }
  for (const item of Object.values(data.items)) {
    const ladder = ladderSkillOf.get(item.id)
    if (!ladder) continue
    if (!item.skill) {
      violations.push(
        `items[${item.id}]: 채집표에서는 "${ladder}" 사다리의 티어인데 skill 칸이 비어 있다 — 매도 판정이 아이템의 skill 과 상점의 skill 을 견주므로, 계열이 없는 재료는 어느 상점도 사 주지 않는다. 캔 것이 팔리지 않는 화면이 된다. items.csv 의 skill 을 "${ladder}" 로 채운다`,
      )
    } else if (ladder !== item.skill) {
      violations.push(
        `items[${item.id}]: skill 이 "${item.skill}" 인데 채집표에서는 "${ladder}" 사다리의 티어다 — 캔 곳과 팔 곳이 갈라진다. items.csv 의 skill 을 "${ladder}" 로 고친다`,
      )
    }
  }

  // 증표 제약(설계 §5·§6-앞 11): 증표는 새 kind 가 아니라 "재료 + tokenEffect" 다.
  // 그 결정이 가방 패널의 가드(kind !== 'material')로부터 증표를 구했지만, 대신
  // 재료라면 할 수 있는 것들이 증표에게도 열려 버렸다 — 캐지고, 만들어지고,
  // 도구가 되는 것. 셋 다 열려 있으면 "상점이 유일한 골드 싱크"라는 설계가 조용히
  // 무너지므로 여기서 닫는다. 표 색인(tableOfTier)은 바로 위 사다리 소속 검사가
  // 만들어 둔 것을 그대로 쓴다.
  const recipeOfOutput = new Map<string, string>()
  for (const recipe of Object.values(data.recipes)) {
    if (!recipeOfOutput.has(recipe.output.item)) recipeOfOutput.set(recipe.output.item, recipe.id)
  }
  for (const item of Object.values(data.items)) {
    if (!item.tokenEffect) continue

    if (!item.skill) {
      violations.push(
        `items[${item.id}]: 증표인데 계열(skill)이 없다 — 어느 계열의 채집에 걸리는 효과인지 정해지지 않는다. items.csv 의 skill 을 채운다`,
      )
    }
    const recipeId = recipeOfOutput.get(item.id)
    if (recipeId) {
      violations.push(
        `items[${item.id}]: 증표가 레시피 "${recipeId}" 의 산출물이다 — 증표는 사는 것이지 만드는 것이 아니다. recipes.csv 에서 그 레시피를 지운다`,
      )
    }
    const ladderTable = tableOfTier.get(item.id)
    if (ladderTable) {
      violations.push(
        `items[${item.id}]: 증표가 채집표 "${ladderTable}" 의 티어다 — 증표는 캐는 것이 아니다. gather_tiers.csv 에서 그 줄을 지운다`,
      )
    }
    if (item.toolSkill) {
      violations.push(
        `items[${item.id}]: 증표가 toolSkill 을 가진다 — 증표는 슬롯을 먹지 않는 보유 효과라 도구일 수 없다. items.csv 의 kind 를 material 로 두고 toolSkill 을 비운다`,
      )
    }
  }

  // 사용 효과 제약(설계 §6-앞 1·4): 쓰면 하나가 사라지는 물건은 **재료**여야 한다.
  //
  // 도구는 스택이 아니라 인스턴스로 산다(강화 수치가 붙어 개별 정체성이 생긴다).
  // `performUse` 가 소모하는 것은 `stacks[itemId]` 하나이므로, 도구에 이 칸이
  // 붙으면 화면은 [사용] 버튼을 그리는데 서버는 언제나 "가진 것이 없다"고
  // 거절하는 물건이 된다 — 그 어긋남은 로그 어디에도 남지 않는다.
  for (const item of Object.values(data.items)) {
    if (item.useEffect && item.kind !== 'material') {
      violations.push(
        `items[${item.id}]: 도구에 사용 효과가 붙어 있다 — 쓰면 하나가 사라지는데 도구는 스택이 아니라 인스턴스라 소모할 개수가 없다. items.csv 의 kind 를 material 로 두거나 useEffect·useValue 를 비운다`,
      )
    }
  }

  // 참조 무결성 검사가 이미 위반을 찾았다면 도달 가능성 검사(고정점 계산)는
  // 건너뛴다. 안 그러면 오타 하나가 그 아이템에 의존하는 나머지 전부를 "도달 불가"로
  // 도매금 처리해 진짜 원인이 N+1 줄의 소음에 파묻힌다.
  if (referenceViolations > 0) return violations

  const reachable = computeReachableItems(data, gatherTables)
  for (const item of Object.values(data.items)) {
    if (!reachable.has(item.id)) {
      violations.push(
        `items[${item.id}]: 도달할 수 없다 — 맵에 놓인 어느 노드의 표에도 없고, 어느 상점도 팔지 않으며, 재료가 전부 도달 가능한 레시피도 없다`,
      )
    }
  }

  // 죽은 아이템 검사(설계 §6-앞 13): 모든 아이템은 **쓸 곳이나 팔 곳**이 있어야 한다.
  //
  // 옛 성공 기준(§9-7)은 "레시피 입력 ∨ 도구 ∨ price>0" 이었는데, 가격표를 붙이고
  // 나면 그 조건은 항상 참이라 아무것도 못 잡는다. 팔 곳이 있다는 것은 값이 붙어
  // 있다는 뜻이 아니라 **그것을 사 주는 상점이 있다**는 뜻이다 — 상점은 자기 계열만
  // 사므로(설계 §4), 계열이 어긋난 재료는 값이 아무리 커도 팔 데가 없다.
  //
  // 이 검사가 생긴 이유가 정확히 이것이다: 채집 사다리를 25종으로 늘렸는데
  // 13종이 어느 레시피에도 안 들어갔다. 그 13종을 구제한 것이 상점이고, 사다리가
  // 다음에 또 자랄 때 같은 일이 조용히 반복되지 않게 하는 것이 이 검사다.
  //
  // **위의 값 검사들과 달리 조기 반환 뒤에 있다.** 이 검사는 "레시피 입력인가"를
  // 물으므로 재료 id 오타 하나가 그 재료를 곧바로 죽은 아이템으로 만든다 — 앞에
  // 두면 오타 하나가 위반 둘이 되어 진짜 원인이 자기 그림자에 묻힌다.
  const recipeInputs = new Set<string>()
  for (const recipe of Object.values(data.recipes)) {
    for (const input of recipe.inputs) recipeInputs.add(input.item)
  }
  /**
   * 어느 상점이든 이것을 사 주는가. 매도 대상의 정의(설계 §6-앞 13)는 **shared 의
   * `isSellTarget` 하나가 소유한다** — 서버의 매도 판정도 같은 함수를 부르므로,
   * 빌드가 "팔 데가 있다"며 통과시킨 아이템을 서버가 `not_sellable` 로 거절하는
   * 어긋남이 생길 수 없다.
   */
  const someShopBuys = (item: ItemDef): boolean =>
    Object.values(data.shops).some((shop) => isSellTarget(item, shop))
  for (const item of Object.values(data.items)) {
    if (recipeInputs.has(item.id) || item.kind === 'tool' || item.tokenEffect || someShopBuys(item)) continue
    violations.push(
      `items[${item.id}]: 쓸 곳도 팔 곳도 없다 — 어느 레시피의 재료도 아니고, 도구도 증표도 아니며, 어느 상점도 사 주지 않는다(매도 대상은 price 가 0 보다 크고 그 상점과 skill 이 같은 재료다). recipes.csv 의 재료로 쓰거나, items.csv 의 price·skill 을 사 줄 상점(shops.csv)에 맞춘다`,
    )
  }

  // 이정표는 새 게이트를 만들지 않고 이미 존재하는 게이트를 선언할 뿐이다(설계 §2.3,
  // §3.1). 그래서 아래 검사들은 "선언"이 논리적으로 말이 되는지, 그리고 "선언"과
  // "실제 게이트"가 어긋나지 않는지를 본다. milestoneIds 는 대화 검사가 이미
  // 위에서 만들었다 — 여기서 다시 만들지 않고 그대로 쓴다.
  for (const milestone of data.milestones) {
    const metric = milestone.metric
    if (metric.kind !== 'every') continue

    for (const ref of metric.of) {
      if (!milestoneIds.has(ref)) {
        violations.push(`milestones[${milestone.id}]: 존재하지 않는 이정표 "${ref}" 를 가리킨다`)
      }
    }

    // of 의 길이보다 threshold 가 크면, of 를 전부 달성해도 threshold 에 닿을 수
    // 없다 — 영원히 달성 불가능한 줄이 목록에 남는다.
    if (milestone.threshold > metric.of.length) {
      violations.push(
        `milestones[${milestone.id}]: threshold(${milestone.threshold}) 가 of 길이(${metric.of.length}) 보다 크다 — 영원히 달성할 수 없다`,
      )
    }
  }

  const cycle = findEveryCycle(data.milestones)
  if (cycle) {
    violations.push(`milestones: every 이정표가 순환 참조를 이룬다 — ${cycle}`)
  }

  // 수집 총점의 만점은 **칸 수 × 등급 수**다(§6-앞 4: 25 × 4 = 100). every 의
  // "threshold 가 of 길이보다 크다"와 같은 자리의 검사다 — 만점보다 큰 문턱은
  // 방을 통째로 채워도 닿지 않는 줄이 목록에 영원히 남는 것이고, 그 줄은
  // 화면에서 "100 / 120" 으로 보이며 왜 안 열리는지 아무도 말해 주지 않는다.
  //
  // **칸 목록이 채집표(gatherTables)와 어긋나 있으면 이 검사는 건너뛴다.**
  // 만점 자체가 칸 수에서 유도되므로, 칸 수가 틀린 상태에서 잰 만점은 뜻이
  // 없다 — sage 행 하나를 collection.csv 에서 지우면 원인은 하나(칸이
  // 빠졌다)인데, collection.ts 의 validateCollection 이 "칸이 없다"를 이미
  // 알리고 이 검사까지 "만점을 넘는다"를 더하면 원인 하나가 위반 둘로 보인다.
  // validateCollection 은 정확히 이 이유로 조기 반환을 두지만(그 파일의 "칸
  // 목록 = 채집물 전부" 검사 옆 주석), 그 조기 반환은 그 함수 안에서만
  // 유효하고 이 파일의 검사까지 막지는 못한다 — 그래서 여기서도 같은 판단을
  // 한 번 더 한다.
  const gatheredCollectionIds = new Set<string>()
  for (const table of Object.values(gatherTables)) {
    for (const tier of table.tiers) gatheredCollectionIds.add(tier.itemId)
  }
  const collectionIds = new Set(Object.keys(data.collection))
  const collectionSlotsMismatch =
    [...gatheredCollectionIds].some((id) => !collectionIds.has(id)) ||
    [...collectionIds].some((id) => !gatheredCollectionIds.has(id))

  if (!collectionSlotsMismatch) {
    const maxCollectionScore = collectionIds.size * COLLECTION_MAX_GRADE
    for (const milestone of data.milestones) {
      if (milestone.metric.kind !== 'collection') continue
      if (milestone.threshold > maxCollectionScore) {
        violations.push(
          `milestones[${milestone.id}]: threshold(${milestone.threshold}) 가 수집 만점(${maxCollectionScore} = 칸 ${collectionIds.size}개 × ${COLLECTION_MAX_GRADE}등급)보다 크다 — 영원히 달성할 수 없다`,
        )
      }
    }
  }

  // 되사기 게이트의 양방향 검사(§6-앞 7). `recipes` 이정표가 레시피 요구치와
  // 맞물리는지를 양쪽에서 보는 것과 같은 자세다: 이정표는 **새 게이트를 만들지
  // 않고 이미 데이터가 강제하는 게이트를 선언**하므로, 선언과 실물이 갈라지면
  // 어느 쪽도 화면에서 되짚을 수 없다.
  const buybackScores = new Set<number>()
  for (const shop of Object.values(data.shops)) {
    for (const entry of shop.stock) {
      if (entry.unlockBy === 'collection') buybackScores.add(entry.unlockAt)
    }
  }

  for (const milestone of data.milestones) {
    if (milestone.effect.kind !== 'stock') continue
    // 총점으로 열리는 문을 숙련도로 선언하면, 목록은 "얼음 30 / 60,000" 같은
    // 엉뚱한 눈금으로 진척을 적으면서 상점은 총점을 본다.
    if (milestone.metric.kind !== 'collection') {
      violations.push(
        `milestones[${milestone.id}]: effectKind=stock 인데 metricKind 가 "${milestone.metric.kind}" 다 — 되사기 진열을 여는 것은 수집 총점이므로 metricKind 도 collection 이어야 한다`,
      )
    }
    if (!buybackScores.has(milestone.threshold)) {
      violations.push(
        `milestones[${milestone.id}]: 총점 ${milestone.threshold} 에서 열리는 진열이 하나도 없다 — shop_stock.csv 의 unlockCollection 에 ${milestone.threshold} 인 행이 있어야 이 선언이 실물을 가리킨다`,
      )
    }
  }

  for (const score of [...buybackScores].sort((a, b) => a - b)) {
    const carriers = data.milestones.filter((m) => m.effect.kind === 'stock' && m.threshold === score)
    if (carriers.length === 0) {
      violations.push(
        `shop_stock.csv: unlockCollection ${score} 로 열리는 진열이 있는데 어느 stock 이정표에도 실리지 않았다 — 목록방에서 조용히 빠져 플레이어는 그 문이 있는 줄도 모른다. milestones.csv 에 metricKind=collection·threshold=${score}·effectKind=stock 으로 싣는다`,
      )
    } else if (carriers.length > 1) {
      violations.push(
        `shop_stock.csv: unlockCollection ${score} 가 stock 이정표 [${carriers.map((m) => m.id).join(',')}] ${carriers.length}개에 실렸다 — 정확히 하나여야 한다. 목록에 같은 문이 두 번 열리는 것으로 보인다`,
      )
    }
  }

  // 결계 게이트의 양방향 검사 — 되사기(바로 위)와 같은 자세, 같은 이유다.
  // 이정표는 새 게이트를 만들지 않고 `transitions.csv` 의 `gateSkill`·`gateValue`
  // 가 이미 강제하는 문을 목록에 적을 뿐이므로, 선언과 실물이 갈라지면 어느
  // 쪽도 화면에서 되짚을 수 없다.
  //
  // **뒷방향이 이 검사의 존재 이유다.** 결계 넷이 출하되고도 85,000 이 어느
  // 목록에도 없던 적이 있다 — 문은 서 있는데 목록방이 그 숫자를 한 번도 말하지
  // 않으면, 플레이어는 벽 앞에 서고 나서야 처음 그 숫자를 읽는다. 그것은 원작이
  // 쓴 "잠긴 것까지 보이는 목록방" 의 반대다.
  //
  // 짝짓는 규칙 자체는 shared 의 `barrierDoorsOf` 하나가 소유한다 — 이정표 탭이
  // "무엇이 열리는가" 를 적을 때 부르는 그 함수이고, 검사와 화면이 각자 부등호를
  // 옮겨 적으면 둘이 갈라지는 날 빌드는 초록인데 목록만 딴소리를 한다.
  for (const milestone of data.milestones) {
    if (milestone.effect.kind !== 'barrier') continue
    // 문이 요구하는 것은 계열 숙련도다. 총점·합산 지표로 선언하면 짝지을 계열이
    // 없어 `barrierDoorsOf` 가 언제나 빈 목록을 주고, 아래 "문이 하나도 없다" 만
    // 뜬다 — 진짜 원인은 지표 칸이므로 그것을 이름으로 말한다.
    if (milestone.metric.kind !== 'skill') {
      violations.push(
        `milestones[${milestone.id}]: effectKind=barrier 인데 metricKind 가 "${milestone.metric.kind}" 다 — 결계 문이 요구하는 것은 계열 숙련도이므로 metricKind 도 skill 이어야 한다. 그래야 transitions.csv 의 gateSkill 과 짝지을 수 있다`,
      )
      continue
    }
    if (barrierDoorsOf(milestone, data.transitions).length === 0) {
      violations.push(
        `milestones[${milestone.id}]: 숙련 ${milestone.metric.skill} ${milestone.threshold} 에서 열리는 결계 문이 하나도 없다 — transitions.csv 에 gateSkill=${milestone.metric.skill}·gateValue=${milestone.threshold} 인 행이 있어야 이 선언이 실물을 가리킨다`,
      )
    }
  }

  for (const door of data.transitions) {
    // 게이트 없는 문(나오는 문과 마을 사이 열여덟 줄)은 선언할 것이 없다.
    // 물때만 지는 문도 여기 없다 — 이정표가 선언하는 것은 숙련 쪽 문턱이고,
    // 시각은 아무리 캐도 오르지 않는 숫자라 목록에 적을 진척이 없다.
    if (door.gateSkill === undefined || door.gateValue === undefined) continue
    const carriers = data.milestones.filter((m) => barrierDoorsOf(m, [door]).length === 1)
    const at = `transitions.csv[${door.fromMap} (${door.fromX}, ${door.fromY})]`
    if (carriers.length === 0) {
      violations.push(
        `${at}: gateSkill=${door.gateSkill}·gateValue=${door.gateValue} 인 문이 어느 barrier 이정표에도 실리지 않았다 — 목록방에서 조용히 빠져 플레이어는 그 숫자를 결계 앞에서야 처음 읽는다. milestones.csv 에 metricKind=skill·metricArg=${door.gateSkill}·threshold=${door.gateValue}·effectKind=barrier 로 싣는다`,
      )
    } else if (carriers.length > 1) {
      violations.push(
        `${at}: gateSkill=${door.gateSkill}·gateValue=${door.gateValue} 인 문이 barrier 이정표 [${carriers.map((m) => m.id).join(',')}] ${carriers.length}개에 실렸다 — 정확히 하나여야 한다. 목록에 같은 벽이 두 번 열리는 것으로 보인다`,
      )
    }
  }

  for (const milestone of data.milestones) {
    const effect = milestone.effect
    if (effect.kind !== 'recipes') continue

    for (const recipeId of effect.ids) {
      const recipe = data.recipes[recipeId]
      // 레시피 존재 자체는 parseMilestones 가 파싱 시점에 이미 보장한다(대상이
      // 실재하지 않으면 빌드가 그 자리에서 던진다). 그래도 이 함수는 그 경로를
      // 거치지 않은 데이터(수작업으로 구성한 테스트 픽스처 등)로도 불릴 수 있으니,
      // TypeError 로 이 함수 전체를 죽이는 것보다 이 규칙이 조용히 통과하는 편이 낫다.
      if (!recipe) continue

      if (recipe.requiredSkill !== milestone.threshold) {
        violations.push(
          `milestones[${milestone.id}]: 레시피 "${recipeId}" 의 requiredSkill(${recipe.requiredSkill}) 이 이정표 threshold(${milestone.threshold}) 와 다르다`,
        )
      }
    }
  }

  // 역방향 검사(설계 §7-앞 5): requiredSkill > 0 인 레시피는 **정확히 하나**의
  // recipes-이정표에 실려야 한다. 위 검사는 이정표 → 레시피 방향(threshold 가
  // 맞는가)만 보므로, 요구치 있는 레시피를 만들고 이정표에 싣는 것을 잊으면
  // 아무도 말하지 않는다 — 그 레시피는 목록방에서 조용히 빠지고, 플레이어는
  // 문이 있는 줄도 모른 채 지나간다. 여럿에 실리는 것도 막는다 — 목록에 같은
  // 문이 두 번 열리는 것으로 보인다.
  for (const recipe of Object.values(data.recipes)) {
    if (recipe.requiredSkill <= 0) continue
    const carriers = data.milestones.filter((m) => {
      const effect = m.effect
      return effect.kind === 'recipes' && effect.ids.includes(recipe.id)
    })
    if (carriers.length === 0) {
      violations.push(
        `recipes[${recipe.id}]: requiredSkill(${recipe.requiredSkill}) 이 0 보다 큰데 어느 recipes 이정표에도 실리지 않았다 — 목록방에서 조용히 빠진다. milestones.csv 에 effectKind=recipes 로 싣는다`,
      )
    } else if (carriers.length > 1) {
      violations.push(
        `recipes[${recipe.id}]: recipes 이정표 [${carriers.map((m) => m.id).join(',')}] ${carriers.length}개에 실렸다 — 정확히 하나여야 한다`,
      )
    }
  }

  // 채집 기술(노드가 존재하는 기술)마다 자동 반복을 여는 repeat 이정표가 정확히
  // 하나씩 있어야 한다. 하나도 없으면 그 기술은 영원히 자동 반복을 얻지 못한다는
  // 사실이 목록 어디에도 드러나지 않고, 여럿이면 어느 것이 "그" 반복 이정표인지
  // 목록에서 모호해진다. crafting 처럼 노드가 없는 기술은 이 검사 대상이 아니다 —
  // 채집 노드 자체가 없으니 "채집 기술" 이 아니다. gatheringSkills 는 시작 도구
  // 유도 검사가 위에서 같은 정의로 만들어 둔 것을 그대로 쓴다.
  for (const skill of gatheringSkills) {
    const repeatMilestones = data.milestones.filter((m) => {
      const effect = m.effect
      return effect.kind === 'repeat' && effect.skill === skill
    })
    if (repeatMilestones.length !== 1) {
      const milestoneIdList = repeatMilestones.map((m) => m.id).join(',')
      violations.push(
        `skills[${skill}]: repeat 이정표가 정확히 1개여야 하는데 [${milestoneIdList}](${repeatMilestones.length}개)다`,
      )
    }
  }

  // repeat 이정표의 threshold 는 임의의 숙련도가 아니라 행동 간격이 200ms(초당 5회)로
  // 떨어지는 지점이어야 한다. 그 아래로는 연타가 실제로 따라잡을 수 있어 자동 반복이
  // 잠겨 있어도 손해가 없고, 그 위로는 손가락이 병목이 되어 잠겨 있으면 손해다 —
  // 해금이 정확히 그 경계에 오게 하는 것이 이 문턱의 존재 이유다. 곡선 자체는
  // @nogada/shared 의 actionIntervalMs 를 그대로 쓴다 — 여기서 다시 구현하면 두 번째
  // 진실 공급원이 생겨, 곡선이 바뀔 때 이 검사만 조용히 낡은 채로 남을 수 있다.
  //
  // 도구 배수(맨손 ×1.5 ~ 미스릴+5 ×0.52)가 생긴 뒤로 실제 채집 간격은 손에 따라
  // 이 값의 위아래로 흩어진다(도구 루프 설계 §3). 그래도 이 검사가 보는 것은
  // **도구 배수를 곱하기 전의 숙련도 곡선 그 자체**(actionIntervalMs, = 1티어
  // 도구를 든 손의 간격이자 맨손·상위 티어가 위아래로 벌어지는 기준선)다 —
  // 문턱은 도구를 무엇을 들었든 같은 자리에 있어야 하고, 도구는 그 자리를 옮기는
  // 것이 아니라 그 자리까지 가는 길을 빠르게 하는 것이다.
  for (const milestone of data.milestones) {
    const effect = milestone.effect
    if (effect.kind !== 'repeat') continue

    const interval = actionIntervalMs(milestone.threshold)
    if (interval !== 200) {
      violations.push(
        `milestones[${milestone.id}]: threshold(${milestone.threshold}) 의 행동 간격이 200ms 가 아니라 ${interval}ms 다 — 자동 반복 해금 문턱은 연타로 따라잡을 수 없어지는 지점이어야 한다`,
      )
    }
  }

  return violations
}

/**
 * 화자가 놓인 칸이 실제로 설 수 있는 칸인지 검사한다.
 *
 * validateGameData 와 나눠 둔 것은 정보가 하나 더 필요해서다 — 화자의 좌표는
 * speakers.csv 에 있지만 "그 칸이 벽인가·맵 안인가"는 맵 파일에만 있다.
 * GameData 에 맵 전체를 실어 나르는 대신, 맵에서 뽑은 최소한의 지형
 * (MapTerrain)을 맵별로 받는다.
 *
 * 지형을 맵마다 따로 받는 이유는 화자마다 자기 맵의 벽·크기를 봐야 하기
 * 때문이다. 노드 칸 색인(nodeAt)의 키에도 맵이 들어간다 — 안 넣으면 두 맵의
 * 같은 좌표가 한 칸으로 뭉쳐, 다른 맵의 노드를 밟았다고 오탐한다.
 */
export function validateSpeakerPlacements(
  data: GameData,
  terrains: Record<string, MapTerrain>,
): string[] {
  const violations: string[] = []

  // 노드가 놓인 칸. 노드도 화자도 "그 칸을 향하면 반응하는 것"이라, 한 칸에
  // 둘이 있으면 무엇이 반응할지 정해지지 않는다 — parsePlacements 가 노드끼리
  // 겹치는 것을 막는 것과 같은 이유다.
  const nodeAt = new Map<string, string>()
  for (const placement of Object.values(data.placements)) {
    nodeAt.set(`${placement.mapId}:${placement.x},${placement.y}`, placement.instanceId)
  }

  for (const speaker of Object.values(data.speakers)) {
    const terrain = terrains[speaker.mapId]
    // 없는 맵을 가리키는 것은 validateGameData 가 이미 잡았다. 여기서 또 말하면
    // 같은 오타로 위반이 둘 생긴다.
    if (!terrain) continue

    const { x, y } = speaker
    const key = `${speaker.mapId}:${x},${y}`

    if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) {
      violations.push(
        `speakers[${speaker.id}]: 맵 밖 칸 (${x}, ${y}) 에 놓였다 — 맵은 가로 ${terrain.width}, 세로 ${terrain.height} 칸이라 x 는 0~${terrain.width - 1}, y 는 0~${terrain.height - 1} 이다`,
      )
      continue // 맵 밖이면 벽인지 노드인지 따질 칸 자체가 없다
    }

    if (terrain.walls.has(`${x},${y}`)) {
      violations.push(
        `speakers[${speaker.id}]: 벽 칸 (${x}, ${y}) 에 놓였다 — 벽 속에 서 있는 셈이다. speakers.csv 의 x·y 를 빈 칸으로 옮긴다`,
      )
    }

    const node = nodeAt.get(key)
    if (node) {
      violations.push(
        `speakers[${speaker.id}]: 노드 ${node} 와 같은 칸에 있다: (${x}, ${y}) — 그 칸을 향했을 때 어느 쪽이 반응할지 정해지지 않는다`,
      )
    }
  }

  return violations
}

/**
 * 맵의 시작 칸(`spawn` 오브젝트)이 정말로 설 수 있는 칸인지 검사한다.
 *
 * 이 값은 두 자리에서 쓰인다 — 새 플레이어가 서는 칸, 그리고 세이브가 없어진
 * 맵을 가리킬 때 돌아오는 칸이다. 둘 다 "여기서 시작한다"라서, 벽이나 노드
 * 위를 가리키면 결과가 같다: **움직일 수 없는 상태로 시작한다.** 노드·화자
 * 칸이 벽과 같은 취급인 것은 클라이언트가 그 칸들을 걸을 수 없는 칸으로
 * 세기 때문이다(WorldScene 의 blocked).
 *
 * 지형이 필요해서 validateGameData 와 나뉜다 — validateSpeakerPlacements 와
 * 같은 이유이고 같은 모양이다.
 */
export function validateMapSpawns(
  data: GameData,
  terrains: Record<string, MapTerrain>,
): string[] {
  const violations: string[] = []

  const nodeAt = new Map<string, string>()
  for (const placement of Object.values(data.placements)) {
    nodeAt.set(`${placement.mapId}:${placement.x},${placement.y}`, placement.instanceId)
  }
  const speakerAt = new Map<string, string>()
  for (const speaker of Object.values(data.speakers)) {
    speakerAt.set(`${speaker.mapId}:${speaker.x},${speaker.y}`, speaker.id)
  }

  for (const map of Object.values(data.maps)) {
    const terrain = terrains[map.id]
    if (!terrain) continue

    const { x, y } = map.spawn
    const key = `${map.id}:${x},${y}`

    if (x < 0 || y < 0 || x >= terrain.width || y >= terrain.height) {
      violations.push(
        `maps[${map.id}]: 시작 칸 (${x}, ${y}) 이 맵 밖이다 — 맵은 가로 ${terrain.width}, 세로 ${terrain.height} 칸이라 x 는 0~${terrain.width - 1}, y 는 0~${terrain.height - 1} 이다. ${map.file} 의 spawn 오브젝트를 맵 안으로 옮긴다`,
      )
      continue // 맵 밖이면 벽인지 노드인지 따질 칸 자체가 없다
    }

    if (terrain.walls.has(`${x},${y}`)) {
      violations.push(
        `maps[${map.id}]: 시작 칸 (${x}, ${y}) 이 벽이다 — 여기서 시작하는 사람은 벽 속에서 시작한다. ${map.file} 의 spawn 오브젝트를 빈 칸으로 옮긴다`,
      )
    }

    const node = nodeAt.get(key)
    if (node) {
      violations.push(
        `maps[${map.id}]: 시작 칸 (${x}, ${y}) 에 노드 ${node} 이 있다 — 노드 칸에는 설 수 없다. ${map.file} 의 spawn 오브젝트를 빈 칸으로 옮긴다`,
      )
    }

    const speaker = speakerAt.get(key)
    if (speaker) {
      violations.push(
        `maps[${map.id}]: 시작 칸 (${x}, ${y}) 에 화자 ${speaker} 가 있다 — 화자 칸에는 설 수 없다. ${map.file} 의 spawn 오브젝트를 빈 칸으로 옮긴다`,
      )
    }
  }

  return violations
}

/**
 * 공급자가 아직 없는 사실을 쓴 대사를 안내로 모은다.
 *
 * validateGameData 의 결과(violations)에는 넣지 않는다 — 빌드를 막는 실패가
 * 아니라 "언젠가 쓰일 준비가 됐다"는 정보이기 때문이다(설계 문서 6.3: 작가가
 * 미리 써 두는 것과 오타는 다른 일이다). build.ts 가 이 함수의 결과를
 * violations 와 별도로 출력한다.
 *
 * 사실 이름별로 묶는다 — `quest.촌장`·`quest.보리`처럼 접두사가 같아도
 * 구체적인 이름이 다르면 따로 센다. "정확히 어느 사실이 무엇을 막고
 * 있는지"가 "quest 전체가 막혔다"보다 작가에게 쓸모 있는 정보다.
 */
export function collectDialogueNotices(data: GameData): string[] {
  const totalLinesByFact = new Map<string, number>()

  for (const rule of data.dialogue) {
    // 한 규칙 안에서 같은 사실을 두 번 조건으로 걸어도(드물지만 가능하다)
    // 그 규칙의 줄 수를 두 번 더하지 않도록 Set 으로 한 번만 센다.
    const unsuppliedFacts = new Set(
      rule.conditions.map((c) => c.fact).filter((fact) => findFactSpec(fact)?.supplied === false),
    )
    for (const fact of unsuppliedFacts) {
      totalLinesByFact.set(fact, (totalLinesByFact.get(fact) ?? 0) + rule.lines.length)
    }
  }

  return [...totalLinesByFact.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fact, lineCount]) => `대사 ${lineCount}줄이 ${fact} 를 기다린다`)
}

/**
 * 시작 마을마다 대표 채집장이 정확히 하나로 정해지는지 검사한다(설계 규범 14).
 *
 * 캐릭터 생성 화면은 "이 마을을 고르면 이 숙련도로 시작한다"를 말해야 하고,
 * 그 대응을 화면에 적지 않고 세계의 생김새에서 유도한다(maps.ts 의
 * `villageField`). 유도가 실패하는 순간은 정확히 둘이다 — 마을에 채집장을
 * 이어 주는 것을 잊었거나, 한 마을이 두 개의 채집장을 갖게 되었거나.
 * **둘 다 화면이 조용히 틀린 말을 하게 되는 자리라 빌드를 세운다.**
 *
 * validateGameData 와 나눠 두지 않고 여기 붙이지 않은 이유는 반대다: 이 검사는
 * 전환표와 배치가 이미 온전할 때에만 뜻이 있는데, 그 둘의 위반은 다른
 * 검사들이 이미 말한다. 그래서 이 검사는 던지는 유도를 잡아 문장으로 옮기는
 * 얇은 겉면이고, 진짜 규칙은 `villageField` 안에 한 번만 적혀 있다.
 */
export function validateVillageFields(data: GameData): string[] {
  const violations: string[] = []
  const claimed = new Map<string, string>()

  let villages: MapDef[]
  try {
    villages = startVillages(data)
  } catch (err) {
    return [`시작 마을 목록을 만들 수 없다: ${(err as Error).message}`]
  }

  for (const village of villages) {
    try {
      const field = villageField(data, village.id)
      // 두 마을이 같은 채집장을 대표로 삼으면 "시작 마을 = 첫 숙련도" 가 둘로
      // 갈라진다 — 고르는 화면에서는 서로 다른 마을인데 시작하는 자리는 같다.
      const owner = claimed.get(field.map.id)
      if (owner) {
        violations.push(
          `마을 "${village.id}" 와 "${owner}" 가 같은 채집장 "${field.map.id}" 를 대표로 삼는다`,
        )
      }
      claimed.set(field.map.id, village.id)
    } catch (err) {
      violations.push((err as Error).message)
    }
  }

  return violations
}
