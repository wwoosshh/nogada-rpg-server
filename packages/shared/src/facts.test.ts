import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { buildFacts } from './facts.js'
import type { MilestoneDef } from './milestones.js'
import { GAME_EPOCH_MS, REAL_MS_PER_GAME_DAY } from './time.js'
import type { PlayerState } from './types.js'

/**
 * `buildFacts` 자체의 계산 규칙을 직접 본다.
 *
 * packages/data/src/facts.test.ts 는 "선언(DECLARED_FACTS)과 공급자가 어긋나지
 * 않는가"만 본다 — 이름과 값의 모양이 대상이고, 계산이 실제로 맞는지는 보지
 * 않는다. talkService.test.ts(apps/server)는 buildFacts 를 실제로 부르긴 하지만
 * performTalk 전체를 통해 간접적으로만 지나간다. 마이그레이션 전 세이브처럼
 * "합성 PlayerState 를 손으로 빚어야 재현되는" 시나리오는 이 파일이 직접 다룬다.
 */

const SPEAKER = '노인'
const NOW = GAME_EPOCH_MS + 5 * REAL_MS_PER_GAME_DAY

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
    // 이 판정들은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
    ...overrides,
  }
}

const iceNovice: MilestoneDef = {
  id: 'ice_1000',
  metric: { kind: 'skill', skill: 'ice' },
  threshold: 1000,
  name: '얼음에 익숙해지다',
  announce: '얼음에 익숙해졌다',
  effect: { kind: 'title' },
}

const woodNovice: MilestoneDef = {
  id: 'wood_1000',
  metric: { kind: 'skill', skill: 'wood' },
  threshold: 1000,
  name: '나무에 익숙해지다',
  announce: '나무에 익숙해졌다',
  effect: { kind: 'title' },
}

