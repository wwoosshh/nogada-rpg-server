import type { PlayerState } from '@nogada/shared'
import pg from 'pg'
import {
  CharacterConflictError,
  Persistence,
  decodeCharacter,
  type CharacterVersion,
  type StoredCharacter,
  type StoredSession,
  type StoredUser,
} from './persistence.js'

/**
 * 배포용 저장소 — PostgreSQL.
 *
 * 캐릭터 하나가 행 하나이고 상태는 `state JSONB` 통째다. 판본은 `updated_at`
 * 이고, 그 칸 하나로 낙관적 잠금이 돈다.
 *
 * **판본을 문자열로 다루는 이유:** `updated_at::text` 는 마이크로초까지 그대로
 * 실어 오지만, 그것을 JS `Date` 로 받으면 밀리초로 잘린다 — 잘린 값으로 다시
 * 견주면 서로 다른 두 판본이 같아 보이고, 지나간 판본의 저장이 통과한다.
 * 그래서 오고 가는 내내 텍스트로 두고, 비교는 Postgres 가 timestamptz 로 한다.
 *
 * 계정 키(BIGSERIAL)도 같은 이유로 문자열이다: 자릿수가 언젠가 JS 정수의 한계를
 * 넘고, 그때 조용히 다른 계정을 가리키게 된다.
 */
export class PostgresPersistence extends Persistence {
  private constructor(private readonly pool: pg.Pool) {
    super()
  }

  static open(databaseUrl: string): PostgresPersistence {
    return new PostgresPersistence(new pg.Pool({ connectionString: databaseUrl }))
  }

  async createUser(username: string, passwordHash: string): Promise<StoredUser | null> {
    // 유일성은 **쓰는 순간** 판정된다. 먼저 SELECT 로 확인하고 INSERT 하면 그
    // 사이에 다른 가입이 끼어들어 둘 다 통과한다 — 그 검사를 하는 것은 UNIQUE
    // 제약이고, 우리는 그것이 말한 23505 를 "이미 있다"로 옮길 뿐이다.
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO users (username, pw_hash) VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING
       RETURNING id::text AS id`,
      [username, passwordHash],
    )

    const row = result.rows[0]
    return row ? { id: row.id, username, passwordHash } : null
  }

  async findUser(username: string): Promise<StoredUser | null> {
    const result = await this.pool.query<{ id: string; username: string; pw_hash: string }>(
      'SELECT id::text AS id, username, pw_hash FROM users WHERE username = $1',
      [username],
    )

    const row = result.rows[0]
    return row ? { id: row.id, username: row.username, passwordHash: row.pw_hash } : null
  }

  async createSession(tokenHash: string, userId: string, expiresAt: number): Promise<void> {
    // epoch ms 를 timestamptz 로 넣는다 — 시각은 DB 가 시각으로 알아야 만료
    // 청소도 백업도 사람이 읽을 수 있다. 오고 가는 값은 숫자 하나뿐이다.
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES ($1, $2, to_timestamp($3::double precision / 1000))`,
      [tokenHash, userId, expiresAt],
    )
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.pool.query<{ user_id: string; expires_at: string }>(
      `SELECT user_id::text AS user_id,
              (EXTRACT(EPOCH FROM expires_at) * 1000)::bigint::text AS expires_at
         FROM sessions WHERE token_hash = $1`,
      [tokenHash],
    )

    const row = result.rows[0]
    return row ? { userId: row.user_id, expiresAt: Number(row.expires_at) } : null
  }

  async extendSession(tokenHash: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET expires_at = to_timestamp($2::double precision / 1000)
        WHERE token_hash = $1`,
      [tokenHash, expiresAt],
    )
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash])
  }

  async createCharacter(userId: string, player: PlayerState): Promise<StoredCharacter | null> {
    // `ON CONFLICT DO NOTHING` 은 제약을 가리지 않는다 — 같은 키(id)든 이미
    // 캐릭터가 있는 계정(user_id UNIQUE)이든 0 행으로 돌아온다. 둘 다 답은
    // 같다: 만들지 않았고, 부르는 쪽은 이미 있는 것을 돌려준다(이중 제출).
    const result = await this.pool.query<{ version: string }>(
      `INSERT INTO characters (id, user_id, name, state) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING updated_at::text AS version`,
      [player.id, userId, player.name, player],
    )

    const row = result.rows[0]
    return row ? { player: decodeCharacter(player.id, player), version: row.version } : null
  }

  async deleteCharacter(id: string): Promise<void> {
    await this.pool.query('DELETE FROM characters WHERE id = $1', [id])
  }

  async readCharacter(id: string): Promise<StoredCharacter | null> {
    const result = await this.pool.query<{ state: unknown; version: string }>(
      'SELECT state, updated_at::text AS version FROM characters WHERE id = $1',
      [id],
    )

    const row = result.rows[0]
    if (!row) return null
    return { player: decodeCharacter(id, row.state), version: row.version }
  }

  async saveCharacter(
    player: PlayerState,
    expectedVersion?: CharacterVersion,
  ): Promise<CharacterVersion> {
    // 판본은 저장마다 **반드시** 달라져야 한다. clock_timestamp() 만 쓰면 시계
    // 해상도가 낮은 곳(윈도)에서 두 저장이 같은 값을 받을 수 있고, 그러면 이미
    // 지나간 판본으로 쓰는 요청이 검사를 통과한다. 1 마이크로초를 강제로 밀어
    // 그 가능성을 없앤다.
    const bump = `GREATEST(clock_timestamp(), characters.updated_at + interval '1 microsecond')`

    // 판본을 timestamptz 로 **되돌려 파싱하지 않고** 텍스트끼리 견준다. 이 값은
    // 우리가 `updated_at::text` 로 내준 불투명한 표이고, 부르는 쪽은 그것을 그대로
    // 돌려줄 뿐이라 같은 방식으로 찍은 글자와 견주는 것이 정확히 그 뜻이다.
    // `$4::timestamptz` 로 캐스팅하면 시각이 아닌 표가 들어왔을 때 Postgres 가
    // 문법 오류를 던져 500 이 된다 — 그건 "판본이 어긋났다"이지 서버 고장이
    // 아니다(계약 스위트가 잡은 차이다: JSON 구현은 같은 경우에 충돌을 냈다).
    //
    // 판본을 걸지 않아도 **INSERT 는 하지 않는다.** 캐릭터가 생기는 곳은
    // createCharacter 하나이고, 여기서 지어내면 주인(user_id) 없는 행이 생긴다.
    const guard = expectedVersion === undefined ? '' : ' AND characters.updated_at::text = $4'
    const params: unknown[] = [player.id, player, player.name]
    if (expectedVersion !== undefined) params.push(expectedVersion)

    const result = await this.pool.query<{ version: string }>(
      `UPDATE characters SET state = $2, name = $3, updated_at = ${bump}
        WHERE id = $1${guard}
        RETURNING updated_at::text AS version`,
      params,
    )

    // 0 행 = 그 사이 다른 요청이 저장했거나(판본이 어긋났다) 행이 없다.
    // 어느 쪽이든 내 계산은 지나간 상태 위의 것이라 그대로 쓰면 안 된다.
    const row = result.rows[0]
    if (!row) throw new CharacterConflictError(player.id)
    return row.version
  }

  async close(): Promise<void> {
    // SIGTERM 에 풀을 드레인한다 — 컨테이너가 멈출 때 쓰다 만 연결을 남기지 않는다.
    await this.pool.end()
  }
}
