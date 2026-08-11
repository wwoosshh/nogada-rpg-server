import { clamp } from './formulas/clamp.js'
import type { PlayerState, SkillId } from './types.js'

/**
 * 이정표가 무엇을 보는가.
 *
 * 모든 지표는 단조 증가해야 한다 — 그래야 달성이 되돌려지지 않고,
 * 달성 여부를 저장할 필요가 없어진다.
 */
export type MilestoneMetric =
  | { kind: 'skill'; skill: SkillId }
  /** 나열한 이정표 중 몇 개를 달성했는가. threshold 가 개수다 */
  | { kind: 'every'; of: string[] }

/**
 * 달성했을 때 무엇이 열리는가.
 *
 * `recipes` 와 `nodes` 는 새 게이트를 만드는 것이 아니라 이미 데이터가 강제하는
 * 게이트를 선언하는 것이다. 그래야 목록에 "칭호를 받는다" 와 "철 곡괭이를 만들 수
 * 있게 된다" 가 섞이고, 그 차이가 이 시스템의 값어치다.
 *
 * `title` 은 효과가 없다는 뜻이고, 그 사실을 숨기지 않는다.
 */
export type MilestoneEffect =
  | { kind: 'repeat'; skill: SkillId }
  | { kind: 'recipes'; ids: string[] }
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'title' }

export interface MilestoneDef {
  id: string
  metric: MilestoneMetric
  threshold: number
  name: string
  announce: string
  effect: MilestoneEffect
}

function byId(all: readonly MilestoneDef[], id: string): MilestoneDef | undefined {
  return all.find((m) => m.id === id)
}

/** 그 이정표의 지표가 지금 얼마인가. */
export function metricValue(
  def: MilestoneDef,
  player: PlayerState,
  all: readonly MilestoneDef[],
): number {
  const m = def.metric
  if (m.kind === 'skill') return player.skills[m.skill]

  let count = 0
  for (const id of m.of) {
    const other = byId(all, id)
    // 없는 이정표를 가리키면 세지 않는다. 데이터 검증이 막지만, 막지 못했을 때
    // 조용히 달성되는 것보다 조용히 달성 안 되는 편이 낫다.
    if (other && isAchieved(other, player, all)) count += 1
  }
  return count
}

export function isAchieved(
  def: MilestoneDef,
  player: PlayerState,
  all: readonly MilestoneDef[],
): boolean {
  return metricValue(def, player, all) >= def.threshold
}

/**
 * 이정표 탭(목록)이 쓰는 진척 비율. 0 에서 1 사이로 잘린다.
 *
 * `every` 는 metricValue(달성 개수)를 threshold 로 나누지 않는다. 그렇게 하면
 * 이미 달성한 항목 하나가 비율을 개수 단위(1/2, 1/3 …)로 크게 밀어올려, 실제로는
 * 한참 남은 나머지 항목이 있는데도 "가깝다" 고 말하게 된다 — 둘 중 하나를 이미
 * 달성하고 나머지가 10% 남았을 때, 개수 비율은 0.5 를 보고하지만 진짜 병목은
 * 0.1 이다. 이정표 탭은 이 비율로 못한 것을 정렬하므로(detailMenuTabs.ts 의
 * buildMilestoneRows), 그 병목의 정체가 다른 이정표(여기서는 나머지 하나 그
 * 자체)일 때 합산 쪽을 앞자리로 잘못 고르게 된다 — 심지어 그 합산은 병목이
 * 끝나기 전까지는 논리적으로 달성될 수도 없다.
 *
 * 그래서 참조한 이정표들의 비율 중 threshold 번째로 큰 값을 쓴다. 전부를
 * 요구하는 지금 데이터(threshold === of.length)에서는 곧 최솟값이고, 가장 덜
 * 된 것이 전체 진척을 정한다는 뜻이다.
 */
export function milestoneRatio(
  def: MilestoneDef,
  player: PlayerState,
  all: readonly MilestoneDef[],
): number {
  if (def.threshold <= 0) return 1

  const m = def.metric
  if (m.kind === 'every') {
    const ratios = m.of
      .map((id) => {
        const other = byId(all, id)
        // metricValue 와 같은 원칙이다 — 없는 이정표는 진척 0 으로 친다.
        return other ? milestoneRatio(other, player, all) : 0
      })
      .sort((a, b) => b - a)
    const rank = clamp(def.threshold, 1, ratios.length) - 1
    return ratios[rank] ?? 0
  }

  return clamp(metricValue(def, player, all) / def.threshold, 0, 1)
}

export function achievedIds(
  all: readonly MilestoneDef[],
  player: PlayerState,
): Set<string> {
  const ids = new Set<string>()
  for (const def of all) {
    if (isAchieved(def, player, all)) ids.add(def.id)
  }
  return ids
}

/**
 * 달성했지만 아직 축하하지 않은 것들.
 *
 * 축하 이력에 지금 없는 id 가 들어 있어도 무시한다 — 이정표를 지운 뒤에도
 * 옛 세이브가 그대로 살아 있어야 한다.
 */
export function newlyAchieved(
  all: readonly MilestoneDef[],
  player: PlayerState,
  celebrated: readonly string[],
): MilestoneDef[] {
  const seen = new Set(celebrated)
  return all.filter((def) => !seen.has(def.id) && isAchieved(def, player, all))
}
