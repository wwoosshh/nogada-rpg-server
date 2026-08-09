import type { GameData, PlayerLocation } from './types.js'

/**
 * 세이브에 적힌 자리가 지금도 실재하는가 — 아니면 시작 자리로 되돌린다.
 *
 * **왜 이것이 규칙인가:** "네 맵이 없어졌으면 너는 시작 지점에 있다" 는
 * 플레이어 상태를 정하는 판정이라 서버가 적용한다. 계산은 여기 있다 — 게임
 * 규칙은 packages/shared 에만 있고, 서버는 그것을 상태에 적용하는 유일한
 * 주인이다.
 *
 * **막는 것:** 콘텐츠는 계속 바뀌는데 세이브는 남는다. maps.csv 에서 맵 id 를
 * 바꾸거나 행을 지우면 그 맵을 가리키는 세이브가 남고, 아무도 그것을 보정하지
 * 않으면 클라이언트는 `maps/<없는맵>.json` 을 404 로 받은 뒤 빈 Tilemap 을
 * 세우고 `addTilesetImage` 가 null 을 돌려주는 자리에서 던진다 — 검은 화면이고
 * 게임 안에서 빠져나올 방법이 없다. 맵을 더 작게 고쳐 그렸을 때(칸이 맵 밖이
 * 된다)도 요란함만 덜할 뿐 결과는 같다: 걸을 수 없는 칸에, 카메라 경계 밖에서,
 * 아무 방향으로도 못 간다.
 *
 * `fallback` 을 인자로 받는 것은 시작 맵이 무엇인지가 packages/data 의 사실이기
 * 때문이다(`startLocation`). 이 패키지가 그것을 import 하면 게임 규칙이 데이터를
 * 향해 의존하기 시작한다.
 *
 * 되돌릴 것이 없으면 **받은 객체를 그대로** 돌려준다 — 부르는 쪽이 `===` 하나로
 * "되돌렸는가"를 알 수 있어야 같은 판정을 두 곳에서 하지 않는다.
 */
export function resolvePlayerLocation(
  data: GameData,
  location: PlayerLocation,
  fallback: PlayerLocation,
): PlayerLocation {
  const map = data.maps[location.mapId]
  if (!map) return { ...fallback }

  const inside =
    location.x >= 0 && location.y >= 0 && location.x < map.width && location.y < map.height
  return inside ? location : { ...fallback }
}
