import {
  COMBAT_INTERVAL_MIN_MS,
  JUDGE_EPSILON_MS,
  STEP_MS,
  manhattanDistance,
  monsterStateAt,
  withinAttackRange,
  type MonsterDef,
  type TilePos,
} from '@nogada/shared'
import type { MapTerrain } from './placements.js'

/**
 * 풀 수 있는 패턴만 출하된다 — 몬스터 패턴의 빌드 검사(설계 §8 검사 1~4).
 *
 * 몬스터는 시각의 순수 함수(monsterStateAt)라 주기가 유한하고, 그래서 전투가
 * 공정한지("피할 수 없는 순간이 없다", "영원히 안전한 A 홀드 자리가 없다")를
 * **빌드 시점에 전 주기를 시뮬해 증명할 수 있다.** 검사가 데이터(C6)보다
 * 먼저 있는 것이 이 아크의 순서다: 작가가 CSV 를 적는 순간부터 자가 서 있다.
 *
 * 시뮬은 채점자와 같은 함수(monsterStateAt)를 부른다 — 검사용 기하를 따로
 * 두면 검사는 통과하는데 실제 판정은 다른 칸을 무는 어긋남이 생긴다.
 */

/**
 * 예고 하한(ms) — 설계 §3. 700ms 는 3걸음(STEP_MS 200 × 3 = 600ms)이 넘는
 * 회피 예산이다: 부채꼴은 깊이 1 이 앞칸 하나라 측면 한 걸음(200ms)이면
 * 빠져나가고, 하한이 그 세 배를 넘어 "보고 피한다"가 반응속도 시험이 되지
 * 않는다. 이보다 짧은 예고는 협공(검사 1 픽스처가 보이는)의 재료가 된다.
 */
export const TELEGRAPH_MIN_MS = 700

/**
 * 스미어를 견디는 예고 하한(ms) = ε + TELEGRAPH_MIN_MS — 설계 §3(D3).
 *
 * 판정은 t 한 점이 아니라 구간 [t−ε, t+ε] 에서 하나라도 성립하면 피격이라
 * (JUDGE_EPSILON_MS, §2-5), 예고의 마지막 ε 는 바닥 표시가 떠 있는 채로 이미
 * 확정 피격 구간이다. 그래서 회피 예산 700ms 는 예고 전체가 아니라 **스미어를
 * 뺀 잔량**이 보장해야 한다: 700~(ε+700) 사이의 예고를 저작하면 위의 옛
 * 하한은 침묵하는데 실제 안전 예고는 700ms 미만이 된다 — 출하 wolf 가 1,800
 * 인 것은 우연이었고, 다음 몬스터 저작자가 700 을 적는 순간 "예고를 보고
 * 피한다"가 조용히 죽는 자리다. 리터럴 사본이 아니라 상수 유도인 이유:
 * ε 가 C7 재측정으로 줄면 이 하한도 따라 준다.
 */
export const TELEGRAPH_SMEAR_MIN_MS = JUDGE_EPSILON_MS + TELEGRAPH_MIN_MS

/**
 * 휩쓸기 활성 창 하한(ms) = 공격 간격 하한. 같은 숫자인 것이 계약이다(설계
 * §3·§5): 창이 최소 간격보다 좁으면 A 홀드 방치자의 스윙이 창을 통째로
 * 건너뛰는 휩쓸기가 생겨 "회피 안 하면 맞는다"(기대 피격 ≥ 1)가 확률로 샌다.
 */
export const SWEEP_ACTIVE_MIN_MS = COMBAT_INTERVAL_MIN_MS

/**
 * 한 칸이 연속으로 안전할 수 있는 시간의 상한(ms) — 검사 2 의 시간 축(설계
 * §8-2, §12-앞 4).
 *
 * 공간 축("전 주기 안전 칸 없음")만으로는 "주기의 95%가 안전한 칸"이
 * 통과한다 — 측면 한 칸 회피(왕복 2걸음 = 400ms)가 A 를 놓는 것(예고 하한
 * 700ms)보다 싸서, 그런 칸은 가끔 옆걸음 한 번이면 뚫리는 자판기다. 그래서
 * 위험이 각 공격 칸을 얼마나 자주 다시 무는지를 직접 죈다.
 *
 * 10,000ms 인 이유: 최대 간격(COMBAT_INTERVAL_MAX_MS=800) 기준 12스윙이다 —
 * 그보다 길게 회피 결정이 한 번도 없으면 전투가 채집과 같은 홀드가 된다.
 * 목표값이다(설계 §12 — 시간 수치는 브라우저에서 재고 확정한다): C6 의 출하
 * 패턴은 어느 공격 칸도 이보다 오래 안 물리는 채로 두지 않게 저작해야 한다.
 */
