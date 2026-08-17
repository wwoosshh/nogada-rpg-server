import { DEV_ONLY_MAP_IDS, WORLD_MAP_ID } from '@nogada/data'
import { slotLabelOf, type GameData } from '@nogada/shared'

/**
 * 전체화면 지도가 **무엇을 적는가**(설계 ⑤ 후반부·⑧-9) — React 없는 순수 조립.
 *
 * codexModel·shopModel 과 같은 자세다: 무엇을 적을지는 여기서 정하고, 그것을
 * 줄과 네모로 만드는 일은 MapPanel 의 몫이다. 그래서 이 파일이 내리는 판단은
 * 브라우저 없이 잴 수 있다 — **개발용 시험장이 목록에 없는가**도, **홉 수가 실제
 * 전환 그래프와 맞는가**도.
 *
 * **등록부가 이 화면의 진짜 이유다**(설계 ⑤). 월드맵에는 문이 넷뿐이고 채집장은
 * 하나도 월드맵에 없다 — 얼음·나무·광물·허브는 전부 마을에서 한 홉 더 들어가고,
 * 시작 맵조차 월드맵이 아니다. 그림만 보여 주는 지도는 플레이어가 실제로 가고
 * 싶은 곳을 한 곳도 못 찍는다.
 *
 * **손으로 적은 목록이 하나도 없다.** 장소도 홉도 「거기서 열리는 것」도 전부
 * `maps.csv`·`transitions.csv`·`shops.csv` 에서 유도한다 — 맵이 느는 날 등록부가
 * 저절로 늘어야 하고, 늘지 않는 목록은 그날부터 세계를 반만 말한다.
 */

/** 이정표 탭·띠·미니맵과 같은 자리표 — 「85,000」의 쉼표가 거기서 온다. */
const fmt = (n: number): string => n.toLocaleString('ko-KR')

/** 등록부 한 줄. */
export interface RegistryEntry {
  mapId: string
  /** `maps.csv` 의 이름 그대로 — 「눈의 마을」. */
  name: string
  /**
   * **여기서** 문을 몇 번 지나야 그곳인가. 0 이면 지금 서 있는 맵이다.
   *
   * 기준을 월드맵이 아니라 **플레이어가 선 자리**로 잡는 이유: 이 화면이 답하는
   * 물음이 「내가 어디 있는지 모르겠다」라서다. 월드맵 기준으로 재면 얼음채집장에
   * 선 사람이 「얼음 채집장 2홉」을 읽는다 — 자기가 서 있는 곳이 두 홉 떨어져
   * 있다고 적힌 목록은 그 물음에 답하지 않는다.
   */
  hops: number
  /**
   * 거기서 열리는 것 — 상점 요구치와 결계(설계 ⑤). 없으면 빈 배열이다.
   *
   * 없는 곳에 아무 말도 안 적는 이유는 사실 공급자의 자세와 같다: 자리표시를
   * 지어내지 않는다. 월드맵과 사냥터에는 오늘 열리는 것이 없고, 그것이 참이다.
   */
  opens: string[]
}

/**
 * 지도 그림 위에 얹는 이름표 하나 — 월드맵의 문 넷이다.
 *
 * **왜 그림에 이름을 붙이는가.** 265px 짜리 월드맵은 길·건물·호수·해안이
 * 또렷하지만(실측) 어느 덩어리가 눈의 마을인지는 한 글자도 말하지 않는다. 그
 * 그림은 지도가 아니라 무늬다. 미니맵이 같은 맵에서 이미 문 넷을 노란 네모로
 * 찍고 있으므로(minimap.ts), 더 큰 화면이 그보다 적게 말하면 전체화면이 축소도의
 * 하위 호환이 된다.
 *
 * **줄 선택 → 지도 강조 → 깃발 찍기는 아크 2다**(설계 ⑨). 이것은 그 예고가
 * 아니라 고정된 이름표 넷이고, 누를 수 없다.
 */
export interface WorldMapMark {
  mapId: string
  name: string
  /** 그림 폭·높이에 대한 백분율. 픽셀이 아닌 이유는 상자 크기가 화면에서 정해져서다. */
  leftPercent: number
  topPercent: number
}

