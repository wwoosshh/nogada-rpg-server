# 세계 시간 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 시계를 권위로 하는 게임 내 날짜·시간을 흐르게 하고, 상단 상태 바와 낮밤 명암으로 화면에 드러낸다. 기존 UI 패널을 걷어내고 행동 피드백을 캐릭터 머리 위 플로팅 텍스트로 바꾼다.

**Architecture:** 게임 시각은 `gameTimeAt(realMs)` 순수 함수 하나로 실제 시각에서 계산한다. 저장할 상태도 틱 루프도 없다. 「어떤 실제 시각을 넣느냐」만이 권위 문제이며 그 답은 서버 시계다 — 클라이언트는 서버와의 오프셋을 재서 `performance.now()` 로 경과를 더한다. 판정은 서버가 자기 시계로만 하고 클라이언트 시각은 표시 전용이다.

**Tech Stack:** TypeScript / pnpm workspace / Vitest / Fastify / Phaser 3 / React 18 / zustand 5 / Capacitor(Android)

**관련 문서:** [세계 시간 설계](../specs/2026-08-02-world-time-design.md) · [프로젝트 설계](../specs/2026-08-02-nogada-rpg-fanmade-design.md)

## Global Constraints

설계 문서에서 가져온 전역 규칙. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **시간 공식은 `packages/shared/src/time.ts` 에만 존재한다.** 서버와 클라이언트가 동일 함수를 import 한다.
- **`GAME_EPOCH_MS` 는 한 번 정하면 바꾸지 않는다.** 바꾸면 모든 플레이어의 날짜가 어긋난다.
- **시간에 묶인 판정은 서버가 자기 시계로 한다.** 요청 본문에 클라이언트 시각을 담지 않는다.
- **클라이언트는 경과 측정에 `performance.now()` 를 쓴다.** `Date.now()` 를 쓰면 사용자가 기기 시계를 바꿀 때 세계 시각이 튄다.
- **색상 리터럴은 `tokens.css` 밖에서 쓰지 않는다.** Phaser 는 CSS 변수를 읽을 수 없으므로 숫자로 옮겨 적되, 옮겨 적은 곳에 출처를 주석으로 남긴다.
- **정수 배율 스케일만 허용한다.** Phaser `zoom` 은 정수여야 한다.
- **클라이언트 UI 는 자동 테스트하지 않는다.** `vitest.workspace.ts` 가 `['packages/*', 'apps/server']` 라 `apps/client` 는 테스트 대상이 아니다. **순수 계산은 `packages/shared` 에 두어 테스트한다.**
- **Node.js 20 이상**, 패키지 매니저는 **pnpm**.
- **작업 트리에 커밋되지 않은 변경이 있을 수 있다.** `apps/client/src/ui/App.tsx` 에 개발용 `window.__debugGame` 훅 한 줄이 커밋되지 않은 채 남아 있다. App.tsx 를 수정할 때 **이 줄을 지우지 않는다.**

---

## File Structure

```
packages/shared/src/
├─ time.ts                    ★ 시간 공식의 유일한 출처
│                               상수, gameTimeAt, timeOfDay, skyShade,
│                               estimateServerNow, needsResync
├─ time.test.ts
└─ index.ts                   배럴에 time 추가

apps/server/src/
├─ routes/time.ts             GET /api/time
├─ app.ts                     onSend 훅으로 x-server-now 헤더, cors exposedHeaders
└─ app.test.ts                라우트·헤더 테스트

apps/client/src/
├─ time/clock.ts              앵커 관리(상태), worldNow(), syncClock(), startClockSync()
├─ ui/TopBar.tsx              얇은 상태 바 — 시계 + 설정 버튼 자리
├─ ui/ui.css                  TopBar 전용으로 축소
├─ ui/App.tsx                 패널 제거, TopBar 배치, 시계 동기화 시작
├─ ui/SkillBar.tsx            [삭제]
├─ ui/Inventory.tsx           [삭제]
├─ ui/CraftPanel.tsx          [삭제]
├─ ui/Feed.tsx                [삭제]
├─ ui/ItemIcon.tsx            [유지] 나중 패널에서 재사용
├─ store/gameStore.ts         feed 제거, lastAction 채널 추가
├─ game/depth.ts              dayNight 30, floatingText 40 추가
├─ game/DayNightOverlay.ts    카메라 고정 명암 사각형
├─ game/FloatingText.ts       머리 위 떠오르는 글자
└─ game/scenes/WorldScene.ts  오버레이 생성·갱신, 스토어 구독

apps/client/android/app/src/main/AndroidManifest.xml   가로 고정
```

---

## Task 1: 화면 가로 고정

**Files:**
- Modify: `apps/client/android/app/src/main/AndroidManifest.xml:12-18`
- Modify: `docs/superpowers/specs/2026-08-02-nogada-rpg-fanmade-design.md` (4.2 절 근거 문장)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: 안드로이드 앱이 가로로만 실행된다. 이후 모든 UI 태스크가 가로를 전제한다.

- [ ] **Step 1: 매니페스트에 가로 고정을 추가한다**

`apps/client/android/app/src/main/AndroidManifest.xml` 의 `<activity>` 여는 태그에 `android:screenOrientation` 한 줄을 추가한다. 기존 속성은 그대로 둔다.

```xml
        <activity
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode|navigation|density"
            android:screenOrientation="sensorLandscape"
            android:name=".MainActivity"
            android:label="@string/title_activity_main"
            android:theme="@style/AppTheme.NoActionBarLaunch"
            android:launchMode="singleTask"
            android:exported="true">
```

`sensorLandscape` 는 좌·우 어느 쪽으로 눕혀도 따라간다. `landscape` 로 고정하면 한쪽 방향으로만 잡혀서 왼손잡이 거치나 케이블 방향에 따라 불편해진다.

`android/` 디렉터리는 Capacitor 가 생성했지만 **커밋 대상**이다 (`.gitignore` 는 `android/app/build/` 등 산출물만 제외한다). 따라서 이 수정은 유지된다.

- [ ] **Step 2: 설계 문서의 근거 문장을 고친다**

`docs/superpowers/specs/2026-08-02-nogada-rpg-fanmade-design.md` 의 4.2 절에서 아래 문장을 찾는다.

```
**32×32 선정 근거:** 모바일 세로 화면(논리 360×640 기준)에서 11×20 타일이 보여 시야가 확보된다. 48×48이면 7×13에 그쳐 답답하다.
```

아래로 교체한다.

```
**32×32 선정 근거:** 모바일 가로 화면(논리 640×360 기준)에서 20×11 타일이 보여 시야가 확보된다. 48×48이면 13×7에 그쳐 답답하다.
```

