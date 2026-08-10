import { loadGameData } from '@nogada/data'
import {
  calcCraftSuccess,
  calcGatherChance,
  equippedToolTier,
  type GameData,
  type MilestoneDef,
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
  type MoveOutcomeDto,
  type TalkOutcomeDto,
} from '../api/GameClient.js'
import type { DetailMenuTab } from '../game/detailMenuTabs.js'
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
  /**
   * 같은 키의 결과가 연달아 오면 새 글자를 만들지 않고 기존 글자에 더한다.
   * null 이면 누적하지 않고 매번 새로 띄운다.
   */
  groupKey: string | null
  amount: number
}

/**
 * 노가다 사이사이의 사건.
 *
 * 원작이 8,000시간을 버틴 이유는 반복 자체가 아니라 반복이 무언가를 향하고
 * 있었기 때문이다. 자동 반복 해금은 그 첫 번째 사건이 될 수 있다 — 조용히
 * 켜지면 아무도 알아채지 못하고, 그러면 문턱을 둔 의미가 사라진다.
 */
export interface Milestone {
  seq: number
  text: string
}

/**
 * 화자가 지금 한 말.
 *
 * `lines` 는 한 마디 전체다 — 대사창이 순서대로 넘길 칸들이고, 칸마다 서버에
 * 다시 묻지 않는다. 서버가 한 번의 판정으로 전부 정해서 보낸다.
 *
 * milestone 채널과 같은 모양(seq 로 "새 사건"을 구분)을 쓴다: 같은 화자에게
 * 두 번 말을 걸어 같은 대사가 다시 나와도(동점 후보가 하나뿐인 경우) seq 가
 * 올라가야 구독자가 "이미 처리한 발화"로 착각해 무시하지 않는다.
 */
export interface Utterance {
  seq: number
  /** 화자 id. 이름·초상은 구독자가 `data.speakers` 에서 찾는다. */
  speaker: string
  lines: string[]
}

/**
 * 서버 연결 상태.
 *
 * 이 게임은 모든 판정을 서버가 한다. 서버에 닿지 못하면 채집도 제작도 불가능하므로
 * 반쯤 동작하는 화면을 보여주는 대신 진입 자체를 막는다. 오프라인 플레이(설계 문서
 * 3.4 의 인프로세스 서버)는 게임 구조가 자리잡은 뒤에 별도로 만든다.
 */
export type Connection = 'connecting' | 'online' | 'offline'

/**
 * 화자가 없는 말 — 대사창 자리에 뜨는 짧은 안내.
 *
 * 발화(Utterance)와 채널을 나눈 이유는 **말한 사람이 없기 때문이다.** 발화를
 * 들은 WorldScene 은 그 화자를 플레이어 쪽으로 돌려세우는데(faceSpeakerToPlayer),
 * 여기 오는 것은 애초에 그 자리에 없는 사람이라 돌려세울 몸이 없다. 같은 채널에
 * 실으면 그 구독이 "누구인지 모를 화자"를 매번 골라내야 한다.
 *
 * seq 는 다른 채널들과 같은 이유다: 같은 문 앞에서 두 번 눌러 같은 글이 다시
 * 나와도 구독자가 "이미 처리했다"로 착각해 무시하지 않는다.
 */
export interface Notice {
  seq: number
  text: string
}

/**
 * 없는 사람에게 말을 걸었을 때 뜨는 글.
 *
 * 서버가 `not_here` 로 답하는 경우는 둘이다 — 실내로 들어갔거나(밤의 여관),
 * 길 위를 걷는 중이다. 어느 쪽인지 말하지 않는 것이 맞다: 플레이어가 아는 것은
 * "여기 없다" 까지이고, 어디 갔는지는 하루를 지켜봐서 알아내는 것이 이 시스템의
 * 재미다. 화면에 보이는 사람에게 말을 걸었는데 이 글이 뜨는 일은 없다 —
 * 걷는 사람은 앞칸 판정에 아예 오르지 않는다(npcScheduler 의 isTalkable).
 */
const NOT_HERE_NOTICE = '지금 여기 없는 것 같다.'

