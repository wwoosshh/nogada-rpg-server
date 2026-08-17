import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGameData, type TiledMapJson } from '@nogada/data'
import { describe, expect, it } from 'vitest'
import { minimapFit } from './minimap.js'
import { bakeMinimap, type MinimapBrush } from './minimapBake.js'

/**
 * 축소도를 **굽는 붓질**을 잰다(설계 ⑤).
 *
 * 이 자가 못 재는 것: 그려진 그림이 그 맵처럼 보이는지. 그것은 브라우저에서만
 * 보인다. 잴 수 있는 것은 **몇 장을 어느 조각에서 어디로 그렸는가**이고, 그것이
 * 가짜 붓 하나로 충분한 이유는 `bakeMinimap` 이 Phaser 도 캔버스도 모르기
 * 때문이다.
 *
 * 잡으려는 실패가 다섯이다:
 * ① 한 장도 안 그리는 것 — 시트 짝짓기가 어긋나면 미니맵이 빈 상자로 서는데,
 *    화면에서 그것은 "어두운 맵" 과 구분되지 않는다.
 * ② 칸 사이에 틈이 생기는 것 — 배율이 정수가 아니라(1.40~4.67px/타일) 자리만
 *    반올림하면 축소도가 모눈종이가 된다.
 * ③ 상자 밖으로 그리는 것.
 * ④ 남의 조각을 그리는 것 — 시트가 여섯 장이라 firstgid 를 한 칸만 잘못 골라도
 *    바닥이 지붕이 된다.
 * ⑤ **겹치는 순서가 뒤집히는 것** — ①~④ 는 전부 "몇 장을 어디에" 만 묻는다.
 *    그래서 레이어를 거꾸로 도는 붓도 열아홉 검사를 전부 통과했다(돌연변이로
 *    확인했다). 그 화면은 ground 가 walls·overhead 를 덮은 "지붕만 없는 마을"
 *    이고, ① 의 주석이 스스로 「눈으로도 잘 안 잡힌다」고 적어 둔 실패다.
 */

const data = loadGameData()

/** 빌드가 구워 둔 맵 JSON — 클라이언트가 실행 중에 받아 가는 바로 그 파일이다. */
const 맵폴더 = fileURLToPath(new URL('../../../../packages/data/src/generated/maps/', import.meta.url))

function 맵을읽는다(id: string): TiledMapJson {
  return JSON.parse(readFileSync(join(맵폴더, `${id}.json`), 'utf8')) as TiledMapJson
}

interface 붓자국 {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

function 가짜붓(): MinimapBrush & { 자국: 붓자국[] } {
  const 자국: 붓자국[] = []
  return {
    자국,
    drawImage(_image, sx, sy, sw, sh, dx, dy, dw, dh) {
      자국.push({ sx, sy, sw, sh, dx, dy, dw, dh })
    },
  }
}

/** 그림은 안 본다 — 있기만 하면 된다(붓이 가짜다). */
const 아무그림 = {} as CanvasImageSource
const 그림있다 = (): CanvasImageSource => 아무그림

/** 시트 하나짜리 손수 만든 맵 — 정확한 값을 물으려면 진짜 맵은 너무 크다. */
function 손수맵(gids: number[], width: number, height: number): TiledMapJson {
  return {
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    orientation: 'orthogonal',
    tilesets: [
      { firstgid: 1, name: 'a', tilewidth: 32, tileheight: 32, image: 'a.png', imagewidth: 128, imageheight: 64 },
    ],
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', opacity: 1, visible: true, x: 0, y: 0, width, height, data: gids },
    ],
  }
}

