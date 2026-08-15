import { SPEED_DECADES, proficiencyProgress } from './formulas/proficiency.js'
import type { Direction, TilePos } from './movement.js'
import type { MonsterAttackDef, MonsterDef } from './types.js'

/**
 * 몬스터 패턴의 게임 규칙이 사는 곳.
 *
 * `npcStateAt`(npcSchedule.ts)과 같은 자세다 — **시간의 순수 함수**라 저장할
 * 상태도 밀어줄 트래픽도 없고, 클라이언트는 그리려고 부르고 서버는 판정
 * 순간에 같은 함수를 불러 같은 답을 얻는다(설계 §2-1). 웹소켓 없이 몬스터가
 * 움직이는 것이 이 동일성 하나에 걸려 있다: 여기 숨은 상태가 하나라도 끼면
 * 화면의 늑대와 판정의 늑대가 다른 자리에 선다.
 */

/**
 * 지금 무엇을 하고 있는가 — 한 공격의 생애는 대기 → 예고 → 휩쓸기 → 대기다(설계 §3).
 *
 * - `telegraph`: 바닥 표시가 뜬다. **그 칸에서 공격해도 무사하다**(결정 3) —
 *   마지막까지 한 대 더 때리는 탐욕이 이 게임 전투의 긴장이다.
 * - `sweep`: 그 칸에서의 공격은 확정 피격이다.
 */
export type MonsterPhase = 'idle' | 'telegraph' | 'sweep'

export interface MonsterState {
  /** 지금 서 있는(또는 막 떠나는) 순찰 칸. 서버의 사거리 판정(C4)이 읽는 칸이다. */
  tile: TilePos
  /** 다음 슬롯의 칸. 주기의 마지막 슬롯에서는 첫 칸으로 감긴다 — 경계가 이어진다. */
  nextTile: TilePos
  /**
   * 이 슬롯 안에서 지나간 비율(0 ≤ p < 1). **클라 렌더가 tile→nextTile 을 이
   * 값으로 직접 보간한다**(설계 §12-앞 16) — NpcSprite 의 추격 보간은 정상
   * 상태에서 수학 위치보다 0~1칸 뒤지므로(추격 속도 = 목표 속도, 실측) 몬스터
   * 스프라이트에 쓰면 장판과 몸이 어긋난다. 정수 ms 끼리의 나눗셈이라 같은
   * t 는 언제나 같은 값이다.
   */
  progress: number
  /**
   * 예고·휩쓸기 중에는 공격의 방향이다. 걷는 중에는 걸어가는 방향, 공격 없이
   * 서 있는 동안은 null — 같은 칸 사이의 좌표차에서 방향을 억지로 뽑으면
   * 엉뚱한 값이 나온다(npcSchedule 의 directionBetween 이 null 을 두는 자리).
   */
  facing: Direction | null
  phase: MonsterPhase
  /**
   * 피격 구역 — **sweep 국면에만 비지 않는다.** 서버(C4)는 주장 칸이 이 안이면
   * HP 를 깎는다. 예고 구역을 여기 실으면 "예고 중 공격은 자유"(결정 3)가
   * 판정에서 깨지므로 경고는 아래 별도 필드로만 나간다.
   */
  dangerTiles: TilePos[]
  /**
   * 경고 표시 구역 — telegraph 국면에만 비지 않는다. 화면 전용이고 판정은
   * 읽지 않는다. 같은 공격의 dangerTiles 와 같은 칸 집합이다 — 경고가
   * 거짓말하면 "본 대로 피했는데 맞았다"가 된다.
   */
  warningTiles: TilePos[]
}

/** 숙련 0 의 공격 간격 — 채집 상한(500)보다 무겁다. 스윙은 채집 클릭보다 큰 동작이다. */
export const COMBAT_INTERVAL_MAX_MS = 800

/**
 * 최고속 공격 간격 — 채집의 50ms 를 들지 않는다. 이유 둘:
 *
 * 1. **아크 B 의 50ms 교훈.** 낮은 하한은 그 위에 곱해 오는 축을 종반에 전부
 *    삼킨다 — 채집에서 도구·강화 배수가 하한에 눌려 죽는 것을 실측으로 세 번
 *    잡았다(toolProfile 의 "배수를 전부 곱한 뒤에 클램프" 논의가 그 흔적이다).
 *    전투의 새 축은 속도가 아니라 회피다: 간격이 걸음(STEP_MS=200)보다 싸지면
 *    위험 창 안에서도 때리고 빠지는 쪽이 항상 이득이라 "한 대 더 때릴까"의
 *    저울(결정 3) 자체가 사라진다.
 * 2. **§3 의 활성 창 하한(≥400ms)과 같은 숫자인 것은 우연이 아니다** — 활성
 *    창 ≥ 공격 간격 하한이어야 A 홀드 방치자가 휩쓸기를 스윙 없이 지나가지
 *    못하고, 그래야 "회피 안 하면 맞는다"(방치자 기대 피격 ≥1, C2 검사)가 선다.
 */
export const COMBAT_INTERVAL_MIN_MS = 400

/**
 * 다음 스윙까지 기다리는 시간 — 채집의 `actionIntervalMs` 와 같은 로그 곡선
 * (SPEED_DECADES=6, 숙련 100만에서 하한)을 타되 상수만 전투의 것이다(설계 §5).
 * 곡선을 재사용하는 이유는 "오래 할수록 빨라진다"의 체감 기울기가 동사마다
 * 다르면 안 되기 때문이고, 상수를 나누는 이유는 위 하한 주석이 말한다.
 */
