import { describe, expect, it } from 'vitest'
import { REAL_MS_PER_GAME_MINUTE } from './time.js'
import { activeWeather, weatherEndsAt, weatherView } from './weather.js'

const NOW = 1_767_225_600_000

describe('weatherEndsAt', () => {
  // 왜: 지속 시간은 **게임 분**으로 적히고(items.csv 의 useValue) 실측 ms 로만
  //     비교된다. 그 환산을 부르는 쪽마다 다시 적으면 언젠가 한 곳이 "1분=1000ms"
  //     로 굳어, 60분짜리 가루가 1분 만에 그친다.
  it('게임 분을 실측 시각으로 옮긴다 — 환산은 세계 시간의 상수 하나가 소유한다', () => {
    expect(weatherEndsAt(NOW, 60)).toBe(NOW + 60 * REAL_MS_PER_GAME_MINUTE)
    expect(weatherEndsAt(NOW, 180)).toBe(NOW + 180 * REAL_MS_PER_GAME_MINUTE)
  })
})

describe('activeWeather', () => {
  it('만료 전이면 그 날씨다', () => {
    expect(activeWeather({ kind: 'rain', untilMs: NOW + 1 }, NOW)).toBe('rain')
  })

  // 왜: 만료는 저장된 타이머가 아니라 이 비교 하나다(NPC 일과와 같은 자세) —
  //     그치는 순간 아무도 아무것도 지우지 않아도 사실이 사라져야 한다.
  it('만료 시각에 닿으면 그친다 — 경계는 열린 구간이다', () => {
    expect(activeWeather({ kind: 'rain', untilMs: NOW }, NOW)).toBeUndefined()
    expect(activeWeather({ kind: 'snow', untilMs: NOW - 1 }, NOW)).toBeUndefined()
  })

  it('날씨가 없으면(null) 아무것도 아니다 — 맑음이라는 값을 지어내지 않는다', () => {
    expect(activeWeather(null, NOW)).toBeUndefined()
  })
})

describe('weatherView', () => {
  // 왜: 상단바의 남은 시간과 세계의 입자가 이 함수 하나를 본다. 갈라 두면
  //     하늘은 뿌리는데 상단바는 지워진 순간이 반드시 생긴다.
  it('내리는 동안에는 종류와 남은 게임 분을 함께 말한다', () => {
    const weather = { kind: 'rain', untilMs: weatherEndsAt(NOW, 60) } as const
    expect(weatherView(weather, NOW)).toEqual({ kind: 'rain', remainingMinutes: 60 })
    // 실측 1분(= 게임 24분)이 흐르면 남은 시간도 그만큼 준다.
    expect(weatherView(weather, NOW + 60_000)).toEqual({ kind: 'rain', remainingMinutes: 36 })
  })

  // 왜: 내림이면 마지막 1분 동안 "비 0분"이 떠 있다 — 내리는 비를 보면서
  //     안 온다고 적은 줄이다. 남은 시간은 1 아래로 내려가지 않고 곧장 사라진다.
  it('남은 시간은 올림이라 0 분이 뜨지 않는다', () => {
    expect(weatherView({ kind: 'snow', untilMs: NOW + 1 }, NOW)?.remainingMinutes).toBe(1)
  })

  // 왜: 그친 하늘과 없던 하늘은 화면에게 같은 것이다 — 둘 다 그릴 것이 없다.
  //     경계(untilMs 에 닿음)는 activeWeather 와 같아야 한다.
  it('그쳤거나 없으면 null 이다 — 화면이 그릴 것이 없다는 뜻이다', () => {
    expect(weatherView({ kind: 'rain', untilMs: NOW }, NOW)).toBeNull()
    expect(weatherView(null, NOW)).toBeNull()
  })
})
