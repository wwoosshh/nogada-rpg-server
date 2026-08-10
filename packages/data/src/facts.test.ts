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
 * speaker·player·milestones·nowMs 넷에, 일과가 있는 화자일 때만 붙는 place 다).
 *
 * "선언된 사실을 공급자가 실제로 만드는가"를 반드시 이 모양으로만 물어야
 * 하는 이유가 리뷰 finding 1 이 지적한 결함 그 자체다: 예전 버전은 이 자리에서
 * `justAchieved` 인자를 손으로 하나 더 얹어 buildFacts 를 불렀다. 그러면 그
 * 인자를 넘기는 프로덕션 호출이 하나도 없어도 이 파일의 검사는 "만든다"고
 * 우겼다 — justAchieved 는 몇 달이고 supplied: true 로 선언된 채 아무도 채울
 * 수 없는 사실로 남아 있었다.
 *
 * 지금은 그 구멍이 관례가 아니라 타입으로 막혀 있다. FactSources 에 있는 것은
 * 저 넷과 place 뿐이고(justAchieved 는 인자가 아니라 player.celebrated 에서
 * 유도된다) — 그래서 이 헬퍼가 프로덕션과 다른 모양으로 부르려 해도 컴파일이
 * 먼저 막는다. 사실 하나가 공급자를 얻을 때 인자를 늘리는 대신 상태에서
 * 유도하기를 택하면, 이 검사가 우회 불가능해진다는 것이 그 선택의 부수적인
 * 이득이다.
 *
 * `place` 는 인자로 남을 수밖에 없는 쪽이다 — 그 값은 플레이어 상태가 아니라
 * 세계 데이터(일과·지점·구운 경로)와 시각에서 나오고, 그 계산은 서버가 같은
 * 요청 안에서 이미 한다(npcStateAt). 그래서 여기서 place 를 손으로 넣는 것은
 * 위 finding 1 이 지적한 그 구멍처럼 보이지만 다르다: 그때는 **아무 프로덕션
 * 호출도 그 인자를 넘기지 않았고**, 지금은 talkService 가 넘긴다. 그 절반
 * (서버가 실제로 이 자리를 채우는가)은 talkService.test.ts 의
 * "지점 대사" 검사가 지킨다 — talkedBeforeFacts 와 같은 분업이다.
 */
function productionFacts(player: PlayerState, nowMs: number = NOW, place?: string): Facts {
  return buildFacts({ speaker: SPEAKER, player, milestones: data.milestones, nowMs, place })
}

function emptyPlayerFacts(): Facts {
  return productionFacts(emptyPlayer())
}

/**
 * SPEAKER 와 이미 말해 본 적 있는 플레이어 — daysSinceLastTalk 가 나오는
 * 유일한 조건이다(빈 플레이어에게는 매길 값이 없다).
 *
 * 여기서 lastTalkAt 을 손으로 채우는 것은 "이런 상태가 실제로 생길 수 있다"를
 * 주장하지 않는다 — 이 파일이 지키는 것은 "상태 S 를 주면 공급자가 X 를
 * 만든다"이지 "S 에 도달할 수 있다"가 아니다. 그 나머지 절반(실제로 서버가
 * 이 자리를 채우는가)은 apps/server/src/services/talkService.test.ts 의
 * "대화 시각을 화자별로 기록한다"가 지킨다. 두 파일 중 하나만 있으면 사슬이
 * 끊기므로, 고치는 사람이 다른 쪽을 찾아갈 수 있게 여기 적어 둔다.
 */
function talkedBeforeFacts(): Facts {
  const player = emptyPlayer()
  player.dialogueHistory.lastTalkAt[SPEAKER] = NOW - 3 * 60 * 60 * 1000
  return productionFacts(player)
}

