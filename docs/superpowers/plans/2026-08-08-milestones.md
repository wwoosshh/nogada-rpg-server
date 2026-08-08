# 이정표와 진척 목록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 플레이어가 앞으로 무엇이 열리는지 볼 수 있게 한다 — 채집하는 화면에 다음 목표 한 줄이 상시 떠 있고, 패널을 열면 달성한 것과 못 한 것이 정확한 숫자와 함께 나온다.

**Architecture:** 이정표는 `packages/shared` 의 순수 함수로 판정한다. 모든 지표가 단조 증가하므로 달성 여부는 `PlayerState` 의 함수이고 저장하지 않는다 — 저장하는 것은 "이미 축하했는가" 하나뿐이다. 이정표 정의는 CSV 로 authoring 하고 빌드 때 검증한다. 이정표는 새 게이트를 만들지 않고 **이미 존재하는 게이트를 선언**할 뿐이다.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), pnpm 워크스페이스, Phaser 3, React 18, Vite, Fastify, zod, vitest.

**설계 문서:** [이정표와 진척 목록 설계](../specs/2026-08-08-milestones-design.md)

## Global Constraints

- 게임 규칙은 `packages/shared` 에만 존재한다. 서버와 클라이언트가 동일 함수를 import 한다.
- 숙련도는 기술별 정수 하나다. 상한이 없고 단조 증가한다.
- **이정표는 새 게이트를 만들지 않는다.** 이미 `recipes.csv` 의 `requiredSkill` 과 도구 등급이 강제하는 것을 선언할 뿐이고, 검증이 둘의 일치를 확인한다.
- **달성 여부는 저장하지 않는다.** `PlayerState` 로부터 매번 계산한다. 저장하는 것은 축하 이력뿐이다.
- **"???" 를 쓰지 않는다.** 못 한 이정표도 요구 수치를 그대로 보여준다.
- 모든 판정은 서버가 한다. 클라이언트는 같은 함수로 표시용 계산만 한다.
- **이 게임은 모바일 게임이고 가로로만 플레이한다.**
- 클라이언트 UI 는 자동 테스트하지 않는다. `packages/shared`·`packages/data`·`apps/server` 는 테스트 대상이다.
- `tsconfig.base.json` 은 `strict: true`, `noUncheckedIndexedAccess: true`. import 는 `.js` 확장자를 붙인다.
- 루트 `pnpm test` 는 `pnpm data:build` 를 먼저 돌린다.
- 커밋 메시지는 한국어이고 본문에 *왜* 를 적는다. 트레일러: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **`apps/client/src/ui/App.tsx` 에 커밋되지 않은 개발용 훅 한 줄이 있다.** 어떤 태스크도 그 파일을 건드리거나 커밋하지 않는다. `git add -A` 와 `git commit -a` 를 절대 쓰지 않는다.

---

## File Structure

| 경로 | 책임 |
|---|---|
| `packages/shared/src/milestones.ts` | 이정표 타입, 달성 판정, 진척 계산, 다음 이정표 선택 |
| `packages/shared/src/milestones.test.ts` | 위의 테스트 |
| `packages/data/csv/milestones.csv` | 이정표 정의 authoring |
| `packages/data/src/milestones.ts` | CSV 파싱 |
| `packages/data/src/milestones.test.ts` | 위의 테스트 |
| `apps/client/src/game/scenes/PanelScene.ts` (수정) | 이정표 목록 패널 |
| `apps/client/src/ui/TopBar.tsx` (수정) | 다음 이정표 한 줄 |

**고치는 파일:** `packages/shared/src/types.ts`(`GameData.milestones`, `PlayerState.celebrated`), `packages/shared/src/index.ts`, `packages/shared/src/protocol.ts`, `packages/data/src/build.ts`, `packages/data/src/validate.ts`, `apps/server/src/services/gatherService.ts`·`craftService.ts`, `apps/server/src/state/store.ts`, `apps/client/src/store/gameStore.ts`, `apps/client/src/game/scenes/WorldScene.ts`

---

## Task 1: 이정표 규칙 모듈

**Files:**
- Create: `packages/shared/src/milestones.ts`, `packages/shared/src/milestones.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `SkillId`, `PlayerState` from `./types.js`
- Produces:
  - `MilestoneMetric`, `MilestoneEffect`, `MilestoneDef`
  - `isAchieved(def, player, all): boolean`
  - `metricValue(def, player, all): number` — 지금 값
  - `achievedIds(all, player): Set<string>`
  - `newlyAchieved(all, player, celebrated): MilestoneDef[]`
  - `nextMilestone(all, player): MilestoneDef | null`
  - `milestoneRatio(def, player, all): number` — 0..1

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/milestones.test.ts` 를 만든다. 아래를 그대로 쓴다.

