import {
  DEV_ONLY_MAP_IDS,
  emptyPlayer,
  loadGameData,
  startVillages,
  storyChainOf,
  villageField,
} from '@nogada/data'
import type { GameData, MapDef, PlayerState, StoryStepDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import {
  FLAG,
  MINIMAP,
  MINIMAP_INNER,
  MINIMAP_ORIGIN,
  flagGlyph,
  minimapFit,
  minimapMarks,
  tileToScreen,
} from './minimap.js'
import { BAND } from './questBand.js'

/**
 * 미니맵(설계 ⑤·⑧-7)이 **무엇을 어디에 얹는가**를 잰다.
 *
 * 이 자가 못 재는 것을 먼저 적는다: **그림이 실제로 나오는지는 브라우저에서만
 * 보인다.** 여기 있는 것은 순수 함수 둘(자리 계산과 표식 고르기)이라, 축소도가
 * 정말 (9,39) 에 서는지·흰 점이 걸을 때 따라오는지는 사람이 812×375 로 띄워
 * 봐야 한다(태스크 보고에 적었다).
 *
 * 그래서 잡으려는 실패가 넷이다:
 * ① **개발용 시험장 표식** — `눈의마을,0,15 → 개발맵` 은 spawn 에서 15칸이라
 *    목표인 북문(20칸)보다 가깝다. 찍는 순간 표식을 따라간 신규가 노드 13개짜리
 *    샌드박스에 들어간다. 이 자가 이 아크에서 가장 값이 크다.
 * ② 그림이 상자 밖으로 나가는 것 — contain-fit 이 깨지면 세계의 절반이 잘린다.
 * ③ 깃발이 유도등과 따로 노는 것 — `discoverable` 손잡이를 내려도 지도에는
 *    깃발이 남는 상태(설계 ⑥ 방어①이 반만 도는 것이다).
 * ④ 「가장 가까운」이 실제로 가장 가깝지 않은 것.
 */

const data = loadGameData()

/** 마을 넷 각각에서 태어난 사람 — questBand.test.ts 의 그 사람들이다. */
function 마을사람들(): { village: MapDef; player: PlayerState }[] {
  return startVillages(data).map((village) => {
    const player = emptyPlayer()
    player.location = { mapId: village.id, x: village.spawn.x, y: village.spawn.y }
    return { village, player }
  })
}

/** 그 사람이 마디 `step` 에, 그 자리에 서 있는 상태. */
function 마디에서(player: PlayerState, step: number, at?: PlayerState['location']): PlayerState {
  return { ...player, story: step, storyCount: 0, location: at ?? player.location }
}

/** 그 마을에서 자기 채집장으로 가는 문이 밟는 칸. */
function 채집장문(village: MapDef): { x: number; y: number } {
  const field = villageField(data, village.id)
  const door = data.transitions.find((t) => t.fromMap === village.id && t.toMap === field.map.id)
  expect(door, `${village.id} 에서 ${field.map.id} 로 가는 문이 없다`).toBeDefined()
  return { x: door!.fromX, y: door!.fromY }
}

/** 그 채집장에 걸어 들어가면 서는 칸(전환의 도착 칸). */
function 채집장도착칸(village: MapDef): PlayerState['location'] {
  const field = villageField(data, village.id)
  const door = data.transitions.find((t) => t.fromMap === village.id && t.toMap === field.map.id)!
  return { mapId: field.map.id, x: door.toX, y: door.toY }
}

describe('미니맵 — 자리', () => {
  it('띠와 같은 한 줄에서 시작하고 서로 안 겹친다', () => {
    // 이 둘이 헤더 밑 한 줄을 나눠 쓴다(설계 ⑤·⑧-6). questBand.ts 의 BAND 주석이
    // "자는 미니맵 태스크에서 두 자리를 함께 물려 세운다" 고 적어 둔 그 자리다 —
    // 그때까지 x=131 을 지키는 것은 사람 눈뿐이었다.
    expect(MINIMAP.y).toBe(BAND.y)
    expect(MINIMAP.x + MINIMAP.size).toBeLessThanOrEqual(BAND.x)
  })

  it('왼쪽 여백과 오른쪽 여백이 같다 — 설계 폭 812 에서', () => {
    // 미니맵 왼쪽에 남긴 만큼 띠 오른쪽에도 남는다(HudScene 의 EDGE_MARGIN_RIGHT).
    // 이 등식이 깨지면 한쪽만 화면 끝에 붙어 보인다.
    expect(BAND.x + BAND.width + MINIMAP.x).toBe(812)
  })

  it('안쪽 그림판이 테두리를 뺀 나머지다', () => {
    expect(MINIMAP_INNER).toBe(112)
    expect(MINIMAP_ORIGIN).toEqual({ x: MINIMAP.x + MINIMAP.border, y: MINIMAP.y + MINIMAP.border })
  })
})

describe('미니맵 — 배율', () => {
  it('맵 전부가 상자 안에 통째로 들어간다 — 잘리는 맵이 하나도 없다', () => {
    for (const map of Object.values(data.maps)) {
      const fit = minimapFit(map.width, map.height)
      expect(fit.width, map.id).toBeLessThanOrEqual(MINIMAP_INNER + 1e-9)
      expect(fit.height, map.id).toBeLessThanOrEqual(MINIMAP_INNER + 1e-9)
      // 그리고 **꽉 찬다** — 한 축은 반드시 안쪽 폭에 닿는다. 안 그러면 남는
      // 곳을 낭비하는 것이고, 배율이 더 커질 수 있었다는 뜻이다.
      const 닿음 = Math.abs(fit.width - MINIMAP_INNER) < 1e-9 || Math.abs(fit.height - MINIMAP_INNER) < 1e-9
      expect(닿음, `${map.id} 가 상자를 안 채운다`).toBe(true)
      // 여백은 남는 쪽을 반씩 나눈다.
      expect(fit.offsetX * 2 + fit.width).toBeCloseTo(MINIMAP_INNER, 9)
      expect(fit.offsetY * 2 + fit.height).toBeCloseTo(MINIMAP_INNER, 9)
    }
  })

  it('배율은 1.40~4.67px/타일 사이다 — 설계 ⑤ 가 실측으로 적어 둔 폭', () => {
    // 상자가 안 흔들리므로 레이아웃은 고정이지만 **배율은 맵마다 흔들린다**는 것이
    // 설계 ⑤ 의 전제다. 그 폭이 실제 맵들에서 나오는지를 여기서 못박는다 — 새 맵을
    // 그 밖으로 그리는 날(예: 200×200) 이 자가 먼저 말한다.
    const scales = Object.values(data.maps).map((map) => minimapFit(map.width, map.height).scale)
    expect(Math.min(...scales)).toBeCloseTo(1.4, 2)
    expect(Math.max(...scales)).toBeCloseTo(4.67, 2)
  })

  it('네 모서리 칸이 전부 상자 안에 찍힌다', () => {
    for (const map of Object.values(data.maps)) {
      const fit = minimapFit(map.width, map.height)
      for (const [x, y] of [[0, 0], [map.width - 1, 0], [0, map.height - 1], [map.width - 1, map.height - 1]]) {
        const at = tileToScreen(fit, x!, y!)
        expect(at.x, `${map.id} (${x},${y})`).toBeGreaterThanOrEqual(MINIMAP_ORIGIN.x)
        expect(at.x).toBeLessThanOrEqual(MINIMAP_ORIGIN.x + MINIMAP_INNER)
        expect(at.y).toBeGreaterThanOrEqual(MINIMAP_ORIGIN.y)
        expect(at.y).toBeLessThanOrEqual(MINIMAP_ORIGIN.y + MINIMAP_INNER)
      }
    }
  })
})

describe('미니맵 — 깃발 그림', () => {
  it('어느 맵 어느 칸에 세워도 상자를 안 넘는다 — 네 변 전부', () => {
    // 브라우저에서 실제로 넘겼다: 눈의마을 북문은 맨 윗줄(y=0)이라 위로 세운
    // 깃대가 상자 위 헤더 자리로 삐져나갔고, 화면에서는 테두리가 깨진 것으로
    // 보였다. 그때부터 이 자가 **모든 맵의 모든 칸**을 돈다.
    //
    // **처음엔 세로만 쟀다**(y 를 다 돌고 x 는 양 끝 두 줄만). 그래서 같은 사고의
    // 가로판 — 맨 오른쪽 칸에서 깃폭 8px 이 통째로 상자 밖으로 나가는 것 — 이
    // 열한 장 중 아홉 장에서 나는 채로 초록이었다. 항구마을 동문(59,13)과
    // 북동쪽마을 동문(74,10), 즉 시작 마을 넷 중 둘의 첫 60초가 거기 있었다.
    // 이제 **네 변을 다 재고 칸도 전부 돈다** — 맵 열한 장 다 합쳐 2만 칸이다.
    const left = MINIMAP_ORIGIN.x
    const right = MINIMAP_ORIGIN.x + MINIMAP_INNER
    const top = MINIMAP_ORIGIN.y
    const bottom = MINIMAP_ORIGIN.y + MINIMAP_INNER
    for (const map of Object.values(data.maps)) {
      const fit = minimapFit(map.width, map.height)
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const g = flagGlyph(fit, x, y)
          const 그곳 = `${map.id} (${x},${y})`

          // 깃대는 밑동에서 반대쪽 끝까지, 깃발은 그 끝에 매달린다.
          const 끝 = g.up ? g.y - FLAG.poleHeight : g.y + FLAG.poleHeight
          const 위 = Math.min(g.y, g.up ? 끝 : 끝 - FLAG.bannerHeight)
          const 아래 = Math.max(g.y, g.up ? 끝 + FLAG.bannerHeight : 끝)
          expect(위, `${그곳} 가 상자 위로 넘친다`).toBeGreaterThanOrEqual(top)
          expect(아래, `${그곳} 가 상자 아래로 넘친다`).toBeLessThanOrEqual(bottom)

          // 가로는 깃대(밑동을 가운데로 둔 굵기)와 깃폭(붙은 쪽에서 반대쪽으로)이다.
          const 깃폭붙는곳 = g.x + (g.right ? FLAG.bannerGap : -FLAG.bannerGap)
          const 깃폭끝 = 깃폭붙는곳 + (g.right ? FLAG.bannerWidth : -FLAG.bannerWidth)
          const 왼 = Math.min(g.x - FLAG.poleWidth / 2, 깃폭붙는곳, 깃폭끝)
          const 오른 = Math.max(g.x + FLAG.poleWidth / 2, 깃폭붙는곳, 깃폭끝)
          expect(왼, `${그곳} 가 상자 왼쪽으로 넘친다`).toBeGreaterThanOrEqual(left)
          expect(오른, `${그곳} 가 상자 오른쪽으로 넘친다`).toBeLessThanOrEqual(right)
        }
      }
    }
  })

  it('자리가 있으면 위로 세운다 — 뒤집기는 맨 윗줄에서만 일어난다', () => {
    // 뒤집기가 늘 켜져 있으면 위 검사도 통과한다(아래는 언제나 자리가 있다).
    // 그러면 깃발이 전부 거꾸로 달리므로, "언제 뒤집는가" 를 함께 못박는다.
    const fit = minimapFit(30, 31)
    expect(flagGlyph(fit, 15, 0).up, '맨 윗줄인데 위로 섰다').toBe(false)
    expect(flagGlyph(fit, 15, 15).up, '한가운데인데 뒤집혔다').toBe(true)
    expect(flagGlyph(fit, 15, 30).up, '맨 아랫줄인데 뒤집혔다').toBe(true)
  })

  it('자리가 있으면 깃폭을 오른쪽에 편다 — 왼쪽 매달기는 맨 오른쪽에서만', () => {
    // 위 검사의 가로판 짝이다. `right` 를 늘 false 로 두어도 넘침 검사는 통과하는
    // 맵이 대부분이라(왼쪽은 대개 자리가 있다), 깃발이 통째로 거꾸로 달리는 것을
    // 이 자가 막는다. 항구마을 60×40 — 동문이 x=59 다.
    const fit = minimapFit(60, 40)
    expect(flagGlyph(fit, 59, 13).right, '맨 오른쪽 칸인데 오른쪽으로 폈다').toBe(false)
    expect(flagGlyph(fit, 30, 13).right, '한가운데인데 왼쪽에 매달았다').toBe(true)
    expect(flagGlyph(fit, 0, 13).right, '맨 왼쪽 칸인데 왼쪽에 매달았다').toBe(true)
  })
})

