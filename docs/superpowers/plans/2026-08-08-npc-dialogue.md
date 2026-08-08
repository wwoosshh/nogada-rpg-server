# 대화 구현 계획 — NPC 와 말하는 사물

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앞칸의 상대(NPC·간판·잠긴 문)에게 말을 걸면 지금 세계의 상태에 맞는 말이 나온다. 그리고 그 대사를 코드를 읽지 않고 쓸 수 있다.

**Architecture:** 대사 선택은 `packages/shared` 의 순수 함수다 — 사건 서열이 먼저, 사건 안에서 조건 개수가 나중. 대사는 작가가 읽을 수 있는 텍스트 형식으로 `packages/data` 가 소유하고 빌드가 검증한다. 서버가 고르고 **대화 한 번에 요청 한 번**으로 발화 전체를 보낸다.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), pnpm 워크스페이스, Phaser 3, React 18, Fastify, zod, vitest.

**설계 문서:** [대화 설계](../specs/2026-08-08-npc-dialogue-design.md)

## Global Constraints

- 게임 규칙은 `packages/shared` 에만 존재한다. 서버와 클라이언트가 동일 함수를 import 한다.
- **모든 판정은 서버가 한다.** 클라이언트는 받은 것을 표시할 뿐이다.
- **대화 한 번 = 요청 한 번.** 발화 전체와 효과를 한 번에 보낸다. 칸마다 왕복하지 않는다.
- **사건 서열이 조건 개수보다 먼저다.** `story → quest → milestone → greet` 순으로 훑고 처음 맞은 사건을 채택한다.
- **상위 사건은 한 번만 말한다.** 매번 말하면 죽은 세계가 된다.
- **선언되지 않은 사실 이름은 빌드가 막는다.** 공급자가 없는 사실은 막지 않고 안내한다.
- **화자 배치는 처음부터 맵 id 를 갖는다.** 맵은 하나뿐이지만 형식에 넣어 둔다.
- **대사창은 화면 탭으로 넘긴다. 행동 버튼이 아니다.** 플레이어는 A 를 쥐고 있도록 훈련돼 있다.
- **B 의 의미는 하나다** — 무언가 열려 있으면 닫는다.
- 클라이언트 UI 는 자동 테스트하지 않는다. `packages/shared`·`packages/data`·`apps/server` 는 테스트 대상이다.
- 가로 전용 모바일. `tsconfig.base.json` 은 `strict: true`, `noUncheckedIndexedAccess: true`. import 는 `.js` 확장자.
- 커밋 메시지는 한국어이고 본문에 *왜* 를 적는다. 트레일러: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **`apps/client/src/ui/App.tsx` 에 커밋되지 않은 개발용 훅 한 줄이 있다.** 어떤 태스크도 그 파일을 건드리거나 커밋하지 않는다. `git add -A` 와 `git commit -a` 를 절대 쓰지 않는다.

---

## File Structure

**새로 만드는 파일**

| 경로 | 책임 |
|---|---|
| `packages/shared/src/dialogue.ts` | 사실·조건·규칙 타입, 사건 서열, 선택 함수, 이력 타입 |
| `packages/shared/src/dialogue.test.ts` | 위의 테스트 |
| `packages/data/dialogue/채집장노인.dlg` | 첫 NPC 대사 |
| `packages/data/dialogue/얼음안내판.dlg` | 첫 말하는 사물 |
| `packages/data/src/dialogueParse.ts` | `.dlg` 형식 파서 |
| `packages/data/src/dialogueParse.test.ts` | 위의 테스트 |
| `packages/data/csv/speakers.csv` | 화자 정의와 배치 (맵 id 포함) |
| `packages/data/src/speakers.ts` | 화자 파싱 |
| `packages/data/src/speakers.test.ts` | 위의 테스트 |
| `packages/data/src/content-cli.ts` | `pnpm content` — 시뮬레이터와 조회 |
| `apps/server/src/services/talkService.ts` | 대화 판정 |
| `apps/server/src/services/talkService.test.ts` | 위의 테스트 |
| `apps/server/src/routes/talk.ts` | `POST /api/talk` |
| `apps/client/src/game/scenes/DialogueScene.ts` | 대사창 |

