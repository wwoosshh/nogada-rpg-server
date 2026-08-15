import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { NODE_TIME_REQUIREMENTS, NODE_VARIANTS } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'

describe('parseCsv', () => {
  it('헤더를 키로 하는 객체 배열을 만든다', () => {
    expect(parseCsv('a,b\n1,2\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('빈 줄을 무시한다', () => {
    expect(parseCsv('a\n1\n\n2\n')).toEqual([{ a: '1' }, { a: '2' }])
  })

  it('빈 칸은 빈 문자열이 된다', () => {
    expect(parseCsv('a,b\n1,')).toEqual([{ a: '1', b: '' }])
  })

  it('헤더보다 칸이 많은 행을 거부한다', () => {
    expect(() => parseCsv('a,b\n1,2,3')).toThrow(
      '2행: 칸 개수가 헤더와 다르다 (헤더 2개, 이 행 3개)',
    )
  })

  it('헤더보다 칸이 적은 행을 거부한다', () => {
    expect(() => parseCsv('a,b\n1')).toThrow(
      '2행: 칸 개수가 헤더와 다르다 (헤더 2개, 이 행 1개)',
    )
  })
})

describe('parseItems', () => {
  /** 출하 items.csv 와 같은 칸을 가진 한 행. 그 테스트가 보는 칸만 덮어쓴다. */
  function itemRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_ore', name: '구리 원석', kind: 'material', toolSkill: '', toolTier: '',
      icon: 'ore_copper', price: '80', skill: 'mineral', ...overrides,
    }
  }

  it('재료는 도구 필드가 없다', () => {
    const items = parseItems([itemRow()])
    expect(items.copper_ore).toEqual({
      id: 'copper_ore',
      name: '구리 원석',
      kind: 'material',
      icon: 'ore_copper',
      price: 80,
      skill: 'mineral',
    })
  })

  it('도구는 숙련 종류와 등급을 갖는다', () => {
    const items = parseItems([
      itemRow({
        id: 'iron_pickaxe', name: '철 곡괭이', kind: 'tool', toolSkill: 'mineral', toolTier: '2',
        icon: 'pickaxe_iron', price: '0', skill: '',
      }),
    ])
    expect(items.iron_pickaxe).toEqual({
      id: 'iron_pickaxe',
      name: '철 곡괭이',
      kind: 'tool',
      toolSkill: 'mineral',
      toolTier: 2,
      icon: 'pickaxe_iron',
      price: 0,
    })
  })

  it('price 0 을 받아들인다 — 도구 13종이 그 값이고 "팔 수 없다"는 뜻이다', () => {
    const items = parseItems([itemRow({ price: '0' })])
    expect(items.copper_ore?.price).toBe(0)
  })

  it('price 가 비어 있으면 거부한다 — "0원"과 "안 적음"이 뭉치면 죽은 아이템 검사가 무의미해진다', () => {
    expect(() => parseItems([itemRow({ price: '' })])).toThrow(
      'items.csv[copper_ore]: 필수 항목 "price" 가 비어 있다',
    )
  })

  it('price 가 음수면 거부한다 — 팔면 돈을 내는 물건은 없다', () => {
    expect(() => parseItems([itemRow({ price: '-1' })])).toThrow(
      'items.csv[copper_ore]: price "-1" 는 0 이상이어야 한다',
    )
  })

  it('skill 칸이 비어 있으면 계열이 없다 — 도구가 그렇다', () => {
    const items = parseItems([itemRow({ skill: '' })])
    expect(items.copper_ore).not.toHaveProperty('skill')
  })

  it('알 수 없는 skill 값을 거부한다 — 오타는 어느 상점도 사 주지 않는 물건을 만든다', () => {
    expect(() => parseItems([itemRow({ skill: 'minning' })])).toThrow(
      'items.csv[copper_ore]: skill "minning" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting, combat)',
    )
  })

  it('skill=combat 을 받아들인다 — 전투 드랍의 계열이고, 사냥상점이 이 값으로 사 준다(아크 E §4)', () => {
    const items = parseItems([itemRow({ id: 'wolf_fang', name: '늑대 송곳니', icon: 'wolf_fang', price: '30', skill: 'combat' })])
    expect(items.wolf_fang?.skill).toBe('combat')
  })

  it('skill=armor 는 거부한다 — 계열의 값 공간은 SkillId ∨ combat 이지 EquipSlot 이 아니다', () => {
    // toEquipSlot 을 재사용했으면 통과했을 값이다 — "armor 계열 상점" 같은
    // 존재하지 않는 개념이 데이터에 적히는 길이라 변환기를 따로 세웠다.
    expect(() => parseItems([itemRow({ skill: 'armor' })])).toThrow(
      'items.csv[copper_ore]: skill "armor" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting, combat)',
    )
  })

  it('tokenEffect 칸이 비어 있으면 증표가 아니다 — 재료 대부분이 그렇다', () => {
    const items = parseItems([itemRow({ tokenEffect: '' })])
    expect(items.copper_ore).not.toHaveProperty('tokenEffect')
  })

  it('tokenEffect 칸이 아예 없는 CSV 도 읽는다 — 이 칸이 생기기 전의 행이 그대로 살아 있어야 한다', () => {
    const row = itemRow()
    expect('tokenEffect' in row).toBe(false)
    expect(parseItems([row]).copper_ore).not.toHaveProperty('tokenEffect')
  })

  it('증표는 tokenEffect 를 싣는다 — 새 kind 를 만들지 않는 것이 요점이다', () => {
    // kind 는 여전히 material 이다(§6-앞 11): kind='token' 이면 가방 패널의
    // `kind !== 'material'` 가드가 48만 골드짜리 물건을 조용히 숨긴다.
    const items = parseItems([
      itemRow({ id: 'ice_speed_token', name: '얼음 속도증표', icon: 'feather_ice', price: '480000', skill: 'ice', tokenEffect: 'speed' }),
    ])
    expect(items.ice_speed_token).toEqual({
      id: 'ice_speed_token', name: '얼음 속도증표', kind: 'material', icon: 'feather_ice', price: 480000,
      skill: 'ice', tokenEffect: 'speed',
    })
  })

  it('알 수 없는 tokenEffect 값을 거부한다 — 효과 없는 수십만 골드짜리 물건이 된다', () => {
    expect(() => parseItems([itemRow({ tokenEffect: 'fast' })])).toThrow(
      'items.csv[copper_ore]: tokenEffect "fast" 는 알 수 없다 (허용값: speed, sight)',
    )
  })

  it('useEffect·useValue 가 비어 있으면 쓸 수 없는 물건이다 — 재료 대부분이 그렇다', () => {
    const items = parseItems([itemRow({ useEffect: '', useValue: '' })])
    expect(items.copper_ore).not.toHaveProperty('useEffect')
  })

  it('두 칸이 아예 없는 CSV 도 읽는다 — 이 칸이 생기기 전의 행이 그대로 살아 있어야 한다', () => {
    const row = itemRow()
    expect('useEffect' in row).toBe(false)
    expect(parseItems([row]).copper_ore).not.toHaveProperty('useEffect')
  })

  it('날씨 가루는 사용 효과를 싣는다 — 지속은 게임 분이고 종류는 효과 이름이 정한다', () => {
    const items = parseItems([
      itemRow({ id: 'rain_powder', name: '비 가루', icon: 'cloud_rain', price: '100', skill: 'ice', useEffect: 'rain', useValue: '60' }),
    ])
    expect(items.rain_powder?.useEffect).toEqual({ kind: 'weather', weather: 'rain', minutes: 60 })
  })

  it('useEffect 만 적으면 거부한다 — 얼마나 가는지 모르는 가루가 된다', () => {
    expect(() => parseItems([itemRow({ useEffect: 'rain', useValue: '' })])).toThrow(
      'items.csv[copper_ore]: useEffect 와 useValue 는 함께 적거나 함께 비워야 한다 (지금 useEffect="rain", useValue="")',
    )
  })

  it('useValue 만 적으면 거부한다 — 무엇을 하는지 모르는 숫자가 된다', () => {
    expect(() => parseItems([itemRow({ useEffect: '', useValue: '60' })])).toThrow(
      'items.csv[copper_ore]: useEffect 와 useValue 는 함께 적거나 함께 비워야 한다 (지금 useEffect="", useValue="60")',
    )
  })

  it('알 수 없는 useEffect 값을 거부한다 — 써도 아무 일도 안 일어나는 소모품이 된다', () => {
    expect(() => parseItems([itemRow({ useEffect: 'storm', useValue: '60' })])).toThrow(
      'items.csv[copper_ore].useEffect: 날씨 "storm" 는 알 수 없다 (허용값: rain, snow)',
    )
  })

  it('지속이 0 이하면 거부한다 — 쓰는 순간 이미 그친 가루다', () => {
    expect(() => parseItems([itemRow({ useEffect: 'rain', useValue: '0' })])).toThrow(
      'items.csv[copper_ore]: useValue "0" 는 1 이상이어야 한다',
    )
  })

  it('알 수 없는 toolSkill 값을 거부한다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'iron_pickaxe', kind: 'tool', toolSkill: 'minig', toolTier: '2', skill: '' })]),
    ).toThrow('items.csv[iron_pickaxe]: toolSkill "minig" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting, combat, armor)')
  })

  it('toolSkill=combat 행을 받아들인다 — 무기는 여섯째 슬롯이지 여섯째 기술이 아니다(전투 §12-앞 8)', () => {
    const items = parseItems([
      itemRow({
        id: 'copper_sword', name: '구리 검', kind: 'tool', toolSkill: 'combat', toolTier: '1',
        damage: '5', icon: 'sword_copper', price: '0', skill: '',
      }),
    ])
    expect(items.copper_sword).toEqual({
      id: 'copper_sword', name: '구리 검', kind: 'tool', toolSkill: 'combat', toolTier: 1,
      damage: 5, icon: 'sword_copper', price: 0,
    })
  })

  it('combat 도구인데 damage 가 없으면 거부한다 — 회당 피해는 무기가 지는 축이라(전투 §4) 빠지면 아무리 때려도 닳지 않는 검이 된다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'copper_sword', kind: 'tool', toolSkill: 'combat', toolTier: '1', skill: '' })]),
    ).toThrow('items.csv[copper_sword]: 필수 항목 "damage" 가 비어 있다')
  })

  it('damage 가 0 이하이면 거부한다 — 0 피해 무기는 맨손 상수보다도 못한 함정 데이터다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'copper_sword', kind: 'tool', toolSkill: 'combat', toolTier: '1', damage: '0', skill: '' })]),
    ).toThrow('items.csv[copper_sword]: damage "0" 는 1 이상이어야 한다')
  })

  it('채집 도구에 damage 가 적히면 거부한다 — 피해 축은 무기만 산다, 곡괭이의 damage 는 어느 판정도 읽지 않는 숫자로 조용히 실린다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'iron_pickaxe', kind: 'tool', toolSkill: 'mineral', toolTier: '2', damage: '3', skill: '' })]),
    ).toThrow('items.csv[iron_pickaxe]: damage 는 combat 도구만 가진다')
  })

  it('재료에 damage 가 적히면 거부한다 — 채집 도구를 막는 것과 같은 이유다', () => {
    expect(() => parseItems([itemRow({ damage: '3' })])).toThrow(
      'items.csv[copper_ore]: damage 는 combat 도구만 가진다',
    )
  })

  it('toolSkill=armor 행을 받아들인다 — 방어구는 일곱째 슬롯이다(아크 E §1, toEquipSlot 이 EQUIP_SLOTS 를 읽는다)', () => {
    const items = parseItems([
      itemRow({
        id: 'wolf_hide_armor', name: '늑대 가죽옷', kind: 'tool', toolSkill: 'armor', toolTier: '1',
        defense: '5', icon: 'wolf_hide_armor', price: '0', skill: '',
      }),
    ])
    expect(items.wolf_hide_armor).toEqual({
      id: 'wolf_hide_armor', name: '늑대 가죽옷', kind: 'tool', toolSkill: 'armor', toolTier: 1,
      defense: 5, icon: 'wolf_hide_armor', price: 0,
    })
  })

  it('armor 도구인데 defense 가 없으면 거부한다 — 경감은 방어구가 지는 축이라(아크 E §1) 빠지면 아무것도 막지 않는 옷이 된다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'wolf_hide_armor', kind: 'tool', toolSkill: 'armor', toolTier: '1', skill: '' })]),
    ).toThrow('items.csv[wolf_hide_armor]: 필수 항목 "defense" 가 비어 있다')
  })

  it('defense 가 0 이하이면 거부한다 — 0 경감 방어구는 슬롯만 차지하는 함정 데이터다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'wolf_hide_armor', kind: 'tool', toolSkill: 'armor', toolTier: '1', defense: '0', skill: '' })]),
    ).toThrow('items.csv[wolf_hide_armor]: defense "0" 는 1 이상이어야 한다')
  })

  it('채집 도구에 defense 가 적히면 거부한다 — 경감 축은 방어구만 산다, damage⟺combat 의 그 대칭이다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'iron_pickaxe', kind: 'tool', toolSkill: 'mineral', toolTier: '2', defense: '3', skill: '' })]),
    ).toThrow('items.csv[iron_pickaxe]: defense 는 armor 도구만 가진다')
  })

  it('무기에 defense 가 적히면 거부한다 — 검이 경감까지 사면 한 칸이 두 축을 산다(§2-2의 그 금지)', () => {
    expect(() =>
      parseItems([itemRow({ id: 'copper_sword', kind: 'tool', toolSkill: 'combat', toolTier: '1', damage: '5', defense: '3', skill: '' })]),
    ).toThrow('items.csv[copper_sword]: defense 는 armor 도구만 가진다')
  })

  it('재료에 defense 가 적히면 거부한다 — 채집 도구를 막는 것과 같은 이유다', () => {
    expect(() => parseItems([itemRow({ defense: '3' })])).toThrow(
      'items.csv[copper_ore]: defense 는 armor 도구만 가진다',
    )
  })

  it('방어구에 damage 가 적히면 거부한다 — 대칭의 반대 방향: 옷은 때리는 축을 살 수 없다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'wolf_hide_armor', kind: 'tool', toolSkill: 'armor', toolTier: '1', defense: '5', damage: '3', skill: '' })]),
    ).toThrow('items.csv[wolf_hide_armor]: damage 는 combat 도구만 가진다')
  })

  it('defense 칸이 아예 없는 CSV 도 읽는다 — 이 칸이 생기기 전의 행이 그대로 살아 있어야 한다', () => {
    const row = itemRow({ id: 'iron_pickaxe', kind: 'tool', toolSkill: 'mineral', toolTier: '2', skill: '' })
    expect('defense' in row).toBe(false)
    expect(parseItems([row]).iron_pickaxe).not.toHaveProperty('defense')
  })

  it('damage 칸이 아예 없는 CSV 도 읽는다 — 이 칸이 생기기 전의 행이 그대로 살아 있어야 한다', () => {
    const row = itemRow({ id: 'iron_pickaxe', kind: 'tool', toolSkill: 'mineral', toolTier: '2', skill: '' })
    expect('damage' in row).toBe(false)
    expect(parseItems([row]).iron_pickaxe).not.toHaveProperty('damage')
  })

  it('toolTier 가 0 이하이면 거부한다', () => {
    expect(() =>
      parseItems([itemRow({ id: 'iron_pickaxe', kind: 'tool', toolSkill: 'mineral', toolTier: '0', skill: '' })]),
    ).toThrow('items.csv[iron_pickaxe]: toolTier "0" 는 1 이상이어야 한다')
  })

  it('중복된 id 를 거부한다', () => {
    const row = itemRow()
    expect(() => parseItems([row, row])).toThrow('items.csv: 중복된 id "copper_ore"')
  })

  it('정수형 id 를 거부한다 — Record 키 순서가 JSON 왕복에서 깨진다', () => {
    expect(() => parseItems([itemRow({ id: '2' })])).toThrow(
      'items.csv[2]: id "2" 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다',
    )
  })
})