describe('buildFacts', () => {
  it('세계 시각을 gameTimeAt 그대로 싣는다', () => {
    const facts = buildFacts({ speaker: SPEAKER, player: player(), milestones: [], nowMs: NOW })
    expect(facts.season).toBe('spring')
    expect(facts.dayOfSeason).toBe(6) // 게임 5일 뒤 = 6일째
  })

  it('기술 숙련도를 player.skills 그대로 싣는다', () => {
    const facts = buildFacts({
      speaker: SPEAKER,
      player: player({ skills: { ice: 15000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }),
      milestones: [],
      nowMs: NOW,
    })
    expect(facts['skill.ice']).toBe(15000)
  })

  it('이정표 달성 여부를 achievedIds 와 같은 계산으로 싣는다', () => {
    const facts = buildFacts({
      speaker: SPEAKER,
      player: player({ skills: { ice: 1000, wood: 0, mineral: 0, herb: 0, crafting: 0 } }),
      milestones: [iceNovice],
      nowMs: NOW,
    })
    expect(facts['milestone.ice_1000']).toBe(true)
  })

  it('justAchieved 를 celebrated 의 마지막 원소에서 유도한다 — 새 상태를 만들지 않는다', () => {
    // celebrated 는 문턱을 넘은 그 순간 append 된다(gatherService·craftService).
    // 그래서 마지막 원소가 곧 "가장 최근에 넘긴 것"이고, 그 사실 하나로
    // justAchieved 를 만들 수 있다 — 대화 요청에 값을 따로 실어 보내는 경로도,
    // 저장·마이그레이션이 따라붙는 새 필드도 필요 없다.
    const facts = buildFacts({
      speaker: SPEAKER,
      player: player({ celebrated: ['wood_1000', 'ice_1000'] }),
      milestones: [woodNovice, iceNovice],
      nowMs: NOW,
    })
    expect(facts.justAchieved).toBe('ice_1000')
  })

  it('celebrated 끝의 id 가 지금 이정표 목록에 없으면 건너뛰고 그 앞의 실존 id 를 쓴다', () => {
    // celebrated 는 append-only 라 milestones.csv 에서 이정표를 지운 뒤에도 그
    // id 가 배열 끝에 그대로 남을 수 있다. 마지막 원소만 보면 지워진 이정표를
    // 영원히 다시 보고하게 된다 — newlyAchieved 가 반대 방향(축하 이력엔 있지만
    // 지금 데이터엔 없는 id 를 무시)으로 이미 세운 원칙, "이정표를 지운 뒤에도
    // 옛 세이브가 그대로 살아 있어야 한다"를 여기서도 지켜야 한다.
    const facts = buildFacts({
      speaker: SPEAKER,
      player: player({ celebrated: ['ice_1000', '존재하지않는이정표'] }),
      milestones: [iceNovice],
      nowMs: NOW,
    })
    expect(facts.justAchieved).toBe('ice_1000')
  })

  it('celebrated 전체가 지금 이정표 목록에 없으면 justAchieved 사실 자체가 없다', () => {
    // 걸러내고 나면 남는 것이 없는 경계 — undefined 로 조용히 떨어져야지 예외를
    // 던지거나 지워진 id 를 그대로 흘리면 안 된다.
    const facts = buildFacts({
      speaker: SPEAKER,
      player: player({ celebrated: ['사라진1', '사라진2'] }),
      milestones: [iceNovice],
      nowMs: NOW,
    })
    expect(Object.hasOwn(facts, 'justAchieved')).toBe(false)
  })

  it('넘긴 것이 없으면 justAchieved 사실 자체가 없다', () => {
    // 없으면 undefined 가 아니라 키 자체가 없어야 한다 — matchesCondition 은
    // "없는 사실"만 항상 거짓으로 보고, undefined 값이 있는 키는 다루지 않는다.
    const facts = buildFacts({ speaker: SPEAKER, player: player(), milestones: [], nowMs: NOW })
    expect(Object.hasOwn(facts, 'justAchieved')).toBe(false)
  })

  it('한 번 넘긴 justAchieved 는 그 뒤로도 계속 켜져 있다 — 듣기 전에 꺼지면 안 되기 때문이다', () => {
    // 문턱을 넘은 그 한 순간만 켜 두면, 채집장에서 문턱을 넘고 마을까지 걸어가는
    // 사이에 그 말이 사라진다 — 진행도가 사건을 연다는 이 게임의 약속이 조용히
    // 깨지는 자리다. 계속 켜 두어도 @milestone 은 once 사건이라(ONCE_EVENTS)
    // 한 번 나온 규칙은 dialogueHistory.said 가 막는다: "계속 켜져 있다"는
    // "영원히 반복한다"가 아니라 "다음에 말을 걸 때 반드시 한 번은 듣는다"다.
    const veteran = player({
      celebrated: ['ice_1000'],
      skills: { ice: 900_000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    })
    const facts = buildFacts({ speaker: SPEAKER, player: veteran, milestones: [iceNovice], nowMs: NOW })
    expect(facts.justAchieved).toBe('ice_1000')
  })

  it('한 번도 말한 적 없으면 talkedBefore 는 false 고 daysSinceLastTalk 는 없다', () => {
    const facts = buildFacts({ speaker: SPEAKER, player: player(), milestones: [], nowMs: NOW })
    expect(facts.talkedBefore).toBe(false)
    expect(Object.hasOwn(facts, 'daysSinceLastTalk')).toBe(false)
  })

  it('lastTalkAt 이 있으면 talkedBefore 는 true 고 daysSinceLastTalk 를 gameDaysBetween 으로 잰다', () => {
    const threeDaysAgo = NOW - 3 * REAL_MS_PER_GAME_DAY
    const p = player()
    p.dialogueHistory.lastTalkAt[SPEAKER] = threeDaysAgo
    const facts = buildFacts({ speaker: SPEAKER, player: p, milestones: [], nowMs: NOW })
    expect(facts.talkedBefore).toBe(true)
    expect(facts.daysSinceLastTalk).toBe(3)
  })

  it('recent 에는 있지만 lastTalkAt 이 비어 있어도(마이그레이션 전 세이브) talkedBefore 는 true 다', () => {
    // lastTalkAt 은 이 태스크에서 새로 생긴 필드다. 그 전 세이브는 recent 는
    // 채워져 있는데 lastTalkAt 은 없다 — 세이브 스키마의 lastTalkAt.default({})
    // 가 빈 객체로 채운다(protocol.ts DialogueHistorySchema). lastTalkAt 만 보고
    // talkedBefore 를 정하면, 실제로 말해 본 상대(recent 가 이미 증명한다)에게
    // 초면 인사가 나간다 — recent 와 lastTalkAt 은 어긋날 수 없게 한 저장소에
    // 같이 두었다는 설계(dialogue.ts 의 DialogueHistory 문서)가 이 지점에서
    // 깨지는 것을 막는다.
    const p = player()
    p.dialogueHistory.recent[SPEAKER] = ['어떤규칙아이디']
    // lastTalkAt 은 일부러 비워 둔다 — 마이그레이션 전 세이브를 흉내낸다.
    const facts = buildFacts({ speaker: SPEAKER, player: p, milestones: [], nowMs: NOW })
    expect(facts.talkedBefore).toBe(true)
    // 시각 자체는 여전히 모른다 — recent 에는 시각이 없으므로 daysSinceLastTalk 를
    // 지어내지 않는다. 0 을 넣으면 "방금 말했다"가 되어 모른다고 하는 것보다 나쁘다.
    expect(Object.hasOwn(facts, 'daysSinceLastTalk')).toBe(false)
  })

  it('다른 화자의 recent·lastTalkAt 은 이 화자의 talkedBefore 에 영향을 주지 않는다', () => {
    const p = player()
    p.dialogueHistory.recent['다른화자'] = ['다른규칙']
    p.dialogueHistory.lastTalkAt['다른화자'] = NOW
    const facts = buildFacts({ speaker: SPEAKER, player: p, milestones: [], nowMs: NOW })
    expect(facts.talkedBefore).toBe(false)
  })
})