describe('축소도 굽기 — 붓질의 값', () => {
  it('빈 칸(gid 0)은 안 그린다 — 대부분의 맵에서 decor·overhead 가 거의 전부 0 이다', () => {
    const brush = 가짜붓()
    expect(bakeMinimap(brush, 손수맵([1, 0, 0, 2], 2, 2), 그림있다, 4)).toBe(2)
    expect(brush.자국).toHaveLength(2)
  })

  it('조각 자리를 firstgid 와 열 수로 찾는다', () => {
    const brush = 가짜붓()
    // 시트는 128×64 = 4열 2행. gid 6 → local 5 → 2행 1열.
    bakeMinimap(brush, 손수맵([6], 1, 1), 그림있다, 4)
    expect(brush.자국[0]).toMatchObject({ sx: 32, sy: 32, sw: 32, sh: 32 })
  })

  it('뒤집기 비트를 벗긴다 — 뒤집힌 타일 하나가 들어와도 조각 번호가 안 튄다', () => {
    const 그냥 = 가짜붓()
    const 뒤집힌 = 가짜붓()
    bakeMinimap(그냥, 손수맵([6], 1, 1), 그림있다, 4)
    // 가로·세로·대각 세 비트를 다 세운다.
    bakeMinimap(뒤집힌, 손수맵([6 | 0x80000000 | 0x40000000 | 0x20000000], 1, 1), 그림있다, 4)
    expect(뒤집힌.자국[0]).toEqual(그냥.자국[0])
  })

  it('시트 밖을 가리키는 조각은 건너뛴다 — drawImage 의 답이 기기마다 다르다', () => {
    // 4열 2행이므로 조각은 8개(gid 1~8). 9 는 그 밖이다.
    expect(bakeMinimap(가짜붓(), 손수맵([9], 1, 1), 그림있다, 4)).toBe(0)
  })

  it('오브젝트 레이어와 안 보이는 레이어는 안 그린다', () => {
    const map = 손수맵([1, 1, 1, 1], 2, 2)
    map.layers.push(
      { id: 2, name: 'walls', type: 'tilelayer', opacity: 1, visible: false, x: 0, y: 0, width: 2, height: 2, data: [1, 1, 1, 1] },
      { id: 3, name: 'objects', type: 'objectgroup', opacity: 1, visible: true, x: 0, y: 0, objects: [{ x: 0, y: 0 }] },
    )
    expect(bakeMinimap(가짜붓(), map, 그림있다, 4)).toBe(4)
  })

  it('그림이 없으면 던진다 — 조용히 건너뛰면 그 시트를 쓰는 절반이 사라진다', () => {
    expect(() => bakeMinimap(가짜붓(), 손수맵([1], 1, 1), () => undefined, 4)).toThrow('타일셋')
  })
})

describe('축소도 굽기 — 격자', () => {
  it('정수가 아닌 배율에서도 칸 사이에 틈이 없다', () => {
    // 1.4 는 월드맵의 배율이다(80×80 이 112 안에 들어간다). 이 배율에서 자리만
    // 반올림하고 폭을 1.4 로 두면 칸마다 소수점이 밀려 틈이 생긴다.
    const 폭 = 8
    const brush = 가짜붓()
    bakeMinimap(brush, 손수맵(Array.from({ length: 폭 * 폭 }, () => 1), 폭, 폭), 그림있다, 1.4)

    const 칠한칸 = new Set<string>()
    for (const m of brush.자국) {
      expect(m.dw, '폭이 0 인 칸이 있다').toBeGreaterThan(0)
      expect(m.dh, '높이가 0 인 칸이 있다').toBeGreaterThan(0)
      for (let y = m.dy; y < m.dy + m.dh; y++) {
        for (let x = m.dx; x < m.dx + m.dw; x++) 칠한칸.add(`${x},${y}`)
      }
    }
    // 8 × 1.4 = 11.2 → 12px 짜리 정사각이 한 픽셀도 안 비어야 한다.
    const 한변 = Math.ceil(폭 * 1.4)
    expect(칠한칸.size).toBe(한변 * 한변)
  })
})

