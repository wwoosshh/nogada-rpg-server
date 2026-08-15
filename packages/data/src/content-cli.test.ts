import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  createRng,
  emptyDialogueHistory,
  gameTimeAt,
  selectDialogue,
  type DialogueRule,
  type GameData,
  type SpeakerDef,
} from '@nogada/shared'
import { collectDialogueNotices, validateGameData } from './validate.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'
import {
  parseArgs,
  parseFactOverrides,
  runDeadCommand,
  runDialogueCommand,
  runFactsCommand,
  runGatherCommand,
  runWaitingCommand,
} from './content-cli.js'

// 고정 시각 — season/hour/dayOfSeason 기본값이 "언제 테스트를 돌렸는지"에 따라
// 달라지면 이 파일의 단언이 날짜가 바뀔 때마다 깨진다.
const FIXED_NOW = Date.UTC(2026, 2, 1, 12, 0, 0)

function emptyGameData(): GameData {
  return {
    inns: {}, monsters: {}, monsterPlacements: {},
    items: {}, nodes: {}, recipes: {},
    // 화자 픽스처(testSpeaker)가 world 에 서 있다 — 등록부가 비어 있으면 "없는
    // 맵에 놓였다" 위반이 하나 더 섞여, 이 파일이 보려는 대사 위반이 흐려진다.
    maps: { world: { id: 'world', name: '얼음 채집장', file: 'world.tmx', width: 30, height: 30, spawn: { x: 1, y: 1 } } },
    transitions: [],
    placements: {}, milestones: [], speakers: {}, dialogue: [],
    shops: {}, masters: [], enhanceCosts: [], collection: {},
    places: {}, schedules: {}, routes: [],
  }
}

/** validate.test.ts 의 dRule 과 같은 모양 — 조건·사건만 바꿔 규칙을 짧게 만든다. */
function dRule(overrides: Partial<DialogueRule> & Pick<DialogueRule, 'id' | 'event' | 'conditions'>): DialogueRule {
  return {
    speaker: '노인',
    lines: [`(${overrides.id})`],
    source: { file: '노인.dlg', line: 1 },
    ...overrides,
  }
}

const testSpeaker: SpeakerDef = { id: '노인', name: '노인', kind: 'npc', mapId: 'world', x: 0, y: 0, sprite: 'x', facing: 'down' }

// 명령줄 인자 검사는 이정표·기술 id 가 실재하는지까지 본다(빌드와 같은 검사) —
// 그래서 그 목록을 가진 실제 데이터가 필요하다.
const realData = loadGameData()

// ---- 사건 서열이 있는 화자 하나로 다섯 종류의 상황(story 없음, quest, milestone,
// greet 구체적, greet 동점)을 전부 만들어 두고 아래 describe 들이 나눠 쓴다.
const questRule = dRule({ id: 'q', event: 'quest', conditions: [{ fact: 'quest.q', op: '=', value: 1 }] })
const milestoneRule = dRule({
  id: 'm',
  event: 'milestone',
  conditions: [{ fact: 'justAchieved', op: '=', value: 'm1' }],
})
const rainClose = dRule({
  id: 'rainClose',
  event: 'greet',
  conditions: [
    { fact: 'weather', op: '=', value: 'rain' },
    { fact: 'affinity', op: '>=', value: 30 },
  ],
})
const rain = dRule({ id: 'rain', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'rain' }] })
const bare1 = dRule({ id: 'bare1', event: 'greet', conditions: [] })
const bare2 = dRule({ id: 'bare2', event: 'greet', conditions: [] })

function fixtureData(): GameData {
  return {
    ...emptyGameData(),
    speakers: { 노인: testSpeaker },
    dialogue: [questRule, milestoneRule, rainClose, rain, bare1, bare2],
  }
}