```ts
import { describe, expect, it } from 'vitest'
import type { PlayerState } from './types.js'
import {
  achievedIds,
  isAchieved,
  metricValue,
  milestoneRatio,
  newlyAchieved,
  nextMilestone,
  type MilestoneDef,
} from './milestones.js'

function player(skills: Partial<PlayerState['skills']> = {}): PlayerState {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...skills },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
  }
}

const iceNovice: MilestoneDef = {
  id: 'ice-1000', metric: { kind: 'skill', skill: 'ice' }, threshold: 1000,
  name: '얼음에 익숙해지다', announce: '얼음에 익숙해졌다', effect: { kind: 'title' },
}
const mineralNovice: MilestoneDef = {
  id: 'mineral-1000', metric: { kind: 'skill', skill: 'mineral' }, threshold: 1000,
  name: '광물에 익숙해지다', announce: '광물에 익숙해졌다', effect: { kind: 'title' },
}
const bothNovice: MilestoneDef = {
  id: 'both-1000', metric: { kind: 'every', of: ['ice-1000', 'mineral-1000'] }, threshold: 2,
  name: '고르게 익숙해지다', announce: '두 기술이 고르게 올랐다', effect: { kind: 'title' },
}
const all = [iceNovice, mineralNovice, bothNovice]

describe('isAchieved — skill', () => {
  it('문턱 미만이면 달성이 아니다', () => {
    expect(isAchieved(iceNovice, player({ ice: 999 }), all)).toBe(false)
  })
  it('문턱에 닿으면 달성이다', () => {
    expect(isAchieved(iceNovice, player({ ice: 1000 }), all)).toBe(true)
  })
  it('다른 기술은 보지 않는다', () => {
    expect(isAchieved(iceNovice, player({ mineral: 999999 }), all)).toBe(false)
  })
})

describe('isAchieved — every', () => {
  it('하나만 채우면 달성이 아니다', () => {
    expect(isAchieved(bothNovice, player({ ice: 5000 }), all)).toBe(false)
  })
  it('둘 다 채우면 달성이다', () => {
    expect(isAchieved(bothNovice, player({ ice: 1000, mineral: 1000 }), all)).toBe(true)
  })
  it('없는 이정표를 가리키면 달성될 수 없다', () => {
    // 데이터 검증이 막지만, 막지 못했을 때 조용히 참이 되면 안 된다.
    const ghost: MilestoneDef = {
      ...bothNovice, id: 'ghost', metric: { kind: 'every', of: ['nope'] }, threshold: 1,
    }
    expect(isAchieved(ghost, player({ ice: 999999, mineral: 999999 }), [...all, ghost])).toBe(false)
  })
})

describe('metricValue', () => {
  it('기술은 그 숙련도다', () => {
    expect(metricValue(iceNovice, player({ ice: 42 }), all)).toBe(42)
  })
  it('합산은 달성한 개수다', () => {
    expect(metricValue(bothNovice, player({ ice: 1000 }), all)).toBe(1)
    expect(metricValue(bothNovice, player({ ice: 1000, mineral: 1000 }), all)).toBe(2)
  })
})

describe('milestoneRatio', () => {
  it('0 에서 0, 문턱에서 1 이다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 0 }), all)).toBe(0)
    expect(milestoneRatio(iceNovice, player({ ice: 1000 }), all)).toBe(1)
  })
  it('문턱을 넘어도 1 을 넘지 않는다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 99999 }), all)).toBe(1)
  })
  it('절반이면 0.5 다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 500 }), all)).toBe(0.5)
  })
})

describe('achievedIds', () => {
  it('달성한 것만 담는다', () => {
    const ids = achievedIds(all, player({ ice: 1000 }))
    expect([...ids].sort()).toEqual(['ice-1000'])
  })
  it('합산 이정표도 함께 잡힌다', () => {
    const ids = achievedIds(all, player({ ice: 1000, mineral: 1000 }))
    expect([...ids].sort()).toEqual(['both-1000', 'ice-1000', 'mineral-1000'])
  })
})

describe('newlyAchieved', () => {
  it('축하하지 않은 것만 준다', () => {
    const fresh = newlyAchieved(all, player({ ice: 1000 }), ['ice-1000'])
    expect(fresh).toEqual([])
  })
  it('축하 이력이 비어 있으면 달성한 것을 전부 준다', () => {
    const fresh = newlyAchieved(all, player({ ice: 1000 }), [])
    expect(fresh.map((m) => m.id)).toEqual(['ice-1000'])
  })
  it('축하 이력에 없는 id 가 있어도 무시한다', () => {
    // 이정표를 지운 뒤에도 옛 세이브가 살아 있어야 한다.
    const fresh = newlyAchieved(all, player({ ice: 1000 }), ['사라진것'])
    expect(fresh.map((m) => m.id)).toEqual(['ice-1000'])
  })
})

describe('nextMilestone', () => {
  it('가장 가까운 것을 준다', () => {
    // ice 900/1000 = 0.9, mineral 100/1000 = 0.1 → 얼음이 더 가깝다
    const next = nextMilestone(all, player({ ice: 900, mineral: 100 }))
    expect(next?.id).toBe('ice-1000')
  })
  it('이미 달성한 것은 고르지 않는다', () => {
    const next = nextMilestone(all, player({ ice: 1000, mineral: 100 }))
    expect(next?.id).toBe('mineral-1000')
  })
  it('전부 달성했으면 null 이다', () => {
    expect(nextMilestone(all, player({ ice: 9999, mineral: 9999 }))).toBeNull()
  })
  it('같은 비율이면 순서가 흔들리지 않는다', () => {
    // 매 프레임 다른 것을 보여주면 상단 바가 깜빡인다.
    const p = player({ ice: 500, mineral: 500 })
    expect(nextMilestone(all, p)?.id).toBe(nextMilestone(all, p)?.id)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run packages/shared/src/milestones.test.ts`
