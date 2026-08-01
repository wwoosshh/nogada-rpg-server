import type { GameData } from '@nogada/shared'

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

  return violations
}
