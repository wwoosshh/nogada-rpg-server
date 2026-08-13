import { emptyPlayer, loadGameData } from '@nogada/data'
import { ENHANCE_CAP, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { enhanceRequirementFor } from './enhanceCostModel.js'

/*
 * 강화 요구 모델 — 가방(BagPanel)이 [강화] 옆에 적을 순수 데이터를 만든다.
 *
 * 출하 데이터를 그대로 쓴다. 요구량은 표(enhance_costs.csv)가 소유하므로
 * 지어낸 표로 검사하면 "화면이 표를 왜곡 없이 옮기는가"라는 이 파일의 물음이
 * 정작 출하 표에는 닿지 않는다.
 */
const data = loadGameData()

/** 착용 곡괭이 + 예비 곡괭이 한 벌. `level` 은 착용분의 현재 강화 수치다. */
function withPickaxes(level: number, overrides: Partial<PlayerState> = {}): PlayerState {
  const p = emptyPlayer()
  return {
    ...p,
    instances: [
      { instanceId: 'worn', itemId: 'copper_pickaxe', enhanceLevel: level },
      { instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 },
    ],
    equipped: { mineral: 'worn' },
    ...overrides,
  }
}

describe('enhanceRequirementFor', () => {
  it('다음 단계가 무엇을 얼마나 요구하는지 말한다 — 이름과 have/need 와 골드', () => {
    const req = enhanceRequirementFor(data, withPickaxes(0), 'copper_pickaxe')
    expect(req).not.toBeNull()
    expect(req!.nextLevel).toBe(1)
    // 1티어 +1 은 나무 계열의 2단 원재료다(계열 회전, §6-앞 11).
    expect(req!.materials).toEqual([
      { item: 'hard_log', name: '단단한 통나무', have: 0, need: 5, ok: false },
    ])
    expect(req!.goldNeed).toBe(5_000)
    expect(req!.goldHave).toBe(0)
    expect(req!.goldOk).toBe(false)
    expect(req!.affordable).toBe(false)
  })

  it('가진 것이 요구를 채우면 affordable 이다 — [강화] 버튼이 그려지는 조건', () => {
    const p = withPickaxes(0, { stacks: { hard_log: 5 }, gold: 5_000 })
    const req = enhanceRequirementFor(data, p, 'copper_pickaxe')!
    expect(req.materials[0]).toEqual({ item: 'hard_log', name: '단단한 통나무', have: 5, need: 5, ok: true })
    expect(req.goldOk).toBe(true)
    expect(req.affordable).toBe(true)
  })

  it('재료는 넉넉한데 골드가 1 모자라면 affordable 이 아니다 — 서버가 not_enough_gold 로 거절할 자리다', () => {
    const p = withPickaxes(0, { stacks: { hard_log: 99 }, gold: 4_999 })
    const req = enhanceRequirementFor(data, p, 'copper_pickaxe')!
    expect(req.materials[0]!.ok).toBe(true)
    expect(req.goldOk).toBe(false)
    expect(req.affordable).toBe(false)
  })

  it('단계마다 다른 계열을 말한다 — 화면이 회전을 그대로 비춘다', () => {
    const lines = [1, 2, 3, 4].map((level) => {
      const req = enhanceRequirementFor(data, withPickaxes(level - 1), 'copper_pickaxe')!
      return req.materials.map((m) => m.item)
    })
    expect(lines).toEqual([['hard_log'], ['lavender'], ['pure_ice'], ['iron_ore']])
  })

  it('+5 는 네 줄을 말한다 — 네 계열을 한꺼번에 요구한다', () => {
    const req = enhanceRequirementFor(data, withPickaxes(4), 'copper_pickaxe')!
    expect(req.nextLevel).toBe(ENHANCE_CAP)
    expect(req.materials.map((m) => m.item)).toEqual(['hard_log', 'lavender', 'pure_ice', 'iron_ore'])
  })

  it('티어가 값을 정한다 — 같은 +1 이라도 2티어 도구는 ×4 다(§6-앞 12)', () => {
    const p = emptyPlayer()
    const iron: PlayerState = {
      ...p,
      instances: [
        { instanceId: 'worn', itemId: 'iron_pickaxe', enhanceLevel: 0 },
        { instanceId: 'spare', itemId: 'iron_pickaxe', enhanceLevel: 0 },
      ],
      equipped: { mineral: 'worn' },
    }
    const req = enhanceRequirementFor(data, iron, 'iron_pickaxe')!
    expect(req.materials[0]).toMatchObject({ item: 'hard_log', need: 20 })
    expect(req.goldNeed).toBe(20_000)
  })

  it('만강 도구는 null 이다 — 말할 다음 단계가 없다', () => {
    expect(enhanceRequirementFor(data, withPickaxes(ENHANCE_CAP), 'copper_pickaxe')).toBeNull()
  })

  it('같은 itemId 를 착용하고 있지 않으면 null 이다 — 대상이 없으면 요구도 없다(§5)', () => {
    const p = emptyPlayer()
    const noTarget: PlayerState = {
      ...p,
      instances: [{ instanceId: 'spare', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
      equipped: {},
    }
    expect(enhanceRequirementFor(data, noTarget, 'copper_pickaxe')).toBeNull()
  })
})
