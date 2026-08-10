/**
 * 사실 공급자 — 지금 세계 상태를 조건이 볼 수 있는 `Facts` 한 뭉치로 만든다.
 *
 * **이것이 한 곳뿐이라는 것이 요점이다.** 서버가 대화를 판정할 때 쓰는 사실과
 * 시뮬레이터(`pnpm content dialogue`)가 작가에게 보여주는 사실이 갈라지면,
 * 작가의 도구는 실제로 돌아가는 게임이 아니라 그 도구만의 세계를 설명하게
 * 된다 — 그 도구가 존재하는 이유가 통째로 사라진다. 그래서 둘 다 이 함수를
 * 부른다.
 *
 * 무엇이 사실이 될 수 있는지는 게임 규칙이라 packages/shared 에 있다.
 * 목록(DECLARED_FACTS, dialogue.ts)과 이 공급자가 어긋나지 않는지는
 * packages/data/src/facts.test.ts 가 지킨다 — 어긋나도 타입 검사는 아무 말도
 * 하지 않기 때문이다.
 *
 * `weather`·`affinity`·`quest.*` 처럼 공급자가 없다고 선언된 사실은 여기서
 * **넣지 않는다.** 없는 사실은 어떤 연산자로도 거짓이라(matchesCondition), 그
 * 사실을 조건으로 건 대사는 자연히 잠들어 있고 빌드가 작가에게 그렇게
 * 안내한다. 자리를 채우려고 기본값(예: weather='clear')을 넣으면 그 안내가
 * 사라지면서, 아직 없는 스펙이 이미 있는 것처럼 굳어 버린다.
 */

import type { Facts, FactValue } from './dialogue.js'
import { achievedIds, type MilestoneDef } from './milestones.js'
import { gameDaysBetween, gameTimeAt } from './time.js'
import { SKILL_IDS, type PlayerState } from './types.js'

export interface FactSources {
  /**
   * 말을 건 상대.
   *
   * `talkedBefore`·`daysSinceLastTalk` 가 화자별이라 필요하다. 이 값은 사실
   * 뭉치에 `speaker` 라는 이름으로 들어가지 **않는다** — 누구 차례인가는
   * selectDialogue 의 별도 매개변수가 정하고, 그래서 DECLARED_FACTS 에도
   * `speaker` 가 없다(dialogue.ts 참고).
   */
  speaker: string
  player: PlayerState
  /** 이정표 정의 전체. `milestone.<id>` 를 채우려면 무엇이 있는지부터 알아야 한다. */
  milestones: readonly MilestoneDef[]
  /** epoch ms. 세계 시각의 유일한 입력이다 — 이 함수는 시계를 직접 읽지 않는다. */
  nowMs: number
  /**
   * 화자가 지금 서 있는 지점의 id(`npcStateAt(...).placeId`). 일과가 없는
   * 화자면 넘기지 않는다.
   *
   * 왜 여기서 계산하지 않는가: 이 함수는 `data.schedules`·`data.places`·
   * `data.routes` 를 모르고, 알게 하면 사실 공급자가 세계 데이터 전체를 받는
   * 함수가 된다. 그리고 그 계산은 서버가 이미 하고 있다 — 같은 요청 안에서
   * "말을 걸 수 있는가"(not_here)를 판정하려고 `npcStateAt` 을 부른다. 두 번
   * 부르면 두 답이 갈라질 수 있고, 그러면 "여기 없다"고 거절당한 자리의 대사가
   * 나오는 일이 생긴다.
   *
   * 지금은 서 있을 때만 여기까지 온다(걷는 중·실내면 서버가 먼저 거절한다).
   * 그래도 이 매개변수는 "서 있다"를 전제하지 않고 그냥 받은 것을 싣는다 —
   * 무엇을 실을지 정하는 것은 부르는 쪽의 판정이다.
   */
  place?: string
}

