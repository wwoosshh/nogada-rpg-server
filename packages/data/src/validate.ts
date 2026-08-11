import type { Condition, DialogueRule, FactValue, GameData, MapDef, MilestoneDef } from '@nogada/shared'
import {
  EVENT_ORDER,
  ONCE_EVENTS,
  SKILL_IDS,
  STARTING_TOOL_IDS,
  actionIntervalMs,
  describeFactValueShape,
  factValueFitsShape,
  findFactSpec,
  matchesCondition,
  toolAppliesTo,
} from '@nogada/shared'
import { dialogueLocation } from './dialogueParse.js'
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
 * 시작 도구에서 출발해 고정점(fixpoint)까지 확장한 "도달 가능한 아이템" 집합을 구한다.
 *
 * - 채집 노드: 이미 도달 가능한 도구 중 그 노드의 숙련(skill)과 같고 등급(toolTier)이
 *   노드 등급(tier) 이상인 것이 하나라도 있으면, 그 노드의 산출물이 도달 가능해진다.
 * - 레시피: 재료(inputs)가 전부 도달 가능해지면 산출물이 도달 가능해진다.
 *
 * 숙련도는 일부러 보지 않는다 — 다만 그 이유가 채집과 제작에서 다르다.
 *
 * 채집은 도구 등급만이 접근 게이트이고 숙련도는 게이트가 아니므로, 그라인딩으로
 * 언젠가 항상 도달한다 (도구 등급만이 아무리 그라인딩해도 못 넘는 하드 게이트다).
 *
 * 제작은 다르다 — 조합 숙련도는 `craftService` 의 성공 경로에서만 오르고, 그
 * 성공 경로 자체가 `canCraft` 의 requiredSkill 게이트 뒤에 있다. 즉 숙련도를
 * 올리려면 이미 그 레시피를 열 숙련도가 있어야 하는 순환이라, "그라인딩하면
 * 언젠가 도달한다"는 채집과 달리 제작에는 그냥 성립하지 않는다. 이 함수가 그래도
 * requiredSkill 을 보지 않아도 되는 이유는, 스킬마다 requiredSkill 0 인 레시피가
 * 최소 하나 있어야 한다는 것을 별도 규칙(아래 validateGameData)이 보장하기
 * 때문이다 — 그 보장이 없으면 이 fixpoint 는 아이템 참조 사슬만 보고 "도달
 * 가능"이라 오판한다.
 */