/**
 * 맵과 맵을 잇는 문만 남긴 인접표 — **개발용 시험장은 뺀다**(설계 ⑤).
 *
 * `눈의마을,0,15 → 개발맵` 은 spawn 에서 15칸으로 목표인 북문(20칸)보다 가깝다.
 * 미니맵이 그 문을 안 찍는 것과 **같은 이유로** 등록부에도 안 적고, 홉 계산의
 * 지름길로도 쓰지 않는다 — 그 맵을 통과하는 길이 세워지면 「2홉」이 플레이어가
 * 실제로 걸을 길이 아니게 된다.
 *
 * **자기 자신으로 돌아오는 문(결계)은 이음이 아니다.** `fromMap === toMap` 인
 * 전환 넷은 한 맵 안의 벽이라, 여기 넣으면 자기 홉을 자기가 갱신하려 든다.
 *
 * **결계가 걸린 문을 걸러 내지 않는다 — 그래도 되는 것이 아니라 오늘 그런 문이
 * 없는 것이다.** 맵과 맵을 잇는 전환 스물넷에는 `gateSkill` 이 하나도 안 붙어
 * 있고(전수 확인), 그래서 홉 수는 숙련도와 무관한 수다. 그 사실이 깨지는 날
 * 먼저 말하도록 자를 걸어 두었다(worldMapModel.test.ts) — 그날 정할 것은 「못
 * 지나가는 문을 홉으로 셀 것인가」이고, 그것은 이 함수의 모양이 아니라 등록부가
 * 무엇을 뜻하는가의 문제다. 미니맵이 `gateTide` 앞에서 취한 자세와 같다.
 */
function doorGraph(data: GameData): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const id of Object.keys(data.maps)) {
    if (DEV_ONLY_MAP_IDS.includes(id)) continue
    graph.set(id, [])
  }
  for (const t of data.transitions) {
    if (t.fromMap === t.toMap) continue
    if (DEV_ONLY_MAP_IDS.includes(t.fromMap) || DEV_ONLY_MAP_IDS.includes(t.toMap)) continue
    const out = graph.get(t.fromMap)
    if (!out || out.includes(t.toMap)) continue
    out.push(t.toMap)
  }
  return graph
}

/**
 * 너비 우선 — 닿은 순서 그대로 돌려준다.
 *
 * 순서가 값인 이유는 아래 `spineOrder` 다: 홉이 같은 줄들의 차례를 무언가가
 * 정해야 하는데, 그 무언가가 `Object.keys(data.maps)`(= CSV 행 순서)이면 표를
 * 손보는 날 등록부의 차례가 소리 없이 바뀐다.
 */
function breadthFirst(graph: ReadonlyMap<string, readonly string[]>, start: string): Map<string, number> {
  const hops = new Map<string, number>()
  if (!graph.has(start)) return hops
  hops.set(start, 0)
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    const here = queue[i]!
    const depth = hops.get(here)!
    for (const next of graph.get(here) ?? []) {
      if (hops.has(next)) continue
      hops.set(next, depth + 1)
      queue.push(next)
    }
  }
  return hops
}

/**
 * 홉이 같은 줄들의 고정된 차례 — **월드맵에서 너비 우선으로 닿는 순서**다.
 *
 * 이 등뼈가 필요한 이유: 줄은 「여기서 몇 홉인가」로 정렬되는데 그 수는 걸을
 * 때마다 바뀌므로, 동점을 깨는 규칙이 없으면 문 하나를 지날 때마다 같은 홉의
 * 줄들이 자기들끼리 자리를 바꾼다. 세계의 생김새는 안 바뀌었는데 목록만 흔들리면
 * 읽는 사람은 그 흔들림을 정보로 오해한다.
 *
 * 하필 월드맵인 이유는 그것이 이 화면에 그려진 그림이기 때문이다 — 등록부의 첫
 * 묶음이 그림 자신이고, 그다음이 그림 위에 문이 찍힌 마을 넷이며, 그다음이 그
 * 마을에서 한 홉 더 들어가는 곳들이다. 설계 ⑤ 가 「월드맵 · 마을 4 · 채집장 4 ·
 * 사냥터」라고 적은 그 차례가 세계에서 저절로 나온다.
 */
function spineOrder(graph: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const order = new Map<string, number>()
  for (const [id] of breadthFirst(graph, WORLD_MAP_ID)) order.set(id, order.size)
  return order
}

/**
 * 이 맵에서 열리는 것들 — 상점과 결계.
 *
 * 상점의 자리는 **주인이 사는 맵**이다(`speaker.mapId`). 상점 자신은 맵을 적지
 * 않고 화자를 적으므로 그 한 다리를 건너야 하는데, 건너는 값이 이 등록부의
 * 요점이기도 하다: 네 계열 중 셋은 상점 주인이 채집장이 아니라 **마을**에 있고
 * (숲마을벌목꾼·광산노인·항구약초지기), 그것을 오늘 화면 어디서도 알 수 없다.
 *
 * 일과가 있는 화자(채집장노인)의 `mapId` 를 그대로 쓰는 이유: 그 사람의 하루는
 * 자기 맵 안에서만 돈다(입구 ↔ 심층광맥곁). 등록부가 답하는 것은 「지금 어느
 * 칸에 서 있는가」가 아니라 「어느 맵에 가면 그 상점이 있는가」다.
 *
 * **여관과 달인 대금은 안 적는다.** 설계 ⑤ 가 이 칸에 적기로 한 것은 상점
 * 요구치와 결계 둘이다 — 열리는 것을 다 적기 시작하면 이 칸이 두 번째 이정표
 * 탭이 되고, 그 탭은 이미 있다.
 */
