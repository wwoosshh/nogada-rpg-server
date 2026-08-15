import {
  attackConnects,
  claimPlausible,
  combatIntervalMs,
  currentHp,
  monsterAlive,
  newlyAchieved,
  rollInt,
  rollMonsterDrop,
  swingDamage,
  sweepCatches,
  COMBAT_SKILL_GAIN_MAX,
  COMBAT_SKILL_GAIN_MIN,
  type GameData,
  type MilestoneDef,
  type MonsterDef,
  type MonsterDropTables,
  type MonsterPlacements,
  type PlayerLocation,
  type PlayerState,
  type TilePos,
} from '@nogada/shared'

/**
 * 몬스터 세계 — 종(패턴)·배치(자리·위상·개체값)·드랍표.
 *
 * GameData 에 없다: 드랍 확률이 곧 숨은 문턱이라 클라이언트 번들 금지(전투 §4,
 * §7-앞 9 와 같은 근거)이고, gatherService 가 GatherTables 를 인자로 받는 그
 * 모양으로 앱 조립 시점에 주입받는다. **몬스터 CSV 는 아직 없다(C6)** — 그때까지
 * app.ts 는 빈 목록을 배선하고, 이 서비스는 픽스처로 시험된다.
 */
export interface MonsterWorld {
  defs: Record<string, MonsterDef>
  placements: MonsterPlacements
  drops: MonsterDropTables
}

export interface PerformFightArgs extends MonsterWorld {
  player: PlayerState
  data: GameData
  /**
   * 죽음 귀환 자리(§6) — 시작 맵의 spawn. 서비스가 직접 startLocation 을 부르지
   * 않는 이유: 시작 맵이 무엇인가는 @nogada/data 의 결정이고(newCharacter 가
   * 마을 spawn 을 유일한 출처로 삼는 그 규범), shared 는 data 를 볼 수 없다.
   */
  spawn: PlayerLocation
  instanceId: string
  /** 주장 칸. 참을 알 수 없고(§2-3) 개연성 검사만 문다. */
  claim: TilePos
  /** 서버가 시드를 독점한다 — 숙련 증가와 드랍 굴림이 차례로 소비한다. */
  rng: () => number
  now: number
}

/**
 * 거절 코드 — **판정하지 않은 요청**만 여기로 나간다(§2-2: applyToCharacter 가
 * ok:false 를 저장하지 않으므로 거절 경로에서는 아무것도 판정하지 않는다).
 *
 * - `unknown_monster`·`wrong_map`: 위조된 요청에만 걸리는 검사(gatherService 의
 *   unknown_node·wrong_map 과 같은 자리).
 * - `too_fast`: 간격 전이다 — 채집과 **같은 필드**(nextActionAt)를 본다(§12-앞 17).
 * - `implausible_move`: 속도 개연성 위반(§2-3) — 주장 사이의 맨해튼 거리가
 *   걸을 수 있는 예산을 넘었다.
 *
 * 사거리 밖은 여기 **없다** — 그것은 거절이 아니라 헛스윙이다(§2-2 갱신본).
 */
export type FightErrorCode = 'unknown_monster' | 'wrong_map' | 'too_fast' | 'implausible_move'

export interface FightOutcome {
  /** 사거리 안에서 몬스터에 닿았는가. false = 헛스윙(간격만 소모, 몬스터 무피해). */
  hit: boolean
  /** 이 스윙 뒤 그 배치의 HP. 부재(리스폰 대기)면 null — 0(방금 처치)과 다른 말이다. */
  monsterHp: number | null
  slainNow: boolean
  /** 처치 드랍. 처치가 아니거나 굴림이 빈손이면 null. */
  gained: { itemId: string; count: 1 } | null
  /** 휩쓸기 활성 구역에 걸렸는가 — 사거리와 무관하다(§2-2: 위험은 구역이다). */
  tookHit: boolean
  /** 판정 직후의 내 HP(자연 회복 반영). 화면 HP 바가 이 값에서 시작한다. */
  playerHp: number
  died: boolean
  skillGained: number
  /** 드랍이 문턱을 넘겼을 수 있다 — 채집의 그 자리(§7-앞 7)와 같은 무조건 재판정. */
  achieved: MilestoneDef[]
  player: PlayerState
}

export type FightResult = { ok: true; outcome: FightOutcome } | { ok: false; code: FightErrorCode }

/**
 * 전투 판정(§2-2 갱신본). 순서 자체가 규범이다:
 *   ① too_fast — 채집과 같은 필드(nextActionAt)라 번갈아 연타가 배속이 안 된다.
 *   ② 속도 개연성 — 위반만 거절. 첫 주장은 공회전한다(§12-앞 7).
 *   ③ 여기서부터 ok:true — 간격 소모·숙련 증가는 스윙의 값이지 명중의 값이 아니다.
 *      사거리 안(t±ε)이면 몬스터 HP 감소·처치·드랍·slain 기록, 밖이면 **헛스윙**.
 *   ④ 피격 — 주장 칸이 휩쓸기 활성 구역 안이면(t±ε) 사거리와 무관하게 HP 감소.
 *   ⑤ 죽음 — 처치가 먼저다: 드랍과 처치 기록이 실리고 나서 귀환한다(잡고 죽은
 *      사람이 빈손이면 안 된다). 귀환은 마을 스폰, hunt 리셋, 무손실.
 */
