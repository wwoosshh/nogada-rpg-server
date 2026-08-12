import { emptyDialogueHistory, type ItemDef, type PlayerState } from '@nogada/shared'
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
  copper_ore: testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' }),
  // kind=tool 인데 toolSkill 이 빠진 정의 — §6-앞 11 이 경고한 optional 함정.
  // 검증이 이런 행을 막지만, 서비스는 검증을 거치지 않은 데이터 앞에서도
  // equipped['undefined'] 유령 슬롯을 만들면 안 된다. **testTool 을 쓰지 않는 것이
  // 의도다** — 도구인데 toolSkill 이 없는 정의를 일부러 만드는 자리라, 정상 도구를
  // 만드는 길과 다르게 적어야 그 일부러가 눈에 띈다.
  skillless_tool: testItem('skillless_tool', { name: '기술 없는 도구', kind: 'tool', toolTier: 1, icon: 'tool_broken' }),
}

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
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
  /** 착용 구리 곡괭이 + 예비 구리 곡괭이 — 강화가 성립하는 기본 무대. */
  function enhanceReady(overrides: Partial<PlayerState> = {}): PlayerState {
    return player({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 0 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      ],
      ...overrides,
    })
  }

  it('예비를 소모해 같은 itemId 의 착용 인스턴스가 +1 된다 — 대상은 요청이 아니라 규칙이 정한다(§5)', () => {
    const r = performEnhance({ player: enhanceReady(), materialInstanceId: 'spare' })
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
    const r = performEnhance({ player: p, materialInstanceId: 'spare' })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.instances[0]!.enhanceLevel).toBe(4)
  })

  it('없는 인스턴스는 unknown_instance 로 거부한다', () => {
    const r = performEnhance({ player: enhanceReady(), materialInstanceId: 'ghost' })
    expect(r).toEqual({ ok: false, code: 'unknown_instance' })
  })

  it('착용 중인 인스턴스는 재료가 될 수 없다 — material_equipped', () => {
    // 자기 자신을 먹여 +1 하면서 개수는 그대로인 증식도 이 검사 하나가 자연
    // 차단한다(§6-앞 11) — 재료=대상 동일 인스턴스는 언제나 착용 중이기 때문이다.
    const r = performEnhance({ player: enhanceReady(), materialInstanceId: 'worn' })
    expect(r).toEqual({ ok: false, code: 'material_equipped' })
  })

  it('같은 itemId 를 착용하고 있지 않으면 no_target 이다', () => {
    // 예비 철 곡괭이를 재료로 지목하지만 착용 중인 것은 구리 곡괭이다 — 다른
    // itemId 로의 강화는 규칙 밖이다(§5).
    const r = performEnhance({ player: player(), materialInstanceId: 'spare-iron' })
    expect(r).toEqual({ ok: false, code: 'no_target' })
  })

  it('대상이 상한(+5)이면 enhance_cap 으로 거부하고 재료를 소모하지 않는다', () => {
    const p = enhanceReady({
      instances: [
        { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: 5 },
        { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
      ],
    })
    const r = performEnhance({ player: p, materialInstanceId: 'spare' })
    expect(r).toEqual({ ok: false, code: 'enhance_cap' })
    expect(p.instances).toHaveLength(2)
  })

  it('행동 간격을 검사도 소비도 하지 않는다 — 정리 행위는 행동이 아니다(§6-앞 11)', () => {
    const p = enhanceReady({ nextActionAt: 8_000 })
    const r = performEnhance({ player: p, materialInstanceId: 'spare' })
    if (!r.ok) throw new Error('간격이 남아 있어도 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(8_000)
  })

  it('입력 플레이어 객체를 변경하지 않는다', () => {
    const p = enhanceReady()
    performEnhance({ player: p, materialInstanceId: 'spare' })
    expect(p.instances).toHaveLength(2)
    expect(p.instances[0]!.enhanceLevel).toBe(0)
  })
})