**고치는 파일:** `packages/shared/src/types.ts`(`GameData.speakers`·`GameData.dialogue`, `PlayerState.dialogueHistory`), `index.ts`, `protocol.ts`, `packages/data/src/build.ts`·`validate.ts`·`index.ts`, `packages/data/package.json`(content 스크립트), `apps/server/src/app.ts`·`state/store.ts`, `apps/client/src/api/GameClient.ts`·`store/gameStore.ts`, `apps/client/src/game/scenes/WorldScene.ts`, `apps/client/src/game/PhaserGame.ts`

---

## Task 1: 대화 선택 규칙

**Files:**
- Create: `packages/shared/src/dialogue.ts`, `packages/shared/src/dialogue.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/types.ts`, `packages/shared/src/protocol.ts`, `apps/server/src/state/store.ts`

**Interfaces:**
- Produces: `FactValue`, `Facts`, `Condition`, `DialogueRule`, `DialogueHistory`, `EVENT_ORDER`, `ONCE_EVENTS`, `matchesCondition`, `ruleMatches`, `onceKey`, `selectDialogue`
- `PlayerState.dialogueHistory: DialogueHistory`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/shared/src/dialogue.test.ts`. 아래를 그대로 쓴다.

```ts
import { describe, expect, it } from 'vitest'
import {
  EVENT_ORDER,
  ONCE_EVENTS,
  emptyDialogueHistory,
  matchesCondition,
  onceKey,
  ruleMatches,
  selectDialogue,
  type DialogueRule,
  type Facts,
} from './dialogue.js'

/** 조건 하나짜리 규칙을 짧게 만든다. */
function rule(
  id: string,
  event: string,
  conditions: DialogueRule['conditions'],
  lines: string[] = ['...'],
): DialogueRule {
  return { id, speaker: '노인', event, conditions, lines, source: { file: 'x.dlg', line: 1 } }
}

const always = () => 0

describe('EVENT_ORDER', () => {
  it('중요한 사건이 앞에 온다', () => {
    expect([...EVENT_ORDER]).toEqual(['story', 'quest', 'milestone', 'greet'])
  })

  it('greet 만 매번 말한다', () => {
    // 상위 사건이 매번 말하면 퀘스트가 걸린 동안 잡담을 못 한다 — 죽은 세계다.
    expect(ONCE_EVENTS.has('greet')).toBe(false)
    expect(ONCE_EVENTS.has('quest')).toBe(true)
    expect(ONCE_EVENTS.has('story')).toBe(true)
    expect(ONCE_EVENTS.has('milestone')).toBe(true)
  })
})

describe('matchesCondition', () => {
  const facts: Facts = { season: 'spring', 'skill.ice': 15000, done: true }

  it('같음을 본다', () => {
    expect(matchesCondition({ fact: 'season', op: '=', value: 'spring' }, facts)).toBe(true)
    expect(matchesCondition({ fact: 'season', op: '=', value: 'winter' }, facts)).toBe(false)
  })

  it('숫자 비교를 본다', () => {
    expect(matchesCondition({ fact: 'skill.ice', op: '>=', value: 10000 }, facts)).toBe(true)
    expect(matchesCondition({ fact: 'skill.ice', op: '>=', value: 20000 }, facts)).toBe(false)
  })

  it('없는 사실은 맞지 않는다', () => {
    // 공급자가 아직 없는 사실을 쓴 규칙은 조용히 선택되지 않아야 한다.
    expect(matchesCondition({ fact: 'weather', op: '=', value: 'rain' }, facts)).toBe(false)
  })

  it('없는 사실은 != 로도 맞지 않는다', () => {
    // "비가 아닐 때" 가 날씨 없이 참이 되면, 날씨를 넣는 순간 대사가 뒤집힌다.
    expect(matchesCondition({ fact: 'weather', op: '!=', value: 'rain' }, facts)).toBe(false)
  })

  it('숫자가 아닌 값에 크기 비교를 하면 맞지 않는다', () => {
    expect(matchesCondition({ fact: 'season', op: '>=', value: 3 }, facts)).toBe(false)
  })
})

