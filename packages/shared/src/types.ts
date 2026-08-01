export type SkillId = 'mining' | 'smithing'

export const SKILL_IDS: readonly SkillId[] = ['mining', 'smithing'] as const

export interface SkillState {
  level: number
  xp: number
}

/**
 * 강화 수치가 붙는 순간 개별 정체성이 생겨 스택이 불가능하다.
 * M1 에서 enhanceLevel 은 항상 0 이지만 구조는 처음부터 분리해 둔다.
 */
export interface ItemInstance {
  instanceId: string
  itemId: string
  enhanceLevel: number
}

export interface PlayerState {
  id: string
  skills: Record<SkillId, SkillState>
  /** 재료·소모품 — itemId 를 키로 개수만 센다 */
  stacks: Record<string, number>
  /** 장비·도구 — 개별 행 */
  instances: ItemInstance[]
  /** 생활기술별 착용 도구의 instanceId */
  equipped: Partial<Record<SkillId, string>>
  /** 채집 노드별 다음 채집 가능 시각 (epoch ms). 노드는 플레이어별로 리스폰한다. */
  nodeCooldowns: Record<string, number>
}

export interface ItemDef {
  id: string
  name: string
  kind: 'material' | 'tool'
  toolSkill?: SkillId
  toolTier?: number
  icon: string
}

export interface NodeDef {
  id: string
  name: string
  skill: SkillId
  /** 채집에 필요한 최소 도구 등급 */
  tier: number
  requiredLevel: number
  yieldItem: string
  yieldMin: number
  yieldMax: number
  respawnMs: number
}

export interface RecipeInput {
  item: string
  count: number
}

export interface RecipeDef {
  id: string
  name: string
  skill: SkillId
  requiredLevel: number
  inputs: RecipeInput[]
  output: RecipeInput
}

export interface GameData {
  items: Record<string, ItemDef>
  nodes: Record<string, NodeDef>
  recipes: Record<string, RecipeDef>
}
