import { loadGameData } from '@nogada/data'
import {
  calcCraftSuccess,
  calcGatherChance,
  equippedToolTier,
  type GameData,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'
import { create } from 'zustand'
import {
  ApiError,
  GameClient,
  type CraftOutcomeDto,
  type GatherOutcomeDto,
} from '../api/GameClient.js'

/**
 * 캐릭터 머리 위에 띄울 행동 결과.
 *
 * seq 는 같은 문구가 연달아 나올 때(구리 원석 +1 을 두 번 캐는 경우)도
 * 구독자가 새 사건임을 알 수 있게 한다. 문구만 비교하면 두 번째를 놓친다.
 */
export interface ActionFeedback {
  seq: number
  text: string
  tone: 'good' | 'bad'
}

interface GameStore {
  data: GameData
  player: PlayerState | null
  loading: boolean
  lastAction: ActionFeedback | null
  refresh: () => Promise<void>
  gather: (nodeId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
}

let actionSeq = 0

/**
 * 게임 상태의 단일 소유자.
 * Phaser 씬과 React 컴포넌트 둘 다 이 스토어만 읽고 쓴다.
 * 어느 쪽도 플레이어 상태 사본을 따로 들고 있지 않다.
 */
export const useGameStore = create<GameStore>((set) => ({
  data: loadGameData(),
  player: null,
  loading: false,
  lastAction: null,

  refresh: async () => {
    set({ loading: true })
    try {
      const { player } = await GameClient.getState()
      set({ player, loading: false })
    } catch (err) {
      set({ loading: false })
      pushAction(set, describeError(err), 'bad')
    }
  },

  gather: async (nodeId) => {
    try {
      const outcome: GatherOutcomeDto = await GameClient.gather(nodeId)
      set({ player: outcome.player })

      if (outcome.success && outcome.gained) {
        const name = labelOf(useGameStore.getState().data, outcome.gained.item)
        pushAction(set, `${name} +${outcome.gained.count}`, 'good')
      } else {
        pushAction(set, '실패', 'bad')
      }
    } catch (err) {
      // 쿨다운은 조용히 넘긴다. 아직 회복되지 않은 노드를 누르는 것은 실수가
      // 아니라 정상적인 조작이라, 매번 알리면 연타할수록 화면이 경고로 덮인다.
      if (err instanceof ApiError && err.code === 'on_cooldown') return
      pushAction(set, describeError(err), 'bad')
    }
  },

  craft: async (recipeId) => {
    try {
      const outcome: CraftOutcomeDto = await GameClient.craft(recipeId)
      set({ player: outcome.player })

      if (outcome.success && outcome.produced) {
        const name = labelOf(useGameStore.getState().data, outcome.produced.item)
        const suffix = outcome.autoEquipped ? ' · 자동 착용' : ''
        pushAction(set, `${name} +${outcome.produced.count}${suffix}`, 'good')
      } else {
        pushAction(set, '제작 실패', 'bad')
      }
    } catch (err) {
      pushAction(set, describeError(err), 'bad')
    }
  },
}))

type SetFn = (partial: Partial<GameStore>) => void

function pushAction(set: SetFn, text: string, tone: ActionFeedback['tone']): void {
  set({ lastAction: { seq: ++actionSeq, text, tone } })
}

function labelOf(data: GameData, itemId: string): string {
  return data.items[itemId]?.name ?? itemId
}

function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return '서버에 연결할 수 없습니다'
  switch (err.code) {
    case 'cannot_gather':
      return '도구나 숙련도 부족'
    case 'level_too_low':
      return '숙련도 부족'
    case 'missing_materials':
      return '재료 부족'
    default:
      return `오류: ${err.code}`
  }
}

// ---- 셀렉터 ----
// 서버와 같은 공식을 써서 예상치를 계산한다. 별도 구현이 아니다.

export function selectToolTier(skill: SkillId): number {
  const { player, data } = useGameStore.getState()
  return player ? equippedToolTier(player, data, skill) : 0
}

export function selectGatherChance(nodeId: string): number {
  const { player, data } = useGameStore.getState()
  const node = data.nodes[nodeId]
  if (!player || !node) return 0
  return calcGatherChance({
    skillLevel: player.skills[node.skill].level,
    toolTier: equippedToolTier(player, data, node.skill),
    node,
  })
}

export function selectCraftChance(recipeId: string): number {
  const { player, data } = useGameStore.getState()
  const recipe = data.recipes[recipeId]
  if (!player || !recipe) return 0
  return calcCraftSuccess({
    skillLevel: player.skills[recipe.skill].level,
    toolTier: equippedToolTier(player, data, recipe.skill),
    recipe,
  })
}
