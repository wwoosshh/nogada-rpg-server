import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGameData, startLocation } from '@nogada/data'
import type { PlayerState } from '@nogada/shared'
import { runner } from 'node-pg-migrate'
import pg from 'pg'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JsonPersistence } from './jsonPersistence.js'
import { createInitialPlayer } from './newCharacter.js'
import { CharacterConflictError, CharacterStateError, type Persistence } from './persistence.js'
import { PostgresPersistence } from './postgresPersistence.js'

/**
 * 계약 스위트 — **구현마다 다시 쓰지 않는다.**
 *
 * 저장소가 둘(개발용 JSON 파일 · 배포용 Postgres)인데 검사가 하나뿐이어야 하는
 * 이유는 간단하다: 둘 중 하나에만 있는 규칙은 규칙이 아니다. `DATABASE_URL` 을
 * 빼고 개발하다 넣고 배포하는 순간, 여기서 걸리지 않은 차이가 남의 세이브에서
 * 드러난다.
 */

/** 한 구현을 계약 스위트에 앉히는 데 필요한 것. 원본 주입은 "읽을 수 없는 행"을 만들기 위한 것이다. */
interface Harness {
  readonly name: string
  open(): Promise<Persistence>
  /** 스키마를 통과하지 못할 값을 저장소에 **그대로** 넣는다. */
  putRaw(id: string, raw: unknown): Promise<void>
  /** 저장소에 지금 들어 있는 원본. 읽기가 실패한 뒤에도 행이 남아 있는지 본다. */
  getRaw(id: string): Promise<unknown>
  cleanup(): Promise<void>
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nogada-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const jsonHarness: Harness = {
  name: 'JSON 파일',
  open: () => JsonPersistence.open(join(dir, 'players.json')),
  async putRaw(id, raw) {
    const file = join(dir, 'players.json')
    let all: Record<string, unknown> = {}
    try {
      all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      all = {}
    }
    all[id] = raw
    writeFileSync(file, JSON.stringify(all, null, 2), 'utf8')
  },
  async getRaw(id) {
    const all = JSON.parse(readFileSync(join(dir, 'players.json'), 'utf8')) as Record<string, unknown>
    return all[id]
  },
  cleanup: async () => undefined,
}

/**
 * 진짜 Postgres 를 가리켰을 때만 돈다.
 *
 * CI 가 없으므로 이 스위트가 저절로 돌 일은 없다 — 대신 **완료 관문**으로
 * 대신한다(설계 규범 10): 태스크를 끝내기 전에 `docker compose up` 한 뒤 한 번
 * 돌려 출력을 보고한다. 건너뛰는 것을 통과로 세지 않으려고 이름에 남긴다.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

const postgresHarness: Harness = {
  name: 'PostgreSQL',
  open: async () => PostgresPersistence.open(TEST_DATABASE_URL!),
  async putRaw(id, raw) {
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO characters (id, state) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`,
        [id, JSON.stringify(raw)],
      )
    })
  },
  async getRaw(id) {
    return withClient(async (client) => {
      const result = await client.query<{ state: unknown }>(
        'SELECT state FROM characters WHERE id = $1',
        [id],
      )
      return result.rows[0]?.state
    })
  },
  // 테스트마다 표를 비운다. 앞 테스트가 남긴 캐릭터가 "없는 캐릭터는 null" 을
  // 조용히 거짓으로 만들면 안 된다.
  cleanup: () => withClient(async (client) => void (await client.query('DELETE FROM characters'))),
}

async function withClient<T>(use: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL })
  await client.connect()
  try {
    return await use(client)
  } finally {
    await client.end()
  }
}

describe('Persistence 계약 — JSON 파일', () => {
  contractSuite(jsonHarness)
})

describe.skipIf(!TEST_DATABASE_URL)('Persistence 계약 — PostgreSQL', () => {
  // 표가 없으면 첫 질의부터 죽는다. 스키마의 출처는 마이그레이션 파일 하나여야
  // 하므로 테스트가 CREATE TABLE 을 다시 적지 않고 그것을 돌린다.
  beforeAll(async () => {
    await runner({
      databaseUrl: TEST_DATABASE_URL!,
      dir: fileURLToPath(new URL('../../migrations', import.meta.url)),
      migrationsTable: 'pgmigrations',
      direction: 'up',
    })
  })

  contractSuite(postgresHarness)
})

function contractSuite(harness: Harness): void {
  let store: Persistence
  /** 연 것은 모두 닫는다 — Postgres 는 열 때마다 풀이 하나씩 생긴다. */
  let opened: Persistence[]