같은 절의 표 위쪽 문단에 방향을 명시하는 문장을 덧붙인다.

```
이 게임은 **가로 화면 전용**이다. 온스크린 컨트롤러를 좌우로 나눠 배치하려면 가로가 전제이며, 안드로이드 매니페스트에서 `sensorLandscape` 로 고정한다.
```

- [ ] **Step 3: 커밋**

```bash
git add apps/client/android/app/src/main/AndroidManifest.xml docs/superpowers/specs/2026-08-02-nogada-rpg-fanmade-design.md
git commit -m "build(client): 화면을 가로로 고정하고 타일 크기 근거를 가로 기준으로 고친다

온스크린 컨트롤러를 좌우로 나눠 배치하려면 가로가 전제다.
sensorLandscape 라 좌우 어느 쪽으로 눕혀도 따라간다.

설계 문서 4.2 의 32x32 선정 근거가 세로 화면(360x640 -> 11x20)
기준으로 적혀 있어 가로 기준(640x360 -> 20x11)으로 고쳤다.
타일 크기 결정 자체는 바뀌지 않는다."
```

---

## Task 2: 시간 엔진 (`packages/shared/src/time.ts`)

**Files:**
- Create: `packages/shared/src/time.ts`
- Create: `packages/shared/src/time.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: 아래 시그니처를 `@nogada/shared` 에서 export 한다. **서버(Task 3)와 클라이언트(Task 4·5·6)가 동일하게 import 한다.**
  - `const GAME_EPOCH_MS = 1767225600000`
  - `const REAL_MS_PER_GAME_DAY = 3600000`
  - `const GAME_MINUTES_PER_DAY = 1440`
  - `const DAYS_PER_SEASON = 28`
  - `const SEASONS: readonly Season[]`
  - `type Season = 'spring' | 'summer' | 'autumn' | 'winter'`
  - `const SEASON_LABELS: Record<Season, string>`
  - `const DAYS_PER_YEAR = 112`
  - `interface GameTime { year, season, seasonIndex, dayOfSeason, dayOfYear, totalDays, hour, minute, minuteOfDay }`
  - `gameTimeAt(realMs: number): GameTime`
  - `type TimeOfDay = 'dawn' | 'morning' | 'day' | 'evening' | 'night'`
  - `timeOfDay(hour: number): TimeOfDay`
  - `interface SkyShade { darkness: number; color: number }`
  - `skyShade(minuteOfDay: number): SkyShade`
  - `estimateServerNow(sentAtMs: number, serverNowMs: number, receivedAtMs: number): number`
  - `const RESYNC_THRESHOLD_MS = 2000`
  - `needsResync(observedServerMs: number, predictedServerMs: number): boolean`

- [ ] **Step 1: 테스트를 먼저 작성한다**

`packages/shared/src/time.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm vitest run packages/shared/src/time.test.ts
```

기대: `Failed to resolve import "./time.js"` 로 실패

- [ ] **Step 3: 시간 엔진을 구현한다**

`packages/shared/src/time.ts`:

```ts
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
 * 색은 어둠이 중간일 때(06:00, 18:00) 가장 따뜻하다. 그 지점이 곧 여명과
 * 황혼이므로 별도의 시각 조건 없이 자연스럽게 맞아떨어진다.
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

/** 이 이상 어긋나면 앵커를 다시 잡는다 */
export const RESYNC_THRESHOLD_MS = 2000

export function needsResync(observedServerMs: number, predictedServerMs: number): boolean {
  return Math.abs(observedServerMs - predictedServerMs) > RESYNC_THRESHOLD_MS
}
```

- [ ] **Step 4: 배럴에 추가한다**

`packages/shared/src/index.ts` 의 마지막 줄 뒤에 추가한다.

```ts
export * from './time.js'
```

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm vitest run packages/shared/src/time.test.ts
```

기대: `Tests  19 passed (19)`

- [ ] **Step 6: 전체 테스트와 타입 검사를 확인하고 커밋한다**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음

```bash
git add packages/shared
git commit -m "feat(shared): 세계 시간 엔진

실제 시각 하나에서 게임 시각을 계산하는 순수 함수다. 저장할 상태도 틱
루프도 없어서 같은 실제 시각을 넣으면 누가 계산하든 같은 결과가 나온다.
서버와 클라이언트가 이 파일을 함께 import 한다.

현실 1시간 = 게임 하루, 계절 28일, 4계절 1년. GAME_EPOCH_MS 는 세계의
원점이며 바꾸면 모든 플레이어의 날짜가 어긋나므로 고정한다.

명암은 시간대로 끊지 않고 코사인으로 연속 변화시킨다. 경계에서 화면이
갑자기 어두워지면 어색하다. 색은 어둠이 중간일 때 가장 따뜻한데, 그
지점이 곧 여명과 황혼이라 별도 조건 없이 맞아떨어진다.

시각 동기화의 순수 계산도 여기 둔다 - 클라이언트에는 테스트 러너가
없으므로 계산은 테스트 가능한 곳에 두고 클라이언트에는 상태만 남긴다."
```

---

## Task 3: 서버 시각 노출

**Files:**
- Create: `apps/server/src/routes/time.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `registerTimeRoutes(app: FastifyInstance): void`
  - `GET /api/time` → `{ serverNowMs: number }`
  - **모든 응답에 `x-server-now` 헤더**가 붙는다. Task 4 가 이 헤더로 드리프트를 감시한다.

- [ ] **Step 1: 라우트 테스트를 먼저 추가한다**

`apps/server/src/app.test.ts` 의 파일 끝에 추가한다.

```ts
describe('GET /api/time', () => {
  it('서버 현재 시각을 반환한다', async () => {
    const app = buildTestApp()
    const before = Date.now()
    const res = await app.inject({ method: 'GET', url: '/api/time' })
    const after = Date.now()

    expect(res.statusCode).toBe(200)
    const body = res.json() as { serverNowMs: number }
    expect(body.serverNowMs).toBeGreaterThanOrEqual(before)
    expect(body.serverNowMs).toBeLessThanOrEqual(after)

    await app.close()
  })
})