Expected: `Failed to resolve import "./milestones.js"`

- [ ] **Step 3: 모듈을 만든다**

`packages/shared/src/milestones.ts`:

```ts
import { clamp } from './formulas/clamp.js'
import type { PlayerState, SkillId } from './types.js'

/**
 * 이정표가 무엇을 보는가.
 *
 * 모든 지표는 단조 증가해야 한다 — 그래야 달성이 되돌려지지 않고,
 * 달성 여부를 저장할 필요가 없어진다.
 */
export type MilestoneMetric =
  | { kind: 'skill'; skill: SkillId }
  /** 나열한 이정표 중 몇 개를 달성했는가. threshold 가 개수다 */
  | { kind: 'every'; of: string[] }

/**
 * 달성했을 때 무엇이 열리는가.
 *
 * `recipes` 와 `nodes` 는 새 게이트를 만드는 것이 아니라 이미 데이터가 강제하는
 * 게이트를 선언하는 것이다. 그래야 목록에 "칭호를 받는다" 와 "철 곡괭이를 만들 수
 * 있게 된다" 가 섞이고, 그 차이가 이 시스템의 값어치다.
 *
 * `title` 은 효과가 없다는 뜻이고, 그 사실을 숨기지 않는다.
 */
export type MilestoneEffect =
  | { kind: 'repeat'; skill: SkillId }
  | { kind: 'recipes'; ids: string[] }
  | { kind: 'nodes'; ids: string[] }
  | { kind: 'title' }

export interface MilestoneDef {
  id: string
  metric: MilestoneMetric
  threshold: number
  name: string
  announce: string
  effect: MilestoneEffect
}

function byId(all: readonly MilestoneDef[], id: string): MilestoneDef | undefined {
  return all.find((m) => m.id === id)
}

/** 그 이정표의 지표가 지금 얼마인가. */
export function metricValue(
  def: MilestoneDef,
  player: PlayerState,
  all: readonly MilestoneDef[],
): number {
  const m = def.metric
  if (m.kind === 'skill') return player.skills[m.skill]

  let count = 0
  for (const id of m.of) {
    const other = byId(all, id)
    // 없는 이정표를 가리키면 세지 않는다. 데이터 검증이 막지만, 막지 못했을 때
    // 조용히 달성되는 것보다 조용히 달성 안 되는 편이 낫다.
    if (other && isAchieved(other, player, all)) count += 1
  }
  return count
}

export function isAchieved(
  def: MilestoneDef,
  player: PlayerState,
  all: readonly MilestoneDef[],
): boolean {
  return metricValue(def, player, all) >= def.threshold
}

/** 목록·상단 바가 쓰는 진척 비율. 0 에서 1 사이로 잘린다. */
export function milestoneRatio(
  def: MilestoneDef,
  player: PlayerState,
  all: readonly MilestoneDef[],
): number {
  if (def.threshold <= 0) return 1
  return clamp(metricValue(def, player, all) / def.threshold, 0, 1)
}

export function achievedIds(
  all: readonly MilestoneDef[],
  player: PlayerState,
): Set<string> {
  const ids = new Set<string>()
  for (const def of all) {
    if (isAchieved(def, player, all)) ids.add(def.id)
  }
  return ids
}

/**
 * 달성했지만 아직 축하하지 않은 것들.
 *
 * 축하 이력에 지금 없는 id 가 들어 있어도 무시한다 — 이정표를 지운 뒤에도
 * 옛 세이브가 그대로 살아 있어야 한다.
 */
export function newlyAchieved(
  all: readonly MilestoneDef[],
  player: PlayerState,
  celebrated: readonly string[],
): MilestoneDef[] {
  const seen = new Set(celebrated)
  return all.filter((def) => !seen.has(def.id) && isAchieved(def, player, all))
}

/**
 * 상단 바에 띄울 하나. 가장 가까운 것이다.
 *
 * 비율이 같으면 정의 순서로 고른다 — 매 프레임 다른 것을 고르면 상단 바가 깜빡인다.
 */
export function nextMilestone(
  all: readonly MilestoneDef[],
  player: PlayerState,
): MilestoneDef | null {
  let best: MilestoneDef | null = null
  let bestRatio = -1
  for (const def of all) {
    if (isAchieved(def, player, all)) continue
    const ratio = milestoneRatio(def, player, all)
    if (ratio > bestRatio) {
      best = def
      bestRatio = ratio
    }
  }
  return best
}
```

