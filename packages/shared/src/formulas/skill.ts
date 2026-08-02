import type { SkillState } from '../types.js'

/** 현재 레벨에서 다음 레벨까지 필요한 경험치 */
export function xpToNext(level: number): number {
  return level * level * 10 + 50
}

/**
 * 채집 1회당 획득 경험치.
 * 숙련도가 노드 수준(등급 x 10)을 넘어설수록 감소하되 최소 1 은 보장한다.
 */
export function xpGainForGather(nodeTier: number, skillLevel: number): number {
  const base = nodeTier * 15
  const excess = Math.max(0, skillLevel - nodeTier * 10)
  const penalty = Math.max(0.1, 1 - excess * 0.05)
  return Math.max(1, Math.round(base * penalty))
}

/**
 * 제작 1회당 획득 경험치.
 * 숙련도가 레시피 요구 수준을 넘어설수록 감소하되 최소 1 은 보장한다.
 */
export function xpGainForCraft(recipeRequiredLevel: number, skillLevel: number): number {
  const base = recipeRequiredLevel * 5 + 20
  const excess = Math.max(0, skillLevel - recipeRequiredLevel)
  const penalty = Math.max(0.1, 1 - excess * 0.04)
  return Math.max(1, Math.round(base * penalty))
}

/** 경험치를 더하고 필요 시 레벨을 올린다. 원본을 변경하지 않는다. */
export function applyXp(state: SkillState, gain: number): SkillState {
  let level = state.level
  let xp = state.xp + gain
  while (xp >= xpToNext(level)) {
    xp -= xpToNext(level)
    level += 1
  }
  return { level, xp }
}