describe('x-server-now 헤더', () => {
  it('모든 응답에 서버 시각이 실린다', async () => {
    const app = buildTestApp()

    for (const url of ['/api/health', '/api/state', '/api/time']) {
      const res = await app.inject({ method: 'GET', url })
      const header = res.headers['x-server-now']
      expect(header, `${url} 에 헤더가 없다`).toBeDefined()
      expect(Number(header)).toBeGreaterThan(0)
    }

    await app.close()
  })

  it('POST 응답에도 실린다', async () => {
    const app = buildTestApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/craft',
      payload: { recipeId: 'ghost' },
    })

    expect(res.statusCode).toBe(400)
    expect(Number(res.headers['x-server-now'])).toBeGreaterThan(0)

    await app.close()
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm vitest run apps/server/src/app.test.ts
```

기대: `GET /api/time` 이 404 로 실패하고 헤더 테스트가 `toBeDefined` 로 실패

- [ ] **Step 3: 라우트를 구현한다**

`apps/server/src/routes/time.ts`:

```ts
import type { FastifyInstance } from 'fastify'

/**
 * 세계 시각의 권위는 서버 시계다.
 * 클라이언트는 이 값으로 자기 시계와의 오프셋을 재서 따라간다.
 */
export function registerTimeRoutes(app: FastifyInstance): void {
  app.get('/api/time', () => ({ serverNowMs: Date.now() }))
}
```

- [ ] **Step 4: 앱에 배선하고 헤더 훅을 추가한다**

`apps/server/src/app.ts` 를 아래로 전체 교체한다.

```ts
import { join } from 'node:path'
import cors from '@fastify/cors'
import { loadGameData } from '@nogada/data'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerCraftRoutes } from './routes/craft.js'
import { registerGatherRoutes } from './routes/gather.js'
import { registerStateRoutes } from './routes/state.js'
import { registerTimeRoutes } from './routes/time.js'
import { PlayerStore } from './state/store.js'

export interface BuildAppOptions {
  /** 테스트에서 임시 파일을 쓰기 위해 주입한다. */
  dataFile?: string
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false })
  const data = loadGameData()
  const store = new PlayerStore(options.dataFile ?? join(process.cwd(), '.data', 'players.json'))

  // 개발 중 클라이언트(Vite dev server)와 오리진이 다르므로 허용한다.
  // x-server-now 는 커스텀 헤더라 명시하지 않으면 브라우저가 읽지 못한다.
  app.register(cors, { origin: true, exposedHeaders: ['x-server-now'] })

  // 모든 응답에 서버 시각을 싣는다. 클라이언트가 채집·제작할 때마다 공짜로
  // 드리프트를 확인할 수 있어, 따로 동기화 요청을 보낼 필요가 줄어든다.
  // 본문이 아니라 헤더에 두는 이유는 응답 스키마를 건드리지 않기 위해서다 —
  // 앞으로 추가될 라우트도 자동으로 포함된다.
  app.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('x-server-now', String(Date.now()))
    done(null, payload)
  })

  app.get('/api/health', () => ({
    ok: true,
    items: Object.keys(data.items).length,
    nodes: Object.keys(data.nodes).length,
    recipes: Object.keys(data.recipes).length,
  }))

  registerTimeRoutes(app)
  registerStateRoutes(app, store)
  registerGatherRoutes(app, store, data)
  registerCraftRoutes(app, store, data)

  return app
}
```

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm vitest run apps/server/src/app.test.ts
```

기대: 실패 0건

- [ ] **Step 6: 전체 테스트를 확인하고 커밋한다**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음

```bash
git add apps/server
git commit -m "feat(server): 세계 시각의 권위를 서버 시계로 노출

GET /api/time 이 서버 현재 시각을 돌려주고, 그와 별개로 모든 응답에
x-server-now 헤더를 싣는다.

헤더로 두는 이유는 응답 스키마를 건드리지 않기 위해서다. 라우트마다
본문에 시각을 끼워 넣으면 앞으로 추가될 라우트마다 같은 일을 반복해야
하고 기존 스키마도 손봐야 한다. onSend 훅 하나면 지금 것과 나중 것이
모두 포함된다.

커스텀 헤더는 CORS 에서 exposedHeaders 로 명시하지 않으면 브라우저가
읽지 못하므로 함께 추가했다."
```

---

## Task 4: 클라이언트 시계 동기화

**Files:**
- Create: `apps/client/src/time/clock.ts`
- Modify: `apps/client/src/api/GameClient.ts`

**Interfaces:**
- Consumes: Task 2 의 `estimateServerNow`, `needsResync`, `RESYNC_THRESHOLD_MS`, Task 3 의 `GET /api/time` 과 `x-server-now` 헤더
- Produces:
  - `worldNow(): number` — 세계 시각(실제 시각 기준 ms). **Task 5·6 이 이것을 쓴다.**
  - `syncClock(): Promise<void>` — 한 번 동기화
  - `startClockSync(): () => void` — 시작 동기화 + 복귀·주기 재동기 설정, 정리 함수 반환
  - `observeServerTime(serverNowMs: number): void` — 응답 헤더로 드리프트 감시
  - `GameClient.getTime(): Promise<{ serverNowMs: number }>`

- [ ] **Step 1: GameClient 에 시각 조회와 헤더 관찰을 추가한다**

`apps/client/src/api/GameClient.ts` 를 아래로 전체 교체한다.

```ts
import type { PlayerState, RecipeInput } from '@nogada/shared'

/**
 * 서버 주소는 이 변수 하나로만 결정된다.
 * 개발은 localhost, 실기는 PC 의 LAN IP, 운영은 원격 — 코드는 그대로다.
 */
const BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'

export interface GatherOutcomeDto {
  success: boolean
  chance: number
  gained: RecipeInput | null
  xpGained: number
  player: PlayerState
  cooldownUntil: number
}

export interface CraftOutcomeDto {
  success: boolean
  chance: number
  produced: RecipeInput | null
  consumed: RecipeInput[]
  xpGained: number
  autoEquipped: boolean
  player: PlayerState
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly availableAt?: number,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

/**
 * 응답 헤더의 서버 시각을 받는 콜백. clock.ts 가 등록한다.
 * GameClient 가 clock 을 직접 import 하면 순환 의존이 되므로 주입받는다.
 */
type ServerTimeObserver = (serverNowMs: number) => void
let observeServerTime: ServerTimeObserver = () => {}

export function setServerTimeObserver(fn: ServerTimeObserver): void {
  observeServerTime = fn
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  const serverNow = Number(res.headers.get('x-server-now'))
  if (Number.isFinite(serverNow) && serverNow > 0) observeServerTime(serverNow)

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { code?: string; availableAt?: number }
    throw new ApiError(body.code ?? `http_${res.status}`, body.availableAt)
  }

  return (await res.json()) as T
}

/** 서버 통신의 단일 진입점. 다른 곳에서 fetch 를 직접 부르지 않는다. */
export const GameClient = {
  getTime: () => request<{ serverNowMs: number }>('/api/time'),

  getState: () => request<{ player: PlayerState }>('/api/state'),

  gather: (nodeId: string) =>
    request<GatherOutcomeDto>('/api/gather', {
      method: 'POST',
      body: JSON.stringify({ nodeId }),
    }),

  craft: (recipeId: string) =>
    request<CraftOutcomeDto>('/api/craft', {
      method: 'POST',
      body: JSON.stringify({ recipeId }),
    }),
}
```

