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

/** 화면에 잠깐 띄우는 최근 행동 결과 */
export interface FeedEntry {
  id: number
  kind: 'gather' | 'craft' | 'error'
  text: string
  success: boolean
}

interface GameStore {
  data: GameData
  player: PlayerState | null
  loading: boolean
  feed: FeedEntry[]
  refresh: () => Promise<void>
  gather: (nodeId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
}

let feedSeq = 0

/**
 * 게임 상태의 단일 소유자.
 * Phaser 씬과 React 컴포넌트 둘 다 이 스토어만 읽고 쓴다.
 * 어느 쪽도 플레이어 상태 사본을 따로 들고 있지 않는다 — 사본이 생기는 순간
 * "인벤토리 UI 엔 반영됐는데 맵엔 안 됐다" 류의 버그가 시작된다.
 */
export const useGameStore = create<GameStore>((set, get) => ({
  data: loadGameData(),
  player: null,
  loading: false,
  feed: [],

  refresh: async () => {
    set({ loading: true })
    try {
      const { player } = await GameClient.getState()
      set({ player, loading: false })
    } catch (err) {
      set({ loading: false })
      pushFeed(set, get, 'error', describeError(err), false)
    }
  },

  gather: async (nodeId) => {
    const { data } = get()
    try {
      const outcome: GatherOutcomeDto = await GameClient.gather(nodeId)
      set({ player: outcome.player })

      const nodeName = data.nodes[nodeId]?.name ?? nodeId
      const text =
        outcome.success && outcome.gained
          ? `${nodeName} — ${labelOf(data, outcome.gained.item)} x${outcome.gained.count} (경험치 +${outcome.xpGained})`
          : `${nodeName} — 실패`
      pushFeed(set, get, 'gather', text, outcome.success)
    } catch (err) {
      pushFeed(set, get, 'error', describeError(err), false)
    }
  },

  craft: async (recipeId) => {
    const { data } = get()
    try {
      const outcome: CraftOutcomeDto = await GameClient.craft(recipeId)
      set({ player: outcome.player })

      const recipeName = data.recipes[recipeId]?.name ?? recipeId
      let text = outcome.success
        ? `${recipeName} 제작 성공 (경험치 +${outcome.xpGained})`
        : `${recipeName} 제작 실패 — 재료 일부 손실`
      if (outcome.autoEquipped) text += ' · 자동 착용됨'
      pushFeed(set, get, 'craft', text, outcome.success)
    } catch (err) {
      pushFeed(set, get, 'error', describeError(err), false)
    }
  },
}))

function labelOf(data: GameData, itemId: string): string {
  return data.items[itemId]?.name ?? itemId
}

function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return '서버에 연결할 수 없습니다'
  switch (err.code) {
    case 'on_cooldown': {
      const sec = Math.max(1, Math.ceil(((err.availableAt ?? 0) - Date.now()) / 1000))
      return `아직 회복되지 않았습니다 (${sec}초)`
    }
    case 'cannot_gather':
      return '도구 등급이나 숙련도가 부족합니다'
    case 'level_too_low':
      return '숙련도가 부족합니다'
    case 'missing_materials':
      return '재료가 부족합니다'
    default:
      return `오류: ${err.code}`
  }
}

type SetFn = (partial: Partial<GameStore>) => void
type GetFn = () => GameStore

function pushFeed(
  set: SetFn,
  get: GetFn,
  kind: FeedEntry['kind'],
  text: string,
  success: boolean,
): void {
  const entry: FeedEntry = { id: ++feedSeq, kind, text, success }
  set({ feed: [entry, ...get().feed].slice(0, 6) })
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
