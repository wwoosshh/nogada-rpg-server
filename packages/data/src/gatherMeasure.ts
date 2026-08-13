import type { GatherBracketDef, GatherHand, GatherTableDef, ItemDef, PlayerState, SkillId } from '@nogada/shared'
import {
  DEFAULT_APPEARANCE,
  GATHER_ROLL_MAX,
  SKILL_IDS,
  emptyDialogueHistory,
  gatherHandOf,
  gatherIntervalMs,
  gatherRoll,
  sellPrice,
} from '@nogada/shared'

/**
 * **빌드 검증이 채집표를 재는 자.**
 *
 * 표를 시간·골드로 되재는 검증이 둘이다 — 수집의 방 형평(collection.ts)과 심층
 * 표의 분당 산출(gatherTables.ts). 둘 다 "그 브라켓에서 그 손이 각 티어를 뽑을
 * **정확한** 확률"이 필요한데, 그 셈을 각자 적어 두면 언젠가 한쪽만 낡는다 —
 * 그리고 낡는 쪽이 하필 검증이면, 빌드는 초록인데 게임의 값어치는 기울어 있다.
 * 그래서 자는 여기 하나뿐이고 두 검증이 나눠 쓴다.
 *
 * 표본이 아니라 전수(rawRoll 100001 가지)인 것과 판정과 **같은 함수**(`gatherRoll`)를
 * 부르는 것은 §6-앞 14 의 교훈이다: 확률이 걸린 검증에서 "안 나왔다"와 "못
 * 나온다"를 구별하지 못하면 곱하기 하나가 틀린 표가 조용히 통과한다.
 */

/** roll 의 정의역 크기 — roll ∈ 0~100000 이므로 확률의 분모는 100001 이다. */
export const ROLL_DOMAIN = GATHER_ROLL_MAX + 1

/**
 * 표를 재는 흉내 플레이어.
 *
 * `emptyPlayer()` 를 쓰지 않는 이유: 그 함수는 `loadGameData()`(구운
 * gamedata.json)를 읽는데, 이 검증들은 **그 파일을 굽기 전에** 빌드 안에서
 * 돌아간다 — 지난 빌드의 산출물로 이번 표를 재게 되고, 첫 빌드(생성 폴더가
 * 비어 있는 클론)에서는 아예 못 읽는다. 손을 만드는 데 필요한 칸은 셋
 * (`equipped`·`instances`·`stacks`)뿐이고 나머지는 자리표시자다.
 */
function fakePlayer(): PlayerState {
  return {
    id: 'gather-measure',
    name: '',
    appearance: DEFAULT_APPEARANCE,
    skills: Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as Record<SkillId, number>,
    stacks: {},
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    donated: {},
    dialogueHistory: emptyDialogueHistory(),
    weather: null,
    location: { mapId: '', x: 0, y: 0 },
  }
}

/**
 * 그 계열의 손 하나를 **게임과 같은 경로로** 짓는다(`gatherHandOf`).
 *
 * 배수를 여기서 직접 곱하지 않는 이유는 gatherSimulation.test.ts 와 같다:
 * 장비 조회나 증표 곱이 깨진 날에도 검증만 초록이면, 검증이 현실이 아니라
 * 사본을 지키게 된다. 도구 등급은 부르는 쪽이 **카탈로그에서 유도해** 넘긴다 —
 * 3티어를 상수로 박으면 4티어 도구가 생기는 날 "최적손"이 조용히 옛 손이 된다.
 *
 * 그 손을 지을 수 없으면(그 등급 도구나 그 계열 증표가 카탈로그에 없다) null 이다 —
 * 그것 자체가 위반이고, 무엇이 없는지는 부르는 쪽이 자기 문장으로 말한다.
 */
export function measureHand(
  skill: SkillId,
  items: Record<string, ItemDef>,
  toolTier: number | null,
  sight: boolean,
  enhanceLevel: number,
): GatherHand | null {
  const player = fakePlayer()

  if (toolTier !== null) {
    const tool = Object.values(items).find((item) => item.toolSkill === skill && item.toolTier === toolTier)
    if (!tool) return null
    player.instances = [{ instanceId: 'check', itemId: tool.id, enhanceLevel }]
    player.equipped = { [skill]: 'check' }
  }

  if (sight) {
    const token = Object.values(items).find((item) => item.tokenEffect === 'sight' && item.skill === skill)
    if (!token) return null
    player.stacks[token.id] = 1
  }

  return gatherHandOf(player, skill, items)
}

/** 그 브라켓에서 그 손이 각 티어를 뽑을 **정확한** 확률(전수 셈). */
export function tierChances(cumulative: readonly number[], hand: GatherHand): number[] {
  const counts = new Array<number>(cumulative.length).fill(0)
  for (let rawRoll = 0; rawRoll <= GATHER_ROLL_MAX; rawRoll++) {
    const roll = gatherRoll(rawRoll, hand.profile)
    const index = cumulative.findIndex((cum) => roll <= cum)
    if (index >= 0) counts[index]! += 1
  }
  return counts.map((count) => count / ROLL_DOMAIN)
}

/**
 * 그 브라켓·그 손·그 숙련의 **분당 산출**(매도가 기준 골드).
 *
 * 두 축을 한 숫자로 합치는 자다 — 분모는 간격(숙련과 손이 정한다), 분자는 회당
 * 기대 매도가(표와 손이 정한다). 표를 서로 견줄 때 이 축 하나만 쓰는 이유는
 * 결계 설계 §4 가 적은 그대로다: 최상위 티어 배수 하나로는 계열마다 다른 답이
 * 나오고(나무 ×1.16 vs 광물 ×3.01), 회당 골드만 보면 간격이 빠지며, 간격만
 * 보면 분포가 빠진다.
 *
 * 매도가인 것도 설계다 — 채집물의 값어치를 게임 안에서 실제로 정하는 것은
 * 정가가 아니라 상점이 사 주는 값이고(`sellPrice`), 그것이 이 저장소에서 골드가
 * 들어오는 유일한 문이다.
 */
export function goldPerMinute(
  table: GatherTableDef,
  bracket: GatherBracketDef,
  proficiency: number,
  hand: GatherHand,
  items: Record<string, ItemDef>,
): number {
  const chances = tierChances(bracket.cumulative, hand)
  let perAttempt = 0
  table.tiers.forEach((tier, index) => {
    const def = items[tier.itemId]
    // 없는 아이템을 가리키는 티어는 참조 검사가 이미 말했다 — 여기서 던지면
    // 오타 하나가 빌드를 검증 목록 대신 스택 트레이스로 세운다.
    if (def) perAttempt += (chances[index] ?? 0) * sellPrice(def)
  })
  return (perAttempt * 60_000) / gatherIntervalMs(proficiency, hand)
}