- [ ] **Step 2: 시계를 구현한다**

`apps/client/src/time/clock.ts`:

```ts
import { estimateServerNow, needsResync } from '@nogada/shared'
import { GameClient, setServerTimeObserver } from '../api/GameClient.js'

interface Anchor {
  /** 앵커를 잡은 순간의 서버 시각 추정값 */
  serverMs: number
  /** 같은 순간의 performance.now() */
  perfMs: number
}

let anchor: Anchor | null = null
let syncing = false

/**
 * 세계 시각.
 *
 * 앵커가 없으면(오프라인·동기화 전) 로컬 시계로 물러난다. 오프라인에는 공유할
 * 세계가 없으므로 로컬 시계로 충분하고, 온라인으로 붙는 순간 서버 시각으로
 * 스냅된다.
 *
 * 경과를 Date.now() 가 아니라 performance.now() 로 재는 이유는 세션 도중
 * 사용자가 기기 시계를 바꿔도 세계 시각이 튀지 않게 하기 위해서다.
 */
export function worldNow(): number {
  if (!anchor) return Date.now()
  return anchor.serverMs + (performance.now() - anchor.perfMs)
}

/** 서버에 한 번 물어 앵커를 다시 잡는다. */
export async function syncClock(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    const sentAt = performance.now()
    const { serverNowMs } = await GameClient.getTime()
    const receivedAt = performance.now()
    anchor = {
      serverMs: estimateServerNow(sentAt, serverNowMs, receivedAt),
      perfMs: receivedAt,
    }
  } catch {
    // 서버에 닿지 못하면 앵커를 건드리지 않는다. 기존 앵커가 있으면 그대로
    // 쓰고, 없으면 worldNow() 가 로컬 시계로 물러난다.
  } finally {
    syncing = false
  }
}

/**
 * 일반 API 응답 헤더로 받은 서버 시각을 확인한다.
 *
 * 여기서 앵커를 바로 갈아끼우지 않는 이유는 이 값에 왕복 보정이 없기
 * 때문이다. 매 응답마다 앵커를 교체하면 왕복 시간의 흔들림이 그대로 시계
 * 떨림으로 나타난다. 어긋남이 임계값을 넘을 때만 제대로 된 재동기를 부른다.
 */
export function observeServerTime(serverNowMs: number): void {
  if (!anchor) {
    void syncClock()
    return
  }
  if (needsResync(serverNowMs, worldNow())) void syncClock()
}

const PERIODIC_SYNC_MS = 5 * 60 * 1000

/**
 * 시계 동기화를 시작한다. 정리 함수를 돌려준다.
 *
 * 복귀 시 재동기가 가장 중요하다 — 모바일에서 화면이 꺼지면 JS 실행이 멈추고,
 * 그동안 performance.now() 기반 추정이 실제와 벌어질 수 있다.
 */
export function startClockSync(): () => void {
  setServerTimeObserver(observeServerTime)
  void syncClock()

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void syncClock()
  }
  document.addEventListener('visibilitychange', onVisible)

  const timer = window.setInterval(() => void syncClock(), PERIODIC_SYNC_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
    setServerTimeObserver(() => {})
  }
}

/** 테스트·개발용. 앵커를 버려 로컬 시계로 되돌린다. */
export function resetClock(): void {
  anchor = null
}
```

- [ ] **Step 3: 타입 검사를 확인하고 커밋한다**

```bash
pnpm typecheck
```

기대: 타입 오류 없음

```bash
pnpm test
```

기대: 실패 0건 (클라이언트는 테스트 대상이 아니므로 개수 변화 없음)

```bash
git add apps/client/src/time apps/client/src/api
git commit -m "feat(client): 서버 시계를 따라가는 세계 시각

클라이언트는 자기 Date.now() 를 세계 시각으로 쓰지 않는다. 기기 시계는
수동 설정과 NTP 오차로 얼마든지 어긋나고, 한 화면에 여러 플레이어가
보이는 게임에서 그건 곧 같은 자리에 선 두 사람이 다른 시각을 보는 것이다.

앵커를 한 번 잡고 performance.now() 로 경과를 더한다. Date.now() 로
재면 세션 도중 사용자가 기기 시계를 바꿀 때 세계 시각이 튄다.

일반 응답의 x-server-now 헤더로는 앵커를 갈아끼우지 않고 어긋남만
감시한다. 그 값에는 왕복 보정이 없어서, 매번 교체하면 왕복 시간의
흔들림이 그대로 시계 떨림이 된다.

서버에 닿지 못하면 앵커를 건드리지 않는다. 오프라인에는 공유할 세계가
없으므로 로컬 시계로 물러나도 무방하다."
```

---

## Task 5: 레이아웃 제거와 상단 상태 바

**Files:**
- Delete: `apps/client/src/ui/SkillBar.tsx`, `apps/client/src/ui/Inventory.tsx`, `apps/client/src/ui/CraftPanel.tsx`, `apps/client/src/ui/Feed.tsx`
- Create: `apps/client/src/ui/TopBar.tsx`
- Modify: `apps/client/src/ui/ui.css` (전체 교체)
- Modify: `apps/client/src/ui/App.tsx`
- Modify: `apps/client/src/store/gameStore.ts`

**Interfaces:**
- Consumes: Task 2 의 `gameTimeAt`·`SEASON_LABELS`, Task 4 의 `worldNow`·`startClockSync`
- Produces: `<TopBar />`. 화면에 세계 시각이 처음으로 보인다. `gameStore` 에서 `feed` 와 `FeedEntry` 가 사라진다 — **Task 7 이 그 자리에 `lastAction` 을 넣는다.**

- [ ] **Step 1: 패널 컴포넌트를 삭제한다**

```bash
rm apps/client/src/ui/SkillBar.tsx apps/client/src/ui/Inventory.tsx apps/client/src/ui/CraftPanel.tsx apps/client/src/ui/Feed.tsx
```

`apps/client/src/ui/ItemIcon.tsx` 는 **남긴다.** 인벤토리·제작 패널을 컨트롤러 버튼으로 다시 만들 때 재사용한다.

