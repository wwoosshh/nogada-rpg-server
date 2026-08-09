import { describe, expect, it } from 'vitest'
import { resolvePlayerLocation } from './location.js'
import type { GameData, PlayerLocation } from './types.js'

const data = {
  maps: {
    world: { id: 'world', name: '월드', file: 'w.tmx', width: 30, height: 30, spawn: { x: 15, y: 16 } },
    숲: { id: '숲', name: '숲', file: 's.tmx', width: 20, height: 15, spawn: { x: 10, y: 7 } },
  },
} as unknown as GameData

const start: PlayerLocation = { mapId: 'world', x: 15, y: 16 }

describe('resolvePlayerLocation', () => {
  it('실재하는 맵의 맵 안 칸은 그대로 둔다', () => {
    const here: PlayerLocation = { mapId: '숲', x: 3, y: 4 }
    expect(resolvePlayerLocation(data, here, start)).toEqual(here)
  })

  // 왜: 이것이 이 함수의 존재 이유다. 맵 id 를 개명하거나 maps.csv 의 행을
  //     지우면 옛 세이브가 없는 맵을 가리킨 채 남는다. 아무도 그것을 막지
  //     않았을 때 실제로 일어난 일: 클라이언트가 maps/<없는맵>.json 을 받으러
  //     갔다 404 를 맞고, 빈 Tilemap 을 세우고, addTilesetImage 가 null 을
  //     돌려주며 던진다 — 검은 화면이고 게임 안에서 빠져나올 방법이 없다.
  //     .data/ 를 지우는 것 말고는.
  it('없는 맵을 가리키면 시작 자리로 되돌린다', () => {
    const gone: PlayerLocation = { mapId: '없어진맵', x: 3, y: 4 }
    expect(resolvePlayerLocation(data, gone, start)).toEqual(start)
  })

  // 왜: 맵을 더 작게 고쳐 그리면 있던 칸이 맵 밖이 된다. 없는 맵만큼 요란하게
  //     깨지지는 않지만 결과는 비슷하다 — 걸을 수 없는 칸에 서서, 카메라
  //     경계 밖에서, 아무 방향으로도 못 간다.
  it('맵은 있는데 칸이 맵 밖이면 시작 자리로 되돌린다', () => {
    expect(resolvePlayerLocation(data, { mapId: '숲', x: 20, y: 0 }, start)).toEqual(start)
    expect(resolvePlayerLocation(data, { mapId: '숲', x: 0, y: 15 }, start)).toEqual(start)
    expect(resolvePlayerLocation(data, { mapId: '숲', x: -1, y: 0 }, start)).toEqual(start)
  })

  // 왜: 부르는 쪽(서버)이 "되돌렸는가"를 알아야 로그로 알릴 수 있다. 같은
  //     판정을 서버가 다시 하면 규칙이 두 곳에 생긴다.
  it('그대로 둘 때는 받은 객체를 그대로 돌려준다 — 부르는 쪽이 === 로 알 수 있게', () => {
    const here: PlayerLocation = { mapId: '숲', x: 3, y: 4 }
    expect(resolvePlayerLocation(data, here, start)).toBe(here)
    expect(resolvePlayerLocation(data, { mapId: '없어진맵', x: 0, y: 0 }, start)).not.toBe(start)
  })
})