describe('parseArgs', () => {
  it('facts·dead·waiting 은 인자 없이 그 명령으로 해석된다', () => {
    expect(parseArgs(['facts'], realData)).toEqual({ kind: 'facts' })
    expect(parseArgs(['dead'], realData)).toEqual({ kind: 'dead' })
    expect(parseArgs(['waiting'], realData)).toEqual({ kind: 'waiting' })
  })

  it('dialogue 는 화자 id 와 --사실=값 여러 개를 함께 받는다', () => {
    const cmd = parseArgs(['dialogue', '채집장노인', '--skill.ice=15000', '--justAchieved=ice_10000'], realData)
    expect(cmd).toEqual({
      kind: 'dialogue',
      speaker: '채집장노인',
      overrides: { 'skill.ice': 15000, justAchieved: 'ice_10000' },
    })
  })

  it('알 수 없는 명령을 거부하고 쓸 수 있는 다섯 명령을 안내한다', () => {
    expect(() => parseArgs(['nope'], realData)).toThrow(/dialogue, facts, dead, waiting, gather/)
  })

  it('gather 는 표 id 와 --prof 를 받고, --tool·--n 은 기본값이 있다', () => {
    expect(parseArgs(['gather', 'ice', '--prof=15000'], realData)).toEqual({
      kind: 'gather', tableId: 'ice', proficiency: 15000, toolId: undefined, tokenEffect: undefined, n: 100_000,
    })
    expect(parseArgs(['gather', 'ice', '--prof=0', '--tool=iron_chisel', '--n=1000'], realData)).toEqual({
      kind: 'gather', tableId: 'ice', proficiency: 0, toolId: 'iron_chisel', tokenEffect: undefined, n: 1000,
    })
  })

  it('gather 인데 표 id 가 없으면 거부한다', () => {
    expect(() => parseArgs(['gather'], realData)).toThrow(/표 id/)
    expect(() => parseArgs(['gather', '--prof=0'], realData)).toThrow(/표 id/)
  })

  it('gather 인데 --prof 가 없으면 거부한다 — 분포는 숙련 브라켓의 함수라 기본값을 깔면 안 된다', () => {
    expect(() => parseArgs(['gather', 'ice'], realData)).toThrow(/--prof/)
  })

  it('gather 의 모르는 옵션과 정수 아닌 값을 거부한다', () => {
    expect(() => parseArgs(['gather', 'ice', '--prof=0', '--seed=3'], realData)).toThrow(/--seed/)
    expect(() => parseArgs(['gather', 'ice', '--prof=많이'], realData)).toThrow(/정수/)
  })

  it('gather 는 --token=speed|sight 를 받고 --tool 과 겹쳐 쓸 수 있다 — 증표는 도구와 별개의 축이다(설계 §5)', () => {
    expect(parseArgs(['gather', 'ice', '--prof=25000', '--token=sight'], realData)).toEqual({
      kind: 'gather', tableId: 'ice', proficiency: 25000, toolId: undefined, tokenEffect: 'sight', n: 100_000,
    })
    expect(parseArgs(['gather', 'ice', '--prof=25000', '--tool=iron_chisel', '--token=speed'], realData)).toEqual({
      kind: 'gather', tableId: 'ice', proficiency: 25000, toolId: 'iron_chisel', tokenEffect: 'speed', n: 100_000,
    })
  })

  it('없는 증표 효과는 거부하고 쓸 수 있는 효과를 말한다 — 아이템 id 를 넣어 보는 것이 첫 오해다', () => {
    expect(() => parseArgs(['gather', 'ice', '--prof=0', '--token=ice_speed_token'], realData)).toThrow(
      /speed, sight/,
    )
  })

  it('명령이 아예 없으면 거부한다', () => {
    expect(() => parseArgs([], realData)).toThrow()
  })

  it('dialogue 인데 화자 id 가 없으면 거부한다', () => {
    expect(() => parseArgs(['dialogue'], realData)).toThrow(/화자/)
  })

  it('facts·dead·waiting 뒤에 남는 인자가 있으면 거부한다 — 조용히 무시하면 오타를 못 알아챈다', () => {
    expect(() => parseArgs(['facts', '뭔가'], realData)).toThrow()
  })
})

