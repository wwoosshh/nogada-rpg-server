import type { GameData, MilestoneDef } from '@nogada/shared'
import { STARTING_TOOL_IDS, toolAppliesTo } from '@nogada/shared'

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

  // 여기까지의 참조 무결성 검사가 이미 위반을 찾았다면 도달 가능성 검사(고정점 계산)는
  // 건너뛴다. 안 그러면 오타 하나가 그 아이템에 의존하는 나머지 전부를 "도달 불가"로
  // 도매금 처리해 진짜 원인이 N+1 줄의 소음에 파묻힌다.
  if (violations.length > 0) return violations

  const reachable = computeReachableItems(data)
  for (const item of Object.values(data.items)) {
    if (!reachable.has(item.id)) {
      violations.push(`items[${item.id}]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)`)
    }
  }

  // 이정표는 새 게이트를 만들지 않고 이미 존재하는 게이트를 선언할 뿐이다(설계 §2.3,
  // §3.1). 그래서 아래 검사들은 "선언"이 논리적으로 말이 되는지, 그리고 "선언"과
  // "실제 게이트"가 어긋나지 않는지를 본다.
  const milestoneIds = new Set(data.milestones.map((m) => m.id))

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

  return violations
}
