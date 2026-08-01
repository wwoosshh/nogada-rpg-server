import type { GameData } from '@nogada/shared'
import { STARTING_TOOL_IDS, toolCoversNode } from '@nogada/shared'

/**
 * 시작 도구에서 출발해 고정점(fixpoint)까지 확장한 "도달 가능한 아이템" 집합을 구한다.
 *
 * - 채집 노드: 이미 도달 가능한 도구 중 그 노드의 숙련(skill)과 같고 등급(toolTier)이
 *   노드 등급(tier) 이상인 것이 하나라도 있으면, 그 노드의 산출물이 도달 가능해진다.
 * - 레시피: 재료(inputs)가 전부 도달 가능해지면 산출물이 도달 가능해진다.
 *
 * 숙련도(requiredLevel)는 일부러 보지 않는다 — 숙련도는 속도(pace)를 규정할 뿐이고
 * 그라인딩으로 언젠가는 항상 도달하지만, 도구 등급은 하드 게이트라 아무리 그라인딩해도
 * 못 넘는다. 이 둘을 섞으면 진짜 데드락을 통과시켜 버린다.
 */
function computeReachableItems(data: GameData): Set<string> {
  const reachable = new Set<string>(STARTING_TOOL_IDS)
  const tools = Object.values(data.items).filter((item) => item.kind === 'tool')

  let changed = true
  while (changed) {
    changed = false

    for (const node of Object.values(data.nodes)) {
      if (reachable.has(node.yieldItem)) continue
      const hasCoveringTool = tools.some(
        (tool) =>
          reachable.has(tool.id) &&
          tool.toolSkill === node.skill &&
          toolCoversNode(tool.toolTier ?? 0, node),
      )
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
 * 참조 무결성과 도달 가능성을 검사한다.
 * 위반 목록을 반환하며 빈 배열이면 통과다.
 *
 * 수천 행 CSV의 오타를 런타임이 아니라 빌드 타임에 잡는 것이 목적이다.
 */
export function validateGameData(data: GameData): string[] {
  const violations: string[] = []
  const hasItem = (id: string): boolean => Object.hasOwn(data.items, id)

  for (const node of Object.values(data.nodes)) {
    if (!hasItem(node.yieldItem)) {
      violations.push(`nodes[${node.id}]: 존재하지 않는 아이템 "${node.yieldItem}" 를 산출한다`)
    }
    if (node.yieldMin > node.yieldMax) {
      violations.push(`nodes[${node.id}]: yieldMin 이 yieldMax 보다 크다`)
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
  }

  const obtainable = new Set<string>()
  for (const node of Object.values(data.nodes)) obtainable.add(node.yieldItem)
  for (const recipe of Object.values(data.recipes)) obtainable.add(recipe.output.item)
  for (const item of Object.values(data.items)) {
    if (!obtainable.has(item.id)) {
      violations.push(`items[${item.id}]: 채집으로도 제작으로도 획득할 수 없다`)
    }
  }

  const reachable = computeReachableItems(data)
  for (const item of Object.values(data.items)) {
    if (!reachable.has(item.id)) {
      violations.push(`items[${item.id}]: 시작 도구로는 도달할 수 없다 (도구 등급 게이트에 막힘)`)
    }
  }

  return violations
}
