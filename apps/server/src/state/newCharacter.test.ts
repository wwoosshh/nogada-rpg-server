import { START_MAP_ID, loadGameData, startLocation, startVillages } from '@nogada/data'
import { DEFAULT_APPEARANCE, STARTING_TOOL_IDS } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { createInitialPlayer } from './newCharacter.js'

/** 고른 것을 매번 적지 않는다 — 이 스위트가 보는 것은 고른 뒤에 게임이 정하는 나머지다. */
const born = (id: string, village = START_MAP_ID) =>
  createInitialPlayer({ id, name: '아무개', appearance: DEFAULT_APPEARANCE, village })

describe('createInitialPlayer', () => {
  it('다섯 생활기술을 숙련도 0으로 시작한다', () => {
    expect(born('local').skills).toEqual({ ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 })
  })

  it('STARTING_TOOL_IDS 의 도구를 인스턴스로 지급한다', () => {
    const p = born('local')
    expect(p.instances).toHaveLength(STARTING_TOOL_IDS.length)
    expect(p.instances.map((i) => i.itemId)).toEqual([...STARTING_TOOL_IDS])
    for (const instance of p.instances) expect(instance.enhanceLevel).toBe(0)
  })

  it('지급한 도구를 해당 생활기술에 착용시킨다', () => {
    const items = loadGameData().items
    const p = born('local')

    for (const instance of p.instances) {
      const skill = items[instance.itemId]!.toolSkill!
      expect(p.equipped[skill]).toBe(instance.instanceId)
    }
  })

  it('인스턴스 ID 는 플레이어마다 다르다', () => {
    expect(born('a').instances[0]!.instanceId).not.toBe(born('b').instances[0]!.instanceId)
  })

  it('인벤토리 스택은 비어 있다', () => {
    expect(born('local').stacks).toEqual({})
  })

  // 왜: 이름과 외형은 사람이 고른 것이고, 상태가 그것의 원본이다(설계 규범 4).
  //     생성이 이 둘을 흘리면 캐릭터를 만든 다음 화면이 남의 이름을 보여 준다.
  it('고른 이름과 외형이 상태에 그대로 남는다', () => {
    const p = createInitialPlayer({ id: 'x', name: '노가다', appearance: 'elder', village: START_MAP_ID })
    expect(p.name).toBe('노가다')
    expect(p.appearance).toBe('elder')
  })

  // 왜: 시작 칸 (15, 16) 은 예전에 서버·프로토콜·시뮬레이터 세 곳에 글자로
  //     박혀 있었고, 셋을 서로 묶는 테스트는 있어도 **맵에 묶는 것은
  //     아무것도 없었다** — 시작 맵의 그 칸에 벽을 그리면 새 플레이어가
  //     전부 벽 속에서 시작한다. 이제 시작 칸은 맵의 spawn 오브젝트가 갖고,
  //     여기서 그 둘이 같은 값인지 못 박는다.
  it('시작 칸은 시작 맵의 spawn 오브젝트가 가리키는 칸이다', () => {
    const data = loadGameData()
    const p = born('local')
    expect(p.location).toEqual(startLocation(data))
    expect(p.location).toEqual({
      mapId: '눈의마을',
      x: data.maps['눈의마을']!.spawn.x,
      y: data.maps['눈의마을']!.spawn.y,
    })
  })

  // 왜: "시작 마을 = 첫 숙련도" 가 이 게임의 설계인데, 고른 마을이 자리에
  //     반영되지 않으면 넷 다 같은 곳에서 시작한다 — 고르게 한 것이 거짓이 된다.
  it('고른 마을의 spawn 에서 시작한다 — 마을마다 다른 자리다', () => {
    const data = loadGameData()
    const places = new Set<string>()

    for (const village of startVillages(data)) {
      const p = born('local', village.id)
      expect(p.location).toEqual({ mapId: village.id, x: village.spawn.x, y: village.spawn.y })
      places.add(`${p.location.mapId}:${p.location.x},${p.location.y}`)
    }

    expect(places.size).toBe(startVillages(data).length)
  })

  // 왜: 없는 맵을 받아 조용히 시작 맵으로 떨어뜨리면, 고른 마을과 선 자리가
  //     다른 캐릭터가 생기고 아무도 그것을 모른다.
  it('없는 마을로는 캐릭터를 만들지 않는다', () => {
    expect(() => born('local', '없는마을')).toThrow('없는마을')
  })
})