describe('parseFactOverrides', () => {
  it('선언되지 않은 사실 이름을 거부한다', () => {
    expect(() => parseFactOverrides(['--affinty=30'], realData)).toThrow(/선언되지 않은 사실/)
  })

  it('speaker 를 사실처럼 주면 거부한다 — selectDialogue 는 speaker 를 별도 매개변수로 받는다', () => {
    expect(() => parseFactOverrides(['--speaker=채집장노인'], realData)).toThrow(/선언되지 않은 사실/)
  })

  it('-- 로 시작하지 않는 인자를 거부한다', () => {
    expect(() => parseFactOverrides(['skill.ice=100'], realData)).toThrow()
  })

  it('= 가 없는 인자를 거부한다', () => {
    expect(() => parseFactOverrides(['--weather'], realData)).toThrow()
  })

  it('제대로 준 값은 선언된 모양 그대로 통과한다', () => {
    const facts = parseFactOverrides(
      ['--skill.ice=15000', '--talkedBefore=true', '--season=spring', '--justAchieved=ice_10000'],
      realData,
    )
    expect(facts).toEqual({ 'skill.ice': 15000, talkedBefore: true, season: 'spring', justAchieved: 'ice_10000' })
  })

  it('공급자가 없어 값 모양이 아직 정해지지 않은 사실은 .dlg 와 같은 문법으로 읽는다', () => {
    expect(parseFactOverrides(['--weather=rain', '--affinity=40'], realData)).toEqual({
      weather: 'rain',
      affinity: 40,
    })
  })

  it('숫자를 받는 사실에 숫자가 아닌 값을 주면 거부한다 — 문자열로 만들어 주면 아무것도 안 맞는데 이유가 안 보인다', () => {
    expect(() => parseFactOverrides(['--hour=아침'], realData)).toThrow(/hour.*숫자여야 한다/)
  })

  it('정해진 목록이 있는 사실에는 목록 밖 값을 거부하고 그 목록을 보여준다', () => {
    expect(() => parseFactOverrides(['--season=3'], realData)).toThrow(/spring, summer, autumn, winter 중 하나/)
  })

  it('참거짓 사실에 1 을 주면 거부한다 — 숫자 1 은 true 와 절대 같지 않다', () => {
    expect(() => parseFactOverrides(['--milestone.ice_10000=1'], realData)).toThrow(/true 또는 false/)
  })

  it('값이 비어 있는 인자를 거부한다', () => {
    expect(() => parseFactOverrides(['--weather='], realData)).toThrow(/값이 없다/)
  })

  it('빌드가 조건에서 막는 기술·이정표 이름을 시뮬레이터도 똑같이 막는다 — 같은 코드를 나눠 쓴다', () => {
    // 도구가 빌드보다 무르면, 작가는 빌드가 절대 허락하지 않을 세계 상태로
    // 디버깅하면서 그 사실을 모른다.
    const data: GameData = {
      ...emptyGameData(),
      speakers: { 노인: testSpeaker },
      dialogue: [
        bare1,
        dRule({ id: 'ghostSkill', event: 'greet', conditions: [{ fact: 'skill.zzz', op: '>=', value: 10 }] }),
        dRule({
          id: 'ghostMilestone',
          event: 'greet',
          conditions: [{ fact: 'milestone.없는것', op: '=', value: true }],
        }),
      ],
    }
    const violations = validateGameData(data, {})
    expect(violations.some((v) => v.includes('존재하지 않는 기술 "zzz"'))).toBe(true)
    expect(violations.some((v) => v.includes('존재하지 않는 이정표 "없는것"'))).toBe(true)

    expect(() => parseFactOverrides(['--skill.zzz=3'], data)).toThrow(/존재하지 않는 기술 "zzz"/)
    expect(() => parseFactOverrides(['--milestone.없는것=true'], data)).toThrow(/존재하지 않는 이정표 "없는것"/)
  })

  it('거부할 때 무엇이 허용되는지와 어디를 보면 되는지를 함께 말한다', () => {
    expect(() => parseFactOverrides(['--skill.zzz=3'], realData)).toThrow(/ice, wood, mineral, herb, crafting/)
    expect(() => parseFactOverrides(['--milestone.없는것=true'], realData)).toThrow(/milestones\.csv/)
  })
})

