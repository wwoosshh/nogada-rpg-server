import { defaultCombatState, emptyDialogueHistory, type EnhanceCostDef, type ItemDef, type PlayerState } from '@nogada/shared'
import { testItem, testTool } from '@nogada/shared/testing'
import { describe, expect, it } from 'vitest'
import { performEnhance, performEquip } from './equipService.js'

/**
 * 착용·강화는 카탈로그에서 items 만 본다 — GameData 통째가 아니라 이 지도를
 * 받는 것이 서비스의 계약이라, 픽스처도 지도만 만든다.
 */
const items: Record<string, ItemDef> = {
  copper_pickaxe: testTool('copper_pickaxe', 'mineral', 1, { name: '구리 곡괭이', icon: 'pickaxe_copper' }),
  iron_pickaxe: testTool('iron_pickaxe', 'mineral', 2, { name: '철 곡괭이', icon: 'pickaxe_iron' }),
  copper_axe: testTool('copper_axe', 'wood', 1, { name: '구리 도끼', icon: 'axe_copper' }),
  // 무기 — 슬롯이 SkillId 다섯 밖('combat')인 도구다(전투 §12-앞 8). 착용 판정이
  // 슬롯을 정의(toolSkill)에서 읽는다는 계약이 무기에도 그대로 서는지 본다.
  copper_sword: testTool('copper_sword', 'combat', 1, { name: '구리 검', icon: 'sword_copper', damage: 5 }),
  copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
  hard_log: testItem('hard_log', { name: '단단한 통나무', icon: 'log_hard', price: 400, skill: 'wood' }),
  lavender: testItem('lavender', { name: '라벤더', icon: 'flower_lavender', price: 130, skill: 'herb' }),
  pure_ice: testItem('pure_ice', { name: '맑은 얼음', icon: 'crystal_ice', price: 150, skill: 'ice' }),
  iron_ore: testItem('iron_ore', { name: '철 원석', icon: 'ore_iron', price: 100, skill: 'mineral' }),
  // kind=tool 인데 toolSkill 이 빠진 정의 — §6-앞 11 이 경고한 optional 함정.
  // 검증이 이런 행을 막지만, 서비스는 검증을 거치지 않은 데이터 앞에서도
  // equipped['undefined'] 유령 슬롯을 만들면 안 된다. **testTool 을 쓰지 않는 것이
  // 의도다** — 도구인데 toolSkill 이 없는 정의를 일부러 만드는 자리라, 정상 도구를
  // 만드는 길과 다르게 적어야 그 일부러가 눈에 띈다.
  skillless_tool: testItem('skillless_tool', { name: '기술 없는 도구', kind: 'tool', toolTier: 1, icon: 'tool_broken' }),
}

/**
 * 출하 표(enhance_costs.csv)의 모양을 그대로 줄인 것 — 1티어 사다리 전부와,
 * 티어 배수를 견주기 위한 2티어 +1 하나다. 계열 회전(+1 나무 · +2 허브 ·
 * +3 얼음 · +4 광물 · +5 넷)이 픽스처에서 눈에 보여야 그 회전을 보는 테스트가
 * 무엇을 확인하는지 읽힌다.
 */
const costs: EnhanceCostDef[] = [
  { toolTier: 1, level: 1, materials: [{ item: 'hard_log', count: 5 }], gold: 5_000 },
  { toolTier: 1, level: 2, materials: [{ item: 'lavender', count: 10 }], gold: 9_000 },
  { toolTier: 1, level: 3, materials: [{ item: 'pure_ice', count: 15 }], gold: 15_000 },
  { toolTier: 1, level: 4, materials: [{ item: 'iron_ore', count: 25 }], gold: 25_000 },
  {
    toolTier: 1,
    level: 5,
    materials: [
      { item: 'hard_log', count: 10 },
      { item: 'lavender', count: 10 },
      { item: 'pure_ice', count: 10 },
      { item: 'iron_ore', count: 10 },
    ],
    gold: 40_000,
  },
  // 2티어는 1티어의 ×4 다(§6-앞 12).
  { toolTier: 2, level: 1, materials: [{ item: 'hard_log', count: 20 }], gold: 20_000 },
]

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
    // 착용 중인 구리 곡괭이 하나 + 예비 철 곡괭이 하나 — 교체·강화 시나리오의 기본 무대다.
    instances: [
      { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      { instanceId: 'spare-iron', itemId: 'iron_pickaxe', enhanceLevel: 0 },
    ],
    equipped: { mineral: 'worn' },
    nextActionAt: 0,
    celebrated: [],
    // 사슬은 이 스위트가 보는 판정이 아니다 — PlayerState 의 필수 칸이라 채워만 둔다.
    story: 0,
    storyCount: 0,
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    // 이 판정들은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
    ...overrides,
  }
}