- [ ] **Step 2: 스토어에서 피드를 걷어낸다**

`apps/client/src/store/gameStore.ts` 에서 아래 세 곳을 고친다.

`FeedEntry` 인터페이스와 `feedSeq` 변수, `pushFeed` 함수, `SetFn`/`GetFn` 타입을 **삭제**한다. 그리고 `GameStore` 인터페이스에서 `feed` 필드를 삭제한다.

```ts
interface GameStore {
  data: GameData
  player: PlayerState | null
  loading: boolean
  refresh: () => Promise<void>
  gather: (nodeId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
}
```

`create<GameStore>` 의 초기값에서 `feed: [],` 줄을 삭제하고, 세 액션의 `pushFeed(...)` 호출을 **모두 삭제**한다. `describeError` 와 `labelOf` 는 Task 7 에서 다시 쓰므로 **지우지 않고 남긴다.** 이 태스크가 끝난 시점에는 둘 다 호출되지 않지만, `tsconfig.base.json` 에 `noUnusedLocals` 가 없으므로 타입 검사는 통과한다.

이 단계가 끝나면 채집·제작 결과가 화면에 전혀 보이지 않는다. **의도된 중간 상태이며 Task 7 에서 플로팅 텍스트로 복구한다.**

`get` 인자가 더 이상 쓰이지 않으므로 `create<GameStore>((set, get) => ({` 를 `create<GameStore>((set) => ({` 로 바꾼다. `gather` 와 `craft` 안의 `const { data } = get()` 은 `const { data } = useGameStore.getState()` 로 바꾼다.

- [ ] **Step 3: 상단 상태 바를 작성한다**

`apps/client/src/ui/TopBar.tsx`:

```tsx
import { SEASON_LABELS, gameTimeAt } from '@nogada/shared'
import { useEffect, useState } from 'react'
import { worldNow } from '../time/clock.js'

/** 게임 1분 = 현실 2.5초. 초 단위로 갱신해봐야 읽는 사람에게 의미가 없다. */
const TICK_MS = 2500

const pad = (n: number): string => String(n).padStart(2, '0')

export function TopBar(): JSX.Element {
  const [now, setNow] = useState(() => worldNow())

  useEffect(() => {
    const id = window.setInterval(() => setNow(worldNow()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const t = gameTimeAt(now)

  return (
    <div className="topbar">
      <span className="topbar__clock">
        {SEASON_LABELS[t.season]} {t.dayOfSeason}일 · {pad(t.hour)}:{pad(t.minute)}
      </span>
      {/* 설정 버튼이 들어올 자리. 지금은 비워 두되 공간은 잡아 둔다. */}
      <span className="topbar__actions" />
    </div>
  )
}
```

- [ ] **Step 4: CSS 를 상태 바 전용으로 줄인다**

`apps/client/src/ui/ui.css` 를 아래로 **전체 교체**한다. 삭제한 패널들의 클래스는 전부 없앤다.

```css
/* 색은 전부 tokens.css 의 변수에서만 가져온다. 리터럴 색상을 쓰지 않는다. */

.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

/*
 * 오버레이는 터치를 통과시키고 실제 패널만 받는다.
 * 그래야 UI 가 없는 빈 공간을 눌렀을 때 캐릭터가 이동한다.
 */
.topbar {
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  background: var(--c-panel);
  border-bottom: 2px solid var(--c-panel-edge);
  padding: var(--space-1) var(--space-2);
  font-size: 13px;
  /* 가로 화면에서 노치·펀치홀을 피한다. */
  padding-left: max(var(--space-2), env(safe-area-inset-left));
  padding-right: max(var(--space-2), env(safe-area-inset-right));
}

.topbar__clock {
  color: var(--c-parchment);
  font-variant-numeric: tabular-nums;
}

/* 설정 버튼 자리. 지금은 비어 있지만 폭을 잡아 두어 시계가 가운데로 밀리지 않게 한다. */
.topbar__actions {
  min-width: 32px;
  min-height: 24px;
}
```

- [ ] **Step 5: 앱에 배치한다**

`apps/client/src/ui/App.tsx` 를 수정한다. **`window.__debugGame` 줄은 그대로 둔다** (커밋되지 않은 개발용 훅이다).

상단 import 에서 `Feed`·`Inventory`·`SkillBar`·`CraftPanel` 을 지우고 `TopBar` 와 `startClockSync` 를 넣는다.

```tsx
import { useEffect, useRef } from 'react'
import { createPhaserGame } from '../game/PhaserGame.js'
import { useGameStore } from '../store/gameStore.js'
import { startClockSync } from '../time/clock.js'
import { TopBar } from './TopBar.js'
import './ui.css'
```

상태 로드 `useEffect` 아래에 시계 동기화 `useEffect` 를 추가한다.

```tsx
  // 서버 시계와 맞춘다. 복귀·주기 재동기까지 여기서 관리한다.
  useEffect(() => startClockSync(), [])
```

`return` 의 오버레이 부분을 아래로 교체한다.

```tsx
      <div className="overlay">
        <TopBar />
        {/* 인벤토리·제작 패널은 온스크린 컨트롤러 버튼으로 여닫는다 (별도 작업) */}
      </div>
```

- [ ] **Step 6: 타입 검사와 빌드를 확인한다**

```bash
pnpm typecheck
```

기대: 타입 오류 없음. 삭제한 컴포넌트를 참조하는 곳이 남아 있으면 여기서 잡힌다.

```bash
pnpm --filter @nogada/client build
```

기대: `✓ built in ...`

- [ ] **Step 7: 수동 검증한다**

```bash
pnpm dev:server
```

```bash
pnpm dev:client
```

`http://localhost:5173` 을 연다.

**관찰해야 할 것:**

1. 상단에 `봄 1일 · 07:30` 형태의 줄이 하나만 보인다. 인벤토리·제작·숙련도 패널이 모두 사라졌다
2. **2~3초마다 분이 1씩 올라간다** (게임 1분 = 현실 2.5초)
3. 상단 바 아래 빈 공간을 클릭하면 캐릭터가 이동한다
4. 상단 바 위를 클릭하면 캐릭터가 움직이지 않는다
5. 콘솔에 에러가 없다
6. 브라우저 개발자도구 네트워크 탭에 `/api/time` 요청이 앱 시작 시 한 번 보인다

**서버를 끄고 새로고침해도** 시계가 계속 흐르는지 확인한다 (오프라인 폴백). 이때 날짜는 기기 시계 기준이라 서버가 살아 있을 때와 다를 수 있다 — 정상이다.

- [ ] **Step 8: 커밋**

