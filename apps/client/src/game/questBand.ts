import { storyChainOf } from '@nogada/data'
import { metricValue, type GameData, type PlayerState, type StoryStep } from '@nogada/shared'

/**
 * 헤더 밑 한 줄짜리 띠가 **무엇을 적는가**(설계 ⑧-6) — Phaser 없는 순수 조립.
 *
 * detailMenuTabs.ts 와 같은 자세다: 무엇을 적을지는 여기서 정하고, 그것을 화면의
 * 사각형과 글자로 만드는 일은 HudScene 의 몫이다. 그래서 이 파일이 내리는 판단은
 * 브라우저 없이 잴 수 있다.
 *
 * **문구는 story.csv 한 곳에서 나온다.** 마디마다의 글은 `storyChainOf` 가 그
 * 사람의 마을로 편 `objective` 를 **그대로** 쓴다 — 화면이 적는 목적과 서버가
 * 재는 목적이 같은 자리에서 나와야 「얼음 조각 200개」를 적어 놓고 다른 것을
 * 세는 날이 없다. 여기에 문구를 한 줄이라도 다시 타이핑하면 그것이 두 번째
 * 사본이고, 언젠가 한쪽만 고쳐진다(`ALREADY_FULL_TEXT` 가 그 교훈이다).
 *
 * **판정하지 않는다.** 서버가 유일한 판정자다 — 이 파일이 읽는 `story`·
 * `storyCount` 는 서버가 정해 보낸 수이고, 여기서 하는 일은 그 수를 글로 옮기는
 * 것뿐이다. 사슬을 펴는 계산(`storyChainOf`)을 클라가 다시 도는 것은 판정이
 * 아니라 **같은 표를 같은 함수로 읽는 것**이다.
 */

/** 이정표 탭과 같은 자리표(`fmt`) — 「823 / 1,000」의 쉼표가 거기서 온다. */
const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 목적과 진행 숫자 사이의 틈.
 *
 * 이정표 탭이 「이름   현재 / 필요」로 적는 그 세 칸이다(detailMenuTabs 의
 * buildMilestoneLines). 「—」를 쓰지 않는 이유는 마디 3 의 목적이 자기 안에
 * 이미 「—」를 갖고 있어서다 — 같은 줄에 두 개가 서면 어느 쪽이 문장이고 어느
 * 쪽이 숫자인지 눈이 못 가른다.
 */
const PROGRESS_GAP = '   '

/**
 * 띠의 자리와 크기 — 설계 ⑧-6 이 정한 값이다(미니맵 오른쪽 (131,39) 672×24).
 *
 * 그리는 것은 HudScene 인데 값이 여기 있는 이유: **폭 예산을 재는 검사**가 이
 * 수들을 봐야 하고(questBand.test.ts), 그 검사가 Phaser 를 켤 수는 없다. 화면과
 * 자가 같은 상수를 보지 않으면 자는 자기가 상상한 띠를 재게 된다.
 *
 * **`x`·`y`·`edgeRight` 를 무는 자는 minimap.test.ts 에 있다**(설계 ⑧-7 이 미니맵
 * 상수를 세운 뒤에야 설 수 있었던 자다). 「미니맵 오른끝 + 여백 = 띠 왼끝」과
 * 「띠 오른끝 + 여백 = 화면 폭 812」 두 등식이 그것이고, 그 전까지 x=131 을
 * 지키는 것은 사람 눈뿐이었다.
 */
export const BAND = {
  x: 131,
  y: 39,
  width: 672,
  height: 24,
  /** 왼쪽 변에서 글자가 시작하는 자리까지. 오른쪽도 같은 만큼 비워 둔다. */
  padding: 8,
  /**
   * 띠 오른끝과 화면 오른쪽 끝 사이에 남기는 여백.
   *
   * **미니맵 왼쪽 여백과 같은 수여야 한다**(`MINIMAP.x`) — 한쪽만 바뀌면 헤더 밑
   * 한 줄이 한쪽으로 쏠린다. 값이 HudScene 이 아니라 여기 있는 이유는 `width`·
   * `padding` 과 같다: 그 등식을 무는 자가 Phaser 를 켤 수 없다.
   */
  edgeRight: 9,
} as const

export interface QuestBandView {
  /**
   * 띠에 적을 한 줄. **null 이면 띠를 아예 안 그린다** — 사슬이 끝났거나(설계
   * ⑧-6: 끝나면 사라지고 다시 안 뜬다) 지금 마디가 `discoverable` 이 아니다
   * (설계 ⑥ 방어①).
   */
  line: string | null
  /**
   * 가상 컨트롤러의 A 에 테두리를 붙이는가.
   *
   * **A 가 무엇을 하는지 적힌 곳이 게임 안에 한 군데도 없다**(라벨이 'A' 뿐이다).
   * 이 테두리가 그것을 처음 말한다 — 그래서 사슬이 A 를 **처음** 요구하는 그
   * 한 마디에만 붙는다(teachesAction 참고).
   */
  teachAction: boolean
}

/** 아무것도 안 뜬다. 사슬이 끝난 사람과 아직 캐릭터가 없는 화면이 같은 답을 받는다. */
const NOTHING: QuestBandView = { line: null, teachAction: false }

