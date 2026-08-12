/**
 * 날씨 — 원작 얼음 계열이 만들던 그 가루의 효과다(설계 §6-앞 1~4).
 *
 * 원작에서 날씨 가루는 **연출**이었다(`SetWeatherEffects`) — 전투도 HP 도 건드리지
 * 않으므로, 전투가 없는 우리 게임에 손대지 않고 그대로 옮길 수 있는 유일한 원작
 * 소비재다. 여기 있는 것은 그 효과의 규칙(무엇이 될 수 있고 언제 그치는가)뿐이고,
 * 하늘을 그리는 일은 클라이언트의 몫이다.
 */

import { REAL_MS_PER_GAME_MINUTE } from './time.js'

/**
 * 하늘이 될 수 있는 것. 튜플(`as const`)인 이유는 세이브 스키마가 이 목록으로
 * `z.enum` 을 만들기 때문이다(protocol.ts) — 목록을 두 곳에 적으면 언젠가 한쪽만
 * 늘어나고, 그때 세이브의 문은 새 날씨를 거부하면서 아무 이유도 남기지 않는다.
 */
export const WEATHER_KINDS = ['rain', 'snow'] as const

export type WeatherKind = (typeof WEATHER_KINDS)[number]

/**
 * 지금 이 사람의 하늘 하나.
 *
 * **끝나는 시각만 적는다** — 남은 시간이 아니다. 남은 시간을 적으면 그것을 줄이는
 * 주체(틱 루프·오프라인 정산)가 필요해지고, 접속을 끊은 사이의 시간을 누가
 * 언제 깎을지가 새 문제로 생긴다. 세계 시각을 저장된 상태 없이 계산에서 얻는
 * 우리 방식(time.ts)과 NPC 일과(npcSchedule.ts)가 이미 같은 자세다.
 */
export interface PlayerWeather {
  kind: WeatherKind
  /** 이 실측 시각(epoch ms)에 그친다. */
  untilMs: number
}

/**
 * 지금 쓰면 언제 그치는가.
 *
 * 지속은 데이터에 **게임 분**으로 적히고(items.csv 의 `useValue`) 비교는 실측
 * ms 로만 이뤄진다. 그 환산을 부르는 쪽마다 다시 적으면 언젠가 한 곳이 "1분 =
 * 1000ms" 로 굳어, 게임 60분짜리 가루가 실측 1분 만에 그친다 — 일과의 출발
 * 시각을 빌드와 런타임이 같은 상수로 역산해야 하는 것과 같은 이유다.
 */
export function weatherEndsAt(nowMs: number, gameMinutes: number): number {
  return nowMs + gameMinutes * REAL_MS_PER_GAME_MINUTE
}

/**
 * 지금 걸려 있는 날씨. 없거나 이미 그쳤으면 `undefined` 다.
 *
 * **`undefined` 를 내는 것이 요점이다** — 사실 공급자(facts.ts)가 그대로 "넣지
 * 않음"으로 옮길 수 있어야 한다. 'clear' 같은 자리표시를 만들면 비를 부정으로 건
 * 조건(`weather!=rain`)이 맑은 날에 참이 되기 시작하고, 그것은 작가가 쓴 적 없는
 * 규칙이다.
 *
 * 경계는 열려 있다(`untilMs` 에 닿으면 이미 그쳤다). 만료를 지우는 작업이 없으므로
 * 만료된 값은 상태에 그대로 남아 있고, 다음 사용이 덮어쓸 때까지 이 비교 하나가
 * 그것을 없는 것으로 만든다.
 */
export function activeWeather(weather: PlayerWeather | null, nowMs: number): WeatherKind | undefined {
  if (!weather || weather.untilMs <= nowMs) return undefined
  return weather.kind
}

/** 하늘의 이름. `SEASON_LABELS`(time.ts)와 같은 자리·같은 이유 — 화면이 낱말을 지어내지 않는다. */
export const WEATHER_LABELS: Record<WeatherKind, string> = {
  rain: '비',
  snow: '눈',
}

/**
 * 화면이 보는 하늘 하나 — 무엇이 내리는가와 얼마나 남았는가.
 *
 * 남은 시간이 **게임 분**인 것은 상단 바가 이미 게임 시각을 말하고 있기
 * 때문이다(`봄 3일 · 14:23`). 실측 분으로 적으면 같은 줄 안에서 두 개의 시간이
 * 흐른다 — "비 2분"이 게임 시각으로는 48분이다.
 */
export interface WeatherView {
  kind: WeatherKind
  /**
   * 남은 게임 분. **항상 1 이상이다** — 0 은 그친 것이고, 그친 것은 숫자가
   * 아니라 `null` 로 말한다. 올림인 이유가 그것이다: 내림이면 마지막 1분 동안
   * "비 0분"이 떠 있고, 그 줄은 내리는 비를 보면서 안 온다고 적은 것이 된다.
   */
  remainingMinutes: number
}

/**
 * 지금 이 사람의 하늘을 화면 둘이 **같은 계산**으로 읽는 창구다 —
 * 상단바(TopBar)의 남은 시간과 세계(WeatherSky)의 입자가 여기 하나를 본다.
 *
 * 갈라 두면 어긋나는 순간이 반드시 온다: 하늘은 아직 비를 뿌리는데 상단바는
 * 이미 지워졌거나 그 반대다. 만료가 저장된 타이머가 아니라 시각 비교 하나라
 * (`activeWeather`) 그 경계는 두 화면이 정확히 같아야 한다.
 *
 * `PlayerState` 가 아니라 `PlayerWeather` 를 받는다 — types.ts 가 이 파일을
 * import 하므로 반대로 받으면 순환이 된다. 부르는 쪽이 `player.weather` 를 준다.
 */
export function weatherView(weather: PlayerWeather | null, nowMs: number): WeatherView | null {
  const kind = activeWeather(weather, nowMs)
  if (kind === undefined || weather === null) return null
  return {
    kind,
    remainingMinutes: Math.ceil((weather.untilMs - nowMs) / REAL_MS_PER_GAME_MINUTE),
  }
}
