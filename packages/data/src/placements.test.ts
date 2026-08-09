import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodeDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { parsePlacements, parseTerrain } from './placements.js'
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
    const r = parsePlacements(mapWith([obj('copper_vein-1', 'copper_vein', 13, 15)]), nodes)
    expect(r['copper_vein-1']).toEqual({
      instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 13, y: 15,
    })
  })

  it('노드 오브젝트가 없는 맵도 정상이다', () => {
    expect(parsePlacements(mapWith([]), nodes)).toEqual({})
  })

  it('nodes 레이어가 아예 없어도 정상이다', () => {
    expect(parsePlacements({ tilewidth: 32, tileheight: 32, layers: [] }, nodes)).toEqual({})
  })

  it('instanceId 가 겹치면 던진다', () => {
    // 겹치면 뒤엣것이 앞엣것을 덮어써서 노드 하나가 조용히 사라진다.
    const m = mapWith([
      obj('dup', 'copper_vein', 1, 1),
      obj('dup', 'copper_vein', 2, 2),
    ])
    expect(() => parsePlacements(m, nodes)).toThrow(/instanceId/)
  })

  it('instanceId 가 없으면 던진다', () => {
    const m = mapWith([{ x: 48, y: 48, properties: [{ name: 'nodeId', value: 'copper_vein' }] }])
    expect(() => parsePlacements(m, nodes)).toThrow(/instanceId/)
  })

  it('없는 nodeId 를 가리키면 던진다', () => {
    const m = mapWith([obj('ghost-1', 'ghost_vein', 1, 1)])
    expect(() => parsePlacements(m, nodes)).toThrow(/ghost_vein/)
  })

  it('두 노드가 같은 칸에 있으면 던진다', () => {
    // 한 칸에 둘이 있으면 앞칸 판정이 어느 쪽을 고를지 정해지지 않는다.
    const m = mapWith([
      obj('a', 'copper_vein', 4, 4),
      obj('b', 'copper_vein', 4, 4),
    ])
    expect(() => parsePlacements(m, nodes)).toThrow(/같은 칸/)
  })
})

describe('parseTerrain', () => {
  // 화자 배치(speakers.csv)가 벽 속이나 맵 밖을 가리키는지 검증하려면 맵이
  // "어디까지가 맵이고 어디가 벽인가"를 알려줘야 한다. 그 기준은 클라이언트의
  // 걷기 판정과 같아야 한다 — walls 레이어의 비어 있지 않은 타일이 벽이다.

  /** walls 레이어 하나짜리 맵. data 는 행 우선(row-major) 타일 id 배열이다. */
  function mapWithWalls(width: number, height: number, data: number[]): unknown {
    return {
      width, height, tilewidth: 32, tileheight: 32,
      layers: [{ name: 'walls', type: 'tilelayer', width, height, data }],
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

  it('walls 레이어가 없으면 벽이 하나도 없다', () => {
    const t = parseTerrain({ width: 3, height: 3, layers: [] })
    expect(t.walls.size).toBe(0)
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
