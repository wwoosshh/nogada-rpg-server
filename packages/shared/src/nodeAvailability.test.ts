import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nodeAvailable } from './nodeAvailability.js'
import { GAME_EPOCH_MS, NIGHT_WINDOWS, REAL_MS_PER_GAME_DAY, TIDE_WINDOWS } from './time.js'
import type { NodeDef } from './types.js'
import type { PlayerWeather } from './weather.js'

/** 출하 8행의 모양 — 조건 칸 둘이 다 비어 있다. */
const plain: NodeDef = {
  id: 'ice_vein', name: '얼음 광맥', skill: 'ice', tableId: 'ice', variant: 'normal', sprite: 'ice_vein',
}

const snowNode: NodeDef = {
  id: 'red_ice_vein', name: '붉은 얼음 광맥', skill: 'ice', tableId: 'ice_special', variant: 'special',
  sprite: 'red_ice_vein', requireWeather: 'snow',
}

const nightNode: NodeDef = {
  id: 'starfall_site', name: '별똥 자리', skill: 'mineral', tableId: 'mineral_special', variant: 'special',
  sprite: 'starfall_site', requireTime: 'night',
}

const tideNode: NodeDef = {
  id: 'frost_bloom', name: '서리 핀 군락', skill: 'herb', tableId: 'herb_special', variant: 'special',
  sprite: 'frost_bloom', requireTime: 'tide',
}

/** 둘을 함께 진 노드. 출하 데이터에는 없지만 술어는 총체적으로 답해야 한다. */
const bothNode: NodeDef = { ...snowNode, id: 'both', requireTime: 'tide' }

/** epoch 당일의 게임 시각 `hour` 에 해당하는 실제 시각 */
const atHour = (hour: number): number => GAME_EPOCH_MS + (hour / 24) * REAL_MS_PER_GAME_DAY

const snowUntil = (untilMs: number): PlayerWeather => ({ kind: 'snow', untilMs })

