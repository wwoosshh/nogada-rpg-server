import {
  ONCE_EVENTS,
  RECENT_DIALOGUE_LIMIT,
  buildFacts,
  npcStateAt,
  onceKey,
  selectDialogue,
  type GameData,
  type PlayerState,
} from '@nogada/shared'

export interface PerformTalkArgs {
  player: PlayerState
  data: GameData
  speakerId: string
  /** 서버가 시드를 독점한다. 동점인 후보 중 무엇이 나올지는 클라이언트가 정하지 못한다. */
  rng: () => number
  now: number
}

export interface TalkOutcome {
  /** 말을 건 화자 id. 요청을 그대로 되비춘다 — 이름·좌표는 클라이언트가 GameData 에서 찾는다. */
  speaker: string
  /**
   * 이번 발화 **전체**. 대사창이 순서대로 넘길 칸들이다.
   *
   * 칸마다 요청하지 않는 것이 이 필드의 존재 이유다(설계 문서 4.5) — 한 마디를
   * 말하는 사이에 시각·숙련도가 바뀌면 플레이어는 두 세계가 섞인 말을 듣는다.
   */
  lines: string[]
  player: PlayerState
}

/**
 * `not_here` 는 "맵에는 맞게 왔는데 그 사람이 지금 여기 없다" 다 — 실내로
 * 들어갔거나 길 위를 걷는 중이다. `wrong_map` 과 나누는 이유는 플레이어가 할
 * 일이 다르기 때문이다: 저쪽은 따라가면 되고, 이쪽은 기다리거나 다시 와야 한다.
 */
export type TalkErrorCode = 'unknown_speaker' | 'wrong_map' | 'not_here' | 'nothing_to_say'

export type TalkResult = { ok: true; outcome: TalkOutcome } | { ok: false; code: TalkErrorCode }

/**
 * 대화 판정. 지금 세계 상태에서 이 화자가 할 말을 서버가 고르고, 그 결과를
 * 대화 이력에 남긴 플레이어 상태까지 함께 돌려준다.
 *
 * 고르는 규칙 자체는 `selectDialogue`(packages/shared) 하나에서 나온다 — 여기서
 * 다시 판정하지 않는다. 이 함수가 하는 일은 세 가지다: 사실을 모으고, 고른
 * 결과를 이력에 반영하고, 발화를 실어 보낸다.
 *
 * **행동 간격(nextActionAt)을 읽지도 쓰지도 않는다.** 채집·제작과 다른 점이고,
 * 일부러 다르다. 대화가 간격에 묶이면 NPC 하나하나가 노가다에 붙는 세금이 되고,
 * 간격을 새로 걸면 말을 거는 것만으로 채집 속도가 느려진다 — 어느 쪽도 원작의
 * "노가다 사이사이의 사건"이 아니다.
 */
