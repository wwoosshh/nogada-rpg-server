import { describe, expect, it } from 'vitest'
import { REAL_MS_PER_GAME_MINUTE } from './time.js'
import { activeWeather, weatherEndsAt } from './weather.js'

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
