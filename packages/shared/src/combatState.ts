import { equippedToolInfo } from './equipment.js'
import { monsterStateAt, withinAttackRange } from './monster.js'
import { manhattanDistance, STEP_MS, type TilePos } from './movement.js'
import type {
  CombatClaim,
  CombatState,
  ItemDef,
  MonsterDef,
  MonsterDropTableDef,
  PlayerState,
} from './types.js'

/**
 * 전투 상태의 게임 규칙이 사는 곳(설계 §6). 서버 판정(fightService)과 화면
 * (TopBar·HP 바)이 같은 함수를 부른다 — transitionGate·nodeAvailable 규범이고,
 * 부등호가 두 벌이 되는 순간 화면이 만혈로 그려 놓고 서버만 죽는 날이 온다.
 */

/** 최대 HP — §6 이 "상수 100 으로 시작"으로 못박은 값. 장비·숙련이 사지 않는다. */
export const COMBAT_MAX_HP = 100

/**
 * 자연 회복 1 HP 가 걸리는 시간(ms). **목표값이다 — C6·C7 브라우저에서 재고
 * 확정한다**(설계 §6: 여관비 ≤ 자연 회복 대기 시간의 벌이, 그 부등식의 한 변이
 * 이 상수다). 3,000ms = 만혈까지 5분: "죽으면 잠깐 쉬거나 여관"의 저울이 서는
 * 자리로 골랐다.
 */
export const HP_REGEN_MS_PER_HP = 3_000

/**
 * 판정 시간 허용폭 ε (설계 §2-5, §12-앞 3). 사거리·피격을 t 한 점이 아니라
 * t−ε·t·t+ε 셋 중 하나라도 성립하면 인정한다.
 *
 * 1,000ms 인 이유(전부 실측): 시계 동기화는 어긋남 2,000ms 초과에만 재동기하므로
 * (`RESYNC_THRESHOLD_MS`) ±2초가 상시 용인되고, RTT 스파이크 중 잡힌 나쁜 앵커는
 * ~1초 오차를 만들어 백스톱에 안 걸린 채 다음 주기 동기(5분)까지 지속된다.
 * 1초 > 예고 하한 700ms 라 ε 없이는 그 5분 동안 정직한 스윙이 계속 빗나간다.
 */
export const JUDGE_EPSILON_MS = 1_000

/** ε 완화가 실제로 보는 세 시각. 연속 구간이 아니라 세 점인 것은 §2-5 의 문면 그대로다. */
const EPSILON_OFFSETS = [-JUDGE_EPSILON_MS, 0, JUDGE_EPSILON_MS] as const

/**
 * 속도 개연성의 여유(칸) — 예산 = 경과시간/STEP_MS + 이 값(§2-3).
 *
 * **목표값이다 — C7 브라우저에서 지터를 재고 확정한다**(§12-앞 18). 하한의 근거:
 * 최대속도 이동 중 최소간격 공격은 요청 간 지터 압축 200ms(= 한 걸음)부터 정당한
 * 요청이 거절되므로 여유가 1칸을 넘어야 하고, 2칸은 압축 400ms 까지 삼킨다.
 * 치터의 이득은 이 상수만큼의 "상수 여유"에 그친다(§2-3 보안 문장).
 */
export const CLAIM_SLACK_TILES = 2

/**
 * 처치 후 그 배치가 부재하는 시간(ms). **목표값이다 — C6 이 분-자(첫 검 3~8분)를
 * 역산할 때 드랍률과 함께 확정한다.** 0 이면 한 자리를 연타해 같은 늑대를 간격마다
 * 잡는 자판기가 되고, 이 대기가 배치 셋 사이를 옮겨 다니는 동선을 만든다.
 */
export const MONSTER_RESPAWN_MS = 10_000

/**
 * 맨손 회당 피해(§12-앞 9) — 첫 늑대는 구조적으로 맨손이다(송곳니가 검의 재료라).
 * **목표값이다 — C6 의 분-자(첫 검까지 전투 활동 3~8분)가 드랍률·송곳니 N 과 함께
 * 역산해 확정한다.** 채집의 BARE_HAND 프로필과 같은 자리: 게이트가 아니라 페널티다.
 */
export const UNARMED_COMBAT_DAMAGE = 1

/**
 * 스윙당 숙련 증가 범위 — 성패 무관 회당 +1~2(설계 §5). 헛스윙도 한 번의
 * 스윙이다: 채집이 실패한 손질에도 숙련을 주는 그 규범이다(§7-앞 7).
 */
export const COMBAT_SKILL_GAIN_MIN = 1
export const COMBAT_SKILL_GAIN_MAX = 2

/**
 * 구세이브가 물려받는 전투 상태(§6 — 마이그레이션 0). 리터럴이 아니라 함수인
 * 이유는 protocol.ts 의 donated·dialogueHistory 와 같다: zod 에 리터럴을 주면
 * 세이브 여럿이 같은 slain 객체를 공유해 한 사람의 처치가 남의 기록이 된다.
 */
export function defaultCombatState(): CombatState {
  return { proficiency: 0, hp: COMBAT_MAX_HP, lastHitAt: 0, lastClaim: null, hunt: null, slain: {} }
}

