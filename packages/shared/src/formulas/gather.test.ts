import { describe, expect, it } from 'vitest'
import type { ItemDef } from '../types.js'
import { canGather, toolMatchesSkill } from './gather.js'

const copperPickaxe: ItemDef = {
  id: 'copper_pickaxe',
  name: '구리 곡괭이',
  kind: 'tool',
  toolSkill: 'mineral',
  toolTier: 1,
  icon: 'pickaxe_copper',
}

describe('toolMatchesSkill', () => {
  it('숙련 종류가 다르면 false 다', () => {
    const craftingHammer: ItemDef = { ...copperPickaxe, id: 'copper_hammer', toolSkill: 'crafting' }
    expect(toolMatchesSkill(craftingHammer, 'mineral')).toBe(false)
  })

  it('도구가 아닌 아이템이면 false 다', () => {
    const oreItem: ItemDef = { id: 'copper_ore', name: '구리 원석', kind: 'material', icon: 'ore_copper' }
    expect(toolMatchesSkill(oreItem, 'mineral')).toBe(false)
  })

  it('숙련 종류가 같으면 true 다 — 등급은 보지 않는다(등급은 접근이 아니라 보정이다)', () => {
    expect(toolMatchesSkill(copperPickaxe, 'mineral')).toBe(true)
  })
})

describe('canGather', () => {
  it('맨손(착용 등급 0)이면 채집할 수 없다 — tier 게이트가 사라진 뒤에도 남는 명시 조건이다(§7-앞 8)', () => {
    expect(canGather(0)).toBe(false)
  })

  it('그 기술의 도구를 착용했으면(등급 > 0) 채집할 수 있다', () => {
    expect(canGather(1)).toBe(true)
  })

  it('등급이 높아도 접근이 더 열리거나 닫히지 않는다 — 등급의 몫은 toolGatherFactor 뿐이다', () => {
    expect(canGather(3)).toBe(true)
  })
})
