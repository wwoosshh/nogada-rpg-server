import {
  calcCraftSuccess,
  craftIntervalMs,
  gatherBracketFor,
  gatherHandOf,
  gatherIntervalMs,
  starterToolFor,
  type GatherHand,
  type GatherTableDef,
  type MapDef,
  type PlayerState,
  type RecipeDef,
  type SkillId,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { emptyPlayer } from './emptyPlayer.js'
import { tierChances } from './gatherMeasure.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'
import { startVillages, villageField } from './maps.js'
import { storyChainOf } from './story.js'

/**
 * **유도등이 몇 분짜리인가** — 이 아크의 표제 주장을 재는 자(설계 ③·⑧).
 *
 * 설계가 「첫 3.5분 뒤 띠가 스스로 꺼진다」를 걸어 놓고 그 분(分)을 한 번도 안
 * 쟀다. 재 보니 **광물만 −29%** 였다(2.5분 대 3.5분). 어긋남은 통째로 마디 3
 * 하나에 있었고, 원인은 구조적이다: 마디 3 의 수량은 `collection.csv` 의 1단인데
 * 그 표는 **최종 브라켓 · 최적손 30분**을 겨냥해 교정된 것이라(collection.ts 의
 * EQUITY_MIN/MAX_MINUTES) 초반의 순서와 다르다. 종반 ∞ 브라켓에서 구리 원석은
 * 9.0% · 얼음 조각은 31.0% 라 1단이 50 대 200 이 됐는데, **초반 첫 브라켓에서는
 * 19.9% 대 45.0%** 로 격차가 2.26배뿐이다. 종반용 눈금을 초반 마디가 그대로
 * 빌려 쓴 것이 어긋남의 전부다.
 *
 * ## 이 자가 무엇을 재고 무엇을 안 재는가
 *
 * **재는 것**: 채집·제작에 실제로 들어가는 시간. 확률은 출하 표를 전수로
 * (`tierChances`), 간격은 `gatherIntervalMs`·`craftIntervalMs`, 성공률은
 * `calcCraftSuccess`, 수량·숙련 증가는 CSV — **숫자를 하나도 옮겨 적지 않는다.**
 * 표·레시피·마디를 손보면 이 자가 함께 움직인다.
 *
 * **안 재는 것 셋.**
 * ① **걷는 시간.** 지형은 빌드 시점 산출물이라 `GameData` 에 없어서 여기서
 *    BFS 를 돌릴 수 없다. 설계 ③ 의 BFS 실측으로는 계열별 6.4~14.6초이고,
 *    총합의 2.7~9.6% 다.
 * ② **사람의 탭 지연.** 서버 간격에 딱 맞춰 끊임없이 누른다고 본다. 그래서 아래
 *    분은 **전형값이 아니라 하한**이다 — 탭마다 100ms 를 얹으면 넷 다 30% 쯤
 *    길어진다.
 * ③ **무엇을 할지 찾는 시간.**
 *
 * ## 그래서 관문은 **배수**다 — 절대값이 아니라
 *
 * 위 셋이 전부 절대값을 밀어 올리는 항이고, 그중 어느 것도 안 쟀다. 이 저장소는
 * 미측정 상수 위에 좁은 대역을 세워 이미 틀린 적이 있다(결계 아크 — 분-자 값의
 * 80%가 모형 상수에서 나오는데 대역이 실측값 바로 아래 붙어 있었다). 그래서
 * **주 관문은 네 계열이 서로 얼마나 다른가** 하나다: 탭 지연을 0 에서 200ms 까지
 * 밀어도 그 배수는 1.39 → 1.46 으로 거의 안 움직이는 반면 절대값은 +63% 움직인다.
 * 절대 대역도 걸되 **넉넉하게** 건다 — 그 줄이 잡는 것은 「대충 몇 분짜리인가」가
 * 자릿수로 어긋나는 날뿐이다.
 */

const data = loadGameData()
const tables = loadGatherTables()

/** 마디가 실제로 시키는 일을 다 마쳤을 때의 값. */
interface 완주 {
  village: MapDef
  skill: SkillId
  /** 마디별 초. 색인이 곧 마디 번호다. */
  마디초: number[]
  /** 채집을 몇 번 눌렀는가(성패 무관). */
  탭: number
  분: number
}

/** 신규 한 명 — 고른 마을과 그 계열의 구리 도구 하나. */
function 신규(village: MapDef): PlayerState {
  const skill = villageField(data, village.id).skill
  const tool = starterToolFor(skill, data.items)
  return {
    ...emptyPlayer(),
    startVillage: village.id,
    location: { mapId: village.id, x: village.spawn.x, y: village.spawn.y },
    instances: [{ instanceId: 'starter', itemId: tool.id, enhanceLevel: 0 }],
    equipped: { [skill]: 'starter' },
  }
}

/** 그 채집장의 **보통 노드가 쓰는 표** — 마디 1~4 의 시간이 전부 여기서 나온다. */
function 보통표(villageId: string): GatherTableDef {
  const field = villageField(data, villageId)
  const ids = new Set<string>()
  for (const placement of Object.values(data.placements)) {
    if (placement.mapId !== field.map.id) continue
    const node = data.nodes[placement.nodeId]
    if (node?.variant === 'normal') ids.add(node.tableId)
  }
  if (ids.size !== 1) throw new Error(`${villageId}: 보통 노드의 표가 ${ids.size}개다`)
  const table = tables[[...ids][0]!]
  if (!table) throw new Error(`${villageId}: 표를 못 찾았다`)
  return table
}

/**
 * 이 손·이 숙련에서 한 번 캘 때의 기대값 — 성공률과 티어별 확률.
 *
 * 브라켓은 숙련이 오르면 갈리므로 **부를 때마다 다시 고른다.** 한 번 골라 두고
 * 끝까지 쓰면 마디 3~4 의 수백 회가 첫 브라켓 확률로 계산돼, 표를 손봐도 이 자가
 * 안 움직이는 구간이 생긴다.
 *
 * 브라켓 **객체로** 기억해 둔다. `tierChances` 는 굴림 100,001 가지를 전수로 세는
 * 함수라(표본이 아닌 이유는 gatherMeasure 참고) 채집 한 번마다 부르면 네 계열
 * 합쳐 2억 번이 넘는다 — 실제로 5분을 넘겨 멈춰 세웠다. 같은 브라켓·같은 손이면
 * 답이 같으므로 한 계열에 브라켓 수만큼(대여섯 번)만 센다.
 */
const 확률기억 = new Map<GatherHand, Map<unknown, { 성공률: number; 티어: number[] }>>()
function 한번(table: GatherTableDef, prof: number, hand: GatherHand): { 성공률: number; 티어: number[] } {
  const bracket = gatherBracketFor(table, prof)
  // 손도 키에 넣는다 — 브라켓만으로 기억하면 손이 둘 이상 도는 날(증표·강화)
  // 한 손의 답이 다른 손에게 나간다. 오늘은 계열마다 손이 하나뿐이라 안 나지만,
  // 그 사실에 기대는 캐시는 조용히 틀린다.
  const 손별 = 확률기억.get(hand) ?? new Map()
  확률기억.set(hand, 손별)
  const 있는것 = 손별.get(bracket)
  if (있는것) return 있는것
  const 티어 = tierChances(bracket.cumulative, hand)
  const 답 = { 성공률: 티어.reduce((a, b) => a + b, 0), 티어 }
  손별.set(bracket, 답)
  return 답
}

/** 채집 한 번의 기댓값을 상태에 반영한다. 걸린 ms 를 돌려준다. */
function 캔다(
  table: GatherTableDef,
  hand: GatherHand,
   상태: { prof: number; 가방: Map<string, number>; 성공: number; 탭: number },
): number {
  const ms = gatherIntervalMs(상태.prof, hand)
  const { 성공률, 티어 } = 한번(table, 상태.prof, hand)
  table.tiers.forEach((tier, i) => {
    상태.가방.set(tier.itemId, (상태.가방.get(tier.itemId) ?? 0) + (티어[i] ?? 0))
  })
  // 숙련은 **성패 무관** 무조건 오른다(gatherService ②) — 이 한 줄이 마디 4 의
  // 시간을 정한다. 성공했을 때만 올리는 모형은 그 마디를 40% 부풀린다.
  상태.prof += (table.skillGainMin + table.skillGainMax) / 2
  상태.성공 += 성공률
  상태.탭 += 1
  return ms
}

/** 이 레시피 한 번의 성공률 — 망치도 강화도 없는 손이다(신규는 그렇다). */
function 제작성공률(recipe: RecipeDef, crafting: number, gateProf: number): number {
  return calcCraftSuccess({
    proficiency: crafting,
    toolTier: 0,
    enhanceLevel: 0,
    gateProficiency: gateProf,
    recipe,
  })
}

/**
 * 마을 하나의 마디 0~5 를 끝까지 굴린다.
 *
 * 사슬은 **출하 `story.csv` 를 그 마을에서 편 것**이다(`storyChainOf`) — 마디를
 * 여기서 다시 적지 않는다. 그래야 CSV 를 고치면 이 자가 함께 움직인다.
 */
function 완주한다(village: MapDef): 완주 {
  const player = 신규(village)
  const skill = villageField(data, village.id).skill
  const hand = gatherHandOf(player, skill, data.items)
  const table = 보통표(village.id)
  const chain = storyChainOf(data, player)

  const 상태 = { prof: 0, 가방: new Map<string, number>(), 성공: 0, 탭: 0 }
  let crafting = 0
  const 마디초: number[] = []

  /** 이 표가 내주는 물건인가 — 아니면 만들어야 한다(구리 주괴가 그렇다). */
  const 캘수있다 = (itemId: string): boolean => table.tiers.some((t) => t.itemId === itemId)

  /** 그 물건을 그만큼 가방에 채운다 — 캐거나, 만들거나. */
  const 확보한다 = (itemId: string, 필요: number, 깊이: number): number => {
    let ms = 0
    if (캘수있다(itemId)) {
      while ((상태.가방.get(itemId) ?? 0) < 필요) ms += 캔다(table, hand, 상태)
      return ms
    }
    // 못 캐는 것은 만든다 — `copper_hammer` 가 요구하는 `copper_ingot` 이 그것이다.
    // 재귀가 도는 것을 막는 것은 레시피 표가 비순환이라는 사실 하나뿐이라, 여기서
    // 깊이를 세어 던진다: 순환이 생긴 날 이 자가 조용히 안 끝나면(실제로 그랬다 —
    // 워커가 메모리로 죽었다) 원인이 어디인지 아무 데도 안 남는다.
    if (깊이 > 4) throw new Error(`재료 사슬이 너무 깊다: ${itemId}`)
    const 만들것 = Object.values(data.recipes).find((r) => r.output.item === itemId)
    if (!만들것) throw new Error(`"${itemId}" 는 이 표에서 안 나오고 만들 수도 없다`)
    while ((상태.가방.get(itemId) ?? 0) < 필요) ms += 만든다(만들것, 깊이 + 1)
    return ms
  }

  /** 그 레시피를 한 번 성공할 때까지 — 재료가 모자라면 그것부터 마련한다. */
  function 만든다(recipe: RecipeDef, 깊이 = 0): number {
    let ms = 0
    const 성공률 = 제작성공률(recipe, crafting, 상태.prof)
    if (성공률 <= 0) throw new Error(`${recipe.id} 를 이 손으로는 영영 못 만든다`)
    const 시도 = 1 / 성공률
    // 실패는 재료를 **절반(올림)** 만 먹는다(craftService) — 기대 소모는
    // 성공 한 번 + 실패마다 절반이다.
    const 실패 = 시도 - 1
    for (const input of recipe.inputs) {
      const 필요 = input.count + Math.ceil(input.count / 2) * 실패
      ms += 확보한다(input.item, 필요, 깊이)
      상태.가방.set(input.item, (상태.가방.get(input.item) ?? 0) - 필요)
    }
    // 제작 실패는 숙련을 한 톨도 안 올린다(craftService) — 성공한 것만 센다.
    ms += craftIntervalMs(crafting, null) * 시도
    crafting += (recipe.skillGainMin + recipe.skillGainMax) / 2
    상태.가방.set(recipe.output.item, (상태.가방.get(recipe.output.item) ?? 0) + recipe.output.count)
    return ms
  }

  for (const step of chain) {
    let ms = 0
    const goal = step.goal
    if (goal.kind === 'arrive') {
      // 걷는 시간은 이 자가 못 잰다(위 문서 ①).
    } else if (goal.kind === 'gather') {
      const 목표 = 상태.성공 + (goal.count ?? 1)
      while (상태.성공 < 목표) ms += 캔다(table, hand, 상태)
    } else if (goal.kind === 'donate') {
      // 헌납 자체에는 행동 간격이 없다(donateService) — 시간은 모으는 데 든다.
      // 마디 1·2 에서 이미 쌓인 것을 그대로 센다(가방은 이어진다).
      while ((상태.가방.get(goal.arg) ?? 0) < (goal.count ?? 1)) ms += 캔다(table, hand, 상태)
      상태.가방.set(goal.arg, (상태.가방.get(goal.arg) ?? 0) - (goal.count ?? 1))
    } else if (goal.kind === 'reach') {
      const milestone = data.milestones.find((m) => m.id === goal.arg)
      if (milestone?.metric.kind !== 'skill') throw new Error(`${goal.arg} 는 숙련 이정표가 아니다`)
      // **델타가 아니라 문턱이다**(StoryGoalKind) — 앞 마디에서 쌓인 숙련을 그대로
      // 이어받는다. 이 구별이 얼음·나무·허브의 마디 4 를 300여 회에서 200여 회로
      // 줄인다.
      if (milestone.metric.skill === 'crafting') {
        // 광물만 이 길이다 — 광물 1,000 에는 문이 없어 설계 ③ 이 조합 200 으로 보냈다.
        const 주괴 = data.recipes['copper_ingot']
        if (!주괴) throw new Error('copper_ingot 레시피가 없다')
        while (crafting < milestone.threshold) ms += 만든다(주괴)
      } else {
        while (상태.prof < milestone.threshold) ms += 캔다(table, hand, 상태)
      }
    } else if (goal.kind === 'craft') {
      const recipe = data.recipes[goal.arg]
      if (!recipe) throw new Error(`${goal.arg} 레시피가 없다`)
      for (let i = 0; i < (goal.count ?? 1); i++) ms += 만든다(recipe)
    }
    마디초.push(ms / 1000)
  }

  const 초 = 마디초.reduce((a, b) => a + b, 0)
  return { village, skill, 마디초, 탭: Math.round(상태.탭), 분: 초 / 60 }
}

const 완주들 = startVillages(data).map(완주한다)
const 분들 = 완주들.map((r) => r.분)
const 최소 = Math.min(...분들)
const 최대 = Math.max(...분들)

describe('유도등의 길이 — 네 계열이 같은 사슬을 걷는가', () => {
  it('전제: 마을 넷이 전부 마디 0~5 를 걷는다', () => {
    expect(완주들).toHaveLength(4)
    for (const r of 완주들) expect([r.village.id, r.마디초.length]).toEqual([r.village.id, 6])
  })

  /**
   * **주 관문.** 가장 긴 계열이 가장 짧은 계열의 1.25배를 넘지 않는다.
   *
   * 1.25 인 이유: 이 아크가 고친 어긋남이 **1.41배**(광물 2.52분 대 허브 3.58분)
   * 였고, 설계 ⑧ 실기 확인 2가 첫 채집까지의 허용폭으로 이미 ±20% 를 적어 뒀다.
   * 그 폭을 그대로 빌려 온다 — 마디 하나가 계열 하나에서만 두 배가 되는 날 짖고,
   * 표를 조금 손보는 정도로는 안 짖는다.
   *
   * **이 줄이 절대값보다 튼튼한 이유**는 파일 상단에 적었다: 안 잰 항 셋이 전부
   * 네 계열에 거의 같은 크기로 얹히므로 분자와 분모에서 함께 커진다.
   */
  it('가장 긴 계열이 가장 짧은 계열의 1.25배 안이다', () => {
    const 표 = 완주들.map((r) => `${r.skill} ${r.분.toFixed(2)}분(탭 ${r.탭})`).join(' · ')
    expect(최대 / 최소, `계열마다 사슬 길이가 다르다 — ${표}`).toBeLessThanOrEqual(1.25)
  })

  /**
   * 곁 관문 — **자릿수만 본다.** 위 배수가 주 관문이고 이것은 「대충 몇 분짜리인가」
   * 가 통째로 어긋나는 날을 위한 것이다.
   *
   * 아래끝 2분: 이 모형은 걷는 시간도 탭 지연도 안 세므로 **하한**이다. 실제로는
   * 여기에 계열별 6.4~14.6초(걸음)와 사람의 손이 얹힌다.
   * 위끝 6분: 탭마다 100ms 를 얹은 값(4.6분)에도 여유가 남는 자리다. 설계 ⑥ 이
   * 「3.5분이 옳은 길이인가는 재지 못했다」고 스스로 적었고, 되돌리는 손잡이가
   * CSV 숫자 하나라는 것이 그 문단의 결론이다 — 그 손잡이를 여기서 좁게 묶지 않는다.
   */
  it('넷 다 2~6분 사이다 — 자릿수가 어긋나면 짖는다', () => {
    for (const r of 완주들) {
      expect(r.분, `${r.skill}(${r.village.id}) 가 ${r.분.toFixed(2)}분이다`).toBeGreaterThan(2)
      expect(r.분, `${r.skill}(${r.village.id}) 가 ${r.분.toFixed(2)}분이다`).toBeLessThan(6)
    }
  })

  /**
   * 양성 대조군 — **마디 3 이 실제로 시간을 쓰는가.**
   *
   * 위 두 줄은 총합만 본다. 광물이 어긋났던 자리가 마디 3 하나였고(14.3초 대
   * 120~128초), 그 상태에서도 총합은 2.5분이라 "짧지만 있기는 하다" 로 보인다.
   * 마디 3 은 **수집의 방 첫 별**을 여는 마디라 그 자리가 스쳐 지나가면 설계 ③ 이
   * 「1.5~2.6분」이라고 적어 둔 순간 자체가 없어진다.
   */
  it('마디 3(첫 별)이 어느 계열에서도 20초 이상이다 — 스쳐 지나가지 않는다', () => {
    for (const r of 완주들) {
      expect(r.마디초[3], `${r.skill} 의 마디 3 이 ${r.마디초[3]!.toFixed(1)}초다`).toBeGreaterThan(20)
    }
  })
})
