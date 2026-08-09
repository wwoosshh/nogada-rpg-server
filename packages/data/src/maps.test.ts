import { describe, expect, it } from 'vitest'
import { parseMaps } from './maps.js'
import type { NodeDef } from '@nogada/shared'

const NODES: Record<string, NodeDef> = {
  ice_vein: {
    id: 'ice_vein', name: '얼음 광맥', skill: 'ice', tier: 1,
    requiredSkill: 0, baseChance: 0.5, skillGainMin: 1, skillGainMax: 1,
    yieldItem: 'ice_shard', yieldMin: 1, yieldMax: 1, actionIntervalMs: 500,
  } as NodeDef,
}

const MAP_A = `<?xml version="1.0"?><map width="2" height="2" tilewidth="32" tileheight="32">
 <layer name="walls" width="2" height="2"><data encoding="csv">0,0,0,0</data></layer>
 <objectgroup name="nodes"><object x="0" y="32">
  <properties><property name="nodeId" value="ice_vein"/><property name="instanceId" value="ice-1"/></properties>
 </object></objectgroup></map>`

const MAP_B = `<?xml version="1.0"?><map width="2" height="2" tilewidth="32" tileheight="32">
 <layer name="walls" width="2" height="2"><data encoding="csv">0,0,0,0</data></layer>
 <objectgroup name="nodes"><object x="0" y="32">
  <properties><property name="nodeId" value="ice_vein"/><property name="instanceId" value="ice-2"/></properties>
 </object></objectgroup></map>`

const FILES: Record<string, string> = { 'a.tmx': MAP_A, 'b.tmx': MAP_B }
const read = (file: string): string => FILES[file] ?? ''

const ROWS = [
  { id: 'alpha', name: '알파', file: 'a.tmx' },
  { id: 'beta', name: '베타', file: 'b.tmx' },
]

describe('parseMaps', () => {
  // 왜: 맵 크기는 맵 파일에만 있는데, 검증과 서버가 "맵 안인가"를 물어야 한다.
  it('맵 파일에서 크기를 읽어 등록부에 싣는다', () => {
    const { maps } = parseMaps(ROWS, read, NODES)
    expect(maps['alpha']).toEqual({ id: 'alpha', name: '알파', file: 'a.tmx', width: 2, height: 2 })
  })

  // 왜: 이것이 이 태스크의 존재 이유다. 두 맵의 (0,1) 이 같은 칸으로 뭉치면
  //     한쪽 노드가 조용히 사라진다.
  it('서로 다른 맵의 같은 좌표가 충돌하지 않는다', () => {
    const { placements } = parseMaps(ROWS, read, NODES)
    expect(Object.keys(placements).sort()).toEqual(['ice-1', 'ice-2'])
    expect(placements['ice-1']?.mapId).toBe('alpha')
    expect(placements['ice-2']?.mapId).toBe('beta')
    expect(placements['ice-1']).toMatchObject({ x: 0, y: 1 })
    expect(placements['ice-2']).toMatchObject({ x: 0, y: 1 })
  })

  // 왜: instanceId 는 맵을 넘어 전역으로 유일해야 한다 — 서버가 그것 하나로
  //     노드를 찾기 때문이다(gatherService).
  it('맵이 달라도 instanceId 가 겹치면 막는다', () => {
    const rows = [
      { id: 'alpha', name: '알파', file: 'a.tmx' },
      { id: 'beta', name: '베타', file: 'a.tmx' },
    ]
    expect(() => parseMaps(rows, read, NODES)).toThrow(/ice-1/)
  })

  // 왜: 지형은 맵마다 따로 있어야 화자 배치 검증이 맵을 골라 볼 수 있다.
  it('맵마다 지형을 따로 돌려준다', () => {
    const { terrains } = parseMaps(ROWS, read, NODES)
    expect(Object.keys(terrains).sort()).toEqual(['alpha', 'beta'])
    expect(terrains['alpha']?.width).toBe(2)
  })
})
