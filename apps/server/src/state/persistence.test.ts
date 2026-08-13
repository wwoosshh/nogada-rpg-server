import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { START_MAP_ID, loadGameData, startLocation } from '@nogada/data'
import { DEFAULT_APPEARANCE, type PlayerState } from '@nogada/shared'
import { runner } from 'node-pg-migrate'
import pg from 'pg'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { JsonPersistence } from './jsonPersistence.js'
import { createInitialPlayer } from './newCharacter.js'
import {
  CharacterConflictError,
  CharacterStateError,
  type Persistence,
  type StoredCharacter,
} from './persistence.js'
import { PostgresPersistence } from './postgresPersistence.js'

/**
 * 계약 스위트 — **구현마다 다시 쓰지 않는다.**
 *
 * 저장소가 둘(개발용 JSON 파일 · 배포용 Postgres)인데 검사가 하나뿐이어야 하는
 * 이유는 간단하다: 둘 중 하나에만 있는 규칙은 규칙이 아니다. `DATABASE_URL` 을
 * 빼고 개발하다 넣고 배포하는 순간, 여기서 걸리지 않은 차이가 남의 세이브에서
 * 드러난다.
 */

/**
 * 저장할 캐릭터 하나. 이 스위트가 보는 것은 저장소의 계약이지 캐릭터 생성이
 * 아니라서, 사람이 고르는 것(이름·외형·마을)은 여기서 한 번만 정한다.
 */
const newPlayer = (id: string): PlayerState =>
  createInitialPlayer({ id, name: '아무개', appearance: DEFAULT_APPEARANCE, village: START_MAP_ID })

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

/** 세이브 파일의 속. 원본을 심고 꺼내는 하네스만 이 모양을 안다. */
interface RawSaveFile {
  nextUserId: number
  users: Record<string, { username: string; passwordHash: string }>
  sessions: Record<string, { userId: string; expiresAt: number }>
  characters: Record<string, unknown>
  owners: Record<string, string>
}

