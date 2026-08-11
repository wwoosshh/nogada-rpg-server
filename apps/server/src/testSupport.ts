import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from './app.js'
import { LOCAL_PLAYER_ID } from './state/constants.js'

/**
 * 서버 테스트가 **앱을 어떻게 세우고 누구로 요청하는가**를 정하는 한 곳.
 *
 * 왜 모으는가: 지금 라우트 테스트 전부가 `app.inject` 를 직접 불러 암묵적으로
 * 'local' 플레이어가 된다. 계정이 들어오면(A2) 모든 요청에 `Authorization:
 * Bearer` 가 필요해지는데, 그때 서른세 개의 테스트를 각각 고치면 같은 기계적
 * 수정을 서른세 번 하고 한 번 틀린다. 신원을 여기 한 곳에 두면 그날 바뀌는
 * 파일은 이 파일 하나다 — 테스트가 확인하는 게임 동작은 손대지 않는다.
 */

/**
 * 임시 세이브 파일 위에 앱을 세운다. 임시 디렉터리는 `app.close()` 가 지운다 —
 * 테스트가 저장소 루트에 `.data/` 를 남기지 않게 하는 것이 원래 목적이었고,
 * 정리 시점을 앱 수명에 묶어 두면 테스트마다 뒷정리를 적을 필요가 없다.
 *
 * 지금은 기다릴 것이 없는데도 async 인 이유: 저장 계층이 비동기가 되고(A1)
 * 가입·로그인이 앞에 붙으면(A2) 이 함수는 반드시 비동기가 된다. 그때 호출부
 * 서른세 곳에 `await` 를 다시 뿌리지 않으려고 지금 한 번에 지불한다.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const dir = mkdtempSync(join(tmpdir(), 'nogada-'))
  const app = buildApp({ dataFile: join(dir, 'players.json') })
  app.addHook('onClose', async () => {
    rmSync(dir, { recursive: true, force: true })
  })
  return app
}

/** 테스트가 "이 사람으로" 요청을 보내는 손잡이. */
export interface TestPlayer {
  /**
   * 이 플레이어의 캐릭터 id. 응답 안의 id 를 단정할 때 쓴다 — 글자로 'local' 을
   * 적어 두면 계정이 들어와 id 가 달라지는 날 그 단정이 조용히 거짓이 된다.
   */
  readonly id: string
  /** 이 플레이어로 보내는 요청. 신원을 싣는 방법은 이 안에서만 바뀐다. */
  inject(options: InjectOptions): Promise<LightMyRequestResponse>
}

/**
 * 요청을 보낼 플레이어를 얻는다.
 *
 * 지금은 서버가 계정을 모르므로 모든 요청이 곧 `LOCAL_PLAYER_ID` 다 — 헤더 없이
 * 그냥 보낸다. A2 에서 이 함수가 가입·로그인을 수행하고 받은 토큰을 매 요청의
 * `Authorization` 헤더에 실으면, 테스트 본문은 한 줄도 바뀌지 않는다.
 */
export async function asPlayer(app: FastifyInstance): Promise<TestPlayer> {
  return {
    id: LOCAL_PLAYER_ID,
    inject: (options) => app.inject(options),
  }
}
