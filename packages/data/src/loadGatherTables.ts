import type { GatherTables } from '@nogada/shared'
import generated from './generated/gather-tables.json' with { type: 'json' }
import { deepFreeze } from './load.js'

// loadGameData 와 같은 싱글턴·동결 패턴이다(load.ts 참조).
const frozen = deepFreeze(generated) as GatherTables

/**
 * 빌드된 채집 확률표. **서버만 import 한다** — 패키지의 기본 진입(index.ts)에서
 * 내보내지 않고 별도 진입(`@nogada/data/gather-tables`)에만 있는 이유가 그것이다.
 *
 * 클라이언트는 index.ts 를 통째로 번들하므로, 이 모듈이 배럴에 실리는 순간
 * 브라켓 경계·잭팟 확률(곧 숨은 문턱, 설계 §7-앞 9)이 F12 로 스포일된다.
 * 트리 셰이킹이 지워 주기를 기대하는 것은 보장이 아니다 — 진입 자체를 나눠서
 * 클라이언트가 닿을 경로를 없앤다.
 */
export function loadGatherTables(): GatherTables {
  return frozen
}
