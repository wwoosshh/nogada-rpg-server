import type { GameData } from '@nogada/shared'
import generated from './generated/gamedata.json' with { type: 'json' }

/** 빌드된 게임 데이터. 서버와 클라이언트가 모두 이 함수를 쓴다. */
export function loadGameData(): GameData {
  return generated as GameData
}
