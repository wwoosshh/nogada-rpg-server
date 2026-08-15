import { describe, expect, it } from 'vitest'
import { parseMonsters } from './monsters.js'

type Row = Record<string, string>

/**
 * 몬스터 다섯 CSV 파서 — **배치별 def 굽기**가 이 파서의 요점이다.
 *
 * MonsterDef.patrol 은 절대 좌표다(C1 의 순수함수 설계 — monsterStateAt 은
 * 지형도 원점도 모른다). 같은 종을 세 자리에 놓으려면 파서가 종 패턴(상대
 * 좌표)과 배치 원점에서 배치마다 def 를 구워야 하고, 그래서 monsterId 는
 * 종 id 가 아니라 instanceId 다. 여기 픽스처는 출하 CSV 의 들늑대를 줄인 것.
 */

const 종: Row[] = [{ id: 'wolf', name: '들늑대', periodMs: '10000' }]
const 순찰: Row[] = [
  { species: 'wolf', dx: '0', dy: '0', slots: '6' },
  { species: 'wolf', dx: '1', dy: '0', slots: '6' },
  { species: 'wolf', dx: '2', dy: '0', slots: '6' },
  { species: 'wolf', dx: '1', dy: '0', slots: '7' },
]
const 공격: Row[] = [
  { species: 'wolf', telegraphStartMs: '0', telegraphMs: '1800', activeMs: '400', direction: 'right', reach: '3' },
  { species: 'wolf', telegraphStartMs: '4800', telegraphMs: '1800', activeMs: '400', direction: 'left', reach: '3' },
]
const 배치: Row[] = [
  { instanceId: 'wolf-1', species: 'wolf', mapId: '사냥터', originX: '5', originY: '4', phaseOffsetMs: '0', maxHp: '8', sweepDamage: '20' },
  { instanceId: 'wolf-2', species: 'wolf', mapId: '사냥터', originX: '14', originY: '8', phaseOffsetMs: '3300', maxHp: '8', sweepDamage: '20' },
]
const 드랍: Row[] = [{ species: 'wolf', itemId: 'wolf_fang', chance: '0.5' }]

interface Sources {
  species: Row[]
  patrol: Row[]
  attacks: Row[]
  placements: Row[]
  drops: Row[]
}

function parse(over: Partial<Sources> = {}) {
  const src: Sources = { species: 종, patrol: 순찰, attacks: 공격, placements: 배치, drops: 드랍, ...over }
  return parseMonsters(src.species, src.patrol, src.attacks, src.placements, src.drops)
}

describe('parseMonsters — 배치별 def 굽기', () => {
  it('배치마다 def 를 굽는다 — 키도 monsterId 도 instanceId 다', () => {
    const { defs, placements } = parse()
    expect(Object.keys(defs).sort()).toEqual(['wolf-1', 'wolf-2'])
    expect(defs['wolf-1']!.id).toBe('wolf-1')
    expect(defs['wolf-1']!.name).toBe('들늑대')
    expect(defs['wolf-1']!.periodMs).toBe(10000)
    expect(placements['wolf-1']!.monsterId).toBe('wolf-1')
  })

  it('RLE 순찰을 슬롯으로 펴고 원점을 더한다 — 행 순서가 곧 슬롯 순서다', () => {
    const { defs } = parse()
    const patrol = defs['wolf-1']!.patrol
    // 6+6+6+7 = 25슬롯 = 주기 10,000ms ÷ 400ms.
    expect(patrol).toHaveLength(25)
    expect(patrol[0]).toEqual({ x: 5, y: 4 })
    expect(patrol[6]).toEqual({ x: 6, y: 4 })
    expect(patrol[12]).toEqual({ x: 7, y: 4 })
    expect(patrol[18]).toEqual({ x: 6, y: 4 })
    // 같은 종의 다른 배치는 같은 상대 패턴에 다른 원점이다.
    expect(parse().defs['wolf-2']!.patrol[12]).toEqual({ x: 16, y: 8 })
  })

  it('배치의 개체값과 위상이 그대로 실린다', () => {
    const { placements } = parse()
    expect(placements['wolf-2']).toEqual({
      instanceId: 'wolf-2', monsterId: 'wolf-2', mapId: '사냥터',
      phaseOffsetMs: 3300, maxHp: 8, sweepDamage: 20,
    })
  })

  it('드랍표는 종 표 하나를 배치 키마다 건다', () => {
    const { drops } = parse()
    expect(drops['wolf-1']).toEqual({ monsterId: 'wolf-1', drops: [{ itemId: 'wolf_fang', chance: 0.5 }] })
    expect(drops['wolf-2']).toEqual({ monsterId: 'wolf-2', drops: [{ itemId: 'wolf_fang', chance: 0.5 }] })
  })

  it('구운 def 끼리 공격 배열을 공유하지 않는다 — 한 배치를 고치면 다른 배치가 따라 움직이면 안 된다', () => {
    const { defs } = parse()
    expect(defs['wolf-1']!.attacks).not.toBe(defs['wolf-2']!.attacks)
    expect(defs['wolf-1']!.attacks[0]).not.toBe(defs['wolf-2']!.attacks[0])
  })
})