describe('runDialogueCommand — 사건 서열', () => {
  it('아무 사실도 안 주면 상위 세 사건은 저마다의 이유로 비고 greet 무조건 규칙끼리 동점 처리된다', () => {
    const out = runDialogueCommand(fixtureData(), '노인', {}, { now: FIXED_NOW, seed: 1 })
    // 노인에게 story 규칙은 아예 없고, quest·milestone 은 규칙이 있는데 조건만
    // 안 맞았다 — 셋을 다 "규칙 없음"으로 적으면 정반대의 두 진단이 뭉개진다.
    expect(out).toMatch(/story\s+규칙 없음 — 이 화자는 story 규칙을 쓰지 않았다/)
    expect(out).toMatch(/quest\s+규칙 1개가 있지만 조건이 하나도 안 맞음/)
    expect(out).toMatch(/milestone\s+규칙 1개가 있지만 조건이 하나도 안 맞음/)
    expect(out).toMatch(/greet\s+← 채택 \(조건 맞는 규칙 2개\)/) // rain·rainClose 는 weather 없이 안 맞는다
    expect(out).toContain('동점 후보 2개 중 무작위')
    expect(out).toContain('무작위 추첨에서 안 뽑힘')
  })

  it('milestone 이 채택되면 그 규칙이 그대로 선택되고 이유가 "선택됨"으로 나온다', () => {
    const out = runDialogueCommand(fixtureData(), '노인', { justAchieved: 'm1' }, { now: FIXED_NOW, seed: 0 })
    expect(out).toMatch(/milestone\s+← 채택 \(조건 맞는 규칙 1개\)/)
    expect(out).toContain('✓')
    expect(out).toContain('선택됨 (조건 1)')
    expect(out).toContain('출력: "(m)"')
  })

  it('원인(b): quest 가 채택되면 그보다 아래인 greet 은 평가하지 않았다고 표시하고, 맞았을 후보 수를 알려준다', () => {
    const out = runDialogueCommand(fixtureData(), '노인', { 'quest.q': 1 }, { now: FIXED_NOW, seed: 0 })
    expect(out).toMatch(/quest\s+← 채택/)
    // bare1·bare2 는 조건이 없어 quest 와 무관하게 항상 맞지만, quest 가 상위라
    // selectDialogue 는 greet 을 아예 훑지 않는다 — 그 사실을 시뮬레이터가 따로
    // 확인해서 "평가 안 함" 으로 보여준다(원인 a·c 와 구분되는 원인 b).
    expect(out).toMatch(/greet\s+평가 안 함 — 조건 맞는 규칙 2개가 있었지만 quest 사건이 상위라 순서상 못 나옴/)
  })

  it('조건이 가장 많은 규칙이 유일하게 이기면 나머지는 "더 구체적인 규칙에 밀림"으로 표시된다', () => {
    const out = runDialogueCommand(
      fixtureData(),
      '노인',
      { weather: 'rain', affinity: 40 },
      { now: FIXED_NOW, seed: 0 },
    )
    expect(out).toContain('선택됨 (조건 2)')
    expect(out).toContain('조건 1개 — 더 구체적인 규칙(조건 2개)에 밀려 후보에서 빠짐')
    expect(out).toContain('조건 0개 — 더 구체적인 규칙(조건 2개)에 밀려 후보에서 빠짐')
  })

  it('같은 시드로 두 번 부르면 무작위 승자를 포함해 완전히 같은 결과를 낸다', () => {
    const out1 = runDialogueCommand(fixtureData(), '노인', {}, { now: FIXED_NOW, seed: 7 })
    const out2 = runDialogueCommand(fixtureData(), '노인', {}, { now: FIXED_NOW, seed: 7 })
    expect(out1).toBe(out2)
  })

  it('시드가 다르면 동점 승자가 달라질 수 있다 — 무작위가 진짜로 반영된다는 뜻이다', () => {
    const outs = new Set(
      [0, 1, 2, 3, 4, 5].map((seed) => runDialogueCommand(fixtureData(), '노인', {}, { now: FIXED_NOW, seed })),
    )
    expect(outs.size).toBeGreaterThan(1)
  })

  it('모르는 화자를 거부하고 아는 화자 목록을 보여준다', () => {
    expect(() => runDialogueCommand(fixtureData(), '없는사람', {}, { now: FIXED_NOW, seed: 0 })).toThrow(
      /화자 "없는사람" 를 모른다/,
    )
  })

  it('조건이 맞는 규칙이 하나도 없으면 침묵을 알린다', () => {
    const lonely: GameData = {
      ...emptyGameData(),
      speakers: { 외톨이: { ...testSpeaker, id: '외톨이' } },
      dialogue: [],
    }
    const out = runDialogueCommand(lonely, '외톨이', {}, { now: FIXED_NOW, seed: 0 })
    expect(out).toContain('말을 걸어도 지금은 할 말이 없다')
    // 마지막 줄만 보면 그 위의 사건 표가 깨져 있어도 이 테스트는 통과한다 —
    // 실제로 이 경로에서 표가 "undefined 사건이 상위라" 를 찍고 있었다.
    expect(out).not.toContain('undefined')
    expect(out).toMatch(/greet\s+규칙 없음 — 이 화자는 greet 규칙을 쓰지 않았다/)
  })

  it('발화가 여러 줄이면 번호를 매겨 순서대로 보여준다', () => {
    const multiline: GameData = {
      ...fixtureData(),
      dialogue: [{ ...milestoneRule, lines: ['첫 줄.', '둘째 줄.'] }],
    }
    const out = runDialogueCommand(multiline, '노인', { justAchieved: 'm1' }, { now: FIXED_NOW, seed: 0 })
    expect(out).toContain('출력 (2칸, 대사창이 순서대로 넘김):')
    expect(out).toContain('1. "첫 줄."')
    expect(out).toContain('2. "둘째 줄."')
  })

  it('기본값(지금 시각)과 명시적으로 준 사실을 요약해서 보여준다', () => {
    const out = runDialogueCommand(fixtureData(), '노인', { 'skill.ice': 15000 }, { now: FIXED_NOW, seed: 0 })
    const t = gameTimeAt(FIXED_NOW)
    expect(out).toContain(`season=${t.season}`)
    expect(out).toContain(`hour=${t.hour}`)
    expect(out).toContain('skill.ice=15000')
  })

  it('보고하는 승자는 selectDialogue 가 직접 고른 규칙과 항상 같다 — 시뮬레이터가 승자를 따로 정하지 않는다', () => {
    const facts = { weather: 'rain', affinity: 40 }
    const data = fixtureData()
    const direct = selectDialogue('노인', data.dialogue, facts, emptyDialogueHistory(), createRng(3))
    const out = runDialogueCommand(data, '노인', facts, { now: FIXED_NOW, seed: 3 })
    expect(direct?.rule.id).toBe('rainClose')
    expect(out).toContain(`출력: "(${direct?.rule.id})"`)
  })
})