```bash
git add apps/client/src/ui apps/client/src/store
git commit -m "feat(client): 기존 UI 패널을 걷어내고 상단 상태 바를 세운다

숙련도바·인벤토리·제작패널·피드를 삭제한다. 인벤토리와 제작은 온스크린
컨트롤러 버튼으로 여닫는 패널로 다시 만들 예정이라, 지금 구조를 남겨두면
새 설계와 섞여 오히려 방해가 된다. ItemIcon 은 그때 재사용하므로 남겼다.

숙련도를 상단에 늘어놓지 않는 이유는 종류가 8종 이상으로 늘어날 예정이라
가로 화면 상단에 들어가지 않기 때문이다. 상단에는 항상 보여야 하는 것만
둔다 - 지금은 시계이고, 우측 끝은 설정 버튼 자리로 비워 둔다.

시계는 게임 1분(현실 2.5초)마다 갱신한다. 초 단위로 갱신하면 재렌더
비용만 늘고 읽는 사람에게 의미가 없다.

이 커밋 시점에는 채집 결과가 화면에 보이지 않는다. 피드 패널을 지웠고
플로팅 텍스트는 다음 작업이다."
```

---

## Task 6: 낮밤 명암

**Files:**
- Modify: `apps/client/src/game/depth.ts`
- Create: `apps/client/src/game/DayNightOverlay.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 2 의 `gameTimeAt`·`skyShade`, Task 4 의 `worldNow`
- Produces:
  - `DEPTH.dayNight = 30`, `DEPTH.floatingText = 40` (Task 7 이 후자를 쓴다)
  - `class DayNightOverlay` — `constructor(scene)`, `update(minuteOfDay: number): void`, `destroy(): void`

- [ ] **Step 1: 렌더 깊이를 추가한다**

`apps/client/src/game/depth.ts` 의 `DEPTH` 객체에 두 줄을 추가한다.

```ts
export const DEPTH = {
  ground: 0,
  decor: 1,
  walls: 2,
  node: 5, // 채집 노드 마커
  player: 10,
  overhead: 20,
  dayNight: 30, // 낮밤 명암. 월드의 모든 것 위를 덮는다
  floatingText: 40, // 행동 피드백. 밤에도 읽혀야 하므로 명암보다 위다
} as const
```

주석 블록의 마지막 문단 뒤에 아래를 덧붙인다.

```
 * `dayNight` 아래의 것은 밤에 어두워지고 위의 것은 어두워지지 않는다.
 * 피드백 글자를 위에 두는 것은 연출보다 가독성이 우선이기 때문이다.
```

- [ ] **Step 2: 오버레이를 구현한다**

`apps/client/src/game/DayNightOverlay.ts`:

```ts
import type Phaser from 'phaser'
import { skyShade } from '@nogada/shared'
import { DEPTH } from './depth.js'

/**
 * 자정의 최대 어둠. 1 이면 화면이 완전히 검어져 아무것도 안 보인다.
 * 밤이 밤답게 어둡되 플레이는 가능한 선이다.
 */
const MAX_NIGHT_ALPHA = 0.55

/**
 * 화면 전체를 덮는 낮밤 명암.
 *
 * 카메라에 고정하므로 맵을 스크롤해도 따라다니지 않고 화면에 붙어 있다.
 * 자체 시간을 세지 않고 매 프레임 받은 값을 그리기만 한다.
 */
export class DayNightOverlay {
  private readonly rect: Phaser.GameObjects.Rectangle
  private readonly scene: Phaser.Scene

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    const cam = scene.cameras.main
    this.rect = scene.add
      .rectangle(0, 0, cam.width, cam.height, 0x000000, 0)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.dayNight)

    scene.scale.on('resize', this.handleResize, this)
  }

  /** 게임 시각(분)을 받아 명암을 갱신한다. */
  update(minuteOfDay: number): void {
    const { darkness, color } = skyShade(minuteOfDay)
    this.rect.setFillStyle(color, darkness * MAX_NIGHT_ALPHA)
  }

  destroy(): void {
    this.scene.scale.off('resize', this.handleResize, this)
    this.rect.destroy()
  }

  private handleResize(gameSize: Phaser.Structs.Size): void {
    this.rect.setSize(gameSize.width, gameSize.height)
  }
}
```

- [ ] **Step 3: 씬에 배선한다**

`apps/client/src/game/scenes/WorldScene.ts` 를 고친다.

상단 import 에 두 줄을 추가한다.

```ts
import { gameTimeAt } from '@nogada/shared'
import { worldNow } from '../../time/clock.js'
import { DayNightOverlay } from '../DayNightOverlay.js'
```

클래스 필드에 추가한다.

```ts
  private dayNight!: DayNightOverlay
```

`create()` 의 마지막 줄(`this.spawnNodes(map)`) 뒤에 추가한다.

```ts
    this.dayNight = new DayNightOverlay(this)

    // 씬이 사라질 때 리스너를 정리한다. 개발 중 HMR 로 씬이 여러 번
    // 만들어졌다 사라지므로 정리하지 않으면 resize 리스너가 쌓인다.
    this.events.once('shutdown', () => this.dayNight.destroy())
```

`update()` 의 `this.refreshCooldowns()` 뒤에 추가한다.

```ts
    this.dayNight.update(gameTimeAt(worldNow()).minuteOfDay)
```

- [ ] **Step 4: 타입 검사와 빌드를 확인한다**

```bash
pnpm typecheck && pnpm --filter @nogada/client build
```

기대: 타입 오류 없음, 빌드 성공

- [ ] **Step 5: 수동 검증한다**

서버와 클라이언트를 띄우고 브라우저를 연다.

**관찰해야 할 것:**

1. 상단 시계의 시각과 화면 밝기가 맞는다 — 12시 근처면 거의 투명하고 0시 근처면 짙은 남색이 덮인다
2. **밝기가 계단식으로 튀지 않고 서서히 변한다.** 2~3분 지켜보면 조금씩 변하는 게 보인다
3. 06:00 과 18:00 근처에서 색이 푸른 쪽이 아니라 **주황 쪽**으로 기운다
4. 맵을 걸어 다녀도 명암이 화면에 붙어 있고 맵과 함께 스크롤되지 않는다
5. 채집 노드 마커와 캐릭터가 명암 **아래**에 있어 밤에는 함께 어두워진다
6. 콘솔에 에러가 없다

시각별 확인이 오래 걸리면 `packages/shared/src/time.ts` 의 `REAL_MS_PER_GAME_DAY` 를 일시적으로 `60 * 1000`(현실 1분 = 게임 하루)으로 낮춰 하루를 빠르게 돌려보고 **반드시 되돌린다.**

- [ ] **Step 6: 커밋**

```bash
git add apps/client/src/game
git commit -m "feat(client): 낮밤 명암