const jsonHarness: Harness = {
  name: 'JSON 파일',
  open: () => JsonPersistence.open(join(dir, 'players.json')),
  async putRaw(id, raw) {
    const file = join(dir, 'players.json')
    let save: RawSaveFile = { nextUserId: 1, users: {}, sessions: {}, characters: {}, owners: {} }
    try {
      save = JSON.parse(readFileSync(file, 'utf8')) as RawSaveFile
    } catch {
      // 아직 아무것도 저장되지 않았다 — 빈 저장소에 심는다.
    }
    // 주인 없는 캐릭터를 심지 않는다. Postgres 쪽은 FK 가 그것을 막으므로,
    // 여기서도 같은 세계를 만들어 둬야 두 구현이 같은 것을 시험받는다.
    const userId = String(save.nextUserId)
    save.nextUserId += 1
    save.users[userId] = { username: `원본-${id}`, passwordHash: 'x' }
    save.characters[id] = raw
    save.owners[id] = userId
    writeFileSync(file, JSON.stringify(save, null, 2), 'utf8')
  },
  async getRaw(id) {
    const save = JSON.parse(readFileSync(join(dir, 'players.json'), 'utf8')) as RawSaveFile
    return save.characters[id]
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
      // 캐릭터에는 주인이 있어야 한다(FK + NOT NULL). 원본을 심는 것이 목적이지
      // 계정을 시험하는 것이 아니므로 계정 하나를 함께 만든다.
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (username, pw_hash) VALUES ($1, 'x')
         ON CONFLICT (username) DO UPDATE SET pw_hash = EXCLUDED.pw_hash
         RETURNING id::text AS id`,
        [`원본-${id}`],
      )
      await client.query(
        `INSERT INTO characters (id, user_id, state) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`,
        [id, user.rows[0]!.id, JSON.stringify(raw)],
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
  // 조용히 거짓으로 만들면 안 된다. 계정을 지우면 캐릭터도 세션도 CASCADE 로
  // 따라가지만, 무엇이 지워지는지 눈에 보이게 셋을 다 적는다.
  cleanup: () =>
    withClient(async (client) => {
      await client.query('DELETE FROM sessions')
      await client.query('DELETE FROM characters')
      await client.query('DELETE FROM users')
    }),
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

  /**
   * 계정 하나와 그 사람의 캐릭터 하나.
   *
   * 캐릭터가 생기는 곳은 `createCharacter` 하나뿐이라(저장은 이미 있는 것을
   * 고쳐 쓸 뿐이다) 저장을 시험하는 모든 테스트가 여기서 시작한다.
   */
  const born = async (id: string, player: PlayerState = newPlayer(id)): Promise<StoredCharacter> => {
    const user = await store.createUser(`계정-${id}`, `해시-${id}`)
    if (!user) throw new Error(`계정 "계정-${id}" 이 이미 있다`)
    const created = await store.createCharacter(user.id, player)
    if (!created) throw new Error(`캐릭터 "${id}" 를 만들지 못했다`)
    return created
  }

  // 왜: 예전 저장소는 없는 id 를 물으면 새 플레이어를 지어내 돌려줬다. 그러면
  //     오타 난 id 하나가 빈 캐릭터를 낳고, 그 캐릭터가 파일에 저장까지 된다.
  //     캐릭터가 생기는 곳은 캐릭터 생성 하나여야 한다.
  it('없는 캐릭터는 null 이다 — 지어내지 않는다', async () => {
    expect(await store.getCharacter('없는사람')).toBeNull()
    expect(await store.readCharacter('없는사람')).toBeNull()
  })

  it('저장한 것을 그대로 다시 읽는다', async () => {
    const player = newPlayer('나그네')
    player.stacks.copper_ore = 7
    await born('나그네', player)

    const loaded = await store.getCharacter('나그네')
    expect(loaded?.stacks.copper_ore).toBe(7)
    expect(loaded?.instances).toEqual(player.instances)
  })

  it('돌려준 상태를 밖에서 고쳐도 저장소 안이 오염되지 않는다', async () => {
    await born('나그네')

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
      // dialogueHistory 도 location 도 gold 도 rewarded 도 없다 — 그 필드들이
      // 생기기 전의 세이브다. 경제 아크가 필드를 둘 더 얹었으므로 그 둘의
      // 기본값도 여기서 함께 시험된다.
    })

    const loaded = await (await reopen()).getCharacter('옛사람')

    expect(loaded?.skills.ice).toBe(12345)
    expect(loaded?.stacks.copper_ore).toBe(42)
    expect(loaded?.celebrated).toEqual(['ice_10000'])
    expect(loaded?.dialogueHistory).toEqual({ said: [], recent: {}, lastTalkAt: {} })
    expect(loaded?.location).toEqual(startLocation(loadGameData()))
    // 대금을 받은 적 없는 사람으로 살아난다. 이 기본값이 저장 계층까지 닿지
    // 않으면 옛 세이브는 스키마에서 걸려 통째로 사라지고, 빈 목록이 아닌
    // 무엇으로 살아나면 달인이 준 적 없는 돈을 이미 준 것으로 기억한다.
    expect(loaded?.rewarded).toEqual([])
    // 수집의 방도 나중에 생겼다 — 아무것도 안 바친 사람으로 살아난다. 이
    // 기본값이 **함수**여야 하는 이유(세이브들이 객체 하나를 공유하면 남의
    // 헌납이 내 방에 나타난다)는 스키마 쪽 스위트가 두 세이브로 못박는다.
    expect(loaded?.donated).toEqual({})
    // 이름·외형도 나중에 생긴 필드다 — 기본값이 저장 계층까지 닿지 않으면
    // 그 세이브는 "형식 오류" 하나로 통째로 읽히지 않는다.
    expect(loaded?.appearance).toBe(DEFAULT_APPEARANCE)
  })

  // 왜: 콘텐츠는 계속 바뀌는데 세이브는 남는다. maps.csv 에서 맵을 지우거나
  //     이름을 바꾸면 없는 맵을 가리키는 세이브가 남고, 그대로 내보내면
  //     클라이언트가 maps/<없는맵>.json 을 404 로 받은 뒤 검은 화면에서 죽는다 —
  //     게임 안에서 빠져나올 방법이 없다. 보정은 **구현 양쪽 모두**의 읽기
  //     계약이다: 한쪽에만 있으면 DATABASE_URL 하나로 게임이 못 쓰게 된다.
  it('없어진 맵을 가리키는 세이브는 시작 자리로 돌아온다 — 숙련도는 그대로 두고', async () => {
    const stale = newPlayer('길잃은이')
    await born('길잃은이', {
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
    const player: PlayerState = { ...newPlayer('진짜키'), id: '남의id' }
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
    await born('경합')

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
    const first = (await born('판본')).version
    const second = await store.saveCharacter(newPlayer('판본'), first)

    expect(second).not.toBe(first)
  })

  it('없는 캐릭터에 판본을 걸고 저장하면 충돌이다', async () => {
    await expect(
      store.saveCharacter(newPlayer('유령'), 'whatever'),
    ).rejects.toBeInstanceOf(CharacterConflictError)
  })

  // 왜: 예전에는 판본 없는 저장이 없는 행을 만들어 줬다. 그러면 캐릭터가 생기는
  //     곳이 둘이 되고, 오타 난 키 하나가 주인(user_id) 없는 캐릭터를 낳는다 —
  //     Postgres 에서는 그 행이 아예 들어가지도 못한다(NOT NULL).
  it('판본을 걸지 않아도 없는 캐릭터는 만들지 않는다 — 만드는 곳은 생성 하나다', async () => {
    await expect(store.saveCharacter(newPlayer('유령'))).rejects.toBeInstanceOf(
      CharacterConflictError,
    )
    expect(await store.getCharacter('유령')).toBeNull()
  })

  it('서로 다른 캐릭터는 서로에게 새지 않는다', async () => {
    const a = newPlayer('가')
    a.stacks.copper_ore = 1
    await born('가', a)
    await born('나')

    expect((await store.getCharacter('나'))?.stacks).toEqual({})
    // 기본값을 리터럴로 주면 zod 가 그 한 객체를 모든 파싱 결과에 물려 준다 —
    // 한쪽이 말한 것이 다른 쪽에서도 "이미 말했다"가 된다.
    const one = await store.getCharacter('가')
    one!.dialogueHistory.said.push('노인.greet.abc')
    expect((await store.getCharacter('나'))?.dialogueHistory.said).toEqual([])
  })

  it('가입한 계정을 아이디로 다시 찾는다 — 해시는 손대지 않고 그대로', async () => {
    const created = await store.createUser('노가다', '해시')

    expect(created?.id).toBeTruthy()
    expect(await store.findUser('노가다')).toEqual(created)
  })

  it('없는 아이디는 null 이다', async () => {
    expect(await store.findUser('아무도아님')).toBeNull()
  })

  // 왜: "찾아보고 없으면 넣는다"로 쓰면 그 사이에 다른 가입이 끼어들어 둘 다
  //     통과한다. 유일성은 쓰는 순간 판정되어야 하고(Postgres 는 23505, JSON
  //     폴백은 직렬화한 쓰기 안의 같은 검사), 그 답이 두 구현에서 같아야
  //     라우트가 한 가지 방법으로 409 를 낼 수 있다(설계 규범 6).
  it('같은 아이디로 두 번 가입하면 두 번째는 null 이다 — 오류가 아니라 답이다', async () => {
    await store.createUser('노가다', '해시')

    expect(await store.createUser('노가다', '다른해시')).toBeNull()
    // 먼저 가입한 사람의 비밀번호가 덮이지 않는다 — 덮이면 가입 요청 하나로
    // 남의 계정을 빼앗을 수 있다.
    expect((await store.findUser('노가다'))?.passwordHash).toBe('해시')
  })

  // 왜: 아이디를 정규화하는 것은 부르는 쪽의 일이다. 저장소가 또 다듬으면 규칙을
  //     아는 곳이 둘이 되고, 그 둘이 갈라지는 날 아무도 자기 계정을 못 찾는다.
  it('저장소는 받은 글자를 그대로 견준다 — 정규화는 부르는 쪽의 일이다', async () => {
    await store.createUser('노가다', '해시')

    expect(await store.findUser('노가다 ')).toBeNull()
    expect(await store.findUser('노가다')).not.toBeNull()
  })

  it('연 세션을 표로 다시 찾는다', async () => {
    const user = await store.createUser('노가다', '해시')
    const expiresAt = Date.now() + 1000

    await store.createSession('토큰표', user!.id, expiresAt)

    expect(await store.findSession('토큰표')).toEqual({ userId: user!.id, expiresAt })
  })

  it('없는 세션은 null 이다', async () => {
    expect(await store.findSession('없는표')).toBeNull()
  })

  // 왜: 만료가 지난 세션을 저장소가 조용히 감추면, 그것을 지울 기회도 왜
  //     로그아웃됐는지 말할 기회도 사라진다. 지났는지는 인증이 본다.
  it('만료가 지난 세션도 그대로 돌려준다 — 지났는지는 부르는 쪽이 본다', async () => {
    const user = await store.createUser('노가다', '해시')
    const past = Date.now() - 1000

    await store.createSession('지난표', user!.id, past)

    expect(await store.findSession('지난표')).toEqual({ userId: user!.id, expiresAt: past })
  })

  it('세션의 만료를 미룬다', async () => {
    const user = await store.createUser('노가다', '해시')
    await store.createSession('토큰표', user!.id, Date.now() + 1000)

    const later = Date.now() + 60_000
    await store.extendSession('토큰표', later)

    expect((await store.findSession('토큰표'))?.expiresAt).toBe(later)
  })

  // 왜: 방금 로그아웃한 사람의 요청이 연장에 닿을 수 있다. 그것이 세션을
  //     되살리면 로그아웃이 거짓이 된다.
  it('없는 세션을 연장해도 되살아나지 않는다', async () => {
    await store.extendSession('없는표', Date.now() + 60_000)

    expect(await store.findSession('없는표')).toBeNull()
  })

  it('세션을 닫으면 그 표는 없는 것이 된다', async () => {
    const user = await store.createUser('노가다', '해시')
    await store.createSession('토큰표', user!.id, Date.now() + 1000)

    await store.deleteSession('토큰표')

    expect(await store.findSession('토큰표')).toBeNull()
    // 로그아웃은 그 기기 하나를 닫는 것이지 계정을 지우는 것이 아니다.
    expect(await store.findUser('노가다')).not.toBeNull()
  })

  it('없는 세션을 닫아도 오류가 아니다 — 결과는 어느 쪽이든 "없다"다', async () => {
    await expect(store.deleteSession('없는표')).resolves.toBeUndefined()
  })

  // 왜: 이중 제출(버튼 두 번, 느린 네트워크에서의 재시도)이 캐릭터 둘을 만들지
  //     못하게 하는 것은 코드의 순서가 아니라 제약이어야 한다. null 을 받은 쪽은
  //     이미 있는 캐릭터를 돌려준다 — 그것이 사람이 기대하는 답이다(설계 규범 6).
  it('한 계정은 캐릭터 하나다 — 두 번째 생성은 null 이고 먼저 것을 덮지 않는다', async () => {
    const user = await store.createUser('노가다', '해시')
    const first = newPlayer('첫캐릭터')
    first.stacks.copper_ore = 3
    await store.createCharacter(user!.id, first)

    expect(await store.createCharacter(user!.id, newPlayer('둘째캐릭터'))).toBeNull()
    expect(await store.getCharacter('둘째캐릭터')).toBeNull()
    expect((await store.getCharacter('첫캐릭터'))?.stacks.copper_ore).toBe(3)
  })

  it('같은 키의 캐릭터를 다시 만들면 null 이다 — 남의 진행도를 덮지 않는다', async () => {
    const mine = newPlayer('한사람')
    mine.skills.ice = 12345
    await born('한사람', mine)

    const other = await store.createUser('남', '해시')
    expect(await store.createCharacter(other!.id, newPlayer('한사람'))).toBeNull()
    expect((await store.getCharacter('한사람'))?.skills.ice).toBe(12345)
  })

  // 왜: 슬롯이 하나뿐이라 삭제가 없으면 잘못 고른 외형·마을이 영구히 갇힌다
  //     (설계 규범 7). 그리고 지운 뒤 다시 만들 수 없으면 그건 삭제가 아니라
  //     계정을 못 쓰게 만드는 것이다.
  it('캐릭터를 지우면 계정은 남고, 그 계정으로 다시 만들 수 있다', async () => {
    const user = await store.createUser('노가다', '해시')
    await store.createCharacter(user!.id, newPlayer('첫캐릭터'))

    await store.deleteCharacter('첫캐릭터')

    expect(await store.getCharacter('첫캐릭터')).toBeNull()
    expect(await store.findUser('노가다')).not.toBeNull()
    expect(await store.createCharacter(user!.id, newPlayer('다시만든캐릭터'))).not.toBeNull()
  })

  // 왜: 지운 자리에 같은 키로 다시 만들었는데 판본이 이어지면, 지워지기 전에
  //     읽어 둔 판본으로 저장하는 요청이 통과한다 — 새 캐릭터가 옛 캐릭터의
  //     상태로 덮인다.
  it('지웠다 같은 키로 다시 만들면 옛 판본으로는 저장할 수 없다', async () => {
    const user = await store.createUser('노가다', '해시')
    const before = await store.createCharacter(user!.id, newPlayer('한사람'))
    await store.deleteCharacter('한사람')
    await store.createCharacter(user!.id, newPlayer('한사람'))

    await expect(
      store.saveCharacter(newPlayer('한사람'), before!.version),
    ).rejects.toBeInstanceOf(CharacterConflictError)
  })

  it('없는 캐릭터를 지워도 오류가 아니다', async () => {
    await expect(store.deleteCharacter('없는사람')).resolves.toBeUndefined()
  })

  // 왜: 계정과 캐릭터는 서로 다른 저장소 칸이지만 하나의 사실이다 — 다시 열었을
  //     때 그 둘이 함께 살아나지 않으면 서버를 재시작할 때마다 아무도 못 들어온다.
  it('다시 열어도 계정·세션·캐릭터가 그대로 있다', async () => {
    const user = await store.createUser('노가다', '해시')
    await store.createSession('토큰표', user!.id, Date.now() + 1000)
    await store.createCharacter(user!.id, newPlayer('한사람'))

    const reopened = await reopen()

    expect((await reopened.findUser('노가다'))?.id).toBe(user!.id)
    expect((await reopened.findSession('토큰표'))?.userId).toBe(user!.id)
    expect(await reopened.getCharacter('한사람')).not.toBeNull()
  })
}
