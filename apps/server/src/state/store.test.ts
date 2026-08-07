import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadGameData } from '@nogada/data'
import { STARTING_TOOL_IDS } from '@nogada/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlayerStore, createInitialPlayer } from './store.js'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nogada-'))
  file = join(dir, 'players.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

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
})

describe('PlayerStore', () => {
  it('처음 조회하면 초기 상태를 만들어 준다', () => {
    const store = new PlayerStore(file)
    expect(store.get('local').skills.mineral).toBe(0)
  })

  it('저장한 내용을 다시 읽을 수 있다', () => {
    const store = new PlayerStore(file)
    const p = store.get('local')
    p.stacks.copper_ore = 7
    store.save(p)

    const reopened = new PlayerStore(file)
    expect(reopened.get('local').stacks.copper_ore).toBe(7)
  })

  it('서로 다른 플레이어를 독립적으로 보관한다', () => {
    const store = new PlayerStore(file)
    const a = store.get('a')
    a.stacks.copper_ore = 1
    store.save(a)
    expect(store.get('b').stacks).toEqual({})
  })

  it('반환된 상태를 밖에서 바꿔도 저장 전까지는 반영되지 않는다', () => {
    const store = new PlayerStore(file)
    const p = store.get('local')
    p.stacks.copper_ore = 99
    expect(store.get('local').stacks.copper_ore).toBeUndefined()
  })

  it('저장한 상태를 밖에서 바꿔도 저장소 안이 오염되지 않는다', () => {
    const store = new PlayerStore(file)
    const p = store.get('local')
    store.save(p)
    p.stacks.copper_ore = 42
    expect(store.get('local').stacks.copper_ore).toBeUndefined()
  })

  it('형식이 맞지 않는 세이브는 버리고 새 플레이어를 만든다', () => {
    // 이전 형식: 숙련도가 { level, xp } 객체였다
    writeFileSync(
      file,
      JSON.stringify({ local: { id: 'local', skills: { mining: { level: 3, xp: 10 } } } }),
      'utf8',
    )

    const store = new PlayerStore(file)
    const p = store.get('local')

    expect(typeof p.skills.mineral).toBe('number')
    expect(p.skills.mineral).toBe(0)
  })

  it('깨진 JSON 도 버린다', () => {
    writeFileSync(file, '{ 이건 JSON 이 아니다', 'utf8')
    expect(new PlayerStore(file).get('local').skills.mineral).toBe(0)
  })
})