화면 전체를 덮는 사각형 하나를 카메라에 고정하고 시각으로 계산한 색과
투명도를 매 프레임 적용한다. 씬은 자체 시간을 세지 않고 받은 값을
그리기만 한다.

시간대로 끊지 않고 연속 보간하는 이유는 구간 경계에서 화면이 갑자기
어두워지면 눈에 띄게 어색하기 때문이다.

자정의 최대 어둠을 0.55 로 둔다. 1 이면 완전히 검어져 플레이가 불가능하다.

DEPTH 에 dayNight(30)과 floatingText(40)를 추가했다. 피드백 글자를 명암
위에 두는 것은 밤에 글자까지 어두워지면 읽히지 않기 때문이다 - 연출보다
가독성이 우선이다."
```

---

## Task 7: 행동 피드백 플로팅 텍스트

**Files:**
- Create: `apps/client/src/game/FloatingText.ts`
- Modify: `apps/client/src/store/gameStore.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 5 의 축소된 `gameStore`, Task 6 의 `DEPTH.floatingText`
- Produces:
  - `interface ActionFeedback { seq: number; text: string; tone: 'good' | 'bad' }`
  - `gameStore.lastAction: ActionFeedback | null`
  - `spawnFloatingText(scene, x, y, text, tone): void`

- [ ] **Step 1: 스토어에 피드백 채널을 만든다**

`apps/client/src/store/gameStore.ts` 를 아래로 **전체 교체**한다.

```ts
import { loadGameData } from '@nogada/data'
import {
  calcCraftSuccess,
  calcGatherChance,
  equippedToolTier,
  type GameData,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'
import { create } from 'zustand'
import {
  ApiError,
  GameClient,
  type CraftOutcomeDto,
  type GatherOutcomeDto,
} from '../api/GameClient.js'

/**
 * 캐릭터 머리 위에 띄울 행동 결과.
 *
 * seq 는 같은 문구가 연달아 나올 때(구리 원석 +1 을 두 번 캐는 경우)도
 * 구독자가 새 사건임을 알 수 있게 한다. 문구만 비교하면 두 번째를 놓친다.
 */
export interface ActionFeedback {
  seq: number
  text: string
  tone: 'good' | 'bad'
}

interface GameStore {
  data: GameData
  player: PlayerState | null
  loading: boolean
  lastAction: ActionFeedback | null
  refresh: () => Promise<void>
  gather: (nodeId: string) => Promise<void>
  craft: (recipeId: string) => Promise<void>
}

let actionSeq = 0

/**
 * 게임 상태의 단일 소유자.
 * Phaser 씬과 React 컴포넌트 둘 다 이 스토어만 읽고 쓴다.
 * 어느 쪽도 플레이어 상태 사본을 따로 들고 있지 않다.
 */
export const useGameStore = create<GameStore>((set) => ({
  data: loadGameData(),
  player: null,
  loading: false,
  lastAction: null,

  refresh: async () => {
    set({ loading: true })
    try {
      const { player } = await GameClient.getState()
      set({ player, loading: false })
    } catch (err) {
      set({ loading: false })
      pushAction(set, describeError(err), 'bad')
    }
  },

  gather: async (nodeId) => {
    try {
      const outcome: GatherOutcomeDto = await GameClient.gather(nodeId)
      set({ player: outcome.player })

      if (outcome.success && outcome.gained) {
        const name = labelOf(useGameStore.getState().data, outcome.gained.item)
        pushAction(set, `${name} +${outcome.gained.count}`, 'good')
      } else {
        pushAction(set, '실패', 'bad')
      }
    } catch (err) {
      // 쿨다운은 조용히 넘긴다. 아직 회복되지 않은 노드를 누르는 것은 실수가
      // 아니라 정상적인 조작이라, 매번 알리면 연타할수록 화면이 경고로 덮인다.
      if (err instanceof ApiError && err.code === 'on_cooldown') return
      pushAction(set, describeError(err), 'bad')
    }
  },

  craft: async (recipeId) => {
    try {
      const outcome: CraftOutcomeDto = await GameClient.craft(recipeId)
      set({ player: outcome.player })

      if (outcome.success && outcome.produced) {
        const name = labelOf(useGameStore.getState().data, outcome.produced.item)
        const suffix = outcome.autoEquipped ? ' · 자동 착용' : ''
        pushAction(set, `${name} +${outcome.produced.count}${suffix}`, 'good')
      } else {
        pushAction(set, '제작 실패', 'bad')
      }
    } catch (err) {
      pushAction(set, describeError(err), 'bad')
    }
  },
}))

type SetFn = (partial: Partial<GameStore>) => void

function pushAction(set: SetFn, text: string, tone: ActionFeedback['tone']): void {
  set({ lastAction: { seq: ++actionSeq, text, tone } })
}

function labelOf(data: GameData, itemId: string): string {
  return data.items[itemId]?.name ?? itemId
}

function describeError(err: unknown): string {
  if (!(err instanceof ApiError)) return '서버에 연결할 수 없습니다'
  switch (err.code) {
    case 'cannot_gather':
      return '도구나 숙련도 부족'
    case 'level_too_low':
      return '숙련도 부족'
    case 'missing_materials':
      return '재료 부족'
    default:
      return `오류: ${err.code}`
  }
}

// ---- 셀렉터 ----
// 서버와 같은 공식을 써서 예상치를 계산한다. 별도 구현이 아니다.

export function selectToolTier(skill: SkillId): number {
  const { player, data } = useGameStore.getState()
  return player ? equippedToolTier(player, data, skill) : 0
}

export function selectGatherChance(nodeId: string): number {
  const { player, data } = useGameStore.getState()
  const node = data.nodes[nodeId]
  if (!player || !node) return 0
  return calcGatherChance({
    skillLevel: player.skills[node.skill].level,
    toolTier: equippedToolTier(player, data, node.skill),
    node,
  })
}

export function selectCraftChance(recipeId: string): number {
  const { player, data } = useGameStore.getState()
  const recipe = data.recipes[recipeId]
  if (!player || !recipe) return 0
  return calcCraftSuccess({
    skillLevel: player.skills[recipe.skill].level,
    toolTier: equippedToolTier(player, data, recipe.skill),
    recipe,
  })
}
```

**경험치를 문구에서 뺐다.** 숙련도를 1행동 = +1 방식으로 바꿀 예정이라 지금 숫자를 띄워도 곧 무의미해진다. 서버는 여전히 경험치를 계산하지만 화면에만 나오지 않는다.