export function buildFacts(sources: FactSources): Facts {
  const { speaker, player, milestones, nowMs, place } = sources
  const time = gameTimeAt(nowMs)

  const facts: Record<string, FactValue> = {
    season: time.season,
    hour: time.hour,
    dayOfSeason: time.dayOfSeason,
  }

  // 기술 목록은 SKILL_IDS 가 유일한 출처다 — 여기 다섯 개를 손으로 적으면
  // 기술이 늘어날 때(명상·낚시·헌혈) 그 기술만 조건에서 조용히 죽는다.
  for (const skill of SKILL_IDS) facts[`skill.${skill}`] = player.skills[skill]

  // 달성 여부는 저장된 값이 아니라 계산이다(milestones.ts) — 여기서도 그대로
  // 계산해서, 대사가 보는 달성과 이정표 목록이 보는 달성이 같은 함수에서 나온다.
  const achieved = achievedIds(milestones, player)
  for (const def of milestones) facts[`milestone.${def.id}`] = achieved.has(def.id)

  // justAchieved 는 celebrated 에서 "지금 이정표 목록에도 있는" 가장 최근
  // 이정표다.
  //
  // **새 상태를 만들지 않는 것이 핵심이다.** celebrated 는 문턱을 넘는 그
  // 순간에만 append 되고(gatherService·craftService) 다시 정렬되지도 지워지지도
  // 않으므로, "가장 최근에 넘긴 것"이 이미 그 배열 끝에 적혀 있다. 대화 요청이
  // 값을 따로 실어 나르게 만들면 그 경로를 채집·제작·오프라인 복귀까지 전부
  // 이어야 하고, 한 군데만 빠뜨려도 이 사실은 조용히 다시 죽는다.
  //
  // 한 번 켜지면 계속 켜져 있다. 그래도 같은 말을 되풀이하지 않는데, @milestone
  // 이 once 사건이라(ONCE_EVENTS) 한 번 나온 규칙은 dialogueHistory.said 가
  // 막기 때문이다 — 즉 "계속 켜져 있다"는 "영원히 반복한다"가 아니라 "다음에
  // 누구에게든 말을 걸 때 반드시 한 번은 듣는다"는 뜻이다. 반대로 "넘긴 그
  // 순간에만 켠다"로 하면, 채집장에서 문턱을 넘고 마을까지 걸어가는 사이에 그
  // 말이 사라진다 — 노가다 사이사이에 진행도로 사건이 열린다는 이 게임의
  // 약속이 정확히 거기서 조용히 깨진다.
  //
  // 대가: 말을 걸기 전에 문턱을 둘 넘기면 마지막 하나만 언급된다. 둘 다
  // 말하려면 대기열이 필요하고 그건 저장·마이그레이션·비우는 시점이 따라붙는
  // 새 상태다 — 지금 콘텐츠가 얻는 것에 비해 비싸서 일부러 받아들인 대가다.
  //
  // celebrated 는 지우지 않는다(위 문단) — 그래서 milestones.csv 에서 이정표를
  // 지운 뒤에도 그 id 가 배열 끝에 그대로 남을 수 있다. 마지막 원소만 보면
  // 지워진 이정표를 영원히 다시 보고하게 된다. newlyAchieved 가 반대 방향(축하
  // 이력엔 있지만 지금 데이터엔 없는 id 를 무시)으로 이미 세운 원칙 — "이정표를
  // 지운 뒤에도 옛 세이브가 그대로 살아 있어야 한다" — 을 여기서도 지키려면,
  // 지금 없는 id 를 걸러내고 나서 마지막을 찾아야 한다.
  const milestoneIds = new Set(milestones.map((def) => def.id))
  const justAchieved = player.celebrated.filter((id) => milestoneIds.has(id)).at(-1)
  if (justAchieved !== undefined) facts.justAchieved = justAchieved

  const { lastTalkAt, recent } = player.dialogueHistory
  const lastTalk = lastTalkAt[speaker]
  // talkedBefore 는 lastTalkAt 뿐 아니라 recent 도 증거로 받아들인다.
  // lastTalkAt 은 이 태스크에서 새로 생긴 필드라, 그 전 세이브는 recent 는
  // 채워져 있는데 lastTalkAt 은 없다(세이브 스키마의 `.default({})` — store.ts).
  // 두 필드는 "어긋날 수 없게" 한 저장소(dialogueHistory)에 같이 두었다는
  // 설계를 지키려면, lastTalkAt 하나만 믿어서는 안 된다 — 그러면 실제로 말해
  // 본 상대(recent 가 증명한다)에게 초면 인사가 나간다. 별도 마이그레이션
  // 단계 대신 여기서 "둘 중 하나"로 정의하면, 새 세이브도 옛 세이브도 같은
  // 코드로 옳게 읽힌다.
  const hasRecentEvidence = (recent[speaker]?.length ?? 0) > 0
  facts.talkedBefore = lastTalk !== undefined || hasRecentEvidence
  // daysSinceLastTalk 는 다르다 — "며칠 지났나"는 정확한 시각이 있어야만 답할
  // 수 있고 recent 에는 시각이 없다. 옛 세이브처럼 시각을 모르면 이 사실은
  // 내지 않는다: 0 을 넣으면 "방금 말했다"가 되어 모른다고 하는 것보다 나쁘다.
  if (lastTalk !== undefined) facts.daysSinceLastTalk = gameDaysBetween(lastTalk, nowMs)

  // place 는 daysSinceLastTalk 와 같은 자세다 — 모르면 넣지 않는다. 일과가 없는
  // 화자에게 '' 나 '어디도아님' 같은 자리표시를 넣으면, 그 화자에게 place 를
  // 건 조건이 "안 맞는다"가 아니라 "그런 자리와 비교됐다"가 되고, 조건을
  // 부정으로 쓴 규칙(place!=여관앞)이 자리 개념이 없는 화자에게서 갑자기
  // 참이 된다.
  if (place !== undefined) facts.place = place

  return facts
}