export function performFight(args: PerformFightArgs): FightResult {
  const { data, defs, placements, drops, spawn, instanceId, claim, rng, now } = args

  // instanceId 는 클라이언트가 보낸 문자열이다 — 상속 키("constructor")가
  // 프로토타입 체인에서 값을 찾으면 안 된다(gatherService 의 placements 조회와 같다).
  const placement = Object.hasOwn(placements, instanceId) ? placements[instanceId] : undefined
  if (!placement) return { ok: false, code: 'unknown_monster' }
  const def = defs[placement.monsterId]
  // 배치가 없는 종을 가리키는 것은 데이터 검증(C6)이 막으므로 여기 오면 데이터가 깨진 것이다.
  if (!def) return { ok: false, code: 'unknown_monster' }

  // 주장 칸은 참을 알 수 없지만 **맵이 다르면 닿을 수 없다**는 서버가 확실히
  // 안다(gatherService 의 wrong_map 과 같은 자리). 간격 검사보다 앞인 이유도
  // 같다: 다른 맵이면 몇 초를 기다려도 답이 안 바뀐다.
  if (placement.mapId !== args.player.location.mapId) return { ok: false, code: 'wrong_map' }

  const player = structuredClone(args.player)
  const combat = player.combat

  // ① 간격 — 채집·제작과 같은 필드다(§12-앞 17). 이 공유가 곧 "전투와 채집을
  // 번갈아 눌러 배속하는 악용이 원리적으로 불가능하다"의 전부다.
  if (now < player.nextActionAt) return { ok: false, code: 'too_fast' }

  // ② 속도 개연성(§2-3) — 부등호는 shared 의 claimPlausible 하나다.
  if (!claimPlausible(combat.lastClaim, claim, now)) return { ok: false, code: 'implausible_move' }

  // ③ 여기서부터 ok:true. 주장을 기록하고 간격을 소모한다 — 헛스윙도 허공에
  // A 를 휘두른 대가로 간격을 낸다(§2-2 갱신본). 간격은 증가 전 숙련으로 잰다
  // (채집이 판정에 쓴 숙련으로 스탬프를 찍는 그 순서).
  combat.lastClaim = { x: claim.x, y: claim.y, atMs: now }
  player.nextActionAt = now + combatIntervalMs(combat.proficiency)

  // 숙련은 성패 무관 회당 +1~2(§5) — 실패한 손질도 숙련이라는 채집의 규범 그대로다.
  const skillGained = rollInt(rng, COMBAT_SKILL_GAIN_MIN, COMBAT_SKILL_GAIN_MAX)
  combat.proficiency += skillGained

  // 리스폰 대기 중의 배치는 부재다 — 명중도 피격도 그 몬스터에게서는 나오지 않는다.
  const alive = monsterAlive(combat.slain, instanceId, now)

  let hit = false
  let slainNow = false
  let gained: { itemId: string; count: 1 } | null = null
  let monsterHp: number | null = null

  if (alive) {
    hit = attackConnects(def, placement.phaseOffsetMs, claim, now)
    // 교전 중인 그 배치만 깎인 HP 를 기억한다 — 다른 배치는 만혈이다(§4: 한 번에
    // 하나를 상대하는 단순화. hunt 교체 시 이전 몬스터가 만혈로 돌아가는 값이다).
    const hpBefore = combat.hunt?.instanceId === instanceId ? combat.hunt.monsterHp : placement.maxHp
    if (hit) {
      const remaining = hpBefore - swingDamage(player, data.items)
      if (remaining <= 0) {
        monsterHp = 0
        slainNow = true
        // 처치 기록은 hunt 밖이다(§12-앞 11) — hunt 에 실으면 다음 교전이 기록을 지운다.
        combat.slain[instanceId] = now
        combat.hunt = null
        const dropped = rollMonsterDrop(drops[placement.monsterId], rng)
        if (dropped) {
          player.stacks[dropped] = (player.stacks[dropped] ?? 0) + 1
          gained = { itemId: dropped, count: 1 }
        }
      } else {
        monsterHp = remaining
        combat.hunt = { instanceId, monsterHp: remaining }
      }
    } else {
      monsterHp = hpBefore
    }
  }

  // ④ 피격 — 스윙 순간에 살아 있던 몬스터의 활성 구역이면 사거리와 무관하게
  // 걸린다(§2-2: 위험은 구역이다). 방금 처치한 스윙도 그 순간의 휩쓸기에는
  // 걸린다 — 처치와 죽음이 한 요청에 공존하는 길이 이것이다.
  let tookHit = false
  if (alive && sweepCatches(def, placement.phaseOffsetMs, claim, now)) {
    tookHit = true
    // 저장칸은 실측이 된 순간에만 쓴다 — 자연 회복을 여기서 실체화하고 기준점을 옮긴다.
    combat.hp = Math.max(0, currentHp(combat, now) - placement.sweepDamage)
    combat.lastHitAt = now
  }

  // ⑤ 죽음(§6) — 처치 처리가 위에서 이미 끝났다: 드랍을 쥐고 귀환한다.
  // HP 는 되돌리지 않는다 — 죽음 직후는 자연 회복(또는 여관)의 시간이다(§6 밤 동선).
  const playerHp = currentHp(combat, now)
  const died = playerHp <= 0
  if (died) {
    player.location = { ...spawn }
    combat.hunt = null
  }

  // 달성 재판정은 무조건이다 — 드랍이 문턱을 넘겨도 축하가 침묵하면 안 된다
  // (채집 §7-앞 7 의 그 자리).
  const achieved = newlyAchieved(data, player, player.celebrated)
  for (const m of achieved) player.celebrated.push(m.id)

  return {
    ok: true,
    outcome: { hit, monsterHp, slainNow, gained, tookHit, playerHp, died, skillGained, achieved, player },
  }
}