  const reopen = async (): Promise<Persistence> => {
    const fresh = await harness.open()
    opened.push(fresh)
    return fresh
  }

  beforeEach(async () => {
    opened = []
    store = await reopen()
  })

  afterEach(async () => {
    for (const one of opened) await one.close()
    await harness.cleanup()
  })

  // 왜: 예전 저장소는 없는 id 를 물으면 새 플레이어를 지어내 돌려줬다. 그러면
  //     오타 난 id 하나가 빈 캐릭터를 낳고, 그 캐릭터가 파일에 저장까지 된다.
  //     캐릭터가 생기는 곳은 캐릭터 생성 하나여야 한다.
  it('없는 캐릭터는 null 이다 — 지어내지 않는다', async () => {
    expect(await store.getCharacter('없는사람')).toBeNull()
    expect(await store.readCharacter('없는사람')).toBeNull()
  })

  it('저장한 것을 그대로 다시 읽는다', async () => {
    const player = createInitialPlayer('나그네')
    player.stacks.copper_ore = 7
    await store.saveCharacter(player)

    const loaded = await store.getCharacter('나그네')
    expect(loaded?.stacks.copper_ore).toBe(7)
    expect(loaded?.instances).toEqual(player.instances)
  })

  it('돌려준 상태를 밖에서 고쳐도 저장소 안이 오염되지 않는다', async () => {
    await store.saveCharacter(createInitialPlayer('나그네'))

    const first = await store.getCharacter('나그네')
    first!.stacks.copper_ore = 99

    expect((await store.getCharacter('나그네'))?.stacks.copper_ore).toBeUndefined()
  })

  // 왜: dialogueHistory·location 은 나중에 생긴 필드다. 스키마 기본값이 없으면
  //     그 필드가 없는 옛 세이브를 파싱이 통째로 거절하고, 수십 시간짜리
  //     숙련도와 강화한 도구가 "형식 오류" 하나로 사라진다. 기본값이 진짜로
  //     저장 계층까지 닿는지는 여기서만 확인된다.
  it('없던 필드가 생기기 전의 세이브도 숙련도를 지킨 채 살아난다', async () => {
    await harness.putRaw('옛사람', {
      id: '옛사람',
      skills: { ice: 12345, wood: 0, mineral: 300, herb: 0, crafting: 700 },
      stacks: { copper_ore: 42 },
      instances: [{ instanceId: 'inst-1', itemId: 'copper_pickaxe', enhanceLevel: 3 }],
      equipped: { mineral: 'inst-1' },
      nextActionAt: 0,
      celebrated: ['ice_10000'],
      // dialogueHistory 도 location 도 없다 — 그 필드들이 생기기 전의 세이브다.
    })

    const loaded = await (await reopen()).getCharacter('옛사람')

    expect(loaded?.skills.ice).toBe(12345)
    expect(loaded?.stacks.copper_ore).toBe(42)
    expect(loaded?.celebrated).toEqual(['ice_10000'])
    expect(loaded?.dialogueHistory).toEqual({ said: [], recent: {}, lastTalkAt: {} })
    expect(loaded?.location).toEqual(startLocation(loadGameData()))
  })

  // 왜: 콘텐츠는 계속 바뀌는데 세이브는 남는다. maps.csv 에서 맵을 지우거나
  //     이름을 바꾸면 없는 맵을 가리키는 세이브가 남고, 그대로 내보내면
  //     클라이언트가 maps/<없는맵>.json 을 404 로 받은 뒤 검은 화면에서 죽는다 —
  //     게임 안에서 빠져나올 방법이 없다. 보정은 **구현 양쪽 모두**의 읽기
  //     계약이다: 한쪽에만 있으면 DATABASE_URL 하나로 게임이 못 쓰게 된다.
  it('없어진 맵을 가리키는 세이브는 시작 자리로 돌아온다 — 숙련도는 그대로 두고', async () => {
    const stale = createInitialPlayer('길잃은이')
    await store.saveCharacter({
      ...stale,
      skills: { ...stale.skills, ice: 12345 },
      stacks: { copper_ore: 42 },
      location: { mapId: '없어진맵', x: 3, y: 4 },
    })

    const loaded = await store.getCharacter('길잃은이')

    expect(loaded?.location).toEqual(startLocation(loadGameData()))
    // 위치만 되돌린다. 세이브를 통째로 버리면 수십 시간짜리 숙련도가 같이 간다.
    expect(loaded?.skills.ice).toBe(12345)
    expect(loaded?.stacks.copper_ore).toBe(42)
  })

