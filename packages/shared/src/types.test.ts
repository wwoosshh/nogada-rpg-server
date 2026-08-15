import { describe, expect, it } from 'vitest'
import { EQUIP_SLOTS, SKILL_LABELS, slotLabelOf } from './types.js'

describe('slotLabelOf — 슬롯 이름표의 유일한 소유자(아크 E §1)', () => {
  // 왜: BagPanel 의 `slot === 'combat' ? '전투' : SKILL_LABELS[slot]` 삼항은
  //     EquipSlot 이 늘 때마다 화면 쪽에서 컴파일이 깨지는 자리였다(armor 가
  //     그 함정을 밟았다). 라벨은 shared 한 곳이 소유하고, 다음 확장의 컴파일
  //     브레이크도 여기 한 곳에서만 난다.
  it('기술 슬롯은 SKILL_LABELS 그대로다', () => {
    expect(slotLabelOf('ice')).toBe(SKILL_LABELS.ice)
    expect(slotLabelOf('crafting')).toBe(SKILL_LABELS.crafting)
  })

  it('전투·방어 슬롯의 이름을 소유한다', () => {
    expect(slotLabelOf('combat')).toBe('전투')
    expect(slotLabelOf('armor')).toBe('방어')
  })

  it('EQUIP_SLOTS 는 7칸(기술 5 + 전투 + 방어)이고 전 칸이 이름을 갖는다', () => {
    expect(EQUIP_SLOTS).toHaveLength(7)
    expect(EQUIP_SLOTS).toContain('armor')
    for (const slot of EQUIP_SLOTS) expect(slotLabelOf(slot)).not.toBe('')
  })
})