describe('미니맵 — 문', () => {
  it('개발용 시험장으로 가는 문은 안 찍는다', () => {
    // 양성 대조군 먼저: 그 문이 실재한다. 없는 것을 안 찍는 것은 검사가 아니다.
    const 개발문 = data.transitions.filter((t) => DEV_ONLY_MAP_IDS.includes(t.toMap))
    expect(개발문.length, '개발맵으로 가는 문이 하나도 없다 — 이 자가 잴 것이 없다').toBeGreaterThan(0)

    for (const t of 개발문) {
      const doors = minimapMarks(data, null, t.fromMap).doors
      expect(
        doors.some((d) => d.x === t.fromX && d.y === t.fromY),
        `${t.fromMap} (${t.fromX}, ${t.fromY}) 의 개발맵 문이 찍혔다`,
      ).toBe(false)
    }
  })

  it('나머지 문은 전부 찍는다 — 결계 문도', () => {
    for (const mapId of Object.keys(data.maps)) {
      const expected = data.transitions.filter(
        (t) => t.fromMap === mapId && !DEV_ONLY_MAP_IDS.includes(t.toMap),
      )
      const doors = minimapMarks(data, null, mapId).doors
      expect(doors.length, mapId).toBe(expected.length)
      for (const t of expected) {
        expect(
          doors.some((d) => d.x === t.fromX && d.y === t.fromY),
          `${mapId} (${t.fromX}, ${t.fromY}) 이 빠졌다`,
        ).toBe(true)
      }
    }
  })

  it('숙련을 요구하는 문만 숫자를 적는다 — 쉼표까지', () => {
    let 잰것 = 0
    for (const mapId of Object.keys(data.maps)) {
      for (const door of minimapMarks(data, null, mapId).doors) {
        const t = data.transitions.find(
          (x) => x.fromMap === mapId && x.fromX === door.x && x.fromY === door.y,
        )!
        if (t.gateValue === undefined) {
          expect(door.gate, `${mapId} (${door.x}, ${door.y})`).toBeNull()
          continue
        }
        expect(door.gate).toBe(t.gateValue.toLocaleString('ko-KR'))
        잰것++
      }
    }
    // 양성 대조군 — 결계 넷이 그 숫자를 지고 있다(85,000 × 4).
    expect(잰것, '요구 숫자를 진 문이 하나도 없다').toBe(4)
  })

  it('찍히는 문 중에 물때만 걸린 것이 없다 — 생기는 날 표식이 거짓말을 시작한다', () => {
    // 표식은 `gateValue` 만 읽는다(doorsOn). 그러니 `gateTide` 로만 막힌 문은
    // 「지금 지나갈 수 있는 문」인 노란 네모로 찍힌다 — 요구치를 안 말하는 문은
    // 설계 ⑥ 의 장치가 아니라 함정이고, 시각은 플레이어가 올릴 수 있는 숫자도
    // 아니라 그 앞에 선 사람은 뭘 해야 할지 알 방법조차 없다.
    //
    // **`transitions` 전체가 아니라 실제로 찍히는 문만 본다.** 개발맵으로 가는 문은
    // 미니맵이 애초에 안 그리므로(설계 ⑤) 거기에 물때가 걸려도 화면은 거짓말을
    // 하지 않는다. 자가 물어야 하는 것은 데이터의 모양이 아니라 **화면이 참인가**다.
    //
    // 오늘 그런 문은 0개라 화면은 참이다 — 그 줄 하나(허브 결계)가 herb 85,000 도
    // 함께 져서 붉게 찍히기 때문이다. **이 자는 그 사실이 유지되는 동안만 조용하다.**
    const 거짓말 = []
    let 물때진문 = 0
    for (const mapId of Object.keys(data.maps)) {
      for (const door of minimapMarks(data, null, mapId).doors) {
        const t = data.transitions.find(
          (x) => x.fromMap === mapId && x.fromX === door.x && x.fromY === door.y,
        )!
        if (t.gateTide !== true) continue
        물때진문++
        if (door.gate === null) 거짓말.push(`${mapId} (${door.x},${door.y})`)
      }
    }
    expect(
      거짓말,
      '물때만 지는 문이 지나갈 수 있는 문으로 찍힌다 — minimap.ts 의 doorsOn 을 보라',
    ).toEqual([])

    // 양성 대조군: 찍히는 문 중에 물때를 지는 것이 실재한다(허브 결계). 없는 것이
    // 0 인 것은 검사가 아니다 — 그 칸이 사라진 날 이 줄이 먼저 말한다.
    expect(물때진문, '찍히는 문 중에 물때를 지는 것이 없다 — 이 자가 잴 것이 없다').toBeGreaterThan(0)
  })
})