export const MAX_CONTINUOUS_SAFE_MS = 10_000

/** 검사 입력 하나 — C6 의 배치 파서가 이 모양으로 넘긴다(위상은 검사와 무관해서 없다). */
export interface PlacedMonster {
  /** 위반 메시지에 찍히는 이름. */
  instanceId: string
  mapId: string
  def: MonsterDef
}

/** 휩쓸기 하나를 시뮬이 쓰기 좋게 편 것 — 구역은 monsterStateAt 이 소유한 기하 그대로다. */
interface SweepEvent {
  telegraphStartMs: number
  telegraphMs: number
  sweepStartMs: number
  sweepEndMs: number
  zoneKeys: Set<string>
}

const key = (p: TilePos): string => `${p.x},${p.y}`

/**
 * 몬스터 패턴 전부를 검사한다. 반환은 작가용 위반 문장 — 어느 시각·어느
 * 칸인지 말해야 CSV 를 고칠 수 있다(validateSpeakerPlacements 문체).
 *
 * 몬스터마다 구조 전제 → 배치(검사 4) → 시뮬(검사 1~3) 순서고, 앞 단계가
 * 깨지면 뒤를 돌리지 않는다 — 벽 위 순찰 하나가 원인인데 시뮬의 그림자
 * 위반이 줄줄이 따라붙으면 진짜 원인이 파묻힌다(build.ts 의 문법 오류 선행
 * 보고와 같은 저울).
 */
export function validateMonsterPatterns(
  monsters: readonly PlacedMonster[],
  terrains: Record<string, MapTerrain>,
): string[] {
  const violations: string[] = []

  for (const monster of monsters) {
    const terrain = terrains[monster.mapId]
    if (!terrain) {
      violations.push(
        `monsters[${monster.instanceId}]: 없는 맵 "${monster.mapId}" 에 놓였다 — 지형을 맞대 볼 수 없어 나머지 검사를 못 한다`,
      )
      continue
    }

    const structural = checkStructure(monster)
    if (structural.length > 0) {
      violations.push(...structural)
      continue
    }

    const placement = checkPlacement(monster, terrain)
    if (placement.length > 0) {
      violations.push(...placement)
      continue
    }

    const events = sweepEventsOf(monster.def)
    violations.push(...checkEscapable(monster, terrain, events))
    violations.push(...checkNoSafeCamp(monster, terrain, events))
    violations.push(...checkWindows(monster, terrain, events))
  }

  return violations
}

/**
 * monsterStateAt 의 전제(그쪽 주석이 "파서·C2 가 막는다"고 미룬 것들) — 여기가
 * 그 C2 다. 전제가 깨진 def 로 시뮬을 돌리면 슬롯·국면 계산이 전부 헛돌아
 * 아래 검사들이 거짓말을 한다.
 */
