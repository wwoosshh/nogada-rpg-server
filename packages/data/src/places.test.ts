import { describe, expect, it } from 'vitest'
import type { GameData, PlaceDef, SpeakerDef, TransitionDef } from '@nogada/shared'
import { parsePlaces, validatePlaces } from './places.js'
import { type MapTerrain, parseTerrain } from './placements.js'
import { parseTmx } from './tmx.js'

interface PlaceSpec {
  id: string
  x: number
  y: number
  indoor?: string
  facing?: string
}

/**
 * 최소 맵 하나를 글자 그림으로 짓는다 — `#` 이 벽, `.` 이 빈 칸이다.
 *
 * 진짜 `.tmx` 를 파싱해 쓰는 것은 maps.test.ts 와 같은 이유다: parsePlaces 가
 * 실제로 받는 것은 parseTmx 의 결과이고, 손으로 지은 객체로만 테스트하면
 * Tiled 가 속성을 어떤 글자로 적는지(불리언이 "true" 문자열로 온다)를
 * 아무도 확인하지 않는다.
 */
function mapXml(rows: readonly string[], places: readonly PlaceSpec[]): string {
  const width = rows[0]?.length ?? 0
  const height = rows.length
  const walls = rows
    .flatMap((row) => [...row].map((c) => (c === '#' ? 1 : 0)))
    .join(',')
  const objects = places
    .map((p) => {
      const props = [
        p.indoor === undefined ? '' : `<property name="indoor" value="${p.indoor}"/>`,
        p.facing === undefined ? '' : `<property name="facing" value="${p.facing}"/>`,
      ].join('')
      const body = props ? `<properties>${props}</properties>` : ''
      return `<object name="${p.id}" x="${p.x * 32}" y="${p.y * 32}">${body}</object>`
    })
    .join('')

  return `<?xml version="1.0"?><map width="${width}" height="${height}" tilewidth="32" tileheight="32">
 <tileset firstgid="1" name="pipoya-basechip" tilewidth="32" tileheight="32">
  <image source="x.png" width="256" height="2048"/></tileset>
 <layer name="ground" width="${width}" height="${height}"><data encoding="csv">${rows.flatMap((r) => [...r].map(() => 1)).join(',')}</data></layer>
 <layer name="walls" width="${width}" height="${height}"><data encoding="csv">${walls}</data></layer>
 <objectgroup name="spawn"><object name="player" x="0" y="0"/></objectgroup>
 <objectgroup name="places">${objects}</objectgroup></map>`
}

function parse(rows: readonly string[], places: readonly PlaceSpec[]): Record<string, PlaceDef> {
  return parsePlaces(parseTmx(mapXml(rows, places)), '마을')
}

function terrainOf(rows: readonly string[]): Record<string, MapTerrain> {
  return { 마을: parseTerrain(parseTmx(mapXml(rows, []))) }
}

/** 지점 검증에 필요한 칸만 채운 GameData. 나머지는 이 검사가 보지 않는다. */
function dataOf(over: {
  places: Record<string, PlaceDef>
  speakers?: Record<string, SpeakerDef>
  transitions?: TransitionDef[]
  placements?: GameData['placements']
  schedules?: GameData['schedules']
}): GameData {
  return {
    shops: {}, masters: [], enhanceCosts: [], collection: {},
    items: {}, nodes: {}, recipes: {}, milestones: [], dialogue: [], routes: [],
    maps: { 마을: { id: '마을', name: '마을', file: 'a.tmx', width: 3, height: 3, spawn: { x: 0, y: 0 } } },
    transitions: over.transitions ?? [],
    placements: over.placements ?? {},
    speakers: over.speakers ?? {},
    places: over.places,
    schedules: over.schedules ?? {},
  }
}

function speaker(id: string, x: number, y: number): SpeakerDef {
  return { id, name: id, kind: 'npc', mapId: '마을', x, y, sprite: 'npc', facing: 'down' }
}

