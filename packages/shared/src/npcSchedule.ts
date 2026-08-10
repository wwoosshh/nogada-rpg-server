import type { Direction, TilePos } from './movement.js'
import { createRng, rollInt } from './rng.js'
import { GAME_EPOCH_MS, REAL_MS_PER_GAME_DAY, REAL_MS_PER_GAME_MINUTE } from './time.js'
import type { BakedLeg, PlaceDef, RouteStep, ScheduleDef } from './types.js'

/**
 * NPC 일과의 게임 규칙이 사는 곳.
 *
 * 여기 있는 것은 **시간의 순수 함수**다 — 저장할 상태도, 밀어줄 트래픽도 없다.
 * 서버와 클라이언트가 같은 함수를 불러 같은 답을 얻는다(설계 §1). 빌드(경로
 * 굽기)와 런타임(위치 보간)이 같은 걸음 속도와 같은 시간 환산을 보는 것도
 * 같은 이유다: 둘이 갈라지면 빌드가 "닿는다"고 통과시킨 시간표에서 NPC 가
 * 도착 시각에 아직 길 위에 있다.
 */

/**
 * NPC 가 한 칸을 걷는 데 걸리는 실측 시간.
 *
 * 플레이어(`STEP_MS = 200`)의 절반 속도다 — 주민이 플레이어와 같은 속도로
 * 돌아다니면 마을이 분주해 보이고, 무엇보다 "저 사람은 볼일이 있어 지나간다"가
 * 아니라 "나를 따라온다"로 읽힌다.
 *
 * 시간 축은 게임 분이 아니라 실측 ms 다. 게임 1분이 실측 2.5초라 분 단위로
 * 재면 NPC 가 2.5초에 여섯 칸씩 껑충 뛴다.
 */
export const NPC_STEP_MS = 400

/**
 * 지금 무엇을 하고 있는가. 차단·상호작용 규칙이 여기서 갈린다(설계 §1).
 *
 * - `standing`: 칸을 차지하고 말을 걸 수 있다 — 지금의 정적 화자와 같다.
 * - `walking`: 통과 장식이다. 차단하지 않고 말도 걸 수 없다 — 대화 도중에
 *   걸어가 버리는 문제가 원천적으로 없다.
 * - `indoor`: 그 문 칸으로 들어가 맵에 없다.
 */
export type NpcActivity = 'standing' | 'walking' | 'indoor'

export interface NpcState {
  mapId: string
  tile: TilePos
  /**
   * `walking` 중에는 언제나 걸어가는 방향이다. 서 있을 때는 지점이 적어 둔
   * 방향이고, 작가가 적지 않았으면 null 이다.
   *
   * null 을 "아래를 본다"로 메우지 않는 것은 소유권 때문이다(설계 §6) —
   * 서 있는 동안의 방향은 기존 미세 동작(무작위 전환, 말 걸면 돌아보기)이
   * 소유한다. 여기서 매 틱 값을 내면 그것들이 한 프레임 만에 지워진다.
   */
  facing: Direction | null
  activity: NpcActivity
}

/** epoch 로부터 며칠째인가. 음수(=epoch 이전)도 그대로 돌려준다. */
function dayIndexAt(realMs: number): number {
  return Math.floor((realMs - GAME_EPOCH_MS) / REAL_MS_PER_GAME_DAY)
}

/** 그 날 그 줄이 도착해 있어야 하는 실측 시각. */
function arrivalMs(dayIndex: number, arriveMinute: number): number {
  return GAME_EPOCH_MS + dayIndex * REAL_MS_PER_GAME_DAY + arriveMinute * REAL_MS_PER_GAME_MINUTE
}

/**
 * 일과의 한 줄이 어느 날에 일어난 것인가 — 줄 번호만으로는 부족하다.
 *
 * 이 쌍이 이 파일의 중심이다. 활성 줄을 (날, 줄 번호)로 못박고 나면 그 뒤의
 * 모든 계산(지점·변주·출발 시각)이 **지금 시각의 날짜를 다시 보지 않는다** —
 * 자정을 걸치는 걸음이 도중에 목적지를 다시 뽑는 사고가 여기서 막힌다.
 */
interface Occurrence {
  dayIndex: number
  entryIndex: number
}

/**
 * 지금 시점에서 마지막으로 도착한 줄.
 *
 * 오늘 아직 아무 줄도 도착하지 않았으면 **어제의 마지막 줄**이다 — 하루가
 * 자정에 끊기면 새벽의 NPC 는 "아직 첫 줄이 오지 않았다"는 이유로 아무 데도
 * 없게 된다.
 *
 * 뒤에서부터 훑는 것은 도착 시각이 오름차순이기 때문이다(파서가 역행을 막는다).
 */