// ---- 왜 안 나왔는가 — "규칙이 없다" 와 "규칙은 있는데 조건이 안 맞았다" 는
// 작가를 서로 다른 곳으로 보내는 정반대의 진단이다.
const storyTalked = dRule({
  id: 'storyTalked',
  event: 'story',
  conditions: [{ fact: 'talkedBefore', op: '=', value: true }],
  source: { file: '노인.dlg', line: 3 },
})
const rainOnly = dRule({
  id: 'rainOnly',
  event: 'greet',
  conditions: [{ fact: 'weather', op: '=', value: 'rain' }],
  source: { file: '노인.dlg', line: 9 },
})

function whyData(dialogue: DialogueRule[]): GameData {
  return { ...emptyGameData(), speakers: { 노인: testSpeaker }, dialogue }
}

describe('runDialogueCommand — 왜 안 나왔는가', () => {
  it('규칙이 아예 없는 사건과, 규칙은 있는데 조건이 안 맞은 사건을 다르게 말한다', () => {
    // 둘 다 "규칙 없음" 이라고 말하면 작가는 "story 대사를 쓴 적이 없다" 와
    // "써 둔 story 대사의 조건이 지금 안 맞는다" 를 구분할 수 없다 — 두 번째가
    // 이 도구가 존재하는 이유인 흔한 쪽이다.
    const out = runDialogueCommand(whyData([storyTalked, bare1]), '노인', {}, { now: FIXED_NOW, seed: 0 })
    expect(out).toMatch(/story\s+규칙 1개가 있지만 조건이 하나도 안 맞음/)
    expect(out).toMatch(/quest\s+규칙 없음 — 이 화자는 quest 규칙을 쓰지 않았다/)
  })

  it('조건이 안 맞은 규칙마다 어느 조건이 어긋났고 그 사실이 지금 무엇인지 짚어 준다', () => {
    const out = runDialogueCommand(whyData([storyTalked, bare1]), '노인', {}, { now: FIXED_NOW, seed: 0 })
    expect(out).toContain('노인.dlg:3행')
    expect(out).toContain('talkedBefore=true — 지금 talkedBefore=false 이다')
  })

  it('공급자가 없어 영원히 안 맞는 조건과, 이번에 값을 안 준 조건을 다르게 말한다', () => {
    // affinity 는 공급자가 없어 실제 게임에서도 안 맞는다(빌드의 "안내" 와 같은
    // 원인). daysSinceLastTalk 는 공급자가 있고 이번 시뮬레이션(빈 플레이어 —
    // 이 화자와 말해 본 적이 없다)에서는 매길 값이 없었을 뿐이라, 작가가 인자
    // 하나만 더 주면 바로 확인할 수 있다 — 서로 할 일이 다르다.
    //
    // 이 예시가 오래 weather 였다. 그 사실이 공급자를 얻으면서(설계 §6-앞 1~4)
    // 아래 justAchieved 검사와 같은 자리로 옮겨 갔고, "아직 공급자가 없다" 쪽의
    // 예시는 affinity 가 이어받았다.
    const waitingOnAffinity = dRule({
      id: 'close',
      event: 'greet',
      conditions: [{ fact: 'affinity', op: '>=', value: 30 }],
      source: { file: '노인.dlg', line: 9 },
    })
    const waitingOnLastTalk = dRule({
      id: 'ms',
      event: 'milestone',
      conditions: [{ fact: 'daysSinceLastTalk', op: '>=', value: 3 }],
    })
    const out = runDialogueCommand(
      whyData([waitingOnAffinity, waitingOnLastTalk, bare1]),
      '노인',
      {},
      { now: FIXED_NOW, seed: 0 },
    )
    expect(out).toContain('affinity>=30 — affinity 에 값이 없다. 이 사실을 채워 주는 곳이 아직 없다')
    expect(out).toContain('daysSinceLastTalk>=3 — daysSinceLastTalk 에 값이 없다. 이번에 주지 않았다')
  })

  it('출하 데이터의 weather 를 "이번에 안 줬다" 로 진단한다 — 공급자가 생겼기 때문이다', () => {
    // justAchieved 가 그랬듯(아래) weather 도 공급자를 얻었다. 그 전에는 이 줄이
    // "이 사실을 채워 주는 곳이 아직 없다" 였고, 그건 작가에게 "네가 할 수 있는
    // 일이 없다"는 뜻이었다. 이제는 `--weather=rain` 하나면 확인된다.
    const out = runDialogueCommand(realData, '채집장노인', {}, { now: FIXED_NOW, seed: 0 })
    expect(out).toContain('weather=rain — weather 에 값이 없다. 이번에 주지 않았다')
    expect(out).not.toContain('weather 에 값이 없다. 이 사실을 채워 주는 곳이 아직 없다')
  })

  it('--weather=rain 오버라이드로 잠들어 있던 비 오는 날 대사를 볼 수 있다', () => {
    const out = runDialogueCommand(realData, '채집장노인', { weather: 'rain' }, { now: FIXED_NOW, seed: 0 })
    expect(out).toContain('"이런 날엔 얼음이 잘 안 잡히지."')
  })

  it('출하 데이터의 justAchieved 를 "이번에 안 줬다" 로 진단한다 — 공급자가 생겼기 때문이다', () => {
    // 공급자가 생기기 전에는 이 줄이 "이 사실을 채워 주는 곳이 아직 없다" 였고,
    // 그건 작가에게 "네가 할 수 있는 일이 없다"는 뜻이었다. 이제는 인자 하나만
    // 더 주면 바로 확인할 수 있다는 뜻으로 바뀌어야 한다 — 같은 "값이 없다"가
    // 정반대의 할 일을 가리킨다.
    const out = runDialogueCommand(realData, '채집장노인', {}, { now: FIXED_NOW, seed: 0 })
    expect(out).toContain('justAchieved=ice_10000 — justAchieved 에 값이 없다. 이번에 주지 않았다')
    expect(out).not.toContain('justAchieved 에 값이 없다. 이 사실을 채워 주는 곳이 아직 없다')
  })

  it('--justAchieved 오버라이드로 문턱 대사를 미리 볼 수 있다 — 거기까지 플레이하지 않고도', () => {
    // 시뮬레이터가 존재하는 이유 그 자체다. 공급자가 생겼다고 이 경로가 막히면,
    // 작가는 얼음 10000 을 실제로 캐야만 자기가 쓴 대사를 볼 수 있게 된다.
    const out = runDialogueCommand(
      realData,
      '채집장노인',
      { justAchieved: 'ice_10000' },
      { now: FIXED_NOW, seed: 0 },
    )
    expect(out).toContain('"손이 익었군."')
    expect(out).toMatch(/milestone\s+← 채택/)
  })

  it('채택된 사건이 하나도 없어도 네 줄이 저마다 이유를 말한다 — undefined 가 새어 나오지 않는다', () => {
    // selection 이 null 이면 채택된 사건 자체가 없다. "X 사건이 상위라" 를 그대로
    // 찍으면 X 자리에 undefined 가 나오고, 아무것도 채택되지 않았다는 사실과도
    // 앞뒤가 맞지 않는다.
    const out = runDialogueCommand(whyData([rainOnly]), '노인', {}, { now: FIXED_NOW, seed: 0 })
    expect(out).not.toContain('undefined')
    expect(out).toMatch(/story\s+규칙 없음/)
    expect(out).toMatch(/greet\s+규칙 1개가 있지만 조건이 하나도 안 맞음/)
    expect(out).toContain('말을 걸어도 지금은 할 말이 없다')
    expect(out).toContain('weather=rain — weather 에 값이 없다')
  })
})