describe('parsePlaces', () => {
  // 왜: 지점은 맵이 소유한다 — 맵을 다시 그리면 지점이 눈에 보이는 곳에서 함께
  //     움직인다. 좌표를 맵 밖에 적으면 맵 수정이 지점을 벽 속에 남긴다.
  it('places 레이어의 오브젝트를 이름·칸·속성으로 읽는다', () => {
    const places = parse(['...', '...'], [{ id: '여관앞', x: 1, y: 1, facing: 'up' }])
    expect(places['여관앞']).toEqual({
      id: '여관앞', mapId: '마을', x: 1, y: 1, indoor: false, facing: 'up',
    })
  })

  // 왜: 대부분의 지점은 그냥 서 있는 자리다. 속성을 안 적었다고 파싱이
  //     실패하면 작가는 지점마다 두 속성을 의미 없이 채워야 한다.
  it('속성이 없으면 실외이고 방향은 없다 — 걸어온 쪽을 그대로 본다', () => {
    const places = parse(['..'], [{ id: '광장', x: 0, y: 0 }])
    expect(places['광장']).toMatchObject({ indoor: false, facing: null })
  })

  // 왜: indoor 는 "밤에 사라진다"를 뜻한다. Tiled 의 bool 속성은 "true"/"false"
  //     문자열로 오는데, 그것을 그냥 Boolean() 으로 읽으면 "false" 가 참이 된다.
  it('indoor 는 Tiled 가 적는 true/false 글자를 그대로 알아본다', () => {
    const places = parse(['..'], [
      { id: '여관안', x: 0, y: 0, indoor: 'true' },
      { id: '여관앞', x: 1, y: 0, indoor: 'false' },
    ])
    expect(places['여관안']?.indoor).toBe(true)
    expect(places['여관앞']?.indoor).toBe(false)
  })

  // 왜: 오브젝트 이름이 곧 지점 id 다. 이름 없이 찍힌 오브젝트는 일과가 부를
  //     방법이 없어서, 조용히 건너뛰면 작가는 지점을 찍었는데 없다고 듣는다.
  it('이름 없는 오브젝트는 어디에 있는지 짚어 거절한다', () => {
    expect(() => parse(['..'], [{ id: '', x: 1, y: 0 }])).toThrow(/이름/)
    expect(() => parse(['..'], [{ id: '', x: 1, y: 0 }])).toThrow(/1, 0/)
  })

  // 왜: 같은 이름이 둘이면 뒤엣것이 앞엣것을 조용히 덮어써서, 일과가 가리키는
  //     지점이 작가가 보는 지점과 달라진다.
  it('한 맵 안에서 같은 이름이 두 번 나오면 막는다', () => {
    expect(() => parse(['..'], [{ id: '광장', x: 0, y: 0 }, { id: '광장', x: 1, y: 0 }])).toThrow(/광장/)
  })

  // 왜: 적었는데 틀린 것은 막는다(speakers.csv 의 facing 과 같은 이유) —
  //     오타는 "그 NPC 만 엉뚱한 쪽을 본다"로 드러나는데 눈에 잘 안 띈다.
  it('알 수 없는 facing 은 무엇을 쓸 수 있는지와 함께 거절한다', () => {
    expect(() => parse(['..'], [{ id: '광장', x: 0, y: 0, facing: '북' }])).toThrow(/up/)
  })

  it('알 수 없는 indoor 값은 거절한다', () => {
    expect(() => parse(['..'], [{ id: '광장', x: 0, y: 0, indoor: '예' }])).toThrow(/indoor/)
  })

  // 왜: 일과를 안 쓰는 맵이 대부분이다. places 레이어가 없는 것은 정상이다.
  it('places 레이어가 없는 맵은 지점이 없을 뿐이다', () => {
    const xml = mapXml(['..'], []).replace(/<objectgroup name="places">[\s\S]*?<\/objectgroup>/, '')
    expect(parsePlaces(parseTmx(xml), '마을')).toEqual({})
  })
})