function opensOn(data: GameData, mapId: string): string[] {
  const out: string[] = []

  for (const shop of Object.values(data.shops)) {
    const speaker = data.speakers[shop.speakerId]
    // 빌드가 이미 막았다(상점의 화자 참조 무결성) — 여기 닿았다면 데이터가 어긋난 것이다.
    if (!speaker) throw new Error(`상점 "${shop.id}" 의 화자 "${shop.speakerId}" 가 등록부에 없다`)
    if (speaker.mapId !== mapId) continue
    out.push(`${shop.name} — ${slotLabelOf(shop.skill)} ${fmt(shop.unlockSkill)}`)
  }

  for (const t of data.transitions) {
    if (t.fromMap !== mapId || t.gateSkill === undefined || t.gateValue === undefined) continue
    out.push(`결계 — ${slotLabelOf(t.gateSkill)} ${fmt(t.gateValue)}`)
  }

  return out
}

/**
 * 지금 서 있는 맵에서 본 등록부 — 홉 오름차순, 동점은 월드맵 등뼈 순서.
 *
 * **안 가 본 곳도 이름을 그대로 적는다 — `???` 도 안개 전쟁도 없다**(설계 ⑤).
 * 「잠긴 것까지 보이는 목록방」이 이 게임의 장치이고, 세이브에 `visited` 가
 * 없는 것은 부족이 아니라 결정이다(설계 ⑨ — 아크 2로 미룬 것도 그 필드다).
 */
export function mapRegistry(data: GameData, mapId: string): RegistryEntry[] {
  const graph = doorGraph(data)
  const spine = spineOrder(graph)
  const hops = breadthFirst(graph, mapId)

  const entries: RegistryEntry[] = []
  for (const id of graph.keys()) {
    const map = data.maps[id]
    // graph 의 키가 곧 `data.maps` 의 키라 이 분기는 참이 될 수 없다 — 그래도
    // 조용히 건너뛰지 않는 이유는 그날 목록이 한 줄 짧아진 채로 멀쩡해 보여서다.
    if (!map) throw new Error(`등록부: 맵 "${id}" 이 등록부에 없다`)
    const hop = hops.get(id)
    if (hop === undefined) {
      throw new Error(
        `등록부: "${mapId}" 에서 "${id}" 로 가는 길이 전환표에 없다 — ` +
          `빌드의 도달 가능성 검사(validateTransitions)가 이미 보는 사실이다`,
      )
    }
    entries.push({ mapId: id, name: map.name, hops: hop, opens: opensOn(data, id) })
  }

  return entries.sort((a, b) => a.hops - b.hops || (spine.get(a.mapId) ?? 0) - (spine.get(b.mapId) ?? 0))
}

/**
 * 그림 위의 이름표들 — 월드맵에서 나가는 문 넷.
 *
 * 자리는 **밟는 칸**(`fromX`·`fromY`)이다. 도착 칸이 아닌 이유는 미니맵의 문
 * 표식과 같다: 플레이어가 걸어가야 하는 자리가 그쪽이고, 도착 칸은 아예 다른
 * 맵의 좌표다.
 */
export function worldMapMarks(data: GameData): WorldMapMark[] {
  const map = data.maps[WORLD_MAP_ID]
  if (!map) throw new Error(`전체 지도: 맵 "${WORLD_MAP_ID}" 이 등록부에 없다`)

  const out: WorldMapMark[] = []
  for (const t of data.transitions) {
    if (t.fromMap !== WORLD_MAP_ID || DEV_ONLY_MAP_IDS.includes(t.toMap)) continue
    const to = data.maps[t.toMap]
    if (!to) throw new Error(`전환표가 가리키는 맵 "${t.toMap}" 이 등록부에 없다`)
    out.push({
      mapId: t.toMap,
      name: to.name,
      // 칸의 가운데다 — 미니맵의 tileToScreen 과 같은 이유(표식은 원점 0.5 의
      // 작은 도형이라 칸의 왼쪽 위에 놓으면 반 칸씩 쏠린다).
      leftPercent: ((t.fromX + 0.5) / map.width) * 100,
      topPercent: ((t.fromY + 0.5) / map.height) * 100,
    })
  }
  return out
}