function checkStructure({ instanceId, def }: PlacedMonster): string[] {
  const violations: string[] = []
  const who = `monsters[${instanceId}]`

  if (def.patrol.length === 0) {
    violations.push(`${who}: 순찰이 비었다 — 제자리 몬스터라도 서 있을 칸 하나는 적는다`)
  }
  if (!Number.isInteger(def.periodMs) || def.periodMs <= 0) {
    violations.push(`${who}: 주기 ${def.periodMs}ms — 양의 정수 ms 여야 한다`)
  } else if (def.patrol.length > 0 && def.periodMs % def.patrol.length !== 0) {
    violations.push(
      `${who}: 주기 ${def.periodMs}ms 가 순찰 ${def.patrol.length}칸으로 나눠떨어지지 않는다 — 슬롯 경계가 어긋나 시뮬과 화면이 다른 칸을 본다`,
    )
  }

  // 창 검사는 주기가 성립할 때만 뜻이 있다.
  if (violations.length > 0) return violations

  const windows = def.attacks
    .map((a) => ({
      start: a.telegraphStartMs,
      end: a.telegraphStartMs + a.telegraphMs + a.activeMs,
      attack: a,
    }))
    .sort((a, b) => a.start - b.start)

  for (const w of windows) {
    if (w.attack.reach < 1) {
      violations.push(`${who}: t=${w.start}ms 공격의 깊이 ${w.attack.reach} — 아무 칸도 못 무는 공격이다`)
    }
    if (w.attack.telegraphMs < 1 || w.attack.activeMs < 1) {
      violations.push(
        `${who}: t=${w.start}ms 공격의 창(예고 ${w.attack.telegraphMs}ms·활성 ${w.attack.activeMs}ms)이 비었다 — 없는 국면은 적지 않는다`,
      )
    }
    if (w.start < 0 || w.end > def.periodMs) {
      violations.push(
        `${who}: t=${w.start}ms 공격의 창이 주기 [0, ${def.periodMs}ms) 를 감아 넘는다 — t mod P 계산이 두 동강 나므로 창을 주기 안에 눕힌다`,
      )
    }
  }
  for (let i = 1; i < windows.length; i++) {
    const prev = windows[i - 1]!
    const cur = windows[i]!
    if (cur.start < prev.end) {
      violations.push(
        `${who}: t=${prev.start}ms 공격의 창(~${prev.end}ms)과 t=${cur.start}ms 공격의 창이 겹친다 — 같은 순간의 국면이 정해지지 않는다`,
      )
    }
  }
  return violations
}

/**
 * 검사 4 — 배치·순찰 칸이 걷는 칸 위인가(설계 §8-4, §12-앞 22). 순찰의
 * 이웃(감기 포함)이 같은 칸이거나 인접 한 칸인 것도 여기서 잰다 — 아니면
 * 화면에서 순간이동한다(types.ts 의 MonsterDef 주석이 여기로 미룬 검사다).
 */
function checkPlacement({ instanceId, def }: PlacedMonster, terrain: MapTerrain): string[] {
  const violations: string[] = []
  const who = `monsters[${instanceId}]`

  def.patrol.forEach((tile, i) => {
    if (tile.x < 0 || tile.y < 0 || tile.x >= terrain.width || tile.y >= terrain.height) {
      violations.push(
        `${who}: 순찰 ${i + 1}번째 칸 (${tile.x}, ${tile.y}) 이 맵 밖이다 — 맵은 가로 ${terrain.width}, 세로 ${terrain.height} 칸이라 x 는 0~${terrain.width - 1}, y 는 0~${terrain.height - 1} 이다`,
      )
      return // 맵 밖이면 벽인지 따질 칸 자체가 없다
    }
    if (terrain.walls.has(key(tile))) {
      violations.push(
        `${who}: 순찰 ${i + 1}번째 칸 (${tile.x}, ${tile.y}) 이 벽 칸이다 — 화면의 몬스터가 벽 속에 선다. 순찰을 빈 칸으로 옮긴다`,
      )
    }
  })

  for (let i = 0; i < def.patrol.length; i++) {
    const from = def.patrol[i]!
    const to = def.patrol[(i + 1) % def.patrol.length]!
    if (manhattanDistance(from, to) > 1) {
      violations.push(
        `${who}: 순찰 ${i + 1}→${((i + 1) % def.patrol.length) + 1}번째 칸이 (${from.x}, ${from.y})→(${to.x}, ${to.y}) 으로 건너뛴다 — 이웃(감기 포함)은 같은 칸이거나 인접 한 칸이어야 화면에서 순간이동하지 않는다`,
      )
    }
  }
  return violations
}

/** 휩쓸기들을 시각순으로 편다. 구역은 휩쓸기 시작 순간의 monsterStateAt 에서 읽는다. */
function sweepEventsOf(def: MonsterDef): SweepEvent[] {
  return def.attacks
    .map((a) => {
      const sweepStartMs = a.telegraphStartMs + a.telegraphMs
      return {
        telegraphStartMs: a.telegraphStartMs,
        telegraphMs: a.telegraphMs,
        sweepStartMs,
        sweepEndMs: sweepStartMs + a.activeMs,
        zoneKeys: new Set(monsterStateAt(def, sweepStartMs).dangerTiles.map(key)),
      }
    })
    .sort((a, b) => a.sweepStartMs - b.sweepStartMs)
}

