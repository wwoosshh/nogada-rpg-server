import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ACTION_INTERVAL_MAX_MS,
  defaultCombatState,
  emptyDialogueHistory,
  ENHANCE_CAP,
  ENHANCE_INTERVAL_FACTOR,
  GAME_EPOCH_MS,
  gameTimeAt,
  isLowTide,
  REAL_MS_PER_GAME_MINUTE,
  type BarrierRegions,
  type GameData,
  type GatherTables,
  type MilestoneDef,
  type NodeDef,
  type PlayerState,
} from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { applyToCharacter } from '../state/applyToCharacter.js'
import { JsonPersistence } from '../state/jsonPersistence.js'
import { performGather } from './gatherService.js'

const data: GameData = {
  items: {
    copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
    mithril_ore: testItem('mithril_ore', { name: '미스릴 원석', icon: 'ore_mithril', price: 22000, skill: 'mineral' }),
    copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' }),
    copper_sickle: testTool('copper_sickle', 'herb', 1, { name: '구리 낫', icon: 'sickle_copper' }),
  },
  nodes: {
    copper_vein: {
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal', sprite: 'copper_vein',
    },
    // 심층 외형. **출하 데이터에서는 deep 이 자기 표(*_deep)를 가리키지만**
    // (결계 계획 B2 — `variant='deep' ⟺ tableId 가 *_deep`, 빌드가 그 짝을
    // 강제한다. 오래 "§9-앞 5" 로 적혀 있었는데 그 번호는 전수 시뮬의 표 목록
    // 하드코딩을 푸는 얘기다) 여기서는 일부러 바깥과 같은 표를 물린다 — 이 스위트가
    // 재는 것은 "굴리는 것은 variant 가 아니라 tableId 다" 이고, 표까지 갈라
    // 두면 아래 두 단정이 무엇 때문에 갈렸는지 구별되지 않는다.
    //
    // 심층으로 들어가는 것을 막는 것은 이 서비스가 아니다 — 그 앞의 결계
    // 전환(moveService)이다. 채집 판정에는 지금도 접근 게이트가 없다.
    iron_vein: {
      id: 'iron_vein', name: '철 광맥', skill: 'mineral', tableId: 'mineral', variant: 'deep', sprite: 'iron_vein',
    },
    // 플레이어의 기본 도구(광물)와 기술이 다른 노드 — "엉뚱한 기술의 도구 =
    // 맨손"(§6-앞 9)이 서비스 경로에서 지켜지는지 확인하는 무대다.
    herb_patch: {
      id: 'herb_patch', name: '약초 군락', skill: 'herb', tableId: 'herb', variant: 'normal', sprite: 'herb_patch',
    },
  },
  recipes: {},
  // 채집 판정은 맵을 보지 않지만 배치가 자기 맵을 가리키므로, 등록부에 그 맵이 있어야 앞뒤가 맞는다.
  maps: { 얼음채집장: { id: '얼음채집장', name: '얼음 채집장', file: 'world.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } } },
  transitions: [],
  placements: {
    'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', mapId: '얼음채집장', x: 3, y: 3 },
    'iron_vein-1': { instanceId: 'iron_vein-1', nodeId: 'iron_vein', mapId: '얼음채집장', x: 5, y: 3 },
    'herb_patch-1': { instanceId: 'herb_patch-1', nodeId: 'herb_patch', mapId: '얼음채집장', x: 7, y: 3 },
  },
  milestones: [],
  speakers: {},
  shops: {}, masters: [], enhanceCosts: [], collection: {},
  places: {}, schedules: {}, routes: [],
  dialogue: [],
  monsters: {}, monsterPlacements: {},
}

/**
 * 표는 GameData 에 없다(설계 §7-앞 9) — 서비스가 별도로 주입받는다. 실제 CSV 값이
 * 아니라 이 스위트 전용 단순화한 표를 쓴다: 최상 티어(mithril_ore, 누적 10)와
 * 바닥 티어(copper_ore, 누적 20000)만 있는 무한 브라켓 하나. 20000 을 넘는 roll
 * (전체의 약 80%)은 실패다 — 그래서 실패 시나리오를 굴리기 쉽다.
 */
const tables: GatherTables = {
  mineral: {
    id: 'mineral', skill: 'mineral', skillGainMin: 1, skillGainMax: 2, equity: true,
    tiers: [{ itemId: 'mithril_ore' }, { itemId: 'copper_ore' }],
    brackets: [{ bracketMax: null, cumulative: [10, 20000] }],
  },
  herb: {
    id: 'herb', skill: 'herb', skillGainMin: 1, skillGainMax: 2, equity: true,
    tiers: [{ itemId: 'rare_herb' }],
    brackets: [{ bracketMax: null, cumulative: [50000] }],
  },
}

/**
 * 결계가 하나도 없는 세계 — 이 스위트의 기존 단정 전부가 서는 무대다.
 *
 * 결계 뒤가 아닌 노드에게 이 검사는 아무것도 묻지 않으므로, 빈 목록은 "아크
 * 이전의 세계" 와 정확히 같다. 아래 결계 describe 만 자기 목록을 따로 준다.
 */
const noBarriers: BarrierRegions = []

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    donated: {},
    // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
    instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'i1' },
    nextActionAt: 0,
    celebrated: [],
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    // 배치가 전부 world 에 있으므로 기본 플레이어도 world 에 세운다 — 그래야
    // 기존 테스트들이 "맵이 같다"를 따로 말하지 않아도 앞뒤가 맞는다.
    location: { mapId: '얼음채집장', x: 0, y: 0 },
    ...overrides,
  }
}

