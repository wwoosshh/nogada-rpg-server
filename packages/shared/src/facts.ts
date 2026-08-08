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
   * 이번 행동으로 방금 넘긴 이정표 id.
   *
   * 플레이어 상태에서 유도할 수 없어서 인자로 받는다. `celebrated` 의 마지막
   * 원소는 "가장 최근에 넘긴 것" 이지 "방금 넘긴 것" 이 아니다 — 그걸 쓰면
   * 문턱을 한 번 넘은 뒤로는 영원히 방금 넘긴 셈이 된다. 이 값은 행동의
   * 결과(newlyAchieved)를 아는 쪽만 줄 수 있고, 주지 않으면 사실이 없다.
   */
  justAchieved?: string
}

export function buildFacts(sources: FactSources): Facts {
  const { speaker, player, milestones, nowMs, justAchieved } = sources
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

  return facts
}
