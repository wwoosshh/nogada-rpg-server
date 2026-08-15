import type { MonsterDropTables } from '@nogada/shared'
import generated from './generated/monster-drops.json' with { type: 'json' }
import { deepFreeze } from './load.js'

// loadGameData·loadGatherTables 와 같은 싱글턴·동결 패턴이다(load.ts 참조).
const frozen = deepFreeze(generated) as MonsterDropTables

/**
 * 빌드된 몬스터 드랍표. **서버만 import 한다** — 패키지의 기본 진입(index.ts)에서
 * 내보내지 않고 별도 진입(`@nogada/data/monster-drops`)에만 있는 이유가 그것이다.
 *
 * 확률표(loadGatherTables)와 정확히 같은 자리·같은 이유다: 드랍 확률이 곧 숨은
 * 문턱이라(전투 §4, §7-앞 9 와 같은 근거) 클라이언트 번들에 실리는 순간 F12 로
 * 스포일된다. 몬스터의 패턴·배치는 반대로 GameData 에 실린다 — 화면이 그릴
 * 정보라 숨은 문턱이 아니다(types.ts 의 monsters 주석).
 */
export function loadMonsterDrops(): MonsterDropTables {
  return frozen
}