describe('runFactsCommand', () => {
  it('사실별로 그것을 쓰는 대사 줄 수를 센다', () => {
    const data: GameData = {
      ...emptyGameData(),
      dialogue: [
        dRule({ id: 'a', event: 'greet', conditions: [{ fact: 'weather', op: '=', value: 'rain' }], lines: ['한 줄'] }),
        dRule({
          id: 'b',
          event: 'greet',
          conditions: [{ fact: 'weather', op: '=', value: 'rain' }],
          lines: ['두', '줄'],
        }),
        dRule({ id: 'c', event: 'greet', conditions: [{ fact: 'skill.ice', op: '>=', value: 100 }], lines: ['한 줄'] }),
      ],
    }
    const out = runFactsCommand(data)
    expect(out).toContain('weather: 3줄')
    expect(out).toContain('skill.ice: 1줄')
  })

  it('한 규칙 안에서 같은 사실을 두 번 걸어도 그 규칙의 줄 수를 두 번 세지 않는다', () => {
    const data: GameData = {
      ...emptyGameData(),
      dialogue: [
        dRule({
          id: 'a',
          event: 'greet',
          conditions: [
            { fact: 'skill.ice', op: '>=', value: 100 },
            { fact: 'skill.ice', op: '<', value: 999 },
          ],
          lines: ['한 줄'],
        }),
      ],
    }
    expect(runFactsCommand(data)).toContain('skill.ice: 1줄')
  })

  it('아무도 안 쓴 고정 이름 사실도 0줄로 보여준다 — 완전한 목록이라야 "아직 아무도 안 썼다"를 알 수 있다', () => {
    expect(runFactsCommand(emptyGameData())).toContain('season: 0줄')
  })
})

