# 모바일 조작과 상호작용 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 탭 이동·탭 채집을 버리고, 가로 화면 가상 컨트롤러로 4방향 타일 이동을 하며 앞칸을 바라보고 상호작용하는 조작으로 바꾼다.

**Architecture:** 이동·상호작용 규칙(앞칸 계산, 인접·바라봄 판정, 걸음 간격, 자동 반복 문턱)은 `packages/shared` 에 두어 나중에 서버가 같은 함수로 검증할 수 있게 한다. 키보드와 화면 버튼은 장치를 모르는 하나의 `InputState` 에 쓴다. 플레이어의 정본 위치는 타일 정수 좌표이고 픽셀 좌표는 그리기용 파생물이다. 노드는 종류 id 가 아니라 인스턴스 id 로 지목한다.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), pnpm 워크스페이스, Phaser 3, React 18, Vite, Fastify, zod, vitest, Capacitor(안드로이드).

**설계 문서:** [모바일 조작과 상호작용 설계](../specs/2026-08-08-mobile-controls-design.md)

## Global Constraints

- 게임 규칙은 `packages/shared` 에만 존재한다. 서버와 클라이언트가 동일 함수를 import 한다. 어느 쪽에도 중복 구현하지 않는다.
- 숙련도는 기술별 정수 하나다. 레벨도 경험치도 없다. 상한을 두지 않는다.
- **채집 노드의 접근 게이트는 도구 등급 하나뿐이다.** `NodeDef` 에 요구 숙련도 필드는 없다.
- **제작은 도구 게이트가 없다.** 조합 숙련도가 레시피를 연다.
- **행동 간격은 플레이어 하나당 하나다.** `PlayerState.nextActionAt` 이 그것이다.
- **이동은 4방향뿐이다. 대각선은 없다.**
- **상호작용 대상은 바라보는 앞칸 하나다.** 그 칸에 있는 것이 무엇이든 같은 입력으로 상호작용한다.
- 모든 판정과 난수는 서버가 수행한다. 시각도 서버가 정한다.
- 클라이언트 UI 는 자동 테스트하지 않는다. `packages/shared`·`packages/data`·`apps/server` 는 테스트 대상이다.
- **이 게임은 모바일 게임이고 가로로만 플레이한다.** 세로 레이아웃을 만들지 않는다.
- **원작의 리소스·데이터·수치는 전부 자체 제작한다.** 원작에서 추출한 것을 저장소에 넣지 않는다.
- Node.js 20 이상, pnpm. 루트 `pnpm test` 는 `pnpm data:build` 를 먼저 돌린다.
- import 는 소스가 `.ts` 여도 `.js` 확장자를 붙인다.
- 커밋 메시지는 한국어이고 본문에 *왜* 를 적는다. 트레일러: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **작업 트리에 `apps/client/src/ui/App.tsx` 의 커밋되지 않은 개발용 훅 한 줄이 있다.** 어떤 태스크도 그 파일을 건드리거나 커밋하지 않는다. `git add -A` 와 `git commit -a` 를 절대 쓰지 않는다.

---

## File Structure

**새로 만드는 파일**

| 경로 | 책임 |
|---|---|
| `packages/shared/src/movement.ts` | 방향·타일 좌표 타입, 앞칸 계산, 인접·바라봄 판정, 걸음 간격, 자동 반복 문턱 |
| `packages/shared/src/movement.test.ts` | 위의 테스트 |
| `packages/data/maps/world.tmx` | Tiled 원본. `apps/client/public/maps/` 에서 옮겨 온다 |
| `packages/data/maps/world.json` | Tiled 내보내기. 위와 같이 옮겨 온다 |
| `packages/data/src/placements.ts` | 맵 JSON 에서 노드 배치를 뽑고 검증한다 |
| `packages/data/src/placements.test.ts` | 위의 테스트 |
| `apps/client/src/input/InputState.ts` | 장치를 모르는 입력 상태와 그 소스 인터페이스 |
| `apps/client/src/input/KeyboardSource.ts` | WASD·방향키·행동키를 `InputState` 에 쓴다 |
| `apps/client/src/input/TouchSource.ts` | 화면 위 가상 컨트롤러를 그리고 `InputState` 에 쓴다 |
| `apps/client/src/game/TileMover.ts` | 타일 단위 걸음 상태 기계 |

**고치는 파일**

| 경로 | 무엇이 바뀌나 |
|---|---|
| `packages/shared/src/types.ts` | `NodePlacement`, `GameData.placements` 추가 |
| `packages/shared/src/index.ts` | `movement.js` 배럴 추가 |
| `packages/shared/src/protocol.ts` | `GatherRequestSchema` 가 `instanceId` 를 받는다 |
| `packages/data/src/build.ts` | 배치를 읽어 `gamedata.json` 에 넣는다 |
| `packages/data/src/validate.ts` | 배치 검증 규칙 |
| `apps/server/src/services/gatherService.ts` | `instanceId` → 배치 → `nodeId` 해석 |
| `apps/server/src/routes/gather.ts` | 요청 필드 변경 |
| `apps/client/src/api/GameClient.ts` | 요청 필드 변경 |
| `apps/client/src/store/gameStore.ts` | `gather(instanceId)`, 자동 반복 스케줄링, 해금 알림 |
| `apps/client/src/game/scenes/WorldScene.ts` | 타일 이동, 앞칸 상호작용, 탭 제거, 맵 로드 경로 |
| `apps/client/src/game/NodeMarker.ts` | 탭 핸들러 제거 |
| `apps/client/src/game/FloatingText.ts` | 반복 중 누적 |

---

## Task 1: 공유 이동·상호작용 규칙

**Files:**
- Create: `packages/shared/src/movement.ts`
- Create: `packages/shared/src/movement.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `packages/shared/src/formulas/proficiency.js` 의 `actionIntervalMs`
- Produces:
  - `type Direction = 'up' | 'down' | 'left' | 'right'`
  - `interface TilePos { x: number; y: number }`
  - `const DIRECTIONS: readonly Direction[]`
  - `const STEP_MS: number`
  - `const REPEAT_UNLOCK_PROFICIENCY: number`
  - `function stepDelta(dir: Direction): TilePos`
  - `function frontTile(pos: TilePos, facing: Direction): TilePos`
  - `function isAdjacentFacing(from: TilePos, facing: Direction, target: TilePos): boolean`
  - `function canRepeat(proficiency: number): boolean`
  - `function samePos(a: TilePos, b: TilePos): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/movement.test.ts` 를 만든다.

```ts
import { describe, expect, it } from 'vitest'
import { actionIntervalMs } from './formulas/proficiency.js'
import {
  DIRECTIONS,
  REPEAT_UNLOCK_PROFICIENCY,
  STEP_MS,
  canRepeat,
  frontTile,
  isAdjacentFacing,
  samePos,
  stepDelta,
  type Direction,
} from './movement.js'

describe('stepDelta', () => {
  it('네 방향이 서로 다른 한 칸을 가리킨다', () => {
    expect(stepDelta('up')).toEqual({ x: 0, y: -1 })
    expect(stepDelta('down')).toEqual({ x: 0, y: 1 })
    expect(stepDelta('left')).toEqual({ x: -1, y: 0 })
    expect(stepDelta('right')).toEqual({ x: 1, y: 0 })
  })

  it('어떤 방향도 대각선으로 움직이지 않는다', () => {
    // 대각선이 들어오면 앞칸이 하나로 정해지지 않아 상호작용 판정이 무너진다.
    for (const dir of DIRECTIONS) {
      const d = stepDelta(dir)
      expect(Math.abs(d.x) + Math.abs(d.y)).toBe(1)
    }
  })

  it('DIRECTIONS 는 정확히 네 방향이다', () => {
    expect([...DIRECTIONS].sort()).toEqual(['down', 'left', 'right', 'up'])
  })
})

describe('frontTile', () => {
  it('바라보는 방향의 이웃 칸을 준다', () => {
    expect(frontTile({ x: 5, y: 5 }, 'up')).toEqual({ x: 5, y: 4 })
    expect(frontTile({ x: 5, y: 5 }, 'right')).toEqual({ x: 6, y: 5 })
  })

  it('원래 위치를 변형하지 않는다', () => {
    const pos = { x: 5, y: 5 }
    frontTile(pos, 'down')
    expect(pos).toEqual({ x: 5, y: 5 })
  })
})

describe('isAdjacentFacing', () => {
  it('앞칸이면 참이다', () => {
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 2, y: 7 })).toBe(true)
  })

  it('옆에 있어도 다른 곳을 보고 있으면 거짓이다', () => {
    // 원작이 이렇다. 인접만으로는 상호작용이 되지 않는다.
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'up', { x: 2, y: 7 })).toBe(false)
  })

  it('바라보는 방향이라도 두 칸 떨어져 있으면 거짓이다', () => {
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 1, y: 7 })).toBe(false)
  })

  it('같은 칸은 거짓이다', () => {
    // 노드는 단단해서 그 칸에 설 수 없다. 같은 칸이 참이 되면 그 전제가 깨진다.
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 3, y: 7 })).toBe(false)
  })

  it('대각선으로 인접한 칸은 거짓이다', () => {
    expect(isAdjacentFacing({ x: 3, y: 7 }, 'left', { x: 2, y: 6 })).toBe(false)
  })
})

describe('canRepeat', () => {
  it('문턱 미만에서는 반복할 수 없다', () => {
    expect(canRepeat(0)).toBe(false)
    expect(canRepeat(REPEAT_UNLOCK_PROFICIENCY - 1)).toBe(false)
  })

  it('문턱에 닿으면 반복할 수 있다', () => {
    expect(canRepeat(REPEAT_UNLOCK_PROFICIENCY)).toBe(true)
    expect(canRepeat(REPEAT_UNLOCK_PROFICIENCY * 100)).toBe(true)
  })

  it('문턱은 손가락이 병목이 되는 지점이다 — 초당 5회', () => {
    // 이 단정문이 문턱의 의미를 못 박는다. 값만 바꾸고 이 관계를 깨면 여기서 걸린다.
    // 초당 5회를 넘어가면 연타로 따라갈 수 없으므로 그때 해금이 온다.
    expect(actionIntervalMs(REPEAT_UNLOCK_PROFICIENCY)).toBe(200)
  })
})

