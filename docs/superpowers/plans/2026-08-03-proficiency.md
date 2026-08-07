# 숙련도 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 경험치·레벨 곡선을 누적 카운터 하나로 바꾸고, 그 숫자가 행동 속도·성공률·수량을 정하게 한다.

**Architecture:** 숙련도는 기술별 정수 하나다. 유효 범위가 8자릿수라 모든 공식이 `log₁₀` 기반 진행도 `t = min(1, log₁₀(s+1)/D)` 를 공유한다. 핵심 축은 **행동 간격** — 초당 2회에서 시작해 숙련도 100만에서 초당 20회에 닿고, 이 가속이 복리로 작용해 8자릿수가 도달 가능해진다. 노드별 쿨다운을 없애고 플레이어당 행동 간격 하나로 대체하며, 채집 노드의 접근 게이트는 도구 등급 하나만 남긴다.

**Tech Stack:** TypeScript / pnpm workspace / Vitest / Fastify + zod / Phaser 3 / React 18 / zustand 5

**관련 문서:** [숙련도 설계](../specs/2026-08-03-proficiency-design.md) · [프로젝트 설계](../specs/2026-08-02-nogada-rpg-fanmade-design.md)

## Global Constraints

설계 문서에서 가져온 전역 규칙. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **게임 공식은 `packages/shared` 에만 존재한다.** 서버와 클라이언트가 동일 함수를 import 한다. 어느 쪽에도 중복 구현하지 않는다.
- **모든 판정과 난수는 서버가 수행한다.** 클라이언트 코드에 `Math.random()` 을 쓰지 않는다.
- **숙련도는 기술별 정수 하나다.** 레벨도 경험치도 없다. 상한을 두지 않는다.
- **채집 노드의 접근 게이트는 도구 등급 하나뿐이다.** 숙련도로 노드를 막지 않는다.
- **제작은 도구 게이트가 없다.** 조합 숙련도가 레시피를 연다.
- **행동 간격은 플레이어당 하나다.** 기술별로 나누지 않는다 — 나누면 번갈아 눌러 실질 속도를 배로 올릴 수 있다.
- **속도 위반(`too_fast`)은 화면에 아무것도 띄우지 않는다.** 쿨다운과 같은 이유로, 연타가 정상 조작인 게임에서 매번 알리면 화면이 경고로 덮인다.
- **효율 배수는 이번 범위에서 항상 1이다.** 식에 자리만 만들고 올리는 수단은 만들지 않는다.
- **기존 세이브는 마이그레이션하지 않는다.** 형식이 맞지 않으면 버리고 새 플레이어를 만든다.
- **클라이언트 UI 는 자동 테스트하지 않는다.** `apps/client` 에는 vitest 설정도 DOM 환경도 없다. 순수 계산은 `packages/shared` 에 두어 테스트한다.
- **Node.js 20 이상**, 패키지 매니저는 **pnpm**.
- **작업 트리에 커밋되지 않은 변경이 있다.** `apps/client/src/ui/App.tsx` 에 개발용 `window.__debugGame` 훅 한 줄이 커밋되지 않은 채 남아 있다. **`git add -A` 나 `git commit -a` 를 쓰지 말고 지정된 경로만 스테이징하라.**

---

## File Structure

```
packages/shared/src/
├─ formulas/proficiency.ts       ★ 신규 — 진행도, 행동 간격, 수량 보너스
├─ formulas/proficiency.test.ts
├─ formulas/skill.ts             ★ 삭제 (skill.test.ts 도)
├─ formulas/gather.ts            skillLevel → proficiency, requiredLevel 제거
├─ formulas/craft.ts             skillLevel → proficiency, requiredLevel → requiredSkill
├─ types.ts                      SkillId 5종, skills·nextActionAt, NodeDef·RecipeDef 열 변경
├─ protocol.ts                   PlayerStateSchema 갱신
└─ index.ts                      배럴에서 skill 제거, proficiency 추가

packages/data/
├─ csv/{items,nodes,recipes}.csv 전면 교체
├─ src/parse.ts                  toFloat 추가, 새 열 파싱
└─ src/validate.ts               새 검증 규칙

apps/server/src/
├─ state/store.ts                createInitialPlayer — 숙련도 0, 기술별 시작 도구
├─ services/gatherService.ts     간격 검사, 숙련도 증가, 수량 보너스
└─ services/craftService.ts      같음

apps/client/src/
├─ store/gameStore.ts            셀렉터가 새 공식 호출
└─ game/scenes/WorldScene.ts     쿨다운 표시 제거

apps/client/public/maps/
└─ world.tmx · world.json        노드 오브젝트의 nodeId 를 새 id 로
```

---

## Task 1: 숙련도 공식 모듈

**Files:**
- Create: `packages/shared/src/formulas/proficiency.ts`
- Create: `packages/shared/src/formulas/proficiency.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: 아래를 `@nogada/shared` 에서 export 한다. **Task 3·4·5 가 쓴다.**
  - `proficiencyProgress(proficiency: number, decades: number): number` — 0~1
  - `actionIntervalMs(proficiency: number): number`
  - `yieldBonus(proficiency: number): number`
  - `const ACTION_INTERVAL_MAX_MS = 500`, `ACTION_INTERVAL_MIN_MS = 50`
  - `const SPEED_DECADES = 6`, `CHANCE_DECADES = 5`, `YIELD_DECADES = 5`
  - `const MAX_YIELD_BONUS = 2`, `MAX_SUCCESS_CHANCE = 0.98`

- [ ] **Step 1: 테스트를 먼저 작성한다**

`packages/shared/src/formulas/proficiency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ACTION_INTERVAL_MAX_MS,
  ACTION_INTERVAL_MIN_MS,
  MAX_YIELD_BONUS,
  actionIntervalMs,
  proficiencyProgress,
  yieldBonus,
} from './proficiency.js'

describe('proficiencyProgress', () => {
  it('숙련도 0 이면 0 이다', () => {
    expect(proficiencyProgress(0, 6)).toBe(0)
  })

  it('10의 D 제곱에서 1 에 닿는다', () => {
    // log10(999999 + 1) = 6
    expect(proficiencyProgress(999_999, 6)).toBeCloseTo(1)
    expect(proficiencyProgress(99_999, 5)).toBeCloseTo(1)
  })

  it('자릿수마다 같은 폭으로 올라간다', () => {
    expect(proficiencyProgress(9, 6)).toBeCloseTo(1 / 6)
    expect(proficiencyProgress(999, 6)).toBeCloseTo(3 / 6)
    expect(proficiencyProgress(99_999, 6)).toBeCloseTo(5 / 6)
  })

  it('1 을 넘지 않는다', () => {
    expect(proficiencyProgress(100_000_000, 6)).toBe(1)
  })

  it('단조 증가한다', () => {
    let prev = -1
    for (const s of [0, 1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000]) {
      const t = proficiencyProgress(s, 6)
      expect(t).toBeGreaterThanOrEqual(prev)
      prev = t
    }
  })

  it('음수 숙련도는 0 으로 본다', () => {
    expect(proficiencyProgress(-5, 6)).toBe(0)
  })
})

describe('actionIntervalMs', () => {
  it('숙련도 0 이면 초당 2회다', () => {
    expect(actionIntervalMs(0)).toBe(ACTION_INTERVAL_MAX_MS)
    expect(ACTION_INTERVAL_MAX_MS).toBe(500)
  })

  it('설계 문서의 곡선표와 일치한다', () => {
    expect(actionIntervalMs(999)).toBe(275)
    expect(actionIntervalMs(9_999)).toBe(200)
    expect(actionIntervalMs(99_999)).toBe(125)
    expect(actionIntervalMs(999_999)).toBe(50)
  })

  it('100만을 넘어도 더 빨라지지 않는다', () => {
    expect(actionIntervalMs(10_000_000)).toBe(ACTION_INTERVAL_MIN_MS)
    expect(actionIntervalMs(100_000_000)).toBe(ACTION_INTERVAL_MIN_MS)
  })

  it('단조 감소한다', () => {
    let prev = Number.POSITIVE_INFINITY
    for (const s of [0, 10, 100, 1_000, 10_000, 100_000, 1_000_000]) {
      const ms = actionIntervalMs(s)
      expect(ms).toBeLessThanOrEqual(prev)
      prev = ms
    }
  })

  it('항상 최소·최대 사이의 정수다', () => {
    for (const s of [0, 7, 77, 777, 7_777, 77_777, 777_777, 7_777_777]) {
      const ms = actionIntervalMs(s)
      expect(Number.isInteger(ms)).toBe(true)
      expect(ms).toBeGreaterThanOrEqual(ACTION_INTERVAL_MIN_MS)
      expect(ms).toBeLessThanOrEqual(ACTION_INTERVAL_MAX_MS)
    }
  })
})