describe('parseNodes', () => {
  function validNodeRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal',
      sprite: 'copper_vein',
      ...overrides,
    }
  }

  it('표를 가리키는 노드를 파싱한다 — 산출물·수량·확률은 노드가 아니라 표의 것이다', () => {
    const nodes = parseNodes([validNodeRow()])
    expect(nodes.copper_vein).toEqual({
      id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tableId: 'mineral', variant: 'normal',
      sprite: 'copper_vein',
    })
  })

  // 값을 일부러 id 와 다르게 준다 — 이 칸이 id 에서 유도되는 것이 아니라 작가가
  // 적은 이름을 그대로 실어 나른다는 것이, 출하 데이터(8행 모두 sprite = id)만
  // 봐서는 구별되지 않기 때문이다. 언젠가 두 노드가 한 그림을 나눠 쓰면 그 차이가 산다.
  it('sprite 는 id 에서 유도하지 않고 적힌 이름을 그대로 싣는다', () => {
    const nodes = parseNodes([validNodeRow({ sprite: 'old_tree' })])
    expect(nodes.copper_vein!.sprite).toBe('old_tree')
  })

  // 그림 없는 노드를 통과시키면 그 노드만 맵에서 색칠한 네모로 남는데, 화면만
  // 봐서는 "아직 안 그린 것"과 구별되지 않아 오래 산다 — 이 아크가 없애려는 바로 그 상태다.
  it('sprite 가 비어 있으면 거부한다 — 얼굴 없는 노드가 조용히 네모로 남으면 안 된다', () => {
    expect(() => parseNodes([validNodeRow({ sprite: '' })])).toThrow(
      'nodes.csv[copper_vein]: 필수 항목 "sprite" 가 비어 있다',
    )
  })

  it('알 수 없는 skill 값을 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ skill: 'minig' })])).toThrow(
      'nodes.csv[copper_vein]: skill "minig" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)',
    )
  })

  it('알 수 없는 variant 값을 거부한다 — 표 접미사와 짝지어 판정에 쓰이므로 오타가 통과하면 안 된다', () => {
    expect(() => parseNodes([validNodeRow({ variant: 'depe' })])).toThrow(
      'nodes.csv[copper_vein]: variant "depe" 는 알 수 없다 (허용값: normal, deep, special)',
    )
  })

  // 허용 목록을 `NODE_VARIANTS` 에서 유도하는 이유를 여기서 문다: 등급이 늘어나는
  // 날 이 목록을 손으로 안 고쳐도 파서가 그 등급을 받아야 한다. 손으로 적혀
  // 있으면 타입은 통과하고 CSV 만 영원히 거절당하는데, 그 갈라짐은 아무도 안 짖는다.
  it('등급 전수가 파싱을 통과한다 — 타입에 있는 등급이 CSV 에서 거절당하면 안 된다', () => {
    for (const variant of NODE_VARIANTS) {
      expect(parseNodes([validNodeRow({ variant })]).copper_vein!.variant).toBe(variant)
    }
  })

  it('tableId 가 비어 있으면 거부한다 — 표 없는 노드는 아무것도 내놓지 못한다', () => {
    expect(() => parseNodes([validNodeRow({ tableId: '' })])).toThrow(
      'nodes.csv[copper_vein]: 필수 항목 "tableId" 가 비어 있다',
    )
  })

  it('중복된 id 를 거부한다', () => {
    expect(() => parseNodes([validNodeRow(), validNodeRow()])).toThrow(
      'nodes.csv: 중복된 id "copper_vein"',
    )
  })

  // 왜 빈 칸이 `undefined` 여야 하는가: 조건 없는 노드에 "요구가 없는 요구"를
  // 지어 주면 술어가 게이트를 돌려주게 되고, 그때부터 화면은 보통 얼음 광맥
  // 앞에서도 조건 문구를 조립할 수 있다(nodeAvailable 의 null 과 한 짝이다).
  it('조건 칸이 비면 두 칸 다 아예 없다 — 출하 8행이 그 모양이다', () => {
    const node = parseNodes([validNodeRow({ requireWeather: '', requireTime: '' })]).copper_vein!
    expect('requireWeather' in node).toBe(false)
    expect('requireTime' in node).toBe(false)
  })

  it('requireWeather 를 읽는다', () => {
    expect(parseNodes([validNodeRow({ requireWeather: 'snow' })]).copper_vein!.requireWeather).toBe('snow')
  })

  it('requireTime 을 읽는다', () => {
    expect(parseNodes([validNodeRow({ requireTime: 'tide' })]).copper_vein!.requireTime).toBe('tide')
  })

  // 왜 오타를 세게 막는가: 조건은 **닫히는** 쪽이 기본이 아니다 — 모르는 값을
  // 조용히 무시하면 그 노드는 아무 조건 없이 늘 열린 채로 서고, 화면에도 로그에도
  // 흔적이 없다. "눈이 올 때만"이 사실은 언제나였다는 것을 알아채는 방법이 없다.
  it('알 수 없는 requireWeather 값을 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ requireWeather: 'snowy' })])).toThrow(
      'nodes.csv[copper_vein].requireWeather: 날씨 "snowy" 는 알 수 없다 (허용값: rain, snow)',
    )
  })

  it('알 수 없는 requireTime 값을 거부한다', () => {
    expect(() => parseNodes([validNodeRow({ requireTime: 'nite' })])).toThrow(
      'nodes.csv[copper_vein]: requireTime "nite" 는 알 수 없다 (허용값: night, tide)',
    )
  })

  // 왜: 시각 조건의 허용값도 variant 와 같은 이유로 타입에서 유도한다 — 조건이
  // 하나 늘어나는 날 이 줄을 잊으면 타입에는 있는 조건이 CSV 에서만 영원히
  // 거절당하고, 작가는 오타를 의심하며 자기 CSV 만 들여다본다.
  it('시각 조건 전수가 파싱을 통과한다', () => {
    for (const need of NODE_TIME_REQUIREMENTS) {
      expect(parseNodes([validNodeRow({ requireTime: need })]).copper_vein!.requireTime).toBe(need)
    }
  })
})