export function combatIntervalMs(proficiency: number): number {
  const t = proficiencyProgress(proficiency, SPEED_DECADES)
  return Math.round(COMBAT_INTERVAL_MAX_MS - (COMBAT_INTERVAL_MAX_MS - COMBAT_INTERVAL_MIN_MS) * t)
}

/** JS 의 % 는 음수를 음수로 돌려준다 — 주기 위상은 언제나 [0, P) 여야 한다. */
function positiveMod(value: number, period: number): number {
  return ((value % period) + period) % period
}

const DELTAS: Record<Direction, TilePos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/**
 * 앵커 앞으로 벌어지는 부채꼴 — 깊이 f(1..reach)에서 좌우로 f−1 칸.
 * 깊이 1 은 앞칸 하나라, 예고를 본 사람은 측면 한 걸음(STEP_MS=200)으로
 * 빠져나간다 — 예고 하한 700ms 가 회피 예산으로 충분한 것은 이 기하 덕이다.
 *
 * 벽·맵 밖 칸도 거르지 않고 담는다 — 지형은 shared 로 넘어오지 않고
 * (MapDef 주석), C2 검사 2 의 정의역이 일부러 전체 칸이다(벽 치터를 문다).
 */
function fanTiles(anchor: TilePos, direction: Direction, reach: number): TilePos[] {
  const forward = DELTAS[direction]
  // 좌우로 벌어지는 축은 전진 축에 수직이다 — 전진이 x 면 y 로, y 면 x 로 벌어진다.
  const side: TilePos = { x: forward.y === 0 ? 0 : 1, y: forward.x === 0 ? 0 : 1 }
  const tiles: TilePos[] = []
  for (let f = 1; f <= reach; f++) {
    for (let l = -(f - 1); l <= f - 1; l++) {
      tiles.push({ x: anchor.x + forward.x * f + side.x * l, y: anchor.y + forward.y * f + side.y * l })
    }
  }
  return tiles
}

/** 두 칸 사이의 방향. 같은 칸이면 null — 서 있는 슬롯에서 방향을 지어내지 않는다. */
function directionBetween(from: TilePos, to: TilePos): Direction | null {
  if (to.y < from.y) return 'up'
  if (to.y > from.y) return 'down'
  if (to.x < from.x) return 'left'
  if (to.x > from.x) return 'right'
  return null
}

/** 그 위상에 걸린 공격과 국면. 파서가 창 겹침을 막으므로 첫 일치가 유일한 일치다. */
function attackPhaseAt(
  attacks: readonly MonsterAttackDef[],
  phaseMs: number,
): { attack: MonsterAttackDef; phase: 'telegraph' | 'sweep' } | null {
  for (const attack of attacks) {
    const sweepStart = attack.telegraphStartMs + attack.telegraphMs
    if (phaseMs >= attack.telegraphStartMs && phaseMs < sweepStart) return { attack, phase: 'telegraph' }
    if (phaseMs >= sweepStart && phaseMs < sweepStart + attack.activeMs) return { attack, phase: 'sweep' }
  }
  return null
}

/**
 * 그 시각에 그 몬스터는 어디서 무엇을 하고 있는가 — `t mod P` 하나로 전부.
 *
 * **전제(파서·C2 가 막고, 여기서 다시 검사하지 않는다 — npcStateAt 규약):**
 * `patrol` 은 최소 한 칸, `periodMs` 는 `patrol.length` 로 나눠떨어지고,
 * 각 공격의 예고+활성 창은 [0, P) 안에서 겹치지 않고 감아 넘지 않는다.
 *
 * 계산의 뼈대는 두 줄이다:
 * 1. 위상 = t mod P 를 슬롯(주기/칸 수)으로 나눠 순찰 칸과 진행도를 얻는다.
 * 2. 위상이 어느 공격의 창에 걸렸는지 보고 국면과 구역을 얻는다 — 부채꼴의
 *    앵커는 **예고 시작 시점의 순찰 칸**이다. 지금 칸으로 하면 예고가 뜬 뒤에
 *    구역이 따라 움직여 700ms 를 준 뜻이 없어진다.
 *
 * 정수 ms 산술만 쓴다: 위상·슬롯 경계는 전부 정수이고, 진행도 하나만 정수끼리의
 * 나눗셈이라 부동소수점 누적 오차가 낄 자리가 없다 — 같은 t 는 같은 상태다.
 */
export function monsterStateAt(def: MonsterDef, tMs: number): MonsterState {
  const phaseMs = positiveMod(tMs, def.periodMs)
  const slotMs = def.periodMs / def.patrol.length
  const slot = Math.floor(phaseMs / slotMs)
  const here = def.patrol[slot]!
  const next = def.patrol[(slot + 1) % def.patrol.length]!

  const hit = attackPhaseAt(def.attacks, phaseMs)
  const zone = hit
    ? fanTiles(def.patrol[Math.floor(hit.attack.telegraphStartMs / slotMs)]!, hit.attack.direction, hit.attack.reach)
    : []

  return {
    // 매번 새 객체다 — 부르는 쪽이 고쳐도 순찰 경로가 움직이면 안 된다(standingAt 규약).
    tile: { x: here.x, y: here.y },
    nextTile: { x: next.x, y: next.y },
    progress: (phaseMs - slot * slotMs) / slotMs,
    facing: hit ? hit.attack.direction : directionBetween(here, next),
    phase: hit ? hit.phase : 'idle',
    dangerTiles: hit?.phase === 'sweep' ? zone : [],
    warningTiles: hit?.phase === 'telegraph' ? zone : [],
  }
}
