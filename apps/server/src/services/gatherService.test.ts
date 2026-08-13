import {
  ACTION_INTERVAL_MAX_MS,
  emptyDialogueHistory,
  ENHANCE_CAP,
  ENHANCE_INTERVAL_FACTOR,
  type GameData,
  type GatherTables,
  type MilestoneDef,
  type PlayerState,
} from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
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
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal',
    },
    // 심층 외형. **출하 데이터에서는 deep 이 자기 표(*_deep)를 가리키지만**
    // (결계 §9-앞 5) 여기서는 일부러 바깥과 같은 표를 물린다 — 이 스위트가
    // 재는 것은 "굴리는 것은 variant 가 아니라 tableId 다" 이고, 표까지 갈라
    // 두면 아래 두 단정이 무엇 때문에 갈렸는지 구별되지 않는다.
    //
    // 심층으로 들어가는 것을 막는 것은 이 서비스가 아니다 — 그 앞의 결계
    // 전환(moveService)이다. 채집 판정에는 지금도 접근 게이트가 없다.
    iron_vein: {
      id: 'iron_vein', name: '철 광맥', skill: 'mineral', tableId: 'mineral', variant: 'deep',
    },
    // 플레이어의 기본 도구(광물)와 기술이 다른 노드 — "엉뚱한 기술의 도구 =
    // 맨손"(§6-앞 9)이 서비스 경로에서 지켜지는지 확인하는 무대다.
    herb_patch: {
      id: 'herb_patch', name: '약초 군락', skill: 'herb', tableId: 'herb', variant: 'normal',
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
    const r = performGather({ player: player(), data, tables, instanceId: 'ghost-1', rng: jackpotRoll, now: 0 })
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
    const a = performGather({ player: player(), data: d, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    const b = performGather({ player: player(), data: d, tables, instanceId: 'copper_vein-2', rng: jackpotRoll, now: 0 })
    if (!a.ok || !b.ok) throw new Error('둘 다 성공해야 한다')
    expect(a.outcome.gained).toEqual(b.outcome.gained)
  })

  // 왜: 앞칸 판정은 클라이언트에만 있다. 서버가 어느 맵인지 모르면 다른 맵의
  //     인스턴스 id 하나로 맵 너머의 노드를 캘 수 있다 — 맵이 하나뿐일 때는
  //     존재하지 않던 구멍이라 기존 검사 어느 것도 이걸 막지 않는다.
  it('다른 맵의 노드는 캘 수 없다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 } })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('없는 인스턴스는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, tables, instanceId: 'nope-9', rng: jackpotRoll, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })

  it('엉뚱한 기술의 도구는 맨손으로 친다 — roll ×1.45 가 같은 주사위를 실패로 만든다(§6-앞 9)', () => {
    // 허브 슬롯에 곡괭이(광물 도구)가 꽂힌 극단 상태다. equippedToolInfo 가 이
    // 불일치를 null(맨손)로 만들어 판정에 넘기는지를 서비스 경로에서 본다 —
    // 게이트로 거부하던 옛 cannot_gather 는 은퇴했다(§2).
    const p = player({ equipped: { herb: 'i1' } })
    const r = performGather({ player: p, data, tables, instanceId: 'herb_patch-1', rng: herbEdgeRoll, now: 0 })
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
    const r = performGather({ player: p, data, tables, instanceId: 'herb_patch-1', rng: herbEdgeRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.success).toBe(true)
    expect(r.outcome.gained).toEqual({ itemId: 'rare_herb', count: 1 })
  })

  it('심층 외형(deep) 노드도 같은 기술의 1등급 도구로 캘 수 있다 — 등급 게이트는 폐지됐다', () => {
    const r = performGather({ player: player(), data, tables, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    expect(r.ok).toBe(true)
  })

  it('굴리는 것은 variant 가 아니라 tableId 다 — 표가 같으면 외형이 달라도 같은 roll 에 같은 티어가 나온다', () => {
    const normal = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    const deep = performGather({ player: player(), data, tables, instanceId: 'iron_vein-1', rng: jackpotRoll, now: 0 })
    if (!normal.ok || !deep.ok) throw new Error('둘 다 성공해야 한다')
    // 이 스위트의 두 노드는 variant 만 다르고 표는 'mineral' 로 같다. 그래서
    // 같은 roll(0)이면 같은 최상 티어(mithril_ore)가 나온다 — 판정이 노드의
    // 외형을 보지 않는다는 뜻이다. **출하 데이터에서 심층이 다른 것을 내는
    // 이유는 그 표가 다르기 때문이지 이 외형 때문이 아니다.**
    expect(deep.outcome.gained).toEqual(normal.outcome.gained)
  })

  it('맨손이어도 캘 수 있다 — 게이트가 아니라 페널티다(§2): 간격 ×1.5, 잭팟은 원확률', () => {
    const p = player({ instances: [], equipped: {} })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('맨손 채집은 거부가 아니다')
    // 잭팟 밴드는 평감산만 적용되고 맨손의 평감산은 0 이다(§3) — roll 0 그대로
    // 최상 티어가 나온다. 맨손 잭팟이 원확률로 열려 있다는 원작 정신의 증거다.
    expect(r.outcome.gained).toEqual({ itemId: 'mithril_ore', count: 1 })
    // 간격 스탬프는 gatherIntervalMs 의 몫이다(§6-앞 10) — 숙련 0 의 500ms 에 ×1.5.
    expect(r.outcome.player.nextActionAt).toBe(1000 + 750)
  })

  it('강화된 도구는 간격 스탬프가 짧아진다 — 스탬프가 ×0.97^강화 를 실제로 읽는다(§6-앞 10)', () => {
    const p = player({ instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: ENHANCE_CAP }] })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
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
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  it('간격이 지났으면 채집할 수 있다', () => {
    const p = player({ nextActionAt: 5000 })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r.ok).toBe(true)
  })

  it('숙련도 0 이면 다음 행동까지 500ms 를 기다린다', () => {
    const r = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('숙련도가 높으면 간격이 짧아진다', () => {
    const p = player({ skills: { ice: 0, wood: 0, mineral: 999_999, herb: 0, crafting: 0 } })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 50)
  })

  it('실패해도 간격은 걸린다', () => {
    const r = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: failRoll, now: 1000 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  // 검사 순서 자체를 못 박는다: 간격도 안 지나고 맵도 다른 상황에서 wrong_map
  // 이 나와야 맵 검사가 간격보다 먼저라는 것이 증명된다. too_fast 로 답하면
  // "조금 있다 다시 두드리면 된다"는 거짓 안내가 된다 — 어느 때 두드려도 닿지
  // 않는 노드다. (도구 자격 검사는 은퇴했다 — 맨손 허용, §2.)
  it('간격도 남아 있고 맵도 다르면 wrong_map 을 우선한다', () => {
    const p = player({ location: { mapId: '눈의마을', x: 1, y: 1 }, nextActionAt: 8000 })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'wrong_map' })
  })

  it('성공하면 뽑힌 아이템 1개가 스택에 쌓이고 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
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
    const r = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: failRoll, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')

    expect(r.outcome.success).toBe(false)
    expect(r.outcome.gained).toBeNull()
    expect(r.outcome.skillGained).toBeGreaterThan(0)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
    expect(r.outcome.player.stacks).toEqual({})
  })

  it('표 메타(skillGainMin~Max)가 정한 범위(1~2)에서 성패와 무관하게 숙련이 오른다', () => {
    const success = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    const failure = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: failRoll, now: 0 })
    if (!success.ok || !failure.ok) throw new Error('둘 다 요청 자체는 성공해야 한다')

    for (const r of [success, failure]) {
      expect(r.outcome.skillGained).toBeGreaterThanOrEqual(1)
      expect(r.outcome.skillGained).toBeLessThanOrEqual(2)
      expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
    }
  })

  it('이미 가진 재료에 누적한다', () => {
    const p = player({ stacks: { mithril_ore: 5 } })
    const r = performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks.mithril_ore).toBe(6)
  })

  it('다른 생활기술의 숙련도는 건드리지 않는다', () => {
    const r = performGather({ player: player(), data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.skills.ice).toBe(0)
    expect(r.outcome.player.skills.wood).toBe(0)
    expect(r.outcome.player.skills.herb).toBe(0)
    expect(r.outcome.player.skills.crafting).toBe(0)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    performGather({ player: p, data, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0 })
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
      player: playerBelowThreshold(), data: dataWithMilestone, tables,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.skills.mineral).toBe(5) // 문턱에 정확히 닿았는지 전제부터 확인한다
    expect(r.outcome.achieved.map((m) => m.id)).toEqual(['mineral-5'])
  })

  it('그 이정표 id 가 outcome.player.celebrated 에 들어간다', () => {
    const r = performGather({
      player: playerBelowThreshold(), data: dataWithMilestone, tables,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
    })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.player.celebrated).toEqual(['mineral-5'])
  })

  it('다음 채집에서는 다시 담기지 않는다', () => {
    const first = performGather({
      player: playerBelowThreshold(), data: dataWithMilestone, tables,
      instanceId: 'copper_vein-1', rng: jackpotRoll, now: 0,
    })
    if (!first.ok) throw new Error('성공해야 한다')

    const second = performGather({
      player: first.outcome.player, data: dataWithMilestone, tables,
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
      player: playerBelowThreshold(), data: dataWithMilestone, tables,
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
      player: p, data: dataWithMilestone, tables, instanceId: 'copper_vein-1', rng: failRoll, now: 0,
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
      player: p, data: dataWithMilestone, tables, instanceId: 'copper_vein-1', rng: jackpotRoll, now: 5000,
    })
    // too_fast 거부는 outcome 자체가 없다 — celebrated 를 실을 자리가 없다.
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })
})