- [ ] **Step 4: 배럴에 추가한다**

`packages/shared/src/index.ts` 의 `export * from './movement.js'` 다음 줄에 추가한다.

```ts
export * from './milestones.js'
```

- [ ] **Step 5: `PlayerState` 에 축하 이력을 더한다**

`packages/shared/src/types.ts` 의 `PlayerState` 에 필드를 더한다.

```ts
  /**
   * 이미 축하한 이정표 id.
   *
   * 달성 여부 자체는 저장하지 않는다 — 지표가 전부 단조 증가라 PlayerState 로부터
   * 계산되고, 저장하면 계산값과 어긋날 수 있다. 여기 남기는 것은 "두 번 축하하지
   * 않기" 뿐이고 그건 틀려도 피해가 없다.
   */
  celebrated: string[]
```

`packages/shared/src/protocol.ts` 의 `PlayerStateSchema` 에도 더한다.

```ts
  celebrated: z.array(z.string()),
```

`apps/server/src/state/store.ts` 의 `createInitialPlayer` 에 `celebrated: []` 를 더한다.

이 변경으로 기존 세이브는 스키마 검증에서 버려지고 신규 플레이어로 대체된다. 정상 동작이다.

- [ ] **Step 6: 통과를 확인한다**

Run: `pnpm vitest run packages/shared/src/milestones.test.ts`
Expected: 19개 통과

Run: `pnpm typecheck`
Expected: 오류. `celebrated` 를 만들지 않는 테스트 픽스처들이 걸린다. 전부 `celebrated: []` 를 더해 고친다.

Run: `pnpm test`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```
feat(shared): 이정표 규칙 모듈

달성 여부를 저장하지 않고 PlayerState 로부터 계산한다. 지표가 전부 단조
증가라 가능한 선택이고, 저장하면 계산값과 어긋날 수 있으며 이정표 id 가
바뀔 때 세이브가 깨진다. PlayerState 에 남기는 것은 "이미 축하했는가"
하나뿐이고, 그건 틀려도 최악의 경우 축하가 한 번 더 뜨거나 안 뜰 뿐이다.

합산 이정표가 없는 id 를 가리키면 세지 않는다. 데이터 검증이 막지만,
막지 못했을 때 조용히 달성되는 것보다 조용히 달성 안 되는 편이 낫다.

nextMilestone 이 같은 비율에서 정의 순서를 따르는 이유는 상단 바 때문이다.
매 프레임 다른 것을 고르면 글자가 깜빡인다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 2: 이정표 데이터

**Files:**
- Create: `packages/data/csv/milestones.csv`, `packages/data/src/milestones.ts`, `packages/data/src/milestones.test.ts`
- Modify: `packages/shared/src/types.ts`, `packages/data/src/build.ts`, `packages/data/src/index.ts`, `packages/data/src/validate.ts`, `packages/data/src/validate.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `MilestoneDef`
- Produces: `GameData.milestones: MilestoneDef[]` (정의 순서 유지), `parseMilestones(rows, nodes, recipes)`

- [ ] **Step 1: CSV 를 만든다**

`packages/data/csv/milestones.csv`. 열은 `id,metricKind,metricArg,threshold,name,announce,effectKind,effectArg` 이고, `metricArg` 는 기술 id 또는 `|` 로 이은 이정표 id 목록, `effectArg` 는 `|` 로 이은 레시피/노드 id 또는 기술 id 또는 빈칸이다.

