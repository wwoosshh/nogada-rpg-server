/**
 * 수집의 방 — 칸 하나의 등급과 방 전체의 총점(설계 §6-앞 11).
 *
 * **서버 판정과 클라 표시가 같은 함수를 부른다.** 헌납이 등급을 올렸는지
 * (donateService)도, 화면이 별 몇 개를 그릴지(CodexPanel)도, 이정표가 총점을
 * 지표로 읽을지(milestones)도 전부 여기다 — 등급 계산이 두 벌이 되면 "바쳤는데
 * 별이 안 붙었다" 를 아무도 재현하지 못한다.
 *
 * 이 파일은 **데이터를 import 하지 않는다**. 문턱표는 인자로 들어온다 —
 * `collection.csv` 가 소유하고, GameData 에 실려 서버와 클라 양쪽에 도착한다.
 */

/**
 * 한 칸의 네 문턱. `steps[i]` 는 **i+1 등급이 되는 최소 헌납 개수**다.
 *
 * 튜플(길이 4 고정)인 이유: 등급 수는 별 네 개라는 화면의 약속이고
 * (`COLLECTION_MAX_GRADE`), 배열로 두면 칸마다 별 개수가 다른 방이 표현
 * 가능해진다 — CSV 한 줄의 오타로 그런 방이 생기는 것을 타입이 먼저 막는다.
 */
export interface CollectionThresholds {
  itemId: string
  steps: [number, number, number, number]
}

/** 칸 등록부. 키는 itemId — 채집물 25종 전부이고, 그 목록은 `gather_tiers.csv` 가 정한다(§6-앞 4). */
export type CollectionTable = Record<string, CollectionThresholds>

/**
 * 한 칸이 가질 수 있는 최고 등급 = 문턱 개수. 만점은 칸 수 × 이 값이다(25 × 4 = 100).
 *
 * 상수로 내보내는 이유: 이정표가 총점을 **비율**로 읽으므로(§6-앞 8) 만점이
 * 어디서든 같은 식으로 유도돼야 한다. 화면이 별 개수를 4 로 박아 두면, 문턱이
 * 다섯 단이 되는 날 화면만 조용히 옛 방이 된다.
 */
export const COLLECTION_MAX_GRADE = 4

/**
 * 이 칸의 등급 — 넘긴 문턱의 개수(0..COLLECTION_MAX_GRADE).
 *
 * 문턱에 **닿으면** 오른다(`>=`). 화면이 "50/50" 을 적어 놓고 별을 안 주면 그
 * 숫자가 거짓말이 되기 때문이고, 이것은 상점의 요구 숙련도·강화 재료가 이미
 * 쓰는 부등호와 같다.
 *
 * 문턱이 순증가라는 것은 빌드 검증이 지킨다(validateCollection) — 그래서 여기서는
 * "몇 개를 넘겼나"를 그냥 세면 되고, 넘긴 개수가 곧 등급이다.
 */
export function collectionGrade(donatedCount: number, t: CollectionThresholds): number {
  let grade = 0
  for (const step of t.steps) {
    if (donatedCount >= step) grade += 1
  }
  return grade
}

/**
 * 방 전체의 총점 — 칸마다의 등급을 더한 하나의 수(만점 100).
 *
 * **표를 돌고 세이브를 조회한다**(그 반대가 아니다). 세이브의 키는 문자열이라
 * 표에 없는 것이 들어 있을 수 있고(옛 아이템 id, 손으로 고친 파일), 그것이
 * 점수를 만들면 만점이 100 이 아니게 되어 이정표의 비율이 통째로 어긋난다.
 * `Object.hasOwn` 으로 조회하는 것도 같은 자리의 방어다 — `donated` 는 세이브에서
 * 온 객체라 상속 키(`constructor` 등)를 통해 엉뚱한 값을 읽을 수 있다
 * (`gatherHand.holdsToken` 이 카탈로그를 도는 것과 같은 이유).
 */
export function collectionScore(donated: Record<string, number>, table: CollectionTable): number {
  let score = 0
  for (const [itemId, thresholds] of Object.entries(table)) {
    const count = Object.hasOwn(donated, itemId) ? (donated[itemId] ?? 0) : 0
    score += collectionGrade(count, thresholds)
  }
  return score
}