/**
 * **유도등이 지금 가리키는 마디** — 꺼져 있으면 null.
 *
 * 띠(아래)와 미니맵 깃발(minimap.ts)이 나눠 쓰는 스위치 하나다. 두 화면이 각자
 * 이 판단을 지으면 설계 ⑥ 방어①이 남긴 손잡이("`discoverable` 칸 하나를 비우면
 * 유도등이 꺼진다")를 내려도 한쪽만 꺼진다 — 띠는 사라졌는데 지도에는 여전히
 * 깃발이 서 있는 화면이 그것이다.
 *
 * `player` 가 null 인 경우가 있는 이유는 스토어의 `player` 가 로그인 전·전환 중에
 * 비기 때문이다(gameStore) — 씬이 그 검사를 하지 않고 여기 한 곳에서 답한다.
 */
export function guidingStep(data: GameData, player: PlayerState | null): StoryStep | null {
  return player ? litStep(storyChainOf(data, player), player.story) : null
}

/**
 * 사슬을 이미 손에 쥔 쪽이 부르는 같은 판단. 위와 나뉘어 있는 이유는 비용이다 —
 * `storyChainOf` 는 마을 유도와 슬롯 펴기를 포함하므로 한 번의 답에 두 번 돌지
 * 않게 한다.
 */
function litStep(chain: readonly StoryStep[], story: number): StoryStep | null {
  // 색인이 곧 마디 번호다(storyChainOf). 넘어서면 사슬이 끝난 것이고, 유도등은
  // 그날로 꺼져 다시 안 켜진다 — `story` 는 줄지 않으므로 그 약속을 여기서
  // 따로 기억할 필요가 없다.
  const step = chain[story]
  if (!step) return null
  // `discoverable` 이 아닌 마디는 화면에 아무 말도 안 한다 — 목적도, 테두리도,
  // 깃발도.
  return step.discoverable ? step : null
}

/**
 * 지금 이 사람의 띠.
 */
export function questBandView(data: GameData, player: PlayerState | null): QuestBandView {
  if (!player) return NOTHING

  const chain = storyChainOf(data, player)
  const step = litStep(chain, player.story)
  if (!step) return NOTHING

  return { line: lineOf(step, player, data), teachAction: teachesAction(chain, player.story) }
}

/** 목적 한 줄 + (있으면) 진행 숫자. */
function lineOf(step: StoryStep, player: PlayerState, data: GameData): string {
  const progress = progressOf(step, player, data)
  return progress === null ? step.objective : `${step.objective}${PROGRESS_GAP}${progress}`
}

/**
 * 이 마디에 붙는 진행 숫자 — 없으면 null.
 *
 * 세는 마디(gather·donate·craft)는 `storyCount` 가 그대로 답이다. `reach` 는
 * 세이브에 세는 수가 없고(마디 시작 시점의 숙련도를 저장하지 않는다 —
 * StoryGoalKind 문서) 대신 이정표가 이미 그 답을 갖고 있으므로 거기서 읽는다.
 *
 * **한 번짜리 마디에는 안 적는다.** 첫 채집을 시키는 마디 뒤에 0 분의 1 을
 * 붙여 봐야 그 문장이 이미 말한 것을 숫자로 되풀이할 뿐이다. 이 숫자가 사는
 * 이유는 **반복이 쌓이는 것을 보여 주는 것**이고(설계 ③ 의 「3 / 40」),
 * 한 번짜리에는 쌓일 것이 없다.
 */
function progressOf(step: StoryStep, player: PlayerState, data: GameData): string | null {
  const goal = step.goal
  if (goal.count !== undefined) {
    return goal.count > 1 ? `${fmt(player.storyCount)} / ${fmt(goal.count)}` : null
  }
  if (goal.kind === 'reach') {
    const def = data.milestones.find((m) => m.id === goal.arg)
    // 없는 이정표를 가리키면 숫자를 지어내지 않는다 — 빌드가 막지만(참조 무결성),
    // 막지 못했을 때 없는 진행을 그럴듯하게 적는 것보다 안 적는 편이 낫다
    // (`metricValueOf` 가 없는 이정표를 안 세는 그 원칙이다).
    return def ? `${fmt(metricValue(def, player, data))} / ${fmt(def.threshold)}` : null
  }
  // arrive — 문을 반쯤 나설 수는 없다. 셀 것이 없는 유일한 종류다.
  return null
}

/**
 * 이 마디가 **A 를 처음 가르치는** 마디인가.
 *
 * 마디 번호(1)를 여기 적지 않는 이유: 그 수는 `story.csv` 의 것이지 화면의 것이
 * 아니다. 표에서 마디 하나가 앞에 끼는 날 테두리만 엉뚱한 마디에 남고, 그
 * 어긋남은 화면에 오류로 안 보인다. 대신 표에서 유도한다 — **사슬에서 A 를
 * 처음 요구하는 마디**가 그 자리다.
 *
 * `gather` 가 곧 A 인 이유: 아크 1 의 사슬에 talk 마디가 없고(설계 ⑨ — 화자
 * 대면 마디를 뺐다), 나머지 셋은 A 로 하는 일이 아니다. `arrive` 는 걷는 것,
 * `donate` 는 가방 안의 [바치기], `craft` 는 제작 패널이다.
 */
function teachesAction(chain: readonly StoryStep[], story: number): boolean {
  return chain.findIndex((s) => s.goal.kind === 'gather') === story
}
