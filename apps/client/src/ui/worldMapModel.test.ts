import { DEV_ONLY_MAP_IDS, WORLD_MAP_ID, loadGameData } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { mapRegistry, worldMapMarks } from './worldMapModel.js'

/**
 * 전체화면 지도의 **등록부와 이름표**를 잰다(설계 ⑤ 후반부·⑧-9).
 *
 * 이 자가 못 재는 것을 먼저 적는다: **265px 짜리 월드맵이 알아볼 만한지, 열 줄이
 * 세로 265px 에 들어가는지는 브라우저에서만 보인다.** 여기 있는 것은 순수 함수
 * 둘이라 사람이 812×375 로 띄워 DOM 으로 재야 한다(태스크 보고에 적었다).
 *
 * 그래서 잡으려는 실패가 넷이다:
 * ① **개발용 시험장이 등록부에 서는 것** — 미니맵이 그 문을 안 찍는 이유와
 *    같다(spawn 에서 15칸이라 목표인 북문 20칸보다 가깝다). 목록에 이름이 적혀
 *    있으면 표식을 지운 값이 그 한 줄로 되돌아간다.
 * ② **손으로 적은 목록** — 장소도 홉도 「열리는 것」도 데이터에서 나와야 한다.
 *    맵이 느는 날 저절로 늘지 않는 등록부는 그날부터 세계를 반만 말한다.
 * ③ **홉 수가 실제 전환 그래프와 어긋나는 것** — 「2홉」이 걸어 보면 세 번이면
 *    그 숫자는 안내가 아니라 함정이다.
 * ④ **동점 줄이 걸을 때마다 자리를 바꾸는 것** — 세계는 안 바뀌었는데 목록만
 *    흔들리면 읽는 사람이 그 흔들림을 정보로 오해한다.
 */

const data = loadGameData()

/** 게임의 맵 — 개발용 시험장을 뺀 것. 등록부가 담아야 하는 전부다. */
const 게임맵들 = Object.keys(data.maps).filter((id) => !DEV_ONLY_MAP_IDS.includes(id))

describe('등록부 — 무엇이 실리는가', () => {
  it('개발용 시험장을 뺀 맵 전부가 실린다 — 열 장소다', () => {
    // 10 을 그대로 적는 것은 설계 ⑤ 가 「10장소(월드맵 · 마을 4 · 채집장 4 ·
    // 사냥터)」라고 센 수와 오늘의 데이터가 같은지 묻기 위해서다. 그 옆에 유도값
    // 비교를 함께 두어, 맵이 느는 날 이 자는 "10 이 아니다"가 아니라 "유도와
    // 맞다"로 남는다 — 앞줄만 고치면 된다.
    const entries = mapRegistry(data, '눈의마을')
    expect(게임맵들).toHaveLength(10)
    expect(entries.map((e) => e.mapId).sort()).toEqual([...게임맵들].sort())
  })

  it('개발용 시험장이 없다 — 이름도 홉도 적지 않는다', () => {
    // 마을 넷 어디에서 봐도 없어야 한다. 개발맵 문은 눈의마을에만 붙어 있으므로
    // 거기서 보는 등록부가 이 자의 진짜 표본이다.
    for (const from of 게임맵들) {
      const ids = mapRegistry(data, from).map((e) => e.mapId)
      for (const dev of DEV_ONLY_MAP_IDS) expect(ids).not.toContain(dev)
    }
  })

  it('이름은 maps.csv 그대로다 — 화면이 두 번째 사본을 갖지 않는다', () => {
    for (const entry of mapRegistry(data, WORLD_MAP_ID)) {
      expect(entry.name).toBe(data.maps[entry.mapId]?.name)
    }
  })
})

