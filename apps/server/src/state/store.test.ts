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

  it('대화 기능 이전에 저장된 세이브도 그대로 살아난다 — 숙련도도 인벤토리도 잃지 않는다', () => {
    // dialogueHistory 는 대화 태스크에서 생긴 필드다. 그 전에 저장된 세이브에는
    // 그 키가 아예 없는데, 스키마가 그걸 필수로 두면 readPlayers 가 플레이어를
    // **통째로** 버린다 — 수십 시간짜리 숙련도도, 강화한 도구도, 넘긴 이정표도
    // 같이. 형식이 진짜로 깨진 세이브(위 테스트)와 달리 이건 멀쩡한 세이브이고,
    // 없는 이력은 "아직 아무와도 말해 본 적 없다"와 같은 뜻이라 마이그레이션
    // 없이 그것이 맞는 답이다.
    const legacy = {
      id: 'local',
      skills: { ice: 12345, wood: 0, mineral: 300, herb: 0, crafting: 700 },
      stacks: { copper_ore: 42 },
      instances: [{ instanceId: 'inst-1', itemId: 'copper_pickaxe', enhanceLevel: 3 }],
      equipped: { mineral: 'inst-1' },
      nextActionAt: 0,
      celebrated: ['ice_10000'],
      // dialogueHistory 가 없다 — 이 필드가 생기기 전의 세이브다.
    }
    writeFileSync(file, JSON.stringify({ local: legacy }), 'utf8')

    const p = new PlayerStore(file).get('local')

    expect(p.skills.ice).toBe(12345)
    expect(p.stacks.copper_ore).toBe(42)
    expect(p.instances).toEqual([{ instanceId: 'inst-1', itemId: 'copper_pickaxe', enhanceLevel: 3 }])
    expect(p.celebrated).toEqual(['ice_10000'])
    // 빈 이력으로 채워 준다 — 그래야 이 상태를 그대로 쓰는 대화 판정이 다시
    // undefined 를 만나지 않는다.
    expect(p.dialogueHistory).toEqual({ said: [], recent: {}, lastTalkAt: {} })
  })

  it('location 이 생기기 전의 세이브도 숙련도를 지킨 채 살아난다', () => {
    // dialogueHistory 때와 똑같은 자리다. 필수 필드를 하나 더하면 readPlayers 가
    // 그 키가 없는 세이브를 **통째로** 버린다 — 숙련도도 인벤토리도 이정표도
    // 같이. 위치가 없는 세이브는 그저 이 필드가 생기기 전에 저장된 것이라,
    // 시작 맵의 시작 칸으로 읽는 것이 마이그레이션 없이 맞는 답이다.
    const legacy = {
      id: 'local',
      skills: { ice: 12345, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      stacks: {},
      instances: [],
      equipped: {},
      nextActionAt: 0,
      celebrated: [],
      dialogueHistory: { said: [], recent: {}, lastTalkAt: {} },
      // location 이 없다 — 이 필드가 생기기 전의 세이브다.
    }
    writeFileSync(file, JSON.stringify({ local: legacy }), 'utf8')

    const p = new PlayerStore(file).get('local')

    expect(p.skills.ice).toBe(12345)
    expect(p.location.mapId).toBe('world')
    // 기본값은 packages/shared 가 하드코딩한다 — 그 패키지는 packages/data 를
    // import 할 수 없어서 START_MAP_ID 를 볼 수가 없다. 그러면 시작 맵을 아는
    // 곳이 둘이 되므로, 둘이 갈라지는 순간을 여기서 잡는다: 옛 세이브가
    // 떨어지는 자리와 새 플레이어가 시작하는 자리는 같아야 한다.
    expect(p.location).toEqual(createInitialPlayer('drift-check').location)
  })

  it('한 세이브의 빈 이력이 다른 세이브와 같은 객체가 아니다 — 한쪽의 대화가 다른 쪽에 새면 안 된다', () => {
    // 기본값을 리터럴로 주면 zod 가 그 **한 객체**를 모든 파싱 결과에 물려
    // 준다. 두 플레이어가 같은 said 배열을 공유하면 한쪽이 말한 것이 다른
    // 쪽에서도 "이미 말했다"가 된다.
    const legacy = (id: string) => ({
      id,
      skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      stacks: {},
      instances: [],
      equipped: {},
      nextActionAt: 0,
      celebrated: [],
    })
    writeFileSync(file, JSON.stringify({ a: legacy('a'), b: legacy('b') }), 'utf8')

    const store = new PlayerStore(file)
    const a = store.get('a')
    a.dialogueHistory.said.push('노인.greet.abc')
    store.save(a)

    expect(store.get('b').dialogueHistory.said).toEqual([])
  })
})
