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