function computeReachableItems(data: GameData): Set<string> {
  const reachable = new Set<string>(STARTING_TOOL_IDS)
  const tools = Object.values(data.items).filter((item) => item.kind === 'tool')

  let changed = true
  while (changed) {
    changed = false

    for (const node of Object.values(data.nodes)) {
      if (reachable.has(node.yieldItem)) continue
      const hasCoveringTool = tools.some((tool) => reachable.has(tool.id) && toolAppliesTo(tool, node))
      if (hasCoveringTool) {
        reachable.add(node.yieldItem)
        changed = true
      }
    }

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
 */
export function validateGameData(data: GameData): string[] {
  const violations: string[] = []
  const hasItem = (id: string): boolean => Object.hasOwn(data.items, id)

  // 놓이지 않은 노드는 데이터에만 있고 게임에는 없다 — 플레이어가 닿을 방법이
  // 아예 없으므로, CSV에 행을 추가하고 맵에 놓는 것을 잊은 경우를 빌드 타임에 잡는다.
  const placedNodeIds = new Set(Object.values(data.placements).map((p) => p.nodeId))

  for (const node of Object.values(data.nodes)) {
    if (!hasItem(node.yieldItem)) {
      violations.push(`nodes[${node.id}]: 존재하지 않는 아이템 "${node.yieldItem}" 를 산출한다`)
    }
    if (node.yieldMin > node.yieldMax) {
      violations.push(`nodes[${node.id}]: yieldMin 이 yieldMax 보다 크다`)
    }
    if (node.baseChance <= 0 || node.baseChance >= 1) {
      violations.push(`nodes[${node.id}]: baseChance 가 0 초과 1 미만이 아니다`)
    }
    if (node.skillGainMin > node.skillGainMax) {
      violations.push(`nodes[${node.id}]: skillGainMin 이 skillGainMax 보다 크다`)
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
  }

  // 조합 숙련도는 craftService 의 성공 경로에서만 오르고, 그 성공 경로 자체가
  // canCraft 의 requiredSkill 게이트 뒤에 있다 — 그라인딩으로 숙련도를 올리려면
  // 이미 그 레시피를 열 숙련도가 있어야 하는 순환이다. 스킬마다 requiredSkill 0 인
  // 레시피가 하나도 없으면 그 숙련도는 영원히 0에 머물러 어떤 레시피도 못 연다.
  // 이 상태는 위 도달 가능성 계산으로는 잡히지 않는다 — 그 계산은 아이템 참조
  // 사슬만 보고 requiredSkill 은 아예 보지 않기 때문이다.
  const skillsUsedByRecipes = new Set(Object.values(data.recipes).map((recipe) => recipe.skill))
  for (const skill of skillsUsedByRecipes) {
    const hasBootstrapRecipe = Object.values(data.recipes).some(
      (recipe) => recipe.skill === skill && recipe.requiredSkill === 0,
    )
    if (!hasBootstrapRecipe) {
      violations.push(`skills[${skill}]: requiredSkill 0 인 레시피가 없어 영원히 부트스트랩할 수 없다`)
    }
  }

  // 시작 도구는 채집·제작을 거치지 않고 캐릭터 생성 시 바로 지급되므로 그 자체로
  // "획득 가능"하다 — computeReachableItems 가 이미 이 상수로 reachable 을 시드하는
  // 것과 같은 이유다. 시드하지 않으면 레시피가 없는 시작 도구(예: 되사서 못 만드는
  // 최초 장비)가 매번 "채집으로도 제작으로도 획득할 수 없다"로 오탐된다.
  const obtainable = new Set<string>(STARTING_TOOL_IDS)
  for (const node of Object.values(data.nodes)) obtainable.add(node.yieldItem)
  for (const recipe of Object.values(data.recipes)) obtainable.add(recipe.output.item)
  for (const item of Object.values(data.items)) {
    if (!obtainable.has(item.id)) {
      violations.push(`items[${item.id}]: 채집으로도 제작으로도 획득할 수 없다`)
    }
  }

  // STARTING_TOOL_IDS(코드 상수)가 실제 아이템 데이터와 어긋나지 않는지 미리 검사한다.
  // computeReachableItems 는 이 상수를 시드로 그대로 믿기 때문에, 가리키는 아이템이
  // 없거나 도구가 아니면 시드가 통째로 비어 데이터의 모든 아이템이 "도달 불가"로
  // 잡힌다 — 예컨대 CSV에서 copper_pickaxe 를 개명하고 이 상수 갱신을 놓쳤을 때.
  for (const toolId of STARTING_TOOL_IDS) {
    const item = data.items[toolId]
    if (!item) {
      violations.push(`STARTING_TOOL_IDS: 존재하지 않는 아이템 "${toolId}" 를 가리킨다`)
    } else if (item.kind !== 'tool') {
      violations.push(`STARTING_TOOL_IDS: "${toolId}" 는 도구가 아니다`)
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

  // 참조 무결성 검사가 이미 위반을 찾았다면 도달 가능성 검사(고정점 계산)는
  // 건너뛴다. 안 그러면 오타 하나가 그 아이템에 의존하는 나머지 전부를 "도달 불가"로
  // 도매금 처리해 진짜 원인이 N+1 줄의 소음에 파묻힌다.
  if (referenceViolations > 0) return violations

  const reachable = computeReachableItems(data)
  for (const item of Object.values(data.items)) {
    if (!reachable.has(item.id)) {
      violations.push(`items[${item.id}]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)`)
    }
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

  // 채집 기술(노드가 존재하는 기술)마다 자동 반복을 여는 repeat 이정표가 정확히
  // 하나씩 있어야 한다. 하나도 없으면 그 기술은 영원히 자동 반복을 얻지 못한다는
  // 사실이 목록 어디에도 드러나지 않고, 여럿이면 어느 것이 "그" 반복 이정표인지
  // 목록에서 모호해진다. crafting 처럼 노드가 없는 기술은 이 검사 대상이 아니다 —
  // 채집 노드 자체가 없으니 "채집 기술" 이 아니다.
  const gatheringSkills = new Set(Object.values(data.nodes).map((node) => node.skill))
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
