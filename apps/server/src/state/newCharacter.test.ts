import { loadGameData, startLocation } from '@nogada/data'
import { STARTING_TOOL_IDS } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { createInitialPlayer } from './newCharacter.js'

describe('createInitialPlayer', () => {
  it('다섯 생활기술을 숙련도 0으로 시작한다', () => {
    const p = createInitialPlayer('local')
    expect(p.skills).toEqual({ ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 })
  })

  it('STARTING_TOOL_IDS 의 도구를 인스턴스로 지급한다', () => {
    const p = createInitialPlayer('local')
    expect(p.instances).toHaveLength(STARTING_TOOL_IDS.length)
    expect(p.instances.map((i) => i.itemId)).toEqual([...STARTING_TOOL_IDS])
    for (const instance of p.instances) expect(instance.enhanceLevel).toBe(0)
  })

  it('지급한 도구를 해당 생활기술에 착용시킨다', () => {
    const items = loadGameData().items
    const p = createInitialPlayer('local')

    for (const instance of p.instances) {
      const skill = items[instance.itemId]!.toolSkill!
      expect(p.equipped[skill]).toBe(instance.instanceId)
    }
  })

  it('인스턴스 ID 는 플레이어마다 다르다', () => {
    const a = createInitialPlayer('a')
    const b = createInitialPlayer('b')
    expect(a.instances[0]!.instanceId).not.toBe(b.instances[0]!.instanceId)
  })

  it('인벤토리 스택은 비어 있다', () => {
    expect(createInitialPlayer('local').stacks).toEqual({})
  })

  // 왜: 시작 칸 (15, 16) 은 예전에 서버·프로토콜·시뮬레이터 세 곳에 글자로
  //     박혀 있었고, 셋을 서로 묶는 테스트는 있어도 **맵에 묶는 것은
  //     아무것도 없었다** — 시작 맵의 그 칸에 벽을 그리면 새 플레이어가
  //     전부 벽 속에서 시작한다. 이제 시작 칸은 맵의 spawn 오브젝트가 갖고,
  //     여기서 그 둘이 같은 값인지 못 박는다.
  it('시작 칸은 시작 맵의 spawn 오브젝트가 가리키는 칸이다', () => {
    const data = loadGameData()
    const p = createInitialPlayer('local')
    expect(p.location).toEqual(startLocation(data))
    expect(p.location).toEqual({
      mapId: '눈의마을',
      x: data.maps['눈의마을']!.spawn.x,
      y: data.maps['눈의마을']!.spawn.y,
    })
  })
})
