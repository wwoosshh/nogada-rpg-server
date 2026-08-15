import { describe, expect, it } from 'vitest'
import type { GameData, PlaceDef, ScheduleDef, SpeakerDef } from '@nogada/shared'
import {
  collectScheduleNotices,
  formatMinute,
  parseSchedule,
  parseScheduleFiles,
  validateSchedules,
} from './schedule.js'

function place(id: string, mapId = '눈의마을'): PlaceDef {
  return { id, mapId, x: 1, y: 1, indoor: false, facing: null }
}

function speaker(id: string): SpeakerDef {
  return { id, name: id, kind: 'npc', mapId: '눈의마을', x: 1, y: 1, sprite: 'npc', facing: 'down' }
}

/** 일과 검사에 필요한 칸만 채운 GameData. 나머지는 이 검사가 보지 않는다. */
function dataOf(
  schedules: Record<string, ScheduleDef>,
  places: Record<string, PlaceDef>,
  speakers: Record<string, SpeakerDef>,
): GameData {
  return {
    monsters: {}, monsterPlacements: {},
    items: {}, nodes: {}, recipes: {}, maps: {}, transitions: [], placements: {},
    shops: {}, masters: [], enhanceCosts: [], collection: {},
    milestones: [], dialogue: [], routes: [],
    speakers, places, schedules,
  }
}

describe('parseSchedule', () => {
  // 왜: 한 줄이 "그 시각에 그 지점에 도착해 있다" 이다. 작가가 "22:00 여관안" 을
  //     읽고 "22시엔 여관에 있다"로 이해하는 것이 맞다 — 출발 의미론이면 지금
  //     어디 있는지 알려고 다음 줄을 읽어야 한다.
  it('시각과 지점을 읽는다 — 주석과 빈 줄은 넘긴다', () => {
    const sched = parseSchedule(
      ['# 여관을 지키다 낮에 광장에 다녀온다', '', '06:00 여관앞', '09:00 눈광장'].join('\n'),
      '여관안주인.sched',
    )
    expect(sched).toEqual({
      speakerId: '여관안주인',
      entries: [
        { arriveMinute: 360, placeIds: ['여관앞'] },
        { arriveMinute: 540, placeIds: ['눈광장'] },
      ],
    })
  })

  // 왜: 변주가 없으면 NPC 는 매일 똑같은 하루를 산다. 후보를 전부 남겨 두어야
  //     빌드가 어느 날 어느 후보가 뽑혀도 닿는지 확인할 수 있다.
  it('A | B 변주를 후보 배열로 남긴다', () => {
    const sched = parseSchedule('15:00 눈광장 | 여관앞', '여관안주인.sched')
    expect(sched.entries[0]?.placeIds).toEqual(['눈광장', '여관앞'])
  })

  // 왜: 한 줄짜리 일과는 "하루 종일 그 지점" 이다 — 합법이고, 채집장 노인처럼
  //     자리를 지키는 NPC 가 정확히 그 모양이다.
  it('한 줄짜리 일과도 합법이다', () => {
    expect(parseSchedule('06:00 초소', '채집장노인.sched').entries).toHaveLength(1)
  })

  // 왜: 파일 이름이 곧 화자다(.dlg 와 같은 규칙). 화자를 파일 안에 또 적게 하면
  //     둘이 갈라진다.
  it('화자 id 는 파일 이름에서 온다', () => {
    expect(parseSchedule('06:00 초소', 'schedules/채집장노인.sched').speakerId).toBe('채집장노인')
  })

  // 왜: 25시는 없다. 그대로 통과시키면 하루를 넘는 시각이 되어 그 줄이 영영
  //     활성이 되지 않는다 — 작가는 "왜 저 NPC 는 저기 안 가지"만 남는다.
  it('25:00 같은 시각을 어느 줄인지와 함께 거절한다', () => {
    expect(() => parseSchedule('25:00 여관앞', 'x.sched')).toThrow(/x\.sched:1행/)
    expect(() => parseSchedule('25:00 여관앞', 'x.sched')).toThrow(/00:00.*23:59/)
  })

  it('시각 꼴이 아닌 줄을 거절한다', () => {
    expect(() => parseSchedule('아침 여관앞', 'x.sched')).toThrow(/HH:MM/)
  })

  // 왜: 같은 시각이 두 번이면 뒤엣것이 앞엣것을 조용히 죽인다 — 도착 시각이
  //     같은 두 줄은 어느 쪽이 이길지 정할 근거가 없다.
  it('같은 시각이 두 번 나오면 막는다', () => {
    expect(() => parseSchedule('06:00 여관앞\n06:00 눈광장', 'x.sched')).toThrow(/x\.sched:2행/)
    expect(() => parseSchedule('06:00 여관앞\n06:00 눈광장', 'x.sched')).toThrow(/06:00/)
  })

  // 왜: 일과는 하루 순서대로 읽는다. 역행한 줄은 자정을 넘긴 것으로 오해되기
  //     쉬운데, 되감기는 마지막 줄→첫 줄 하나뿐이다.
  it('시각이 앞 줄보다 이르면 막는다', () => {
    expect(() => parseSchedule('09:00 눈광장\n06:00 여관앞', 'x.sched')).toThrow(/09:00/)
  })

  // 왜: 빈 일과는 "어디에도 없는 NPC" 다. npcStateAt 이 답할 수 없는 유일한
  //     입력이라(설계 §4), 함수가 아니라 빌드가 막는다.
  it('한 줄도 없는 파일을 막는다', () => {
    expect(() => parseSchedule('# 아직 안 정했다\n\n', 'x.sched')).toThrow(/한 줄/)
  })

  it('지점 없이 시각만 있는 줄을 막는다', () => {
    expect(() => parseSchedule('06:00', 'x.sched')).toThrow(/지점/)
  })

  it('변주 후보가 비어 있는 줄을 막는다', () => {
    expect(() => parseSchedule('06:00 여관앞 |', 'x.sched')).toThrow(/\|/)
  })

  // 왜: 지점 이름에 공백이 들어갈 수 있다(여관 앞). 첫 공백에서만 자르고
  //     나머지는 그대로 이름으로 본다.
  it('지점 이름의 공백을 이름의 일부로 남긴다', () => {
    expect(parseSchedule('06:00 여관 앞', 'x.sched').entries[0]?.placeIds).toEqual(['여관 앞'])
  })
})