  // 왜: 상태 안의 id 와 행의 키가 갈라지면 "누구의 상태인가"에 답이 둘이 된다.
  //     그 상태를 그대로 저장하면 다음 쓰기가 엉뚱한 행으로 간다.
  it('id 는 행의 키가 도장 찍는다 — 상태 안의 id 를 믿지 않는다', async () => {
    const player: PlayerState = { ...createInitialPlayer('진짜키'), id: '남의id' }
    await harness.putRaw('진짜키', player)

    const reopened = await reopen()
    await expect(reopened.getCharacter('진짜키')).resolves.toMatchObject({ id: '진짜키' })
  })

  // 왜: 이것이 이 태스크가 뒤집은 습관이다. 지금까지는 형식이 맞지 않는 세이브를
  //     조용히 버리고 새 플레이어를 만들어 줬다(store.ts 주석이 "실제 유저
  //     데이터가 생기기 전에 이 결정을 뒤집어야 한다"고 적어 둔 그 동작이다).
  //     개발용 세이브 하나뿐일 때는 편했지만 남의 진행도에 대해서는 그것이 곧
  //     삭제다. 이제는 읽기가 실패하고, 행은 손대지 않은 채 남는다.
  it('읽을 수 없는 상태는 오류가 되고 행은 남는다 — 버리지도 덮지도 않는다', async () => {
    // 예전 형식: 숙련도가 { level, xp } 객체였다.
    const broken = { id: '깨진이', skills: { mining: { level: 3, xp: 10 } } }
    await harness.putRaw('깨진이', broken)

    const reopened = await reopen()
    await expect(reopened.getCharacter('깨진이')).rejects.toBeInstanceOf(CharacterStateError)
    expect(await harness.getRaw('깨진이')).toEqual(broken)
  })

  // 왜: 낙관적 잠금이 인터페이스 계약인 이유다. 판본을 견주지 않으면 두 요청이
  //     같은 상태를 읽고 나중에 쓴 쪽이 먼저 쓴 쪽을 통째로 덮는다 — 오류 없이
  //     캔 광석과 오른 숙련도가 사라진다.
  it('지나간 판본으로 저장하면 충돌이다 — 남의 저장을 덮지 못한다', async () => {
    await store.saveCharacter(createInitialPlayer('경합'))

    const mine = await store.readCharacter('경합')
    expect(mine).not.toBeNull()

    // 그 사이 다른 요청이 저장했다.
    await store.saveCharacter({ ...mine!.player, stacks: { ice_shard: 1 } }, mine!.version)

    await expect(
      store.saveCharacter({ ...mine!.player, stacks: { copper_ore: 1 } }, mine!.version),
    ).rejects.toBeInstanceOf(CharacterConflictError)

    // 먼저 쓴 쪽이 그대로 남아 있다.
    expect((await store.getCharacter('경합'))?.stacks).toEqual({ ice_shard: 1 })
  })

  it('저장할 때마다 판본이 달라진다 — 같은 값이 두 번 나오면 지나간 판본이 통과한다', async () => {
    const first = await store.saveCharacter(createInitialPlayer('판본'))
    const second = await store.saveCharacter(createInitialPlayer('판본'), first)

    expect(second).not.toBe(first)
  })

  it('없는 캐릭터에 판본을 걸고 저장하면 충돌이다', async () => {
    await expect(
      store.saveCharacter(createInitialPlayer('유령'), 'whatever'),
    ).rejects.toBeInstanceOf(CharacterConflictError)
  })

  it('서로 다른 캐릭터는 서로에게 새지 않는다', async () => {
    const a = createInitialPlayer('가')
    a.stacks.copper_ore = 1
    await store.saveCharacter(a)
    await store.saveCharacter(createInitialPlayer('나'))

    expect((await store.getCharacter('나'))?.stacks).toEqual({})
    // 기본값을 리터럴로 주면 zod 가 그 한 객체를 모든 파싱 결과에 물려 준다 —
    // 한쪽이 말한 것이 다른 쪽에서도 "이미 말했다"가 된다.
    const one = await store.getCharacter('가')
    one!.dialogueHistory.said.push('노인.greet.abc')
    expect((await store.getCharacter('나'))?.dialogueHistory.said).toEqual([])
  })
}
