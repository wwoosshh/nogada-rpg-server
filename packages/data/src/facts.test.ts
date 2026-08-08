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
  factValueFitsShape,
  findFactSpec,
  type Facts,
  type PlayerState,
} from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { emptyPlayer } from './emptyPlayer.js'
import { loadGameData } from './load.js'

const data = loadGameData()
const SPEAKER = '채집장노인'
const NOW = 1_767_225_600_000 + 5 * 60 * 60 * 1000 // 게임 5일차 정오 언저리. 값 자체엔 의미가 없다.

/**
 * 실제 서버가 buildFacts 를 부르는 모양 그대로 부른다
 * (apps/server/src/services/talkService.ts 의 호출과 인자가 정확히 같다 —
 * speaker·player·milestones·nowMs 넷뿐이다).
 *
 * "선언된 사실을 공급자가 실제로 만드는가"를 반드시 이 모양으로만 물어야
 * 하는 이유가 리뷰 finding 1 이 지적한 결함 그 자체다: 예전 버전은 이 자리에서
 * `justAchieved` 인자를 손으로 하나 더 얹어 buildFacts 를 불렀다. 그러면 그
 * 인자를 넘기는 프로덕션 호출이 하나도 없어도(talkService.ts 도
 * content-cli.ts 의 defaultFacts 도 넘기지 않는다) 이 파일의 검사는 "만든다"고
 * 우겼다 — justAchieved 는 몇 달이고 supplied: true 로 선언된 채 아무도 채울
 * 수 없는 사실로 남아 있었다. 손으로 인자를 얹지 않고 실제 호출부와 같은
 * 모양으로만 부르면, 프로덕션이 안 주는 인자는 이 헬퍼도 못 주므로 같은
 * 종류의 드리프트가 다시는 조용히 통과할 수 없다.
 */
function productionFacts(player: PlayerState, nowMs: number = NOW): Facts {
  return buildFacts({ speaker: SPEAKER, player, milestones: data.milestones, nowMs })
}

function emptyPlayerFacts(): Facts {
  return productionFacts(emptyPlayer())
}

/**
 * SPEAKER 와 이미 말해 본 적 있는 플레이어 — daysSinceLastTalk 가 나오는
 * 유일한 조건이다(빈 플레이어에게는 매길 값이 없다).
 */
function talkedBeforeFacts(): Facts {
  const player = emptyPlayer()
  player.dialogueHistory.lastTalkAt[SPEAKER] = NOW - 3 * 60 * 60 * 1000
  return productionFacts(player)
}

describe('사실 공급자와 선언 목록', () => {
  it('전제: 검사가 비어 돌지 않도록 기술과 이정표가 실제로 있다', () => {
    // 이 둘이 비면 skill.*·milestone.* 는 키 하나 없이도 아래 검사를 통과한다.
    expect(SKILL_IDS.length).toBeGreaterThan(0)
    expect(data.milestones.length).toBeGreaterThan(0)
  })

  it('공급자가 만드는 모든 사실이 supplied 로 선언돼 있다', () => {
    for (const facts of [emptyPlayerFacts(), talkedBeforeFacts()]) {
      for (const name of Object.keys(facts)) {
        const spec = findFactSpec(name)
        // 이름을 함께 단정해야 어느 사실이 어긋났는지가 실패 메시지에 남는다.
        expect([name, spec?.supplied]).toEqual([name, true])
      }
    }
  })

  it('supplied 로 선언된 모든 사실을 공급자가 만든다', () => {
    const produced = new Set(
      [...Object.keys(emptyPlayerFacts()), ...Object.keys(talkedBeforeFacts())].map(
        (name) => findFactSpec(name)?.name,
      ),
    )
    const missing = DECLARED_FACTS.filter((spec) => spec.supplied && !produced.has(spec.name)).map((s) => s.name)
    expect(missing).toEqual([])
  })

  it('SKILL_IDS 전부의 skill.* 사실을 만든다 — 하나만 있어도 통과하는 위 검사로는 못 잡는다', () => {
    // 위 "supplied 로 선언된..." 검사는 findFactSpec 으로 이름을 접두사
    // 스펙('skill.')으로 뭉갠다 — skill.ice 하나만 있어도 skill.* 전체가
    // 있다고 통과해 버린다. 실제로 buildFacts 를 "첫 번째 기술만 채운다"로
    // 바꿔도 드리프트 테스트 다섯 개가 전부 green 이었다(리뷰 finding 2) —
    // 그래서 접두사 뒤의 구체적인 이름까지 하나씩 확인하는 이 테스트가
    // 따로 필요하다.
    const facts = emptyPlayerFacts()
    for (const skill of SKILL_IDS) {
      expect([skill, Object.hasOwn(facts, `skill.${skill}`)]).toEqual([skill, true])
    }
  })

  it('이정표 전부의 milestone.* 사실을 만든다 — 같은 이유로 위 검사로는 못 잡는다', () => {
    const facts = emptyPlayerFacts()
    for (const milestone of data.milestones) {
      expect([milestone.id, Object.hasOwn(facts, `milestone.${milestone.id}`)]).toEqual([milestone.id, true])
    }
  })

  it('공급자가 넣는 값이 그 사실이 선언한 모양과 맞는다', () => {
    // 모양이 어긋난 사실은 조용히 만들어지고 그 뒤로 어떤 조건과도 맞지 않는다
    // (matchesCondition 은 타입이 다르면 그냥 거짓이다). 예: milestone.<id> 를
    // true/false 가 아니라 1/0 으로 넣는 경우.
    const facts = talkedBeforeFacts()
    for (const [name, value] of Object.entries(facts)) {
      const spec = findFactSpec(name)
      if (!spec) continue // 위 테스트가 잡는다
      expect([name, factValueFitsShape(spec.value, value)]).toEqual([name, true])
    }
  })

  it('공급자가 없는 사실은 만들지 않는다 — 없는 사실이라야 조건이 거짓이다', () => {
    const facts = talkedBeforeFacts()
    for (const spec of DECLARED_FACTS) {
      if (spec.supplied) continue
      const leaked = Object.keys(facts).filter((n) => (spec.prefix ? n.startsWith(spec.name) : n === spec.name))
      expect([spec.name, leaked]).toEqual([spec.name, []])
    }
  })
})