```csv
id,metricKind,metricArg,threshold,name,announce,effectKind,effectArg
ice_1000,skill,ice,1000,얼음에 익숙해지다,얼음을 다루는 손이 익숙해졌다,title,
wood_1000,skill,wood,1000,나무에 익숙해지다,나무를 다루는 손이 익숙해졌다,title,
mineral_1000,skill,mineral,1000,광물에 익숙해지다,광물을 다루는 손이 익숙해졌다,title,
herb_1000,skill,herb,1000,약초에 익숙해지다,약초를 다루는 손이 익숙해졌다,title,
crafting_200,skill,crafting,200,구리 망치를 만들 수 있다,구리 망치를 만들 수 있게 됐다,recipes,copper_hammer
crafting_500,skill,crafting,500,철 도구를 만들 수 있다,철 도구를 만들 수 있게 됐다,recipes,iron_chisel|iron_axe|iron_pickaxe|iron_sickle
ice_10000,skill,ice,10000,얼음이 손에 익다,얼음이 손에 익었다 — 누르고 있으면 계속된다,repeat,ice
wood_10000,skill,wood,10000,나무가 손에 익다,나무가 손에 익었다 — 누르고 있으면 계속된다,repeat,wood
mineral_10000,skill,mineral,10000,광물이 손에 익다,광물이 손에 익었다 — 누르고 있으면 계속된다,repeat,mineral
herb_10000,skill,herb,10000,약초가 손에 익다,약초가 손에 익었다 — 누르고 있으면 계속된다,repeat,herb
crafting_10000,skill,crafting,10000,조합이 손에 익다,조합이 손에 익었다 — 누르고 있으면 계속된다,repeat,crafting
every_1000,every,ice_1000|wood_1000|mineral_1000|herb_1000,4,고르게 익숙해지다,네 가지를 고르게 익혔다,title,
ice_50000,skill,ice,50000,얼음을 오래 다루다,,title,
wood_50000,skill,wood,50000,나무를 오래 다루다,,title,
mineral_50000,skill,mineral,50000,광물을 오래 다루다,,title,
herb_50000,skill,herb,50000,약초를 오래 다루다,,title,
every_10000,every,ice_10000|wood_10000|mineral_10000|herb_10000,4,고르게 손에 익다,네 가지가 모두 손에 익었다,title,
ice_200000,skill,ice,200000,얼음의 장인,,title,
wood_200000,skill,wood,200000,나무의 장인,,title,
mineral_200000,skill,mineral,200000,광물의 장인,,title,
herb_200000,skill,herb,200000,약초의 장인,,title,
crafting_100000,skill,crafting,100000,조합의 장인,,title,
every_200000,every,ice_200000|wood_200000|mineral_200000|herb_200000,4,고르게 장인이 되다,네 가지 모두에서 장인이 됐다,title,
ice_1000000,skill,ice,1000000,얼음의 극한,더 빨라질 수 없는 곳에 닿았다,title,
wood_1000000,skill,wood,1000000,나무의 극한,더 빨라질 수 없는 곳에 닿았다,title,
mineral_1000000,skill,mineral,1000000,광물의 극한,더 빨라질 수 없는 곳에 닿았다,title,
herb_1000000,skill,herb,1000000,약초의 극한,더 빨라질 수 없는 곳에 닿았다,title,
```

`announce` 가 빈 칸인 것들은 화면에 띄우지 않고 목록에만 남는다. 다섯 기술이 같은 문턱을 각각 넘을 때마다 매번 화면을 가리면 소음이 된다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/data/src/milestones.test.ts` 를 만든다. 아래를 검증한다. 각 테스트에 그 규칙이 왜 필요한지 한국어 주석을 단다.

- 정상 행을 파싱해 `MilestoneDef` 로 만든다 (skill·every·repeat·recipes·title 각각)
- `metricKind` 가 모르는 값이면 던진다
- `effectKind` 가 모르는 값이면 던진다
- `metricKind=skill` 인데 `metricArg` 가 기술 id 가 아니면 던진다
- `effectKind=recipes` 인데 없는 레시피 id 를 가리키면 던진다 — **이정표는 게이트를 선언할 뿐이므로 대상이 실재해야 한다**
- `effectKind=nodes` 인데 없는 노드 id 를 가리키면 던진다
- `effectKind=repeat` 인데 `effectArg` 가 기술 id 가 아니면 던진다
- `id` 가 겹치면 던진다
- `threshold` 가 0 이하면 던진다
- 실제 출하 CSV 가 오류 없이 파싱된다

- [ ] **Step 3: 파서를 만든다**

`packages/data/src/milestones.ts` 에 `parseMilestones(rows, nodes, recipes)` 를 만든다. `packages/data/src/parse.ts` 의 기존 오류 메시지 형식(어느 행·어느 열인지 밝히는)을 먼저 읽고 그것에 맞춘다.

`|` 로 이은 목록은 빈 항목을 허용하지 않는다.

- [ ] **Step 4: 타입과 빌드에 연결한다**

`packages/shared/src/types.ts` 의 `GameData` 에 더한다.

```ts
  /** 정의 순서를 유지한다 — nextMilestone 의 동점 처리가 이 순서를 쓴다 */
  milestones: MilestoneDef[]