describe('축소도 굽기 — 진짜 맵 열한 장', () => {
  const 맵들 = readdirSync(맵폴더).filter((f) => f.endsWith('.json'))

  it('빌드가 구운 맵이 등록부와 같은 수다 — 아니면 아래가 덜 잰다', () => {
    expect(맵들.length).toBe(Object.keys(data.maps).length)
  })

  for (const 파일 of 맵들) {
    const id = 파일.replace(/\.json$/, '')

    it(`${id} — 한 장 이상 그리고, 전부 상자 안이다`, () => {
      const map = 맵을읽는다(id)
      const fit = minimapFit(map.width, map.height)
      const brush = 가짜붓()
      const drawn = bakeMinimap(brush, map, 그림있다, fit.scale)

      // ① **빈 칸이 아닌 것은 하나도 안 빠뜨린다.** 「0 보다 크다」로만 물으면
      //    시트를 잘못 골라 절반을 조용히 버리는 붓도 통과한다 — 그 화면은
      //    "지붕만 없는 마을" 이라 눈으로도 잘 안 잡힌다.
      let 채운칸 = 0
      for (const layer of map.layers) {
        if (layer.type !== 'tilelayer' || layer.visible === false || !layer.data) continue
        for (const gid of layer.data) if ((gid & 0x1fffffff) !== 0) 채운칸++
      }
      expect(채운칸, `${id} 에 그릴 것이 하나도 없다`).toBeGreaterThan(0)
      expect(drawn, `${id}: 그린 수가 채워진 칸 수와 다르다`).toBe(채운칸)

      // ③ 캔버스는 fit 크기를 올림한 것이다(HudScene.buildMinimap).
      const 가로 = Math.ceil(fit.width)
      const 세로 = Math.ceil(fit.height)
      for (const m of brush.자국) {
        expect(m.dx, `${id}`).toBeGreaterThanOrEqual(0)
        expect(m.dy, `${id}`).toBeGreaterThanOrEqual(0)
        expect(m.dx + m.dw, `${id} 가 오른쪽으로 넘친다`).toBeLessThanOrEqual(가로)
        expect(m.dy + m.dh, `${id} 가 아래로 넘친다`).toBeLessThanOrEqual(세로)
      }

      // ④ 원본 조각은 언제나 그 시트 안이다.
      const 시트별 = new Map(map.tilesets.map((ts) => [ts.firstgid, ts]))
      expect(시트별.size, `${id} 에 시트가 없다`).toBeGreaterThan(0)
      for (const m of brush.자국) {
        const 맞는시트 = map.tilesets.some(
          (ts) =>
            m.sx >= 0 && m.sy >= 0 && m.sx + m.sw <= ts.imagewidth && m.sy + m.sh <= ts.imageheight,
        )
        expect(맞는시트, `${id} 가 시트 밖 조각 (${m.sx}, ${m.sy}) 을 가리킨다`).toBe(true)
      }
    })

    it(`${id} — 레이어 순서대로 덮는다 (겹치는 칸의 나중 붓이 위 레이어다)`, () => {
      const map = 맵을읽는다(id)
      const brush = 가짜붓()

      // **배율 1 로 굽는다.** 그러면 `dx = floor(x·1) = x` 이고 `dy = y` 라 붓자국이
      // 곧 칸 좌표가 된다 — 자리 계산 두 줄을 여기서 다시 쓰지 않고도 **순서**를
      // 정확히 물을 수 있다(그 두 줄은 위 「격자」 검사가 따로 못박는다).
      bakeMinimap(brush, map, 그림있다, 1)

      // 붓이 갔어야 하는 차례: 레이어 순서대로, 그 안에서는 색인 순서대로.
      const 차례: string[] = []
      for (const layer of map.layers) {
        if (layer.type !== 'tilelayer' || layer.visible === false || !layer.data) continue
        for (let i = 0; i < layer.data.length; i++) {
          if (((layer.data[i] ?? 0) & 0x1fffffff) === 0) continue
          차례.push(`${i % map.width},${Math.floor(i / map.width)}`)
        }
      }
      expect(차례.length, `${id} 에 그릴 것이 없다`).toBeGreaterThan(0)
      expect(brush.자국.map((m) => `${m.dx},${m.dy}`), `${id}: 겹치는 순서가 다르다`).toEqual(차례)

      // 양성 대조군 — **실제로 겹치는 칸이 있어야** 이 자가 값을 낸다. 한 칸에
      // 한 레이어만 있는 맵이라면 순서를 뒤집어도 화면이 같으므로, 위 등식은
      // 통과해도 잡을 것이 없는 셈이다.
      expect(new Set(차례).size, `${id}: 겹치는 칸이 없다 — 순서를 물을 것이 없다`).toBeLessThan(
        차례.length,
      )
    })
  }
})