export function performTalk(args: PerformTalkArgs): TalkResult {
  const { data, speakerId, rng, now } = args

  // speakerId 는 클라이언트가 그대로 보낸 문자열이다. data.speakers[speakerId] 로
  // 바로 읽으면 "constructor" 같은 상속 키가 프로토타입 체인에서 값을 찾아
  // truthy 를 반환한다 — gatherService 가 placements 에서 막는 것과 같은 구멍이다.
  const speaker = Object.hasOwn(data.speakers, speakerId) ? data.speakers[speakerId] : undefined
  if (!speaker) return { ok: false, code: 'unknown_speaker' }

  const player = structuredClone(args.player)

  // 일과가 있는 화자는 speakers.csv 의 좌표에 있지 않다 — 그 사람의 자리는
  // 시각이 정한다(설계 §5). 위 speakerId 검사를 통과했으므로 이것은 실재하는
  // 화자 id 지만, 그래도 hasOwn 으로 읽는다: "constructor" 같은 이름의 화자가
  // 있으면 프로토타입 체인의 값이 일과 행세를 한다.
  const schedule = Object.hasOwn(data.schedules, speakerId) ? data.schedules[speakerId] : undefined

  if (schedule) {
    // 시각은 라우트가 넣어 준 것을 그대로 쓴다. 여기서 Date.now() 를 다시 읽으면
    // 판정에 쓰인 시각과 대화 이력에 적히는 시각이 갈라지고, 테스트는 시간을
    // 고정할 방법을 잃는다.
    const state = npcStateAt(schedule, data.places, data.routes, now)

    // 걷는 중에는 몸이 없고(통과 장식), 실내면 맵에 없다 — 둘 다 "여기 없다"다.
    // 맵 검사보다 먼저 보는 이유: 길 위의 NPC 는 어느 맵에 있든 말이 걸리지
    // 않으므로, 맵이 맞다는 이유로 통과시키면 걷는 사람과 대화가 열린다.
    if (state.activity !== 'standing') return { ok: false, code: 'not_here' }
    if (state.mapId !== player.location.mapId) return { ok: false, code: 'wrong_map' }
  } else if (speaker.mapId !== player.location.mapId) {
    // 이것이 대화 스펙이 남긴 구멍이다. 앞칸 판정은 클라이언트에만 있어서, 서버가
    // 어느 맵인지 모르면 화자 id 하나로 맵 너머의 화자와 대화가 열린다 — 그리고
    // 그 대화가 said·recent 에까지 남아 다시 되돌릴 수도 없다. gatherService 와
    // 같은 검사이고 같은 근거다: 맵이 다르면 앞칸일 수가 없다.
    return { ok: false, code: 'wrong_map' }
  }

  // 사실을 먼저 모은다. 아래에서 이력을 갱신하므로, 순서가 바뀌면 이번 대화가
  // 이번 대화의 사실(talkedBefore·daysSinceLastTalk)을 바꿔 버린다 — 처음
  // 만난 사람에게 "또 왔군" 이 나온다.
  const facts = buildFacts({ speaker: speakerId, player, milestones: data.milestones, nowMs: now })

  // 화자로 거르는 일은 selectDialogue 가 스스로 한다 — 여기서 미리 거르면
  // "걸러서 넘겨야 한다"는 관례가 하나 더 생긴다(dialogue.ts 참고).
  const selection = selectDialogue(speakerId, data.dialogue, facts, player.dialogueHistory, rng)
  // 빌드 검증이 "무조건 @greet 이 없는 화자"를 막으므로 정상 데이터에서는 오지
  // 않는다. 그래도 빈 발화를 성공으로 돌려주면 클라이언트가 빈 대사창을 연다 —
  // 콘텐츠의 구멍은 아무 일도 안 일어난 척이 아니라 코드로 말해야 한다.
  if (!selection) return { ok: false, code: 'nothing_to_say' }

  const { rule } = selection
  const history = player.dialogueHistory

  // once 사건은 "무엇을 말했나" 가 아니라 "어떤 상태에서 말했나" 로 기억한다 —
  // onceKey 가 조건의 지금 값을 함께 엮으므로, 상태가 바뀌면 다시 말할 수 있다.
  if (ONCE_EVENTS.has(rule.event)) history.said.push(onceKey(rule, facts))

  // 같은 규칙을 두 번 담지 않는다. 후보가 적어 폴백으로 같은 말이 반복될 때
  // 창이 한 규칙으로 가득 차면, 콘텐츠가 늘어난 뒤에도 "최근 N 마디를 피한다"가
  // 조용히 "최근 한 마디를 피한다"로 줄어든다.
  const previous = (history.recent[speakerId] ?? []).filter((id) => id !== rule.id)
  history.recent[speakerId] = [...previous, rule.id].slice(-RECENT_DIALOGUE_LIMIT)
  history.lastTalkAt[speakerId] = now

  // lines 를 복사한다. 그대로 실으면 응답 객체가 GameData 의 배열을 가리켜,
  // 누가 그것을 건드리는 순간 그 화자의 대사가 프로세스 전체에서 바뀐다.
  return { ok: true, outcome: { speaker: speakerId, lines: [...rule.lines], player } }
}
