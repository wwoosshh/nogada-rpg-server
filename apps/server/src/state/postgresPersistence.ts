import type { PlayerState } from '@nogada/shared'
import pg from 'pg'
import {
  CharacterConflictError,
  Persistence,
  decodeCharacter,
  type CharacterVersion,
  type StoredCharacter,
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
 */
export class PostgresPersistence extends Persistence {
  private constructor(private readonly pool: pg.Pool) {
    super()
  }

  static open(databaseUrl: string): PostgresPersistence {
    return new PostgresPersistence(new pg.Pool({ connectionString: databaseUrl }))
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

    if (expectedVersion === undefined) {
      const result = await this.pool.query<{ version: string }>(
        `INSERT INTO characters (id, state) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = ${bump}
         RETURNING updated_at::text AS version`,
        [player.id, player],
      )
      // RETURNING 이 있는 INSERT 는 반드시 한 행을 돌려준다.
      return result.rows[0]!.version
    }

    // 판본을 timestamptz 로 **되돌려 파싱하지 않고** 텍스트끼리 견준다. 이 값은
    // 우리가 `updated_at::text` 로 내준 불투명한 표이고, 부르는 쪽은 그것을 그대로
    // 돌려줄 뿐이라 같은 방식으로 찍은 글자와 견주는 것이 정확히 그 뜻이다.
    // `$3::timestamptz` 로 캐스팅하면 시각이 아닌 표가 들어왔을 때 Postgres 가
    // 문법 오류를 던져 500 이 된다 — 그건 "판본이 어긋났다"이지 서버 고장이
    // 아니다(계약 스위트가 잡은 차이다: JSON 구현은 같은 경우에 충돌을 냈다).
    const result = await this.pool.query<{ version: string }>(
      `UPDATE characters SET state = $2, updated_at = ${bump}
       WHERE id = $1 AND updated_at::text = $3
       RETURNING updated_at::text AS version`,
      [player.id, player, expectedVersion],
    )

    // 0 행 = 그 사이 다른 요청이 저장했거나(판본이 어긋났다) 행이 사라졌다.
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