/**
 * 지금 이 사람의 HP — 저장칸(hp)은 lastHitAt 시점의 실측이고, 그 뒤의 자연
 * 회복은 여기서 게으르게 계산한다(§6). 회복을 지으러 오는 작업이 없는 것이
 * 요점이다(activeWeather 가 만료를 시각 비교로 푸는 그 자세).
 *
 * `Math.max(0, …)` 는 시계가 뒤로 간 경우다 — 재동기로 now 가 lastHitAt 보다
 * 과거가 되어도 회복이 음수(= 저절로 깎임)가 되면 안 된다.
 */
export function currentHp(combat: Pick<CombatState, 'hp' | 'lastHitAt'>, now: number): number {
  const healed = Math.floor(Math.max(0, now - combat.lastHitAt) / HP_REGEN_MS_PER_HP)
  return Math.min(COMBAT_MAX_HP, combat.hp + healed)
}

/**
 * 위치 주장이 속도로 개연적인가(§2-3) — 맨해튼 거리 ≤ 경과시간/STEP_MS + 여유.
 *
 * 맨해튼인 이유: 이동이 4방향이라 체비쇼프로 재면 대각 주장이 정직한 걸음의
 * 2배속으로 통과한다(§12-앞 6, 실측). 직전 주장이 없으면 공회전한다 — 첫 주장·
 * 전환 직후는 "그동안 걸어간 것과 등가"라 위협 모델 안에서 무해하고, 이동·채집이
 * 이미 명문으로 수용한 노출 클래스다(moveService.ts:44-47, §12-앞 7).
 */
export function claimPlausible(lastClaim: CombatClaim | null, claim: TilePos, now: number): boolean {
  if (!lastClaim) return true
  const budget = Math.max(0, now - lastClaim.atMs) / STEP_MS + CLAIM_SLACK_TILES
  return manhattanDistance(lastClaim, claim) <= budget
}

/**
 * 그 배치가 지금 살아 있는가 — 처치 기록(slain)에서 리스폰 대기를 계산한다.
 * `Object.hasOwn` 인 이유: instanceId 는 클라이언트가 보낸 문자열이라 상속 키
 * ("constructor")가 프로토타입에서 값을 찾으면 그 몬스터가 영원히 부재가 된다
 * (gatherService 의 placements 조회와 같은 방어).
 */
export function monsterAlive(slain: Record<string, number>, instanceId: string, now: number): boolean {
  const slainAt = Object.hasOwn(slain, instanceId) ? slain[instanceId]! : undefined
  return slainAt === undefined || now - slainAt >= MONSTER_RESPAWN_MS
}

/**
 * 이 스윙이 몬스터에 닿는가 — withinAttackRange 를 t±ε 세 시각에 묻는다(§2-5).
 * 한 점 판정으로 되돌리면 나쁜 앵커의 1초 오차가 지속되는 5분 동안 화면에 붙어
 * 있는 늑대가 서버에서는 이미 떠난 자리다(오차 주입 테스트가 이 완화를 문다).
 */
export function attackConnects(def: MonsterDef, phaseOffsetMs: number, claim: TilePos, tMs: number): boolean {
  return EPSILON_OFFSETS.some((offset) =>
    withinAttackRange(claim, monsterStateAt(def, tMs + phaseOffsetMs + offset).tile),
  )
}

/**
 * 이 주장 칸이 휩쓸기에 걸리는가 — dangerTiles(sweep 국면에만 비지 않는다)를
 * t±ε 세 시각에 묻는다(§2-5). 사거리와 무관한 것이 요점이다(§2-2 갱신본):
 * 위험은 구역이고, 사거리는 명중에만 관여한다.
 *
 * ε 의 대가: "예고 중 무사"(결정 3)는 휩쓸기 경계에서 ε 바깥의 예고 순간에만
 * 온전하다 — 오차를 양쪽으로 삼키는 값이다.
 */
export function sweepCatches(def: MonsterDef, phaseOffsetMs: number, claim: TilePos, tMs: number): boolean {
  return EPSILON_OFFSETS.some((offset) =>
    monsterStateAt(def, tMs + phaseOffsetMs + offset).dangerTiles.some(
      (tile) => tile.x === claim.x && tile.y === claim.y,
    ),
  )
}

/**
 * 회당 피해 — 무기가 진다(§2-2: 간격은 숙련이, 피해는 무기가. 한 칸이 두 축을
 * 사면 안 된다). 조회는 equippedToolInfo 하나다: 없거나 엉뚱한 슬롯의 도구면
 * null = 맨손(§6-앞 9)이고, combat 도구의 damage 짝은 파서가 강제하지만 혹시
 * 비어 있어도 맨손으로 떨어진다.
 */
export function swingDamage(player: PlayerState, items: Record<string, ItemDef>): number {
  return equippedToolInfo(player, 'combat', items)?.def.damage ?? UNARMED_COMBAT_DAMAGE
}

/**
 * 처치 한 번의 드랍 굴림 — 채집표와 같은 누적 확률 모형이다(설계 §4): roll 하나를
 * 줄들의 누적 합에 대고, 어느 줄에도 안 걸리면 빈손이다. rng 는 서버가 주입한다.
 *
 * 표가 없으면(undefined) 빈손 — C6 이 드랍 CSV 를 세우기 전의 빈 배선이 죽지
 * 않아야 한다(app.ts 의 빈 목록 배선).
 */
export function rollMonsterDrop(table: MonsterDropTableDef | undefined, rng: () => number): string | null {
  if (!table) return null
  const roll = rng()
  let cumulative = 0
  for (const drop of table.drops) {
    cumulative += drop.chance
    if (roll < cumulative) return drop.itemId
  }
  return null
}
