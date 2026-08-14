import { describe, expect, it } from 'vitest'
import {
  DAYS_PER_SEASON,
  DAYS_PER_YEAR,
  GAME_EPOCH_MS,
  REAL_MS_PER_GAME_DAY,
  RESYNC_THRESHOLD_MS,
  estimateServerNow,
  gameDaysBetween,
  gameTimeAt,
  isLowTide,
  isNight,
  needsResync,
  NIGHT_WINDOWS,
  skyShade,
  TIDE_WINDOWS,
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

  it('낮밤 전환점에서 색이 가장 따뜻하고 자정·정오에서 밤색이다', () => {
    // darkness 0.5 지점(06:00, 18:00)이 색 전환의 정점이다.
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

describe('gameDaysBetween', () => {
  it('현실 하루(게임 하루)마다 1씩 늘어난다', () => {
    expect(gameDaysBetween(GAME_EPOCH_MS, afterDays(3))).toBe(3)
  })

  it('달력 날짜가 아니라 흐른 시간을 센다 — 자정 직전과 몇 분 뒤는 하루 차이가 아니다', () => {
    const justBeforeMidnight = atClock(23, 59)
    const fewMinutesLater = justBeforeMidnight + 5 * (REAL_MS_PER_GAME_DAY / 1440)
    expect(gameDaysBetween(justBeforeMidnight, fewMinutesLater)).toBe(0)
  })

  it('기준 시각을 넘겨 흐른 시간이 하루 미만이면 0 이다', () => {
    expect(gameDaysBetween(GAME_EPOCH_MS, GAME_EPOCH_MS + REAL_MS_PER_GAME_DAY - 1)).toBe(0)
  })

  it('시계가 거꾸로 가도(미래 시각을 기준으로 과거를 재도) 음수 대신 0 이다', () => {
    // 기기·서버 시계가 뒤로 갔을 때를 대비한 바닥이다 — 미래에 말한 기록은
    // 있을 수 없으므로 그런 값은 "방금"(0)으로 본다.
    expect(gameDaysBetween(afterDays(5), afterDays(2))).toBe(0)
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

/*
 * 물때 — 허브 결계가 지는 두 번째 조건(결계 설계 §6).
 *
 * 이 값들을 테스트가 붙잡는 이유는 **기다림의 길이가 곧 게임 경험**이기
 * 때문이다. 창을 한 시간 줄이면 최대 대기가 현실 2.5분씩 늘어나는데, 그
 * 변화는 어느 화면에도 빨갛게 뜨지 않고 플레이어의 짜증으로만 나타난다.
 */
describe('물때', () => {
  // 왜: 하루 두 번이고 주기가 정확히 12시간이라는 것이 이 설계의 전부다 —
  //     닫혀 있는 두 구간의 길이가 같아야 "언제 밟아도 최대 여섯 시간"이
  //     성립한다. 창 하나를 옮기면 한쪽 기다림만 길어지고, 그것을 알아채는
  //     방법은 그 시간대에 실제로 서 보는 것밖에 없다.
  it('창은 둘이고 각각 여섯 시간이며 열두 시간 간격이다', () => {
    expect(TIDE_WINDOWS).toEqual([
      { start: 2, end: 8 },
      { start: 14, end: 20 },
    ])
    for (const w of TIDE_WINDOWS) expect(w.end - w.start).toBe(6)
    expect(TIDE_WINDOWS[1]!.start - TIDE_WINDOWS[0]!.start).toBe(12)
  })

  // 왜: 끝 시각이 포함이면 20시에 들어간 사람이 20시에 물이 차는 것을 보고,
  //     시작이 제외면 02시를 기다린 사람이 03시까지 또 기다린다. 경계가 어느
  //     쪽인지는 안내판이 "두 시부터 여덟 시까지"라고 적는 그 숫자의 뜻이다.
  it('시작은 포함이고 끝은 제외다', () => {
    expect(isLowTide(2)).toBe(true)
    expect(isLowTide(7)).toBe(true)
    expect(isLowTide(8)).toBe(false)
    expect(isLowTide(14)).toBe(true)
    expect(isLowTide(19)).toBe(true)
    expect(isLowTide(20)).toBe(false)
  })

  // 왜: 물이 빠져 있는 시간이 하루의 절반이어야 "기다릴 만하다"가 성립한다.
  //     절반보다 줄이면 결계가 시간표 암기 게임이 되고, 늘리면 물때가 조건이
  //     아니라 장식이 된다.
  it('하루의 절반은 물이 빠져 있다', () => {
    const open = Array.from({ length: 24 }, (_, h) => h).filter(isLowTide)
    expect(open.length).toBe(12)
  })
})

/**
 * 밤 — 물때와 달리 **창이 파생값이다**. 밤의 정의는 오래전부터 timeOfDay 하나였고
 * (대사 조건이 그것을 쓴다) NIGHT_WINDOWS 는 그 정의를 화면이 숫자로 적을 수 있게
 * 옮겨 적은 것뿐이다. 옮겨 적은 이상 갈라질 수 있으므로 여기서 묶는다.
 */
describe('밤', () => {
  // 왜: 이 검사가 없으면 timeOfDay 의 21·4 를 고치는 사람이 NIGHT_WINDOWS 를
  //     그대로 두고, 그날부터 별똥 자리는 22시에 열리면서 화면은 "23시부터"라고
  //     적는다. 판정과 표시가 갈라지는 그 어긋남은 시간대에 실제로 서 봐야만
  //     보인다 — 24시간을 전수로 견주는 것이 이 규범을 무는 유일한 방법이다.
  it('창이 밤의 정의(timeOfDay)와 24시간 내내 일치한다', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const inWindow = NIGHT_WINDOWS.some((w) => hour >= w.start && hour < w.end)
      expect(inWindow, `${hour}시`).toBe(timeOfDay(hour) === 'night')
      expect(isNight(hour), `${hour}시`).toBe(timeOfDay(hour) === 'night')
    }
  })

  // 왜: 자정을 넘는 한 덩어리를 `{ start: 21, end: 4 }` 로 적으면 TimeWindow 의
  //     뜻(`[start, end)`)이 창마다 달라지고, 같은 구조를 읽는 화면 문구 조립이
  //     그 하나에만 거꾸로 나온다("21시~04시"가 아니라 "21시부터 4시까지 빼고").
  it('자정을 넘는 창을 둘로 쪼개 둔다 — 창 하나의 뜻은 언제나 [start, end) 다', () => {
    expect(NIGHT_WINDOWS).toEqual([
      { start: 21, end: 24 },
      { start: 0, end: 4 },
    ])
  })
})