/**
 * 상단 바 톱니(React)가 상세 메뉴(Phaser 씬)를 열어 달라는 요청.
 *
 * 톱니는 DOM 버튼이고 메뉴는 PanelScene 안의 Phaser 오브젝트라 직접 부를 수 없다 —
 * App.tsx 를 건드리지 않고 두 세계를 잇는 유일한 통로가 이 스토어다. milestone
 * 채널과 같은 모양(seq 로 "새 사건"을 구분)을 쓴다: 같은 tab 을 두 번 연달아
 * 요청해도(예: 톱니를 두 번 누름) seq 가 매번 올라가야 PanelScene 의 구독이
 * "이미 처리한 요청"으로 착각해 무시하지 않는다.
 */
export interface MenuRequest {
  seq: number
  tab: DetailMenuTab
}

interface GameStore {
  data: GameData
  player: PlayerState | null
  connection: Connection
  lastAction: ActionFeedback | null
  milestone: Milestone | null
  utterance: Utterance | null
  notice: Notice | null
  menuRequest: MenuRequest | null
  connect: () => Promise<void>
  gather: (instanceId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
  talk: (speakerId: string) => Promise<void>
  move: (x: number, y: number) => Promise<void>
  openMenu: (tab: DetailMenuTab) => void
}

let actionSeq = 0
let milestoneSeq = 0
let utteranceSeq = 0
let noticeSeq = 0
let menuRequestSeq = 0

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
  milestone: null,
  utterance: null,
  notice: null,
  menuRequest: null,

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

  gather: async (instanceId) => {
    try {
      const outcome: GatherOutcomeDto = await GameClient.gather(instanceId)
      applyPlayer(set, outcome.player)
      pushMilestones(set, outcome.achieved)

      if (outcome.success && outcome.gained) {
        const name = labelOf(useGameStore.getState().data, outcome.gained.item)
        pushAction(
          set,
          `${name} +${outcome.gained.count}`,
          'good',
          outcome.gained.item,
          outcome.gained.count,
        )
      } else {
        pushAction(set, '실패', 'bad', 'gather-fail', 1)
      }
    } catch (err) {
      // 행동 간격은 조용히 넘긴다. 아직 다음 행동 시각이 안 된 상태에서 누르는
      // 것은 실수가 아니라 정상적인 조작이라, 매번 알리면 연타할수록 화면이
      // 경고로 덮인다.
      if (err instanceof ApiError && err.code === 'too_fast') return
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
      applyPlayer(set, outcome.player)
      pushMilestones(set, outcome.achieved)

      if (outcome.success && outcome.produced) {
        const name = labelOf(useGameStore.getState().data, outcome.produced.item)
        const suffix = outcome.autoEquipped ? ' · 자동 착용' : ''
        // 자동 착용이 붙으면 누적하지 않는다. 도구를 새로 낀 것은 수치로 뭉갤 사건이 아니다.
        const groupKey = outcome.autoEquipped ? null : outcome.produced.item
        pushAction(
          set,
          `${name} +${outcome.produced.count}${suffix}`,
          'good',
          groupKey,
          outcome.produced.count,
        )
      } else {
        pushAction(set, '제작 실패', 'bad', 'craft-fail', 1)
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'too_fast') return
      if (isNetworkFailure(err)) {
        set({ connection: 'offline' })
        return
      }
      pushAction(set, describeError(err), 'bad')
      console.error(err)
    }
  },

  /**
   * 말을 건다. 대화 한 번이 요청 한 번이고, 발화 전체가 한 번에 온다.
   *
   * 실패 중 **하나만** 플레이어에게 보인다. 없는 화자·할 말 없음은 데이터나
   * 콘텐츠의 구멍이라 보여 줄 말이 없지만, `not_here` 는 다르다 — 그건 세계가
   * 제대로 돌아간 결과이고(그 사람은 지금 실내에 있거나 길 위에 있다) 플레이어의
   * 조작도 옳았다. 아무 일도 안 일어나면 "여기 눌러도 되는 자리인가"부터
   * 의심하게 되므로, 그 자리에 짧은 안내를 띄운다(설계 §5).
   *
   * 그 밖의 실패에는 스토어가 아무것도 바꾸지 않는다 — 대사창은 열리지 않고
   * 플레이어 상태도 그대로다.
   */
  talk: async (speakerId) => {
    try {
      const outcome: TalkOutcomeDto = await GameClient.talk(speakerId)
      applyPlayer(set, outcome.player)
      set({ utterance: { seq: ++utteranceSeq, speaker: outcome.speaker, lines: outcome.lines } })
    } catch (err) {
      // 서버와 끊겼으면 대사창이 아니라 게이트가 할 일이다 — 채집과 같다.
      if (isNetworkFailure(err)) {
        set({ connection: 'offline' })
        return
      }
      if (err instanceof ApiError && err.code === 'not_here') {
        set({ notice: { seq: ++noticeSeq, text: NOT_HERE_NOTICE } })
        return
      }
      console.error(err)
    }
  },