function activeOccurrence(schedule: ScheduleDef, nowMs: number): Occurrence {
  const today = dayIndexAt(nowMs)
  for (let i = schedule.entries.length - 1; i >= 0; i--) {
    if (arrivalMs(today, schedule.entries[i]!.arriveMinute) <= nowMs) {
      return { dayIndex: today, entryIndex: i }
    }
  }
  return { dayIndex: today - 1, entryIndex: schedule.entries.length - 1 }
}

/** 다음 줄. 마지막 줄 다음은 **다음 날** 첫 줄이다(되감기 구간). */
function nextOccurrence(schedule: ScheduleDef, current: Occurrence): Occurrence {
  return current.entryIndex + 1 < schedule.entries.length
    ? { dayIndex: current.dayIndex, entryIndex: current.entryIndex + 1 }
    : { dayIndex: current.dayIndex + 1, entryIndex: 0 }
}

/**
 * 문자열 화자 id 와 날·줄을 32비트 시드 하나로 접는다 (FNV-1a).
 *
 * 날짜만 시드로 쓰면 마을 사람 전원이 같은 날 같은 쪽을 고른다 — 변주를
 * 넣었는데 마을이 한 몸처럼 움직인다. 화자와 줄까지 섞어야 각자의 하루가 된다.
 */
function seedOf(speakerId: string, dayIndex: number, entryIndex: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < speakerId.length; i++) {
    hash = Math.imul(hash ^ speakerId.charCodeAt(i), 0x01000193)
  }
  hash = Math.imul(hash ^ dayIndex, 0x01000193)
  hash = Math.imul(hash ^ entryIndex, 0x01000193)
  return hash >>> 0
}

/**
 * `A | B` 변주에서 그 날 그 줄이 고를 후보의 번호.
 *
 * 서버와 클라이언트가 같은 답을 내야 하므로 저장된 상태가 아니라 시드로
 * 정한다 — 기존 `rng.ts` 의 mulberry32 를 그대로 쓴다(난수를 만드는 곳이
 * 둘이 되면 "결정적"의 뜻이 갈린다).
 *
 * `dayIndex` 는 **그 줄이 일어난 날**이다. 설계 §2.2 는 이것을 "그 줄의 출발
 * 시점이 속한 날"이라고 적었는데, 출발 시각은 고른 후보에 따라 달라지므로
 * (후보마다 경로 길이가 다르다) 그것을 글자 그대로 쓰면 시드가 자기 결과에
 * 의존한다. 줄이 일어난 날로 못박으면 그 순환이 없으면서 §2.2 가 막으려던
 * 것은 그대로 막힌다: 활성 줄이 (날, 줄 번호)로 정해지고 나면 자정을 넘어도
 * 같은 줄을 보므로, 걷는 도중에 목적지를 다시 뽑거나 자정에 순간이동하는
 * 일이 없다.
 *
 * `candidateCount` 는 1 이상이다 — 빈 후보 배열은 파서가 막는다.
 */
export function pickVariant(
  speakerId: string,
  dayIndex: number,
  entryIndex: number,
  candidateCount: number,
): number {
  if (candidateCount <= 1) return 0
  return rollInt(createRng(seedOf(speakerId, dayIndex, entryIndex)), 0, candidateCount - 1)
}

/**
 * 그 줄이 그 날 실제로 서는 지점.
 *
 * 없는 지점을 가리키면 던진다. 이 함수가 "총(total)"인 것은 **시각**에 대해서다 —
 * 어떤 시각에도 답이 있어야 한다. 그러나 없는 지점에는 좌표가 없어서 돌려줄
 * 답 자체가 없고, 빌드(validateSchedules)가 이미 막는 일이라 여기까지 왔다면
 * 생성물이 거짓말을 한 것이다. 조용히 아무 자리나 세우는 것보다 이름을 대고
 * 멈추는 편이 훨씬 찾기 쉽다.
 */
function placeOf(
  schedule: ScheduleDef,
  places: Record<string, PlaceDef>,
  occurrence: Occurrence,
): PlaceDef {
  const entry = schedule.entries[occurrence.entryIndex]!
  const variant = pickVariant(
    schedule.speakerId,
    occurrence.dayIndex,
    occurrence.entryIndex,
    entry.placeIds.length,
  )
  const placeId = entry.placeIds[variant]!
  const place = places[placeId]
  if (!place) {
    throw new Error(
      `일과 "${schedule.speakerId}" 가 없는 지점 "${placeId}" 를 가리킨다 — 데이터 빌드를 다시 돌린다`,
    )
  }
  return place
}