/**
 * 위 스위트는 손으로 지은 행을 본다 — 새 필수 칸이 생겼을 때 정작 **출하되는
 * CSV** 가 그것을 갖췄는지는 거기서 드러나지 않는다. 한 행만 비어도 그 노드는
 * 맵에서 얼굴 없이 서고, 그 사실은 빌드가 아니라 게임을 켠 사람이 먼저 본다.
 */
describe('parseNodes — 출하 데이터', () => {
  it('출하 nodes.csv 열두 행이 전부 자기 그림 이름을 싣는다', () => {
    const csvDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'csv')
    const nodes = parseNodes(parseCsv(readFileSync(join(csvDir, 'nodes.csv'), 'utf8')))

    // 값을 여기 그대로 적는다(집합 대조가 아니라 전수 고정) — 이 표가 곧 A3 의
    // 클라이언트 매니페스트·CREDITS 대장 표와 대조될 셋 중 하나이고, 셋 중
    // 하나가 조용히 바뀌는 것이 이 아크가 가장 두려워하는 사고다.
    const sprites = Object.fromEntries(Object.values(nodes).map((n) => [n.id, n.sprite]))
    expect(sprites).toEqual({
      ice_vein: 'ice_vein',
      deep_ice_vein: 'deep_ice_vein',
      red_ice_vein: 'red_ice_vein',
      thunderstruck_tree: 'thunderstruck_tree',
      meteor_vein: 'meteor_vein',
      frostbloom_patch: 'frostbloom_patch',
      young_tree: 'young_tree',
      old_tree: 'old_tree',
      copper_vein: 'copper_vein',
      iron_vein: 'iron_vein',
      herb_patch: 'herb_patch',
      rare_herb_patch: 'rare_herb_patch',
    })
  })

  // 왜: 이 태스크는 조건이라는 **자리**만 낸다. 출하된 보통·심층 여덟 노드 중 하나라도
  //     조건을 지면 그 순간 기존 채집이 달라지는데(그 노드가 하루의 일부만
  //     열린다), 그 변화는 게임을 켜 그 시간대에 서 봐야만 보인다. 여기서
  //     한 줄로 못박아 두면 조건을 실수로 얻은 행이 빌드에서 빨개진다.
  // 조건을 지는 것은 **특수 노드뿐**이다. 보통·심층 여덟이 하나라도 조건을 얻으면
  // 이 아크가 "기존 채집을 안 바꾼다"고 한 약속이 깨진 것이라, 목록을 전수로 고정한다.
  it('조건을 지는 노드는 특수뿐이고, 그 조건이 무엇인지까지 고정한다', () => {
    const csvDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'csv')
    const nodes = parseNodes(parseCsv(readFileSync(join(csvDir, 'nodes.csv'), 'utf8')))

    const conditioned = Object.fromEntries(
      Object.values(nodes)
        .filter((n) => n.requireWeather !== undefined || n.requireTime !== undefined)
        .map((n) => [n.id, { weather: n.requireWeather, time: n.requireTime, variant: n.variant }]),
    )
    expect(conditioned).toEqual({
      red_ice_vein: { weather: 'snow', time: undefined, variant: 'special' },
      thunderstruck_tree: { weather: 'rain', time: undefined, variant: 'special' },
      meteor_vein: { weather: undefined, time: 'night', variant: 'special' },
      frostbloom_patch: { weather: undefined, time: 'tide', variant: 'special' },
    })
  })
})

