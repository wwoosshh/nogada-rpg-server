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
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: {},
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
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

  it('justAchieved 를 주면 그대로 싣고, 안 주면 사실 자체가 없다', () => {
    // 없으면 undefined 가 아니라 키 자체가 없어야 한다 — matchesCondition 은
    // "없는 사실"만 항상 거짓으로 보고, undefined 값이 있는 키는 다루지 않는다.
    const withArg = buildFacts({
      speaker: SPEAKER,
      player: player(),
      milestones: [],
      nowMs: NOW,
      justAchieved: 'ice_1000',
    })
    expect(withArg.justAchieved).toBe('ice_1000')

    const withoutArg = buildFacts({ speaker: SPEAKER, player: player(), milestones: [], nowMs: NOW })
    expect(Object.hasOwn(withoutArg, 'justAchieved')).toBe(false)
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