describe('등록부 — 홉', () => {
  it('서 있는 맵이 0 홉이다', () => {
    for (const from of 게임맵들) {
      const here = mapRegistry(data, from).find((e) => e.mapId === from)
      expect(here?.hops).toBe(0)
    }
  })

  it('눈의마을에서 잰 홉이 실제 전환 그래프와 맞는다', () => {
    // 손으로 세어 적는다 — 이 자가 계산을 다시 짜면 같은 실수를 두 번 하고도
    // 초록이 된다. 눈의마을 → 얼음채집장·사냥터·월드맵이 한 홉, 월드맵 너머
    // 마을 셋이 두 홉, 그 마을의 채집장이 세 홉이다.
    const hops = new Map(mapRegistry(data, '눈의마을').map((e) => [e.mapId, e.hops]))
    expect(Object.fromEntries(hops)).toEqual({
      눈의마을: 0,
      얼음채집장: 1,
      사냥터: 1,
      월드맵: 1,
      북동쪽마을: 2,
      숲의마을: 2,
      항구마을: 2,
      광물채굴장: 3,
      나무수렵장: 3,
      허브채집장: 3,
    })
  })

  it('문 하나를 지나면 홉이 정확히 하나 움직인다 — 그래프와 목록이 같은 세계다', () => {
    // 위 표가 눈의마을 한 자리만 재므로, 나머지 아홉 자리는 이 불변식이 지킨다:
    // 이웃한 두 맵에서 잰 같은 목적지의 홉 차이는 1 을 넘을 수 없다.
    for (const t of data.transitions) {
      if (t.fromMap === t.toMap) continue
      if (DEV_ONLY_MAP_IDS.includes(t.fromMap) || DEV_ONLY_MAP_IDS.includes(t.toMap)) continue
      const a = new Map(mapRegistry(data, t.fromMap).map((e) => [e.mapId, e.hops]))
      const b = new Map(mapRegistry(data, t.toMap).map((e) => [e.mapId, e.hops]))
      for (const [id, hop] of a) expect(Math.abs(hop - b.get(id)!)).toBeLessThanOrEqual(1)
    }
  })

  it('맵과 맵을 잇는 문에는 결계가 하나도 없다 — 홉이 숙련도와 무관한 수인 근거다', () => {
    // 오늘 참인 사실을 자로 묶어 둔다(미니맵이 `gateTide` 앞에서 취한 자세다).
    // 이것이 빨개지는 날 정할 것은 「못 지나가는 문을 홉으로 셀 것인가」이고,
    // 그때까지 등록부의 숫자는 "누구든 그만큼 걸으면 닿는다"를 뜻한다.
    const 결계낀이음 = data.transitions.filter(
      (t) => t.fromMap !== t.toMap && (t.gateSkill !== undefined || t.gateTide),
    )
    expect(결계낀이음).toEqual([])
  })
})

describe('등록부 — 차례', () => {
  it('홉 오름차순이다', () => {
    for (const from of 게임맵들) {
      const hops = mapRegistry(data, from).map((e) => e.hops)
      expect(hops).toEqual([...hops].sort((a, b) => a - b))
    }
  })

  it('동점의 차례는 어디에 서 있든 같다 — 월드맵 등뼈 하나가 정한다', () => {
    // 걷는 동안 흔들리면 안 되는 것이 이 차례다. 홉이 같은 줄들끼리의 상대
    // 순서를 두 자리에서 비교한다 — 다르면 목록이 문 하나를 지날 때마다 섞인다.
    const 등뼈 = mapRegistry(data, WORLD_MAP_ID).map((e) => e.mapId)
    const 등뼈색인 = (id: string): number => 등뼈.indexOf(id)
    for (const from of 게임맵들) {
      const entries = mapRegistry(data, from)
      for (let i = 1; i < entries.length; i++) {
        const prev = entries[i - 1]!
        const cur = entries[i]!
        if (prev.hops !== cur.hops) continue
        expect(등뼈색인(prev.mapId)).toBeLessThan(등뼈색인(cur.mapId))
      }
    }
  })

  it('월드맵에서 보면 설계 ⑤ 의 차례 그대로다 — 그림 · 문이 찍힌 마을 넷 · 그 너머', () => {
    const entries = mapRegistry(data, WORLD_MAP_ID)
    expect(entries[0]?.mapId).toBe(WORLD_MAP_ID)
    expect(entries.slice(1, 5).map((e) => e.mapId)).toEqual([
      '눈의마을',
      '북동쪽마을',
      '숲의마을',
      '항구마을',
    ])
    expect(entries.slice(5).every((e) => e.hops === 2)).toBe(true)
  })
})