  /**
   * 전환 칸을 밟았다고 알린다. 도착지는 서버가 정해서 `player.location` 으로 온다.
   *
   * 채집·제작·대화와 달리 **실패를 삼키지 않고 다시 던진다.** 호출자(WorldScene)는
   * 성공했을 때에만 씬을 다시 시작해야 하는데, 여기서 삼키면 실패도 성공처럼
   * 보여서 서버가 거절한 전환에도 씬이 재시작된다 — 그러면 플레이어는 지금
   * 서 있던 칸이 아니라 **마지막 전환 도착 칸**으로 되돌아가 순간이동한 것처럼
   * 보인다. 대사창처럼 "아무것도 안 일어난다"로 끝낼 수 있는 실패가 아니다.
   *
   * 머리 위 글자로 알리지도 않는다. 전환이 거절되는 경우는 클라이언트와 서버가
   * 서로 다른 전환표를 보고 있을 때뿐이라 플레이어에게 보여 줄 말이 없다.
   */
  move: async (x, y) => {
    try {
      const outcome: MoveOutcomeDto = await GameClient.move(x, y)
      applyPlayer(set, outcome.player)
    } catch (err) {
      // 서버와 끊겼으면 세계를 다시 그릴 게 아니라 게이트가 할 일이다 — 채집과 같다.
      if (isNetworkFailure(err)) set({ connection: 'offline' })
      else console.error(err)
      throw err
    }
  },

  // 톱니 클릭 자체는 게임 상태가 아니지만, App.tsx 를 건드리지 않고 React ->
  // Phaser 로 "메뉴를 열어라"를 전달할 통로가 이 스토어뿐이라 여기 둔다.
  openMenu: (tab) => set({ menuRequest: { seq: ++menuRequestSeq, tab } }),
}))

type SetFn = (partial: Partial<GameStore>) => void

function pushAction(
  set: SetFn,
  text: string,
  tone: ActionFeedback['tone'],
  groupKey: string | null = null,
  amount = 1,
): void {
  set({ lastAction: { seq: ++actionSeq, text, tone, groupKey, amount } })
}

function applyPlayer(set: SetFn, next: PlayerState): void {
  set({ player: next })
}

/**
 * 서버가 이번 행동에서 새로 달성됐다고 알린 이정표 중, 화면에 알릴 것만 채널에 싣는다.
 *
 * `announce` 가 빈 문자열인 이정표는 달성으로는 세지만(서버가 이미 celebrated 에
 * 넣었다) 화면에는 띄우지 않는다 — 같은 문턱을 여러 기술이 동시에 넘을 때 전부
 * 띄우면 화면이 묻힌다.
 *
 * 여러 개가 한 번에 오면 각각 다른 seq 로 순서대로 싣는다. 겹쳐 보이지 않게
 * 줄 세워 하나씩 보여주는 일은 구독자(WorldScene)가 큐를 들고 한다 — 여기서는
 * "무엇을, 몇 번째로" 만 정한다.
 */
function pushMilestones(set: SetFn, achieved: readonly MilestoneDef[]): void {
  for (const m of achieved) {
    if (m.announce === '') continue
    set({ milestone: { seq: ++milestoneSeq, text: m.announce } })
  }
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
    case 'too_fast':
      return '너무 빠릅니다'
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
    proficiency: player.skills[node.skill],
    toolTier: equippedToolTier(player, data, node.skill),
    node,
  })
}

export function selectCraftChance(recipeId: string): number {
  const { player, data } = useGameStore.getState()
  const recipe = data.recipes[recipeId]
  if (!player || !recipe) return 0
  return calcCraftSuccess({
    proficiency: player.skills[recipe.skill],
    toolTier: equippedToolTier(player, data, recipe.skill),
    recipe,
  })
}
