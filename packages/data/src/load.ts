import type { GameData } from '@nogada/shared'
import generated from './generated/gamedata.json' with { type: 'json' }

/**
 * 객체 그래프 전체를 재귀적으로 동결한다.
 *
 * import 된 JSON 모듈은 프로세스 전체가 공유하는 단일 객체다 — 어느 호출부가
 * 실수로 변형하면(정렬 전 배열이 아니라 레코드 자체를 고치는 식으로) 그 오염이
 * 이후의 모든 호출과 다른 요청에 그대로 새어 나간다. strict mode(ESM)에서는
 * 동결된 속성에 대입하면 조용히 무시되지 않고 던지므로, 실수를 그 자리에서
 * 바로 드러낸다.
 *
 * export 하는 이유: 서버 전용 산출물을 읽는 loadGatherTables.ts 도 같은 이유로
 * 같은 동결이 필요하다 — 두 벌로 적으면 한쪽만 고쳐져 갈라진다.
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

// generated 는 ESM 모듈 캐시가 한 번만 만드는 싱글턴이므로, 동결도 모듈 초기화 시점에
// 딱 한 번만 비용을 치른다 — loadGameData() 를 몇 번을 불러도 매번 다시 얼리지 않는다.
const frozen = deepFreeze(generated) as GameData

/** 빌드된 게임 데이터. 서버와 클라이언트가 모두 이 함수를 쓴다. 반환값은 깊이 동결돼 있다. */
export function loadGameData(): GameData {
  return frozen
}
