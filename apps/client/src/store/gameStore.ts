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
  NETWORK_ERROR,
  type CraftOutcomeDto,
  type GatherOutcomeDto,
} from '../api/GameClient.js'
import { syncClock } from '../time/clock.js'

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

/**
 * 서버 연결 상태.
 *
 * 이 게임은 모든 판정을 서버가 한다. 서버에 닿지 못하면 채집도 제작도 불가능하므로
 * 반쯤 동작하는 화면을 보여주는 대신 진입 자체를 막는다. 오프라인 플레이(설계 문서
 * 3.4 의 인프로세스 서버)는 게임 구조가 자리잡은 뒤에 별도로 만든다.
 */
export type Connection = 'connecting' | 'online' | 'offline'

interface GameStore {
  data: GameData
  player: PlayerState | null
  connection: Connection
  lastAction: ActionFeedback | null
  connect: () => Promise<void>
  gather: (nodeId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
}

let actionSeq = 0

/** 서버와 말 자체를 못 한 경우에만 true. HTTP 4xx 는 서버가 살아있는 것이다. */
function isNetworkFailure(err: unknown): boolean {
  return err instanceof ApiError && err.code === NETWORK_ERROR
}

/**
 * 게임 상태의 단일 소유자.
 * Phaser 씬과 React 컴포넌트 둘 다 이 스토어만 읽고 쓴다.
 * 어느 쪽도 플레이어 상태 사본을 따로 들고 있지 않다.
 */
export const useGameStore = create<GameStore>((set) => ({
  data: loadGameData(),
  player: null,
  connection: 'connecting',
  lastAction: null,

  /**
   * 게임 진입 조건. 서버 시계를 맞추고 플레이어 상태를 받아온다.
   *
   * 둘 중 하나라도 실패하면 offline 으로 두고 게이트가 진입을 막는다. 다시 시도
   * 버튼도 이 함수를 부르므로, 최초 접속과 재연결이 같은 경로를 탄다.
   */
  connect: async () => {
    set({ connection: 'connecting' })

    if (!(await syncClock())) {
      set({ connection: 'offline' })
      return
    }

    try {
      const { player } = await GameClient.getState()
      set({ player, connection: 'online' })
    } catch (err) {
      set({ connection: 'offline' })
      console.error(err)
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
      // 서버와 끊겼으면 머리 위 글자로 알릴 게 아니라 게이트로 내보낸다.
      if (isNetworkFailure(err)) {
        set({ connection: 'offline' })
        return
      }
      pushAction(set, describeError(err), 'bad')
      console.error(err)
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
      if (isNetworkFailure(err)) {
        set({ connection: 'offline' })
        return
      }
      pushAction(set, describeError(err), 'bad')
      console.error(err)
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
