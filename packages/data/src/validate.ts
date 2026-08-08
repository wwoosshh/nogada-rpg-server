import type { GameData, MilestoneDef } from '@nogada/shared'
import { ONCE_EVENTS, SKILL_IDS, STARTING_TOOL_IDS, actionIntervalMs, findFactSpec, toolAppliesTo } from '@nogada/shared'

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

  // ---- 대화 검사 ----
  //
  // 여기부터는 화자(speakers)·대사(dialogue)를 본다. 위쪽의 이른 반환(참조
  // 무결성 위반 시 도달 가능성 계산을 건너뛰는 것)에는 걸리지 않는다 —
  // 아이템·레시피·이정표 오타와 대사 데이터는 서로 다른 것을 참조해서,
  // 한쪽의 오타가 다른 쪽의 진짜 문제를 가릴 이유가 없다. 대사 검사가
  // 참조하는 것(SKILL_IDS, data.milestones)은 이미 그 자체로 안전하거나
  // (SKILL_IDS 는 코드 상수) 독립적으로 검사된다(위 이정표 검사).
  const speakersList = Object.values(data.speakers)
  const speakerIds = new Set(speakersList.map((s) => s.id))
  const dialogueSpeakerIds = new Set(data.dialogue.map((r) => r.speaker))
  // milestoneIds 는 위 이정표 검사가 이미 선언했다 — 여기서 다시 만들지 않고 그대로 쓴다.
  const isKnownSkill = (id: string): boolean => (SKILL_IDS as readonly string[]).includes(id)

  // 선언되지 않은 사실 이름을 쓰는 조건 — 오타(affinty)가 조용히 "절대 안
  // 맞는 조건"이 되면 작가가 원인을 못 찾는다(설계 문서 6.3).
  for (const rule of data.dialogue) {
    for (const condition of rule.conditions) {
      if (!findFactSpec(condition.fact)) {
        violations.push(
          `dialogue[${rule.speaker}] ${rule.source.file}:${rule.source.line}행: 선언되지 않은 사실 "${condition.fact}" 를 쓴다`,
        )
      }
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

  // 같은 사건 안에서 다른 규칙에 완전히 가려지는 규칙 — 조건이 다른 규칙의
  // 부분집합이면서 개수가 적으면, 그 다른 규칙이 맞을 때는 항상 조건 개수가
  // 더 많은 그 규칙에 밀린다(selectDialogue 는 사건 안에서 조건 최댓값만
  // 남긴다). 조건 0개(무조건 규칙)는 이 검사에서 뺀다 — 그건 "무조건 규칙
  // 필수" 검사가 요구하는 정상 상태이고, 더 구체적인 형제 규칙과 나란히
  // 있는 것 자체가 이 시스템의 핵심 패턴이다(설계 4.4절 "새 상황을 추가할
  // 때 기존 줄을 건드리지 않는다").
  for (const rule of data.dialogue) {
    if (rule.conditions.length === 0) continue
    const shadowedBy = data.dialogue.find(
      (other) =>
        other !== rule &&
        other.speaker === rule.speaker &&
        other.event === rule.event &&
        other.conditions.length > rule.conditions.length &&
        rule.conditions.every((c) =>
          other.conditions.some((oc) => oc.fact === c.fact && oc.op === c.op && oc.value === c.value),
        ),
    )
    if (shadowedBy) {
      violations.push(
        `dialogue[${rule.speaker}] ${rule.source.file}:${rule.source.line}행: 규칙이 같은 사건(${rule.event})의 다른 규칙(${shadowedBy.source.file}:${shadowedBy.source.line}행)에 완전히 가려진다 (조건이 그 규칙의 부분집합이고 개수가 적다)`,
      )
    }
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

  // 없는 이정표·기술을 가리키는 조건 — 이정표 검사에서 배운 것과 같다:
  // 데이터가 서로를 가리키면 빌드가 그 참조를 확인한다.
  for (const rule of data.dialogue) {
    for (const condition of rule.conditions) {
      if (condition.fact.startsWith('milestone.')) {
        const id = condition.fact.slice('milestone.'.length)
        if (!milestoneIds.has(id)) {
          violations.push(
            `dialogue[${rule.speaker}] ${rule.source.file}:${rule.source.line}행: 존재하지 않는 이정표 "${id}" 를 가리킨다`,
          )
        }
      } else if (condition.fact.startsWith('skill.')) {
        const id = condition.fact.slice('skill.'.length)
        if (!isKnownSkill(id)) {
          violations.push(
            `dialogue[${rule.speaker}] ${rule.source.file}:${rule.source.line}행: 존재하지 않는 기술 "${id}" 를 가리킨다`,
          )
        }
      }
    }
  }

  // once 사건(story·quest·milestone)의 조건이 상한 없는 사실(skill.* 등,
  // FactSpec.unbounded)에 크기 비교(>,>=,<,<=)를 걸면 문제가 생긴다 —
  // onceKey(packages/shared/src/dialogue.ts)는 조건의 "지금 값"을 그대로
  // 엮으므로, 채집할 때마다 오르는 skill.ice 같은 값에 걸면 값이 바뀔
  // 때마다 새 키가 생겨 "한 번만 말한다"가 조용히 "말할 때마다 새로
  // 말한다"로 깨지고 dialogueHistory.said 가 무한히 자란다(Task 1 리뷰
  // 지적). 등호(`quest.촌장=3` 같은)는 다른 문제다 — 이산 값이 바뀌는 일
  // 자체가 드물고, 그때 다시 말하는 것은 의도된 동작이다(설계 4.2절).
  const MAGNITUDE_OPS: ReadonlySet<string> = new Set(['>', '>=', '<', '<='])
  for (const rule of data.dialogue) {
    if (!ONCE_EVENTS.has(rule.event)) continue
    for (const condition of rule.conditions) {
      if (!MAGNITUDE_OPS.has(condition.op)) continue
      if (findFactSpec(condition.fact)?.unbounded) {
        violations.push(
          `dialogue[${rule.speaker}] ${rule.source.file}:${rule.source.line}행: once 사건(${rule.event})의 조건 "${condition.fact}${condition.op}${condition.value}" 이 상한 없는 사실에 크기 비교를 건다 — dialogueHistory.said 가 무한히 자란다`,
        )
      }
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