describe('samePos', () => {
  it('좌표가 같으면 참이다', () => {
    expect(samePos({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true)
    expect(samePos({ x: 1, y: 2 }, { x: 2, y: 1 })).toBe(false)
  })
})

describe('STEP_MS', () => {
  it('원작 추정값 200ms 다', () => {
    expect(STEP_MS).toBe(200)
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

```bash
pnpm vitest run packages/shared/src/movement.test.ts
```

기대: `Failed to resolve import "./movement.js"` 로 실패한다.

- [ ] **Step 3: 모듈을 만든다**

`packages/shared/src/movement.ts`:

```ts
import { actionIntervalMs } from './formulas/proficiency.js'

/**
 * 이동과 바라봄의 방향. 네 개뿐이다.
 *
 * 대각선을 넣지 않는 것은 편의를 포기한 결정이다. 앞칸이 하나로 정해져야
 * 상호작용 대상이 모호해지지 않고, 그 명확함이 이 게임에서는 대각선 이동의
 * 편의보다 중요하다. 원작도 `Input.dir4` 만 쓴다.
 */
export type Direction = 'up' | 'down' | 'left' | 'right'

export const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right']

/**
 * 타일 좌표. 이것이 플레이어 위치의 정본이다.
 *
 * 픽셀 좌표는 이 값을 그리기 위한 파생물이다. 순서가 뒤집히면 위치를 서버에
 * 보낼 때 반올림 문제가 생긴다.
 */
export interface TilePos {
  x: number
  y: number
}

/** 한 걸음에 걸리는 시간. 원작의 이동 속도에서 추정한 값이라 조정 가능하다. */
export const STEP_MS = 200

/**
 * 이 숙련도를 넘으면 그 기술의 자동 반복이 열린다.
 *
 * 이 값에서 행동 간격이 200ms — 초당 5회다. 연타로 지속하기 어려운 경계이므로,
 * 해금이 정확히 손가락이 병목이 되는 순간에 온다. 그 전까지는 연타가 실제로
 * 가능하니 잠겨 있어도 손해가 없고, 그 뒤로는 잠겨 있으면 손해라서 열린다.
 */
export const REPEAT_UNLOCK_PROFICIENCY = 10_000

const DELTAS: Record<Direction, TilePos> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** 그 방향으로 한 걸음 갔을 때의 좌표 변화. 반환값은 매번 새 객체다. */
export function stepDelta(dir: Direction): TilePos {
  const d = DELTAS[dir]
  return { x: d.x, y: d.y }
}

/** 그 자리에서 그 방향을 볼 때의 앞칸. */
export function frontTile(pos: TilePos, facing: Direction): TilePos {
  const d = DELTAS[facing]
  return { x: pos.x + d.x, y: pos.y + d.y }
}

export function samePos(a: TilePos, b: TilePos): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * 그 대상이 지금 상호작용할 수 있는 자리에 있는가.
 *
 * 인접한 것만으로는 부족하고 바라보고 있어야 한다 — 원작의 결정 버튼 트리거가
 * 그렇다. 서버가 위치를 알게 되면 이 함수가 그대로 서버 검증이 된다.
 */
export function isAdjacentFacing(from: TilePos, facing: Direction, target: TilePos): boolean {
  return samePos(frontTile(from, facing), target)
}

/** 그 숙련도에서 누르고 있는 것만으로 반복되는가. */
export function canRepeat(proficiency: number): boolean {
  return proficiency >= REPEAT_UNLOCK_PROFICIENCY
}

// 문턱이 실제로 200ms 지점인지는 movement.test.ts 가 actionIntervalMs 로 확인한다.
// 여기서 import 를 유지하는 이유는 그 관계가 코드에 드러나 있어야 하기 때문이다.
void actionIntervalMs
```

- [ ] **Step 4: 배럴에 추가한다**

`packages/shared/src/index.ts` 의 `export * from './time.js'` 바로 다음 줄에 추가한다.

```ts
export * from './movement.js'
```

- [ ] **Step 5: 테스트가 통과하는 것을 확인한다**

```bash
pnpm vitest run packages/shared/src/movement.test.ts
```

기대: 13개 통과.

```bash
pnpm typecheck
```

기대: 오류 없음.

- [ ] **Step 6: 커밋**

```bash
git add packages/shared/src/movement.ts packages/shared/src/movement.test.ts packages/shared/src/index.ts
```

커밋 메시지:

```
feat(shared): 이동과 상호작용의 규칙 모듈

앞칸 계산과 인접·바라봄 판정을 shared 에 둔다. 지금은 클라이언트만 쓰지만
이것들은 명백히 게임 규칙이고, 서버가 플레이어 위치를 알게 되는 순간
서버가 검증해야 할 바로 그 판정이다. 클라이언트에만 두면 그때 같은 것을
다시 구현하게 되는데, 그것이 이 프로젝트가 금지하는 일이다.

자동 반복 문턱도 여기 둔다. 값이 10,000 인 이유는 그 지점의 행동 간격이
200ms — 초당 5회이기 때문이다. 연타로 지속할 수 없게 되는 경계이므로
해금이 정확히 손가락이 병목이 되는 순간에 온다. 테스트가 그 관계를
actionIntervalMs 로 못 박아서, 문턱만 바꾸고 의미를 잃으면 실패한다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 2: 노드 배치를 데이터로

지금 맵은 클라이언트의 `public/` 에 있고 노드 오브젝트는 `nodeId` 만 갖는다. 같은 `nodeId` 가 여러 칸에 있으므로 어느 칸인지 알 방법이 없다. 서버는 맵을 아예 모른다.

맵을 `packages/data` 로 옮기고, 각 노드에 고유한 `instanceId` 를 주고, 빌드 때 배치 목록을 뽑아 게임 데이터에 넣는다.

**Files:**
- Create: `packages/data/maps/world.tmx` (이동)
- Create: `packages/data/maps/world.json` (이동)
- Create: `packages/data/src/placements.ts`
- Create: `packages/data/src/placements.test.ts`
- Delete: `apps/client/public/maps/world.tmx`
- Delete: `apps/client/public/maps/world.json`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/data/src/build.ts`
- Modify: `packages/data/src/validate.ts`
- Modify: `packages/data/src/index.ts`
- Modify: `packages/data/package.json`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 1 의 `TilePos`
- Produces:
  - `interface NodePlacement { instanceId: string; nodeId: string; x: number; y: number }` (`x`·`y` 는 타일 좌표)
  - `GameData.placements: Record<string, NodePlacement>` (키는 `instanceId`)
  - `function parsePlacements(mapJson: unknown, nodes: Record<string, NodeDef>): Record<string, NodePlacement>`

- [ ] **Step 1: 맵 파일을 옮긴다**

```bash
mkdir -p packages/data/maps
git mv apps/client/public/maps/world.tmx packages/data/maps/world.tmx
git mv apps/client/public/maps/world.json packages/data/maps/world.json
```

`apps/client/public/maps/` 가 비면 지운다. `apps/client/public/tilesets/` 와 `apps/client/public/sprites/` 는 그대로 둔다 — 이미지는 Phaser 가 URL 로 읽으므로 계속 클라이언트가 서빙한다.

- [ ] **Step 2: 맵의 노드 오브젝트에 `instanceId` 를 부여한다**

`packages/data/maps/world.json` 의 `nodes` 오브젝트 레이어에는 13개의 점 오브젝트가 있고 각각 `properties` 에 `nodeId` 하나만 갖는다. 각 오브젝트의 `properties` 배열에 아래 형태로 한 항목을 더한다.

```json
{ "name": "instanceId", "type": "string", "value": "<고유 문자열>" }
```

`instanceId` 는 `<nodeId>-<일련번호>` 로 짓는다 — 같은 종류가 여러 개면 1부터 센다. 예: `copper_vein-1`, `copper_vein-2`, `ice_vein-1`, `deep_ice_vein-1`.

`packages/data/maps/world.tmx` 의 대응하는 `<object>` 에도 같은 property 를 넣는다. 두 파일이 정확히 일치해야 한다 — `.tmx` 는 Tiled 편집 원본이고 `.json` 은 내보내기라서, 어긋나면 다음에 Tiled 로 열어 내보낼 때 조용히 되돌아간다.

편집 후 두 파일의 `instanceId` 값 집합이 같은지 세어서 확인하고, 그 개수를 보고서에 적는다.

- [ ] **Step 3: 타입을 더한다**

`packages/shared/src/types.ts` 의 `GameData` 인터페이스 바로 위에 추가한다.

```ts
/**
 * 맵 위에 놓인 노드 하나. `nodeId` 는 종류이고 `instanceId` 가 그 칸이다.
 *
 * 같은 종류가 여러 칸에 있으므로 종류만으로는 어느 것인지 알 수 없다.
 * 서버가 앞칸 판정을 검증하려면, 그리고 나중에 고갈을 넣으려면 칸을 지목해야 한다.
 *
 * `x`·`y` 는 픽셀이 아니라 **타일 좌표**다.
 */
export interface NodePlacement {
  instanceId: string
  nodeId: string
  x: number
  y: number
}
```

`GameData` 인터페이스에 필드를 더한다.

```ts
  placements: Record<string, NodePlacement>
```

- [ ] **Step 4: 실패하는 테스트를 쓴다**

`packages/data/src/placements.test.ts`:

```ts
import type { NodeDef } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { parsePlacements } from './placements.js'

const nodes: Record<string, NodeDef> = {
  copper_vein: {
    id: 'copper_vein', name: '구리 광맥', skill: 'mineral', tier: 1,
    baseChance: 0.5, yieldItem: 'copper_ore', yieldMin: 1, yieldMax: 3,
    skillGainMin: 1, skillGainMax: 2,
  },
}

/** 타일 32px 기준으로 타일 좌표 (tx,ty) 의 중심 픽셀 좌표를 만든다. */
function mapWith(objects: unknown[]): unknown {
  return { tilewidth: 32, tileheight: 32, layers: [{ name: 'nodes', type: 'objectgroup', objects }] }
}

function obj(instanceId: string, nodeId: string, tx: number, ty: number): unknown {
  return {
    x: tx * 32 + 16,
    y: ty * 32 + 16,
    properties: [
      { name: 'nodeId', value: nodeId },
      { name: 'instanceId', value: instanceId },
    ],
  }
}

describe('parsePlacements', () => {
  it('픽셀 좌표를 타일 좌표로 바꾼다', () => {
    const r = parsePlacements(mapWith([obj('copper_vein-1', 'copper_vein', 13, 15)]), nodes)
    expect(r['copper_vein-1']).toEqual({
      instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 13, y: 15,
    })
  })

  it('노드 오브젝트가 없는 맵도 정상이다', () => {
    expect(parsePlacements(mapWith([]), nodes)).toEqual({})
  })

  it('nodes 레이어가 아예 없어도 정상이다', () => {
    expect(parsePlacements({ tilewidth: 32, tileheight: 32, layers: [] }, nodes)).toEqual({})
  })

  it('instanceId 가 겹치면 던진다', () => {
    // 겹치면 뒤엣것이 앞엣것을 덮어써서 노드 하나가 조용히 사라진다.
    const m = mapWith([
      obj('dup', 'copper_vein', 1, 1),
      obj('dup', 'copper_vein', 2, 2),
    ])
    expect(() => parsePlacements(m, nodes)).toThrow(/instanceId/)
  })

  it('instanceId 가 없으면 던진다', () => {
    const m = mapWith([{ x: 48, y: 48, properties: [{ name: 'nodeId', value: 'copper_vein' }] }])
    expect(() => parsePlacements(m, nodes)).toThrow(/instanceId/)
  })

  it('없는 nodeId 를 가리키면 던진다', () => {
    const m = mapWith([obj('ghost-1', 'ghost_vein', 1, 1)])
    expect(() => parsePlacements(m, nodes)).toThrow(/ghost_vein/)
  })

  it('두 노드가 같은 칸에 있으면 던진다', () => {
    // 한 칸에 둘이 있으면 앞칸 판정이 어느 쪽을 고를지 정해지지 않는다.
    const m = mapWith([
      obj('a', 'copper_vein', 4, 4),
      obj('b', 'copper_vein', 4, 4),
    ])
    expect(() => parsePlacements(m, nodes)).toThrow(/같은 칸/)
  })
})
```

- [ ] **Step 5: 테스트가 실패하는 것을 확인한다**

```bash
pnpm vitest run packages/data/src/placements.test.ts
```

기대: `Failed to resolve import "./placements.js"`.

- [ ] **Step 6: 파서를 만든다**

`packages/data/src/placements.ts`:

```ts
import type { NodeDef, NodePlacement } from '@nogada/shared'

interface TiledProperty {
  name: string
  value: unknown
}

interface TiledObject {
  x?: number
  y?: number
  properties?: TiledProperty[]
}

interface TiledLayer {
  name?: string
  type?: string
  objects?: TiledObject[]
}

interface TiledMap {
  tilewidth?: number
  tileheight?: number
  layers?: TiledLayer[]
}

function propOf(obj: TiledObject, name: string): string | undefined {
  const found = obj.properties?.find((p) => p.name === name)
  return typeof found?.value === 'string' ? found.value : undefined
}

/**
 * Tiled 맵의 `nodes` 오브젝트 레이어에서 노드 배치를 뽑는다.
 *
 * 오브젝트는 타일 중심의 픽셀 좌표를 갖는다. 나누기로 타일 좌표를 얻는데,
 * 반올림이 아니라 내림을 쓴다 — 중심이 정확히 타일 안에 있으므로 내림이
 * 항상 그 타일을 준다.
 */
export function parsePlacements(
  mapJson: unknown,
  nodes: Record<string, NodeDef>,
): Record<string, NodePlacement> {
  const map = mapJson as TiledMap
  const tileWidth = map.tilewidth ?? 0
  const tileHeight = map.tileheight ?? 0
  if (tileWidth <= 0 || tileHeight <= 0) {
    throw new Error('맵에 타일 크기가 없다')
  }

  const layer = map.layers?.find((l) => l.name === 'nodes' && l.type === 'objectgroup')
  const objects = layer?.objects ?? []

  const placements: Record<string, NodePlacement> = {}
  const occupied = new Map<string, string>()

  for (const obj of objects) {
    const nodeId = propOf(obj, 'nodeId')
    if (!nodeId) continue

    const instanceId = propOf(obj, 'instanceId')
    if (!instanceId) {
      throw new Error(`노드 ${nodeId} 에 instanceId 가 없다`)
    }
    if (placements[instanceId]) {
      throw new Error(`instanceId 가 겹친다: ${instanceId}`)
    }
    if (!nodes[nodeId]) {
      throw new Error(`${instanceId} 이 없는 노드를 가리킨다: ${nodeId}`)
    }

    const x = Math.floor((obj.x ?? 0) / tileWidth)
    const y = Math.floor((obj.y ?? 0) / tileHeight)

    const key = `${x},${y}`
    const other = occupied.get(key)
    if (other) {
      throw new Error(`${other} 와 ${instanceId} 이 같은 칸에 있다: (${x}, ${y})`)
    }
    occupied.set(key, instanceId)

    placements[instanceId] = { instanceId, nodeId, x, y }
  }

  return placements
}
```

- [ ] **Step 7: 빌드가 배치를 넣게 한다**

`packages/data/src/build.ts` 를 읽고, 파싱한 `nodes` 를 얻은 뒤 배치를 읽어 출력 객체에 넣는다. 맵은 `packages/data/maps/world.json` 을 `node:fs` 로 읽는다 (`import.meta.url` 기준 상대 경로). 출력 개수 보고 줄에 배치 개수도 더한다 — 기존 형식이 `아이템 18, 노드 8, 레시피 6` 이므로 `, 배치 13` 을 이어 붙인다.

`packages/data/src/index.ts` 에 `export * from './placements.js'` 를 더한다.

- [ ] **Step 8: 검증 규칙을 더한다**

`packages/data/src/validate.ts` 에 규칙을 추가한다. 파일의 기존 위반 메시지 형식을 먼저 읽고 그 어조에 맞춘다.

- 모든 노드 종류가 맵에 최소 한 번은 놓여 있어야 한다. 놓이지 않은 노드는 데이터에만 있고 게임에는 없다.

`packages/data/src/validate.test.ts` 에 그 규칙의 테스트를 더한다 — 배치에 없는 노드가 있으면 위반이 나오고, 실제 출하 데이터는 위반이 없다는 두 가지.

- [ ] **Step 9: 클라이언트가 데이터 패키지에서 맵을 읽게 한다**

`apps/client/src/game/scenes/WorldScene.ts` 의 `preload()` 에서 `this.load.tilemapTiledJSON('world', 'maps/world.json')` 줄을 지운다. 맵은 이제 HTTP 로 받지 않고 데이터 패키지에서 직접 온다.

파일 맨 위에 추가한다.

```ts
import worldMap from '@nogada/data/maps/world.json' with { type: 'json' }
```

`create()` 의 맨 앞, `this.make.tilemap` 호출 전에 캐시에 넣는다.

```ts
// 맵은 packages/data 가 소유한다. 서버가 노드 배치를 알아야 하기 때문이다.
// HTTP 로 받지 않고 번들에 들어오므로 Capacitor 에서 파일 경로 문제도 없다.
this.cache.tilemap.add('world', {
  format: Phaser.Tilemaps.Formats.TILED_JSON,
  data: worldMap,
})
```

`packages/data/package.json` 의 `exports` 에 맵 경로를 연다.

```json
    "./maps/world.json": "./maps/world.json"
```

기존 `exports` 필드의 형태를 먼저 읽고 그 형태에 맞춰 넣는다. `files` 필드가 있으면 `maps` 를 더한다.

- [ ] **Step 10: 전부 통과하는 것을 확인한다**

```bash
pnpm data:build
```

기대: `아이템 18, 노드 8, 레시피 6, 배치 13` (배치 수는 Step 2 에서 센 값과 같아야 한다). 위반 0건.

```bash
pnpm test
pnpm typecheck
pnpm --filter @nogada/client build
```

셋 다 통과해야 한다. 클라이언트 빌드가 중요하다 — 맵 import 경로가 틀리면 여기서만 드러난다.

- [ ] **Step 11: 커밋**

옮긴 파일과 고친 파일만 스테이징한다.

```
feat(data): 맵을 데이터 패키지로 옮기고 노드에 인스턴스 정체성을 준다

지금까지 같은 nodeId 가 여러 칸에 있는데 채집 요청은 종류 id 하나만 보냈다.
서버가 받는 것은 "어느 노드"가 아니라 "어느 종류"였다. 앞칸 판정을 서버가
검증하려면, 그리고 나중에 고갈을 넣으려면 어느 칸인지 알아야 한다.

맵을 클라이언트의 public 에서 packages/data 로 옮긴 이유는 서버도 배치를
알아야 하기 때문이다. 클라이언트는 이제 HTTP 대신 번들에서 맵을 읽는데,
Capacitor 에서 파일 경로 문제가 사라지는 부수 효과도 있다.

같은 칸에 두 노드가 놓이면 앞칸 판정이 어느 쪽을 고를지 정해지지 않으므로
파서가 거부한다. 맵에 놓이지 않은 노드 종류도 검증에서 걸린다 — 데이터에만
있고 게임에는 없는 노드다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 3: 채집 요청이 인스턴스를 지목한다

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/server/src/services/gatherService.ts`
- Modify: `apps/server/src/services/gatherService.test.ts`
- Modify: `apps/server/src/routes/gather.ts`
- Modify: `apps/server/src/app.test.ts`
- Modify: `apps/client/src/api/GameClient.ts`
- Modify: `apps/client/src/store/gameStore.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 2 의 `GameData.placements`, `NodePlacement`
- Produces:
  - `GatherRequestSchema` 가 `{ instanceId: string }` 을 받는다
  - `PerformGatherArgs` 가 `nodeId` 대신 `instanceId` 를 받는다
  - `GatherErrorCode` 에 `'unknown_node'` 가 남되 의미가 "그런 인스턴스가 없다" 로 바뀐다
  - `gameStore.gather(instanceId: string)`

- [ ] **Step 1: 프로토콜을 바꾼다**

`packages/shared/src/protocol.ts`:

```ts
export const GatherRequestSchema = z.object({ instanceId: z.string().min(1) })
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/server/src/services/gatherService.test.ts` 의 `data` 픽스처에 `placements` 를 더하고, 기존 호출의 `nodeId:` 를 `instanceId:` 로 바꾼다. 픽스처 예시:

```ts
  placements: {
    'copper_vein-1': { instanceId: 'copper_vein-1', nodeId: 'copper_vein', x: 3, y: 3 },
    'iron_vein-1': { instanceId: 'iron_vein-1', nodeId: 'iron_vein', x: 5, y: 3 },
    'mithril_vein-1': { instanceId: 'mithril_vein-1', nodeId: 'mithril_vein', x: 7, y: 3 },
  },
```

기존 테스트에서 `nodeId: 'copper_vein'` 은 `instanceId: 'copper_vein-1'` 이 된다. `nodeId: 'ghost'` 는 `instanceId: 'ghost-1'` 이 된다.

그리고 인스턴스 해석을 못 박는 테스트를 새로 더한다.

```ts
  it('같은 종류의 다른 인스턴스를 각각 지목할 수 있다', () => {
    // 종류 id 만 보내던 때에는 불가능했던 일이다. 이 테스트가 인스턴스 해석이
    // 실제로 일어나는지 지킨다 — 종류로 되돌리면 두 인스턴스가 구분되지 않는다.
    const d: GameData = {
      ...data,
      placements: {
        ...data.placements,
        'copper_vein-2': { instanceId: 'copper_vein-2', nodeId: 'copper_vein', x: 9, y: 3 },
      },
    }
    const a = performGather({ player: player(), data: d, instanceId: 'copper_vein-1', rng: alwaysSucceed, now: 0 })
    const b = performGather({ player: player(), data: d, instanceId: 'copper_vein-2', rng: alwaysSucceed, now: 0 })
    if (!a.ok || !b.ok) throw new Error('둘 다 성공해야 한다')
    expect(a.outcome.gained).toEqual(b.outcome.gained)
  })

  it('없는 인스턴스는 unknown_node 로 거부한다', () => {
    const r = performGather({ player: player(), data, instanceId: 'nope-9', rng: alwaysSucceed, now: 0 })
    expect(r).toEqual({ ok: false, code: 'unknown_node' })
  })
```

- [ ] **Step 3: 테스트가 실패하는 것을 확인한다**

```bash
pnpm vitest run apps/server/src/services/gatherService.test.ts
```

기대: 타입 오류 또는 `instanceId` 를 모르는 채로 `unknown_node` 가 나오며 실패한다.

- [ ] **Step 4: 서비스를 고친다**

`apps/server/src/services/gatherService.ts` 에서 `PerformGatherArgs` 의 `nodeId: string` 을 `instanceId: string` 으로 바꾸고, 노드를 찾는 첫 줄을 배치를 거치게 한다.

```ts
  const placement = data.placements[instanceId]
  if (!placement) return { ok: false, code: 'unknown_node' }
  const node = data.nodes[placement.nodeId]
  // 배치가 없는 노드를 가리키는 것은 데이터 검증이 막으므로 여기 오면 데이터가 깨진 것이다.
  if (!node) return { ok: false, code: 'unknown_node' }
```

나머지 로직은 그대로다. 검사 순서(대상 존재 → 접근 자격 → 간격 → 난수)를 바꾸지 않는다.

- [ ] **Step 5: 라우트와 클라이언트를 맞춘다**

`apps/server/src/routes/gather.ts` 가 `instanceId` 를 서비스에 넘긴다.

`apps/client/src/api/GameClient.ts` 의 `gather` 가 `instanceId` 를 보낸다.

```ts
  gather: (instanceId: string) =>
    request<GatherOutcomeDto>('/api/gather', {
      method: 'POST',
      body: JSON.stringify({ instanceId }),
    }),
```

`apps/client/src/store/gameStore.ts` 의 `gather` 시그니처를 `(instanceId: string)` 으로 바꾼다.

`apps/client/src/game/scenes/WorldScene.ts` 의 `spawnNodes` 는 이제 맵 오브젝트가 아니라 `data.placements` 를 돌면서 마커를 만든다. 픽셀 좌표는 타일 좌표에서 계산한다 — `x * TILE + TILE / 2`. `NodeMarker` 의 `onTap` 에는 `instanceId` 를 넘긴다.

`apps/server/src/app.test.ts` 의 채집 요청 페이로드를 `{ instanceId: '<맵의 실제 instanceId>' }` 로 바꾼다. 실제 값은 Step 2 에서 맵에 넣은 것이어야 한다 — `copper_vein` 의 첫 인스턴스와 `iron_vein` 의 첫 인스턴스를 쓴다.

- [ ] **Step 6: 전부 통과하는 것을 확인한다**

```bash
pnpm test
pnpm typecheck
```

- [ ] **Step 7: 커밋**

```
feat: 채집 요청이 노드 종류가 아니라 인스턴스를 지목한다

맵에 copper_vein 이 두 칸 있는데 요청은 "copper_vein" 하나만 보냈다.
서버는 플레이어가 어느 칸 앞에 서 있는지 알 방법이 없었고, 그래서
앞칸 판정을 서버가 검증하는 것도 불가능했다.

이번에는 검증까지 하지 않는다 — 서버가 아직 플레이어 위치를 모른다.
그래도 지금 바꾸는 이유는, 위치 동기화가 들어올 때 프로토콜을 다시
바꾸는 것보다 지금 한 번에 정리하는 편이 싸기 때문이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 4: 입력 추상화와 키보드 소스

키보드와 화면 버튼이 같은 하나의 상태에 쓰게 만든다. 이 태스크는 키보드만 붙인다 — 터치는 Task 9 다.

**Files:**
- Create: `apps/client/src/input/InputState.ts`
- Create: `apps/client/src/input/KeyboardSource.ts`

**Interfaces:**
- Consumes: Task 1 의 `Direction`
- Produces:
  - `interface InputState { dir: Direction | null; action: boolean; actionPressed: boolean; cancel: boolean; cancelPressed: boolean; toggleBagPressed: boolean; toggleCraftPressed: boolean }`
  - `class InputHub` — `state: Readonly<InputState>`, `beginFrame(): void`, `setDir(dir)`, `setButton(button, down)`, `releaseAll(): void`
  - `type InputButton = 'action' | 'cancel' | 'bag' | 'craft'`
  - `class KeyboardSource { constructor(scene: Phaser.Scene, hub: InputHub); update(): void; destroy(): void }`

- [ ] **Step 1: 입력 상태를 만든다**

`apps/client/src/input/InputState.ts`:

```ts
import type { Direction } from '@nogada/shared'

/**
 * 장치를 모르는 입력 상태.
 *
 * 게임 로직은 키보드인지 터치인지 게임패드인지 묻지 않는다. 그래서 나중에
 * 게임패드를 붙일 때 이 파일 아래쪽만 늘어나고 게임 쪽은 그대로다.
 *
 * `*Pressed` 는 "이번 프레임에 새로 눌렸는가" 다. 누르고 있는 상태(`action`)와
 * 구분하는 이유는, 기본 채집이 누를 때마다 한 번이고 자동 반복만 누르고 있는
 * 것을 보기 때문이다.
 */
export interface InputState {
  dir: Direction | null
  action: boolean
  actionPressed: boolean
  cancel: boolean
  cancelPressed: boolean
  toggleBagPressed: boolean
  toggleCraftPressed: boolean
}

export type InputButton = 'action' | 'cancel' | 'bag' | 'craft'

/**
 * 여러 소스의 입력을 하나로 모은다.
 *
 * 두 소스가 동시에 말하면 마지막으로 바뀐 쪽이 이긴다. 병합 규칙을 복잡하게
 * 만들지 않는 이유는 실기에 키보드가 없고 PC 에 터치가 없어서, 두 소스가
 * 진짜로 경쟁하는 상황이 개발 중 실수 말고는 없기 때문이다.
 */
export class InputHub {
  private readonly current: InputState = {
    dir: null,
    action: false,
    actionPressed: false,
    cancel: false,
    cancelPressed: false,
    toggleBagPressed: false,
    toggleCraftPressed: false,
  }

  private readonly held: Record<InputButton, boolean> = {
    action: false,
    cancel: false,
    bag: false,
    craft: false,
  }

  get state(): Readonly<InputState> {
    return this.current
  }

  /**
   * 프레임 시작. 한 프레임짜리 신호를 지운다.
   *
   * 게임의 update() 맨 앞에서 부른다. 여기서 지우지 않으면 한 번 누른 것이
   * 여러 프레임 동안 참으로 읽혀 한 번의 누름이 여러 번의 행동이 된다.
   */
  beginFrame(): void {
    this.current.actionPressed = false
    this.current.cancelPressed = false
    this.current.toggleBagPressed = false
    this.current.toggleCraftPressed = false
  }

  setDir(dir: Direction | null): void {
    this.current.dir = dir
  }

  setButton(button: InputButton, down: boolean): void {
    const was = this.held[button]
    this.held[button] = down
    const justPressed = down && !was

    switch (button) {
      case 'action':
        this.current.action = down
        if (justPressed) this.current.actionPressed = true
        break
      case 'cancel':
        this.current.cancel = down
        if (justPressed) this.current.cancelPressed = true
        break
      case 'bag':
        if (justPressed) this.current.toggleBagPressed = true
        break
      case 'craft':
        if (justPressed) this.current.toggleCraftPressed = true
        break
    }
  }

  /** 모든 입력을 놓은 상태로 되돌린다. 패널이 열릴 때처럼 입력을 끊어야 할 때 쓴다. */
  releaseAll(): void {
    this.setDir(null)
    for (const button of ['action', 'cancel', 'bag', 'craft'] as InputButton[]) {
      this.setButton(button, false)
    }
    this.beginFrame()
  }
}
```

- [ ] **Step 2: 키보드 소스를 만든다**

`apps/client/src/input/KeyboardSource.ts`:

```ts
import type Phaser from 'phaser'
import type { Direction } from '@nogada/shared'
import type { InputHub } from './InputState.js'

/**
 * PC 개발용 입력. 실기에는 키보드가 없다.
 *
 * 방향키와 WASD 를 둘 다 받는 이유는 개발 중 손이 어디 있든 쓰기 위해서다.
 * 여러 방향키가 동시에 눌리면 하나만 고른다 — 대각선이 없으므로 합칠 수 없다.
 */
export class KeyboardSource {
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key>

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly hub: InputHub,
  ) {
    const kb = scene.input.keyboard
    if (!kb) throw new Error('키보드 입력을 쓸 수 없다')

    this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D,SPACE,J,ESC,K,I,C') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >
  }

  /** 매 프레임 부른다. hub.beginFrame() 뒤에 와야 한다. */
  update(): void {
    this.hub.setDir(this.readDir())
    this.hub.setButton('action', this.down('SPACE') || this.down('J'))
    this.hub.setButton('cancel', this.down('ESC') || this.down('K'))
    this.hub.setButton('bag', this.down('I'))
    this.hub.setButton('craft', this.down('C'))
  }

  destroy(): void {
    for (const key of Object.values(this.keys)) {
      this.scene.input.keyboard?.removeKey(key)
    }
  }

  private down(name: string): boolean {
    return this.keys[name]?.isDown ?? false
  }

  /**
   * 눌린 방향 중 하나를 고른다.
   *
   * 위·아래를 동시에 누르면 위가 이긴다. 어느 쪽이 이기든 게임에 차이가 없고,
   * 정하지 않으면 프레임마다 달라져서 캐릭터가 떨린다.
   */
  private readDir(): Direction | null {
    if (this.down('UP') || this.down('W')) return 'up'
    if (this.down('DOWN') || this.down('S')) return 'down'
    if (this.down('LEFT') || this.down('A')) return 'left'
    if (this.down('RIGHT') || this.down('D')) return 'right'
    return null
  }
}
```

- [ ] **Step 3: 타입 검사**

Run: `pnpm typecheck`

기대: 오류 없음. 이 태스크는 아직 아무도 이 클래스들을 쓰지 않으므로 게임 동작은 바뀌지 않는다.

- [ ] **Step 4: 커밋**

`git add apps/client/src/input/InputState.ts apps/client/src/input/KeyboardSource.ts`

커밋 메시지:

```
feat(client): 장치를 모르는 입력 상태와 키보드 소스

키보드와 화면 버튼이 같은 상태에 쓰게 해서, 게임 로직이 어느 장치인지
묻지 않게 한다. 지금은 아무도 이 클래스를 쓰지 않는다 — 다음 태스크가
이동을 여기로 옮긴다.

한 프레임짜리 신호(actionPressed)를 누르고 있는 상태(action)와 나눈 이유는,
기본 채집이 누를 때마다 한 번이고 자동 반복만 누르고 있는 것을 보기 때문이다.
둘을 한 값으로 두면 그 구분을 표현할 수 없다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 5: 타일 이동

자유 이동과 탭 이동을 버리고 타일 단위로 걷게 한다.

**Files:**
- Create: `apps/client/src/game/TileMover.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`
- Modify: `apps/client/src/game/PhaserGame.ts`

**Interfaces:**
- Consumes: Task 1 의 `Direction`·`TilePos`·`STEP_MS`·`frontTile`, Task 2 의 `GameData.placements`, Task 4 의 `InputHub`·`KeyboardSource`
- Produces:
  - `class TileMover` — 생성자 `(opts: { start: TilePos; isWalkable: (p: TilePos) => boolean })`
  - `TileMover.tile: TilePos` (읽을 때마다 새 사본)
  - `TileMover.facing: Direction`
  - `TileMover.moving: boolean`
  - `TileMover.pixel: { x: number; y: number }` — 타일 한 칸을 1 로 보는 보간 위치
  - `TileMover.update(deltaMs: number, dir: Direction | null): void`

- [ ] **Step 1: 걸음 상태 기계를 만든다**

`apps/client/src/game/TileMover.ts`:

```ts
import { STEP_MS, frontTile, type Direction, type TilePos } from '@nogada/shared'

interface TileMoverOptions {
  start: TilePos
  /** 그 칸에 설 수 있는가. 맵 밖·벽·노드가 모두 여기서 걸러진다. */
  isWalkable: (p: TilePos) => boolean
}

/**
 * 타일 단위 걸음.
 *
 * 정본은 `tile` 이고 `pixel` 은 그리기용 보간값이다. 이 순서가 뒤집히면
 * 위치를 서버에 보낼 때 반올림 문제가 생긴다.
 *
 * 걸음 중에는 방향 입력을 받지 않는다. 원작의 `moving?` 게이트와 같다 —
 * 이것이 없으면 걸음이 반쯤 진행된 상태에서 방향이 바뀌어 위치가 타일
 * 격자에서 어긋난다.
 */
export class TileMover {
  private readonly isWalkable: (p: TilePos) => boolean
  private current: TilePos
  private target: TilePos
  private elapsed = 0
  private stepping = false

  facing: Direction = 'down'

  constructor(opts: TileMoverOptions) {
    this.isWalkable = opts.isWalkable
    this.current = { ...opts.start }
    this.target = { ...opts.start }
  }

  get tile(): TilePos {
    return { ...this.current }
  }

  get moving(): boolean {
    return this.stepping
  }

  /** 타일 한 칸을 1 로 보는 보간 위치. 씬이 여기에 타일 픽셀 크기를 곱한다. */
  get pixel(): { x: number; y: number } {
    if (!this.stepping) return { x: this.current.x, y: this.current.y }
    const t = Math.min(1, this.elapsed / STEP_MS)
    return {
      x: this.current.x + (this.target.x - this.current.x) * t,
      y: this.current.y + (this.target.y - this.current.y) * t,
    }
  }

  update(deltaMs: number, dir: Direction | null): void {
    if (this.stepping) {
      this.elapsed += deltaMs
      if (this.elapsed < STEP_MS) return

      // 남은 시간을 버리지 않고 다음 걸음으로 넘긴다. 버리면 프레임률이 낮을 때
      // 걸음마다 조금씩 느려져서 실제 이동 속도가 STEP_MS 보다 느려진다.
      const overflow = this.elapsed - STEP_MS
      this.current = { ...this.target }
      this.stepping = false
      this.elapsed = 0
      if (dir) this.tryStep(dir, overflow)
      return
    }

    if (dir) this.tryStep(dir, 0)
  }

  /**
   * 방향을 바꾸고, 갈 수 있으면 한 걸음을 시작한다.
   *
   * 방향 전환과 이동이 분리된 것이 중요하다. 벽이나 노드를 향해 방향키를 누르면
   * 움직이지는 않지만 그쪽을 바라보게 된다 — 노드 앞에 서서 방향을 맞추는
   * 조작이 여기서 나온다. 원작도 그렇다.
   */
  private tryStep(dir: Direction, carryMs: number): void {
    this.facing = dir
    const next = frontTile(this.current, dir)
    if (!this.isWalkable(next)) return

    this.target = next
    this.stepping = true
    this.elapsed = carryMs
  }
}
```

- [ ] **Step 2: 씬을 타일 이동으로 바꾼다**

`apps/client/src/game/scenes/WorldScene.ts` 를 고친다.

**지우는 것:**
- `PLAYER_SPEED` 상수
- `moveTarget` 필드와 `this.input.on('pointerdown', ...)` 블록 전체 — 탭 이동을 버린다
- `cursors` 필드와 `this.cursors = this.input.keyboard!.createCursorKeys()` — 입력은 이제 `KeyboardSource` 가 읽는다
- `applyMovement()` 메서드 전체
- `this.physics.add.sprite(...)` → `this.add.sprite(...)`
- `this.player.setSize(20, 16).setOffset(6, 14)`
- `this.physics.add.collider(this.player, walls)`
- `this.physics.world.setBounds(...)`
- `Facing` 지역 타입 선언 — `@nogada/shared` 의 `Direction` 을 쓴다. 두 이름이 같은 것을 가리키면 나중에 갈라진다. `WALK_ROW` 의 타입도 `Record<Direction, number>` 가 된다

**더하는 필드:**

```ts
  private hub!: InputHub
  private keyboard!: KeyboardSource
  private mover!: TileMover
  private wallLayer!: Phaser.Tilemaps.TilemapLayer
  private mapWidth = 0
  private mapHeight = 0
  private readonly blocked = new Set<string>()
```

**`create()` 에 더하는 것** — 맵과 플레이어 스프라이트를 만든 뒤:

```ts
    this.mapWidth = map.width
    this.mapHeight = map.height
    this.wallLayer = walls

    // 노드가 놓인 칸은 걸을 수 없다. 맵 데이터에 벽을 그려 넣는 대신 여기서
    // 판정하는 이유는, 노드 배치가 이미 데이터에 있어서 같은 사실을 두 곳에
    // 적을 필요가 없기 때문이다.
    for (const p of Object.values(useGameStore.getState().data.placements)) {
      this.blocked.add(`${p.x},${p.y}`)
    }

    this.mover = new TileMover({
      start: { x: Math.floor(startX / TILE), y: Math.floor(startY / TILE) },
      isWalkable: (p) => this.isWalkable(p),
    })

    this.hub = new InputHub()
    this.keyboard = new KeyboardSource(this, this.hub)
```

**더하는 메서드:**

```ts
  private isWalkable(p: TilePos): boolean {
    if (p.x < 0 || p.y < 0 || p.x >= this.mapWidth || p.y >= this.mapHeight) return false
    if (this.blocked.has(`${p.x},${p.y}`)) return false
    // walls 레이어에 타일이 있으면 벽이다. getTileAt 은 빈 칸에 null 을 준다.
    const tile = this.wallLayer.getTileAt(p.x, p.y)
    return tile === null || tile.index === -1
  }
```

**`update()` 를 통째로 바꾼다:**

```ts
  update(_time: number, delta: number): void {
    this.hub.beginFrame()
    this.keyboard.update()

    this.mover.update(delta, this.hub.state.dir)

    const px = this.mover.pixel
    this.player.setPosition(px.x * TILE + TILE / 2, px.y * TILE + TILE / 2)
    this.updateAnimation(this.mover.moving, this.mover.facing)

    this.dayNight.update(gameTimeAt(worldNow()).minuteOfDay)
  }
```

**`updateAnimation` 을 시그니처째 바꾼다:**

```ts
  private updateAnimation(moving: boolean, facing: Direction): void {
    this.facing = facing
    if (!moving) {
      this.player.anims.stop()
      this.player.setFrame(this.idleFrame(facing))
      return
    }
    this.player.anims.play(`walk-${facing}`, true)
  }
```

`cleanup` 함수에 `this.keyboard.destroy()` 를 더한다.

- [ ] **Step 3: 물리 엔진 설정을 지운다**

`apps/client/src/game/PhaserGame.ts` 의 `physics: { default: 'arcade', ... }` 줄을 지운다. 이동이 물리를 쓰지 않으므로 Arcade 월드를 만들 이유가 없다.

- [ ] **Step 4: 확인한다**

Run: `pnpm typecheck`
Expected: 오류 없음

Run: `pnpm --filter @nogada/client build`
Expected: 성공

브라우저에서 직접 확인한다. 서버(`pnpm --filter @nogada/server dev`)와 클라이언트(`pnpm --filter @nogada/client dev`)를 띄우고 아래 여섯 가지를 눈으로 본다.

1. WASD 와 방향키로 한 칸씩 움직인다 — 자유롭게 미끄러지지 않고 칸에서 칸으로 간다
2. 방향키를 누르고 있으면 연속으로 걷는다
3. 벽을 향해 방향키를 누르면 움직이지 않지만 **캐릭터가 그쪽을 바라본다**
4. 노드를 향해 방향키를 누르면 마찬가지로 바라보기만 하고 그 칸에 올라서지 않는다
5. 화면을 탭해도 캐릭터가 그 자리로 가지 않는다
6. 두 방향키를 같이 눌러도 대각선으로 가지 않는다

각 항목의 결과를 보고서에 적는다.

- [ ] **Step 5: 커밋**

```
feat(client): 자유 이동과 탭 이동을 타일 걸음으로 바꾼다

원작은 4방향 타일 이동이고, 노드에 "붙는다"는 감각이 타일 위에서만 정확히
성립한다. 자유 이동에서는 무엇을 바라보는지가 각도 문제가 되고, 각도에는
임계값이 필요하고, 임계값은 반드시 애매한 경계를 만든다.

정본 위치를 타일 정수 좌표로 두고 픽셀을 그리기용 보간값으로 내린 이유는
온라인 때문이다. 타일 걸음은 이산 사건이라 "(3,5)에서 (3,6)으로" 한 줄로
보낼 수 있고 서버가 검증할 수 있지만, 자유 위치는 연속 좌표 스트림과
보간과 조정을 요구한다. 한 화면에 여러 플레이어가 목표인 이상 나중에
바꾸기 매우 비싸다.

방향 전환과 걸음을 분리했다. 벽이나 노드를 향해 누르면 움직이지 않지만
그쪽을 바라본다 — 노드 앞에서 방향을 맞추는 조작이 여기서 나온다.

노드가 놓인 칸을 걸을 수 없게 만드는 것을 맵 데이터가 아니라 판정 함수에
둔 이유는, 배치가 이미 데이터에 있어서 같은 사실을 두 곳에 적을 필요가
없기 때문이다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 6: 앞칸 상호작용

탭 채집을 버리고, 바라보는 앞칸에 있는 것과 상호작용한다.

**Files:**
- Modify: `apps/client/src/game/scenes/WorldScene.ts`
- Modify: `apps/client/src/game/NodeMarker.ts`

**Interfaces:**
- Consumes: Task 1 의 `frontTile`·`TilePos`, Task 2 의 `GameData.placements`, Task 3 의 `gather(instanceId)`, Task 5 의 `TileMover`·`InputHub`
- Produces:
  - `type Interactable = { kind: 'node'; instanceId: string; nodeId: string }`
  - `WorldScene` 의 private `interactableAt(tile: TilePos): Interactable | null`

- [ ] **Step 1: 마커에서 탭을 걷어낸다**

`apps/client/src/game/NodeMarker.ts` 에서 `onTap` 옵션과 그것을 붙이는 `setInteractive` / `on('pointerdown', ...)` 호출을 지운다. 마커는 이제 보여주기만 한다.

지운 뒤 `onTap` 과 `setInteractive` 가 그 파일 어디에도 남지 않는지 확인한다.

- [ ] **Step 2: 앞칸에서 상호작용 대상을 찾는다**

`apps/client/src/game/scenes/WorldScene.ts` 에 타입을 더한다.

```ts
/**
 * 앞칸에 있을 수 있는 것.
 *
 * 원작에서 "앞칸을 향해 결정 버튼"은 세계와 상호작용하는 유일한 동사다.
 * 얼음채집장 이벤트 29개 중 채집 노드는 6개뿐이고 나머지 23개(오크·노인·
 * 퀴즈도우미·소환물)가 전부 같은 입력을 쓴다. 그래서 채집 전용으로 만들지
 * 않는다 — NPC·이벤트·전투 진입점이 나중에 여기 종류를 더한다.
 */
type Interactable = { kind: 'node'; instanceId: string; nodeId: string }
```

씬에 타일 키로 찾는 표를 더한다.

```ts
  private readonly byTile = new Map<string, Interactable>()
```

Task 5 에서 `blocked` 를 채우던 반복문에서 같이 채운다.

```ts
    for (const p of Object.values(useGameStore.getState().data.placements)) {
      this.blocked.add(`${p.x},${p.y}`)
      this.byTile.set(`${p.x},${p.y}`, {
        kind: 'node',
        instanceId: p.instanceId,
        nodeId: p.nodeId,
      })
    }
```

```ts
  private interactableAt(tile: TilePos): Interactable | null {
    return this.byTile.get(`${tile.x},${tile.y}`) ?? null
  }
```

- [ ] **Step 3: 행동 버튼이 앞칸에 작용하게 한다**

`update()` 의 이동 처리와 애니메이션 갱신 뒤, `dayNight.update` 앞에 더한다.

```ts
    const target = this.interactableAt(frontTile(this.mover.tile, this.mover.facing))
    if (target && this.hub.state.actionPressed) {
      this.interact(target)
    }
```

```ts
  /**
   * 앞칸의 대상에 작용한다.
   *
   * 지금은 노드뿐이지만 switch 로 열어 두는 이유는, 새 종류를 더할 때
   * 입력 계층을 건드리지 않기 위해서다.
   */
  private interact(target: Interactable): void {
    switch (target.kind) {
      case 'node':
        void useGameStore.getState().gather(target.instanceId)
        break
    }
  }
```

- [ ] **Step 4: 확인한다**

Run: `pnpm typecheck`
Expected: 오류 없음

Run: `pnpm --filter @nogada/client build`
Expected: 성공

브라우저에서 다섯 가지를 눈으로 본다.

1. 노드 옆에 서서 노드를 바라보고 스페이스를 누르면 채집된다 (머리 위에 결과가 뜬다)
2. 노드 옆에 있어도 **다른 곳을 보고 있으면** 눌러도 아무 일도 없다
3. 노드에서 두 칸 떨어져서 누르면 아무 일도 없다
4. 노드를 탭해도 채집되지 않는다
5. 스페이스를 누르고 있어도 한 번만 채집된다 (자동 반복은 Task 7 이다)

각 항목의 결과를 보고서에 적는다. 2번이 이 태스크의 핵심이다 — 그것이 참이어야 위치가 규칙이 된다.

- [ ] **Step 5: 커밋**

```
feat(client): 탭 채집을 앞칸 상호작용으로 바꾼다

노드를 탭하면 화면 반대편 노드도 캘 수 있었다. 위치가 아무 의미가 없었다.
이제 바라보는 앞칸 하나가 대상이고, 옆에 있어도 다른 곳을 보고 있으면
반응하지 않는다. 원작의 결정 버튼 트리거가 그렇다.

대상을 채집 노드가 아니라 Interactable 로 연 이유는 원작 때문이다. 원작
얼음채집장의 이벤트 29개 중 채집 노드는 6개뿐이고 나머지 23개가 전부 같은
앞칸+결정 버튼을 쓴다. 앞칸+결정은 원작에서 세계와 상호작용하는 유일한
동사이고, 채집만을 위해 이 경로를 만들면 NPC 도 이벤트도 전투도 들어올
문이 없어진다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 7: 자동 반복과 해금 알림

숙련도가 문턱을 넘은 기술에서는 행동 버튼을 누르고 있는 동안 반복된다. 넘는 순간은 사건으로 알린다.

**Files:**
- Modify: `apps/client/src/store/gameStore.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 1 의 `canRepeat`·`REPEAT_UNLOCK_PROFICIENCY`, Task 6 의 `Interactable`
- Produces:
  - `gameStore` 에 `milestone: { seq: number; text: string } | null`
  - `WorldScene` 의 private `sendGather(instanceId: string): void`

- [ ] **Step 1: 해금을 감지해 사건으로 만든다**

`apps/client/src/store/gameStore.ts` 에 더한다.

```ts
/**
 * 노가다 사이사이의 사건.
 *
 * 원작이 8,000시간을 버틴 이유는 반복 자체가 아니라 반복이 무언가를 향하고
 * 있었기 때문이다. 자동 반복 해금은 그 첫 번째 사건이 될 수 있다 — 조용히
 * 켜지면 아무도 알아채지 못하고, 그러면 문턱을 둔 의미가 사라진다.
 */
export interface Milestone {
  seq: number
  text: string
}
```

`GameStore` 인터페이스에 `milestone: Milestone | null` 을 더하고 초기값을 `null` 로 둔다.

```ts
let milestoneSeq = 0

/**
 * 이번 행동으로 자동 반복이 열린 기술을 찾는다.
 *
 * 넘기 전과 넘은 뒤를 비교하므로 딱 한 번만 잡힌다. 이미 열린 기술은
 * canRepeat 이 전에도 참이라 걸리지 않는다.
 */
function detectUnlock(prev: PlayerState | null, next: PlayerState): SkillId | null {
  if (!prev) return null
  for (const id of SKILL_IDS) {
    if (!canRepeat(prev.skills[id]) && canRepeat(next.skills[id])) return id
  }
  return null
}

function applyPlayer(set: SetFn, prev: PlayerState | null, next: PlayerState): void {
  set({ player: next })
  const unlocked = detectUnlock(prev, next)
  if (unlocked) {
    set({
      milestone: {
        seq: ++milestoneSeq,
        text: `${SKILL_LABELS[unlocked]}이(가) 손에 익었다 — 누르고 있으면 계속된다`,
      },
    })
  }
}
```

`gather` 와 `craft` 의 `set({ player: outcome.player })` 를 바꾼다. 바꾸기 전에 이전 플레이어를 잡아 둬야 한다.

```ts
      const prev = useGameStore.getState().player
      const outcome: GatherOutcomeDto = await GameClient.gather(instanceId)
      applyPlayer(set, prev, outcome.player)
```

`SKILL_LABELS` 와 `SKILL_IDS`, `canRepeat` 을 `@nogada/shared` 에서 import 한다. `SKILL_LABELS` 가 없으면 `packages/shared/src/types.ts` 에서 실제 이름을 확인하고 그것을 쓴다.

- [ ] **Step 2: 씬이 반복을 스케줄한다**

`apps/client/src/game/scenes/WorldScene.ts` 에 더한다.

```ts
  /** 요청이 날아가 있는 동안 또 보내지 않는다. 응답을 기다리는 사이에 쌓이면 순서가 뒤엉킨다. */
  private gatherPending = false
```

```ts
  /**
   * 채집 요청을 보낸다.
   *
   * 서버의 행동 간격 이전에는 보내지 않는다. 보내 봐야 too_fast 로 거부되고
   * 그 거부는 스토어가 조용히 삼키므로, 플레이어에게는 "가끔 안 캐진다" 로
   * 보인다. 아예 보내지 않으면 그런 상태가 생기지 않는다.
   */
  private sendGather(instanceId: string): void {
    if (this.gatherPending) return
    const { player } = useGameStore.getState()
    if (!player || worldNow() < player.nextActionAt) return

    this.gatherPending = true
    void useGameStore
      .getState()
      .gather(instanceId)
      .finally(() => {
        this.gatherPending = false
      })
  }

  /** 그 대상에서 누르고 있는 것만으로 반복되는가. */
  private repeatsOn(target: Interactable): boolean {
    if (target.kind !== 'node') return false
    const { player, data } = useGameStore.getState()
    const node = data.nodes[target.nodeId]
    if (!player || !node) return false
    return canRepeat(player.skills[node.skill])
  }
```

Task 6 에서 넣은 상호작용 블록을 바꾼다.

```ts
    const target = this.interactableAt(frontTile(this.mover.tile, this.mover.facing))
    if (target) {
      const held = this.hub.state.action
      if (this.hub.state.actionPressed) {
        this.interact(target)
      } else if (held && this.repeatsOn(target)) {
        this.interact(target)
      }
    }
```

`interact` 의 `node` 분기가 `this.sendGather(target.instanceId)` 를 부르도록 바꾼다.

- [ ] **Step 3: 해금 알림을 화면에 띄운다**

`create()` 의 기존 스토어 구독 옆에 하나 더 건다. 기존 구독과 같은 정리 경로를 타야 한다 — `cleanup` 에서 함께 해제한다.

```ts
    this.unsubscribeMilestone = useGameStore.subscribe((state, prev) => {
      const m = state.milestone
      if (!m || m.seq === prev.milestone?.seq) return
      this.showMilestone(m.text)
    })
```

```ts
  /**
   * 화면 가운데에 크게, 오래 띄운다.
   *
   * 머리 위 플로팅 텍스트와 다르게 만드는 이유는 이것이 채집 결과가 아니라
   * 사건이기 때문이다. 같은 모양으로 띄우면 수천 번 본 글자에 묻힌다.
   */
  private showMilestone(text: string): void {
    const cam = this.cameras.main
    const label = this.add
      .text(cam.width / 2, cam.height / 3, text, {
        fontSize: '18px',
        color: '#ffe9a8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.overhead + 10)

    this.tweens.add({
      targets: label,
      alpha: { from: 0, to: 1 },
      duration: 300,
      hold: 2600,
      yoyo: true,
      onComplete: () => label.destroy(),
    })
  }
```

- [ ] **Step 4: 확인한다**

Run: `pnpm typecheck`
Expected: 오류 없음

Run: `pnpm --filter @nogada/client build`
Expected: 성공

브라우저에서 확인한다. 숙련도 10,000 은 손으로 채집해서 도달할 수 없으므로 세이브를 고쳐서 본다.

서버의 세이브 파일은 `apps/server/.data/players.json` 이다. 서버를 멈추고, 그 파일에서 `skills.mineral` 을 `9995` 로 고치고, 서버를 다시 띄운다.

1. 구리 광맥 앞에서 스페이스를 **누르고 있어도** 반복되지 않는다 (아직 9,995 다)
2. 스페이스를 연타해서 10,000 을 넘기면 화면 가운데에 해금 알림이 뜬다
3. 그 뒤에는 스페이스를 **누르고 있으면** 계속 채집된다
4. 얼음 광맥 앞에서는 여전히 반복되지 않는다 (얼음 숙련도는 0 이다) — 기술마다 따로 열린다

각 항목의 결과를 보고서에 적는다. 4번이 중요하다 — 기술별로 열리지 않으면 다섯 번의 목표가 한 번이 된다.

세이브 파일을 고칠 수 없으면(셸이 그 경로를 막는 등) 시도한 것과 막힌 이유를 보고하고, 대신 `REPEAT_UNLOCK_PROFICIENCY` 를 일시적으로 5 로 낮춰 같은 네 가지를 확인한 뒤 값을 되돌린다. 되돌린 것을 보고서에 명시한다.

- [ ] **Step 5: 커밋**

```
feat: 숙련도가 자동 반복을 열고, 열리는 순간을 사건으로 알린다

우리 게임의 최속은 초당 20회다. 손가락으로 낼 수 있는 속도가 아니다.
원작은 이것을 25만 골드짜리 버프로 팔았지만 우리는 경제가 없으므로,
같은 구조를 그대로 가져오면 "언젠가 열림"이 아니라 "영원히 안 열림"이
된다 — 가장 오래 판 플레이어가 자기가 번 속도에 가장 못 닿게 된다.

문턱을 숙련도 10,000 으로 둔 이유는 그 지점의 행동 간격이 200ms,
초당 5회이기 때문이다. 연타로 지속할 수 없게 되는 경계라서 해금이
정확히 손가락이 병목이 되는 순간에 온다. 그 전까지는 연타가 실제로
가능하니 잠겨 있어도 손해가 없다.

기술마다 따로 연다. 원작이 자원별로 따로 팔던 구조를 유지해서 채집 4종 +
조합 = 다섯 번의 작은 목표가 되게 한다.

해금을 조용히 켜지 않고 화면 가운데에 사건으로 띄운다. 원작이 8,000시간을
버틴 이유는 반복 자체가 아니라 반복이 무언가를 향하고 있었기 때문이고,
조용히 켜지면 그 무언가가 존재하지 않는 것과 같다.

서버 간격 이전에는 요청을 아예 보내지 않는다. 보내면 too_fast 로 거부되고
그 거부는 조용히 삼켜지므로 "가끔 안 캐진다" 로 보인다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 8: 반복 중 누적 표현

초당 20회로 반복되면 지금 표현이 무너진다. `FloatingText` 는 행동마다 새 글자를 만들고 900ms 살기 때문에 같은 자리에 18개가 겹친다.

**Files:**
- Modify: `apps/client/src/store/gameStore.ts`
- Modify: `apps/client/src/game/FloatingText.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 7 의 `applyPlayer`
- Produces:
  - `ActionFeedback` 에 `groupKey: string | null` 과 `amount: number` 추가
  - `class FloatingTextGroup` — `push(scene, x, y, feedback): void`, `destroy(): void`

- [ ] **Step 1: 피드백에 누적 정보를 싣는다**

`apps/client/src/store/gameStore.ts` 의 `ActionFeedback` 을 바꾼다.

```ts
export interface ActionFeedback {
  seq: number
  text: string
  tone: 'good' | 'bad'
  /**
   * 같은 키의 결과가 연달아 오면 새 글자를 만들지 않고 기존 글자에 더한다.
   * null 이면 누적하지 않고 매번 새로 띄운다.
   */
  groupKey: string | null
  amount: number
}
```

`pushAction` 의 시그니처를 바꾼다.

```ts
function pushAction(
  set: SetFn,
  text: string,
  tone: ActionFeedback['tone'],
  groupKey: string | null = null,
  amount = 1,
): void {
  set({ lastAction: { seq: ++actionSeq, text, tone, groupKey, amount } })
}
```

호출부를 고친다.

- 채집 성공: `pushAction(set, `${name} +${outcome.gained.count}`, 'good', outcome.gained.item, outcome.gained.count)`
- 채집 실패: `pushAction(set, '실패', 'bad', 'gather-fail', 1)`
- 제작 성공: 기존 문구 그대로, `groupKey` 는 `outcome.produced.item`, `amount` 는 `outcome.produced.count`. **자동 착용 접미사가 붙는 경우에는 `groupKey` 를 `null` 로 둔다** — 도구를 새로 낀 것은 누적해서 뭉갤 사건이 아니다
- 제작 실패: `pushAction(set, '제작 실패', 'bad', 'craft-fail', 1)`
- 오류 문구: `groupKey` 없이 그대로

- [ ] **Step 2: 누적하는 표시기를 만든다**

`apps/client/src/game/FloatingText.ts` 를 고친다. 기존 `spawnFloatingText` 는 그대로 두고(누적하지 않는 경우에 쓴다) 그 위에 그룹을 얹는다.

```ts
const LIFE_MS = 900

interface LiveText {
  label: Phaser.GameObjects.Text
  tween: Phaser.Tweens.Tween
  amount: number
  tone: 'good' | 'bad'
  baseText: string
}

/**
 * 같은 종류의 결과를 하나의 글자에 누적한다.
 *
 * 자동 반복이 열리면 초당 20번까지 결과가 온다. 매번 새 글자를 만들면 900ms
 * 동안 18개가 같은 자리에 겹쳐서 아무것도 읽을 수 없다. 대신 살아 있는 글자에
 * 수치를 더하고 수명을 늘린다 — 반복이 멈추면 자연히 사라진다.
 */
export class FloatingTextGroup {
  private readonly live = new Map<string, LiveText>()

  push(
    scene: Phaser.Scene,
    x: number,
    y: number,
    feedback: { text: string; tone: 'good' | 'bad'; groupKey: string | null; amount: number },
  ): void {
    if (!feedback.groupKey) {
      spawnFloatingText(scene, x, y, feedback.text, feedback.tone)
      return
    }

    const existing = this.live.get(feedback.groupKey)
    if (existing) {
      existing.amount += feedback.amount
      existing.label.setText(this.render(existing))
      existing.label.setPosition(x, y)
      // 수명을 처음부터 다시 센다. 반복이 이어지는 동안 사라지지 않는다.
      existing.tween.restart()
      return
    }

    this.spawn(scene, x, y, feedback)
  }

  destroy(): void {
    for (const entry of this.live.values()) {
      entry.tween.stop()
      entry.label.destroy()
    }
    this.live.clear()
  }

  private render(entry: LiveText): string {
    // 성공은 몇 개인지가 정보이고, 실패는 몇 번인지가 정보다.
    return entry.tone === 'good'
      ? `${entry.baseText} +${entry.amount}`
      : `${entry.baseText} ×${entry.amount}`
  }

  private spawn(
    scene: Phaser.Scene,
    x: number,
    y: number,
    feedback: { text: string; tone: 'good' | 'bad'; groupKey: string | null; amount: number },
  ): void {
    const key = feedback.groupKey
    if (!key) return

    // 첫 글자는 스토어가 만든 문구를 그대로 쓰고, 두 번째부터 render() 가 만든다.
    const label = createFloatingLabel(scene, x, y, feedback.text, feedback.tone)
    const entry: LiveText = {
      label,
      amount: feedback.amount,
      tone: feedback.tone,
      baseText: baseTextOf(feedback.text, feedback.tone),
      tween: scene.tweens.add({
        targets: label,
        y: y - 24,
        alpha: { from: 1, to: 0 },
        duration: LIFE_MS,
        onComplete: () => {
          this.live.delete(key)
          label.destroy()
        },
      }),
    }
    this.live.set(key, entry)
  }
}

/** "구리 원석 +2" 에서 "구리 원석" 만 남긴다. 실패 문구는 그대로 쓴다. */
function baseTextOf(text: string, tone: 'good' | 'bad'): string {
  if (tone !== 'good') return text
  const cut = text.lastIndexOf(' +')
  return cut === -1 ? text : text.slice(0, cut)
}
```

기존 `spawnFloatingText` 의 본문에서 글자를 만드는 부분을 `createFloatingLabel(scene, x, y, text, tone): Phaser.GameObjects.Text` 로 뽑아내고, `spawnFloatingText` 와 `FloatingTextGroup` 이 둘 다 그것을 쓰게 한다. 같은 모양의 글자를 두 곳에서 따로 만들면 한쪽만 고치는 일이 생긴다.

- [ ] **Step 3: 씬이 그룹을 쓰게 한다**

`apps/client/src/game/scenes/WorldScene.ts` 의 스토어 구독에서 `spawnFloatingText` 대신 그룹을 쓴다.

```ts
  private readonly floaters = new FloatingTextGroup()
```

```ts
      this.floaters.push(
        this,
        this.player.x,
        this.player.y - this.player.displayHeight / 2,
        action,
      )
```

`cleanup` 에 `this.floaters.destroy()` 를 더한다.

- [ ] **Step 4: 확인한다**

Run: `pnpm typecheck`
Expected: 오류 없음

Run: `pnpm --filter @nogada/client build`
Expected: 성공

브라우저에서 확인한다. Task 7 처럼 세이브의 `skills.mineral` 을 `20000` 으로 올려 자동 반복이 열린 상태로 만든다.

1. 구리 광맥 앞에서 스페이스를 누르고 있으면 머리 위 글자가 **하나만** 뜨고 그 수치가 계속 올라간다
2. 손을 떼면 글자가 사라진다
3. 다른 노드로 옮겨 다른 재료를 캐면 그 재료의 글자가 따로 뜬다
4. 실패가 섞여도 성공 글자와 실패 글자가 각각 하나씩만 유지된다

각 항목의 결과를 보고서에 적는다.

- [ ] **Step 5: 커밋**

```
feat(client): 반복 중에는 결과를 하나의 글자에 누적한다

자동 반복이 열리면 초당 20번까지 결과가 온다. 행동마다 새 글자를 만들고
900ms 를 살리면 같은 자리에 18개가 겹쳐서 아무것도 읽을 수 없다.

살아 있는 글자에 수치를 더하고 수명을 다시 세는 방식으로 바꿨다. 반복이
이어지는 동안 글자 하나가 계속 자라고, 멈추면 자연히 사라진다. 성공은
몇 개인지가 정보이고 실패는 몇 번인지가 정보라서 표기를 다르게 했다.

자동 착용이 일어난 제작은 누적하지 않는다. 도구를 새로 낀 것은 수치로
뭉갤 사건이 아니다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 9: 가상 컨트롤러

실기에는 키보드가 없다. 화면 위에 방향 패드와 버튼을 그린다.

**Files:**
- Create: `apps/client/src/input/TouchSource.ts`
- Create: `apps/client/src/game/scenes/ControlScene.ts`
- Modify: `apps/client/src/game/PhaserGame.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`

**Interfaces:**
- Consumes: Task 4 의 `InputHub`·`InputButton`
- Produces:
  - `class ControlScene extends Phaser.Scene` — 키 `'Control'`
  - `ControlScene.bind(hub: InputHub): void`

**중요:** 이 태스크는 `apps/client/src/ui/App.tsx` 를 건드리지 않는다. 컨트롤러를 React 가 아니라 Phaser 씬으로 만드는 이유 중 하나가 그것이다 — 그 파일에는 커밋되면 안 되는 개발용 훅이 있다.

- [ ] **Step 1: 컨트롤러 씬을 만든다**

`apps/client/src/game/scenes/ControlScene.ts` 를 만든다. 요구 사항:

- **월드 씬 위에 그린다.** 별도 씬이라 카메라 스크롤과 낮밤 명암의 영향을 받지 않는다 — 밤에 컨트롤러가 어두워지면 안 된다.
- **왼쪽 아래에 4방향 패드.** 십자 모양으로 배치한 네 개의 버튼이다. 대각선 칸은 만들지 않는다.
- **오른쪽 아래 안쪽에 A(행동).** 가장 많이 누르는 버튼이므로 엄지가 자연히 놓이는 안쪽에 두고 가장 크게 만든다. 원작의 배치(묶음 왼쪽 아래가 결정)와 같다.
- **A 의 바깥쪽 위에 B(취소).**
- **그 위에 가방·제작 토글.**
- **버튼 최소 지름 48px.** 손가락 크기다.
- **화면 맨 아래에서 위로 여백을 둔다.** 안드로이드 제스처 내비게이션 영역과 겹치면 조작 중에 앱이 뒤로 가거나 홈으로 나간다. 최소 24px 를 띄운다.
- **반투명하게 겹친다.** 별도 띠를 만들어 게임 화면을 좁히지 않는다 — 가로 화면에서 세로 픽셀이 가장 비싸다.
- **`Phaser.Scale.RESIZE` 이므로 화면 크기가 바뀌면 다시 배치해야 한다.** `this.scale.on('resize', ...)` 에 재배치를 걸고, 씬이 끝날 때 `off` 한다.

각 버튼은 `setInteractive()` 한 도형이고 `pointerdown` 에서 `hub.setButton(name, true)`, `pointerup`·`pointerout`·`pointerupoutside` 에서 `false` 를 부른다. **`pointerout` 과 `pointerupoutside` 를 빠뜨리면 버튼 위에서 손가락을 밀어냈을 때 눌린 채로 남아 캐릭터가 영원히 걷는다.**

방향 패드의 네 버튼은 `pointerdown` 에서 `hub.setDir(방향)`, 놓을 때 그 방향이 아직 자기 것이면 `hub.setDir(null)` 을 부른다.

멀티터치를 켠다 — `this.input.addPointer(2)`. 켜지 않으면 패드와 A 를 동시에 누를 수 없어서 걸으면서 채집하는 것이 불가능하다.

- [ ] **Step 2: 게임에 씬을 더한다**

`apps/client/src/game/PhaserGame.ts` 의 `scene: [WorldScene]` 을 `scene: [WorldScene, ControlScene]` 으로 바꾼다.

`apps/client/src/game/scenes/WorldScene.ts` 의 `create()` 끝에서 컨트롤 씬을 띄우고 허브를 넘긴다.

```ts
    // 컨트롤러는 별도 씬이라 카메라 스크롤과 낮밤 명암의 영향을 받지 않는다.
    this.scene.launch('Control')
    const control = this.scene.get('Control') as ControlScene
    control.events.once(Phaser.Scenes.Events.CREATE, () => control.bind(this.hub))
```

`cleanup` 에서 `this.scene.stop('Control')` 을 부른다.

- [ ] **Step 3: 확인한다**

Run: `pnpm typecheck`
Expected: 오류 없음

Run: `pnpm --filter @nogada/client build`
Expected: 성공

브라우저에서 확인한다. 개발자 도구의 기기 모드로 가로 화면(예: 844×390)을 만들고 터치 에뮬레이션을 켠다.

1. 왼쪽 아래 패드로 네 방향 모두 걷는다
2. 패드에서 손가락을 밖으로 밀어내면 캐릭터가 **멈춘다** (눌린 채로 남지 않는다)
3. 노드를 바라본 채 A 를 누르면 채집된다
4. 패드와 A 를 **동시에** 누를 수 있다
5. 창 크기를 바꾸면 컨트롤러가 새 크기에 맞게 다시 배치된다
6. 컨트롤러가 밤에도 어두워지지 않는다
7. 버튼이 화면 맨 아래에 딱 붙어 있지 않다

각 항목의 결과를 보고서에 적는다. 2번과 4번이 실기에서 가장 자주 깨지는 것들이다.

- [ ] **Step 4: 커밋**

```
feat(client): 가로 화면 가상 컨트롤러

실기에는 키보드가 없다. 원작의 배치를 따라 왼쪽에 4방향 패드, 오른쪽에
버튼 묶음을 둔다. 가장 많이 누르는 A 를 엄지가 자연히 놓이는 안쪽에 두는 것도
원작과 같다.

React 가 아니라 Phaser 씬으로 만들었다. 월드 씬과 분리해서 카메라 스크롤과
낮밤 명암의 영향을 받지 않게 하려는 것이 첫째 이유이고, App.tsx 를 건드리지
않으려는 것이 둘째다.

멀티터치를 켜지 않으면 패드와 A 를 동시에 누를 수 없어서 걸으면서 채집하는
것이 불가능하다. 버튼에서 손가락을 밀어냈을 때 놓임 처리를 하지 않으면
눌린 채로 남아 캐릭터가 영원히 걷는다. 둘 다 실기에서만 드러나는 종류라
브라우저 터치 에뮬레이션으로 확인 절차에 넣었다.

화면 맨 아래에서 여백을 둔 것은 안드로이드 제스처 내비게이션 때문이다.
겹치면 조작 중에 앱이 뒤로 가거나 홈으로 나간다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 자체 점검

**스펙 적용 범위**

| 설계 문서 항목 | 태스크 |
|---|---|
| 4장 입력 추상화 | Task 4 |
| 5장 규칙을 shared 에 | Task 1 |
| 5.1 이동 모델 | Task 5 |
| 5.2 타일인 이유 (정본이 타일 좌표) | Task 5 |
| 5.3 숙련도가 여는 자동 반복 + 해금 사건 | Task 7 |
| 5.4 `Interactable` | Task 6 |
| 5.5 노드 인스턴스 정체성 | Task 2, Task 3 |
| 5.6 서버가 아직 강제 못 하는 것 | 구현 없음 — 설계 문서에 경계로 기록됨 |
| 6장 반복 중 표현 + `nextActionAt` 스케줄링 | Task 8, Task 7 |
| 7장 화면 배치 | Task 9 |
| 8장 맵 데이터 작업 | Task 2 (instanceId), Task 5 (단단함은 판정 함수로) |

**설계 문서 8장과 달라진 점 하나:** 설계는 "노드가 놓인 타일을 걸을 수 없는 칸으로 만든다" 를 맵 데이터 작업으로 적었지만, 이동을 우리 코드가 판정하므로 배치 데이터를 보고 판정하면 된다. 맵에 같은 사실을 또 적을 필요가 없다. Task 5 가 그렇게 한다.

**빠진 것 없음 확인:** 설계 11장의 아홉 가지 산출물이 모두 태스크에 대응한다.
