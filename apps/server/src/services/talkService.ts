import {
  ONCE_EVENTS,
  RECENT_DIALOGUE_LIMIT,
  buildFacts,
  npcStateAt,
  onceKey,
  selectDialogue,
  shopAccess,
  speakerPresence,
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
  /**
   * 이 대화가 여는 상점 id. **문이 실제로 열릴 때만** 실린다 — 없으면 대사만이다.
   *
   * 이긴 대사 규칙과 무관하다(§6-앞 1). 상점이 대사에 붙어 있었다면 한 번도 안
   * 열렸을 것이다: `selectDialogue` 는 조건이 가장 많은 규칙만 남기는데, 네 화자의
   * 거래 암시 규칙은 전부 조건 둘이라 조건 하나짜리 상점 규칙이 언제나 진다.
   * **대사는 안내이고, 문은 상태가 연다.**
   */
  shop?: string
  /**
   * 이번 대화에서 받은 달인의 1회성 대금. 두 번째 대화에는 실리지 않는다.
   *
   * 금액을 함께 싣는 이유는 화면이 "+1,000,000 G" 를 말해야 하기 때문이다 —
   * 골드 총액만 보내면 클라이언트가 차이를 계산해야 하고, 그 계산은 같은 응답에
   * 매도 대금이 섞이는 날 조용히 틀린다.
   */
  reward?: { id: string; gold: number }
  player: PlayerState
}

/**
 * 앞의 셋은 현장 판정(`speakerPresence`, packages/shared)이 그대로 답한 것이다 —
 * 그 셋의 뜻(특히 `not_here` 와 `wrong_map` 을 왜 나누는가)은 그 함수가 설명한다.
 * `nothing_to_say` 만 이 서비스의 몫이다: 사람은 거기 있는데 할 말이 없는 경우다.
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

  // 현장 판정은 이 서비스의 것이 아니다 — talk·sell·buy 가 같은 술어를 부른다
  // (§6-앞 3). 두 벌로 적으면 "말은 걸리는데 못 파는" 화면이 온다. 시각은
  // 라우트가 넣어 준 것을 그대로 넘긴다: 여기서 Date.now() 를 다시 읽으면
  // 판정에 쓰인 시각과 대화 이력에 적히는 시각이 갈라진다.
  const presence = speakerPresence(data, speakerId, args.player, now)
  if (presence !== 'ok') return { ok: false, code: presence }

  const player = structuredClone(args.player)

  // 대화 사실 place — 일과가 있는 화자가 지금 서 있는 지점의 id 다. 위 판정이
  // 이미 npcStateAt 을 불렀지만 그 함수는 답을 코드 하나로 접어 돌려주므로,
  // 지점 id 는 여기서 같은 시각으로 한 번 더 묻는다. npcStateAt 은 (일과,
  // 지점, 길, 시각)의 순수 함수라 같은 `now` 면 반드시 같은 답이다 — 두 답이
  // 갈라질 수 있는 것은 시각이 갈라질 때뿐이고, 그래서 `now` 를 인자로 받는다.
  // 사실 공급자(buildFacts)가 스스로 계산하게 두면 그 보장이 사라진다.
  const schedule = Object.hasOwn(data.schedules, speakerId) ? data.schedules[speakerId] : undefined
  // standing 이면 지점 위이므로 placeId 가 있다. ?? undefined 는 그 불변식이
  // 깨졌을 때 사실을 아예 안 내는 쪽을 고른 것이다 — 없는 사실은 조건이
  // 거짓일 뿐이지만, 빈 문자열은 조건과 비교되는 값이 된다.
  const place = schedule ? (npcStateAt(schedule, data.places, data.routes, now).placeId ?? undefined) : undefined

  // 사실을 먼저 모은다. 아래에서 이력을 갱신하므로, 순서가 바뀌면 이번 대화가
  // 이번 대화의 사실(talkedBefore·daysSinceLastTalk)을 바꿔 버린다 — 처음
  // 만난 사람에게 "또 왔군" 이 나온다.
  const facts = buildFacts({ speaker: speakerId, player, world: data, nowMs: now, place })

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

  // 아래 둘은 **이긴 규칙을 보지 않는다**(§6-앞 1·2). 등록부가 화자로 답한다.
  const outcome: TalkOutcome = { speaker: speakerId, lines: [...rule.lines], player }

  // 상점: 이 화자가 여는 상점이 있고 그 문이 지금 열리면 id 를 싣는다. 문을 여는
  // 판정은 shopAccess 하나뿐이다 — 여기서 "숙련도가 넘으면" 같은 조건을 다시
  // 적으면 sell·buy 와 갈라져서 "가게는 열리는데 아무것도 못 파는" 화면이 온다.
  const shop = Object.values(data.shops).find((s) => s.speakerId === speakerId)
  if (shop && shopAccess(data, shop.id, player, now) === 'ok') outcome.shop = shop.id

  // 달인 대금: 문턱을 넘었고 아직 안 받았으면 준다. 조건이 상태(숙련도·rewarded)
  // 뿐이라 몇 번을 말해도 답이 같다 — 한 번 주고 나면 rewarded 가 그 답을 바꾼다.
  // 한 대화에서 하나만 준다: 한 화자가 두 계열의 달인일 수 있지만, 응답의
  // reward 는 하나이고 화면도 한 번에 한 금액만 말할 수 있다. 남은 하나는 다음
  // 대화에서 나온다(문턱은 이미 넘었으므로 사라지지 않는다).
  const master = data.masters.find(
    (m) => m.speakerId === speakerId && player.skills[m.skill] >= m.threshold && !player.rewarded.includes(m.id),
  )
  if (master) {
    player.gold += master.gold
    player.rewarded.push(master.id)
    outcome.reward = { id: master.id, gold: master.gold }
  }

  // lines 는 위에서 복사해 실었다. 그대로 실으면 응답 객체가 GameData 의 배열을
  // 가리켜, 누가 그것을 건드리는 순간 그 화자의 대사가 프로세스 전체에서 바뀐다.
  return { ok: true, outcome }
}