describe('runDeadCommand', () => {
  it('정상 데이터는 죽은 대사가 없다고 말한다', () => {
    expect(runDeadCommand(emptyGameData())).toContain('죽은 대사 없음')
  })

  it('자기모순 규칙을 찾아 위치와 조건을 보여주고, validateGameData 와 정확히 같은 위반을 낸다', () => {
    const data: GameData = {
      ...emptyGameData(),
      speakers: { 노인: testSpeaker },
      dialogue: [
        dRule({ id: 'bare', event: 'greet', conditions: [] }), // @greet 무조건 규칙 검사를 피하려고 채워 둔다
        dRule({
          id: 'bad',
          event: 'greet',
          conditions: [
            { fact: 'skill.ice', op: '>=', value: 100 },
            { fact: 'skill.ice', op: '<', value: 50 },
          ],
          source: { file: '노인.dlg', line: 7 },
        }),
      ],
    }

    const out = runDeadCommand(data)
    expect(out).toContain('노인.dlg:7행')
    expect(out).toContain('"skill.ice>=100" 과 "skill.ice<50" 가 동시에 참일 수 없다')

    // dead 명령이 검증과 다른 계산을 하면 여기서 어긋난다 — 같은 데이터에 같은
    // 위반을 내야 "두 곳에 따로 구현하지 않는다"는 브리프의 요구가 지켜진다.
    const buildViolations = validateGameData(data, {}).filter((v) => v.includes('동시에 참일 수 없다'))
    expect(buildViolations).toEqual([
      'dialogue[노인] 노인.dlg:7행: 조건 "skill.ice>=100" 과 "skill.ice<50" 가 동시에 참일 수 없다 — 이 규칙은 어떤 상황에서도 나오지 않는다. 조건 하나를 지우거나 규칙을 둘로 나눈다',
    ])
  })

  it('실제로 출하되는 대사 데이터는 죽은 대사가 없다', () => {
    expect(runDeadCommand(loadGameData())).toContain('죽은 대사 없음')
  })
})

describe('runWaitingCommand', () => {
  it('공급자가 없는 사실을 쓴 대사를 collectDialogueNotices 와 같은 내용으로 보여준다', () => {
    const data: GameData = {
      ...emptyGameData(),
      dialogue: [
        dRule({ id: 'a', event: 'greet', conditions: [{ fact: 'affinity', op: '>=', value: 30 }], lines: ['한 줄'] }),
      ],
    }
    const notices = collectDialogueNotices(data)
    const out = runWaitingCommand(data)
    expect(notices.length).toBeGreaterThan(0)
    for (const notice of notices) expect(out).toContain(notice)
  })

  it('실제 출하 데이터에서 빌드의 안내와 정확히 같은 내용을 보여준다 — 지금은 둘 다 비었다', () => {
    // 오래 "대사 1줄이 weather 를 기다린다" 한 건이었다(채집장노인.dlg). 날씨
    // 가루가 그 사실의 공급자가 되면서 그 줄이 깨어났고, 기다리는 대사가 하나도
    // 남지 않았다.
    //
    // 그래서 이 검사는 "둘 다 비어서 공허하게 통과"할 수 없게 모양을 바꿨다:
    // 목록이 같은지(= 빌드의 안내와 도구의 출력이 같은 계산인지)를 보는 대신,
    // **비었을 때 도구가 무엇이라고 말하는지**까지 못박는다. 안내가 다시 생기면
    // 위 검사가 그 내용의 일치를 지킨다.
    const data = loadGameData()
    const notices = collectDialogueNotices(data)
    const out = runWaitingCommand(data)
    expect(notices).toEqual([])
    expect(out).toContain('없음')
  })

  it('기다리는 대사가 없으면 그렇다고 말한다', () => {
    expect(runWaitingCommand(emptyGameData())).toContain('없음')
  })
})