```

`packages/data/src/build.ts` 가 CSV 를 읽어 넣고, 개수 보고 줄에 `, 이정표 27` 을 이어 붙인다.

`packages/data/src/index.ts` 에 `export * from './milestones.js'` 를 더한다.

- [ ] **Step 5: 검증 규칙을 더한다**

`packages/data/src/validate.ts` 에 규칙을 더한다. 기존 위반 메시지 형식을 먼저 읽는다.

- `every` 이정표가 가리키는 id 가 전부 실재해야 한다
- `every` 이정표에 순환이 없어야 한다 (A 가 B 를, B 가 A 를 가리키면 무한 재귀다)
- `every` 의 `threshold` 가 `of` 의 길이를 넘으면 안 된다 — 넘으면 영원히 달성 불가다
- **`recipes` 효과가 선언한 레시피의 `requiredSkill` 이 그 이정표의 문턱과 같아야 한다** — 이정표는 게이트를 선언할 뿐이므로 어긋나면 목록이 거짓말을 한다
- 모든 채집 기술에 `repeat` 이정표가 정확히 하나씩 있어야 한다

`packages/data/src/validate.test.ts` 에 각 규칙의 위반 사례와 실제 출하 데이터가 통과하는 것을 더한다.

- [ ] **Step 6: 확인한다**

Run: `pnpm data:build`
Expected: `아이템 18, 노드 8, 레시피 6, 배치 13, 이정표 27`, 위반 0건

Run: `pnpm test` / `pnpm typecheck`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```
feat(data): 이정표 정의와 검증

이정표는 새 게이트를 만들지 않고 이미 있는 게이트를 선언한다. 그래서
recipes 효과가 가리키는 레시피의 requiredSkill 이 이정표 문턱과 같은지
검증이 확인한다. 어긋나면 목록이 플레이어에게 거짓말을 하게 된다.

합산 이정표의 순환과, of 길이보다 큰 threshold 도 막는다. 전자는 무한
재귀이고 후자는 영원히 달성 불가인 줄이 목록에 남는 것이다.

announce 가 빈 이정표를 허용한다. 다섯 기술이 같은 문턱을 각각 넘을 때마다
매번 화면을 가리면 축하가 소음이 된다 — 목록에만 남긴다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 3: 서버가 달성을 판정한다

**Files:**
- Modify: `apps/server/src/services/gatherService.ts`·`craftService.ts` 와 각 테스트, `apps/server/src/routes/*.ts`, `apps/client/src/api/GameClient.ts`, `apps/client/src/store/gameStore.ts`

**Interfaces:**
- Consumes: Task 1 의 `newlyAchieved`, Task 2 의 `GameData.milestones`
- Produces: `GatherOutcome`·`CraftOutcome` 에 `achieved: MilestoneDef[]` 추가. 서버가 `player.celebrated` 를 갱신한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/server/src/services/gatherService.test.ts` 에 더한다.

- 성공한 채집이 문턱을 넘기면 `outcome.achieved` 에 그 이정표가 담긴다
- 그 이정표 id 가 `outcome.player.celebrated` 에 들어간다
- 다음 채집에서는 다시 담기지 않는다
- 실패한 채집은 숙련도를 올리지 않으므로 아무것도 담기지 않는다
- 거부당한 요청(`too_fast` 등)은 `celebrated` 를 건드리지 않는다

같은 것을 `craftService.test.ts` 에도 조합 기준으로 더한다.

- [ ] **Step 2: 서비스를 고친다**

두 서비스의 성공 경로에서 숙련도를 올린 **뒤**, 그리고 응답을 만들기 전에:

```ts
  // 달성 판정은 숙련도가 오른 뒤에 한다. 이번 행동으로 넘긴 것을 이번 응답에 실어야
  // 플레이어가 "그 행동 때문에 열렸다" 를 느낀다.
  const achieved = newlyAchieved(data.milestones, player, player.celebrated)
  for (const m of achieved) player.celebrated.push(m.id)
