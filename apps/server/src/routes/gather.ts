import { randomInt } from 'node:crypto'
import { GatherRequestSchema, createRng, type GameData, type GatherTables } from '@nogada/shared'
import type { FastifyInstance } from 'fastify'
import { performGather } from '../services/gatherService.js'
import { requireAccount } from '../auth/sessions.js'
import { NO_CHARACTER, applyToCharacter } from '../state/applyToCharacter.js'
import type { Persistence } from '../state/persistence.js'

export function registerGatherRoutes(
  app: FastifyInstance,
  store: Persistence,
  data: GameData,
  tables: GatherTables,
): void {
  app.post('/api/gather', async (request, reply) => {
    const parsed = GatherRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ code: 'bad_request' })

    const result = await applyToCharacter(store, requireAccount(request).characterId, (player) =>
      performGather({
        player,
        data,
        tables,
        instanceId: parsed.data.instanceId,
        // 시드도 시각도 **판정할 때마다** 새로 만든다. 저장이 밀려 다시 읽으면
        // 그때는 새 상태 위에서 다시 굴려야 한다 — 지나간 상태에서 굴린 주사위를
        // 새 상태에 얹으면 그 결과는 아무 상태에도 속하지 않는다.
        //
        // 표 판정(gatherOutcome)이 roll 하나, 숙련 증가가 rollInt 하나 — 시도당
        // 뽑는 난수 개수가 옛 성공률 판정(0~2개)과 달라졌지만(G4), 그래도 무해한
        // 이유는 위와 같다: 시드가 시도마다 통째로 새로 만들어지므로 시도 사이에
        // 공유되는 난수 "잔량" 자체가 없다. 몇 번을 뽑든 한 시도 안에서 끝난다.
        rng: createRng(randomInt(0, 2 ** 31)),
        now: Date.now(),
      }),
    )

    if (!result.ok) {
      return reply.code(result.code === NO_CHARACTER ? 404 : 400).send({ code: result.code })
    }
    return result.outcome
  })
}