describe('nodeAvailable', () => {
  // 왜: 출하된 노드 8행이 전부 조건 없는 노드다. 그 노드들에 "요구가 없는 요구"를
  // 지어 주면 화면이 보통 얼음 광맥 앞에서도 조건 문구를 조립할 수 있게 되고,
  // 부르는 쪽마다 "빈 조건이면 안 적는다" 는 분기를 다시 쓰게 된다.
  it('조건 칸이 둘 다 비면 게이트 자체가 없다 — 출하 8행이 그쪽이다', () => {
    expect(nodeAvailable(plain, null, atHour(11))).toBeNull()
  })

  describe('날씨', () => {
    it('요구한 하늘이 지금 내리면 열린다', () => {
      const gate = nodeAvailable(snowNode, snowUntil(atHour(11) + 1), atHour(11))
      expect(gate?.open).toBe(true)
      expect(gate?.weather).toEqual({ need: 'snow', now: 'snow', open: true })
    })

    // 왜: 하늘이 비어 있는 것과 다른 하늘이 걸린 것은 화면이 할 말이 다르다
    // (한쪽은 "지금" 을 적을 이름이 없고 한쪽은 있다). 술어가 그 둘을 구별해
    // 돌려주지 않으면 화면이 player.weather 를 다시 꺼내 두 번째 판정을 짓는다.
    it('아무것도 안 내리면 닫히고, 지금 하늘은 undefined 다', () => {
      const gate = nodeAvailable(snowNode, null, atHour(11))
      expect(gate?.open).toBe(false)
      expect(gate?.weather).toEqual({ need: 'snow', now: undefined, open: false })
    })

    it('다른 하늘이 걸려 있으면 닫히고, 그 이름이 실려 온다', () => {
      const gate = nodeAvailable(snowNode, { kind: 'rain', untilMs: atHour(11) + 1 }, atHour(11))
      expect(gate?.open).toBe(false)
      expect(gate?.weather?.now).toBe('rain')
    })

    // 왜: 만료 경계는 activeWeather 하나가 소유한다(untilMs 에 닿으면 이미 그쳤다).
    // 여기서 `<` 로 한 번 더 적으면 그 순간 하늘은 그쳤는데 노드만 열려 있는
    // 1틱이 생기고, 그 1틱은 어느 화면에도 흔적을 안 남긴다.
    it('그치는 순간(untilMs === now)에 이미 닫힌다', () => {
      const now = atHour(11)
      expect(nodeAvailable(snowNode, snowUntil(now), now)?.open).toBe(false)
      expect(nodeAvailable(snowNode, snowUntil(now + 1), now)?.open).toBe(true)
    })
  })

  describe('물때', () => {
    // 왜: 창의 시작은 포함, 끝은 제외다(isLowTide). 노드가 그 경계를 자기 손으로
    // 다시 적으면 결계와 노드가 같은 시각에 서로 다른 답을 하는 날이 온다.
    it('시작 시각은 포함하고 끝 시각은 제외한다', () => {
      const { start, end } = TIDE_WINDOWS[0]!
      expect(nodeAvailable(tideNode, null, atHour(start))?.open).toBe(true)
      expect(nodeAvailable(tideNode, null, atHour(end - 1))?.open).toBe(true)
      expect(nodeAvailable(tideNode, null, atHour(end))?.open).toBe(false)
      expect(nodeAvailable(tideNode, null, atHour(start - 1))?.open).toBe(false)
    })

    // 왜: 화면이 "물이 빠질 때만 (02시~08시 · 14시~20시, 지금 11시)" 을 적으려면
    // 창과 시각이 판정과 같은 값이어야 한다 — 결계 문구가 선 그 자리와 같다.
    it('막힌 채로 창과 지금 시각을 함께 돌려준다', () => {
      const gate = nodeAvailable(tideNode, null, atHour(11))
      expect(gate?.time).toEqual({ need: 'tide', windows: TIDE_WINDOWS, hour: 11, open: false })
    })
  })

  describe('밤', () => {
    // 왜: 밤의 정의는 timeOfDay 하나뿐이다(대사 조건이 이미 그것을 쓴다). 노드가
    // 자기 숫자를 적으면 같은 시각에 대사는 밤이라 하고 노드는 아니라 한다.
    it('밤 창 안에서만 열린다', () => {
      expect(nodeAvailable(nightNode, null, atHour(21))?.open).toBe(true)
      expect(nodeAvailable(nightNode, null, atHour(23))?.open).toBe(true)
      expect(nodeAvailable(nightNode, null, atHour(0))?.open).toBe(true)
      expect(nodeAvailable(nightNode, null, atHour(3))?.open).toBe(true)
      expect(nodeAvailable(nightNode, null, atHour(4))?.open).toBe(false)
      expect(nodeAvailable(nightNode, null, atHour(20))?.open).toBe(false)
    })

    it('막힌 채로 밤 창과 지금 시각을 함께 돌려준다', () => {
      const gate = nodeAvailable(nightNode, null, atHour(12))
      expect(gate?.time).toEqual({ need: 'night', windows: NIGHT_WINDOWS, hour: 12, open: false })
    })
  })

  // 왜: 조건이 둘 걸린 노드는 출하 데이터에 없지만, 이 술어는 CSV 를 거치지 않은
  // NodeDef 도 받으므로 한쪽만 만족된 값에 총체적으로 답해야 한다. 결계의
  // transitionGate 가 숙련과 물때를 함께 지는 그 모양이다.
  it('조건이 둘이면 둘 다 만족돼야 열린다', () => {
    const low = atHour(TIDE_WINDOWS[0]!.start)
    const high = atHour(TIDE_WINDOWS[0]!.end)
    expect(nodeAvailable(bothNode, snowUntil(low + 1), low)?.open).toBe(true)
    expect(nodeAvailable(bothNode, null, low)?.open).toBe(false)
    expect(nodeAvailable(bothNode, snowUntil(high + 1), high)?.open).toBe(false)
  })

  /**
   * **규범을 무는 자리다** — 결계가 `transitionGate` 하나에 부등호를 모은 것과
   * 같은 규율이고, 접미사 문자열의 주인을 하나로 묶은 검사(gatherTables.test.ts)와
   * 같은 방법이다.
   *
   * 서버가 `node.requireWeather === player.weather?.kind` 를 한 줄 적거나 화면이
   * `requireTime === 'night'` 로 문구를 갈라도 컴파일도 테스트도 전부 통과한다.
   * 그리고 그 줄이 이 파일과 갈라지는 날, 화면은 열린 노드로 그려 놓고 서버만
   * 거절한다 — 플레이어에게 그것은 이유가 어디에도 안 적힌 거절이다.
   *
   * 쓰는 자리(파서)는 예외다. 읽는 자리가 하나여야 한다는 규범이지 CSV 에서
   * 값을 실어 오는 길까지 없애자는 말이 아니다. 테스트 파일도 뺀다 —
   * 기대값에 칸 이름이 그대로 적히는 것이 오히려 검사의 값어치다.
   */
  it('조건 칸을 직접 읽는 소스는 이 술어 하나뿐이다', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const allowed = new Set([
      join('packages', 'shared', 'src', 'nodeAvailability.ts'),
      // 칸을 선언하는 자리. 여기서마저 이름을 못 적으면 타입이 설 수 없다.
      join('packages', 'shared', 'src', 'types.ts'),
      // CSV 에서 값을 실어 오는 자리 — 유일한 쓰기다.
      join('packages', 'data', 'src', 'parse.ts'),
    ])
    const skipDirs = new Set(['node_modules', 'dist', 'generated', '.git'])
    const field = /\brequire(?:Weather|Time)\b/

    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(full)
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          const rel = relative(root, full)
          if (!allowed.has(rel) && field.test(readFileSync(full, 'utf8'))) offenders.push(rel)
        }
      }
    }
    for (const top of ['packages', 'apps']) walk(join(root, top))

    expect(offenders).toEqual([])
  })
})
