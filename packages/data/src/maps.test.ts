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

/** 게임이 맵마다 요구하는 것을 다 갖춘 최소 맵 — 타일셋, ground·walls, spawn. */
function map(instanceId: string, placeId?: string): string {
  const places = placeId ? `<objectgroup name="places"><object name="${placeId}" x="32" y="32"/></objectgroup>` : ''
  return `<?xml version="1.0"?><map width="2" height="2" tilewidth="32" tileheight="32">
 <tileset firstgid="1" name="pipoya-basechip" tilewidth="32" tileheight="32">
  <image source="x.png" width="256" height="2048"/></tileset>
 <layer name="ground" width="2" height="2"><data encoding="csv">1,1,1,1</data></layer>
 <layer name="walls" width="2" height="2"><data encoding="csv">0,0,0,0</data></layer>
 <objectgroup name="spawn"><object name="player" x="32" y="0"/></objectgroup>
 <objectgroup name="nodes"><object x="0" y="32">
  <properties><property name="nodeId" value="ice_vein"/><property name="instanceId" value="${instanceId}"/></properties>
 </object></objectgroup>${places}</map>`
}

const MAP_A = map('ice-1')
const MAP_B = map('ice-2')

const FILES: Record<string, string> = { 'a.tmx': MAP_A, 'b.tmx': MAP_B }
const read = (file: string): string => FILES[file] ?? ''

const ROWS = [
  { id: 'alpha', name: '알파', file: 'a.tmx' },
  { id: 'beta', name: '베타', file: 'b.tmx' },
]

describe('parseMaps', () => {
  // 왜: 맵 크기는 맵 파일에만 있는데, 검증과 서버가 "맵 안인가"를 물어야 한다.
  //     시작 칸도 마찬가지다 — 맵 옆의 spawn 오브젝트가 그 사실의 유일한 출처라야
  //     맵을 고쳐 그렸을 때 시작 칸이 따라 움직인다.
  it('맵 파일에서 크기와 시작 칸을 읽어 등록부에 싣는다', () => {
    const { maps } = parseMaps(ROWS, read, NODES)
    expect(maps['alpha']).toEqual({
      id: 'alpha', name: '알파', file: 'a.tmx', width: 2, height: 2, spawn: { x: 1, y: 0 },
    })
  })

  // 왜: 예전에는 build.ts 가 같은 .tmx 를 두 번 읽어 두 번 파싱했다 — 한 번은
  //     검증하려고, 한 번은 JSON 을 쓰려고. 맵이 수십 장이 되면 그만큼 두 배다.
  it('파싱한 맵 JSON 을 함께 돌려준다 — 빌드가 같은 파일을 두 번 읽지 않도록', () => {
    const { mapJson } = parseMaps(ROWS, read, NODES)
    expect(Object.keys(mapJson).sort()).toEqual(['alpha', 'beta'])
    expect(mapJson['alpha']?.layers.map((l) => l.name)).toContain('walls')
  })

  // 왜: 예전에는 build.ts 가 readFileSync 를 그대로 넘겨서, maps.csv 가 없는
  //     파일을 가리키면 ENOENT 스택 트레이스가 났다 — 여기 준비된 안내는
  //     테스트에서만 닿았다. 맵을 그리는 사람이 읽을 말이 나와야 한다.
  it('맵 파일을 못 읽으면 어느 행의 어느 파일인지 말한다', () => {
    const rows = [{ id: 'ghost', name: '유령', file: 'ghost.tmx' }]
    expect(() => parseMaps(rows, read, NODES)).toThrow(/ghost\.tmx/)
    expect(() => parseMaps(rows, read, NODES)).toThrow(/maps\//)
  })

  // 왜: 맵 파일 하나만 보는 파서들(parseTmx·parseTerrain·parseSpawn)은 자기가
  //     어느 맵인지 모른다. 맵이 두 장일 땐 짐작할 수 있지만 수십 장이 되면
  //     "타일셋이 없다" 만 듣고는 어느 파일을 열어야 할지 알 수 없다.
  it('맵 파일이 잘못됐으면 어느 맵의 어느 파일인지 앞에 붙인다', () => {
    const broken: Record<string, string> = {
      'c.tmx': MAP_A.replace(/ <layer name="walls"[\s\S]*?<\/layer>\n/, ''),
    }
    const rows = [{ id: 'gamma', name: '감마', file: 'c.tmx' }]
    expect(() => parseMaps(rows, (f) => broken[f] ?? '', NODES)).toThrow(
      /maps\.csv\[gamma\] \(c\.tmx\): .*walls/,
    )
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

  // 왜: 일과(.sched)는 맵을 적지 않고 지점 이름 하나로만 자리를 부른다 —
  //     그러려면 모든 맵의 지점이 한 등록부에 모여 있어야 한다.
  it('맵마다의 지점을 하나의 등록부로 모은다', () => {
    const files: Record<string, string> = { 'a.tmx': map('ice-1', '여관앞'), 'b.tmx': map('ice-2', '초소') }
    const { places } = parseMaps(ROWS, (f) => files[f] ?? '', NODES)
    expect(Object.keys(places).sort()).toEqual(['여관앞', '초소'])
    expect(places['여관앞']?.mapId).toBe('alpha')
    expect(places['초소']?.mapId).toBe('beta')
  })

  // 왜: 두 맵에 같은 이름이 있으면, 그 이름을 부른 일과가 어느 마을의 자리를
  //     뜻하는지 알 방법이 없다 — instanceId 가 전역으로 유일한 것과 같은 이유다.
  it('같은 지점 이름이 두 맵에 있으면 막는다', () => {
    const files: Record<string, string> = { 'a.tmx': map('ice-1', '광장'), 'b.tmx': map('ice-2', '광장') }
    expect(() => parseMaps(ROWS, (f) => files[f] ?? '', NODES)).toThrow(/광장/)
  })

  // 왜: 지형은 맵마다 따로 있어야 화자 배치 검증이 맵을 골라 볼 수 있다.
  it('맵마다 지형을 따로 돌려준다', () => {
    const { terrains } = parseMaps(ROWS, read, NODES)
    expect(Object.keys(terrains).sort()).toEqual(['alpha', 'beta'])
    expect(terrains['alpha']?.width).toBe(2)
  })
})