```

`GatherOutcome`·`CraftOutcome` 에 `achieved: MilestoneDef[]` 를 더한다. 실패·거부 경로에서는 빈 배열이다.

- [ ] **Step 3: 클라이언트가 받은 것을 띄운다**

`apps/client/src/api/GameClient.ts` 의 DTO 에 `achieved` 를 더한다.

`apps/client/src/store/gameStore.ts` 에서 **클라이언트 쪽 해금 감지를 통째로 지운다** — `detectUnlock`, `applyPlayer` 안의 이정표 판정, `canRepeat`·`SKILL_LABELS` import 중 그 용도로만 쓰던 것. 대신 응답의 `achieved` 중 `announce` 가 빈 문자열이 아닌 것을 `milestone` 채널에 넣는다.

여러 개가 한 번에 달성되면 순서대로 큐에 넣어 하나씩 보여준다. 겹쳐 뜨면 읽을 수 없다.

`WorldScene` 의 자동 반복 판정(`repeatsOn`)이 `canRepeat(숙련도)` 대신 **그 기술의 `repeat` 이정표를 달성했는지**를 보게 바꾼다. 판정 자체는 `packages/shared` 의 `isAchieved` 를 쓴다.

- [ ] **Step 4: 확인한다**

Run: `pnpm test` / `pnpm typecheck` / `pnpm --filter @nogada/client build`

브라우저에서: 세이브의 `skills.mineral` 을 `995` 로 두고 채집해 1,000 을 넘긴다.
1. 넘기는 순간 화면 가운데에 축하가 뜬다
2. 다시 채집해도 또 뜨지 않는다
3. 서버를 재시작하고 다시 접속해도 뜨지 않는다 (`celebrated` 가 저장됐다)
4. `skills.crafting` 을 `9995` 로 두고 조합을 넘기면 조합 자동 반복이 열린다

각 항목의 결과를 보고한다.

- [ ] **Step 5: 커밋**

```
feat: 서버가 이정표 달성을 판정한다

지금까지 자동 반복 해금은 클라이언트 스토어가 행동 전후를 비교해 판정했다.
축하가 클라이언트에만 있었고 달성 사실이 어디에도 남지 않아, 재접속하면
같은 것을 다시 축하할 수 있었다.

이제 서버가 행동을 처리한 뒤 새로 달성된 것을 찾아 응답에 실어 보내고
축하 이력을 세이브에 남긴다. 나중에 이정표가 실제 보상을 줄 때, 이 이력이
그대로 지급 원장이 된다 — 두 번 주지 않기 위해 필요한 것이 정확히 그것이다.

자동 반복 판정도 숙련도 상수 비교에서 이정표 달성 여부로 옮겼다. 문턱이
데이터 한 곳에만 있게 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 4: 상단 바의 다음 이정표

**Files:**
- Modify: `apps/client/src/ui/TopBar.tsx` (또는 상단 바를 그리는 실제 파일), `apps/client/src/ui/ui.css`

**Interfaces:**
- Consumes: Task 1 의 `nextMilestone`·`metricValue`, Task 2 의 `GameData.milestones`

- [ ] **Step 1: 한 줄을 더한다**

상단 바를 그리는 컴포넌트를 먼저 읽는다. `apps/client/src/ui/` 안에 있고, 지금은 시계와 설정 버튼만 있다. **`App.tsx` 는 건드리지 않는다.**

시계 옆에 다음 이정표 한 줄을 더한다.

```
다음 · 광물 8,240 / 10,000
```

- 스토어의 `player` 와 `data.milestones` 로 `nextMilestone` 을 부른다
- 값이 바뀔 때만 다시 그린다
- `player` 가 없으면(접속 전) 아무것도 그리지 않는다
- 전부 달성했으면 아무것도 그리지 않는다
- 숫자는 천 단위 구분자를 넣는다 — 여덟 자리까지 갈 수 있는 게임이다
- 가로 화면 기준으로 시계와 설정 버튼을 밀어내지 않는다. 길면 이름을 줄인다

이것이 **숙련도를 화면에 처음 노출하는 일**이다. 지금 상단 바에는 시계밖에 없었다.

- [ ] **Step 2: 확인한다**

Run: `pnpm typecheck` / `pnpm --filter @nogada/client build`

브라우저에서 가로 화면(예: 812×375):
1. 접속하면 상단에 다음 이정표가 보인다
2. 채집하면 숫자가 오른다
3. 문턱을 넘으면 다음 이정표로 바뀐다
4. 시계와 설정 버튼이 가려지지 않는다
5. 세로 픽셀을 더 먹지 않는다 (기존 상단 바 높이 안에서 해결)

각 항목의 결과를 보고한다.

- [ ] **Step 3: 커밋**