describe('yieldBonus', () => {
  it('초반에는 보너스가 없다', () => {
    expect(yieldBonus(0)).toBe(0)
    expect(yieldBonus(99)).toBe(0)
  })

  it('자릿수가 오르면 늘어난다', () => {
    expect(yieldBonus(999)).toBe(1)
    expect(yieldBonus(99_999)).toBe(MAX_YIELD_BONUS)
  })

  it('상한을 넘지 않는다', () => {
    expect(yieldBonus(100_000_000)).toBe(MAX_YIELD_BONUS)
    expect(MAX_YIELD_BONUS).toBe(2)
  })

  it('항상 0 이상의 정수다', () => {
    for (const s of [0, 5, 50, 5_000, 5_000_000]) {
      const b = yieldBonus(s)
      expect(Number.isInteger(b)).toBe(true)
      expect(b).toBeGreaterThanOrEqual(0)
    }
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

```bash
pnpm vitest run packages/shared/src/formulas/proficiency.test.ts
```

기대: `Failed to resolve import "./proficiency.js"` 로 실패

- [ ] **Step 3: 구현한다**

`packages/shared/src/formulas/proficiency.ts`:

```ts
import { clamp } from './clamp.js'

/**
 * 숙련도가 정하는 것들.
 *
 * 숙련도의 실용 범위는 8자릿수다(초보 10⁵~10⁶, 오래 한 사람 10⁷~10⁸).
 * 선형식은 두 자릿수 안에서 상한에 닿아버리므로 전부 로그로 잡는다.
 */

/** 행동 간격이 자릿수 몇 개에 걸쳐 줄어드는가 */
export const SPEED_DECADES = 6
/** 성공률이 자릿수 몇 개에 걸쳐 오르는가 */
export const CHANCE_DECADES = 5
/** 수량 보너스가 자릿수 몇 개에 걸쳐 오르는가 */
export const YIELD_DECADES = 5

/** 숙련도 0 일 때의 행동 간격 — 초당 2회 */
export const ACTION_INTERVAL_MAX_MS = 500
/** 최고속 — 초당 20회. 원작의 가장 짧은 채집 딜레이와 같다 */
export const ACTION_INTERVAL_MIN_MS = 50

export const MAX_YIELD_BONUS = 2
export const MAX_SUCCESS_CHANCE = 0.98

/**
 * 숙련도를 0~1 진행도로 바꾼다.
 *
 * `decades` 자릿수만큼 올라가면 1 에 닿는다 — 예컨대 6 이면 숙련도 100만에서 1 이다.
 * 자릿수마다 같은 폭으로 오르므로, 1 → 10 의 성장과 10만 → 100만 의 성장이
 * 같은 크기로 느껴진다. 8자릿수를 다루면서 초반이 밋밋해지지 않게 하는 것이 목적이다.
 */
export function proficiencyProgress(proficiency: number, decades: number): number {
  const safe = Math.max(0, proficiency)
  return clamp(Math.log10(safe + 1) / decades, 0, 1)
}

/**
 * 다음 행동까지 기다려야 하는 시간.
 *
 * 이것이 이 게임의 핵심 축이다. 원작에서 이 값을 정한 것은 과금 등급과 광고 버프였고
 * 숙련도가 아니었지만, 이 프로젝트는 과금을 만들지 않으므로 축을 숙련도로 옮겼다.
 * "오래 할수록 빨라진다" 는 체감은 유지되고 수단만 바뀐다.
 *
 * 이 가속이 복리로 작용해야 8자릿수가 현실적인 시간 안에 도달 가능해진다.
 */
export function actionIntervalMs(proficiency: number): number {
  const t = proficiencyProgress(proficiency, SPEED_DECADES)
  return Math.round(ACTION_INTERVAL_MAX_MS - (ACTION_INTERVAL_MAX_MS - ACTION_INTERVAL_MIN_MS) * t)
}

/**
 * 채집 수량에 더해지는 보너스.
 *
 * 상한을 2 로 묶는다 — 속도가 이미 10배까지 복리로 작용하므로 수량까지 크게 굴리면
 * 곱셈이 과해진다.
 */
export function yieldBonus(proficiency: number): number {
  return Math.floor(proficiencyProgress(proficiency, YIELD_DECADES) * MAX_YIELD_BONUS)
}
```

- [ ] **Step 4: 배럴에 추가한다**

`packages/shared/src/index.ts` 의 `export * from './formulas/craft.js'` 바로 뒤에 한 줄을 넣는다.

```ts
export * from './formulas/proficiency.js'
```

- [ ] **Step 5: 통과를 확인한다**

```bash
pnpm vitest run packages/shared/src/formulas/proficiency.test.ts
```

기대: `Tests  15 passed (15)`

- [ ] **Step 6: 전체 테스트와 타입 검사 후 커밋**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음

```bash
git add packages/shared/src/formulas/proficiency.ts packages/shared/src/formulas/proficiency.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): 숙련도 공식 모듈

숙련도의 실용 범위가 8자릿수라 모든 공식을 로그 진행도로 잡는다. 지금의
선형식은 두 자릿수 안에서 상한에 닿아 아예 쓸 수 없다.

행동 간격이 핵심 축이다. 초당 2회에서 시작해 숙련도 100만에서 초당 20회에
닿는다. 양 끝은 원작과 같다 — 원작에서 이 값을 정한 것은 과금 등급이었고,
이 프로젝트는 과금을 만들지 않으므로 축만 숙련도로 옮겼다.

수량 보너스를 최대 2 로 묶는다. 속도가 이미 10배 복리라 수량까지 크게 굴리면
곱셈이 과해진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 숙련도를 정수 하나로 — 타입 전환

이 태스크는 **여러 파일을 한 번에 바꾼다.** 타입을 바꾸면 그것을 쓰는 모든 곳이 동시에 깨지므로 쪼갤 수 없다. 동작은 최대한 그대로 두고 자료형만 옮기는 것이 목적이다.

**Files:**
- Modify: `packages/shared/src/types.ts`
- Delete: `packages/shared/src/formulas/skill.ts`, `packages/shared/src/formulas/skill.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/formulas/gather.ts`, `packages/shared/src/formulas/craft.ts`
- Modify: `packages/shared/src/formulas/gather.test.ts`, `packages/shared/src/formulas/craft.test.ts`
- Modify: `packages/shared/src/equipment.test.ts`
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/data/csv/items.csv`, `nodes.csv`, `recipes.csv`
- Modify: `apps/server/src/state/store.ts`, `apps/server/src/state/store.test.ts`
- Modify: `apps/server/src/services/gatherService.ts`, `gatherService.test.ts`
- Modify: `apps/server/src/services/craftService.ts`, `craftService.test.ts`
- Modify: `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type SkillId = 'ice' | 'wood' | 'mineral' | 'herb' | 'crafting'`
  - `PlayerState.skills: Record<SkillId, number>`
  - `STARTING_TOOL_IDS` — 채집 4종의 1등급 도구
  - `GatherContext { proficiency, toolTier, node }`
  - `CraftContext { proficiency, toolTier, recipe }`
  - **Task 3·4·5 가 이 이름들을 그대로 쓴다.**

- [ ] **Step 1: 타입을 바꾼다**

`packages/shared/src/types.ts` 의 1~38행(파일 시작부터 `PlayerState` 끝까지)을 아래로 교체한다. `ItemDef` 이후는 그대로 둔다.

```ts
export type SkillId = 'ice' | 'wood' | 'mineral' | 'herb' | 'crafting'

export const SKILL_IDS: readonly SkillId[] = ['ice', 'wood', 'mineral', 'herb', 'crafting'] as const

export const SKILL_LABELS: Record<SkillId, string> = {
  ice: '얼음',
  wood: '나무',
  mineral: '광물',
  herb: '허브',
  crafting: '조합',
}

/**
 * 신규 플레이어가 지급받는 시작 도구 ID.
 * 게임 규칙이므로 여기 한 곳에 둔다 — `packages/data`의 도달 가능성 검증과
 * `createInitialPlayer` 가 같은 상수를 참조해 시작 장비를 정한다.
 *
 * 채집 4종은 도구가 없으면 아무것도 못 하므로 1등급 도구를 준다. 조합은 도구가
 * 접근 게이트가 아니라 성공률 보조라 시작 도구가 없다.
 */
export const STARTING_TOOL_IDS: readonly string[] = [
  'copper_chisel',
  'copper_axe',
  'copper_pickaxe',
  'copper_sickle',
] as const

/**
 * 강화 수치가 붙는 순간 개별 정체성이 생겨 스택이 불가능하다.
 * 지금 enhanceLevel 은 항상 0 이지만 구조는 처음부터 분리해 둔다.
 */
export interface ItemInstance {
  instanceId: string
  itemId: string
  enhanceLevel: number
}

export interface PlayerState {
  id: string
  /**
   * 기술별 숙련도. 그 행동을 성공한 누적량이며 상한이 없다.
   * 레벨도 경험치도 없다 — 이 숫자 하나가 속도·성공률·수량을 전부 정한다.
   */
  skills: Record<SkillId, number>
  /** 재료·소모품 — itemId 를 키로 개수만 센다 */
  stacks: Record<string, number>
  /** 장비·도구 — 개별 행 */
  instances: ItemInstance[]
  /** 생활기술별 착용 도구의 instanceId */
  equipped: Partial<Record<SkillId, string>>
  /** 채집 노드별 다음 채집 가능 시각 (epoch ms). Task 5 에서 행동 간격으로 대체된다. */
  nodeCooldowns: Record<string, number>
}
```

- [ ] **Step 2: 경험치 공식을 삭제한다**

```bash
rm packages/shared/src/formulas/skill.ts packages/shared/src/formulas/skill.test.ts
```

`packages/shared/src/index.ts` 에서 아래 줄을 지운다.

```ts
export * from './formulas/skill.js'
```

- [ ] **Step 3: 채집·제작 공식의 인자 이름을 바꾼다**

`packages/shared/src/formulas/gather.ts` 에서 `GatherContext` 와 두 함수를 아래로 교체한다. `toolCoversNode`·`toolMatchesSkill`·`toolAppliesTo` 는 그대로 둔다.

```ts
export interface GatherContext {
  /** 그 기술의 누적 숙련도 */
  proficiency: number
  toolTier: number
  node: NodeDef
}

/** 도구 등급이 모자라면 시도 자체가 불가능하다. 숙련도는 노드를 막지 않는다. */
export function canGather(ctx: GatherContext): boolean {
  return toolCoversNode(ctx.toolTier, ctx.node)
}

/** 채집 성공률. canGather 가 false 면 0. Task 3 에서 로그 곡선으로 바뀐다. */
export function calcGatherChance(ctx: GatherContext): number {
  if (!canGather(ctx)) return 0
  const overTool = ctx.toolTier - ctx.node.tier
  return clamp(0.5 + overTool * 0.1, 0.05, 0.95)
}
```

`packages/shared/src/formulas/craft.ts` 를 아래로 전체 교체한다.

```ts
import type { RecipeDef } from '../types.js'
import { clamp } from './clamp.js'

export interface CraftContext {
  /** 조합 숙련도 */
  proficiency: number
  /** 착용한 망치의 등급. 없으면 0 — 맨손으로도 제작은 가능하되 성공률이 낮다. */
  toolTier: number
  recipe: RecipeDef
}

/** 제작은 도구 게이트가 없다. 조합 숙련도가 레시피를 연다. */
export function canCraft(ctx: CraftContext): boolean {
  return ctx.proficiency >= ctx.recipe.requiredLevel
}

/** 제작 성공률. canCraft 가 false 면 0. Task 3 에서 로그 곡선으로 바뀐다. */
export function calcCraftSuccess(ctx: CraftContext): number {
  if (!canCraft(ctx)) return 0
  return clamp(0.6 + ctx.toolTier * 0.05, 0.1, 1)
}
```

- [ ] **Step 4: CSV 를 새 숙련도 체계로 교체한다**

`packages/data/csv/items.csv` 를 아래로 전체 교체한다. 아이콘 이름은 기존 파일 13종을 재사용하는 임시값이다.

```csv
id,name,kind,toolSkill,toolTier,icon
ice_shard,얼음 조각,material,,,ore_mithril
pure_ice,맑은 얼음,material,,,ingot_mithril
soft_log,무른 통나무,material,,,plate_reinforced
hard_log,단단한 통나무,material,,,ingot_iron
copper_ore,구리 원석,material,,,ore_copper
iron_ore,철 원석,material,,,ore_iron
common_herb,흔한 약초,material,,,ore_mithril
rare_herb,귀한 약초,material,,,ingot_mithril
copper_ingot,구리 주괴,material,,,ingot_copper
copper_chisel,구리 정,tool,ice,1,pickaxe_copper
copper_axe,구리 도끼,tool,wood,1,pickaxe_copper
copper_pickaxe,구리 곡괭이,tool,mineral,1,pickaxe_copper
copper_sickle,구리 낫,tool,herb,1,pickaxe_copper
iron_chisel,철 정,tool,ice,2,pickaxe_iron
iron_axe,철 도끼,tool,wood,2,pickaxe_iron
iron_pickaxe,철 곡괭이,tool,mineral,2,pickaxe_iron
iron_sickle,철 낫,tool,herb,2,pickaxe_iron
copper_hammer,구리 망치,tool,crafting,1,hammer_copper
```

`packages/data/csv/nodes.csv`:

```csv
id,name,skill,tier,requiredLevel,yieldItem,yieldMin,yieldMax,respawnMs
ice_vein,얼음 광맥,ice,1,1,ice_shard,1,3,5000
deep_ice_vein,심층 얼음 광맥,ice,2,1,pure_ice,1,2,5000
young_tree,어린 나무,wood,1,1,soft_log,1,3,5000
old_tree,고목,wood,2,1,hard_log,1,2,5000
copper_vein,구리 광맥,mineral,1,1,copper_ore,1,3,5000
iron_vein,철 광맥,mineral,2,1,iron_ore,1,2,5000
herb_patch,약초 군락,herb,1,1,common_herb,1,3,5000
rare_herb_patch,귀한 약초 군락,herb,2,1,rare_herb,1,2,5000
```

`requiredLevel` 은 전부 1 로 둔다 — 열 자체는 Task 3 에서 제거하지만, 지금 지우면 파서와 타입까지 같이 고쳐야 해서 이 태스크가 더 커진다.

`packages/data/csv/recipes.csv`:

```csv
id,name,skill,requiredLevel,inputs,outputItem,outputCount
copper_ingot,구리 주괴,crafting,1,copper_ore:2,copper_ingot,1
copper_hammer,구리 망치,crafting,200,copper_ingot:2,copper_hammer,1
iron_chisel,철 정,crafting,500,copper_ingot:3|ice_shard:5,iron_chisel,1
iron_axe,철 도끼,crafting,500,copper_ingot:3|soft_log:5,iron_axe,1
iron_pickaxe,철 곡괭이,crafting,500,copper_ingot:3|copper_ore:5,iron_pickaxe,1
iron_sickle,철 낫,crafting,500,copper_ingot:3|common_herb:5,iron_sickle,1
```

**진행 사슬 확인:** 시작 도구 4종(1등급) → 1등급 노드 4종 → 재료 → `copper_ingot` → 2등급 도구 4종 → 2등급 노드 4종. 모든 아이템이 시작 도구에서 도달 가능하다.

- [ ] **Step 5: 서버가 숙련도를 정수로 다루게 한다**

`apps/server/src/state/store.ts` 의 `createInitialPlayer` 안에서 `skills` 를 만드는 부분을 바꾼다.

```ts
  const skills = Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as Record<SkillId, number>
```

`import` 에서 `type SkillState` 를 지운다.

`apps/server/src/services/gatherService.ts`:

- import 에서 `applyXp`, `xpGainForGather` 를 지운다.
- `GatherOutcome` 의 `xpGained: number` 를 `skillGained: number` 로 바꾼다.
- `const skillLevel = player.skills[node.skill].level` 를 `const proficiency = player.skills[node.skill]` 로 바꾸고, `ctx` 를 `{ proficiency, toolTier, node }` 로 만든다.
- 실패 반환의 `xpGained: 0` 을 `skillGained: 0` 으로 바꾼다.
- 성공 경로의 경험치 계산 두 줄을 아래로 바꾼다.

```ts
  const skillGained = 1
  player.skills[node.skill] += skillGained
```

- 성공 반환의 `xpGained` 를 `skillGained` 로 바꾼다.

`apps/server/src/services/craftService.ts` 도 같은 방식으로 바꾼다.

- import 에서 `applyXp`, `xpGainForCraft` 를 지운다.
- `CraftOutcome` 의 `xpGained` 를 `skillGained` 로 바꾼다.
- `const skillLevel = player.skills[recipe.skill].level` 를 `const proficiency = player.skills[recipe.skill]` 로 바꾸고 `ctx` 를 `{ proficiency, toolTier, recipe }` 로 만든다.
- 실패 반환의 `xpGained: 0` 을 `skillGained: 0` 으로 바꾼다.
- 성공 경로를 아래로 바꾼다.

```ts
  const skillGained = 1
  player.skills[recipe.skill] += skillGained
```

- 성공 반환의 `xpGained` 를 `skillGained` 로 바꾼다.

- [ ] **Step 6: 프로토콜 스키마를 갱신한다**

`packages/shared/src/protocol.ts` 의 `SkillStateSchema` 를 삭제하고 `PlayerStateSchema` 의 `skills` 를 바꾼다.

```ts
export const PlayerStateSchema = z.object({
  id: z.string(),
  skills: z.record(z.string(), z.number().int().min(0)),
  stacks: z.record(z.string(), z.number().int().min(0)),
  instances: z.array(ItemInstanceSchema),
  equipped: z.record(z.string(), z.string()),
  nodeCooldowns: z.record(z.string(), z.number()),
})
```

- [ ] **Step 7: 테스트를 새 자료형에 맞춘다**

각 테스트 파일에서 아래를 일괄 적용한다.

- `skills: { mining: { level: N, xp: M }, smithing: {...} }` → `skills: { ice: 0, wood: 0, mineral: N, herb: 0, crafting: M }`
- `skillLevel:` → `proficiency:`
- `player.skills.mining.level` → `player.skills.mineral`
- `outcome.xpGained` → `outcome.skillGained`
- 기술 id: `mining` → `mineral`, `smithing` → `crafting`
- 아이템 id 는 Step 4 의 CSV 를 따른다

`packages/shared/src/formulas/gather.test.ts` 에서 **숙련도로 막히는 것을 검증하던 테스트는 삭제한다** — 이제 도구 등급만 막는다. 대신 아래를 추가한다.

```ts
  it('숙련도가 0 이어도 도구 등급만 맞으면 채집할 수 있다', () => {
    expect(canGather({ proficiency: 0, toolTier: 1, node: copperVein })).toBe(true)
  })
```

`packages/shared/src/formulas/craft.test.ts` 에서 `skillLevel` 을 `proficiency` 로 바꾸고, 요구 숙련도 비교는 새 척도(예: 500)로 맞춘다.

`apps/server/src/app.test.ts` 의 제작 테스트에서 `mithril_hammer` 를 `iron_pickaxe` 로 바꾼다(요구 숙련도 500, 신규 플레이어는 0이라 `level_too_low`).

- [ ] **Step 8: 전체 테스트와 타입 검사를 확인한다**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음. 여기서 남는 오류는 전부 Step 7 의 테스트 갱신 누락이다.

- [ ] **Step 9: 커밋**

```bash
git add packages/shared packages/data apps/server
git commit -m "refactor: 숙련도를 레벨·경험치에서 정수 하나로

원작의 숙련도는 정수 변수 하나이며 레벨도 경험치 곡선도 없다. 그 구조로
바꾼다. xpToNext·applyXp·xpGainFor* 를 전부 지운다.

숙련도 종류를 원작 계열로 교체한다 — 얼음·나무·광물·허브(상호작용 채집)와
조합. 원작에서 이 넷이 변수 번호까지 연달아 배치돼 있어 같은 계열로 설계된
흔적이 보인다.

채집 노드의 접근 게이트에서 숙련도를 뺀다. 도구와 숙련도 두 문이 겹쳐 있어서
M1 검증 때 강화 곡괭이를 만들고도 철 광맥이 열리지 않았다. 문을 하나로 줄이면
채집 -> 제작 -> 더 좋은 도구 -> 상위 채집 이 곧바로 성립한다.

이 커밋에서 증가량은 아직 +1 고정이고 성공률 공식도 그대로다. 자료형만
옮기고 동작은 다음 태스크에서 바꾼다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 성공률을 로그 곡선으로

**Files:**
- Modify: `packages/shared/src/types.ts` (`NodeDef`, `RecipeDef`)
- Modify: `packages/shared/src/formulas/gather.ts`, `craft.ts`
- Modify: `packages/shared/src/formulas/gather.test.ts`, `craft.test.ts`
- Modify: `packages/data/csv/nodes.csv`, `recipes.csv`
- Modify: `packages/data/src/parse.ts`, `packages/data/src/parse.test.ts`
- Modify: `packages/data/src/validate.ts`, `packages/data/src/validate.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `proficiencyProgress`, `CHANCE_DECADES`, `MAX_SUCCESS_CHANCE`
- Produces:
  - `NodeDef.baseChance: number` — 숙련도 0 일 때의 성공률
  - `NodeDef` 에서 `requiredLevel` 제거
  - `RecipeDef.requiredSkill: number` (기존 `requiredLevel` 을 개명)
  - `RecipeDef.baseChance: number`
  - `toFloat(value, context, field): number` (parse.ts 내부)

- [ ] **Step 1: 타입에 baseChance 를 넣고 requiredLevel 을 정리한다**

`packages/shared/src/types.ts` 의 `NodeDef` 와 `RecipeDef` 를 아래로 교체한다.

```ts
export interface NodeDef {
  id: string
  name: string
  skill: SkillId
  /** 채집에 필요한 최소 도구 등급. 이 노드의 유일한 접근 게이트다. */
  tier: number
  /** 숙련도 0 일 때의 성공률 */
  baseChance: number
  yieldItem: string
  yieldMin: number
  yieldMax: number
  respawnMs: number
}

export interface RecipeDef {
  id: string
  name: string
  skill: SkillId
  /** 이 레시피를 여는 데 필요한 조합 숙련도 */
  requiredSkill: number
  /** 숙련도가 요구치와 같을 때의 성공률 */
  baseChance: number
  inputs: RecipeInput[]
  output: RecipeInput
}
```

- [ ] **Step 2: 공식 테스트를 먼저 고친다**

`packages/shared/src/formulas/gather.test.ts` 의 `calcGatherChance` 블록을 아래로 교체한다. 픽스처 노드에 `baseChance: 0.5` 를 넣고 `requiredLevel` 을 지운다.

```ts
describe('calcGatherChance', () => {
  it('도구 등급이 모자라면 0 이다', () => {
    expect(calcGatherChance({ proficiency: 999_999, toolTier: 1, node: ironVein })).toBe(0)
  })

  it('숙련도 0 이면 노드의 기본 성공률이다', () => {
    expect(calcGatherChance({ proficiency: 0, toolTier: 1, node: copperVein })).toBeCloseTo(0.5)
  })

  it('숙련도가 오르면 성공률이 오른다', () => {
    const low = calcGatherChance({ proficiency: 0, toolTier: 1, node: copperVein })
    const high = calcGatherChance({ proficiency: 10_000, toolTier: 1, node: copperVein })
    expect(high).toBeGreaterThan(low)
  })

  it('숙련도 10만에서 상한에 닿는다', () => {
    expect(calcGatherChance({ proficiency: 99_999, toolTier: 1, node: copperVein })).toBeCloseTo(0.98)
  })

  it('상한을 넘지 않는다', () => {
    expect(calcGatherChance({ proficiency: 100_000_000, toolTier: 9, node: copperVein })).toBeCloseTo(0.98)
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

```bash
pnpm vitest run packages/shared/src/formulas/gather.test.ts
```

기대: `baseChance` 가 없어 타입 오류, 또는 상한 0.95 로 인한 값 불일치로 실패

- [ ] **Step 4: 공식을 구현한다**

`packages/shared/src/formulas/gather.ts` 의 `calcGatherChance` 를 교체하고 import 를 추가한다.

```ts
import { CHANCE_DECADES, MAX_SUCCESS_CHANCE, proficiencyProgress } from './proficiency.js'
```

```ts
/**
 * 채집 성공률. canGather 가 false 면 0.
 *
 * 숙련도 10만에서 상한에 닿는다. 상한을 1 이 아니라 0.98 로 두어 판정이 살아 있게
 * 하되, 영구 실패율을 크게 두지는 않는다 — 초당 20회를 누르는 게임에서 잦은 실패는
 * 난이도가 아니라 소음이다.
 */
export function calcGatherChance(ctx: GatherContext): number {
  if (!canGather(ctx)) return 0
  const t = proficiencyProgress(ctx.proficiency, CHANCE_DECADES)
  const base = ctx.node.baseChance
  return clamp(base + (MAX_SUCCESS_CHANCE - base) * t, 0.05, MAX_SUCCESS_CHANCE)
}
```

`packages/shared/src/formulas/craft.ts` 도 같은 방식으로 바꾼다.

```ts
import { CHANCE_DECADES, MAX_SUCCESS_CHANCE, proficiencyProgress } from './proficiency.js'
```

```ts
/** 제작은 도구 게이트가 없다. 조합 숙련도가 레시피를 연다. */
export function canCraft(ctx: CraftContext): boolean {
  return ctx.proficiency >= ctx.recipe.requiredSkill
}

/**
 * 제작 성공률. canCraft 가 false 면 0.
 *
 * 요구 숙련도를 넘어선 만큼으로 계산한다 — 갓 열린 레시피는 기본값이고,
 * 숙련도가 자릿수만큼 더 쌓이면 상한에 닿는다. 망치는 접근 게이트가 아니라
 * 성공률 보조다.
 */
export function calcCraftSuccess(ctx: CraftContext): number {
  if (!canCraft(ctx)) return 0
  const over = ctx.proficiency - ctx.recipe.requiredSkill
  const t = proficiencyProgress(over, CHANCE_DECADES)
  const base = ctx.recipe.baseChance
  return clamp(base + (MAX_SUCCESS_CHANCE - base) * t + ctx.toolTier * 0.02, 0.1, MAX_SUCCESS_CHANCE)
}
```

- [ ] **Step 5: CSV 에 열을 넣는다**

`packages/data/csv/nodes.csv`:

```csv
id,name,skill,tier,baseChance,yieldItem,yieldMin,yieldMax,respawnMs
ice_vein,얼음 광맥,ice,1,0.5,ice_shard,1,3,5000
deep_ice_vein,심층 얼음 광맥,ice,2,0.4,pure_ice,1,2,5000
young_tree,어린 나무,wood,1,0.5,soft_log,1,3,5000
old_tree,고목,wood,2,0.4,hard_log,1,2,5000
copper_vein,구리 광맥,mineral,1,0.5,copper_ore,1,3,5000
iron_vein,철 광맥,mineral,2,0.4,iron_ore,1,2,5000
herb_patch,약초 군락,herb,1,0.5,common_herb,1,3,5000
rare_herb_patch,귀한 약초 군락,herb,2,0.4,rare_herb,1,2,5000
```

`packages/data/csv/recipes.csv`:

```csv
id,name,skill,requiredSkill,baseChance,inputs,outputItem,outputCount
copper_ingot,구리 주괴,crafting,0,0.6,copper_ore:2,copper_ingot,1
copper_hammer,구리 망치,crafting,200,0.55,copper_ingot:2,copper_hammer,1
iron_chisel,철 정,crafting,500,0.5,copper_ingot:3|ice_shard:5,iron_chisel,1
iron_axe,철 도끼,crafting,500,0.5,copper_ingot:3|soft_log:5,iron_axe,1
iron_pickaxe,철 곡괭이,crafting,500,0.5,copper_ingot:3|copper_ore:5,iron_pickaxe,1
iron_sickle,철 낫,crafting,500,0.5,copper_ingot:3|common_herb:5,iron_sickle,1
```

- [ ] **Step 6: 파서에 소수 파싱을 추가한다**

`packages/data/src/parse.ts` 의 `toInt` 아래에 함수를 추가한다.

```ts
/**
 * 소수로 변환하고 범위를 검사한다.
 *
 * baseChance 처럼 0~1 사이여야 하는 확률값용이다. 정수 검사(toInt)를 그대로
 * 쓰면 0.5 가 통과하지 못하고, 검사를 아예 빼면 1.5 같은 값이 실려 성공률이
 * 상한에 눌러붙는 형태로 나중에야 드러난다.
 */
function toFloat(value: string, context: string, field: string, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${context}: ${field} "${value}" 는 숫자가 아니다`)
  if (n < min || n > max) {
    throw new Error(`${context}: ${field} "${value}" 는 ${min} 이상 ${max} 이하여야 한다`)
  }
  return n
}
```

`parseNodes` 에서 `requiredLevel` 줄을 지우고 `baseChance` 를 넣는다.

```ts
      baseChance: toFloat(requireCell(row, 'baseChance', ctx), ctx, 'baseChance', 0.01, 1),
```

`parseRecipes` 에서 `requiredLevel` 줄을 아래 두 줄로 교체한다. 요구 숙련도는 0 이 정상값이므로 최솟값을 0 으로 준다.

```ts
      requiredSkill: toInt(requireCell(row, 'requiredSkill', ctx), ctx, 'requiredSkill', 0),
      baseChance: toFloat(requireCell(row, 'baseChance', ctx), ctx, 'baseChance', 0.01, 1),
```

- [ ] **Step 7: 파서 테스트를 갱신하고 검증 규칙을 더한다**

`packages/data/src/parse.test.ts` 의 노드·레시피 테스트에 새 열을 넣고 기대값을 맞춘다. 아래 두 테스트를 추가한다.

```ts
  it('baseChance 가 범위를 벗어나면 던진다', () => {
    expect(() =>
      parseNodes([
        {
          id: 'bad', name: '나쁜 노드', skill: 'mineral', tier: '1', baseChance: '1.5',
          yieldItem: 'copper_ore', yieldMin: '1', yieldMax: '3', respawnMs: '5000',
        },
      ]),
    ).toThrow(/baseChance/)
  })

  it('requiredSkill 은 0 을 허용한다', () => {
    const recipes = parseRecipes([
      {
        id: 'copper_ingot', name: '구리 주괴', skill: 'crafting', requiredSkill: '0',
        baseChance: '0.6', inputs: 'copper_ore:2', outputItem: 'copper_ingot', outputCount: '1',
      },
    ])
    expect(recipes.copper_ingot!.requiredSkill).toBe(0)
  })
```

`packages/data/src/validate.ts` 의 노드 검사 블록 안에 한 줄을 더한다.

```ts
    if (node.baseChance <= 0 || node.baseChance > 1) {
      violations.push(`nodes[${node.id}]: baseChance 가 0 초과 1 이하가 아니다`)
    }
```

같은 파일 상단 주석에서 `requiredLevel` 을 언급한 문단을 아래로 고친다.

```
 * 숙련도는 일부러 보지 않는다 — 채집 노드는 도구 등급만이 접근 게이트이고,
 * 레시피의 요구 숙련도는 그라인딩으로 언젠가 항상 도달한다. 도구 등급만이
 * 아무리 그라인딩해도 못 넘는 하드 게이트다.
```

`packages/data/src/validate.test.ts` 의 픽스처에 `baseChance` 를 넣고, 위반 케이스를 하나 추가한다.

```ts
  it('baseChance 가 1 을 넘는 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.baseChance = 1.5
    expect(validateGameData(data)).toContain('nodes[copper_vein]: baseChance 가 0 초과 1 이하가 아니다')
  })
```

- [ ] **Step 8: 서비스의 필드명을 맞춘다**

`apps/server/src/services/craftService.ts` 에는 `recipe.requiredLevel` 을 읽는 곳이 없다(공식이 대신 본다). 타입 검사가 통과하는지만 확인한다.

`apps/server/src/services/gatherService.ts` 와 `craftService.ts` 의 테스트 픽스처에 `baseChance` 를 넣고, 레시피 픽스처의 `requiredLevel` 을 `requiredSkill` 로 바꾼다.

- [ ] **Step 9: 전체 테스트와 타입 검사 후 커밋**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음

```bash
git add packages/shared packages/data apps/server
git commit -m "feat: 성공률을 로그 곡선으로

숙련도 유효 범위가 8자릿수라 선형식은 두 자릿수 안에서 상한에 닿는다.
자릿수 기준 진행도를 써서 10만에서 상한에 이르게 한다.

상한을 1 이 아니라 0.98 로 둔다. 판정이 살아 있게 하되 영구 실패율을 크게
두지는 않는다 - 초당 20회를 누르는 게임에서 잦은 실패는 난이도가 아니라
소음이다.

노드에서 requiredLevel 을 없애고 baseChance 를 넣는다. 접근은 도구 등급만
막고, 숙련도는 그 노드를 얼마나 잘 캐느냐만 정한다.

레시피의 requiredLevel 을 requiredSkill 로 개명한다. 척도가 레벨이 아니라
누적 숙련도로 바뀌었으므로 이름이 값의 의미를 오해하게 한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 숙련도 증가량과 수량 보너스를 데이터로

**Files:**
- Modify: `packages/shared/src/types.ts` (`NodeDef`, `RecipeDef`)
- Modify: `packages/data/csv/nodes.csv`, `recipes.csv`
- Modify: `packages/data/src/parse.ts`, `parse.test.ts`
- Modify: `packages/data/src/validate.ts`, `validate.test.ts`
- Modify: `apps/server/src/services/gatherService.ts`, `gatherService.test.ts`
- Modify: `apps/server/src/services/craftService.ts`, `craftService.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `yieldBonus`, Task 3 의 CSV 구조
- Produces:
  - `NodeDef.skillGainMin: number`, `NodeDef.skillGainMax: number`
  - `RecipeDef.skillGainMin: number`, `RecipeDef.skillGainMax: number`
  - `GatherOutcome.skillGained` 이 데이터에서 나온 값이 된다

- [ ] **Step 1: 타입에 증가량 범위를 넣는다**

`packages/shared/src/types.ts` 의 `NodeDef` 에 두 줄, `RecipeDef` 에 두 줄을 더한다.

```ts
  /** 채집 1회당 숙련도 증가량의 범위. 원작은 등급과 무관하게 1~2 다. */
  skillGainMin: number
  skillGainMax: number
```

```ts
  /** 제작 1회당 숙련도 증가량의 범위. 대략 요구 숙련도의 0.5~1% 다. */
  skillGainMin: number
  skillGainMax: number
```

- [ ] **Step 2: CSV 에 열을 넣는다**

`packages/data/csv/nodes.csv`:

```csv
id,name,skill,tier,baseChance,yieldItem,yieldMin,yieldMax,respawnMs,skillGainMin,skillGainMax
ice_vein,얼음 광맥,ice,1,0.5,ice_shard,1,3,5000,1,2
deep_ice_vein,심층 얼음 광맥,ice,2,0.4,pure_ice,1,2,5000,1,2
young_tree,어린 나무,wood,1,0.5,soft_log,1,3,5000,1,2
old_tree,고목,wood,2,0.4,hard_log,1,2,5000,1,2
copper_vein,구리 광맥,mineral,1,0.5,copper_ore,1,3,5000,1,2
iron_vein,철 광맥,mineral,2,0.4,iron_ore,1,2,5000,1,2
herb_patch,약초 군락,herb,1,0.5,common_herb,1,3,5000,1,2
rare_herb_patch,귀한 약초 군락,herb,2,0.4,rare_herb,1,2,5000,1,2
```

`packages/data/csv/recipes.csv`:

```csv
id,name,skill,requiredSkill,baseChance,inputs,outputItem,outputCount,skillGainMin,skillGainMax
copper_ingot,구리 주괴,crafting,0,0.6,copper_ore:2,copper_ingot,1,10,20
copper_hammer,구리 망치,crafting,200,0.55,copper_ingot:2,copper_hammer,1,15,25
iron_chisel,철 정,crafting,500,0.5,copper_ingot:3|ice_shard:5,iron_chisel,1,20,35
iron_axe,철 도끼,crafting,500,0.5,copper_ingot:3|soft_log:5,iron_axe,1,20,35
iron_pickaxe,철 곡괭이,crafting,500,0.5,copper_ingot:3|copper_ore:5,iron_pickaxe,1,20,35
iron_sickle,철 낫,crafting,500,0.5,copper_ingot:3|common_herb:5,iron_sickle,1,20,35
```

- [ ] **Step 3: 파서와 검증을 갱신한다**

`packages/data/src/parse.ts` 의 `parseNodes` 와 `parseRecipes` 각각에 두 줄씩 더한다.

```ts
      skillGainMin: toInt(requireCell(row, 'skillGainMin', ctx), ctx, 'skillGainMin'),
      skillGainMax: toInt(requireCell(row, 'skillGainMax', ctx), ctx, 'skillGainMax'),
```

`packages/data/src/validate.ts` 의 노드 검사와 레시피 검사에 각각 한 줄씩 더한다.

```ts
    if (node.skillGainMin > node.skillGainMax) {
      violations.push(`nodes[${node.id}]: skillGainMin 이 skillGainMax 보다 크다`)
    }
```

```ts
    if (recipe.skillGainMin > recipe.skillGainMax) {
      violations.push(`recipes[${recipe.id}]: skillGainMin 이 skillGainMax 보다 크다`)
    }
```

`packages/data/src/validate.test.ts` 의 픽스처에 `skillGainMin: 1, skillGainMax: 2` 를 넣고 위반 케이스를 하나 추가한다.

```ts
  it('skillGainMin 이 skillGainMax 보다 큰 노드를 잡아낸다', () => {
    const data = baseData()
    data.nodes.copper_vein!.skillGainMin = 5
    expect(validateGameData(data)).toContain('nodes[copper_vein]: skillGainMin 이 skillGainMax 보다 크다')
  })
```

`packages/data/src/parse.test.ts` 의 노드·레시피 테스트에 새 열을 넣고 기대 객체에 반영한다.

- [ ] **Step 4: 서비스 테스트를 먼저 고친다**

`apps/server/src/services/gatherService.test.ts` 의 픽스처 노드에 `skillGainMin: 1, skillGainMax: 2` 를 넣고 아래 테스트를 추가한다.

```ts
  it('성공하면 노드가 정한 만큼 숙련도가 오른다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.skillGained).toBeGreaterThanOrEqual(1)
    expect(r.outcome.skillGained).toBeLessThanOrEqual(2)
    expect(r.outcome.player.skills.mineral).toBe(r.outcome.skillGained)
  })

  it('숙련도가 높으면 수량 보너스가 붙는다', () => {
    const low = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0 })
    const high = performGather({
      player: player({ skills: { ice: 0, wood: 0, mineral: 99_999, herb: 0, crafting: 0 } }),
      data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 0,
    })
    if (!low.ok || !high.ok) throw new Error('둘 다 성공해야 한다')
    expect(high.outcome.gained!.count).toBeGreaterThan(low.outcome.gained!.count)
  })

  it('실패하면 숙련도가 오르지 않는다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysFail, now: 0 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.skillGained).toBe(0)
    expect(r.outcome.player.skills.mineral).toBe(0)
  })
```

`apps/server/src/services/craftService.test.ts` 의 픽스처 레시피에 `skillGainMin: 10, skillGainMax: 20` 을 넣고 아래를 추가한다.

```ts
  it('성공하면 레시피가 정한 만큼 조합 숙련도가 오른다', () => {
    const p = player({ stacks: { copper_ore: 5 } })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId })
    if (!r.ok) throw new Error('성공해야 한다')

    expect(r.outcome.skillGained).toBeGreaterThanOrEqual(10)
    expect(r.outcome.skillGained).toBeLessThanOrEqual(20)
    expect(r.outcome.player.skills.crafting).toBe(r.outcome.skillGained)
  })
```

- [ ] **Step 5: 실패를 확인한다**

```bash
pnpm vitest run apps/server/src/services
```

기대: `skillGained` 가 항상 1 이라 범위·보너스 테스트가 실패

- [ ] **Step 6: 서비스를 구현한다**

`apps/server/src/services/gatherService.ts` 의 import 에 추가한다.

```ts
  yieldBonus,
```

성공 경로의 수량 계산과 숙련도 증가를 아래로 바꾼다.

```ts
  const count = rollInt(rng, node.yieldMin, node.yieldMax) + yieldBonus(proficiency)
  player.stacks[node.yieldItem] = (player.stacks[node.yieldItem] ?? 0) + count

  // 효율 배수는 아직 항상 1 이다. 식에 자리를 두는 이유는, 나중에 배수를 도입할 때
  // 저장된 숙련도의 의미나 증가 경로를 다시 손대지 않기 위해서다.
  const skillGained = rollInt(rng, node.skillGainMin, node.skillGainMax) * EFFICIENCY_MULTIPLIER
  player.skills[node.skill] += skillGained
```

같은 파일 상단에 상수를 둔다.

```ts
/** 효율 배수. 이번 범위에서는 항상 1 이고, 올리는 수단은 아직 없다. */
const EFFICIENCY_MULTIPLIER = 1
```

`apps/server/src/services/craftService.ts` 의 성공 경로에서 숙련도 증가를 아래로 바꾸고 같은 상수를 둔다.

```ts
  const skillGained = rollInt(rng, recipe.skillGainMin, recipe.skillGainMax) * EFFICIENCY_MULTIPLIER
  player.skills[recipe.skill] += skillGained
```

`rollInt` 를 import 에 추가한다.

- [ ] **Step 7: 통과를 확인하고 커밋한다**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음

```bash
git add packages/shared packages/data apps/server
git commit -m "feat: 숙련도 증가량과 수량 보너스를 데이터에서 읽는다

원작에서 채집은 등급과 무관하게 +1~2 고정이고, 제작은 레시피 등급에 비례해
최상위가 한 번에 수만~십수만이다. 그래서 증가량을 공식이 아니라 노드와
레시피가 각자 정하게 한다. 채집에서 상위 노드에 가는 이유는 숙련도가 아니라
재료다.

효율 배수 자리를 미리 만든다. 항상 1 이고 올리는 수단은 없지만, 나중에
배수를 도입할 때 저장된 숙련도의 의미나 증가 경로를 다시 손대지 않기 위해서다.

수량 보너스는 최대 2 로 묶는다. 속도가 이미 10배 복리라 수량까지 크게
굴리면 곱셈이 과해진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 노드 쿨다운을 행동 간격으로

**Files:**
- Modify: `packages/shared/src/types.ts` (`PlayerState`, `NodeDef`)
- Modify: `packages/shared/src/protocol.ts`
- Modify: `packages/data/csv/nodes.csv`
- Modify: `packages/data/src/parse.ts`, `parse.test.ts`
- Modify: `apps/server/src/state/store.ts`, `store.test.ts`
- Modify: `apps/server/src/services/gatherService.ts`, `gatherService.test.ts`
- Modify: `apps/server/src/services/craftService.ts`, `craftService.test.ts`
- Modify: `apps/server/src/routes/craft.ts`
- Modify: `apps/server/src/app.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `actionIntervalMs`
- Produces:
  - `PlayerState.nextActionAt: number` (`nodeCooldowns` 를 대체)
  - `GatherErrorCode` 에 `'too_fast'` 추가, `'on_cooldown'` 제거
  - `CraftErrorCode` 에 `'too_fast'` 추가
  - `PerformCraftArgs` 에 `now: number` 추가

- [ ] **Step 1: 타입을 바꾼다**

`packages/shared/src/types.ts` 의 `PlayerState` 마지막 필드를 교체한다.

```ts
  /**
   * 다음 행동이 가능한 시각 (epoch ms, 서버 시계 기준).
   *
   * 노드별 쿨다운이 아니라 플레이어당 하나다. 원작에 노드 리스폰 개념이 없고,
   * 속도를 정하는 것은 노드가 아니라 행동 간격이다. 기술별로 나누면 여러 기술을
   * 번갈아 눌러 실질 속도를 배로 올릴 수 있다.
   */
  nextActionAt: number
```

`NodeDef` 에서 `respawnMs` 줄을 지운다.

`packages/shared/src/protocol.ts` 의 `PlayerStateSchema` 에서 `nodeCooldowns` 줄을 교체한다.

```ts
  nextActionAt: z.number(),
```

- [ ] **Step 2: CSV 와 파서에서 respawnMs 를 없앤다**

`packages/data/csv/nodes.csv`:

```csv
id,name,skill,tier,baseChance,yieldItem,yieldMin,yieldMax,skillGainMin,skillGainMax
ice_vein,얼음 광맥,ice,1,0.5,ice_shard,1,3,1,2
deep_ice_vein,심층 얼음 광맥,ice,2,0.4,pure_ice,1,2,1,2
young_tree,어린 나무,wood,1,0.5,soft_log,1,3,1,2
old_tree,고목,wood,2,0.4,hard_log,1,2,1,2
copper_vein,구리 광맥,mineral,1,0.5,copper_ore,1,3,1,2
iron_vein,철 광맥,mineral,2,0.4,iron_ore,1,2,1,2
herb_patch,약초 군락,herb,1,0.5,common_herb,1,3,1,2
rare_herb_patch,귀한 약초 군락,herb,2,0.4,rare_herb,1,2,1,2
```

`packages/data/src/parse.ts` 의 `parseNodes` 에서 `respawnMs` 줄을 지운다. `parse.test.ts` 의 노드 테스트에서도 지운다.

- [ ] **Step 3: 서비스 테스트를 먼저 고친다**

`apps/server/src/services/gatherService.test.ts` 에서 쿨다운 테스트 세 개(`on_cooldown` 관련)를 지우고 아래로 교체한다. 픽스처 플레이어의 `nodeCooldowns: {}` 를 `nextActionAt: 0` 으로 바꾼다.

```ts
  it('간격이 지나지 않았으면 too_fast 로 거부한다', () => {
    const p = player({ nextActionAt: 8000 })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  it('간격이 지났으면 채집할 수 있다', () => {
    const p = player({ nextActionAt: 5000 })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 5000 })
    expect(r.ok).toBe(true)
  })

  it('숙련도 0 이면 다음 행동까지 500ms 를 기다린다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('숙련도가 높으면 간격이 짧아진다', () => {
    const p = player({ skills: { ice: 0, wood: 0, mineral: 999_999, herb: 0, crafting: 0 } })
    const r = performGather({ player: p, data, nodeId: 'copper_vein', rng: alwaysSucceed, now: 1000 })
    if (!r.ok) throw new Error('성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 50)
  })

  it('실패해도 간격은 걸린다', () => {
    const r = performGather({ player: player(), data, nodeId: 'copper_vein', rng: alwaysFail, now: 1000 })
    if (!r.ok) throw new Error('요청 자체는 성공해야 한다')
    expect(r.outcome.player.nextActionAt).toBe(1000 + 500)
  })

  it('자격 미달은 간격을 소비하지 않는다', () => {
    const p = player({ nextActionAt: 0 })
    performGather({ player: p, data, nodeId: 'iron_vein', rng: alwaysSucceed, now: 1000 })
    expect(p.nextActionAt).toBe(0)
  })
```

`GatherOutcome` 에서 `cooldownUntil` 을 검사하던 테스트도 지운다.

`apps/server/src/services/craftService.test.ts` 의 모든 `performCraft` 호출에 `now: 0` 을 더하고, 픽스처 플레이어에 `nextActionAt: 0` 을 넣는다. 아래를 추가한다.

```ts
  it('간격이 지나지 않았으면 too_fast 로 거부한다', () => {
    const p = player({ stacks: { copper_ore: 5 }, nextActionAt: 8000 })
    const r = performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 5000 })
    expect(r).toEqual({ ok: false, code: 'too_fast' })
  })

  it('재료 부족은 간격을 소비하지 않는다', () => {
    const p = player({ nextActionAt: 0 })
    performCraft({ player: p, data, recipeId: 'copper_ingot', rng: alwaysSucceed, newId: nextId, now: 1000 })
    expect(p.nextActionAt).toBe(0)
  })
```

- [ ] **Step 4: 실패를 확인한다**

```bash
pnpm vitest run apps/server/src/services
```

기대: `nextActionAt` 이 없어 타입 오류로 실패

- [ ] **Step 5: 채집 서비스를 구현한다**

`apps/server/src/services/gatherService.ts` 의 import 에 `actionIntervalMs` 를 더하고, `GatherOutcome` 에서 `cooldownUntil` 을 지운다. `GatherErrorCode` 를 바꾼다.

```ts
export type GatherErrorCode = 'unknown_node' | 'cannot_gather' | 'too_fast'

export type GatherResult = { ok: true; outcome: GatherOutcome } | { ok: false; code: GatherErrorCode }
```

`performGather` 의 본문에서 쿨다운 블록을 아래로 교체한다. **검사 순서가 요구사항이다.**

```ts
  // 검사 순서: 대상 존재 → 접근 자격 → 간격 → 난수.
  //
  // 간격 검사가 난수보다 앞인 이유는, 거부된 요청이 시드를 소비하면 연타로 판정
  // 결과를 흔들 수 있기 때문이다. 자격 검사보다 뒤인 이유는, 캘 수 없는 노드를
  // 두드리는 것이 간격까지 잡아먹으면 안 되기 때문이다 — 자격 미달은 조작
  // 실수이지 속도 위반이 아니다.
  if (now < player.nextActionAt) return { ok: false, code: 'too_fast' }

  const chance = calcGatherChance(ctx)
  const success = rng() < chance

  // 성패와 무관하게 간격은 걸린다. 실패도 한 번의 행동이다.
  player.nextActionAt = now + actionIntervalMs(proficiency)
```

실패·성공 반환에서 `cooldownUntil` 을 지운다.

- [ ] **Step 6: 제작 서비스를 구현한다**

`apps/server/src/services/craftService.ts` 의 `PerformCraftArgs` 에 `now: number` 를 더하고, import 에 `actionIntervalMs` 를 넣는다.

```ts
export type CraftErrorCode = 'unknown_recipe' | 'level_too_low' | 'missing_materials' | 'too_fast'
```

재료 검사 블록 바로 뒤, 난수를 굴리기 전에 넣는다.

```ts
  // 채집과 같은 순서다 — 자격·재료 확인이 먼저이고, 간격은 난수보다 앞이다.
  if (args.now < player.nextActionAt) return { ok: false, code: 'too_fast' }

  const chance = calcCraftSuccess(ctx)
  const success = rng() < chance

  player.nextActionAt = args.now + actionIntervalMs(proficiency)
```

`apps/server/src/routes/craft.ts` 의 `performCraft` 호출에 `now: Date.now()` 를 더한다.

- [ ] **Step 7: 저장소와 라우트를 맞춘다**

`apps/server/src/state/store.ts` 의 `createInitialPlayer` 반환에서 `nodeCooldowns: {}` 를 `nextActionAt: 0` 으로 바꾼다. `store.test.ts` 의 관련 기대도 바꾼다.

`apps/server/src/routes/gather.ts` 의 실패 응답에서 `on_cooldown` 분기를 지우고 항상 400 을 보낸다.

```ts
    if (!result.ok) return reply.code(400).send({ code: result.code })
```

`apps/server/src/app.test.ts` 에서 409 쿨다운 테스트를 지우고 아래로 교체한다.

```ts
  it('간격 안에 재요청하면 400 too_fast 를 반환한다', async () => {
    const app = buildTestApp()

    await app.inject({ method: 'POST', url: '/api/gather', payload: { nodeId: 'copper_vein' } })
    const res = await app.inject({
      method: 'POST',
      url: '/api/gather',
      payload: { nodeId: 'copper_vein' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ code: 'too_fast' })

    await app.close()
  })
```

같은 파일에서 `nodeCooldowns` 를 읽던 테스트를 `nextActionAt` 으로 바꾼다.

- [ ] **Step 8: 형식이 맞지 않는 세이브를 버린다**

숙련도 자료형과 `nextActionAt` 이 바뀌었으므로 이전 세이브를 그대로 읽으면 `player.skills.mineral` 이 객체이거나 `nextActionAt` 이 없는 상태로 판정에 들어간다. 마이그레이션은 하지 않기로 했으므로(설계 문서 7) **읽을 때 검사해서 버린다.**

`apps/server/src/state/store.ts` 의 생성자를 아래로 교체한다.

```ts
  constructor(private readonly filePath: string) {
    this.players = existsSync(filePath) ? readPlayers(filePath) : {}
  }
```

같은 파일에 함수를 추가한다. `PlayerStateSchema` 를 import 한다.

```ts
/**
 * 저장 파일을 읽되 형식이 맞지 않는 항목은 버린다.
 *
 * 숙련도 자료형이 바뀌었으므로 이전 세이브를 그대로 신뢰하면 객체를 숫자로 더하는
 * 식의 오류가 판정 한복판에서 터진다. 마이그레이션하지 않기로 한 이상, 조용히
 * 버리고 새로 만드는 편이 낫다 — 개발용 세이브 하나뿐이다.
 *
 * 실제 유저 데이터가 생기기 전에 이 결정을 뒤집어야 한다.
 */
function readPlayers(filePath: string): Record<string, PlayerState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    console.warn('세이브 파일을 읽지 못해 버린다')
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null) return {}

  const out: Record<string, PlayerState> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const result = PlayerStateSchema.safeParse(value)
    if (result.success) {
      out[id] = value as PlayerState
    } else {
      console.warn(`세이브의 플레이어 "${id}" 가 현재 형식과 맞지 않아 버린다`)
    }
  }
  return out
}
```

**`result.data` 가 아니라 원본 `value` 를 넣는 이유:** zod 의 `z.record(z.string(), ...)` 는 파싱 결과를 새 객체로 만들면서 `SkillId` 같은 좁은 키 타입을 잃는다. 스키마는 검문소로만 쓰고 값은 원본을 그대로 통과시킨다.

테스트를 `apps/server/src/state/store.test.ts` 에 추가한다.

```ts
  it('형식이 맞지 않는 세이브는 버리고 새 플레이어를 만든다', () => {
    // 이전 형식: 숙련도가 { level, xp } 객체였다
    writeFileSync(
      file,
      JSON.stringify({ local: { id: 'local', skills: { mining: { level: 3, xp: 10 } } } }),
      'utf8',
    )

    const store = new PlayerStore(file)
    const p = store.get('local')

    expect(typeof p.skills.mineral).toBe('number')
    expect(p.skills.mineral).toBe(0)
  })

  it('깨진 JSON 도 버린다', () => {
    writeFileSync(file, '{ 이건 JSON 이 아니다', 'utf8')
    expect(new PlayerStore(file).get('local').skills.mineral).toBe(0)
  })
```

`node:fs` import 에 `writeFileSync` 를 더한다.

- [ ] **Step 9: 통과를 확인하고 커밋한다**

```bash
pnpm test && pnpm typecheck
```

기대: 실패 0건, 타입 오류 없음

```bash
git add packages/shared packages/data apps/server
git commit -m "feat: 노드별 쿨다운을 플레이어당 행동 간격으로

원작에 노드 리스폰 개념이 없다. 속도를 정하는 것은 노드가 아니라 행동
간격이며, 플레이어는 한 노드 앞에 서서 반복해서 캔다. 노드는 이제 무엇이
얼마나 나오는가만 정한다.

M1 검증에서 '노드 6개가 쿨다운을 공유해 채집원이 하나다' 로 보고했던 증상도
함께 사라진다 - 노드별 쿨다운이라는 설계 자체가 원작과 어긋나 생긴 것이었다.

간격은 기술별이 아니라 플레이어당 하나다. 나누면 여러 기술을 번갈아 눌러
실질 속도를 배로 올릴 수 있다.

검사 순서를 못 박았다. 간격 검사가 난수보다 앞인 이유는 거부된 요청이 시드를
소비하면 연타로 판정을 흔들 수 있기 때문이고, 자격 검사보다 뒤인 이유는 캘 수
없는 노드를 두드린 것이 간격까지 잡아먹으면 안 되기 때문이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 클라이언트와 테스트 맵 정리

**Files:**
- Modify: `apps/client/src/store/gameStore.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`
- Modify: `apps/client/src/api/GameClient.ts`
- Modify: `apps/client/public/maps/world.tmx`, `world.json`

**Interfaces:**
- Consumes: Task 2~5 의 모든 변경
- Produces: 화면에서 쿨다운 표시가 사라지고, 테스트 맵의 노드가 새 id 를 가리킨다

- [ ] **Step 1: DTO 와 셀렉터를 맞춘다**

`apps/client/src/api/GameClient.ts` 의 `GatherOutcomeDto` 에서 `xpGained` 를 `skillGained` 로, `cooldownUntil` 줄을 삭제한다. `CraftOutcomeDto` 의 `xpGained` 도 `skillGained` 로 바꾼다.

`apps/client/src/store/gameStore.ts` 의 셀렉터 두 개에서 `skillLevel` 을 `proficiency` 로 바꾼다.

```ts
export function selectGatherChance(nodeId: string): number {
  const { player, data } = useGameStore.getState()
  const node = data.nodes[nodeId]
  if (!player || !node) return 0
  return calcGatherChance({
    proficiency: player.skills[node.skill],
    toolTier: equippedToolTier(player, data, node.skill),
    node,
  })
}

export function selectCraftChance(recipeId: string): number {
  const { player, data } = useGameStore.getState()
  const recipe = data.recipes[recipeId]
  if (!player || !recipe) return 0
  return calcCraftSuccess({
    proficiency: player.skills[recipe.skill],
    toolTier: equippedToolTier(player, data, recipe.skill),
    recipe,
  })
}
```

`describeError` 의 `switch` 에 한 줄을 더한다. **문구를 만들되 화면에는 띄우지 않는다** — 다음 단계에서 조용히 버린다.

```ts
    case 'too_fast':
      return '너무 빠릅니다'
```

`gather` 의 catch 에서 쿨다운 무시 조건을 바꾼다.

```ts
      // 간격 위반은 조용히 넘긴다. 연타가 정상 조작인 게임에서 매번 알리면
      // 누를수록 화면이 경고로 덮인다.
      if (err instanceof ApiError && err.code === 'too_fast') return
```

`craft` 의 catch 에도 같은 줄을 `isNetworkFailure` 검사 앞에 넣는다.

- [ ] **Step 2: 씬에서 쿨다운 표시를 없앤다**

`apps/client/src/game/scenes/WorldScene.ts` 에서 `refreshCooldowns` 메서드 전체와 `update()` 안의 호출 줄을 지운다.

`apps/client/src/game/NodeMarker.ts` 에서 `setCooldown` 메서드와 `defaultLabel` 필드를 지운다. `defaultLabel` 은 쿨다운이 끝났을 때 라벨을 되돌리려고 두었던 것이라 `setCooldown` 이 사라지면 읽는 곳이 없다. `caption` 은 생성 시 라벨을 그리는 데 계속 쓰므로 남긴다.

생성자에서 `this.defaultLabel = label` 줄도 함께 지운다.

- [ ] **Step 3: 테스트 맵의 노드 id 를 새 체계로 바꾼다**

기존 맵에는 `copper_vein` 6개, `iron_vein` 4개, `mithril_vein` 2개가 배치돼 있다. `mithril_vein` 은 더 이상 없고, 네 기술을 모두 시험하려면 종류를 섞어야 한다.

`world.tmx` 와 `world.json` 두 파일에서 `nodeId` 값을 아래 규칙으로 바꾼다. **두 파일을 반드시 같은 결과로 맞춘다** — `world.tmx` 가 정본이고 `world.json` 은 그 산출물이라 어긋나면 게임과 에디터가 다른 맵을 보게 된다.

| 기존 | 개수 | 바꿀 값 |
|---|---|---|
| `copper_vein` | 6개 | 앞 2개 `copper_vein`, 다음 2개 `ice_vein`, 나머지 2개 `young_tree` |
| `iron_vein` | 4개 | 앞 2개 `herb_patch`, 나머지 2개 `iron_vein` |
| `mithril_vein` | 2개 | `deep_ice_vein`, `old_tree` |

`nodeId` 값은 두 파일 모두에 평문으로 들어 있으므로 **등장 순서대로 n번째만 바꾸는** 스크립트로 처리한다. 전역 치환을 쓰면 개수 배분을 못 맞춘다.

```bash
node -e "
const fs=require('fs');
// 등장 순서대로 갈아끼울 값. 기존 12개 마커의 순서와 1:1로 대응한다.
const plan={
  copper_vein:['copper_vein','copper_vein','ice_vein','ice_vein','young_tree','young_tree'],
  iron_vein:['herb_patch','herb_patch','iron_vein','iron_vein'],
  mithril_vein:['deep_ice_vein','old_tree'],
};
for(const f of ['apps/client/public/maps/world.tmx','apps/client/public/maps/world.json']){
  let s=fs.readFileSync(f,'utf8');
  for(const [old,list] of Object.entries(plan)){
    let i=0;
    // 단어 경계로 묶어 copper_vein 이 다른 id 의 일부로 걸리지 않게 한다.
    s=s.replace(new RegExp('\\\\b'+old+'\\\\b','g'),()=> list[i++] ?? old);
  }
  fs.writeFileSync(f,s,'utf8');
  console.log('갱신:',f);
}
"
```

치환 순서에 주의한다 — 위 스크립트는 `copper_vein` 을 먼저 처리하는데, 그 결과로 생긴 `copper_vein` 두 개를 나중 규칙이 다시 건드리지 않는다(각 규칙이 자기 원본 이름만 찾는다). 다만 `iron_vein` 규칙이 만들어내는 `iron_vein` 은 이미 `iron_vein` 규칙을 실행 중이므로 안전하다.

바꾼 뒤 두 파일에서 각 id 의 개수가 같은지 확인한다.

```bash
for id in copper_vein ice_vein young_tree herb_patch iron_vein deep_ice_vein old_tree; do
  printf "%-16s tmx=%s json=%s\n" "$id" \
    "$(grep -o "$id" apps/client/public/maps/world.tmx | wc -l)" \
    "$(grep -o "$id" apps/client/public/maps/world.json | wc -l)"
done
```

기대: 모든 행에서 tmx 와 json 의 개수가 같고, 합계가 12

- [ ] **Step 4: 타입 검사와 빌드를 확인한다**

```bash
pnpm typecheck && pnpm --filter @nogada/client build
```

기대: 타입 오류 없음, 빌드 성공

- [ ] **Step 5: 수동 검증한다**

세이브를 비우고 서버와 클라이언트를 띄운다.

```bash
rm -rf apps/server/.data
```

```bash
pnpm dev:server
```

```bash
pnpm dev:client
```

**관찰해야 할 것:**

1. 시작 시 인벤토리에 **1등급 도구 4종**(구리 정·도끼·곡괭이·낫)이 있고 각각 착용돼 있다
2. 구리 광맥을 누르면 채집되고, **연타하면 초당 2회 정도까지만** 반응한다
3. 그보다 빨리 눌러도 **화면에 아무 경고가 뜨지 않는다**
4. 얼음 광맥·어린 나무·약초 군락도 각각 채집된다
5. **철 광맥을 누르면 `도구나 숙련도 부족`** 이 뜬다 (2등급 도구가 없음)
6. 노드 마커에 **남은 초가 표시되지 않는다** (쿨다운 표시 제거)
7. 콘솔 에러가 없다

숙련도가 실제로 속도를 바꾸는지 보려면 세이브를 직접 고쳐 확인한다.

```bash
node -e "
const f='apps/server/.data/players.json';
const fs=require('fs');
const d=JSON.parse(fs.readFileSync(f,'utf8'));
d.local.skills.mineral=999999;
fs.writeFileSync(f,JSON.stringify(d,null,2));
console.log('광물 숙련도를 999999 로 설정');
"
```

서버를 재시작하고 구리 광맥을 연타하면 **눈에 띄게 빨라져야 한다**(500ms → 50ms). 확인 후 세이브를 지운다.

- [ ] **Step 6: 커밋**

```bash
git add apps/client/src apps/client/public/maps
git commit -m "feat(client): 숙련도 재설계에 맞춰 정리

셀렉터가 새 공식을 호출하고, 노드 마커의 쿨다운 표시를 없앤다. 노드별
쿨다운이 사라졌으므로 표시할 남은 시간도 없다.

간격 위반(too_fast)은 쿨다운과 마찬가지로 조용히 넘긴다. 연타가 정상 조작인
게임에서 매번 알리면 누를수록 화면이 경고로 덮인다.

테스트 맵의 노드 12개를 새 id 로 바꿔 네 채집 기술을 모두 시험할 수 있게
했다. world.tmx 가 정본이고 world.json 은 산출물이라 두 파일을 같은 결과로
맞췄다 - 어긋나면 게임과 에디터가 다른 맵을 보게 된다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# 완료 후 — 확인할 것

- [ ] **다음 스펙은 조작이다.** WASD 이동, 노드 인접 판정, 상호작용 키 연타, 터치 제거. 이 계획이 정한 행동 간격을 소비한다. 지금은 기존 탭 조작이 그대로 동작하므로 급하지 않지만, 원작의 "노드에 붙어서 누른다" 감각은 그것을 만들어야 나온다.

- [ ] **명상·낚시·헌혈은 아직 없다.** 상호작용형과 행동 방식이 달라 별도 설계가 필요하다.

- [ ] **효율 배수의 공급원이 없다.** 식에는 자리가 있고 항상 1 이다. 장비·버프를 도입할 때 채운다.

- [ ] **숙련도 표시 UI 가 없다.** 8자릿수를 어떻게 읽기 좋게 보일지는 패널 작업에서 정한다.

- [ ] **세이브 마이그레이션 장치가 없다.** 형식이 맞지 않으면 버린다. M4(온라인 개방) 이전에 갖춰야 한다.