describe('validatePlaces', () => {
  it('빈 칸에 놓인 지점은 위반이 없다', () => {
    const places = parse(['...', '...'], [{ id: '광장', x: 1, y: 1 }])
    expect(validatePlaces(dataOf({ places }), terrainOf(['...', '...']))).toEqual([])
  })

  // 왜: 서 있는 NPC 는 그 칸을 차지한다 — 벽 속에 선 NPC 는 말을 걸 수도 없다.
  it('벽 칸에 놓인 지점을 막는다', () => {
    const rows = ['...', '.#.']
    const places = parse(rows, [{ id: '광장', x: 1, y: 1 }])
    const violations = validatePlaces(dataOf({ places }), terrainOf(rows))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/광장.*벽/)
  })

  it('맵 밖에 놓인 지점을 막는다', () => {
    const rows = ['..', '..']
    const places = parse(rows, [{ id: '광장', x: 5, y: 0 }])
    expect(validatePlaces(dataOf({ places }), terrainOf(rows))[0]).toMatch(/맵 밖/)
  })

  // 왜: 노드 칸에는 설 수 없다(클라이언트의 blocked). 그 칸을 향했을 때
  //     무엇이 반응할지도 정해지지 않는다 — validateSpeakerPlacements 와 같다.
  it('노드 칸에 놓인 지점을 막는다', () => {
    const rows = ['...']
    const places = parse(rows, [{ id: '광장', x: 1, y: 0 }])
    const data = dataOf({
      places,
      placements: { 'ice-1': { instanceId: 'ice-1', nodeId: 'ice', mapId: '마을', x: 1, y: 0 } },
    })
    expect(validatePlaces(data, terrainOf(rows))[0]).toMatch(/ice-1/)
  })

  // 왜: 정적 화자는 언제나 그 칸에 서 있다. 일과 NPC 가 그 칸에 와서 서면
  //     둘이 겹쳐, 말을 걸었을 때 누가 답할지 정해지지 않는다.
  it('정적 화자 칸에 놓인 지점을 막는다', () => {
    const rows = ['...']
    const places = parse(rows, [{ id: '광장', x: 1, y: 0 }])
    const data = dataOf({ places, speakers: { 간판: speaker('간판', 1, 0) } })
    expect(validatePlaces(data, terrainOf(rows))[0]).toMatch(/간판/)
  })

  // 왜: 일과가 있는 화자는 speakers.csv 의 칸에 서 있지 않는다 — 그 칸은
  //     자기 지점 중 하나일 수 있다. 자기 자리를 자기가 막았다고 말하면 안 된다.
  it('일과가 있는 화자 자신의 칸은 막지 않는다', () => {
    const rows = ['...']
    const places = parse(rows, [{ id: '여관앞', x: 1, y: 0 }])
    const data = dataOf({
      places,
      speakers: { 여관안주인: speaker('여관안주인', 1, 0) },
      schedules: {
        여관안주인: { speakerId: '여관안주인', entries: [{ arriveMinute: 360, placeIds: ['여관앞'] }] },
      },
    })
    expect(validatePlaces(data, terrainOf(rows))).toEqual([])
  })

  // 왜: 두 지점이 한 칸이면 두 NPC 가 겹쳐 서고, 무엇보다 그 칸을 두고
  //     "누가 서 있는가"가 시각마다 달라진다.
  it('두 지점이 같은 칸에 있으면 막는다', () => {
    const rows = ['...']
    const places = parse(rows, [{ id: '광장', x: 1, y: 0 }, { id: '광장앞', x: 1, y: 0 }])
    const violations = validatePlaces(dataOf({ places }), terrainOf(rows))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/광장/)
  })

  // 왜: 전환 칸에 선 NPC 는 문을 봉쇄한다 — 플레이어가 그 칸을 밟을 수 없으면
  //     맵을 넘어갈 방법이 사라진다(validateMapSpawns 와 같은 이유).
  it('전환 칸에 놓인 지점을 막는다', () => {
    const rows = ['...']
    const places = parse(rows, [{ id: '문앞', x: 0, y: 0 }])
    const data = dataOf({
      places,
      transitions: [{ fromMap: '마을', fromX: 0, fromY: 0, toMap: '들판', toX: 5, toY: 5, facing: null }],
    })
    expect(validatePlaces(data, terrainOf(rows))[0]).toMatch(/문앞.*전환/)
  })

  // 왜: 도착 칸도 마찬가지다 — 넘어오자마자 NPC 위에 서게 되고, 그 칸이
  //     막혀 있으면 넘어올 수조차 없다.
  it('전환 도착 칸에 놓인 지점을 막는다', () => {
    const rows = ['...']
    const places = parse(rows, [{ id: '문안', x: 2, y: 0 }])
    const data = dataOf({
      places,
      transitions: [{ fromMap: '들판', fromX: 9, fromY: 9, toMap: '마을', toX: 2, toY: 0, facing: null }],
    })
    expect(validatePlaces(data, terrainOf(rows))[0]).toMatch(/문안.*도착/)
  })
})