```
feat(client): 상단 바에 다음 이정표를 상시 표시한다

목록을 패널로만 두면 진척을 확인하려고 진척을 멈춰야 한다 — 패널이 열려
있는 동안 이동과 행동이 막히기 때문이다. 그러면 "다음에 뭐가 있을까" 가
생기지 않는다.

채집하는 화면에서 목표가 보이는 것이 이 시스템의 전부다. 원작의 업적
기념비도 "다음업적 : 얼음숙련50만" 한 줄이었다.

이것이 숙련도를 화면에 처음 노출하는 일이기도 하다. 지금까지 상단 바에는
시계밖에 없어서, 플레이어는 자기가 뭘 얼마나 했는지 알 방법이 없었다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 5: 목록 패널

**Files:**
- Modify: `apps/client/src/game/scenes/PanelScene.ts` (또는 패널을 그리는 실제 파일), `apps/client/src/game/scenes/ControlScene.ts`, `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 1 의 `achievedIds`·`milestoneRatio`·`metricValue`, Task 2 의 `GameData.milestones`

- [ ] **Step 1: 패널을 채운다**

지금 가방·제작 패널은 열리고 닫히지만 안이 비어 있다. **세 번째 패널을 더하고** 그 안에 이정표 목록을 그린다.

컨트롤러에 버튼을 하나 더할지, 기존 패널 중 하나에 넣을지는 구현자가 정한다. 화면 오른쪽 버튼 묶음이 이미 넷이므로 다섯 번째를 더하면 엄지 도달 범위를 넘을 수 있다 — 실기 크기를 재보고 정하고, 무엇을 왜 골랐는지 보고한다.

목록의 각 줄:

- **달성한 것:** 이름, 그리고 무엇이 열렸는지 (`repeat` → "누르고 있으면 계속된다", `recipes` → 그 레시피 이름들, `title` → "칭호")
- **못 한 것:** 이름, 무엇이 열리는지, 그리고 **지금 값 / 필요한 값**

**"???" 를 쓰지 않는다.** 도달까지 얼마나 남았는지 모르면 목표가 아니라 벽이다.

정렬은 못 한 것을 남은 비율이 작은 순으로 먼저, 달성한 것을 그 뒤에 둔다.

줄이 화면보다 많으므로 스크롤이 필요하다. 가로 화면이라 세로 공간이 좁다는 것을 감안한다.

- [ ] **Step 2: 확인한다**

Run: `pnpm typecheck` / `pnpm --filter @nogada/client build`

브라우저에서 가로 화면:
1. 패널을 열면 이정표가 전부 보인다 — 달성한 것과 못 한 것 모두
2. 못 한 것에 지금 값과 필요한 값이 숫자로 나온다
3. 목록이 화면보다 길면 스크롤된다
4. 패널이 열린 동안 캐릭터가 움직이지 않는다 (기존 게이트가 그대로 동작한다)
5. 조합 200 줄이 "구리 망치를 만들 수 있다" 로 보인다 — 칭호와 다른 줄이 섞여 있다
6. 닫으면 조작이 돌아온다

각 항목의 결과를 보고한다. 5번이 이 태스크의 핵심이다 — 목록이 칭호만 나열하면 원작이 한 일의 껍데기만 가져온 것이다.

- [ ] **Step 3: 커밋**

```
feat(client): 이정표 목록 패널

달성한 것과 아직 못 한 것을 함께 보여준다. 못 한 것도 "???" 로 가리지 않고
지금 값과 필요한 값을 그대로 적는다 — 원작의 잠긴 문이 "플레이 1,000시간 +
걸음 2,000,000 + 레벨 99" 를 그대로 출력한 것과 같은 이유다. 도달까지 얼마나
남았는지 모르면 목표가 아니라 벽이다.

목록에 칭호와 실제 해금이 섞이는 것이 이 시스템의 값어치다. "칭호를 받는다"
와 "철 곡괭이를 만들 수 있게 된다" 는 플레이어에게 완전히 다른 무게이고,
원작에서 숙련도가 실제로 한 일도 칭호가 아니라 산출물을 바꾸는 것이었다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 자체 점검

| 설계 문서 항목 | 태스크 |
|---|---|
| 3.1 이정표 모델 (`recipes`·`nodes` 효과 포함) | Task 1, Task 2 |
| 3.2 목록 | Task 5 |
| 3.3 다음 하나를 패널 밖에 상시 | Task 4 |
| 3.4 서버 판정, 달성은 저장하지 않음 | Task 1(모델), Task 3(서버) |
| 5장 데이터 두 축 | Task 2 |
| "이정표는 게이트를 선언할 뿐" | Task 2 의 검증 규칙 |
| "???" 금지 | Task 5 |

**범위 밖으로 남긴 것:** `nodes` 효과는 타입에만 있고 출하 데이터가 쓰지 않는다. 2등급 노드는 도구 등급이 열지 숙련도가 열지 않으므로, 그것을 이정표로 선언하려면 "도구를 가졌는가" 지표가 필요하다. 경제·장비 스펙이 나올 때 함께 본다.
