import {
  gameTimeAt,
  isLowTide,
  isNight,
  NIGHT_WINDOWS,
  TIDE_WINDOWS,
  type TimeWindow,
} from './time.js'
import type { NodeDef, NodeTimeRequirement } from './types.js'
import { activeWeather, type PlayerWeather, type WeatherKind } from './weather.js'

/** 날씨 조건 — 그 노드가 요구하는 하늘과 지금 내리는 하늘. */
export interface NodeWeatherCondition {
  /** 이 하늘이어야 열린다. 화면이 "눈이 올 때만" 이라고 적는 그 이름이다. */
  need: WeatherKind
  /**
   * 지금 걸려 있는 하늘. **아무것도 안 내리면 `undefined` 다** — 'clear' 를 만들지
   * 않는 이유는 `activeWeather` 문서에 있고, 화면은 그 구별로 괄호를 적을지
   * 말지를 정한다(없는 하늘에는 적을 이름이 없다).
   */
  now: WeatherKind | undefined
  open: boolean
}

/** 시각 조건 — 그 노드가 요구하는 창들과 지금 시각(설계 §3). */
export interface NodeTimeCondition {
  need: NodeTimeRequirement
  /**
   * 열려 있는 시각 창들. 화면이 "(02시~08시 · 14시~20시)" 를 적는 그 숫자이고,
   * 조건마다 `TIDE_WINDOWS`·`NIGHT_WINDOWS` 중 하나다 — 창의 출처는 언제나
   * `time.ts` 다(노드가 자기 숫자를 갖지 않는다, `NodeDef.requireTime` 문서).
   */
  windows: readonly TimeWindow[]
  /** 판정이 본 게임 시각(0~23). 화면이 "지금 11시" 를 적는 값이다. */
  hour: number
  open: boolean
}

/** 노드 하나가 요구하는 것과 지금 세계에 있는 것. 조건 없는 노드에는 이것이 없다. */
export interface NodeGate {
  /** 하늘을 안 보는 노드면 null. */
  weather: NodeWeatherCondition | null
  /** 시계를 안 보는 노드면 null. */
  time: NodeTimeCondition | null
  /**
   * 걸린 조건이 **전부** 만족되는가. 서버가 채집을 허락하는 값이다.
   *
   * 조건별 `open` 과 따로 두는 이유는 `TransitionGate` 와 같다 — 화면이 막힌
   * 이유를 **구별해서** 말해야 한다. "눈이 올 때만" 과 "물이 빠질 때만" 은
   * 플레이어가 할 일이 다르다(하나는 가루를 쓰면 되고 하나는 기다려야 한다).
   */
  open: boolean
}

/**
 * 이 노드를 지금 이 사람이 캘 수 있는가 — **노드 가용성의 정의**(설계 §3).
 *
 * **결계의 `transitionGate` 가 선 자리에 같은 이유로 선다.** 부르는 곳이 둘이다:
 * 서버의 채집 판정(gatherService)과 막힌 이유를 적는 화면(gameStore)이다. 조건
 * 비교를 양쪽이 각자 옮겨 적으면 화면이 열린 노드로 그려 놓고 서버만 거절하는
 * 날이 오고, 플레이어에게 그것은 이유가 어디에도 안 적힌 거절이 된다.
 * `nodeAvailability.test.ts` 가 그 규범을 소스 전수로 문다 — 이 두 칸을 직접
 * 읽는 파일은 여기와 파서뿐이어야 한다.
 *
 * **`open` 하나만 돌려주지 않는 이유**도 같은 규범의 뒷면이다. 화면은 "물이
 * 빠질 때만 캘 수 있다 (02시~08시 · 14시~20시, 지금 11시)" 를 적어야 하는데,
 * 참·거짓만 주면 화면이 `node.requireTime` 과 시계를 다시 꺼내 두 번째 판정을
 * 짓게 된다. 판정과 표시가 같은 함수에서 나와야 둘이 갈라질 자리가 없다.
 *
 * **조건이 없으면 `null` 이다.** 출하된 노드 여덟 줄이 전부 그쪽이라 이 값이
 * 곧 "이 아크는 기존 채집을 안 바꾼다" 의 코드 쪽 표현이다. "요구 없는 요구"로
 * 뭉개면 화면이 보통 얼음 광맥 앞에서도 조건 문구를 조립할 수 있게 되고,
 * 부르는 쪽마다 "빈 조건이면 안 적는다" 는 분기를 다시 쓰게 된다.
 *
 * **부등호를 여기서 새로 짓지 않는다.** 만료 경계는 `activeWeather` 가, 물때
 * 경계는 `isLowTide` 가, 밤의 경계는 `timeOfDay`(→ `isNight`)가 이미 소유한다 —
 * 이 함수가 하는 일은 그 셋을 **한 자리에서 합치는 것**뿐이다. 새 시계를 만들면
 * 같은 시각에 결계와 노드가 서로 다른 답을 하는 날이 온다.
 *
 * **시각을 받는다.** 서버가 판정한 순간과 화면이 적은 순간이 갈라지면, 열리는
 * 경계(02·14·21시)에서 서버가 거절한 요청을 화면은 열려 있다고 읽어 아무 말도
 * 못 한다 — 결계가 실제로 밟은 창이다(gameStore 의 describeBarrier 문서).
 */
export function nodeAvailable(
  node: NodeDef,
  weather: PlayerWeather | null,
  nowMs: number,
): NodeGate | null {
  if (node.requireWeather === undefined && node.requireTime === undefined) return null

  let weatherCondition: NodeWeatherCondition | null = null
  if (node.requireWeather !== undefined) {
    const now = activeWeather(weather, nowMs)
    weatherCondition = { need: node.requireWeather, now, open: now === node.requireWeather }
  }

  let timeCondition: NodeTimeCondition | null = null
  if (node.requireTime !== undefined) {
    const { hour } = gameTimeAt(nowMs)
    timeCondition =
      node.requireTime === 'tide'
        ? { need: 'tide', windows: TIDE_WINDOWS, hour, open: isLowTide(hour) }
        : { need: 'night', windows: NIGHT_WINDOWS, hour, open: isNight(hour) }
  }

  return {
    weather: weatherCondition,
    time: timeCondition,
    open: (weatherCondition?.open ?? true) && (timeCondition?.open ?? true),
  }
}