- [ ] **Step 2: 플로팅 텍스트를 구현한다**

`apps/client/src/game/FloatingText.ts`:

```ts
import type Phaser from 'phaser'
import { DEPTH } from './depth.js'

/** tokens.css 의 --c-success / --c-danger 와 같은 값이다. 바꿀 때 함께 고친다. */
const TONE_COLORS = {
  good: '#7fa650',
  bad: '#b4543a',
} as const

const RISE_PX = 28
const DURATION_MS = 900

/**
 * 캐릭터 머리 위에서 떠오르며 사라지는 한 줄.
 *
 * 패널로 알리지 않는 이유는 가로 화면에서 시선이 캐릭터에 머물고, 패널은
 * 그 자체로 화면을 가리기 때문이다.
 */
export function spawnFloatingText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  tone: keyof typeof TONE_COLORS,
): void {
  const label = scene.add
    .text(x, y, text, {
      fontSize: '12px',
      color: TONE_COLORS[tone],
      stroke: '#241c1c',
      strokeThickness: 3,
    })
    .setOrigin(0.5, 1)
    .setDepth(DEPTH.floatingText)

  scene.tweens.add({
    targets: label,
    y: y - RISE_PX,
    alpha: 0,
    duration: DURATION_MS,
    ease: 'Cubic.easeOut',
    onComplete: () => label.destroy(),
  })
}
```

- [ ] **Step 3: 씬에서 구독한다**

`apps/client/src/game/scenes/WorldScene.ts` 를 고친다.

상단 import 에 추가한다.

```ts
import { spawnFloatingText } from '../FloatingText.js'
```

클래스 필드에 추가한다.

```ts
  private unsubscribeStore: (() => void) | null = null
```

`create()` 의 `this.dayNight = new DayNightOverlay(this)` 바로 위에 추가한다.

```ts
    // 스토어가 여전히 게임 상태의 단일 소유자다. 씬은 결과를 따로 보관하지
    // 않고 변화가 생길 때만 글자를 띄운다. update() 에서 폴링하면 같은
    // 결과를 두 번 그리지 않도록 소비 여부를 씬이 기억해야 하고, 그게 곧
    // 씬이 상태를 갖는 것이다.
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      const action = state.lastAction
      if (!action || action.seq === prev.lastAction?.seq) return
      spawnFloatingText(
        this,
        this.player.x,
        this.player.y - this.player.displayHeight / 2,
        action.text,
        action.tone,
      )
    })
```

`this.events.once('shutdown', ...)` 콜백을 아래로 교체한다.

```ts
    this.events.once('shutdown', () => {
      this.dayNight.destroy()
      this.unsubscribeStore?.()
      this.unsubscribeStore = null
    })
```

- [ ] **Step 4: 타입 검사와 빌드를 확인한다**

```bash
pnpm typecheck && pnpm --filter @nogada/client build
```

기대: 타입 오류 없음, 빌드 성공

- [ ] **Step 5: 전체 테스트를 확인한다**

```bash
pnpm test
```

기대: 실패 0건

- [ ] **Step 6: 수동 검증한다**

서버와 클라이언트를 띄우고 브라우저를 연다.

**관찰해야 할 것:**

1. 구리 광맥을 눌러 성공하면 캐릭터 머리 위에 **`구리 원석 +2`** 가 초록색으로 떠오르며 사라진다
2. 실패하면 **`실패`** 가 붉은색으로 뜬다
3. **쿨다운 중에 다시 누르면 아무것도 뜨지 않는다** — 이게 이번 작업의 핵심 동작이다. 연타해도 화면이 조용하다
4. 철 광맥을 누르면 `도구나 숙련도 부족` 이 뜬다
5. 글자에 **경험치 숫자가 없다**
6. **밤에도 글자가 어두워지지 않고 또렷하게 읽힌다** (명암보다 위 깊이)
7. 캐릭터를 움직이는 중에 채집해도 글자가 캐릭터 머리 위에서 시작한다
8. 콘솔에 에러가 없다

- [ ] **Step 7: 커밋**

```bash
git add apps/client/src/game apps/client/src/store
git commit -m "feat(client): 행동 피드백을 머리 위 플로팅 텍스트로

패널로 알리지 않는 이유는 가로 화면에서 시선이 캐릭터에 머물고, 패널은
그 자체로 화면을 가리기 때문이다.

쿨다운은 조용히 넘긴다. 아직 회복되지 않은 노드를 누르는 것은 실수가
아니라 정상적인 조작이라, 매번 알리면 연타할수록 화면이 경고로 덮인다.

경험치를 문구에서 뺐다. 숙련도를 1행동 = +1 방식으로 바꿀 예정이라 지금
숫자를 띄워도 곧 무의미해진다. 서버는 여전히 계산하되 화면에만 안 나온다.

씬은 결과를 보관하지 않고 스토어 변화를 구독해 그리기만 한다. update()
에서 폴링하면 같은 결과를 두 번 그리지 않도록 소비 여부를 씬이 기억해야
하고, 그게 곧 씬이 상태를 갖는 것이다. seq 로 구분하는 이유는 같은 문구가
연달아 나올 때 문구 비교만으로는 두 번째를 놓치기 때문이다."
```

---

# 완료 후 — 확인할 것

- [ ] **안드로이드 실기에서 가로로 뜨는지 확인한다.**

```bash
pnpm --filter @nogada/client android:sync
```

```bash
cd apps/client/android && ./gradlew assembleDebug
```

JDK 21 과 Android SDK 경로는 M0+M1 계획의 Task 6 을 따른다. 확인 항목: 세로로 들고 실행해도 가로로 뜨는가, 눕히는 방향을 바꿔도 따라오는가, 상단 상태 바가 노치에 가리지 않는가, 명암 오버레이가 화면 전체를 덮는가.

- [ ] **`GAME_EPOCH_MS` 를 확정한다.** 지금 값은 2026-01-01T00:00:00Z 다. 서비스 시작 후에는 바꿀 수 없으므로, 이 값으로 갈지 지금 결정한다.

- [ ] **다음 작업 후보를 정한다.** 이 계획이 끝나면 화면에는 시계와 명암만 남는다. 인벤토리·제작에 접근할 방법이 없으므로 **온스크린 컨트롤러와 패널**이 자연스러운 다음 순서다. 숙련도 재설계(1행동 = +1)를 먼저 하면 서버 공식을 갈아엎게 되므로, 그 위에 UI 를 얹기 전에 하는 편이 재작업이 적다.
