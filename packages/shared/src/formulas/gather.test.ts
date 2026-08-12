import { describe, expect, it } from 'vitest'
import { testItem, testTool } from '../testing/items.js'
import type { ItemDef } from '../types.js'
import { toolMatchesSkill } from './gather.js'

const copperPickaxe: ItemDef = testTool('copper_pickaxe', 'mineral', 1, {
  name: '구리 곡괭이',
  icon: 'pickaxe_copper',
})

describe('toolMatchesSkill', () => {
  it('숙련 종류가 다르면 false 다', () => {
    const craftingHammer: ItemDef = { ...copperPickaxe, id: 'copper_hammer', toolSkill: 'crafting' }
    expect(toolMatchesSkill(craftingHammer, 'mineral')).toBe(false)
  })

  it('도구가 아닌 아이템이면 false 다', () => {
    const oreItem: ItemDef = testItem('copper_ore', { name: '구리 원석', icon: 'ore_copper', price: 80, skill: 'mineral' })
    expect(toolMatchesSkill(oreItem, 'mineral')).toBe(false)
  })

  it('숙련 종류가 같으면 true 다 — 등급은 보지 않는다(등급은 접근이 아니라 보정이다)', () => {
    expect(toolMatchesSkill(copperPickaxe, 'mineral')).toBe(true)
  })
})

// canGather 테스트는 함수와 함께 은퇴했다(설계 §2 — 맨손 채집 허용). 맨손의
// 페널티 숫자는 toolProfile.test.ts 가, 맨손 판정 경로는 gatherTable.test.ts 의
// "맨손(null)" 스위트가 증명한다.