describe('미니맵 — 깃발', () => {
  it('마을에 선 마디 0 은 채집장으로 나가는 문을 가리킨다 — 마을 넷 전부', () => {
    for (const { village, player } of 마을사람들()) {
      const flag = minimapMarks(data, 마디에서(player, 0), village.id).flag
      expect(flag, `${village.id} 에 깃발이 없다`).toEqual(채집장문(village))
    }
  })

  it('마을에 선 마디 1 도 채집장 문을 가리킨다 — 개발맵의 같은 노드에 안 홀린다', () => {
    // 개발맵에는 네 계열의 **보통** 노드가 다 놓여 있다. 그것을 후보에서 안 빼면
    // 계열마다 갈 곳이 둘(진짜 채집장·시험장)이 되어 깃발이 통째로 사라지거나
    // (맵이 하나로 안 정해진다) 더 나쁘게는 시험장을 가리킨다.
    const 개발노드 = Object.values(data.placements).filter(
      (p) => DEV_ONLY_MAP_IDS.includes(p.mapId) && data.nodes[p.nodeId]?.variant === 'normal',
    )
    expect(개발노드.length, '개발맵에 보통 노드가 없다 — 이 자가 잴 것이 없다').toBeGreaterThan(0)

    for (const { village, player } of 마을사람들()) {
      const flag = minimapMarks(data, 마디에서(player, 1), village.id).flag
      expect(flag, village.id).toEqual(채집장문(village))
    }
  })

  it('채집장에 선 마디 1 은 그 계열의 보통 노드 중 가장 가까운 것을 가리킨다', () => {
    for (const { village, player } of 마을사람들()) {
      const field = villageField(data, village.id)
      const 도착 = 채집장도착칸(village)
      const flag = minimapMarks(data, 마디에서(player, 1, 도착), field.map.id).flag
      expect(flag, `${field.map.id} 에 깃발이 없다`).not.toBeNull()

      const 후보 = Object.values(data.placements).filter(
        (p) =>
          p.mapId === field.map.id &&
          data.nodes[p.nodeId]?.skill === field.skill &&
          data.nodes[p.nodeId]?.variant === 'normal',
      )
      // 가리킨 곳이 실제 배치 중 하나다.
      expect(후보.some((p) => p.x === flag!.x && p.y === flag!.y), `${field.map.id}`).toBe(true)
      // 그리고 그보다 가까운 배치가 없다 — 직선 거리로(minimap 의 nearest 문서).
      const 거리 = (p: { x: number; y: number }): number =>
        (p.x - 도착.x) ** 2 + (p.y - 도착.y) ** 2
      for (const p of 후보) {
        expect(거리(p), `${field.map.id} (${p.x},${p.y}) 가 더 가깝다`).toBeGreaterThanOrEqual(거리(flag!))
      }
    }
  })

  it('얼음채집장 도착 칸에서는 (9, 21) 이다 — 설계 ③ 이 실측으로 적은 칸', () => {
    // 위 검사는 "가장 가까운 것"만 묻는다. 맨해튼으로 재면 (6,24) 도 동점이라
    // 그 자도 통과하는데, 설계가 화면을 그려 놓고 고른 칸은 (9,21) 이다.
    const 눈의마을 = data.maps['눈의마을']!
    const player = emptyPlayer()
    player.location = { mapId: 눈의마을.id, x: 눈의마을.spawn.x, y: 눈의마을.spawn.y }
    const 도착 = 채집장도착칸(눈의마을)
    expect(minimapMarks(data, 마디에서(player, 1, 도착), 도착.mapId).flag).toEqual({ x: 9, y: 21 })
  })

  it('가방·제작에서 끝나는 마디에는 깃발이 없다 — 지도 위에 자리가 없다', () => {
    for (const { village, player } of 마을사람들()) {
      const chain = storyChainOf(data, player)
      const 없는것 = ['donate', 'craft', 'reach']
      let 잰것 = 0
      for (const [step, def] of chain.entries()) {
        if (!없는것.includes(def.goal.kind)) continue
        잰것++
        expect(
          minimapMarks(data, 마디에서(player, step), village.id).flag,
          `${village.id} 마디 ${step}(${def.goal.kind})`,
        ).toBeNull()
      }
      expect(잰것, `${village.id}: 잰 마디가 없다`).toBe(3)
    }
  })

  it('사슬이 끝나면 깃발도 없다', () => {
    for (const { village, player } of 마을사람들()) {
      const chain = storyChainOf(data, player)
      expect(minimapMarks(data, 마디에서(player, chain.length), village.id).flag).toBeNull()
      expect(minimapMarks(data, 마디에서(player, chain.length + 5), village.id).flag).toBeNull()
    }
  })

  it('캐릭터가 아직 없으면 깃발도 없다', () => {
    expect(minimapMarks(data, null, '눈의마을').flag).toBeNull()
  })

  it('discoverable 손잡이를 내리면 깃발도 함께 꺼진다 — 띠만 끄면 반만 도는 것이다', () => {
    // 설계 ⑥ 방어①이 남긴 손잡이는 CSV 칸 하나다. 그것을 내렸는데 지도에 깃발이
    // 남으면 유도등은 여전히 켜져 있는 것이다(다음에 뭘 할지가 화면에 있다).
    const 꺼진표: StoryStepDef[] = data.story.map((def) => ({
      ...def,
      discoverable: false,
      announce: def.announce === '' ? '지나갔다' : def.announce,
    }))
    const 꺼진세계: GameData = { ...data, story: 꺼진표 }
    for (const { village, player } of 마을사람들()) {
      expect(minimapMarks(꺼진세계, 마디에서(player, 0), village.id).flag, village.id).toBeNull()
      expect(minimapMarks(꺼진세계, 마디에서(player, 1), village.id).flag, village.id).toBeNull()
    }
  })
})