/**
 * 검사 1 — 피할 수 없는 순간이 없다: 생존 가능 핵의 최대 고정점(설계 §8-1).
 *
 * 명중 시각만 검사하면 충분하다: 피해는 휩쓸기 활성 중 그 칸에서의 공격에만
 * 존재하고, 구역은 창 내내 고정(앵커 = 예고 시작 칸)이라 휩쓸기 시작 순간
 * 구역 밖이면 창이 끝날 때까지 밖이다. 그래서 명중 시각 h_i = 각 휩쓸기의
 * 시작이고, S(i) = { 걷는 칸 p : p ∉ danger(h_i) ∧ ∃q ∈ S(i+1),
 * 맨해튼(p,q) ≤ ⌊(h_{i+1}−h_i)/STEP_MS⌋ } 를 고정점까지 줄인다(감기 포함 —
 * 주기는 돈다). 그 다음 모든 걷는 칸이 모든 예고에서 예고 예산 안에 핵으로
 * 들어갈 수 있어야 한다. **정의역이 걷는 칸인 이유**: 이 검사는 정직한
 * 플레이어를 위한 보증이라, 벽 속에서만 살 수 있는 패턴은 풀 수 없는 패턴이다.
 */
function checkEscapable(
  { instanceId, def }: PlacedMonster,
  terrain: MapTerrain,
  events: SweepEvent[],
): string[] {
  const who = `monsters[${instanceId}]`
  if (events.length === 0) return []

  const walkable: TilePos[] = []
  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      if (!terrain.walls.has(`${x},${y}`)) walkable.push({ x, y })
    }
  }

  // 초기 핵: 그 명중 시각에 구역 밖인 걷는 칸 전부.
  const cores: TilePos[][] = events.map((e) => walkable.filter((p) => !e.zoneKeys.has(key(p))))
  for (let i = 0; i < events.length; i++) {
    if (cores[i]!.length === 0) {
      return [
        `${who}: t=${events[i]!.sweepStartMs}ms 휩쓸기가 걷는 칸 전부를 덮는다 — 어디 서 있어도 맞는다. 부채꼴을 줄이거나 맵을 넓힌다`,
      ]
    }
  }

  // 명중 시각 사이의 걸음 예산. 마지막 → 첫은 주기를 감아 잰다.
  const budgets = events.map((e, i) => {
    const next = events[(i + 1) % events.length]!
    const gapMs =
      i + 1 < events.length
        ? next.sweepStartMs - e.sweepStartMs
        : next.sweepStartMs + def.periodMs - e.sweepStartMs
    return Math.floor(gapMs / STEP_MS)
  })

  // 최대 고정점: 다음 핵에 예산 안에 닿지 못하는 칸을 제거하고, 변화가 없을
  // 때까지 반복한다. 핵 하나가 비는 순간 나머지도 연쇄로 비므로(다음 핵이
  // 없으면 아무도 못 산다) 첫 빈 핵만 말하고 멈춘다 — 그림자 위반 방지.
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < events.length; i++) {
      const next = cores[(i + 1) % events.length]!
      const kept = cores[i]!.filter((p) => next.some((q) => manhattanDistance(p, q) <= budgets[i]!))
      if (kept.length !== cores[i]!.length) {
        cores[i] = kept
        changed = true
      }
      if (kept.length === 0) {
        const nextEvent = events[(i + 1) % events.length]!
        return [
          `${who}: t=${events[i]!.sweepStartMs}ms 휩쓸기의 안전 칸에서 다음 휩쓸기(t=${nextEvent.sweepStartMs}ms)의 안전 칸까지 ${budgets[i]}걸음 안에 갈 수 없다 — 생존 가능 핵이 비었다. 휩쓸기 사이 간격을 늘리거나 부채꼴이 덮는 폭을 줄인다`,
        ]
      }
    }
  }

  // 모든 걷는 칸이 모든 예고에서 예고 예산 안에 핵으로 들어갈 수 있는가.
  const violations: string[] = []
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!
    const budget = Math.floor(e.telegraphMs / STEP_MS)
    const stranded = walkable.filter((p) => !cores[i]!.some((q) => manhattanDistance(p, q) <= budget))
    if (stranded.length > 0) {
      const samples = stranded
        .slice(0, 3)
        .map((p) => `(${p.x}, ${p.y})`)
        .join(', ')
      violations.push(
        `${who}: 예고(t=${e.telegraphStartMs}ms, ${e.telegraphMs}ms = ${budget}걸음) 안에 생존 핵에 들지 못하는 걷는 칸 ${stranded.length}개 — 예: ${samples}. 예고를 늘리거나 부채꼴 깊이를 줄인다`,
      )
    }
  }
  return violations
}