/**
 * 방금 문턱을 넘긴 플레이어 — justAchieved 가 나오는 유일한 조건이다(아직
 * 아무것도 못 넘긴 빈 플레이어에게는 가리킬 이정표가 없다).
 *
 * 이정표 id 를 리터럴로 적지 않고 실제 데이터에서 꺼낸다 — CSV 에서 그 id 가
 * 사라지면 이 픽스처가 "그런 이정표를 넘겼다"고 우기는 대신 여기서 먼저 깨져야
 * 한다.
 *
 * 위 talkedBeforeFacts 와 같은 분업이다: celebrated 에 값이 들어가는 경로가
 * 실재하는지는 apps/server/src/services/gatherService.test.ts·craftService.test.ts
 * 의 "그 이정표 id 가 outcome.player.celebrated 에 들어간다" 가 지킨다.
 */
function justAchievedFacts(): Facts {
  const player = emptyPlayer()
  const milestone = data.milestones[0]
  if (!milestone) throw new Error('이정표가 하나도 없다 — 위 전제 테스트가 먼저 실패해야 한다')
  player.celebrated = [milestone.id]
  return productionFacts(player)
}

/**
 * 일과가 있는 화자가 지점에 서 있을 때 — place 가 나오는 유일한 조건이다.
 * 일과 없는 화자(간판)에게 말을 걸면 서버가 이 인자를 아예 넘기지 않는다.
 *
 * 지점 id 를 리터럴로 적지 않고 SPEAKER 의 일과에서 꺼낸다 — 그 지점 이름이
 * 맵에서 사라지면 이 픽스처가 "그 자리에 서 있다"고 우기는 대신 여기서 먼저
 * 깨져야 한다(justAchievedFacts 와 같은 이유).
 */
function standingAtPlaceFacts(): Facts {
  const placeId = data.schedules[SPEAKER]?.entries[0]?.placeIds[0]
  if (!placeId) throw new Error(`${SPEAKER} 에게 일과가 없다 — 이 화자를 고른 전제가 깨졌다`)
  return productionFacts(emptyPlayer(), NOW, placeId)
}

/** 드리프트 검사가 보는 상태 전부. 사실 하나가 특정 상태에서만 나오면 그 상태를 여기 더한다. */
function allProductionFacts(): Facts[] {
  return [emptyPlayerFacts(), talkedBeforeFacts(), justAchievedFacts(), standingAtPlaceFacts()]
}

describe('사실 공급자와 선언 목록', () => {
  it('전제: 검사가 비어 돌지 않도록 기술과 이정표가 실제로 있다', () => {
    // 이 둘이 비면 skill.*·milestone.* 는 키 하나 없이도 아래 검사를 통과한다.
    expect(SKILL_IDS.length).toBeGreaterThan(0)
    expect(data.milestones.length).toBeGreaterThan(0)
  })

  it('공급자가 만드는 모든 사실이 supplied 로 선언돼 있다', () => {
    for (const facts of allProductionFacts()) {
      for (const name of Object.keys(facts)) {
        const spec = findFactSpec(name)
        // 이름을 함께 단정해야 어느 사실이 어긋났는지가 실패 메시지에 남는다.
        expect([name, spec?.supplied]).toEqual([name, true])
      }
    }
  })

  it('supplied 로 선언된 모든 사실을 공급자가 만든다', () => {
    const produced = new Set(
      allProductionFacts().flatMap((facts) => Object.keys(facts).map((name) => findFactSpec(name)?.name)),
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
    for (const facts of allProductionFacts()) {
      for (const [name, value] of Object.entries(facts)) {
        const spec = findFactSpec(name)
        if (!spec) continue // 위 테스트가 잡는다
        expect([name, factValueFitsShape(spec.value, value)]).toEqual([name, true])
      }
    }
  })

  it('공급자가 없는 사실은 만들지 않는다 — 없는 사실이라야 조건이 거짓이다', () => {
    for (const facts of allProductionFacts()) {
      for (const spec of DECLARED_FACTS) {
        if (spec.supplied) continue
        const leaked = Object.keys(facts).filter((n) => (spec.prefix ? n.startsWith(spec.name) : n === spec.name))
        expect([spec.name, leaked]).toEqual([spec.name, []])
      }
    }
  })
})
