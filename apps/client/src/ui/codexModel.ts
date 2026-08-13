import {
  collectionGrade,
  collectionScore,
  COLLECTION_MAX_GRADE,
  SKILL_IDS,
  SKILL_LABELS,
  type CollectionThresholds,
  type GameData,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'

/**
 * 수집의 방(CodexPanel.tsx)이 그릴 순수 데이터를 만든다 — craftCardModel·
 * shopModel 과 같은 자리다.
 *
 * **규칙을 여기서 다시 짓지 않는다.** 등급은 shared 의 `collectionGrade`(서버의
 * 헌납 판정이 부르는 바로 그 함수), 총점은 `collectionScore`, 문턱은
 * `GameData.collection` 이다. 이 파일이 하는 일은 그것들을 **계열별 칸 격자**로
 * 옮겨 담고, 화면이 적어야 할 한 가지 유도값(다음 문턱까지 몇 개)을 빼는 것뿐이다.
 *
 * 계열은 `ItemDef.skill` 이 정한다 — 사다리 순서(=티어)는 여전히 서버에만 있고
 * (스포일러 금지), 소속만 클라이언트에 드러나 있다(types.ts 의 `skill` 문서).
 * 칸의 순서는 `collection.csv` 선언 순서 그대로다: 방은 오래 들여다보는 화면이라
 * 바친 개수에 따라 칸이 움직이면 어제 본 자리에 오늘 다른 것이 있다.
 */

/**
 * 한 요청이 나를 수 있는 최대 헌납 수량 — 서버 스키마(`protocol.ts` 의
 * `DonateCount`)의 상한과 같은 값이다. 거래의 999(`MAX_TRADE_COUNT`)가 아니다:
 * 스택에는 상한이 없어 절벽 뒤 플레이어는 수만 개를 든다. 화면이 이 위를 고르게
 * 두면 서버가 `bad_request` 로 거절하는데, 그건 플레이어가 고칠 방법을 알 수 없는
 * 거절이다.
 */
export const MAX_DONATE_COUNT = 100_000

/** 방의 칸 하나 — 잠긴 칸도 같은 모양이다(숨기는 것은 없다, 설계 §6-앞 3). */
export interface CodexSlot {
  itemId: string
  /** 아이템 이름. **한 번도 안 바친 칸도 이름을 말한다**(§6-앞 3). */
  name: string
  /** 이 칸에 바친 누적 개수. 0 이면 잠긴 칸이다(회색조 + `0/N`). */
  donated: number
  /** 지금 등급 0..COLLECTION_MAX_GRADE — shared 의 `collectionGrade` 그대로. */
  grade: number
  /** 다음 문턱의 개수. 만강이면 null — 더 말할 목표가 없다. */
  nextStep: number | null
  /** 다음 문턱까지 남은 개수(`nextStep - donated`). 만강이면 null. */
  remaining: number | null
}

/** 계열 한 묶음 — 방의 격자는 이것 넷이다(얼음·나무·광물·허브). */
export interface CodexLine {
  skill: SkillId
  /** 계열 이름 — `SKILL_LABELS` 그대로(가방 슬롯·상점 잠금 문구와 같은 글자). */
  label: string
  slots: CodexSlot[]
  /** 이 계열 칸들의 등급 합. */
  score: number
  /** 이 계열의 만점 = 칸 수 × COLLECTION_MAX_GRADE. */
  maxScore: number
}

/** 방 한 화면 전체. */
export interface CodexView {
  lines: CodexLine[]
  /** 방의 총점 — 상점 해금·이정표가 읽는 바로 그 숫자다. */
  score: number
  /** 만점(25칸 × 4 = 100). 칸 수에서 유도한다 — 화면이 100 을 박아 두지 않는다. */
  maxScore: number
}

/**
 * 이 아이템이 방의 칸인가 — **가방의 `[바치기]` 자격이 이 한 줄이다**.
 *
 * 서버의 `performDonate` 가 `not_collectable` 을 가르는 그 검사와 같은 검사다
 * (`data.collection` 에 있는가). 화면이 자기 목록을 따로 지으면(예: "kind 가
 * material 이고 skill 이 있는 것") 주괴·증표·가루가 함께 걸려 눌러도 거절만
 * 돌아오는 죽은 버튼이 생긴다 — 25칸은 `gather_tiers.csv` 가 정하고, 만든 것은
 * 캔 것이 아니다(§6-앞 4).
 *
 * `Object.hasOwn` 인 이유는 서버와 같다: `itemId` 는 화면이 가진 문자열이라
 * 상속 키(`constructor` 등)가 정의 행세를 하는 것을 막는다.
 */
export function isCollectionSlot(data: GameData, itemId: string): boolean {
  return Object.hasOwn(data.collection, itemId)
}

/** 한 번에 바칠 수 있는 최대 수량 — 가진 만큼, 그리고 요청 상한까지(상점의 maxSellCount 와 같은 자리). */
export function maxDonateCount(held: number): number {
  return Math.min(held, MAX_DONATE_COUNT)
}

/**
 * 다음 문턱과 거기까지 남은 개수 — 만강이면 null.
 *
 * 등급을 다시 세지 않고 `collectionGrade` 가 답한 등급을 **첨자로** 쓴다:
 * 등급이 곧 "넘긴 문턱의 개수"이므로 `steps[grade]` 가 정확히 다음 문턱이다.
 * 부등호를 여기서 다시 적으면 언젠가 서버는 별을 줬는데 화면은 "1개 남음"이라
 * 적는 날이 온다.
 */
export function nextThresholdOf(
  donatedCount: number,
  thresholds: CollectionThresholds,
): { step: number; remaining: number } | null {
  const grade = collectionGrade(donatedCount, thresholds)
  if (grade >= COLLECTION_MAX_GRADE) return null
  const step = thresholds.steps[grade]
  if (step === undefined) return null
  // 문턱이 순증가라는 것은 빌드 검증(validateCollection)이 지키므로 이 뺄셈은
  // 음수가 될 수 없다 — 그래도 0 으로 바닥을 두는 것은 손으로 고친 세이브가
  // 화면에 "-3개 남음"을 적지 않게 하기 위해서다.
  return { step, remaining: Math.max(0, step - donatedCount) }
}

/**
 * 방 한 화면을 만든다 — 계열 넷 × 칸들.
 *
 * 총점을 계열 점수의 합으로 다시 세지 않고 `collectionScore` 를 부르는 이유:
 * 그것이 **상점의 되사기 진열과 이정표가 읽는 바로 그 숫자**다(§6-앞 7·8).
 * 화면이 자기 셈으로 60 을 적어 놓고 상점은 59 로 잠겨 있으면, 플레이어가
 * 확인할 방법이 없는 거짓말이 된다.
 */
export function buildCodex(data: GameData, player: PlayerState): CodexView {
  const lines: CodexLine[] = []
  const bySkill = new Map<SkillId, CodexLine>()

  // 계열 순서는 SKILL_IDS 선언 순서 — 가방의 장비 슬롯 다섯 칸과 같은 순서다.
  // '조합'은 채집 계열이 아니라 칸이 하나도 없으므로, 빈 묶음은 아래에서 걸러진다.
  for (const skill of SKILL_IDS) {
    const line: CodexLine = { skill, label: SKILL_LABELS[skill], slots: [], score: 0, maxScore: 0 }
    bySkill.set(skill, line)
    lines.push(line)
  }

  for (const thresholds of Object.values(data.collection)) {
    const def = data.items[thresholds.itemId]
    // 정의도 계열도 없는 칸은 빌드가 막는다(칸 목록은 gather_tiers.csv 와 정확히
    // 일치해야 한다) — 화면은 조용히 넘어간다. 데이터를 갈아엎는 중에 방이
    // 통째로 죽는 것보다 낫다(ShopPanel 이 없는 상점을 넘기는 것과 같은 자세).
    if (def?.skill === undefined) continue
    const line = bySkill.get(def.skill)
    if (line === undefined) continue

    const donated = player.donated[thresholds.itemId] ?? 0
    const grade = collectionGrade(donated, thresholds)
    const next = nextThresholdOf(donated, thresholds)
    line.slots.push({
      itemId: thresholds.itemId,
      name: def.name,
      donated,
      grade,
      nextStep: next?.step ?? null,
      remaining: next?.remaining ?? null,
    })
    line.score += grade
    line.maxScore += COLLECTION_MAX_GRADE
  }

  const filled = lines.filter((line) => line.slots.length > 0)
  return {
    lines: filled,
    score: collectionScore(player.donated, data.collection),
    // 만점도 유도한다 — 칸이 스물여섯 번째가 생기는 날 화면만 옛 만점을 적으면
    // 안 된다(shared 의 COLLECTION_MAX_GRADE 문서와 같은 이유).
    maxScore: Object.keys(data.collection).length * COLLECTION_MAX_GRADE,
  }
}