describe('parseRecipes', () => {
  it('재료 하나를 파싱한다', () => {
    const recipes = parseRecipes([
      {
        id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: '1', baseChance: '0.6',
        inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        skillGainMin: '10', skillGainMax: '20',
      },
    ])
    expect(recipes.copper_ingot!.inputs).toEqual([{ item: 'copper_ore', count: 2 }])
    expect(recipes.copper_ingot!.output).toEqual({ item: 'copper_ingot', count: 1 })
    expect(recipes.copper_ingot!.category).toBe('제련')
  })

  it('파이프로 구분된 여러 재료를 파싱한다', () => {
    const recipes = parseRecipes([
      {
        id: 'reinforced_plate', name: '강화 판금', category: '도구', skill: 'crafting', requiredSkill: '18', baseChance: '0.5',
        inputs: 'copper_ingot:1|iron_ingot:1', outputItem: 'reinforced_plate', outputCount: '1',
        skillGainMin: '10', skillGainMax: '20',
      },
    ])
    expect(recipes.reinforced_plate!.inputs).toEqual([
      { item: 'copper_ingot', count: 1 },
      { item: 'iron_ingot', count: 1 },
    ])
  })

  it('알 수 없는 skill 값을 거부한다', () => {
    expect(() =>
      parseRecipes([
        {
          id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'smithng', requiredSkill: '1', baseChance: '0.6',
          inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        },
      ]),
    ).toThrow('recipes.csv[copper_ingot]: skill "smithng" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)')
  })

  function validRecipeRow(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: '1', baseChance: '0.6',
      inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
      skillGainMin: '10', skillGainMax: '20',
      ...overrides,
    }
  }

  it('category 칸이 없으면 거부한다', () => {
    const row = validRecipeRow()
    delete row.category
    expect(() => parseRecipes([row])).toThrow('recipes.csv[copper_ingot]: 필수 항목 "category" 가 비어 있다')
  })

  it('공백만 있는 category 셀을 거부한다 — trim 후에도 비어 있으면 안 된다', () => {
    expect(() => parseRecipes([validRecipeRow({ category: ' ' })])).toThrow(
      'recipes.csv[copper_ingot]: category 가 공백뿐이다 — 분류 이름을 채워야 한다',
    )
  })

  it('정수형 id 를 거부한다 — Record 키 순서가 JSON 왕복에서 깨진다', () => {
    expect(() => parseRecipes([validRecipeRow({ id: '2' })])).toThrow(
      'recipes.csv[2]: id "2" 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다',
    )
  })

  it('requiredSkill 은 0 을 허용한다', () => {
    const recipes = parseRecipes([
      {
        id: 'copper_ingot', name: '구리 주괴', category: '제련', skill: 'crafting', requiredSkill: '0',
        baseChance: '0.6', inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
        skillGainMin: '10', skillGainMax: '20',
      },
    ])
    expect(recipes.copper_ingot!.requiredSkill).toBe(0)
  })

  it('outputCount 가 0 이하이면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ outputCount: '0' })])).toThrow(
      'recipes.csv[copper_ingot]: outputCount "0" 는 1 이상이어야 한다',
    )
  })

  it('재료 개수가 0 이하이면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ inputs: 'copper_ore:0' })])).toThrow(
      'recipes.csv[copper_ingot]: inputs(copper_ore) "0" 는 1 이상이어야 한다',
    )
  })

  it('중복된 id 를 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow(), validRecipeRow()])).toThrow(
      'recipes.csv: 중복된 id "copper_ingot"',
    )
  })

  // 왜: 문턱 칸 한 쌍은 "그 계열을 얼마나 캐 봤는가"를 묻는 두 번째 문이다
  //     (§6-앞 9) — 비워 두면 지금까지처럼 조합 하나만이 문이다.
  it('gateSkill·gateValue 가 비어 있으면 계열 문턱이 없다', () => {
    const recipe = parseRecipes([validRecipeRow({ gateSkill: '', gateValue: '' })]).copper_ingot!
    expect(recipe.gateSkill).toBeUndefined()
    expect(recipe.gateValue).toBeUndefined()
  })

  it('gateSkill·gateValue 를 함께 적으면 계열 문턱이 실린다', () => {
    const recipe = parseRecipes([validRecipeRow({ gateSkill: 'ice', gateValue: '1000' })]).copper_ingot!
    expect(recipe.gateSkill).toBe('ice')
    expect(recipe.gateValue).toBe(1000)
  })

  // 왜: 한쪽만 적힌 행을 통과시키면 저자는 문턱을 걸었다고 믿는데 게임에는
  //     문이 없거나(값 없음) 무엇의 숫자인지 모르는 문이 선다(기술 없음).
  it('gateSkill 만 적으면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ gateSkill: 'ice', gateValue: '' })])).toThrow(
      'recipes.csv[copper_ingot]: gateSkill 과 gateValue 는 함께 적거나 함께 비워야 한다 (지금 gateSkill="ice", gateValue="")',
    )
  })

  it('gateValue 만 적으면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ gateSkill: '', gateValue: '1000' })])).toThrow(
      'recipes.csv[copper_ingot]: gateSkill 과 gateValue 는 함께 적거나 함께 비워야 한다 (지금 gateSkill="", gateValue="1000")',
    )
  })

  it('알 수 없는 gateSkill 을 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ gateSkill: 'icce', gateValue: '1000' })])).toThrow(
      'recipes.csv[copper_ingot].gateSkill: skill "icce" 는 알 수 없다 (허용값: ice, wood, mineral, herb, crafting)',
    )
  })

  // 왜: 조합은 이미 requiredSkill 이 지키는 문이다 — gateSkill=crafting 은 같은
  //     숙련을 두 숫자로 재는 문이 되어 화면이 어느 쪽을 말할지 정할 수 없다.
  it('gateSkill 이 crafting 이면 거부한다 — 문턱은 채집 계열의 것이다', () => {
    expect(() => parseRecipes([validRecipeRow({ gateSkill: 'crafting', gateValue: '1000' })])).toThrow(
      'recipes.csv[copper_ingot]: gateSkill 은 채집 계열이어야 한다 — 조합 숙련도는 이미 requiredSkill 이 지키는 문이다',
    )
  })

  it('gateValue 가 0 이하이면 거부한다', () => {
    expect(() => parseRecipes([validRecipeRow({ gateSkill: 'ice', gateValue: '0' })])).toThrow(
      'recipes.csv[copper_ingot]: gateValue "0" 는 1 이상이어야 한다',
    )
  })
})