describe('performEquip', () => {
  it('예비 도구를 지목하면 그 도구의 toolSkill 슬롯으로 교체된다 — 슬롯은 요청이 아니라 정의가 정한다(§4)', () => {
    const r = performEquip({ player: player(), items, instanceId: 'spare-iron' })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.equipped.mineral).toBe('spare-iron')
    // 벗겨진 도구의 인스턴스는 그대로 남는다 — 교체이지 파괴가 아니다.
    expect(r.outcome.player.instances).toHaveLength(2)
  })

  it('다른 기술의 도구는 자기 슬롯으로 간다 — 착용 중인 슬롯을 건드리지 않는다', () => {
    const p = player({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 0 },
        { instanceId: 'axe1', itemId: 'copper_axe', enhanceLevel: 0 },
      ],
    })
    const r = performEquip({ player: p, items, instanceId: 'axe1' })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.equipped.wood).toBe('axe1')
    expect(r.outcome.player.equipped.mineral).toBe('worn')
  })

  it('무기는 combat 슬롯으로 간다 — 슬롯 결정이 SkillId 다섯 밖으로도 정의를 따른다(전투 §12-앞 8)', () => {
    const p = player({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 0 },
        { instanceId: 'sword1', itemId: 'copper_sword', enhanceLevel: 0 },
      ],
    })
    const r = performEquip({ player: p, items, instanceId: 'sword1' })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.equipped.combat).toBe('sword1')
    // 검이 채집 슬롯을 밀어내면 무기 하나가 곡괭이를 벗긴다.
    expect(r.outcome.player.equipped.mineral).toBe('worn')
  })

  it('없는 인스턴스는 unknown_instance 로 거부한다', () => {
    const r = performEquip({ player: player(), items, instanceId: 'ghost' })
    expect(r).toEqual({ ok: false, code: 'unknown_instance' })
  })

  it('도구가 아닌 아이템의 인스턴스는 not_a_tool 로 거부한다', () => {
    // 재료는 스택으로 살지 인스턴스가 되지 않지만, 서비스는 자기 입력만 믿는다.
    const p = player({ instances: [{ instanceId: 'ore1', itemId: 'copper_ore', enhanceLevel: 0 }] })
    const r = performEquip({ player: p, items, instanceId: 'ore1' })
    expect(r).toEqual({ ok: false, code: 'not_a_tool' })
  })

  it('kind=tool 이어도 toolSkill 이 없으면 not_a_tool 이다 — kind 만 보면 equipped["undefined"] 유령 슬롯이 생긴다(§6-앞 11)', () => {
    const p = player({ instances: [{ instanceId: 'odd1', itemId: 'skillless_tool', enhanceLevel: 0 }] })
    const r = performEquip({ player: p, items, instanceId: 'odd1' })
    expect(r).toEqual({ ok: false, code: 'not_a_tool' })
  })

  it('행동 간격을 검사도 소비도 하지 않는다 — 정리 행위는 행동이 아니다(§6-앞 11)', () => {
    const p = player({ nextActionAt: 8_000 })
    const r = performEquip({ player: p, items, instanceId: 'spare-iron' })
    if (!r.ok) throw new Error('간격이 남아 있어도 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(8_000)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = player()
    performEquip({ player: p, items, instanceId: 'spare-iron' })
    expect(p.equipped.mineral).toBe('worn')
  })
})