/** 구워 둔 구간을 찾는다. 런타임은 길찾기를 하지 않는다(설계 §3). */
function legBetween(routes: readonly BakedLeg[], fromId: string, toId: string): BakedLeg | undefined {
  return routes.find((leg) => leg.fromPlace === fromId && leg.toPlace === toId)
}

/**
 * 두 칸 사이의 방향. 맵이 다르면 방향이 없다(null).
 *
 * 문 칸에서 다음 칸은 다른 맵이라 좌표 차이가 방향이 아니다 — 거기서 억지로
 * 계산하면 한 칸도 아닌 좌표차에서 엉뚱한 방향이 나온다.
 */
function directionBetween(from: RouteStep | undefined, to: RouteStep | undefined): Direction | null {
  if (!from || !to || from.mapId !== to.mapId) return null
  if (to.y < from.y) return 'up'
  if (to.y > from.y) return 'down'
  if (to.x < from.x) return 'left'
  if (to.x > from.x) return 'right'
  return null
}

/** 지점에 서 있는 상태. `tile` 은 매번 새 객체다 — 부르는 쪽이 고쳐도 지점이 움직이면 안 된다. */
function standingAt(place: PlaceDef): NpcState {
  return {
    mapId: place.mapId,
    tile: { x: place.x, y: place.y },
    facing: place.facing,
    activity: place.indoor ? 'indoor' : 'standing',
  }
}

/**
 * 그 시각에 그 NPC 는 어디서 무엇을 하고 있는가.
 *
 * **전제:** `schedule.entries` 는 도착 시각 오름차순으로 최소 한 줄이다 —
 * 빈 일과와 역행은 파서가 막고(packages/data/src/schedule.ts), 여기서 다시
 * 검사하지 않는다. 한 줄짜리 일과는 자기 자신으로 돌아오는 0길이 되감기가
 * 되어 "하루 종일 그 지점"이 된다.
 *
 * **시간 축은 실측 ms 다.** `minuteOfDay`(해상도 2.5초 = 여섯 칸)로 재면 NPC
 * 가 껑충껑충 뛴다. `nowMs` 는 서버가 주는 세계 시각이고, 클라이언트는
 * 단조화된 `worldNow()` 를 넣는다.
 *
 * 계산의 뼈대는 세 줄이다:
 * 1. 마지막으로 도착한 줄을 (날, 줄 번호)로 찾는다 — 자정을 넘겼으면 어제의 줄.
 * 2. 다음 줄의 출발 시각을 역산한다 (도착 − 구운 걸음 수 × NPC_STEP_MS).
 * 3. 그 전이면 서 있고(실내 지점이면 indoor), 그 뒤면 구운 경로 위를 걷는다.
 *
 * 다음 줄의 도착 시각은 언제나 `nowMs` 보다 뒤다(1 이 "마지막"을 고르므로).
 * 그래서 걷는 구간의 진행도는 항상 경로 안에 떨어지고, 0길이 걸음이면 출발
 * 시각이 곧 도착 시각이라 걷는 가지로 들어가지 않는다 — 0 으로 나눌 자리가 없다.
 */
export function npcStateAt(
  schedule: ScheduleDef,
  places: Record<string, PlaceDef>,
  routes: readonly BakedLeg[],
  nowMs: number,
): NpcState {
  const active = activeOccurrence(schedule, nowMs)
  const from = placeOf(schedule, places, active)

  const next = nextOccurrence(schedule, active)
  const to = placeOf(schedule, places, next)

  // 구운 적 없는 구간이면 걷지 않고 자리를 지키다가 도착 시각에 다음 자리에
  // 선다. 빌드가 일과에 필요한 구간을 전부 굽지만(bakeRoutes), 생성물이 옛
  // 것이면 여기로 온다 — 그때 벽을 뚫고 직진하는 것보다 서 있는 편이 낫다.
  const steps = legBetween(routes, from.id, to.id)?.steps ?? []
  const walkMs = Math.max(0, steps.length - 1) * NPC_STEP_MS
  const arriveAt = arrivalMs(next.dayIndex, schedule.entries[next.entryIndex]!.arriveMinute)
  const departAt = arriveAt - walkMs

  if (nowMs < departAt) return standingAt(from)

  const stepIndex = Math.min(steps.length - 1, Math.floor((nowMs - departAt) / NPC_STEP_MS))
  const current = steps[stepIndex]!
  const facing =
    directionBetween(current, steps[stepIndex + 1]) ??
    directionBetween(steps[stepIndex - 1], current) ??
    to.facing

  return { mapId: current.mapId, tile: { x: current.x, y: current.y }, facing, activity: 'walking' }
}
