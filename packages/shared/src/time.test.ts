import { describe, expect, it } from 'vitest'
import {
  DAYS_PER_SEASON,
  DAYS_PER_YEAR,
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_DAY,
  RESYNC_THRESHOLD_MS,
  estimateServerNow,
  gameTimeAt,
  needsResync,
  skyShade,
  timeOfDay,
} from './time.js'

/** epoch 로부터 게임 n 일 뒤의 실제 시각 */
const afterDays = (days: number): number => GAME_EPOCH_MS + days * REAL_MS_PER_GAME_DAY
/** epoch 당일의 게임 시각 h:m 에 해당하는 실제 시각 */
const atClock = (hour: number, minute = 0): number =>
  GAME_EPOCH_MS + ((hour * 60 + minute) / 1440) * REAL_MS_PER_GAME_DAY

describe('gameTimeAt', () => {
  it('epoch 는 1년차 봄 1일 00:00 이다', () => {
    const t = gameTimeAt(GAME_EPOCH_MS)
    expect(t.year).toBe(1)
    expect(t.season).toBe('spring')
    expect(t.dayOfSeason).toBe(1)
    expect(t.dayOfYear).toBe(1)
    expect(t.totalDays).toBe(0)
    expect(t.hour).toBe(0)
    expect(t.minute).toBe(0)
    expect(t.minuteOfDay).toBe(0)
  })

  it('현실 1시간이 게임 하루다', () => {
    expect(gameTimeAt(afterDays(1)).totalDays).toBe(1)
    expect(gameTimeAt(afterDays(1)).dayOfSeason).toBe(2)
  })

  it('현실 30분이 게임 정오다', () => {
    const t = gameTimeAt(GAME_EPOCH_MS + REAL_MS_PER_GAME_DAY / 2)
    expect(t.hour).toBe(12)
    expect(t.minute).toBe(0)
    expect(t.minuteOfDay).toBe(720)
  })

  it('하루의 마지막 게임 분은 23:59 다', () => {
    const t = gameTimeAt(atClock(23, 59))
    expect(t.hour).toBe(23)
    expect(t.minute).toBe(59)
    expect(t.totalDays).toBe(0)
  })

  it('계절 마지막 날 다음은 다음 계절 1일이다', () => {
    const last = gameTimeAt(afterDays(DAYS_PER_SEASON - 1))
    expect(last.season).toBe('spring')
    expect(last.dayOfSeason).toBe(DAYS_PER_SEASON)

    const next = gameTimeAt(afterDays(DAYS_PER_SEASON))
    expect(next.season).toBe('summer')
    expect(next.dayOfSeason).toBe(1)
    expect(next.year).toBe(1)
  })

  it('네 계절을 순서대로 지난다', () => {
    expect(gameTimeAt(afterDays(0)).season).toBe('spring')
    expect(gameTimeAt(afterDays(28)).season).toBe('summer')
    expect(gameTimeAt(afterDays(56)).season).toBe('autumn')
    expect(gameTimeAt(afterDays(84)).season).toBe('winter')
  })

  it('한 해가 끝나면 다음 해 봄 1일이다', () => {
    const t = gameTimeAt(afterDays(DAYS_PER_YEAR))
    expect(t.year).toBe(2)
    expect(t.season).toBe('spring')
    expect(t.dayOfSeason).toBe(1)
    expect(t.dayOfYear).toBe(1)
  })

  it('epoch 이전 시각도 계산이 어긋나지 않는다', () => {
    // 게임 1분 전 = 0년차 겨울 마지막 날 23:59
    const t = gameTimeAt(atClock(0) - REAL_MS_PER_GAME_DAY / 1440)
    expect(t.totalDays).toBe(-1)
    expect(t.year).toBe(0)
    expect(t.season).toBe('winter')
    expect(t.dayOfSeason).toBe(DAYS_PER_SEASON)
    expect(t.hour).toBe(23)
    expect(t.minute).toBe(59)
  })

  it('minuteOfDay 는 항상 0 이상 1440 미만이다', () => {
    for (let i = 0; i < 500; i++) {
      const t = gameTimeAt(GAME_EPOCH_MS + i * 12345)
      expect(t.minuteOfDay).toBeGreaterThanOrEqual(0)
      expect(t.minuteOfDay).toBeLessThan(1440)
    }
  })
})

describe('timeOfDay', () => {
  it('구간 경계를 정확히 나눈다', () => {
    expect(timeOfDay(3)).toBe('night')
    expect(timeOfDay(4)).toBe('dawn')
    expect(timeOfDay(5)).toBe('dawn')
    expect(timeOfDay(6)).toBe('morning')
    expect(timeOfDay(9)).toBe('morning')
    expect(timeOfDay(10)).toBe('day')
    expect(timeOfDay(17)).toBe('day')
    expect(timeOfDay(18)).toBe('evening')
    expect(timeOfDay(20)).toBe('evening')
    expect(timeOfDay(21)).toBe('night')
    expect(timeOfDay(0)).toBe('night')
  })
})

describe('skyShade', () => {
  it('자정이 가장 어둡고 정오가 가장 밝다', () => {
    expect(skyShade(0).darkness).toBeCloseTo(1)
    expect(skyShade(720).darkness).toBeCloseTo(0)
  })

  it('자정에서 정오까지 단조 감소한다', () => {
    let prev = skyShade(0).darkness
    for (let m = 10; m <= 720; m += 10) {
      const d = skyShade(m).darkness
      expect(d).toBeLessThanOrEqual(prev + 1e-9)
      prev = d
    }
  })

  it('정오에서 자정까지 단조 증가한다', () => {
    let prev = skyShade(720).darkness
    for (let m = 730; m < 1440; m += 10) {
      const d = skyShade(m).darkness
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = d
    }
  })

  it('여명·황혼에서 색이 가장 따뜻하고 자정·정오에서 밤색이다', () => {
    // darkness 0.5 지점(06:00, 18:00)이 황혼의 정점이다.
    const dawn = skyShade(360).color
    const dusk = skyShade(1080).color
    const midnight = skyShade(0).color
    const noon = skyShade(720).color

    expect(dawn).toBe(dusk)
    expect(midnight).toBe(noon)
    expect(dawn).not.toBe(midnight)

    const red = (c: number) => (c >> 16) & 0xff
    expect(red(dawn)).toBeGreaterThan(red(midnight))
  })

  it('darkness 는 0 과 1 사이를 벗어나지 않는다', () => {
    for (let m = 0; m < 1440; m += 7) {
      const d = skyShade(m).darkness
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
})

describe('estimateServerNow', () => {
  it('왕복 시간의 절반을 더해 보정한다', () => {
    expect(estimateServerNow(1000, 5000, 1100)).toBe(5050)
  })

  it('왕복이 즉시면 서버 시각 그대로다', () => {
    expect(estimateServerNow(1000, 5000, 1000)).toBe(5000)
  })
})

describe('needsResync', () => {
  it('임계값을 넘으면 재동기가 필요하다', () => {
    expect(needsResync(10_000 + RESYNC_THRESHOLD_MS + 1, 10_000)).toBe(true)
    expect(needsResync(10_000 - RESYNC_THRESHOLD_MS - 1, 10_000)).toBe(true)
  })

  it('임계값 이내면 필요하지 않다', () => {
    expect(needsResync(10_000, 10_000)).toBe(false)
    expect(needsResync(10_000 + RESYNC_THRESHOLD_MS, 10_000)).toBe(false)
  })
})
