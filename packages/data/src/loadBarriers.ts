import type { BarrierRegions } from '@nogada/shared'
import generated from './generated/barrier-regions.json' with { type: 'json' }
import { deepFreeze } from './load.js'

// loadGameData·loadGatherTables 와 같은 싱글턴·동결 패턴이다(load.ts 참조).
const frozen = deepFreeze(generated) as BarrierRegions

/**
 * 빌드된 결계 구역들. **서버만 import 한다** — 패키지의 기본 진입(index.ts)에서
 * 내보내지 않고 별도 진입(`@nogada/data/barriers`)에만 있는 이유가 그것이다.
 *
 * 확률표(loadGatherTables)와 같은 자리이되 이유가 조금 다르다. 저쪽은 브라켓
 * 경계가 곧 숨은 문턱이라 클라이언트가 보면 **스포일**된다. 이쪽에 감출 비밀은
 * 없다 — 벽은 클라이언트가 맵 JSON 으로 이미 그리고 있다. 그런데도 배럴에
 * 안 싣는 것은 **판정의 재료를 판정받는 쪽에 쥐여 줄 이유가 없기** 때문이다:
 * 화면은 벽으로 이미 밀리므로 이 표를 갖는다고 할 수 있는 일이 늘지 않는데,
 * 서버가 위조 요청을 거르는 근거만 번들에 복사된다.
 */
export function loadBarrierRegions(): BarrierRegions {
  return frozen
}