/**
 * 검사 2 — 영원·유사영원 안전 공격 칸 없음(설계 §8-2, §12-앞 4·5).
 *
 * **정의역은 전체 칸이다 — 벽 포함.** 위치는 주장이라 서버가 벽 칸 주장을
 * 막지 못하고(§2-3, 수용한 노출), 그래서 벽 속 A 홀드 자리도 부채꼴이
 * 정기적으로 물어야 한다(monsterStateAt 의 부채꼴이 벽을 거르지 않는 이유).
 * 다만 사거리에 한 번도 안 드는 칸은 공격 칸이 아니므로 — 거기선 A 를 눌러도
 * 아무 일도 없다 — 검사 대상이 아니다.
 *
 * 공간 퇴화: 전 주기 동안 어느 휩쓸기에도 안 덮이는 공격 칸.
 * 시간 퇴화: 덮이긴 하지만 연속 안전 시간이 상한을 넘는 공격 칸 —
 * "주기의 95%가 안전"이 여기서 걸린다.
 */
function checkNoSafeCamp(
  { instanceId, def }: PlacedMonster,
  terrain: MapTerrain,
  events: SweepEvent[],
): string[] {
  const violations: string[] = []
  const who = `monsters[${instanceId}]`

  for (let y = 0; y < terrain.height; y++) {
    for (let x = 0; x < terrain.width; x++) {
      const p = { x, y }
      // 몬스터가 서는 칸은 순찰 칸뿐이므로 "사거리에 든 적 있는가"는 순찰만 보면 된다.
      if (!def.patrol.some((t) => withinAttackRange(p, t))) continue

      const 벽표시 = terrain.walls.has(key(p)) ? ' (벽 칸이다 — 벽 주장 치터의 홀드 자리)' : ''
      const hits = events
        .filter((e) => e.zoneKeys.has(key(p)))
        .map((e) => ({ start: e.sweepStartMs, end: e.sweepEndMs }))
        .sort((a, b) => a.start - b.start)

      if (hits.length === 0) {
        violations.push(
          `${who}: (${x}, ${y}) 는 사거리에 들면서 전 주기(${def.periodMs}ms) 동안 어떤 휩쓸기에도 안 덮인다${벽표시} — 거기 서서 A 만 누르면 영원히 안전하다. 부채꼴 방향이나 앵커를 늘려 그 칸을 물게 한다`,
        )
        continue
      }

      // 연속 안전 구간: 휩쓸기 창들 사이의 틈(감기 포함) 중 가장 긴 것.
      let maxGapMs = 0
      let gapStartMs = 0
      for (let i = 0; i < hits.length; i++) {
        const cur = hits[i]!
        const next = hits[(i + 1) % hits.length]!
        const gap = i + 1 < hits.length ? next.start - cur.end : next.start + def.periodMs - cur.end
        if (gap > maxGapMs) {
          maxGapMs = gap
          gapStartMs = cur.end % def.periodMs
        }
      }
      if (maxGapMs > MAX_CONTINUOUS_SAFE_MS) {
        violations.push(
          `${who}: (${x}, ${y}) 가 t=${gapStartMs}ms 부터 ${maxGapMs}ms 동안 연속 안전하다${벽표시} — 상한 ${MAX_CONTINUOUS_SAFE_MS}ms. 주기의 대부분이 안전한 칸은 A 홀드 + 가끔 옆걸음으로 뚫린다. 그 칸을 무는 공격을 촘촘히 넣거나 주기를 줄인다`,
        )
      }
    }
  }
  return violations
}