/**
 * roll = floor(rng()×100001×factor). 구리 곡괭이(1등급)는 factor ×1.0 이므로
 * roll ≈ rng()×100001.
 *
 * roll=0 은 잭팟 밴드(roll≤10) 안이라 mineral 표의 cum1=10 에 걸려 **최상 티어**
 * (mithril_ore)가 나온다 — 예전 이름 alwaysSucceed 는 "성공률 0.5 를 항상
 * 이긴다"는 뜻이었지만, 표 모델에는 성공률이 없다. 지금 이 값이 뜻하는 것은
 * "롤이 최솟값이라 최상 티어가 뽑힌다"이므로 이름도 그렇게 바꾼다.
 */
const jackpotRoll = () => 0
/** roll ≈ 99,900 — mineral 표의 마지막 누적(20000)보다 커서 항상 실패한다. */
const failRoll = () => 0.999
/**
 * rawRoll = 40000. herb 표(누적 50000)에서 도구만이 성패를 가르는 주사위다:
 * 1티어 도구 ×1.0 → 40000 ≤ 50000 성공, 맨손 ×1.45 → 58000 > 50000 실패.
 */
const herbEdgeRoll = () => 0.4

describe('performGather', () => {
  it('없는 노드는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'ghost-1', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })

  it('같은 종류의 다른 인스턴스를 각각 지목할 수 있다', () => {
    // 종류 id 만 보내던 때에는 불가능했던 일이다. 이 테스트가 인스턴스 해석이
    // 실제로 일어나는지 지킨다 — 종류로 되돌리면 두 인스턴스가 구분되지 않는다.
    const d: GameData = {
      ...data,
      placements: {
        ...data.placements,
        'copper_vein-2': { instanceId: 'copper_vein-2', nodeId: 'copper_vein', mapId: '얼음채집장', x: 9, y: 3 },
      },
    }
    const a = performGather({ player: player(), data: d, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    const b = performGather({ player: player(), data: d, tables, barriers: noBarriers, instanceId: 'copper_vein-2', rng: jackpotRoll, now: 0 })
    if (!a.ok || !b.ok) throw new Error('둘 다 성공해야 한다')
    expect(a.outcome.gained).toEqual(b.outcome.gained)
  })

  // 왜: 앞칸 판정은 클라이언트에만 있다. 서버가 어느 맵인지 모르면 다른 맵의
  //     인스턴스 id 하나로 맵 너머의 노드를 캘 수 있다 — 맵이 하나뿐일 때는
  //     존재하지 않던 구멍이라 기존 검사 어느 것도 이걸 막지 않는다.
  it('다른 맵의 노드는 캘 수 없다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('없는 인스턴스는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'nope-9', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })

  it('엉뚱한 기술의 도구는 맨손으로 친다 — roll ×1.45 가 같은 주사위를 실패로 만든다(§6-앞 9)', () => {
    // 허브 슬롯에 곡괭이(광물 도구)가 꽂힌 극단 상태다. equippedToolInfo 가 이
    // 불일치를 null(맨손)로 만들어 판정에 넘기는지를 서비스 경로에서 본다 —
    // 게이트로 거부하던 옛 cannot_gather 는 은퇴했다(§2).
    const p = player({ equipped: { herb: 'i1' } })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'herb_patch-1', rng: herbEdgeRoll, now: 0 })
    if (!r.ok) throw new Error('맨손 채집은 거부가 아니다')
    expect(r.outcome.success).toBe(false)
    // 간격도 맨손 배수다 — 엉뚱한 도구가 페널티만 피해 가면 규범이 반쪽이 된다.
    expect(r.outcome.player.nextActionAt).toBe(750)
  })

  it('같은 주사위라도 그 기술의 도구가 있으면 성공한다 — 착용 도구가 판정(gatherOutcome)까지 실제로 닿는다', () => {
    const p = player({
      instances: [{ instanceId: 's1', itemId: 'copper_sickle', enhanceLevel: 0 }],
      equipped: { herb: 's1' },
    })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'herb_patch-1', rng: herbEdgeRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.success).toBe(true)
    expect(r.outcome.gained).toEqual({ itemId: 'rare_herb', count: 1 })
  })

  it('심층 외형(deep) 노드도 같은 기술의 1등급 도구로 캘 수 있다 — 등급 게이트는 폐지됐다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    expect(r.ok).toBe(true)
  })

  it('굴리는 것은 variant 가 아니라 tableId 다 — 표가 같으면 외형이 달라도 같은 roll 에 같은 티어가 나온다', () => {
    const normal = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    const deep = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    if (!normal.ok || !deep.ok) throw new Error('둘 다 성공해야 한다')
    // 이 스위트의 두 노드는 variant 만 다르고 표는 'mineral' 로 같다. 그래서
    // 같은 roll(0)이면 같은 최상 티어(mithril_ore)가 나온다 — 판정이 노드의
    // 외형을 보지 않는다는 뜻이다. **출하 데이터에서 심층이 다른 것을 내는
    // 이유는 그 표가 다르기 때문이지 이 외형 때문이 아니다.**
    expect(deep.outcome.gained).toEqual(normal.outcome.gained)
  })

  it('맨손이어도 캘 수 있다 — 게이트가 아니라 페널티다(§2): 간격 ×1.5, 잭팟은 원확률', () => {
    const p = player({ instances: [], equipped: {} })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('맨손 채집은 거부가 아니다')
    // 잭팟 밴드는 평감산만 적용되고 맨손의 평감산은 0 이다(§3) — roll 0 그대로
    // 최상 티어가 나온다. 맨손 잭팟이 원확률로 열려 있다는 원작 정신의 증거다.
    expect(r.outcome.gained).toEqual({ itemId: 'mithril_ore', count: 1 })
    // 간격 스탬프는 gatherIntervalMs 의 몫이다(§6-앞 10) — 숙련 0 의 500ms 에 ×1.5.
    expect(r.outcome.player.nextActionAt).toBe(1000 + 750)
  })

  it('강화된 도구는 간격 스탬프가 짧아진다 — 스탬프가 ×0.97^강화 를 실제로 읽는다(§6-앞 10)', () => {
    const p = player({ instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: ENHANCE_CAP }] })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    // 구리(×1.0) +5 → 500 × 0.97^5 = 429ms(반올림). actionIntervalMs(0)=500 그대로라면
    // (스탬프가 강화를 안 읽는다면) 1500 이 나와 이 테스트가 깨진다. 스탬프는
    // gatherIntervalMs 의 정수 계약을 그대로 물려받는다 — 소수점 시각은 없다.
    expect(r.outcome.player.nextActionAt).toBe(
      1000 + Math.round(ACTION_INTERVAL_MAX_MS * ENHANCE_INTERVAL_FACTOR ** ENHANCE_CAP),
    )
  })

  it('간격이 지나지 않았으면 too_fast 로 거부한다', () => {
    const p = player({ nextActionAt: 8000 })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  it('간격이 지났으면 채집할 수 있다', () => {
    const p = player({ nextActionAt: 5000 })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r.ok).toBe(true)
  })

  it('숙련도 0 이면 다음 행동까지 500ms 를 기다린다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('숙련도가 높으면 간격이 짧아진다', () => {
    const p = player({ skills: { ice: 0, wood: 0, mineral: 999_999, herb: 0, crafting: 0 } })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 50)
  })

  it('실패해도 간격은 걸린다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: failRoll, now: 1000 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  // 검사 순서 자체를 못 박는다: 간격도 안 지나고 맵도 다른 상황에서 wrong_map
  // 이 나와야 맵 검사가 간격보다 먼저라는 것이 증명된다. too_fast 로 답하면
  // "조금 있다 다시 두드리면 된다"는 거짓 안내가 된다 — 어느 때 두드려도 닿지
  // 않는 노드다. (도구 자격 검사는 은퇴했다 — 맨손 허용, §2.)
  it('간격도 남아 있고 맵도 다르면 wrong_map 을 우선한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 }, nextActionAt: 8000 })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('성공하면 뽑힌 아이템 1개가 스택에 쌓이고 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.success).toBe(true)
    // roll=0 은 잭팟 밴드 안이고 mineral 표의 cum1=10 에 걸려 최상 티어가 나온다.
    expect(r.outcome.gained).toEqual({ itemId: 'mithril_ore', count: 1 })
    expect(r.outcome.player.stacks.mithril_ore).toBe(1)
    expect(r.outcome.skillGained).toBeGreaterThan(0)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
  })

  // 예전에는 "실패하면 산출물이 없고 숙련도도 오르지 않는다"였다. 판정 순서가
  // 바뀌었다(설계 §7-앞 7) — 숙련 증가는 성패 무관 무조건이다. 이 테스트가
  // 그 반전을 못 박는다.
  it('실패하면 산출물은 없지만 숙련도는 그대로 오른다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: failRoll, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.gained).toBeNull()
    expect(r.outcome.skillGained).toBeGreaterThan(0)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
    expect(r.outcome.player.stacks).toEqual({})
  })

  it('표 메타(skillGainMin~Max)가 정한 범위(1~2)에서 성패와 무관하게 숙련이 오른다', () => {
    const success = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    const failure = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: failRoll, now: 0 })
    if (!success.ok || !failure.ok) throw new Error('둘 다 요청 자체는 성공해야 한다')

    for (const r of [success, failure]) {
      expect(r.outcome.skillGained).toBeGreaterThanOrEqual(1)
      expect(r.outcome.skillGained).toBeLessThanOrEqual(2)
      expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
    }
  })

  it('이미 가진 재료에 누적한다', () => {
    const p = player({ stacks: { mithril_ore: 5 } })
    const r = performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.mithril_ore).toBe(6)
  })

  it('다른 생활기술의 숙련도는 건드리지 않는다', () => {
    const r = performGather({ player: player(), data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.skills.ice).toBe(0)
    expect(r.outcome.player.skills.wood).toBe(0)
    expect(r.outcome.player.skills.herb).toBe(0)
    expect(r.outcome.player.skills.crafting).toBe(0)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    performGather({ player: p, data, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    expect(p.stacks).toEqual({})
    expect(p.nextActionAt).toBe(0)
  })
})

describe('performGather — 이정표 달성', () => {
  const mineralMilestone: MilestoneDef = {
    id: 'mineral-5',
    metric: { kind: 'skill', skill: 'mineral' },
    threshold: 5,
    name: '광물에 익숙해지다',
    announce: '광물을 다루는 손이 익숙해졌다',
    effect: { kind: 'title' },
  }
  const dataWithMilestone: GameData = { ...data, milestones: [mineralMilestone] }

  /** jackpotRoll(rng()=0)일 때 copper_vein 의 skillGained 은 항상 최솟값 1 이다. */
  function playerBelowThreshold(overrides: Partial<PlayerState> = {}): PlayerState {
    return player({ skills: { ice: 0, wood: 0, mineral: 4, herb: 0, crafting: 0 }, ...overrides })
  }

  it('성공한 채집이 문턱을 넘기면 outcome.achieved 에 그 이정표가 담긴다', () => {
    const r = performGather({
      player: playerBelowThreshold(), data: dataWithMilestone, tables, barriers: noBarriers,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.skills.mineral).toBe(5) // 문턱에 정확히 닿았는지 전제부터 확인한다
    expect(r.outcome.achieved.map((m) => m.id)).toEqual(['mineral-5'])
  })

  it('그 이정표 id 가 outcome.player.celebrated 에 들어간다', () => {
    const r = performGather({
      player: playerBelowThreshold(), data: dataWithMilestone, tables, barriers: noBarriers,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.celebrated).toEqual(['mineral-5'])
  })

  it('다음 채집에서는 다시 담기지 않는다', () => {
    const first = performGather({
      player: playerBelowThreshold(), data: dataWithMilestone, tables, barriers: noBarriers,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
    })
    if (!first.ok) throw new Error('성공해야 한다')

    const second = performGather({
      player: first.outcome.player, data: dataWithMilestone, tables, barriers: noBarriers,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: first.outcome.player.nextActionAt,
    })
    if (!second.ok) throw new Error('성공해야 한다')

    expect(second.outcome.achieved).toEqual([])
    // celebrated 는 계속 그대로다 — 같은 id 를 두 번 넣지 않는다.
    expect(second.outcome.player.celebrated).toEqual(['mineral-5'])
  })

  // 이것이 이 태스크의 핵심 반전이다(설계 §7-앞 7). 예전에는 실패 경로가 달성
  // 판정 자체를 하지 않았다 — 지금은 실패해도 숙련이 오르고(위 describe 참고),
  // 그 상승이 문턱을 넘기면 축하가 침묵하면 안 된다.
  it('실패한 채집도 숙련이 올라 문턱을 넘기면 achieved 에 담긴다 — 실패가 판정을 침묵시키지 않는다', () => {
    const r = performGather({
      player: playerBelowThreshold(), data: dataWithMilestone, tables, barriers: noBarriers,
      instanceId: 'copper_vein-1', rng: failRoll, now: 0,
    })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.player.skills.mineral).toBeGreaterThanOrEqual(5) // 문턱을 넘었는지 전제부터 확인한다
    expect(r.outcome.achieved.map((m) => m.id)).toEqual(['mineral-5'])
    expect(r.outcome.player.celebrated).toEqual(['mineral-5'])
  })

  it('이미 축하한 이정표는 실패한 채집이 숙련을 더 올려도 다시 담기지 않는다', () => {
    const p = player({
      skills: { ice: 0, wood: 0, mineral: 5, herb: 0, crafting: 0 },
      celebrated: ['mineral-5'],
    })
    const r = performGather({
      player: p, data: dataWithMilestone, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: failRoll, now: 0,
    })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.achieved).toEqual([])
    expect(r.outcome.player.celebrated).toEqual(['mineral-5'])
  })

  it('거부당한 요청은 celebrated 를 건드리지 않는다', () => {
    const p = player({
      skills: { ice: 0, wood: 0, mineral: 5, herb: 0, crafting: 0 },
      nextActionAt: 8000,
    })
    const r = performGather({
      player: p, data: dataWithMilestone, tables, barriers: noBarriers, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000,
    })
    // too_fast 거부는 outcome 자체가 없다 — celebrated 를 실을 자리가 없다.
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })
})

/**
 * 결계 뒤 노드 — **이 아크가 만든 구멍**을 막는 검사다(설계 §2 — 판정의 유일한
 * 주인은 서버다). 오래 "§9-앞 18" 로 적혀 있었는데 그 번호는 "계기 절의 숫자
 * 셋을 고친다"이고, 여기서 지키는 서버 전용 산출물 규범의 출처는 채집 티어 스펙
 * §7-앞 9 다.
 *
 * 결계는 맵 안 전환이라(`fromMap === toMap`, 설계 §3) 위의 맵 검사에게 안팎이
 * 같은 맵이다. B2 가 심층에 ×2.5 분포를 주기 전에는 뚫어도 얻을 것이 없어
 * 무해했지만, 지금은 벽 바깥에 선 사람이 `instanceId` 하나로 심층 표를 굴릴 수
 * 있다 — 맵 JSON 은 클라이언트가 받아 가므로 그 id 는 이미 손에 있다.
 */
describe('performGather — 결계 뒤 노드', () => {
  /**
   * 얼음 결계 하나. 안쪽은 도착 칸 (5,2) 와 심층 노드가 놓인 (5,3) 이다 —
   * 위 fixture 의 `iron_vein-1`(variant: deep)이 그 (5,3) 에 있다.
   *
   * 실제 출하 데이터에서는 이 목록을 빌드가 굽는다(`bakeBarrierRegions`) —
   * 여기 손으로 적는 이유는 이 스위트가 재는 것이 **판정**이지 굽기가 아니기
   * 때문이다. 굽기가 맞는지는 packages/data 의 transitions.test.ts 가 본다.
   */
  const barriers: BarrierRegions = [{ mapId: '얼음채집장', cells: ['5,2', '5,3'] }]

  /** 결계 밖 어딘가 — 마을에서 채집장으로 들어온 사람의 도착 칸 자리다. */
  const 바깥 = { mapId: '얼음채집장', x: 15, y: 24 }
  /** 결계를 넘은 사람의 저장된 위치 — moveThroughTransition 이 적어 준 도착 칸이다. */
  const 안쪽 = { mapId: '얼음채집장', x: 5, y: 2 }

  // 왜: 이것이 구멍 그 자체다. 맵 검사만 있던 동안 이 요청은 200 으로 통과했고,
  //     결계가 이 아크의 전부인데 devtools 하나로 우회됐다.
  it('결계 밖에 선 사람은 결계 뒤 노드를 캘 수 없다', () => {
    const p = player({ location: 바깥 })
    const r = performGather({ player: p, data, tables, barriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'wrong_side' })
  })

  // 왜: 거절이 상태를 건드리면 연타만으로 숙련·간격이 움직인다 — 못 캐게 막은
  //     것이 아니라 "아이템 없이 캐게" 한 것이 된다.
  it('그 거절은 상태를 하나도 바꾸지 않는다', () => {
    const p = player({ location: 바깥 })
    const before = structuredClone(p)
    const r = performGather({ player: p, data, tables, barriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    expect(r.ok).toBe(false)
    // 거절 경로에는 outcome 이 없으므로 돌아오는 플레이어 자체가 없다. 인자로
    // 건넨 객체가 그대로인지를 본다 — 서비스가 원본을 건드렸다면 여기서 드러난다.
    expect(p).toEqual(before)
  })

  // 왜: 서버가 통과 여부를 아는 유일한 흔적이 저장된 도착 칸이다. 그것이
  //     통과로 읽히지 않으면 정당하게 들어간 사람이 벽 안에서 아무것도 못 캔다.
  it('결계를 넘은 사람은 결계 뒤 노드를 캔다', () => {
    const p = player({ location: 안쪽 })
    const r = performGather({ player: p, data, tables, barriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    if (!r.ok) throw new Error('안에 있는 사람은 캘 수 있어야 한다')
    expect(r.outcome.success).toBe(true)
  })

  // 왜: **회귀 0 의 정의다.** 바깥 노드는 결계 목록이 있든 없든, 서 있는 자리가
  //     어디든 지금까지와 똑같이 캐져야 한다. 저장된 x·y 는 원래도 실제 서 있는
  //     칸이 아니라 마지막 전환 도착 칸이라(PlayerState.location), 여기에 자리
  //     검사를 얹으면 멀쩡히 캐던 사람들이 이유 없이 거절당한다.
  it('결계 뒤가 아닌 노드는 어디에 서 있든 지금처럼 캐진다', () => {
    for (const location of [바깥, 안쪽, { mapId: '얼음채집장', x: 0, y: 0 }]) {
      const r = performGather({
        player: player({ location }), data, tables, barriers,
        instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
      })
      if (!r.ok) throw new Error(`(${location.x}, ${location.y}) 에서도 캘 수 있어야 한다`)
      expect(r.outcome.success).toBe(true)
    }
  })

  // 왜: **가장 중요한 회귀 방지다.** "결계 뒤 노드니까 결계 조건(숙련 85,000 +
  //     물때)을 다시 확인한다" 는 틀린 고침이다 — 허브 결계는 물이 빠졌을 때만
  //     들어갈 수 있지만 안내판이 "나오는 길은 막지 않았다"고 약속했고(설계 §6),
  //     들어간 뒤에는 물이 차도 안에서 계속 캘 수 있어야 한다. 조건을 다시 재면
  //     정당하게 들어간 사람이 물이 들어오는 순간 손을 놓는다.
  //
  //     그래서 이 무대는 **물때가 걸린 결계**이고, 플레이어의 숙련은 0 이며
  //     (요구치를 지금은 못 채운다), 판정 시각은 물이 차 있는 때다. 그래도
  //     캐져야 한다: 물어야 할 것은 "조건을 만족하는가"가 아니라 "지금 그 안에
  //     있는가" 뿐이기 때문이다.
  it('물때가 닫힌 시각에도, 이미 안에 있으면 캔다 — 묻는 것은 조건이 아니라 자리다', () => {
    const 물때결계: GameData = {
      ...data,
      transitions: [
        { fromMap: '얼음채집장', fromX: 5, fromY: 4, toMap: '얼음채집장', toX: 5, toY: 2,
          facing: 'up', gateSkill: 'mineral', gateValue: 85000, gateTide: true },
      ],
    }
    // 물이 차 있는 시각(게임 12시 — TIDE_WINDOWS 는 2~8·14~20 이다)이고
    // 숙련도 0 이라, 지금 이 사람은 저 문을 **다시는 못 지난다**.
    const 물찬시각 = GAME_EPOCH_MS + 12 * 60 * REAL_MS_PER_GAME_MINUTE
    expect(isLowTide(gameTimeAt(물찬시각).hour)).toBe(false)

    const p = player({ location: 안쪽, skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 } })
    const r = performGather({
      player: p, data: 물때결계, tables, barriers,
      instanceId: 'iron_vein-1', rng: jackpotRoll, now: 물찬시각,
    })
    if (!r.ok) throw new Error('안에 있는 사람은 물이 차도 캘 수 있어야 한다')
    expect(r.outcome.success).toBe(true)
  })

  // 왜: 결계가 없는 맵(개발용 시험장)에는 이 검사가 손댈 것이 없다. 구운 목록에
  //     그 맵이 아예 안 들어가므로, 그 맵의 노드는 전부 "결계 뒤가 아님" 이다.
  it('결계가 없는 맵의 노드는 영향을 받지 않는다', () => {
    const 개발맵: GameData = {
      ...data,
      placements: {
        ...data.placements,
        'iron_vein-9': { instanceId: 'iron_vein-9', nodeId: 'iron_vein', mapId: '개발맵', x: 5, y: 3 },
      },
      maps: {
        ...data.maps,
        개발맵: { id: '개발맵', name: '개발용 시험장', file: 'dev.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } },
      },
    }
    // 얼음 결계와 **같은 좌표**(5,3)를 일부러 골랐다 — 맵을 안 보고 좌표만 보면
    // 이 노드가 결계 뒤로 읽힌다.
    const p = player({ location: { mapId: '개발맵', x: 15, y: 15 } })
    const r = performGather({
      player: p, data: 개발맵, tables, barriers, instanceId: 'iron_vein-9', rng: jackpotRoll, now: 0,
    })
    if (!r.ok) throw new Error('결계 없는 맵에서는 그대로 캐져야 한다')
    expect(r.outcome.success).toBe(true)
  })

  // 왜: 검사 순서를 못 박는다. 다른 맵이면 wrong_map 이 먼저다 — 결계 검사는
  //     "같은 맵인데 벽 반대편" 을 말하는 코드이므로, 맵부터 다른 요청에 그것을
  //     돌려주면 플레이어(와 로그를 읽는 우리)가 원인을 잘못 짚는다.
  it('맵부터 다르면 wrong_side 가 아니라 wrong_map 이다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    const r = performGather({ player: p, data, tables, barriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'wrong_map' })
  })

  // 왜: 자리 검사가 간격보다 먼저인 이유는 맵 검사와 같다 — 벽 반대편에서는
  //     언제 두드려도 닿을 수 없는데 too_fast 로 답하면 "조금 있다 다시 두드리면
  //     된다" 로 읽힌다.
  it('간격도 남아 있고 벽 반대편이면 wrong_side 를 우선한다', () => {
    const p = player({ location: 바깥, nextActionAt: 8000 })
    const r = performGather({ player: p, data, tables, barriers, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'wrong_side' })
  })
})

/**
 * 노드가 지는 조건 — 날씨·시각(설계 §3). 결계와 **다른 것을 막는다**: 결계는
 * 그 앞에 설 수 있는가를 막고, 이것은 그 앞에 선 사람이 지금 캘 수 있는가를 막는다.
 *
 * 판정은 서비스가 짓지 않는다. 부등호는 shared 의 `nodeAvailable` 하나뿐이고
 * (결계의 transitionGate 가 선 그 자리다) 화면도 같은 함수로 문구를 짓는다.
 */
describe('performGather — 노드 조건', () => {
  const 눈올때: NodeDef = {
    id: 'red_ice_vein', name: '붉은 얼음 광맥', skill: 'mineral', tableId: 'mineral',
    variant: 'special', sprite: 'red_ice_vein', requireWeather: 'snow',
  }
  const 물때에: NodeDef = {
    id: 'frost_bloom', name: '서리 핀 군락', skill: 'mineral', tableId: 'mineral',
    variant: 'special', sprite: 'frost_bloom', requireTime: 'tide',
  }

  const 조건세계: GameData = {
    ...data,
    nodes: { ...data.nodes, red_ice_vein: 눈올때, frost_bloom: 물때에 },
    placements: {
      ...data.placements,
      'red_ice_vein-1': { instanceId: 'red_ice_vein-1', nodeId: 'red_ice_vein', mapId: '얼음채집장', x: 11, y: 3 },
      'frost_bloom-1': { instanceId: 'frost_bloom-1', nodeId: 'frost_bloom', mapId: '얼음채집장', x: 13, y: 3 },
    },
  }

  /** 게임 12시 — 밤도 아니고 물때도 아니다(TIDE_WINDOWS 2~8 · 14~20). */
  const 낮 = GAME_EPOCH_MS + 12 * 60 * REAL_MS_PER_GAME_MINUTE
  /** 게임 3시 — 물이 빠져 있다. */
  const 물빠진시각 = GAME_EPOCH_MS + 3 * 60 * REAL_MS_PER_GAME_MINUTE

  const 눈 = (untilMs: number): PlayerState['weather'] => ({ kind: 'snow', untilMs })

  it('조건이 안 맞으면 node_closed 로 거부한다', () => {
    const r = performGather({
      player: player(), data: 조건세계, tables, barriers: noBarriers,
      instanceId: 'red_ice_vein-1', rng: jackpotRoll, now: 낮,
    })
    expect(r).toEqual({ ok: false, code: 'node_closed' })
  })

  it('조건이 맞으면 그대로 캐진다 — 조건은 가용성이고 굴림에는 손대지 않는다', () => {
    const r = performGather({
      player: player({ weather: 눈(낮 + 1) }), data: 조건세계, tables, barriers: noBarriers,
      instanceId: 'red_ice_vein-1', rng: jackpotRoll, now: 낮,
    })
    if (!r.ok) throw new Error('눈이 오는 동안에는 캐져야 한다')
    // 같은 주사위·같은 표라 조건 없는 노드와 결과가 한 글자도 다르지 않다.
    expect(r.outcome.gained).toEqual({ itemId: 'mithril_ore', count: 1 })
  })

  it('물때 조건은 물이 빠졌을 때만 열린다', () => {
    const 닫힘 = performGather({
      player: player(), data: 조건세계, tables, barriers: noBarriers,
      instanceId: 'frost_bloom-1', rng: jackpotRoll, now: 낮,
    })
    expect(닫힘).toEqual({ ok: false, code: 'node_closed' })

    const 열림 = performGather({
      player: player(), data: 조건세계, tables, barriers: noBarriers,
      instanceId: 'frost_bloom-1', rng: jackpotRoll, now: 물빠진시각,
    })
    expect(열림.ok).toBe(true)
  })

  // 왜: 출하 열두 노드 중 보통·심층 여덟이 조건 칸이 빈 행이다. 빈 칸을 "언제나 열림" 이
  //     아니라 다른 무엇으로 읽는 순간 이 아크가 기존 채집을 통째로 바꾼다 —
  //     그것이 이 태스크가 하지 않기로 한 유일한 일이다.
  it('조건 칸이 빈 노드는 밤에도 낮에도 언제나 열린다', () => {
    for (const now of [낮, 물빠진시각, 0]) {
      const r = performGather({
        player: player(), data: 조건세계, tables, barriers: noBarriers,
        instanceId: 'copper_vein-1', rng: jackpotRoll, now,
      })
      expect(r.ok, `now=${now}`).toBe(true)
    }
  })

  // 왜: **거절이 노가다를 느리게 하면 안 된다**(moveService 의 그 주석과 같은
  //     이유). 간격을 먼저 읽으면 닫힌 노드 앞에서 A 를 누른 사람이 too_fast 를
  //     받는데, 그 글자는 "조금 있다 다시 두드리면 된다" 로 읽힌다 — 실제로는
  //     눈이 와야 열리므로 몇 초를 기다려도 답이 안 바뀐다. 자리 검사 둘(맵·벽)이
  //     간격보다 앞에 선 그 이유가 여기에도 그대로 선다.
  it('간격이 남아 있어도 too_fast 가 아니라 node_closed 다 — 거절이 nextActionAt 을 읽지 않는다', () => {
    const p = player({ nextActionAt: 낮 + 8000 })
    const r = performGather({
      player: p, data: 조건세계, tables, barriers: noBarriers,
      instanceId: 'red_ice_vein-1', rng: jackpotRoll, now: 낮,
    })
    expect(r).toEqual({ ok: false, code: 'node_closed' })
  })

  // 왜: 읽지 않는 것만으로는 부족하다 — 거절이 스탬프를 찍으면 닫힌 노드를 한 번
  //     두드린 것만으로 그 사람의 다음 채집이 밀린다.
  //
  //     **이 질문은 판정 함수 안에서는 물을 수 없다.** performGather 는 판정 전에
  //     인자를 복제하므로(gatherService.ts 의 structuredClone), 거절 줄에서 그
  //     복제본에 무엇을 쓰든 인자로 건넨 객체는 안 변한다 — 예전 이 자리의
  //     `expect(p.nextActionAt).toBe(0)` 은 어떤 구현에도 초록이었다. 거절이
  //     쿨다운을 찍었는지 아닌지가 실제로 갈리는 곳은 **저장소**다.
  //
  //     그래서 판정 하나가 아니라 라우트가 매번 밟는 길(applyToCharacter → 저장)을
  //     그대로 밟고, 되읽은 캐릭터에게 묻는다. 묻는 것은 둘이다: 거절 뒤 저장된
  //     상태가 한 글자도 안 바뀌었는가, 그리고 **같은 순간에** 열린 노드를 캘 수
  //     있는가. 뒤엣것이 플레이어가 체감하는 형태다 — 닫힌 문을 한 번 두드렸다는
  //     이유로 옆의 광맥 앞에서 기다리게 되면 안 된다.
  it('닫힌 노드를 두드려도 저장된 상태가 그대로고, 같은 순간 옆의 열린 노드를 캔다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nogada-gather-'))
    const store = await JsonPersistence.open(join(dir, 'players.json'))
    try {
      const p = player({ nextActionAt: 0 })
      await store.createCharacter('u1', p)
      const 저장된 = async (): Promise<PlayerState> => {
        const stored = await store.readCharacter(p.id)
        if (!stored) throw new Error('방금 만든 캐릭터가 없다')
        return stored.player
      }
      const 캔다 = (instanceId: string) =>
        applyToCharacter(store, p.id, (character) =>
          performGather({
            player: character, data: 조건세계, tables, barriers: noBarriers,
            instanceId, rng: jackpotRoll, now: 낮,
          }),
        )

      const before = await 저장된()
      expect(await 캔다('red_ice_vein-1')).toEqual({ ok: false, code: 'node_closed' })
      // 숙련도 재고도 함께 본다 — 거절이 무엇을 남기든 여기서 드러난다.
      expect(await 저장된()).toEqual(before)

      // 시각이 한 톨도 안 지났는데 옆의 조건 없는 노드는 그대로 캐진다.
      const 열린노드 = await 캔다('copper_vein-1')
      if (!열린노드.ok) throw new Error(`열린 노드는 캐져야 한다: ${열린노드.code}`)
      // 쿨다운은 **지금부터** 시작한다. 앞선 거절이 스탬프를 찍어 뒀다면 이 요청은
      // 애초에 too_fast 로 거절당했을 것이다.
      expect(열린노드.outcome.player.nextActionAt).toBe(낮 + 500)
    } finally {
      await store.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // 왜: 맵부터 다르면 wrong_map 이 먼저다 — 결계 검사와 같은 저울이다. 조건을
  //     먼저 말하면 "눈을 부르면 된다" 로 읽히는데, 정작 그 사람은 다른 맵에 있다.
  it('맵부터 다르면 node_closed 가 아니라 wrong_map 이다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    const r = performGather({
      player: p, data: 조건세계, tables, barriers: noBarriers,
      instanceId: 'red_ice_vein-1', rng: jackpotRoll, now: 낮,
    })
    expect(r).toEqual({ ok: false, code: 'wrong_map' })
  })
})
