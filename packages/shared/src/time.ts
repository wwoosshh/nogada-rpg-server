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

/**
 * 게임 1분이 실제로 몇 ms 인가 (2500ms).
 *
 * 일과의 `HH:MM` 을 실측 시간 축 위로 옮기는 환산이다 — 빌드가 출발 시각을
 * 역산할 때(routeBake)와 런타임이 NPC 위치를 보간할 때(npcStateAt)가 **같은**
 * 환산을 써야 한다. 둘이 갈라지면 빌드가 "닿는다"고 통과시킨 시간표에서
 * NPC 가 늦거나 순간이동한다.
 */
export const REAL_MS_PER_GAME_MINUTE = REAL_MS_PER_GAME_DAY / GAME_MINUTES_PER_DAY

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

/** 물이 빠져 있는 시각 창 하나 — `[start, end)` 게임 시각(시). 끝 시각은 이미 물이 찬 시각이다. */
export interface TideWindow {
  start: number
  end: number
}

/**
 * 물때 — 하루 두 번, 여섯 시간씩 물이 크게 빠진다(결계 설계 §6).
 *
 * **왜 세계 시간이 이것을 갖는가:** 물때는 문의 속성이 아니라 세계의 사실이다.
 * 허브 결계가 지금 이 값을 쓰는 유일한 곳이지만, 안내판이 시각을 적고 화면이
 * 밀려남을 적고 언젠가 대사가 물때를 조건으로 걸면 셋이 같은 숫자를 봐야 한다.
 * `transitions.csv` 에 시각을 적게 하면 그 숫자가 문마다 갈라지고, 갈라져도
 * 화면 어디에도 흔적이 안 남는다 — `gateTide` 칸이 시각이 아니라 표시(빈 칸/`1`)
 * 인 이유가 이것이다(`gather_tables.csv` 의 `equity` 칸과 같은 자세).
 *
 * **왜 하루 두 번 여섯 시간인가 — 기다림의 길이가 곧 이 조건의 값어치다.**
 * 현실 1시간이 게임 하루라(REAL_MS_PER_GAME_DAY) 게임 한 시간은 현실 2.5분이다.
 *
 * - `항구약초지기` 가 **처음 말한 것**은 "물이 크게 빠지는 **날**" 이었다. 그대로
 *   읽어 실제 사리(대조)처럼 보름 주기로 잡으면 **최대 현실 14시간**을 기다린다.
 *   그 문은 대부분의 접속에서 한 번도 안 열리고, 그러면 결계가 아니라 자물쇠다.
 * - 그래서 실제 조석의 나머지 절반 — **하루 두 번 드는 간조** — 을 택했다.
 *   주기가 정확히 12게임시간이라 닫혀 있는 두 구간의 길이가 같고, **언제 밟아도
 *   최대 6게임시간 = 현실 15분**이면 물이 빠진다. 대사도 뒤따라 "물이 크게
 *   빠**질 때**" 로 고쳤다 — `항구약초지기.dlg` 에 지금 "날" 은 없다. 위 줄의
 *   "날" 은 인용이 아니라 **이 값을 고른 이유의 기록**이다.
 * - 15분은 이 게임에서 노는 시간이 아니다. 결계 바깥에 그 계열 normal 노드 8개가
 *   그대로 있어서, 물을 기다리는 동안 하는 일이 곧 노가다다 — 기다림이 정지가
 *   아니라 채집이 되는 값으로 고른 것이 요점이다.
 * - 하루의 절반을 열어 둔 것도 같은 저울이다. 더 좁히면 문이 시간표 암기 게임이
 *   되고, 더 넓히면 물때가 조건이 아니라 장식이 된다.
 *
 * 조석이 매일 50분씩 밀리는 것(실제 태음일)은 흉내 내지 않는다. 안내판이 시각을
 * 숫자로 적어 주기로 한 이상(요구치를 숫자로 말하는 문), 매일 달라지는 숫자는
 * 적어 줄 수가 없다.
 */
export const TIDE_WINDOWS: readonly TideWindow[] = [
  { start: 2, end: 8 },
  { start: 14, end: 20 },
] as const

/** 그 시각에 물이 빠져 있는가. 시작은 포함, 끝은 제외다. */
export function isLowTide(hour: number): boolean {
  return TIDE_WINDOWS.some((w) => hour >= w.start && hour < w.end)
}

/**
 * 밤이 걸치는 시각 창들 — **화면이 밤을 숫자로 적을 수 있게** 옮겨 적은 것이다.
 *
 * **물때와 방향이 반대다.** `TIDE_WINDOWS` 는 정의이고 `isLowTide` 가 그것에서
 * 파생되지만, 밤은 `timeOfDay` 가 이미 오래전부터 정의였다(대사 조건이 그것을
 * 읽는다). 여기서 새 정의를 세우면 같은 시각에 대사는 밤이라 하고 노드는
 * 아니라 하는 날이 오므로, `isNight` 는 이 목록이 아니라 `timeOfDay` 를 본다 —
 * 이 상수는 **표시 전용**이고, 둘이 갈라지지 않는지는 time.test.ts 가 24시간
 * 전수로 문다.
 *
 * 자정을 넘는 한 덩어리를 `{ start: 21, end: 4 }` 로 적지 않는 이유: 창 하나의
 * 뜻이 `[start, end)` 라는 것이 `TideWindow` 의 전부이고, 그 뜻을 창마다 다르게
 * 하면 같은 구조를 읽어 문구를 조립하는 화면이 이 하나에만 거꾸로 나온다.
 */
export const NIGHT_WINDOWS: readonly TideWindow[] = [
  { start: 21, end: 24 },
  { start: 0, end: 4 },
] as const

/**
 * 그 시각이 밤인가. **`timeOfDay` 가 유일한 정의다** — 여기서 21·4 를 다시 적으면
 * 밤의 뜻이 둘이 된다.
 */
export function isNight(hour: number): boolean {
  return timeOfDay(hour) === 'night'
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