/**
 * 검사 3 — 예고 ≥ 700ms(반응 예산) · 예고 ≥ ε+700ms(스미어 잔량, D3) ·
 * 활성 ≥ 400ms · A 홀드 방치자 휩쓸기당 기대 피격 ≥ 1(설계 §8-3, §12-앞 1).
 *
 * 방치자 = 한 칸에 서서 최소 간격(COMBAT_INTERVAL_MIN_MS)으로 계속 공격하는
 * 사람. 스윙 위상이 균등하다고 보면 기대 피격 = (창 안에서 그 칸의 스윙이
 * 실제로 닿는 시간) / 간격이므로, 구역 칸마다 **사거리 체류 시간 ≥ 간격
 * 하한**이어야 기대 피격이 1 을 넘는다 — 창 폭 하한만으로는 순찰이 휩쓸기
 * 중에 떠나는 패턴도 문다 — **사거리 밖 스윙이 헛스윙(ok:true)이기 때문이다**
 * (§2-2). 헛스윙도 간격을 소모하고 피격을 판정하므로, 구역 칸의 방치자는
 * 몬스터가 어디 있든 활성 창 ≥ 간격 하한이면 반드시 한 번은 맞는다.
 *
 * 이 의미론이 아니었을 때의 구멍을 리뷰가 재현했다: 사거리 밖 스윙을 거절로
 * 두면 "구역에 덮이지만 그 순간 사거리 밖인 칸"의 방치자는 스윙이 전부
 * 거절이라(거절은 아무것도 판정하지 않는다) 영원히 무피격인 자판기 칸이 됐다.
 * 검사 2 는 사거리 체류를 모르고 이 검사는 그 칸을 검사 2 에 미뤘다 — 순환
 * 위임이었다. 헛스윙 의미론이 그 순환을 뿌리에서 끊는다: 위험은 구역 하나로
 * 정의되고, 사거리는 명중(몬스터 HP)에만 관여한다.
 */
function checkWindows(
  { instanceId, def }: PlacedMonster,
  terrain: MapTerrain,
  events: SweepEvent[],
): string[] {
  const violations: string[] = []
  const who = `monsters[${instanceId}]`

  for (const e of events) {
    // TELEGRAPH_SMEAR_MIN_MS(= ε+TELEGRAPH_MIN_MS)는 TELEGRAPH_MIN_MS보다 항상
    // 크므로(ε>0), 옛 700 하한을 어기는 예고는 이 스미어 하한도 반드시 함께
    // 어긴다 — 두 if 를 나란히 두면 예고 하나의 위반이 문장 둘로 겹쳐 찍힌다.
    // 스미어 하한 하나로 합쳐도 걸러내는 범위는 그대로다(옛 하한은 이 하한의
    // 부분집합이라 잃는 사례가 없다).
    if (e.telegraphMs < TELEGRAPH_SMEAR_MIN_MS) {
      violations.push(
        `${who}: t=${e.telegraphStartMs}ms 공격의 예고가 ${e.telegraphMs}ms — 판정 스미어 ε(${JUDGE_EPSILON_MS}ms)가 예고의 끝을 이미 확정 피격 구간으로 먹으므로, 스미어를 빼면 안전한 예고가 ${e.telegraphMs - JUDGE_EPSILON_MS}ms 뿐이다. 하한 ${TELEGRAPH_SMEAR_MIN_MS}ms(ε+${TELEGRAPH_MIN_MS}ms)`,
      )
    }
    const activeMs = e.sweepEndMs - e.sweepStartMs
    if (activeMs < SWEEP_ACTIVE_MIN_MS) {
      violations.push(
        `${who}: t=${e.sweepStartMs}ms 휩쓸기의 활성 창이 ${activeMs}ms — 하한 ${SWEEP_ACTIVE_MIN_MS}ms(공격 간격 하한). 창이 간격보다 좁으면 방치자가 스윙 사이로 휩쓸기를 통째로 지나친다`,
      )
    }

    // 구역 칸별 사거리 체류 검사는 은퇴했다 — 헛스윙 의미론(위 문서) 아래에서
    // 기대 피격 ≥ 1 은 "활성 창 ≥ 간격 하한" 하나가 전 구역 칸에 균일하게
    // 보장한다. 사거리 체류를 다시 재기 시작하면 위험의 정의가 둘이 된다.
  }
  return violations
}

