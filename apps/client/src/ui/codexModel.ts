import {
  collectionGrade,
  collectionScore,
  COLLECTION_MAX_GRADE,
  SKILL_IDS,
  SKILL_LABELS,
  type CollectionThresholds,
  type GameData,
  type MilestoneDef,
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
  /**
   * 마지막(4단) 문턱 — **만강이 몇 개짜리인가**. 잠긴 칸에도, 다 채운 칸에도 있다.
   *
   * `nextStep` 하나만으로는 부족하다: 화면은 등급 픽을 넷 그리는데 숫자는 하나만
   * 말하고, 숨은 문턱은 첫 문턱의 수백 배다(`gold_ore` 1 → 1,600). 그러면 이 칸이
   * 26분짜리인지 10시간짜리인지 아는 유일한 방법이 **되돌릴 수 없는 헌납을 한 번
   * 해 보는 것**이 된다 — §6-앞 3(숨기는 것은 없다)이 금지한 그 모양이다.
   * 넷을 다 적지 않고 양 끝(다음·만강)만 적는 이유는 812×375 에 칸이 25개라서다.
   */
  finalStep: number
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
 * 다음 문턱까지 **정확히** 모자란 개수 — 고를 값어치가 있을 때만, 없으면 null.
 *
 * **왜 이 칸이 필요한가:** 수량 고르개는 `−`/`+`/`전부` 셋뿐이다(상점과 같은 것을
 * 쓴다, §6-앞 1). 상점에서는 그것으로 충분하다 — 살 것은 골드가 정하고, 팔다 남긴
 * 재료는 다시 팔 수 있다. 헌납은 다르다: **바친 것은 돌아오지 않는데**, 문턱까지
 * 정확히 채우려면 `+` 를 수천 번 눌러야 한다(`ice_shard` 4단이면 6,299번). 그래서
 * 실질 선택지가 "1개 아니면 전량"으로 접히고, 전량을 누른 사람은 강화에 쓸 원석까지
 * 함께 태운다 — 설계 §3 이 원작의 사고("19개 바치면 19개가 통째로")를 고쳤다고 적은
 * 바로 그 결과가 조작에서 되살아난다.
 *
 * **null 을 돌려주는 세 자리는 전부 "그 칸이 죽은 버튼이 되는" 자리다**(죽은 버튼
 * 금지, §8-앞 13):
 *   - 만강이면 오를 등급이 없다(`nextThresholdOf` 가 null).
 *   - 모자란 만큼이 가진 것보다 많으면 눌러도 문턱에 못 닿는다.
 *   - 모자란 만큼이 고를 수 있는 최대와 같으면 `전부` 가 이미 그 일을 한다 — 같은
 *     결과를 내는 버튼 둘을 나란히 두면 손가락이 둘을 견주느라 멈춘다.
 */
export function donateToThresholdCount(
  donatedCount: number,
  held: number,
  thresholds: CollectionThresholds,
): number | null {
  const next = nextThresholdOf(donatedCount, thresholds)
  if (next === null) return null
  // 상한(MAX_DONATE_COUNT)은 `maxDonateCount` 가 이미 물고 있다 — 문턱이 그보다
  // 멀면 `remaining < max` 가 거짓이 되어 여기서 null 로 떨어진다.
  const max = maxDonateCount(held)
  if (next.remaining < 1 || next.remaining >= max) return null
  return next.remaining
}

/**
 * 아직 안 넘은 가장 가까운 **수집** 이정표 — 방이 가리킬 문. 만점이면 null.
 *
 * **왜 만점이 아니라 이것인가:** 헤더의 `N/100` 에서 100 은 문이 아니다. 실제로
 * 무언가 열리는 수는 30(흔한 것 되사기)과 60(귀한 것 되사기)이고, 그 수는 방이
 * 아니라 다른 패널(상세 메뉴의 이정표 탭)에 있었다 — 게다가 신규 캐릭터에서는
 * 수집 이정표 넷이 전부 ratio 0 이라 그 탭의 맨 아래로 밀린다. 방이 자기 문을
 * 모르면 "왜 모아야 하는가"의 답이 화면 밖에 있는 셈이다.
 *
 * 문턱과 같은 점수는 **이미 넘은 것**으로 본다 — `collectionGrade` 와 이정표
 * 판정이 둘 다 `>=` 이므로, 여기서만 `>` 로 세면 30점인 사람에게 이미 열린 문을
 * 가리키게 된다.
 */
export function nextCollectionGate(
  milestones: readonly MilestoneDef[],
  score: number,
): { threshold: number; name: string } | null {
  let best: MilestoneDef | undefined
  for (const m of milestones) {
    if (m.metric.kind !== 'collection') continue
    if (m.threshold <= score) continue
    if (best === undefined || m.threshold < best.threshold) best = m
  }
  return best === undefined ? null : { threshold: best.threshold, name: best.name }
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
    // 'combat' 계열(아크 E §4 — 전투 드랍)도 같은 가드다: 방의 칸은 채집물
    // 25종뿐이라(§6-앞 4: 만든 것도 잡은 것도 캔 것이 아니다) 전투 계열이 방에
    // 설 자리가 없고, 이 가드가 없으면 bySkill 인덱싱이 컴파일에서 깨진다.
    if (def?.skill === undefined || def.skill === 'combat') continue
    const line = bySkill.get(def.skill)
    if (line === undefined) continue

    // `Object.hasOwn` 인 이유는 `collectionScore` 와 같다 — `donated` 는 세이브에서
    // 온 객체라 상속 키(`constructor` 등)가 정의 행세를 할 수 있고, 맨손 조회는
    // `?? 0` 으로도 그것을 못 막는다(값이 undefined 가 아니라 함수다). 두 곳이
    // 다른 규칙을 쓰면 머리의 총점과 칸의 개수가 갈리는데, 플레이어에게는 어느
    // 쪽이 참인지 확인할 방법이 없다.
    const donated = Object.hasOwn(player.donated, thresholds.itemId)
      ? (player.donated[thresholds.itemId] ?? 0)
      : 0
    const grade = collectionGrade(donated, thresholds)
    const next = nextThresholdOf(donated, thresholds)
    line.slots.push({
      itemId: thresholds.itemId,
      name: def.name,
      donated,
      grade,
      nextStep: next?.step ?? null,
      remaining: next?.remaining ?? null,
      // 마지막 문턱을 계산된 첨자(`COLLECTION_MAX_GRADE - 1`)가 아니라 리터럴로
      // 꺼낸다: `steps` 는 4-튜플이라 계산된 첨자는 `number | undefined` 가 되고,
      // 그러면 없는 기본값(0)을 지어내야 한다 — 화면에 `만강 0` 을 적는 길이다.
      // 단이 다섯이 되는 날 이 줄은 컴파일에서 먼저 깨지는데, 그때 깨지는 것이 옳다.
      finalStep: thresholds.steps[3],
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