describe('parseScheduleFiles', () => {
  // 왜: 깨진 파일 하나 때문에 나머지 일과가 보고되지 않으면, 작가는 한 번에
  //     하나씩만 고치며 빌드를 반복하게 된다(parseDialogueFiles 와 같은 저울).
  it('깨진 파일은 오류로 모으고 나머지는 살린다', () => {
    const { schedules, errors } = parseScheduleFiles([
      { file: '가.sched', text: '06:00 초소' },
      { file: '나.sched', text: '25:00 초소' },
    ])
    expect(Object.keys(schedules)).toEqual(['가'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/나\.sched/)
  })
})

describe('validateSchedules', () => {
  it('있는 화자와 있는 지점만 가리키면 위반이 없다', () => {
    const data = dataOf(
      { 노인: { speakerId: '노인', entries: [{ arriveMinute: 360, placeIds: ['초소'] }] } },
      { 초소: place('초소') },
      { 노인: speaker('노인') },
    )
    expect(validateSchedules(data)).toEqual([])
  })

  // 왜: 지점 이름 오타는 조용히 "그 줄이 영영 안 일어남" 이 된다 — 대사의
  //     사실 이름 오타와 같은 부류이고, 같은 이유로 빌드가 막는다.
  it('없는 지점을 가리키면 어느 줄인지와 함께 막는다', () => {
    const data = dataOf(
      { 노인: { speakerId: '노인', entries: [{ arriveMinute: 720, placeIds: ['없는곳'] }] } },
      { 초소: place('초소') },
      { 노인: speaker('노인') },
    )
    const violations = validateSchedules(data)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/12:00/)
    expect(violations[0]).toMatch(/없는곳/)
  })

  // 왜: 일과 파일 이름이 화자 id 다. 오타가 나면 그 파일은 아무에게도 붙지
  //     않은 채 조용히 무시된다.
  it('화자 정의가 없는 일과 파일을 막는다', () => {
    const data = dataOf(
      { 유령: { speakerId: '유령', entries: [{ arriveMinute: 360, placeIds: ['초소'] }] } },
      { 초소: place('초소') },
      {},
    )
    expect(validateSchedules(data)[0]).toMatch(/speakers\.csv/)
  })
})

describe('collectScheduleNotices', () => {
  // 왜: 겹쳐 서기는 의도일 수 있다(둘이 마주 보고 이야기하는 그림). 막지 않고
  //     알리기만 한다 — 작가에게 오탐 하나는 그것이 막아 준 진짜 오류보다 비싸다.
  it('같은 시각 같은 지점에 두 NPC 가 서면 알린다', () => {
    const data = dataOf(
      {
        갑: { speakerId: '갑', entries: [{ arriveMinute: 540, placeIds: ['광장'] }] },
        을: { speakerId: '을', entries: [{ arriveMinute: 540, placeIds: ['광장', '초소'] }] },
      },
      { 광장: place('광장'), 초소: place('초소') },
      { 갑: speaker('갑'), 을: speaker('을') },
    )
    const notices = collectScheduleNotices(data)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatch(/09:00/)
    expect(notices[0]).toMatch(/광장/)
  })

  it('시각이 다르면 아무 말도 하지 않는다', () => {
    const data = dataOf(
      {
        갑: { speakerId: '갑', entries: [{ arriveMinute: 540, placeIds: ['광장'] }] },
        을: { speakerId: '을', entries: [{ arriveMinute: 600, placeIds: ['광장'] }] },
      },
      { 광장: place('광장') },
      { 갑: speaker('갑'), 을: speaker('을') },
    )
    expect(collectScheduleNotices(data)).toEqual([])
  })
})

describe('formatMinute', () => {
  // 왜: 검증 메시지는 작가가 파일에 쓴 글자 그대로 시각을 말해야 한다 —
  //     "540분" 이라고 하면 작가가 그 줄을 눈으로 찾을 수 없다.
  it('작가가 파일에 쓴 꼴 그대로 돌려준다', () => {
    expect(formatMinute(0)).toBe('00:00')
    expect(formatMinute(540)).toBe('09:00')
    expect(formatMinute(1439)).toBe('23:59')
  })
})