describe('ruleMatches', () => {
  it('조건이 전부 맞아야 한다', () => {
    const r = rule('a', 'greet', [
      { fact: 'season', op: '=', value: 'spring' },
      { fact: 'skill.ice', op: '>=', value: 10000 },
    ])
    expect(ruleMatches(r, { season: 'spring', 'skill.ice': 15000 })).toBe(true)
    expect(ruleMatches(r, { season: 'spring', 'skill.ice': 5000 })).toBe(false)
  })

  it('조건이 없으면 항상 맞는다', () => {
    expect(ruleMatches(rule('a', 'greet', []), {})).toBe(true)
  })
})

describe('selectDialogue — 사건 서열', () => {
  const facts: Facts = { weather: 'rain', affinity: 40, 'quest.촌장': 3 }

  const weatherChat = rule('chat', 'greet', [
    { fact: 'weather', op: '=', value: 'rain' },
    { fact: 'affinity', op: '>=', value: 30 },
  ])
  const questHint = rule('quest3', 'quest', [{ fact: 'quest.촌장', op: '=', value: 3 }])

  it('조건이 적어도 상위 사건이 이긴다', () => {
    // 이 설계의 핵심. 조건 개수로만 고르면 날씨 잡담(2개)이 퀘스트 실마리(1개)를
    // 이겨서 진행이 영원히 묻힌다.
    const got = selectDialogue([weatherChat, questHint], facts, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('quest3')
  })

  it('상위 사건을 이미 말했으면 아래로 내려온다', () => {
    const history = emptyDialogueHistory()
    history.said.push(onceKey(questHint, facts))
    const got = selectDialogue([weatherChat, questHint], facts, history, always)
    expect(got?.rule.id).toBe('chat')
  })

  it('상태가 바뀌면 상위 사건이 다시 말한다', () => {
    const history = emptyDialogueHistory()
    history.said.push(onceKey(questHint, { ...facts, 'quest.촌장': 2 }))
    const got = selectDialogue([weatherChat, questHint], facts, history, always)
    expect(got?.rule.id).toBe('quest3')
  })

  it('greet 은 몇 번을 말해도 다시 나온다', () => {
    const only = [rule('hi', 'greet', [])]
    const history = emptyDialogueHistory()
    for (let i = 0; i < 5; i++) {
      const got = selectDialogue(only, {}, history, always)
      expect(got?.rule.id).toBe('hi')
    }
  })
})

describe('selectDialogue — 사건 안에서는 조건 개수', () => {
  const facts: Facts = { weather: 'rain', affinity: 40 }
  const rules = [
    rule('bare', 'greet', []),
    rule('rain', 'greet', [{ fact: 'weather', op: '=', value: 'rain' }]),
    rule('rainClose', 'greet', [
      { fact: 'weather', op: '=', value: 'rain' },
      { fact: 'affinity', op: '>=', value: 30 },
    ]),
  ]

  it('가장 구체적인 것이 이긴다', () => {
    expect(selectDialogue(rules, facts, emptyDialogueHistory(), always)?.rule.id).toBe('rainClose')
  })

  it('조건이 맞지 않으면 덜 구체적인 것으로 내려간다', () => {
    const got = selectDialogue(rules, { weather: 'rain', affinity: 5 }, emptyDialogueHistory(), always)
    expect(got?.rule.id).toBe('rain')
  })

  it('아무 조건도 안 맞으면 무조건 규칙이 나온다', () => {
    expect(selectDialogue(rules, {}, emptyDialogueHistory(), always)?.rule.id).toBe('bare')
  })

  it('할 말이 하나도 없으면 null 이다', () => {
    expect(selectDialogue([], {}, emptyDialogueHistory(), always)).toBeNull()
  })
})

describe('selectDialogue — 동점과 반복', () => {
  const tie = [rule('a', 'greet', []), rule('b', 'greet', []), rule('c', 'greet', [])]

  it('동점이면 난수로 고른다', () => {
    expect(selectDialogue(tie, {}, emptyDialogueHistory(), () => 0)?.rule.id).toBe('a')
    expect(selectDialogue(tie, {}, emptyDialogueHistory(), () => 0.99)?.rule.id).toBe('c')
  })

  it('최근에 나온 것은 잠시 빠진다', () => {
    const history = emptyDialogueHistory()
    history.recent['노인'] = ['a']
    // a 가 빠지면 후보는 b·c 뿐이고 난수 0 은 첫 번째를 고른다.
    expect(selectDialogue(tie, {}, history, () => 0)?.rule.id).toBe('b')
  })

  it('전부 최근이면 그래도 하나는 말한다', () => {
    // 침묵하는 것보다 반복하는 편이 낫다.
    const history = emptyDialogueHistory()
    history.recent['노인'] = ['a', 'b', 'c']
    expect(selectDialogue(tie, {}, history, () => 0)).not.toBeNull()
  })
})

describe('selectDialogue — 시뮬레이터용 흔적', () => {
  it('훑은 사건과 맞은 규칙을 남긴다', () => {
    const rules = [rule('hi', 'greet', []), rule('q', 'quest', [{ fact: 'q', op: '=', value: 1 }])]
    const got = selectDialogue(rules, { q: 1 }, emptyDialogueHistory(), always)
    // 도구가 "왜 그것이 이겼는지" 를 보여주려면 선택 과정이 결과에 남아야 한다.
    expect(got?.trace.map((t) => t.event)).toEqual(['story', 'quest'])
    expect(got?.trace.at(-1)?.matched.map((r) => r.id)).toEqual(['q'])
  })
})
```

- [ ] **Step 2: 테스트가 실패하는 것을 확인한다**

Run: `pnpm vitest run packages/shared/src/dialogue.test.ts`
Expected: `Failed to resolve import "./dialogue.js"`

- [ ] **Step 3: 모듈을 만든다**

`packages/shared/src/dialogue.ts` 를 만든다. 위 테스트를 통과시키는 구현이며, 아래를 지킨다.

- `EVENT_ORDER = ['story', 'quest', 'milestone', 'greet'] as const`
- `ONCE_EVENTS` 는 `greet` 을 제외한 나머지
- `matchesCondition` 은 **사실이 없으면 어떤 연산자로도 거짓**이다. `!=` 도 마찬가지다 — 없는 것을 "다르다"로 세면, 나중에 그 사실이 생기는 순간 대사가 조용히 뒤집힌다
- 크기 비교는 양쪽이 숫자일 때만 참일 수 있다
- `onceKey(rule, facts)` 는 `규칙 id + 그 규칙 조건들의 현재 값` 으로 만든다. 상태가 바뀌면 키가 바뀌어 다시 말한다
- `selectDialogue` 는 `EVENT_ORDER` 순으로 훑는다. 각 사건에서 맞는 규칙을 모으고, `ONCE_EVENTS` 면 이미 말한 것을 뺀다. 남은 것이 있으면 **거기서 멈춘다**
- 채택한 사건 안에서 조건 개수 최댓값만 남기고, 최근 목록에 있는 것을 뺀다. 다 빠지면 빼지 않는다
- 남은 후보에서 `rng()` 로 고른다. 인덱스는 `Math.min(n - 1, Math.floor(rng() * n))`
- `trace` 에 훑은 사건과 각 사건에서 맞은 규칙을 담는다 — 시뮬레이터가 쓴다

각 결정에 *왜* 를 적은 한국어 주석을 단다.

- [ ] **Step 4: 배럴과 `PlayerState` 에 연결한다**

`packages/shared/src/index.ts` 에 `export * from './dialogue.js'` 를 더한다.

`packages/shared/src/types.ts` 의 `PlayerState` 에 더한다.

```ts
  /**
   * 대화 이력.
   *
   * 이정표의 celebrated 와 달리 이것은 유도할 수 없는 진짜 상태다 — 대화는
   * 단조 증가하는 지표가 아니라서 PlayerState 로부터 계산할 수 없다.
   * recent 는 상대마다 최근 몇 개로 묶어 무한히 자라지 않게 한다.
   */
  dialogueHistory: DialogueHistory
```

`protocol.ts` 의 `PlayerStateSchema` 와 `store.ts` 의 `createInitialPlayer` 에 함께 넣는다. 스키마가 바뀌므로 기존 세이브는 버려지고 신규 플레이어로 대체된다 — 이 프로젝트에서 이미 여러 번 있었던 정상 동작이다.

**`PlayerState` 리터럴을 만드는 테스트 픽스처가 전부 깨진다.** 고치는 것이 이 태스크의 일이다.

- [ ] **Step 5: 확인하고 커밋**

Run: `pnpm vitest run packages/shared/src/dialogue.test.ts` → 20개 통과
Run: `pnpm typecheck` → 픽스처를 전부 고친 뒤 통과
Run: `pnpm test` → 전부 통과

커밋 메시지:

```
feat(shared): 대화 선택 규칙 — 사건 서열이 조건 개수보다 먼저다

조건이 가장 많이 맞는 줄을 고르는 것만으로는 안 된다. 계절·시각·숙련도 같은
싼 조건은 계속 늘어나고 퀘스트·스토리 같은 비싼 조건은 개수로 이길 수 없어서,
대사를 열심히 쓸수록 진행의 실마리가 잡담에 묻힌다.

그래서 사건에 서열을 뒀다. story → quest → milestone → greet 순으로 훑고
처음 맞은 사건을 채택하며, 조건 개수는 그 사건 안에서만 본다.

상위 사건은 한 번만 말한다. 퀘스트가 걸렸다고 매번 그 말만 하면 다시 죽은
세계가 되기 때문이다. "한 번" 의 기준을 그 규칙이 건 조건들의 현재 값으로
잡아서, 퀘스트가 다음 단계로 가면 자연히 다시 말한다.

없는 사실은 != 로도 거짓이다. 없는 것을 "다르다" 로 세면 나중에 날씨가
생기는 순간 기존 대사가 조용히 뒤집힌다.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Task 2: 작가용 형식과 화자 데이터

**Files:**
- Create: `packages/data/src/dialogueParse.ts`·`.test.ts`, `packages/data/src/speakers.ts`·`.test.ts`, `packages/data/csv/speakers.csv`, `packages/data/dialogue/채집장노인.dlg`, `packages/data/dialogue/얼음안내판.dlg`
- Modify: `packages/shared/src/types.ts`, `packages/data/src/build.ts`·`validate.ts`·`validate.test.ts`·`index.ts`

**Interfaces:**
- Consumes: Task 1 의 `DialogueRule`, `Condition`
- Produces: `SpeakerDef { id, name, kind, mapId, x, y, sprite }`, `GameData.speakers`, `GameData.dialogue: DialogueRule[]`, `parseDialogue(text, file)`, `parseSpeakers(rows)`, `DECLARED_FACTS`

- [ ] **Step 1: 사실 목록을 선언한다**

`packages/shared/src/dialogue.ts` 에 더한다. 검증이 오타를 잡으려면 이름 목록이 코드에 있어야 한다.

```ts
/**
 * 조건에 쓸 수 있는 사실 이름.
 *
 * `supplied: false` 는 아직 값을 넣어 주는 곳이 없다는 뜻이다. 그 조건을 쓴
 * 규칙은 선택되지 않지만 그것은 의도된 상태이므로 빌드가 막지 않고 안내만 한다 —
 * 작가가 미리 써 두는 것과 오타를 구분해야 하기 때문이다.
 *
 * `skill.<기술>`·`milestone.<id>`·`quest.<id>` 처럼 접두사 뒤가 열려 있는 것은
 * prefix 로 표시한다.
 */
export const DECLARED_FACTS: readonly FactSpec[] = [ /* ... */ ]
```

`season`·`hour`·`dayOfSeason`·`skill.*`·`milestone.*`·`justAchieved`·`talkedBefore`·`daysSinceLastTalk` 는 `supplied: true`, `weather`·`affinity`·`quest.*`·`story`·`activity`·`location` 은 `false` 로 둔다.

- [ ] **Step 2: 파서 테스트를 먼저 쓴다**

`packages/data/src/dialogueParse.test.ts`. 아래를 검증하고, 각 테스트에 그 규칙이 왜 필요한지 한국어 주석을 단다.

- `@greet` 한 줄과 들여쓴 두 줄이 **이어지는 발화 하나**로 파싱된다 (택일이 아니다)
- 같은 조건의 `@greet` 두 개가 **규칙 두 개**로 파싱된다 (동점 → 택일)
- `@greet weather=rain affinity>=30` 의 조건 두 개가 연산자까지 파싱된다
- `#` 로 시작하는 줄과 빈 줄은 무시된다
- 규칙 머리 없이 들여쓴 줄이 먼저 오면 던진다 (파일 어느 줄인지 메시지에 있어야 한다)
- 발화가 없는 규칙 머리는 던진다
- 모르는 연산자는 던진다
- 같은 파일 안에서 규칙 id 가 고유하다 (내용 기반이므로 조건과 발화가 완전히 같은 규칙이 둘이면 던진다 — 작가의 복사 실수다)
- 실제 출하 `.dlg` 두 개가 오류 없이 파싱된다

**규칙 id 는 내용에서 만든다** — 파일 안 순서로 만들면 작가가 줄을 옮길 때마다 `dialogueHistory.said` 가 깨진다.

- [ ] **Step 3: 파서를 만든다**

`packages/data/src/dialogueParse.ts`. `packages/data/src/parse.ts` 의 오류 메시지 형식(어느 파일·어느 줄인지 밝히는)을 먼저 읽고 맞춘다.

- [ ] **Step 4: 화자 데이터**

`packages/data/csv/speakers.csv`:

```csv
id,name,kind,mapId,x,y,sprite
채집장노인,채집장 노인,npc,world,16,12,npc_elder
얼음안내판,안내판,sign,world,14,18,sign_wood
```

`mapId` 를 지금 넣는 이유는 설계 문서 9장에 있다 — 맵은 하나뿐이지만 나중에 늘 때 데이터를 고치지 않기 위해서다.

`packages/data/src/speakers.ts` 가 이것을 파싱한다. `x`·y` 는 타일 좌표다.

- [ ] **Step 5: 대사 파일 둘**

`packages/data/dialogue/채집장노인.dlg` 와 `얼음안내판.dlg` 를 설계 문서 5장의 형식으로 쓴다.

노인에게는 최소한 이것들을 둔다:
- `@milestone justAchieved=ice_10000` — 자동 반복 해금을 방금 넘긴 직후
- `@greet skill.ice>=50000` — 오래 판 사람에게 다르게
- `@greet` 무조건 규칙 **둘 이상** (동점 → 택일이 실제로 동작하는 것을 보기 위해)
- `@greet weather=rain` — 아직 안 나오는 대사가 있는 상태를 만들어, 빌드 안내가 실제로 뜨는지 본다

안내판에는 이것을 둔다:
- `@greet` — 깊은 얼음에 철 도구가 필요하다는 것과 **요구 조합 숙련도 500 을 숫자로** 적는다. 원작의 잠긴 문이 요구치를 숫자로 출력한 것과 같은 이유다

- [ ] **Step 6: 타입·빌드·검증에 연결한다**

`GameData` 에 `speakers: Record<string, SpeakerDef>` 와 `dialogue: DialogueRule[]` 를 더한다.

`build.ts` 가 `dialogue/` 의 모든 `.dlg` 를 읽어 합치고, 개수 보고 줄에 `, 화자 2, 대사 N` 을 이어 붙인다.

`validate.ts` 에 규칙을 더한다 (기존 위반 메시지 형식에 맞춘다):
- 선언되지 않은 사실 이름을 쓰는 조건
- `@greet` 무조건 규칙이 없는 화자
- 같은 사건 안에서 다른 규칙에 완전히 가려지는 규칙 (조건이 부분집합이면서 개수가 적다)
- 대사 파일이 없는 화자, 화자가 없는 대사 파일
- 없는 이정표·기술을 가리키는 조건
- **공급자가 없는 사실을 쓴 규칙은 위반이 아니라 안내로 센다** — 빌드 출력에 "대사 N줄이 weather 를 기다린다" 로 한 줄

각 규칙의 위반 사례와 실제 출하 데이터가 통과하는 것을 `validate.test.ts` 에 더한다.

- [ ] **Step 7: 확인하고 커밋**

Run: `pnpm data:build` → 위반 0건, 안내에 날씨 대기 줄이 보인다
Run: `pnpm test`, `pnpm typecheck`

---

## Task 3: 시뮬레이터

**Files:**
- Create: `packages/data/src/content-cli.ts`
- Modify: `packages/data/package.json`, 루트 `package.json`

**Interfaces:**
- Consumes: Task 1 의 `selectDialogue`·`trace`, Task 2 의 `GameData.dialogue`

- [ ] **Step 1: 시뮬레이터**

```
$ pnpm content dialogue 채집장노인 --skill.ice=15000 --justAchieved=ice_10000
```

설계 문서 8.1 의 출력 형태를 따른다 — 훑은 사건, 채택한 사건, 그 안에서 맞은 규칙과 조건 개수, 선택된 것, 최종 발화. **왜 그것이 이겼는지가 보여야 한다.**

`--사실=값` 을 임의로 받는다. 주지 않은 사실은 기본값(현재 월드 시각, 빈 플레이어)으로 채운다.

- [ ] **Step 2: 역방향 조회**

```
$ pnpm content facts            # 사실별로 그것을 쓰는 대사가 몇 줄인지
$ pnpm content dead             # 어떤 조건에서도 안 나오는 대사
$ pnpm content waiting          # 공급자 없는 사실에 걸려 잠든 대사
```

`dead` 는 검증의 "가려지는 규칙" 과 같은 계산을 쓴다 — 두 곳에 따로 구현하지 않는다.

- [ ] **Step 3: 확인하고 커밋**

세 명령의 실제 출력을 보고서에 붙인다. 시뮬레이터가 **설계 문서 8.1 과 같은 답**을 내는지 손으로 대조한다.

---

## Task 4: 서버 대화 경로

**Files:**
- Create: `apps/server/src/services/talkService.ts`·`.test.ts`, `apps/server/src/routes/talk.ts`
- Modify: `packages/shared/src/protocol.ts`, `apps/server/src/app.ts`, `apps/client/src/api/GameClient.ts`, `apps/client/src/store/gameStore.ts`

**Interfaces:**
- Produces: `TalkRequestSchema { speakerId }`, `TalkOutcome { speaker, lines, player }`, `gameStore.talk(speakerId)`

- [ ] **Step 1: 테스트를 먼저 쓴다**

`apps/server/src/services/talkService.test.ts`:

- 없는 화자는 `unknown_speaker` 로 거부한다
- 성공하면 `lines` 에 발화 **전체**가 담긴다 (칸마다 요청하지 않는다)
- 고른 규칙이 `recent` 에 들어간다
- `ONCE_EVENTS` 의 규칙을 고르면 `said` 에 들어가고, 다시 부르면 다른 사건이 나온다
- `greet` 은 여러 번 불러도 계속 나온다
- `recent` 가 상대마다 정해진 개수를 넘지 않는다
- 입력 플레이어 객체를 변경하지 않는다 (`structuredClone` — 기존 서비스와 같은 자세)
- **행동 간격을 소비하지 않는다** — 대화는 채집이 아니다. `nextActionAt` 을 건드리지 않는다

- [ ] **Step 2: 서비스와 라우트**

`gatherService` 와 같은 모양이다. `rng` 를 주입받고, `structuredClone` 하고, `{ ok: true, outcome } | { ok: false, code }` 를 돌려준다.

라우트는 `routes/gather.ts` 를 그대로 흉내 낸다 — zod 로 파싱하고, 서버가 시드를 만들고, 성공하면 `store.save`.

- [ ] **Step 3: 클라이언트 배선**

`GameClient.talk(speakerId)`, `gameStore.talk(speakerId)`. 받은 `lines` 를 대사창 채널에 넣는다 — `milestone` 채널과 같은 `seq` 방식이다.

- [ ] **Step 4: 확인하고 커밋**

---

## Task 5: 화자 배치와 대사창

**Files:**
- Create: `apps/client/src/game/scenes/DialogueScene.ts`
- Modify: `apps/client/src/game/scenes/WorldScene.ts`, `apps/client/src/game/PhaserGame.ts`, `apps/client/src/game/scenes/ControlScene.ts`

**Interfaces:**
- Consumes: Task 2 의 `GameData.speakers`, Task 4 의 `gameStore.talk`

- [ ] **Step 1: 화자를 맵에 놓는다**

`WorldScene` 이 `data.speakers` 를 돌며 스프라이트를 놓는다 — 노드 배치와 같은 방식이다(타일 좌표 × `TILE` + 절반).

`Interactable` 에 종류를 더한다.

```ts
type Interactable =
  | { kind: 'node'; instanceId: string; nodeId: string }
  | { kind: 'speaker'; speakerId: string }
```

**화자가 놓인 칸은 걸을 수 없다.** 노드와 같은 이유이고 같은 `blocked` 집합을 쓴다.

`interact()` 의 `switch` 에 분기를 더한다. `never` 가드를 함께 넣는다 — 종류가 둘이 되는 지금이 그 가드가 값어치를 갖는 시점이다.

지금 맵에는 화자가 없으므로 `world.tmx`·`world.json` 에 스프라이트 배치는 필요 없다 — 배치는 `speakers.csv` 가 소유한다. 다만 **그 칸이 벽이 아닌지** 검증이 확인해야 한다(Task 2 의 검증에 추가).

- [ ] **Step 2: 대사창**

`DialogueScene` 을 만든다. `PanelScene` 을 읽고 같은 자세를 따른다 — 별도 씬, 열려 있는 동안 `hub.setWorldInputLocked(true)`, 컨트롤러 숨김, 화면 아래쪽.

- 발화를 한 칸씩 보여준다
- **화면 아무 곳이나 탭하면 다음 칸.** 행동 버튼이 아니다
- 키보드는 행동키로 넘기되, **대화가 열린 시점에 눌려 있던 키는 한 번 떼야 먹는다**
- B 로 닫으면 남은 칸은 건너뛴다
- 마지막 칸에서 한 번 더 넘기면 닫힌다

- [ ] **Step 3: 브라우저 확인**

812×375 가로 화면에서:

1. 노인 앞에 서서 바라보고 A 를 누르면 대사창이 뜬다
2. 옆에 있어도 다른 곳을 보면 아무 일도 없다
3. 여러 칸짜리 발화가 탭으로 넘어간다
4. **A 를 쥔 채로 대화를 열어도 발화가 한 번에 넘어가지 않는다**
5. 같은 상대에게 여러 번 말을 걸면 인사가 매번 같지 않다
6. 안내판에 말을 걸면 요구 숙련도가 숫자로 나온다
7. 대사창이 열린 동안 캐릭터가 안 움직인다
8. B 로 닫으면 조작이 돌아온다
9. 숙련도를 10,000 직전으로 두고 채집해 문턱을 넘긴 뒤 바로 노인에게 말을 걸면 **그것을 언급하는 대사**가 나온다

4번과 9번이 핵심이다. 4번은 이 게임이 A 를 쥐도록 훈련시킨다는 사실 때문이고, 9번은 이 설계가 만들려는 감각 그 자체다.

- [ ] **Step 4: 커밋**

---

## 자체 점검

| 설계 문서 | 태스크 |
|---|---|
| 4.1 사실 뭉치 / 4.2 사건 서열 / 4.3 동점·반복 | Task 1 |
| 4.5 서버가 고르고 요청 하나에 발화 전체 | Task 4 |
| 5 작가용 형식 | Task 2 |
| 6 사실 목록과 미공급 처리 | Task 1(선언), Task 2(검증) |
| 7 검증 | Task 2 |
| 8 도구 | Task 3 |
| 9 맵 차원 | Task 2 (`speakers.csv` 의 `mapId`) |
| 10 대사창과 조작 | Task 5 |
| 2 말하는 사물 | Task 2(데이터), Task 5(상호작용) |

**범위 밖으로 남긴 것:** 대화가 상태를 바꾸는 효과(퀘스트 플래그·호감도)는 없다. Task 4 의 응답이 `player` 를 돌려주는 것은 `dialogueHistory` 갱신 때문이지 효과 때문이 아니다 — 효과가 생길 때 그 자리에 들어간다.