describe('등록부 — 거기서 열리는 것', () => {
  it('상점은 주인이 사는 맵에 적힌다 — 넷 중 셋은 채집장이 아니라 마을이다', () => {
    // 이 한 줄이 등록부가 오늘 화면 어디서도 알 수 없는 것을 말하는 자리다.
    const 어디에 = (shopId: string): string[] =>
      mapRegistry(data, WORLD_MAP_ID)
        .filter((e) => e.opens.some((line) => line.startsWith(`${data.shops[shopId]!.name} —`)))
        .map((e) => e.mapId)
    expect(어디에('얼음상점')).toEqual(['얼음채집장'])
    expect(어디에('나무상점')).toEqual(['숲의마을'])
    expect(어디에('광물상점')).toEqual(['북동쪽마을'])
    expect(어디에('허브상점')).toEqual(['항구마을'])
    expect(어디에('사냥상점')).toEqual(['눈의마을'])
  })

  it('요구치는 shops.csv 의 숫자 그대로다', () => {
    const 얼음채집장 = mapRegistry(data, '눈의마을').find((e) => e.mapId === '얼음채집장')!
    expect(얼음채집장.opens).toContain('얼음 상점 — 얼음 5,000')
    const 눈의마을 = mapRegistry(data, '눈의마을').find((e) => e.mapId === '눈의마을')!
    // 사냥 판로는 눈금이 전투라 숫자도 다르다(1,000) — 계열 이름표가 없으면
    // 「사냥꾼의 계산대 5,000」 처럼 읽힐 자리다.
    expect(눈의마을.opens).toContain('사냥꾼의 계산대 — 전투 1,000')
  })

  it('결계 넷이 각자의 채집장에 적힌다 — 85,000 은 오늘 벽 앞에 서야만 보인다', () => {
    const 결계 = new Map(
      mapRegistry(data, WORLD_MAP_ID).map((e) => [e.mapId, e.opens.filter((l) => l.startsWith('결계'))]),
    )
    expect(결계.get('얼음채집장')).toEqual(['결계 — 얼음 85,000'])
    expect(결계.get('나무수렵장')).toEqual(['결계 — 나무 85,000'])
    expect(결계.get('광물채굴장')).toEqual(['결계 — 광물 85,000'])
    expect(결계.get('허브채집장')).toEqual(['결계 — 허브 85,000'])
  })

  it('열리는 것이 없는 곳에는 아무 말도 안 적는다 — 자리표시를 지어내지 않는다', () => {
    const opens = new Map(mapRegistry(data, WORLD_MAP_ID).map((e) => [e.mapId, e.opens]))
    expect(opens.get(WORLD_MAP_ID)).toEqual([])
    expect(opens.get('사냥터')).toEqual([])
  })

  it('열리는 것의 수가 데이터와 맞는다 — 줄이 조용히 사라지면 잡는다', () => {
    const 상점수 = Object.keys(data.shops).length
    const 결계수 = data.transitions.filter((t) => t.gateSkill !== undefined).length
    const 적힌수 = mapRegistry(data, WORLD_MAP_ID).reduce((n, e) => n + e.opens.length, 0)
    expect(적힌수).toBe(상점수 + 결계수)
  })
})

describe('지도 그림 위의 이름표', () => {
  it('월드맵에서 나가는 문마다 하나씩 — 마을 넷이다', () => {
    const marks = worldMapMarks(data)
    expect(marks.map((m) => m.mapId)).toEqual(['눈의마을', '북동쪽마을', '숲의마을', '항구마을'])
    for (const mark of marks) expect(mark.name).toBe(data.maps[mark.mapId]?.name)
  })

  it('개발용 시험장으로 가는 문에는 이름표가 없다', () => {
    // 오늘 그 문은 월드맵이 아니라 눈의마을에 붙어 있어 이 목록에 들어올 길이
    // 없다. 그래도 거르는 이유는 미니맵과 같다 — 언젠가 월드맵에 뒷문을 하나
    // 그리는 날, 그 한 줄이 없으면 이름표가 먼저 선다.
    for (const mark of worldMapMarks(data)) {
      expect(DEV_ONLY_MAP_IDS).not.toContain(mark.mapId)
    }
  })

  it('이름표는 그림 안에 있다 — 밟는 칸의 가운데다', () => {
    const world = data.maps[WORLD_MAP_ID]!
    for (const mark of worldMapMarks(data)) {
      const door = data.transitions.find((t) => t.fromMap === WORLD_MAP_ID && t.toMap === mark.mapId)!
      expect(mark.leftPercent).toBeCloseTo(((door.fromX + 0.5) / world.width) * 100, 6)
      expect(mark.topPercent).toBeCloseTo(((door.fromY + 0.5) / world.height) * 100, 6)
      expect(mark.leftPercent).toBeGreaterThan(0)
      expect(mark.leftPercent).toBeLessThan(100)
      expect(mark.topPercent).toBeGreaterThan(0)
      expect(mark.topPercent).toBeLessThan(100)
    }
  })
})
