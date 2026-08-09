import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodeDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { parsePlacements, parseSpawn, parseTerrain } from './placements.js'
import { parseTmx } from './tmx.js'

const nodes: Record<string, NodeDef> = {
  copper_vein: {
    id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1,
    baseChance: 0.5, yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3,
    skillGainMin: 1, skillGainMax: 2,
  },
}

/** 타일 32px 기준으로 타일 좌표 (tx,ty) 의 중심 픽셀 좌표를 만든다. */
function mapWith(objects: unknown[]): unknown {
  return { tilewidth: 32, tileheight: 32, layers: [{ name: 'nodes', type: 'objectgroup', objects }] }
}

function obj(instanceId: string, nodeId: string, tx: number, ty: number): unknown {
  return {
    x: tx * 32 + 16,
    y: ty * 32 + 16,
    properties: [
      { name: 'nodeId', value: nodeId },
      { name: 'instanceId', value: instanceId },
    ],
  }
}

describe('parsePlacements', () => {
  it('픽셀 좌표를 타일 좌표로 바꾼다', () => {
    const r = parsePlacements(mapWith([obj('copper_vein-1', 'copper_vein', 13, 15)]), nodes, 'world')
    expect(r['copper_vein-1']).toEqual({
      instanceId: 'copper_vein-1', nodeId: 'copper_vein', mapId: 'world', x: 13, y: 15,
    })
  })

  it('노드 오브젝트가 없는 맵도 정상이다', () => {
    expect(parsePlacements(mapWith([]), nodes, 'world')).toEqual({})
  })

  it('nodes 레이어가 아예 없어도 정상이다', () => {
    expect(parsePlacements({ tilewidth: 32, tileheight: 32, layers: [] }, nodes, 'world')).toEqual({})
  })

  it('instanceId 가 겹치면 던진다', () => {
    // 겹치면 뒤엣것이 앞엣것을 덮어써서 노드 하나가 조용히 사라진다.
    const m = mapWith([
      obj('dup', 'copper_vein', 1, 1),
      obj('dup', 'copper_vein', 2, 2),
    ])
    expect(() => parsePlacements(m, nodes, 'world')).toThrow(/instanceId/)
  })

  it('instanceId 가 없으면 던진다', () => {
    const m = mapWith([{ x: 48, y: 48, properties: [{ name: 'nodeId', value: 'copper_vein' }] }])
    expect(() => parsePlacements(m, nodes, 'world')).toThrow(/instanceId/)
  })

  it('없는 nodeId 를 가리키면 던진다', () => {
    const m = mapWith([obj('ghost-1', 'ghost_vein', 1, 1)])
    expect(() => parsePlacements(m, nodes, 'world')).toThrow(/ghost_vein/)
  })

  it('두 노드가 같은 칸에 있으면 던진다', () => {
    // 한 칸에 둘이 있으면 앞칸 판정이 어느 쪽을 고를지 정해지지 않는다.
    const m = mapWith([
      obj('a', 'copper_vein', 4, 4),
      obj('b', 'copper_vein', 4, 4),
    ])
    // 어느 맵의 어느 칸인지까지 말해야 작가가 그 맵을 열 수 있다.
    expect(() => parsePlacements(m, nodes, 'world')).toThrow(/맵 world 의 같은 칸/)
  })
})

