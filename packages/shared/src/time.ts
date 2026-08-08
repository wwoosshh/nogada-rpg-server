/**
 * 세계 시간. 실제 시각 하나에서 게임 시각을 계산하는 순수 함수다.
 *
 * 저장할 상태도 틱 루프도 없다 — 같은 실제 시각을 넣으면 누가 계산하든 같은
 * 게임 시각이 나온다. 서버와 클라이언트가 이 파일을 함께 import 한다.
 */

/**
 * 「1년차 봄 1일 00:00」에 해당하는 실제 시각 (2026-01-01T00:00:00Z).
 *
 * 이 값은 바꾸지 않는다. 바꾸면 모든 플레이어의 「며칠째」가 어긋나고,
 * 날짜에 묶인 기록의 의미가 소급해서 변한다.
 */
export const GAME_EPOCH_MS = 1_767_225_600_000

/** 현실 1시간 = 게임 하루 */
export const REAL_MS_PER_GAME_DAY = 60 * 60 * 1000

export const GAME_MINUTES_PER_DAY = 24 * 60

export const DAYS_PER_SEASON = 28

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'] as const

export const SEASON_LABELS: Record<Season, string> = {
  spring: '봄',
  summer: '여름',
  autumn: '가을',
  winter: '겨울',
}

export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length

export interface GameTime {
  /** 1년차부터. epoch 이전이면 0 이하가 될 수 있다. */
  year: number
  season: Season
  /** 0=봄 … 3=겨울 */
  seasonIndex: number
  /** 1 ~ DAYS_PER_SEASON */
  dayOfSeason: number
  /** 1 ~ DAYS_PER_YEAR */
  dayOfYear: number
  /** epoch 이후 경과 일수. 0부터 시작하며 음수가 될 수 있다. */
  totalDays: number
  /** 0 ~ 23 */
  hour: number
  /** 0 ~ 59 */
  minute: number
  /** 0 ~ 1439 */
  minuteOfDay: number
}

/** 음수에서도 0 이상 m 미만을 돌려주는 나머지 */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

export function gameTimeAt(realMs: number): GameTime {
  const dayFloat = (realMs - GAME_EPOCH_MS) / REAL_MS_PER_GAME_DAY
  const totalDays = Math.floor(dayFloat)
  // dayFloat - totalDays 는 항상 [0, 1) 이므로 음수 시각에서도 안전하다.
  const minuteOfDay = Math.min(
    GAME_MINUTES_PER_DAY - 1,
    Math.floor((dayFloat - totalDays) * GAME_MINUTES_PER_DAY),
  )

  const dayOfYearIndex = mod(totalDays, DAYS_PER_YEAR)
  const seasonIndex = Math.floor(dayOfYearIndex / DAYS_PER_SEASON)

  return {
    year: Math.floor(totalDays / DAYS_PER_YEAR) + 1,
    season: SEASONS[seasonIndex]!,
    seasonIndex,
    dayOfSeason: (dayOfYearIndex % DAYS_PER_SEASON) + 1,
    dayOfYear: dayOfYearIndex + 1,
    totalDays,
    hour: Math.floor(minuteOfDay / 60),
    minute: minuteOfDay % 60,
    minuteOfDay,
  }
}

/**
 * 실제 시각 두 시점 사이에 게임 날짜로 며칠이 흘렀는가.
 *
 * 달력 날짜의 차이가 아니라 흐른 시간이다 — 게임 하루가 현실 한 시간이라,
 * 자정 직전에 말하고 몇 분 뒤에 다시 오면 달력으로는 하루가 지나 있다 —
 * "어제 보고 오늘 또 왔군" 이 2분 만에 나온다. 흐른 시간으로 세면 그런 일이
 * 없다. dialogueHistory 의 daysSinceLastTalk(packages/shared/src/facts.ts)가
 * 이 함수로 계산한다 — 세계 시간을 다루는 다른 함수들과 같은 자리에 두는
 * 것이, "이건 대화 전용 계산"이라는 오해를 막는다. 게임의 경과 일수를 재는
 * 일반 계산일 뿐이다.
 */
export function gameDaysBetween(fromMs: number, toMs: number): number {
  // 기기·서버 시계가 뒤로 갔을 때 음수가 나오지 않게 바닥을 둔다. 미래에
  // 말한 기록은 있을 수 없으므로 그런 값은 "방금"(0)으로 본다.
  return Math.max(0, Math.floor((toMs - fromMs) / REAL_MS_PER_GAME_DAY))
}

export type TimeOfDay = 'dawn' | 'morning' | 'day' | 'evening' | 'night'

/**
 * 시간대 이름. 대사·이벤트 조건 판정용이다.
 * 화면 명암은 이 구간으로 끊지 않고 skyShade 의 연속 함수를 쓴다.
 */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 4 && hour < 6) return 'dawn'
  if (hour >= 6 && hour < 10) return 'morning'
  if (hour >= 10 && hour < 18) return 'day'
  if (hour >= 18 && hour < 21) return 'evening'
  return 'night'
}

export interface SkyShade {
  /** 0(정오) ~ 1(자정) */
  darkness: number
  /** 오버레이에 칠할 색 (0xRRGGBB) */
  color: number
}

/** tokens.css 에 대응하는 값이 없는 연출 전용 색이다. 여기가 유일한 출처다. */
const NIGHT_COLOR = 0x0a1435
const TWILIGHT_COLOR = 0x4a2412

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function lerpColor(a: number, b: number, t: number): number {
  const r = lerpChannel((a >> 16) & 0xff, (b >> 16) & 0xff, t)
  const g = lerpChannel((a >> 8) & 0xff, (b >> 8) & 0xff, t)
  const bl = lerpChannel(a & 0xff, b & 0xff, t)
  return (r << 16) | (g << 8) | bl
}

/**
 * 시각(분)에서 화면 명암을 계산한다.
 *
 * 구간으로 끊지 않고 코사인으로 연속 변화시킨다 — 경계에서 화면이 갑자기
 * 어두워지면 눈에 띄게 어색하다.
 *
 * 색은 어둠이 중간일 때(06:00, 18:00) 가장 따뜻하다. 그 지점이 곧 밤과 낮이
 * 갈리는 전환 구간이므로 별도의 시각 조건 없이 자연스럽게 맞아떨어진다.
 */
export function skyShade(minuteOfDay: number): SkyShade {
  const phase = (minuteOfDay / GAME_MINUTES_PER_DAY) * Math.PI * 2
  const darkness = (1 + Math.cos(phase)) / 2
  const twilight = 1 - Math.abs(darkness - 0.5) * 2
  return { darkness, color: lerpColor(NIGHT_COLOR, TWILIGHT_COLOR, twilight) }
}

/**
 * 서버 시각 추정. 편도가 왕복의 절반이라고 가정한다.
 *
 * 클라이언트는 자기 시계를 세계 시각으로 쓰지 않는다 — 기기 시계는 수동 설정,
 * NTP 오차, 시간대 설정으로 얼마든지 어긋난다.
 */
export function estimateServerNow(
  sentAtMs: number,
  serverNowMs: number,
  receivedAtMs: number,
): number {
  return serverNowMs + (receivedAtMs - sentAtMs) / 2
}

/** 이 값을 초과해 어긋나면 앵커를 다시 잡는다 */
export const RESYNC_THRESHOLD_MS = 2000

export function needsResync(observedServerMs: number, predictedServerMs: number): boolean {
  return Math.abs(observedServerMs - predictedServerMs) > RESYNC_THRESHOLD_MS
}