describe('performEnhance', () => {
  /** 원재료·골드는 넉넉히 — 모자람을 보는 테스트만 일부러 줄인다. */
  const RICH_STACKS = { hard_log: 100, lavender: 100, pure_ice: 100, iron_ore: 100 }

  /** 착용 구리 곡괭이 + 예비 구리 곡괭이 + 재료·골드 — 강화가 성립하는 기본 무대. */
  function enhanceReady(overrides: Partial<PlayerState> = {}): PlayerState {
    return player({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 0 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      ],
      stacks: { ...RICH_STACKS },
      gold: 1_000_000,
      ...overrides,
    })
  }

  /** 인자 셋 중 플레이어만 바뀌는 호출이 스위트 전체에 깔려 있다 — 그 되풀이를 접는다. */
  function enhance(p: PlayerState, materialInstanceId: string) {
    return performEnhance({ player: p, items, costs, materialInstanceId })
  }

  it('예비를 소모해 같은 itemId 의 착용 인스턴스가 +1 된다 — 대상은 요청이 아니라 규칙이 정한다(§5)', () => {
    const r = enhance(enhanceReady(), 'spare')
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.instances).toEqual([
      { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 1 },
    ])
    expect(r.outcome.player.equipped.mineral).toBe('worn')
  })

  it('재료의 강화 수치는 버려진다 — +2 재료도 +1 만큼이다(§5, 합성식은 훅)', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 3 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 2 },
      ],
    })
    const r = enhance(p, 'spare')
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.instances[0]!.enhanceLevel).toBe(4)
  })

  it('없는 인스턴스는 unknown_instance 로 거부한다', () => {
    expect(enhance(enhanceReady(), 'ghost')).toEqual({ ok: false, code: 'unknown_instance' })
  })

  it('착용 중인 인스턴스는 재료가 될 수 없다 — material_equipped', () => {
    // 자기 자신을 먹여 +1 하면서 개수는 그대로인 증식도 이 검사 하나가 자연
    // 차단한다(§6-앞 11) — 재료=대상 동일 인스턴스는 언제나 착용 중이기 때문이다.
    expect(enhance(enhanceReady(), 'worn')).toEqual({ ok: false, code: 'material_equipped' })
  })

  it('같은 itemId 를 착용하고 있지 않으면 no_target 이다', () => {
    // 예비 철 곡괭이를 재료로 지목하지만 착용 중인 것은 구리 곡괭이다 — 다른
    // itemId 로의 강화는 규칙 밖이다(§5).
    expect(enhance(player({ stacks: { ...RICH_STACKS }, gold: 1_000_000 }), 'spare-iron')).toEqual({
      ok: false,
      code: 'no_target',
    })
  })

  it('도구가 아닌 인스턴스는 not_a_tool 이다 — 티어가 없으면 어느 사다리를 탈지 정할 수 없다', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'copper_ore', enhanceLevel: 0 },
        { instanceId: 'spare', itemId: 'copper_ore', enhanceLevel: 0 },
      ],
      equipped: { mineral: 'worn' },
    })
    expect(enhance(p, 'spare')).toEqual({ ok: false, code: 'not_a_tool' })
  })

  it('대상이 상한(+5)이면 enhance_cap 으로 거부하고 재료도 골드도 소모하지 않는다', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 5 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      ],
    })
    expect(enhance(p, 'spare')).toEqual({ ok: false, code: 'enhance_cap' })
    expect(p.instances).toHaveLength(2)
    expect(p.stacks['hard_log']).toBe(100)
    expect(p.gold).toBe(1_000_000)
  })

  it('행동 간격을 검사도 소비도 하지 않는다 — 정리 행위는 행동이 아니다(§6-앞 11)', () => {
    const p = enhanceReady({ nextActionAt: 8_000 })
    const r = enhance(p, 'spare')
    if (!r.ok) throw new Error('간격이 남아 있어도 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(8_000)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = enhanceReady()
    enhance(p, 'spare')
    expect(p.instances).toHaveLength(2)
    expect(p.instances[0]!.enhanceLevel).toBe(0)
    expect(p.stacks['hard_log']).toBe(100)
    expect(p.gold).toBe(1_000_000)
  })

  // ---- 원작 UL4: 계열 회전 + 골드 + 티어(§6-앞 11·12) ----

  it('원재료와 골드를 예비 도구와 **함께** 먹는다 — 강화는 중복 도구 하나로 끝나지 않는다', () => {
    const r = enhance(enhanceReady(), 'spare')
    if (!r.ok) throw new Error('성공해야 한다')
    // 1티어 +1 은 나무 계열의 2단 원재료 5개 + 5,000 골드다.
    expect(r.outcome.player.stacks['hard_log']).toBe(95)
    expect(r.outcome.player.gold).toBe(995_000)
    // 예비 도구도 여전히 사라진다 — 새 비용이 옛 규칙을 대체한 것이 아니라 위에 얹혔다.
    expect(r.outcome.player.instances.map((i) => i.instanceId)).toEqual(['worn'])
  })

  it('단계마다 다른 계열을 먹는다 — 한 도구가 나무→허브→얼음→광물을 차례로 요구한다(계열 회전)', () => {
    const rotation = [
      { from: 0, item: 'hard_log', count: 5 },
      { from: 1, item: 'lavender', count: 10 },
      { from: 2, item: 'pure_ice', count: 15 },
      { from: 3, item: 'iron_ore', count: 25 },
    ]
    for (const step of rotation) {
      const p = enhanceReady({
        instances: [
          { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: step.from },
          { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
        ],
      })
      const r = enhance(p, 'spare')
      if (!r.ok) throw new Error(`+${step.from + 1} 은 성공해야 한다`)
      expect(r.outcome.player.stacks[step.item]).toBe(100 - step.count)
    }
  })

  it('+5 는 네 계열을 한꺼번에 먹는다 — 원작이 UL4 에 심어 둔 "서로를 먹인다"의 마지막 칸', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 4 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      ],
    })
    const r = enhance(p, 'spare')
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks).toEqual({ hard_log: 90, lavender: 90, pure_ice: 90, iron_ore: 90 })
    expect(r.outcome.player.gold).toBe(960_000)
  })

  it('티어가 값을 정한다 — 2티어 +1 은 1티어 +1 의 ×4 다(§6-앞 12)', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'iron_pickaxe', enhanceLevel: 0 },
        { instanceId: 'spare', itemId: 'iron_pickaxe', enhanceLevel: 0 },
      ],
    })
    const r = enhance(p, 'spare')
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.stacks['hard_log']).toBe(80)
    expect(r.outcome.player.gold).toBe(980_000)
  })

  it('원재료가 모자라면 missing_enhance_materials 이고 아무것도 소모하지 않는다', () => {
    const p = enhanceReady({ stacks: { hard_log: 4 } })
    expect(enhance(p, 'spare')).toEqual({ ok: false, code: 'missing_enhance_materials' })
    expect(p.stacks['hard_log']).toBe(4)
    expect(p.gold).toBe(1_000_000)
    expect(p.instances).toHaveLength(2)
  })

  it('+5 는 네 계열 중 하나만 모자라도 거절된다 — 회전은 전부 채워야 넘어간다', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 4 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      ],
      stacks: { hard_log: 100, lavender: 100, pure_ice: 100, iron_ore: 9 },
    })
    expect(enhance(p, 'spare')).toEqual({ ok: false, code: 'missing_enhance_materials' })
  })

  it('골드가 모자라면 not_enough_gold 이고 재료도 예비 도구도 그대로다', () => {
    const p = enhanceReady({ gold: 4_999 })
    expect(enhance(p, 'spare')).toEqual({ ok: false, code: 'not_enough_gold' })
    expect(p.stacks['hard_log']).toBe(100)
    expect(p.instances).toHaveLength(2)
  })

  it('재료가 모자라면 골드가 모자란 것보다 먼저 말한다 — 판정 순서가 곧 안내의 순서다', () => {
    const p = enhanceReady({ stacks: { hard_log: 0 }, gold: 0 })
    expect(enhance(p, 'spare')).toEqual({ ok: false, code: 'missing_enhance_materials' })
  })

  it('요구량과 정확히 같으면 통과하고 스택 키가 사라진다 — "가진 적 없음"과 같은 모양(제작·거래의 관례)', () => {
    const p = enhanceReady({ stacks: { hard_log: 5 }, gold: 5_000 })
    const r = enhance(p, 'spare')
    if (!r.ok) throw new Error('딱 맞으면 성공해야 한다')
    expect(r.outcome.player.stacks).toEqual({})
    expect(r.outcome.player.gold).toBe(0)
  })
})