describe('parseTerrain', () => {
  // 화자 배치(speakers.csv)가 벽 속이나 맵 밖을 가리키는지 검증하려면 맵이
  // "어디까지가 맵이고 어디가 벽인가"를 알려줘야 한다. 그 기준은 클라이언트의
  // 걷기 판정과 같아야 한다 — walls 레이어의 비어 있지 않은 타일이 벽이다.

  /** ground·walls 를 갖춘 최소 맵. data 는 행 우선(row-major) 타일 id 배열이다. */
  function mapWithWalls(width: number, height: number, data: number[]): unknown {
    return {
      width, height, tilewidth: 32, tileheight: 32,
      layers: [
        { name: 'ground', type: 'tilelayer', width, height, data: data.map(() => 1) },
        { name: 'walls', type: 'tilelayer', width, height, data },
      ],
    }
  }

  it('맵 크기를 읽는다', () => {
    const t = parseTerrain(mapWithWalls(2, 2, [0, 0, 0, 0]))
    expect(t.width).toBe(2)
    expect(t.height).toBe(2)
  })

  it('walls 레이어의 비어 있지 않은 타일만 벽으로 센다', () => {
    // 0 은 "타일 없음"이다. 0 까지 벽으로 세면 맵 전체가 벽이 되어 모든 화자가 오탐된다.
    const t = parseTerrain(mapWithWalls(2, 2, [0, 7, 0, 0]))
    expect([...t.walls]).toEqual(['1,0'])
  })

  // 왜: walls 가 없으면 예전엔 빈 집합이 조용히 나왔고, 그 순간 이 맵을 향한
  //     "도착 칸이 벽이다"·"화자가 벽 칸에 놓였다" 검사가 **전부 통과**한다 —
  //     안전망이 사라지는 것이 레이어가 없다는 사실보다 나쁘다. 그러고 나서
  //     클라이언트가 walls 레이어를 못 찾아 그 자리에서 던진다.
  it('walls 레이어가 없으면 던진다 — 벽 검사 전체가 조용히 통과해 버린다', () => {
    const map = {
      width: 3, height: 3, tilewidth: 32, tileheight: 32,
      layers: [{ name: 'ground', type: 'tilelayer', width: 3, height: 3, data: Array(9).fill(1) }],
    }
    expect(() => parseTerrain(map)).toThrow(/walls/)
  })

  // 왜: 클라이언트는 ground 를 필수로 찾고 없으면 던진다(WorldScene.create).
  //     빌드가 같은 것을 요구하지 않으면 맵을 그린 사람은 게임에 들어가서야 안다.
  it('ground 레이어가 없으면 던진다', () => {
    const map = {
      width: 3, height: 3, tilewidth: 32, tileheight: 32,
      layers: [{ name: 'walls', type: 'tilelayer', width: 3, height: 3, data: Array(9).fill(0) }],
    }
    expect(() => parseTerrain(map)).toThrow(/ground/)
  })

  it('실제 맵을 읽는다', () => {
    // world.json 은 이제 생성물이라 저장소에 없다(Task 1) — 정본인 .tmx 를
    // 직접 parseTmx 로 읽는다. build.ts 가 하는 것과 같은 경로다.
    const here = dirname(fileURLToPath(import.meta.url))
    const mapJson = parseTmx(readFileSync(join(here, '..', 'maps', 'world.tmx'), 'utf8'))
    const t = parseTerrain(mapJson)
    expect(t.width).toBe(30)
    expect(t.height).toBe(30)
    expect(t.walls.size).toBeGreaterThan(0)
  })
})

/**
 * 맵의 spawn 오브젝트는 "이 맵에서는 여기서 시작한다"의 유일한 출처다.
 *
 * 예전에는 시작 칸 (15,16) 이 서버·프로토콜·시뮬레이터 세 곳에 글자로 박혀 있었고,
 * 그 셋을 서로 묶어 두는 테스트는 있어도 **맵에 묶어 두는 것**은 아무것도 없었다 —
 * 그 칸에 벽을 그리면 새 플레이어가 전부 벽 속에서 시작한다. 맵 옆에 있고 Tiled
 * 에서 눈으로 보이는 이 오브젝트가 그 사실의 자연스러운 자리다.
 */
describe('parseSpawn', () => {
  function mapWithSpawn(objects: unknown[]): unknown {
    return {
      tilewidth: 32, tileheight: 32,
      layers: [{ name: 'spawn', type: 'objectgroup', objects }],
    }
  }

  it('오브젝트의 픽셀 좌표를 타일 좌표로 바꾼다', () => {
    // Tiled 는 오브젝트를 격자에 딱 맞춰 놓지 않아 소수가 섞인다 — 내림이
    // 언제나 그 칸을 준다(parsePlacements 와 같은 계산이다).
    expect(parseSpawn(mapWithSpawn([{ name: 'player', x: 495.644, y: 523.935 }]))).toEqual({
      x: 15, y: 16,
    })
  })

  // 왜: 오브젝트가 없으면 예전 클라이언트는 조용히 (2,2) 에서 시작했다. 이제는
  //     이 값이 새 플레이어의 시작 칸이자 세이브 복구 지점이라, 없는 채로
  //     통과시키면 "어디서 시작하는지"를 아무도 모르는 맵이 생긴다.
  it('spawn 레이어가 없으면 무엇을 그려야 하는지 말하며 던진다', () => {
    expect(() => parseSpawn({ tilewidth: 32, tileheight: 32, layers: [] })).toThrow(/spawn/)
  })

  it('player 라는 이름의 오브젝트가 없으면 던진다', () => {
    expect(() => parseSpawn(mapWithSpawn([{ name: '시작', x: 32, y: 32 }]))).toThrow(/player/)
  })
})
