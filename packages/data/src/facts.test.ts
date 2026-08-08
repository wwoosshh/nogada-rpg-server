/**
 * 사실 공급자(`buildFacts`, packages/shared)와 사실 선언 목록(`DECLARED_FACTS`)이
 * 서로 어긋나지 않는지 지킨다.
 *
 * 두 목록은 서로를 모른다. 공급자가 사실 하나를 빠뜨려도, 선언만 `supplied: true`
 * 로 바꿔도, 타입 검사도 다른 테스트도 아무 말을 하지 않는다 — 그러면 작가는
 * "쓸 수 있다"고 표에 적힌 사실로 조건을 걸고, 그 대사는 영원히 나오지 않는다.
 * 빌드는 그것을 "공급자가 없어 잠든 대사"로도 알려주지 않는다. 선언이 있다고
 * 말하고 있기 때문이다.
 *
 * 이 테스트가 packages/shared 가 아니라 여기 있는 이유는, 그 어긋남의 대가를
 * 치르는 쪽이 이 패키지이기 때문이다 — `.dlg` 검증과 시뮬레이터가 둘 다 이
 * 선언 목록을 진실로 믿고 작가에게 말한다. 실제 이정표 목록(`loadGameData`)이
 * 필요한 것도 여기라야 가능하다.
 */
import {
  DECLARED_FACTS,
  SKILL_IDS,
  buildFacts,
  emptyDialogueHistory,
  factValueFitsShape,
  findFactSpec,
  type Facts,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { loadGameData } from './load.js'

const data = loadGameData()
const SPEAKER = '채집장노인'
const NOW = 1_767_225_600_000 + 5 * 60 * 60 * 1000 // 게임 5일차 정오 언저리. 값 자체엔 의미가 없다.

/** 숙련도 0, 이정표 미달성, 대화 이력 없음 — 시뮬레이터가 말하는 "빈 플레이어" 다. */
function emptyPlayer(): PlayerState {
  return {
    id: 'test',
    skills: Object.fromEntries(SKILL_IDS.map((s) => [s, 0])) as Record<SkillId, number>,
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
  }
}

/**
 * 공급자가 만들 수 있는 모든 사실이 실제로 나오는 입력.
 *
 * `justAchieved` 는 방금 넘긴 문턱이 있어야 하고, `daysSinceLastTalk` 는 이 화자와
 * 말해 본 적이 있어야 나온다 — 빈 플레이어에게는 둘 다 매길 값이 없다(그게 빈
 * 플레이어의 뜻이다). "선언된 사실을 전부 만드는가"는 그 정보가 있는 입력으로만
 * 물을 수 있다.
 */
function everythingKnown(): Facts {
  const player = emptyPlayer()
  player.dialogueHistory.lastTalkAt[SPEAKER] = NOW - 3 * 60 * 60 * 1000
  return buildFacts({
    speaker: SPEAKER,
    player,
    milestones: data.milestones,
    nowMs: NOW,
    justAchieved: data.milestones[0]?.id ?? 'ice_10000',
  })
}

function emptyPlayerFacts(): Facts {
  return buildFacts({ speaker: SPEAKER, player: emptyPlayer(), milestones: data.milestones, nowMs: NOW })
}

describe('사실 공급자와 선언 목록', () => {
  it('전제: 검사가 비어 돌지 않도록 기술과 이정표가 실제로 있다', () => {
    // 이 둘이 비면 skill.*·milestone.* 는 키 하나 없이도 아래 검사를 통과한다.
    expect(SKILL_IDS.length).toBeGreaterThan(0)
    expect(data.milestones.length).toBeGreaterThan(0)
  })

  it('공급자가 만드는 모든 사실이 supplied 로 선언돼 있다', () => {
    for (const facts of [emptyPlayerFacts(), everythingKnown()]) {
      for (const name of Object.keys(facts)) {
        const spec = findFactSpec(name)
        // 이름을 함께 단정해야 어느 사실이 어긋났는지가 실패 메시지에 남는다.
        expect([name, spec?.supplied]).toEqual([name, true])
      }
    }
  })

  it('supplied 로 선언된 모든 사실을 공급자가 만든다', () => {
    const produced = new Set(Object.keys(everythingKnown()).map((name) => findFactSpec(name)?.name))
    const missing = DECLARED_FACTS.filter((spec) => spec.supplied && !produced.has(spec.name)).map((s) => s.name)
    expect(missing).toEqual([])
  })

  it('공급자가 넣는 값이 그 사실이 선언한 모양과 맞는다', () => {
    // 모양이 어긋난 사실은 조용히 만들어지고 그 뒤로 어떤 조건과도 맞지 않는다
    // (matchesCondition 은 타입이 다르면 그냥 거짓이다). 예: milestone.<id> 를
    // true/false 가 아니라 1/0 으로 넣는 경우.
    const facts = everythingKnown()
    for (const [name, value] of Object.entries(facts)) {
      const spec = findFactSpec(name)
      if (!spec) continue // 위 테스트가 잡는다
      expect([name, factValueFitsShape(spec.value, value)]).toEqual([name, true])
    }
  })

  it('공급자가 없는 사실은 만들지 않는다 — 없는 사실이라야 조건이 거짓이다', () => {
    const facts = everythingKnown()
    for (const spec of DECLARED_FACTS) {
      if (spec.supplied) continue
      const leaked = Object.keys(facts).filter((n) => (spec.prefix ? n.startsWith(spec.name) : n === spec.name))
      expect([spec.name, leaked]).toEqual([spec.name, []])
    }
  })
})