describe('runGatherCommand', () => {
  const realTables = loadGatherTables()
  const gatherCmd = (overrides: Partial<Parameters<typeof runGatherCommand>[2]> = {}) =>
    ({ kind: 'gather', tableId: 'ice', proficiency: 0, toolId: undefined, tokenEffect: undefined, n: 2000, ...overrides }) as const

  it('실제 표의 분포를 아이템 이름과 실패 줄로 보여준다', () => {
    const out = runGatherCommand(realData, realTables, gatherCmd(), { seed: 1 })
    // 숙련 0 얼음은 대부분 얼음 조각이다(§8-1) — 이름이 나와야 작가가 CSV 의
    // itemId 와 게임의 얼굴을 잇는다.
    expect(out).toContain('브라켓 ≤500')
    expect(out).toContain('얼음 조각')
    expect(out).toContain('실패')
    expect(out).toContain('숙련 증가: 시도마다 +1~2 (성패 무관)')
  })

  it('같은 시드로 두 번 부르면 완전히 같은 표가 나온다 — 실행마다 답이 바뀌는 도구는 신뢰할 수 없다', () => {
    const a = runGatherCommand(realData, realTables, gatherCmd(), { seed: 7 })
    const b = runGatherCommand(realData, realTables, gatherCmd(), { seed: 7 })
    expect(a).toBe(b)
  })

  it('--tool 을 안 주면 맨손으로 굴린다 — 도구 게이트가 없는 세계의 기준선이라 배수 ×1.45 까지 밝힌다(§6-앞 17)', () => {
    const out = runGatherCommand(realData, realTables, gatherCmd(), { seed: 1 })
    expect(out).toContain('맨손')
    expect(out).toContain('×1.45')
  })

  it('다른 기술의 도구를 거부하고 그 기술의 도구 목록을 보여준다 — 게임에 없는 세계를 시뮬하지 않는다', () => {
    expect(() =>
      runGatherCommand(realData, realTables, gatherCmd({ toolId: 'copper_pickaxe' }), { seed: 1 }),
    ).toThrow(/ice 기술의 도구가 아니다.*copper_chisel/)
  })

  it('모르는 표를 거부하고 있는 표를 나열한다 — 목록에 심층 넷과 특수도 있다', () => {
    // 심층 표가 목록에 뜨는 것은 사고가 아니라 요구다: 작가가 결계 뒤의 분포를
    // 시뮬레이터로 볼 수 없으면, 그 표를 눈으로 검산할 곳이 아예 없어진다
    // (확률표는 서버 전용이라 화면에도 안 나온다).
    expect(() => runGatherCommand(realData, realTables, gatherCmd({ tableId: 'fish' }), { seed: 1 })).toThrow(
      /표 "fish" 를 모른다.*herb, herb_deep, herb_special, ice, ice_deep, ice_special, mineral, mineral_deep, mineral_special, wood, wood_deep, wood_special/,
    )
  })

  it('2등급 도구는 잭팟 평감산까지 표기한다 — 작가가 곱 보정만 있다고 오해하면 안 된다', () => {
    const out = runGatherCommand(realData, realTables, gatherCmd({ toolId: 'iron_chisel' }), { seed: 1 })
    expect(out).toContain('×0.9')
    expect(out).toContain('−2')
  })

  it('--token=sight 는 그 계열 증표를 쥐여 roll 배수를 한 번 더 깎는다', () => {
    const out = runGatherCommand(realData, realTables, gatherCmd({ toolId: 'copper_chisel', tokenEffect: 'sight' }), { seed: 1 })
    // 구리(×1.0) × 선별(×0.95) = 0.95. 손 이름에 증표가 함께 찍혀야 작가가
    // 무엇을 쥔 손인지 되짚을 수 있다.
    expect(out).toContain('얼음 선별증표')
    expect(out).toContain('roll ×0.95')
  })

  it('--token=speed 는 분포를 건드리지 않고 간격만 줄인다 — 그래서 머리글이 간격을 함께 찍는다', () => {
    const 맨 = runGatherCommand(realData, realTables, gatherCmd({ toolId: 'copper_chisel' }), { seed: 1 })
    const 속도 = runGatherCommand(realData, realTables, gatherCmd({ toolId: 'copper_chisel', tokenEffect: 'speed' }), { seed: 1 })
    // 분포 줄(티어 표)은 글자 하나까지 같고, 다른 것은 머리글의 간격뿐이다.
    const 분포 = (out: string) => out.split('\n').slice(2).join('\n')
    expect(분포(속도)).toBe(분포(맨))
    expect(맨).toContain('간격 ×1 = 500ms')
    expect(속도).toContain('간격 ×0.9 = 450ms')
  })

  it('그 계열에 없는 증표는 거부한다 — 데이터에 없는 세계를 시뮬하지 않는다', () => {
    const 표없는계열 = { ...realTables, ice: { ...realTables['ice']!, skill: 'crafting' as const } }
    expect(() => runGatherCommand(realData, 표없는계열, gatherCmd({ tokenEffect: 'speed' }), { seed: 1 })).toThrow(
      /crafting 계열의 speed 증표가 items.csv 에 없다/,
    )
  })
})

describe('content 스크립트', () => {
  it('패키지 단위로 실행해도 데이터 빌드를 먼저 돌린다 — 스테일한 생성 JSON 을 읽으면 없는 대사를 보고한다', () => {
    // 루트의 `pnpm content` 만 data:build 를 엮어 두면, 한 겹 안쪽인
    // `pnpm --filter @nogada/data content` 로 부를 때 방금 고친 .dlg 가 아니라
    // 지난 빌드의 JSON 을 읽는다 — 도구가 자신 있게 틀린 답을 내는 유일한 경로다.
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    expect(pkg.scripts?.content).toMatch(/build/)
  })
})