describe('parseMonsters — 거절하는 것들', () => {
  it('없는 종을 가리키는 순찰·공격·배치·드랍은 그 자리에서 던진다', () => {
    const 유령 = (rows: Row[], key: string): Row[] => rows.map((r) => ({ ...r, [key]: r[key] === 'wolf' ? 'ghost' : r[key]! }))
    expect(() => parse({ patrol: 유령(순찰, 'species') })).toThrow(/존재하지 않는 종/)
    expect(() => parse({ attacks: 유령(공격, 'species') })).toThrow(/존재하지 않는 종/)
    expect(() => parse({ placements: [{ ...배치[0]!, species: 'ghost' }] })).toThrow(/존재하지 않는 종/)
    expect(() => parse({ drops: 유령(드랍, 'species') })).toThrow(/존재하지 않는 종/)
  })

  it('없는 direction 은 허용값을 말하며 던진다', () => {
    expect(() => parse({ attacks: [{ ...공격[0]!, direction: 'diagonal' }] })).toThrow(/허용값/)
  })

  it('정수 아닌 수치는 던진다', () => {
    expect(() => parse({ species: [{ ...종[0]!, periodMs: '10000.5' }] })).toThrow(/정수가 아니다/)
    expect(() => parse({ placements: [{ ...배치[0]!, originX: '5.5' }] })).toThrow(/정수가 아니다/)
  })

  it('phaseOffsetMs 음수는 던진다', () => {
    expect(() => parse({ placements: [{ ...배치[0]!, phaseOffsetMs: '-100' }] })).toThrow(/phaseOffsetMs/)
  })

  it('maxHp·sweepDamage 는 1 이상이어야 한다 — 못 잡는 몬스터와 안 아픈 휩쓸기는 데이터가 아니다', () => {
    expect(() => parse({ placements: [{ ...배치[0]!, maxHp: '0' }] })).toThrow(/maxHp/)
    expect(() => parse({ placements: [{ ...배치[0]!, sweepDamage: '0' }] })).toThrow(/sweepDamage/)
  })

  it('한 종의 chance 합이 1 을 넘으면 던진다 — 누적 굴림에서 뒤 줄이 눌린다', () => {
    const drops: Row[] = [
      { species: 'wolf', itemId: 'wolf_fang', chance: '0.6' },
      { species: 'wolf', itemId: 'wolf_fang2', chance: '0.5' },
    ]
    expect(() => parse({ drops })).toThrow(/합/)
  })

  it('같은 instanceId 둘은 던진다', () => {
    expect(() => parse({ placements: [배치[0]!, { ...배치[1]!, instanceId: 'wolf-1' }] })).toThrow(/중복/)
  })

  it('RLE slots 는 1 이상이어야 한다 — 0 슬롯 행은 시간표에 설 자리가 없다', () => {
    expect(() => parse({ patrol: [{ ...순찰[0]!, slots: '0' }] })).toThrow(/slots/)
  })
})
