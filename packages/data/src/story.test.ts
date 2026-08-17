import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type {
  GameData,
  GatherTableDef,
  MapDef,
  PlayerState,
  StoryStep,
  StoryStepDef,
} from '@nogada/shared'
import { fillArg, fillText } from '@nogada/shared'
import { emptyPlayer } from './emptyPlayer.js'
import { loadGameData } from './load.js'
import { loadGatherTables } from './loadGatherTables.js'
import { startVillages, villageField, WORLD_MAP_ID } from './maps.js'
import { parseCsv } from './parse.js'
import {
  parseStory,
  pinStartVillage,
  runStoryHook,
  storyChainOf,
  storySlots,
  storyVillage,
  validateStory,
} from './story.js'

const here = dirname(fileURLToPath(import.meta.url))

function readRealCsv(name: string) {
  return parseCsv(readFileSync(join(here, '..', 'csv', name), 'utf8'))
}

/**
 * 유효한 계열 무관 행 하나. 필요한 칸만 덮어쓴다.
 *
 * **출하 `story.csv` 에 임시 행을 넣지 않는다.** 검증을 재려면 표본이 필요한데,
 * 그것을 출하 표에 넣으면 게임에 실제로 그 마디가 서고 플레이어가 그것을 읽는다 —
 * 표본은 검사 안에서만 산다.
 */
function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    step: '0',
    field: '',
    objective: '{마을} {문방향}문으로 나가라',
    goalKind: 'arrive',
    goalArg: '{채집장}',
    goalCount: '',
    announce: '',
    discoverable: '1',
    catchUpKind: 'skill',
    catchUpArg: '{계열}',
    catchUpThreshold: '1',
    ...overrides,
  }
}

/** 표본 마디들을 실제 세계 위에 얹은 GameData — 검증이 마을 넷을 상대로 돌게 한다. */
function worldWith(rows: Record<string, string>[]): GameData {
  return { ...loadGameData(), story: parseStory(rows) }
}

/**
 * **같은 계열의 시작 마을이 둘인 세계** — 오늘은 없지만 검증이 "마을을 다섯째로
 * 그리는 날에도 그렇다"고 약속한 상태다.
 *
 * 얼음 마을 하나를 복사하고 채집장으로 나가는 문만 반대쪽 가장자리에 낸다 — 두
 * 마을의 `{문방향}` 이 갈리므로, 둘째 마을이 검사에서 조용히 빠지면 그 사실이
 * 값으로 드러난다(첫째의 `up` 이 아무의 것도 아니게 되어 못박기가 안 걸린다).
 */
function twinIceWorld(rows: Record<string, string>[]): GameData {
  const data = loadGameData()
  const twin: MapDef = { ...data.maps['눈의마을']!, id: '눈의마을둘', name: '눈의 마을 둘' }
  const fromWorld = data.transitions.find((t) => t.fromMap === WORLD_MAP_ID && t.toMap === '눈의마을')!
  const toField = data.transitions.find((t) => t.fromMap === '눈의마을' && t.toMap === '얼음채집장')!

  return {
    ...data,
    maps: { ...data.maps, [twin.id]: twin },
    transitions: [
      ...data.transitions,
      { ...fromWorld, toMap: twin.id },
      { ...toField, fromMap: twin.id, fromY: twin.height - 1 },
    ],
    story: parseStory(rows),
  }
}

describe('parseStory — 정상 행', () => {
  it('계열 무관 행 하나를 파싱한다 — 슬롯은 아직 글자 그대로 남는다', () => {
    const [def] = parseStory([row()])
    expect(def).toEqual<StoryStepDef>({
      step: 0,
      objective: '{마을} {문방향}문으로 나가라',
      goal: { kind: 'arrive', arg: '{채집장}' },
      announce: '',
      discoverable: true,
      catchUp: { kind: 'skill', arg: '{계열}', threshold: 1 },
    })
  })

  it('계열 행은 field 를 지고, 세는 조건은 goalCount 를 진다', () => {
    const [def] = parseStory([
      row({
        step: '5', field: 'ice', objective: '제작에서 눈 가루를 만들어라',
        goalKind: 'craft', goalArg: 'snow_powder', goalCount: '1',
      }),
    ])
    expect(def?.field).toBe('ice')
    expect(def?.goal).toEqual({ kind: 'craft', arg: 'snow_powder', count: '1' })
  })

  it('catchUp 세 칸이 비면 밀어 올릴 수 없는 마디가 된다 — 그것도 표현할 수 있어야 한다', () => {
    const [def] = parseStory([
      row({ discoverable: '', objective: '', announce: '무언가 달라졌다', catchUpKind: '', catchUpArg: '', catchUpThreshold: '' }),
    ])
    expect(def?.catchUp).toBeUndefined()
    expect(def?.discoverable).toBe(false)
  })

  it('빈 표도 파싱한다 — 마디를 아직 안 쓴 상태에서도 빌드는 서야 한다', () => {
    expect(parseStory([])).toEqual([])
  })
})

describe('parseStory — 행 하나만 봐도 아는 오류', () => {
  it('모르는 goalKind 는 던진다', () => {
    expect(() => parseStory([row({ goalKind: 'visit' })])).toThrow(
      'story.csv[마디 0]: goalKind "visit" 는 알 수 없다 (허용값: arrive, gather, donate, craft, reach)',
    )
  })

  // 왜: 몇 번을 해야 끝나는지 아무도 모르는 마디가 선다 — 띠는 「n / ?」 를 적을 수 없고
  //     판정은 영원히 안 끝난다.
  it('세는 조건인데 goalCount 가 없으면 던진다', () => {
    expect(() => parseStory([row({ goalKind: 'gather', goalArg: '{계열}', goalCount: '' })])).toThrow(
      /goalCount 가 필요하다/,
    )
  })

  // 왜: 조용히 무시하면 작가는 그 숫자가 무언가 한다고 믿는다 — milestones 의
  //     "인자를 안 쓰는 종류에 인자가 적혀 있으면 거절한다" 와 같은 자세다.
  it('안 세는 조건에 goalCount 가 적히면 던진다', () => {
    expect(() => parseStory([row({ goalKind: 'arrive', goalCount: '40' })])).toThrow(
      /goalKind=arrive 는 세지 않는데 goalCount 에 "40" 가 적혔다/,
    )
  })

  it('discoverable 에 1 이 아닌 값이 적히면 던진다 — 조용히 거짓으로 접으면 화면만 조용하다', () => {
    expect(() => parseStory([row({ discoverable: 'true' })])).toThrow(/discoverable "true" 는 알 수 없다/)
  })

  it('띠에 뜨는 마디인데 objective 가 비면 던진다 — 띠가 빈 줄로 선다', () => {
    expect(() => parseStory([row({ objective: '' })])).toThrow(/objective 가 비어 있다/)
  })

  // 왜: 띠에도 안 적고 달성 뒤에도 말하지 않으면, 상태가 조용히 바뀌고 플레이어는
  //     무슨 일이 있었는지 알 방법이 없다(설계 ⑥ 방어①의 뒷면).
  it('안 보이는 마디인데 announce 가 비면 던진다', () => {
    expect(() => parseStory([row({ discoverable: '', objective: '', announce: '' })])).toThrow(
      /announce 가 비어 있다/,
    )
  })

  it('catchUp 세 칸 중 종류만 적히면 던진다 — 얼마인지 모르는 문턱이 선다', () => {
    expect(() => parseStory([row({ catchUpThreshold: '' })])).toThrow(
      /catchUpKind 와 catchUpThreshold 는 함께 적거나 함께 비워야 한다/,
    )
  })

  // 왜: 자유 문법을 안 쓰는 것이 곧 단조 제한이다(설계 ⑦). 이정표의 지표 목록
  //     밖의 것은 **적을 방법 자체가 없어야** 한다 — gold 는 사면 줄어드는 값이라
  //     그것을 문턱으로 삼으면 밀어 올렸던 사람이 다시 초보 안내를 받는다.
  it('이정표의 지표가 아닌 catchUpKind 는 던진다', () => {
    expect(() => parseStory([row({ catchUpKind: 'gold', catchUpArg: '' })])).toThrow(
      'story.csv[마디 0]: catchUpKind "gold" 는 알 수 없다 (허용값: skill, every, collection)',
    )
  })
})

describe('storySlots — 값은 마을에서 나온다', () => {
  const data = loadGameData()

  // 설계 ③ 의 실측 표를 그대로 되잰다. 이 네 줄이 어긋나는 날은 세계가 바뀐 날이고,
  // 그때 사슬의 안내도 함께 바뀌어야 한다.
  it.each([
    ['눈의마을', 'ice', '얼음채집장', '북', '얼음 광맥', '얼음 조각', '200'],
    ['숲의마을', 'wood', '나무수렵장', '남', '어린 나무', '무른 통나무', '200'],
    ['항구마을', 'herb', '허브채집장', '동', '약초 군락', '흔한 약초', '150'],
    ['북동쪽마을', 'mineral', '광물채굴장', '동', '구리 광맥', '구리 원석', '50'],
  ])('%s 의 슬롯을 세계의 생김새에서 유도한다', (village, skill, fieldMap, direction, node, item, t1) => {
    const slots = storySlots(data, village)
    expect(slots['계열']?.id).toBe(skill)
    expect(slots['채집장']?.id).toBe(fieldMap)
    expect(slots['문방향']?.name).toBe(direction)
    expect(slots['노드']?.name).toBe(node)
    expect(slots['아이템']?.name).toBe(item)
    expect(slots['t1']?.id).toBe(t1)
  })

  it('같은 슬롯이 글에서는 이름으로, 인자에서는 id 로 펴진다', () => {
    const slots = storySlots(data, '눈의마을')
    expect(fillText('{마을} {문방향}문으로 나가라', slots)).toBe('눈의 마을 북문으로 나가라')
    expect(fillArg('{채집장}', slots)).toBe('얼음채집장')
  })

  it('모르는 슬롯은 던진다 — 남은 중괄호가 곧 플레이어가 읽는 글이 된다', () => {
    expect(() => fillText('{계열주인}에게 가라', storySlots(data, '눈의마을'))).toThrow(/슬롯 "{계열주인}" 을 모른다/)
  })

  it('시작 마을이 아니면 던진다', () => {
    expect(() => storySlots(data, '사냥터')).toThrow(/시작 마을이 아니다/)
  })
})

describe('validateStory — 표가 비어도 빌드는 선다', () => {
  it('출하 story.csv 는 지금 위반이 없다', () => {
    expect(validateStory({ ...loadGameData(), story: parseStory(readRealCsv('story.csv')) })).toEqual([])
  })

  it('빈 표도 위반이 없다 — 마디를 지운 날에도 빌드는 서야 한다', () => {
    expect(validateStory(worldWith([]))).toEqual([])
  })

  it('설계 ③ 의 마디 넷을 슬롯으로만 쓴 사슬은 네 마을 전부에서 통과한다', () => {
    expect(
      validateStory(
        worldWith([
          row(),
          row({ step: '1', objective: '{노드} 앞에서 A', goalKind: 'gather', goalArg: '{계열}', goalCount: '1' }),
          row({ step: '2', objective: '손에 익을 때까지 캐라', goalKind: 'gather', goalArg: '{계열}', goalCount: '40' }),
          row({
            step: '3', objective: '가방을 열어 [바치기] — {아이템} {t1}개',
            goalKind: 'donate', goalArg: '{아이템}', goalCount: '{t1}',
            catchUpKind: 'collection', catchUpArg: '', catchUpThreshold: '1',
          }),
        ]),
      ),
    ).toEqual([])
  })
})

describe('validateStory — ① 참조 무결성', () => {
  it.each([
    ['arrive', '없는채집장', /맵 "없는채집장" 이 maps.csv 에 없다/],
    ['donate', 'copper_ingot', /수집 칸이 없다/],
    ['craft', 'ghost_recipe', /레시피 "ghost_recipe" 가 recipes.csv 에 없다/],
    ['reach', 'ghost_milestone', /이정표 "ghost_milestone" 가 milestones.csv 에 없다/],
  ])('goalKind=%s 가 없는 것을 가리키면 위반이다', (kind, arg, pattern) => {
    const counted = kind === 'donate' || kind === 'craft'
    const violations = validateStory(
      worldWith([row({ field: 'ice', goalKind: kind, goalArg: arg, goalCount: counted ? '1' : '' })]),
    )
    expect(violations.some((v) => pattern.test(v))).toBe(true)
  })

  // 왜: 개발용 시험장은 눈의마을 서문에서 숙련 0 으로 걸어 들어가는 노드 13개짜리
  //     샌드박스다(설계 ⑤). 사슬이 그리로 보내면 신규가 게임 대신 시험장을 본다.
  it('개발용 시험장으로 보내는 마디는 위반이다', () => {
    const violations = validateStory(worldWith([row({ field: 'ice', goalArg: '개발맵' })]))
    expect(violations.some((v) => /개발용 시험장/.test(v))).toBe(true)
  })

  it('어느 시작 마을의 계열도 아닌 field 는 위반이다 — 그 행은 아무의 사슬에도 안 실린다', () => {
    const violations = validateStory(worldWith([row({ field: 'crafting', goalArg: '{채집장}' })]))
    expect(violations.some((v) => /"crafting" 은 어느 시작 마을의 계열도 아니다/.test(v))).toBe(true)
  })

  it('슬롯을 편 goalCount 가 수가 아니면 위반이다', () => {
    const violations = validateStory(
      worldWith([row({ field: 'ice', goalKind: 'gather', goalArg: '{계열}', goalCount: '{채집장}' })]),
    )
    expect(violations.some((v) => /goalCount 가 "얼음채집장" 로 펴진다/.test(v))).toBe(true)
  })
})

describe('validateStory — ② 연속성', () => {
  it('0 부터 시작하지 않으면 위반이다 — 아무도 첫 마디에 설 수 없다', () => {
    const violations = validateStory(worldWith([row({ step: '1' })]))
    expect(violations.some((v) => /마디 0 이 없다/.test(v))).toBe(true)
  })

  it('가운데가 비면 위반이다 — 앞 마디를 끝낸 사람의 사슬이 그 자리에서 멈춘다', () => {
    const violations = validateStory(worldWith([row(), row({ step: '2' })]))
    expect(violations.some((v) => /마디 1 이 없다/.test(v))).toBe(true)
    expect(violations.some((v) => /마디 2 이 사슬 길이\(2\)를 넘는다/.test(v))).toBe(true)
  })

  // 왜: 계열 무관 행과 계열 행이 같은 step 에 함께 있으면 어느 것이 걸릴지 정해지지
  //     않는다. **계열마다** 세는 것이 이 검사의 요점이다 — 표 전체로 세면 마디 4·5
  //     의 계열별 네 행이 정상인데도 중복으로 보인다.
  it('한 계열에서 같은 마디가 둘이면 위반이다', () => {
    const violations = validateStory(worldWith([row(), row({ field: 'ice' })]))
    expect(violations.some((v) => /ice\(눈의마을\).*마디 0 이 2행이다/.test(v))).toBe(true)
    // 나머지 세 계열은 계열 무관 행 하나씩이라 멀쩡하다.
    expect(violations.filter((v) => /마디 0 이 2행이다/.test(v))).toHaveLength(1)
  })

  // 왜: 연속성은 계열마다 따로 세므로 **한 계열의 마지막 마디를 통째로 빠뜨린 표**는
  //     그 검사를 그냥 통과한다 — 광물 사슬은 "길이 1, 0부터 연속" 으로 멀쩡하다.
  //     그런데 마디 4·5 는 계열별 8행이라 한 계열 두 행을 빠뜨리는 것이 가장 흔한
  //     사고이고, 그때 그 마을 사람만 유도등이 두 마디 일찍 꺼진다.
  it('한 계열의 마지막 마디가 통째로 빠지면 위반이다', () => {
    const violations = validateStory(
      worldWith([
        row(),
        ...(['ice', 'wood', 'herb'] as const).map((field) =>
          row({ step: '1', field, objective: '{계열} 숙련 1,000', goalKind: 'reach', goalArg: `${field}_1000` }),
        ),
      ]),
    )
    expect(violations.some((v) => /계열마다 사슬 길이가 다르다.*mineral 1마디/.test(v))).toBe(true)
  })

  it('계열별 행 넷이 같은 step 을 쓰는 것은 정상이다 — 마디 4·5 가 그 모양이다', () => {
    expect(
      validateStory(
        worldWith([
          row(),
          ...(['ice', 'wood', 'herb', 'mineral'] as const).map((field) =>
            row({ step: '1', field, objective: `${field} 숙련을 올려라`, goalKind: 'reach', goalArg: `${field}_1000` }),
          ),
        ]),
      ),
    ).toEqual([])
  })
})

describe('validateStory — ③ 계열 슬롯이 네 시작 마을 전부에서 유도되는가', () => {
  it('아는 슬롯이 아니면 위반이고, 마을 넷이 각각 말한다', () => {
    const violations = validateStory(worldWith([row({ objective: '{계열주인}에게 가라' })]))
    expect(violations).toHaveLength(4)
    expect(violations.every((v) => /슬롯 \[\{계열주인\}\] 을 이 마을에서 펼 수 없다/.test(v))).toBe(true)
  })

  // **이 스위트에서 가장 값이 큰 검사다**(설계 ⑧-2). 심사에 올라온 설계안 셋이 전부
  // 이 모양이었다 — 슬롯이 하나도 없으니 펴는 데 실패하지 않고, 얼음채집장은 실재하니
  // 참조 무결성도 통과한다. 그런데 항구마을에서 시작한 사람은 지도 반대편으로 불린다.
  it('계열 무관 행이 한 마을의 것을 인자에 못박으면 위반이다', () => {
    const violations = validateStory(worldWith([row({ goalArg: '얼음채집장' })]))
    expect(violations.some((v) => /goalArg 에 "얼음채집장" 가 그대로 적혔다/.test(v))).toBe(true)
  })

  it('계열 무관 행이 한 마을의 이름을 띠에 못박으면 위반이다', () => {
    const violations = validateStory(worldWith([row({ objective: '눈의 마을 북문으로 나가라' })]))
    expect(violations.some((v) => /objective 이 "눈의 마을" 를 그대로 적는다/.test(v))).toBe(true)
  })

  // 왜: 계열을 적었다는 것은 "이 행은 그 계열에서만 걸린다" 이지 "무엇을 적어도
  //     된다" 가 아니다. 계열 행을 통째로 면제하면 **눈의마을 사람이 지도 반대편
  //     허브채집장으로 불려도 위반이 0** 이다 — 바로 위 검사가 잡는 사고의 거울상이고,
  //     하필 그 면제가 덮는 행이 Q3 이 서로 비슷한 네 줄을 복붙해서 쓸 마디 4·5 다.
  it('계열 행이 남의 마을 것을 못박으면 위반이다', () => {
    const violations = validateStory(
      worldWith([row({ field: 'ice', goalArg: '허브채집장', objective: '허브채집장으로 가라' })]),
    )
    expect(violations.some((v) => /goalArg 에 "허브채집장" 가 그대로 적혔다/.test(v))).toBe(true)
    expect(violations.some((v) => /objective 이 "허브채집장" 를 그대로 적는다/.test(v))).toBe(true)
  })

  // 왜: 이정표 id 는 어느 슬롯의 얼굴도 아니라서(`ice_1000` 은 슬롯이 채우는 값이
  //     아니다) 위 못박기의 그물을 그냥 지나간다. 그런데 광물 마을 사람에게
  //     `ice_1000` 을 요구하는 행은 정확히 같은 사고다 — 자기가 캐지도 않는 계열의
  //     문턱이라 사슬이 그 자리에서 영원히 멈춘다.
  it('reach 가 남의 계열 이정표를 가리키면 위반이다', () => {
    const violations = validateStory(worldWith([row({ field: 'mineral', goalKind: 'reach', goalArg: 'ice_1000' })]))
    expect(violations.some((v) => /reach 가 ice 계열의 이정표 "ice_1000" 를 가리킨다/.test(v))).toBe(true)
  })

  it('계열 무관 행이 한 계열의 이정표를 가리키면 나머지 세 마을이 말한다', () => {
    const violations = validateStory(worldWith([row({ goalKind: 'reach', goalArg: 'ice_1000' })]))
    expect(violations.filter((v) => /reach 가 ice 계열의 이정표/.test(v))).toHaveLength(3)
  })

  // 왜: 설계 ③ 의 마디 4 가 그 모양이다 — 광물에는 1,000 짜리 문이 없어서(gateSkill
  //     붙은 레시피가 wood·herb·ice 뿐이다) 광물만 조합 200 을 가리킨다. 조합은 어느
  //     마을의 대표 계열도 아니므로 남의 것이 아니고, 위 검사가 이 행을 거절하면
  //     설계가 정한 사슬을 빌드가 막는다.
  it('설계 ③ 의 마디 4 — 광물만 조합 200 을 가리키는 계열별 넷은 통과한다', () => {
    expect(
      validateStory(
        worldWith([
          row({ field: 'mineral', objective: '조합 200', goalKind: 'reach', goalArg: 'crafting_200' }),
          ...(['ice', 'wood', 'herb'] as const).map((field) =>
            row({ field, objective: '{계열} 숙련 1,000', goalKind: 'reach', goalArg: `${field}_1000` }),
          ),
        ]),
      ),
    ).toEqual([])
  })

  // 왜: 두 글자 문턱은 한 글자 방향 이름표(북·남)를 거르려고 세운 것인데 숫자는
  //     그 문턱을 그냥 넘는다 — 「1,500」 안의 「50」이 광물의 {t1} 로 걸리면, 계열과
  //     아무 상관 없는 글이 완전히 엉뚱한 설명과 함께 빌드를 세운다.
  it('숫자가 든 계열 무관 글은 못박기가 아니다', () => {
    expect(
      validateStory(worldWith([row({ objective: '여관은 1,500 골드다 — {마을} {문방향}문으로 나가라' })])),
    ).toEqual([])
  })

  // 왜: `chains` 를 계열로 키잡으면 같은 계열의 둘째 마을이 첫째를 덮어써서, 덮인
  //     마을은 슬롯 유도도 못박기도 연속성도 **한 번도 검사받지 않는다** — 이 검사가
  //     막겠다고 한 상태 그 자체다. validateVillageFields 는 두 마을이 같은 채집장
  //     맵을 대표로 삼는 것만 보므로 이것을 대신 막아 주지 않는다.
  it('같은 계열의 시작 마을이 둘이면 둘째도 검사받는다', () => {
    const violations = validateStory(twinIceWorld([row({ field: 'ice', goalArg: 'up' })]))
    expect(violations.some((v) => /goalArg 에 "up" 가 그대로 적혔다.*ice\(눈의마을둘\) 에서도 걸린다/.test(v))).toBe(
      true,
    )
  })

  it('계열 행이 자기 계열의 것을 이름으로 적는 것은 못박기가 아니다 — 마디 4·5 가 그 모양이다', () => {
    expect(
      validateStory(
        worldWith([
          row({ field: 'ice', objective: '얼음 숙련 1,000', goalKind: 'reach', goalArg: 'ice_1000' }),
          ...(['wood', 'herb', 'mineral'] as const).map((field) =>
            row({ field, objective: `${field} 를 올려라`, goalKind: 'gather', goalArg: `{계열}`, goalCount: '1' }),
          ),
        ]),
      ),
    ).toEqual([])
  })
})

describe('validateStory — ④ catchUp 은 단조 지표다', () => {
  it('every 가 없는 이정표를 가리키면 위반이다', () => {
    const violations = validateStory(
      worldWith([row({ catchUpKind: 'every', catchUpArg: 'ice_1000|ghost', catchUpThreshold: '2' })]),
    )
    expect(violations.some((v) => /catchUpArg 가 없는 이정표 "ghost" 를 가리킨다/.test(v))).toBe(true)
  })

  it('collection 인데 인자가 적히면 위반이다 — 방은 하나뿐이라 고를 인자가 없다', () => {
    const violations = validateStory(
      worldWith([row({ field: 'ice', catchUpKind: 'collection', catchUpArg: 'ice', catchUpThreshold: '1' })]),
    )
    expect(violations.some((v) => /catchUpArg 에 "ice" 가 적혔다/.test(v))).toBe(true)
  })

  // 왜: 게임은 이미 공개돼 돌고 있고 친구들 계정이 살아 있다. 밀어올림이 없는
  //     안내 마디는 얼음 200,000 인 테스터에게 「마을 북문으로 나가라」를 띄운다
  //     (설계 ⑦ · 실기 확인 1번).
  it('띠에 뜨는 마디에 catchUp 이 없으면 위반이다', () => {
    const violations = validateStory(
      worldWith([row({ catchUpKind: '', catchUpArg: '', catchUpThreshold: '' })]),
    )
    expect(violations.some((v) => /discoverable 인데 catchUp 이 없다/.test(v))).toBe(true)
  })

  it('안 보이는 마디는 밀어 올릴 것이 없어도 된다', () => {
    expect(
      validateStory(
        worldWith([
          row({
            discoverable: '', objective: '', announce: '무언가 달라졌다',
            catchUpKind: '', catchUpArg: '', catchUpThreshold: '',
          }),
        ]),
      ),
    ).toEqual([])
  })
})

/**
 * 아래부터는 **런타임** 쪽이다 — 빌드가 아니라 판정 훅이 부르는 자리
 * (`storyVillage`·`storyChainOf`·`runStoryHook`).
 */

/** 그 마을 사람 하나. 숙련·자리만 손댄다. */
function villager(overrides: Partial<PlayerState> = {}): PlayerState {
  return { ...emptyPlayer(), ...overrides }
}

/** 설계 ③ 의 마디 0~2 를 슬롯으로만 적은 사슬. 마을 넷 전부에서 선다. */
const CHAIN_ROWS = [
  row({ step: '0' }),
  row({
    step: '1', objective: '{노드} 앞에서 A', goalKind: 'gather', goalArg: '{계열}', goalCount: '1',
  }),
  row({
    step: '2', objective: '{아이템} 을 {t1} 개 바쳐라', goalKind: 'donate', goalArg: '{아이템}',
    goalCount: '{t1}', catchUpKind: 'collection', catchUpArg: '', catchUpThreshold: '1',
  }),
]

/**
 * 저장된 시작 마을이 유도를 **이긴다** — 아크 F 가 늘린 셋째 칸의 존재 이유다.
 *
 * 유도만으로는 못 세우는 사람이 하나 있다: 숙련이 전부 0 인 채로 월드맵·사냥터에
 * 서 있는 사람. 그 자리에는 어느 마을에서 났는지 말해 주는 값이 세계 어디에도
 * 없어서 유도가 늘 같은 답(전환표 첫 마을)을 냈고, 띠와 깃발은 그 답을 말했다.
 */
describe('startVillage — 적힌 마을이 유도를 이긴다', () => {
  const data = loadGameData()

  it('네 마을 각각이 자기 사슬을 걷는다', () => {
    for (const village of startVillages(data)) {
      const p = villager({ startVillage: village.id })
      expect([village.id, storyVillage(data, p).id]).toEqual([village.id, village.id])
    }
  })

  // 왜: 이것이 이 필드가 생긴 이유 그 자체다. 유도는 이 자리에서 늘 눈의마을을
  //     냈고(숙련 0 · 마을도 채집장도 아닌 맵), 그래서 북동쪽마을을 고른 사람이
  //     「눈의 마을 북문으로 나가라」를 읽었다.
  it('월드맵·사냥터·개발맵에 서 있어도 안 바뀐다 — 유도가 늘 눈의마을을 내던 자리다', () => {
    for (const mapId of [WORLD_MAP_ID, '사냥터', '개발맵']) {
      for (const village of startVillages(data)) {
        const p = villager({ startVillage: village.id, location: { mapId, x: 1, y: 1 } })
        expect([mapId, village.id, storyVillage(data, p).id]).toEqual([mapId, village.id, village.id])
      }
    }
  })

  // 왜: 저장된 값이 있으면 유도는 **아예 안 돈다**. 위 검사들은 유도가 우연히 같은
  //     답을 낼 수 있는 자리라 그것만으로는 두 구현을 못 가른다 — 여기서는 유도
  //     ①(숙련 최고)과 ②(서 있는 자리)가 **둘 다** 다른 마을을 가리키게 세운다.
  it('유도가 정반대를 가리켜도 적힌 마을이 답이다', () => {
    const p = villager({
      startVillage: '북동쪽마을',
      skills: { ice: 200000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      location: { mapId: '얼음채집장', x: 1, y: 1 },
    })
    expect(storyVillage(data, p).id).toBe('북동쪽마을')
    expect(storyChainOf(data, p)[0]!.objective).toBe('북동쪽 마을 동문으로 나가라')
  })

  // 왜: 마을을 개명하거나 월드맵에서 그 마을로 가는 전환을 지우면 적힌 값이 더는
  //     마을을 안 가리킨다. 그대로 넘기면 storySlots 가 던져 그 사람의 게임이
  //     통째로 선다 — resolvePlayerLocation 이 없어진 맵을 되돌리는 그 자리다.
  it('시작 마을이 아닌 값은 없는 것으로 치고 유도로 내려간다', () => {
    const p = villager({ startVillage: '사냥터', location: { mapId: '항구마을', x: 1, y: 1 } })
    expect(storyVillage(data, p).id).toBe('항구마을')
  })
})

describe('pinStartVillage — 옛 세이브를 한 번 못박는다', () => {
  const data = loadGameData()

  it('값이 없으면 유도해서 적는다', () => {
    const p = villager({ location: { mapId: '숲의마을', x: 1, y: 1 } })
    pinStartVillage(data, p)
    expect(p.startVillage).toBe('숲의마을')
  })

  it('이미 적힌 값은 안 건드린다 — 남의 마을에 놀러 가도 그대로다', () => {
    const p = villager({ startVillage: '북동쪽마을', location: { mapId: '숲의마을', x: 1, y: 1 } })
    pinStartVillage(data, p)
    expect(p.startVillage).toBe('북동쪽마을')
  })

  // 왜: **적는 것이 안 적는 것보다 나쁜 유일한 경우다.** 유도 ③ 은 근거가 없어
  //     늘 같은 답(전환표 첫 마을)을 내는데, 그것을 세이브에 적으면 북동쪽마을
  //     사람이 눈의마을에 영구히 못박힌다. 안 적으면 그 사람이 자기 마을로
  //     돌아오는 순간 ②가 스스로 고친다.
  it('근거 없는 유도(숙련 0 · 월드맵)는 안 적는다 — 지어낸 답을 못박지 않는다', () => {
    const p = villager({ location: { mapId: WORLD_MAP_ID, x: 1, y: 1 } })
    pinStartVillage(data, p)
    expect(p.startVillage).toBe('')
    // 그리고 그 사람이 자기 마을에 닿으면 그때 적힌다.
    p.location = { mapId: '북동쪽마을', x: 1, y: 1 }
    pinStartVillage(data, p)
    expect(p.startVillage).toBe('북동쪽마을')
  })

  it('판정 훅이 부른다 — 옛 세이브는 첫 훅 한 번으로 채워진다', () => {
    const p = villager({ location: { mapId: '허브채집장', x: 1, y: 1 } })
    runStoryHook({ data, player: p, before: structuredClone(p), event: null })
    expect(p.startVillage).toBe('항구마을')
  })

  // 왜: 표가 비면 마을 유도 자체가 답 없는 계산이고, 두 칸짜리 리터럴로 짓는
  //     서비스 테스트들이 `startVillages` 의 던짐에 걸린다(storyChainOf 문서).
  it('표가 비면 못박지도 않는다', () => {
    const p = villager({ location: { mapId: '허브채집장', x: 1, y: 1 } })
    runStoryHook({
      data: { ...data, story: [] },
      player: p,
      before: structuredClone(p),
      event: null,
    })
    expect(p.startVillage).toBe('')
  })
})

describe('storyVillage — 시작 마을을 되찾는다', () => {
  const data = loadGameData()

  it('① 그 계열의 숙련도가 가장 높은 마을이다', () => {
    const p = villager({ skills: { ice: 0, wood: 0, mineral: 3, herb: 0, crafting: 0 } })
    expect(storyVillage(data, p).id).toBe('북동쪽마을')
  })

  it('① 은 서 있는 자리를 이긴다 — 남의 마을에 놀러 간 사람의 사슬은 안 바뀐다', () => {
    const p = villager({
      skills: { ice: 5000, wood: 0, mineral: 0, herb: 0, crafting: 0 },
      location: { mapId: '항구마을', x: 1, y: 1 },
    })
    expect(storyVillage(data, p).id).toBe('눈의마을')
  })

  // 왜: 아직 아무것도 안 캔 사람은 네 숫자가 전부 0 이라 ① 이 침묵한다. 그 사람은
  //     마디 0 에 서 있고, 마디 0 은 마을 안에서 시작한다 — 그래서 자리가 답이다.
  //     이것이 없으면 새 계정 넷 중 셋이 남의 마을 안내를 받는다(설계 ①).
  it('② 숙련이 전부 0 이면 서 있는 마을이다', () => {
    for (const village of startVillages(data)) {
      const p = villager({ location: { mapId: village.id, x: 1, y: 1 } })
      expect([village.id, storyVillage(data, p).id]).toEqual([village.id, village.id])
    }
  })

  it('② 는 채집장에 서 있어도 답한다 — 문을 넘은 직후가 그 자리다', () => {
    const p = villager({ location: { mapId: '허브채집장', x: 1, y: 1 } })
    expect(storyVillage(data, p).id).toBe('항구마을')
  })

  it('③ 정보가 없으면(숙련 0 · 월드맵) 늘 같은 답을 낸다 — 지어내지 않는다', () => {
    const p = villager({ location: { mapId: WORLD_MAP_ID, x: 1, y: 1 } })
    expect(storyVillage(data, p).id).toBe(startVillages(data)[0]!.id)
  })
})

describe('storyChainOf — 마을이 정해진 뒤의 사슬', () => {
  // 왜: 마디를 다 쓴 지금도 이 갈래는 살아 있어야 한다 — 세계를 두 칸짜리
  //     리터럴로 짓는 서비스 테스트들이 여기로 들어오고(storyChainOf 문서), 그때
  //     마을을 유도하려 들면 `startVillages` 의 "월드맵에서 나가는 전환이 하나도
  //     없다" 에 걸린다. 출하 표를 비운 세계로 재는 이유가 그것이다.
  it('표가 비면 빈 사슬이다 — 유도를 아예 안 돈다', () => {
    expect(storyChainOf({ ...loadGameData(), story: [] }, villager())).toEqual([])
  })

  it('색인이 곧 마디 번호다 — advanceStory 가 chain[player.story] 로 읽는다', () => {
    const chain = storyChainOf(worldWith(CHAIN_ROWS), villager())
    expect(chain.map((s) => s.step)).toEqual([0, 1, 2])
  })

  it('한 벌짜리 표가 마을마다 다른 사슬로 펴진다 — 그것이 슬롯의 존재 이유다', () => {
    const data = worldWith(CHAIN_ROWS)
    const ice = storyChainOf(data, villager({ location: { mapId: '눈의마을', x: 1, y: 1 } }))
    const herb = storyChainOf(data, villager({ location: { mapId: '항구마을', x: 1, y: 1 } }))

    expect(ice[0]!.objective).toBe('눈의 마을 북문으로 나가라')
    expect(ice[0]!.goal).toEqual({ kind: 'arrive', arg: '얼음채집장' })
    expect(ice[2]!.goal).toEqual({ kind: 'donate', arg: 'ice_shard', count: 200 })

    expect(herb[0]!.objective).toBe('항구 마을 동문으로 나가라')
    expect(herb[0]!.goal).toEqual({ kind: 'arrive', arg: '허브채집장' })
    // 개수까지 마을이 정한다 — 허브의 1단은 150 이다.
    expect(herb[2]!.goal).toEqual({ kind: 'donate', arg: 'common_herb', count: 150 })
  })

  it('밀어올림 문턱의 슬롯도 편다 — 지표가 그 마을의 계열을 가리킨다', () => {
    const chain = storyChainOf(worldWith(CHAIN_ROWS), villager({ location: { mapId: '숲의마을', x: 1, y: 1 } }))
    expect(chain[0]!.catchUp).toEqual({ metric: { kind: 'skill', skill: 'wood' }, threshold: 1 })
    // collection 은 인자가 없는 것이 정상이다 — 방은 하나뿐이다.
    expect(chain[2]!.catchUp).toEqual({ metric: { kind: 'collection' }, threshold: 1 })
  })

  it('그 계열의 행만 실린다 — 남의 계열 마디는 이 사람의 사슬에 없다', () => {
    const data = worldWith([
      ...CHAIN_ROWS,
      row({ step: '3', field: 'ice', goalKind: 'reach', goalArg: 'ice_1000', discoverable: '', objective: '', announce: '얼음에 익숙해졌다', catchUpKind: '', catchUpArg: '', catchUpThreshold: '' }),
      row({ step: '3', field: 'wood', goalKind: 'reach', goalArg: 'wood_1000', discoverable: '', objective: '', announce: '나무에 익숙해졌다', catchUpKind: '', catchUpArg: '', catchUpThreshold: '' }),
      row({ step: '3', field: 'mineral', goalKind: 'reach', goalArg: 'crafting_200', discoverable: '', objective: '', announce: '조합에 익숙해졌다', catchUpKind: '', catchUpArg: '', catchUpThreshold: '' }),
      row({ step: '3', field: 'herb', goalKind: 'reach', goalArg: 'herb_1000', discoverable: '', objective: '', announce: '허브에 익숙해졌다', catchUpKind: '', catchUpArg: '', catchUpThreshold: '' }),
    ])
    // 전제: 이 표는 실제로 빌드를 통과한다 — 통과 못 하는 표로 런타임을 재면 뜻이 없다.
    expect(validateStory(data)).toEqual([])

    const chain = storyChainOf(data, villager({ location: { mapId: '눈의마을', x: 1, y: 1 } }))
    expect(chain.map((s) => s.goal.arg)).toEqual(['얼음채집장', 'ice', 'ice_shard', 'ice_1000'])
  })
})

describe('runStoryHook — 서비스가 부르는 한 줄', () => {
  it('사건이 사슬을 민다', () => {
    const data = worldWith(CHAIN_ROWS)
    const p = villager({ location: { mapId: '얼음채집장', x: 1, y: 1 } })
    runStoryHook({ data, player: p, before: structuredClone(p), event: { kind: 'arrive', mapId: '얼음채집장' } })
    expect(p.story).toBe(1)
  })

  it('표가 비면 아무 일도 없다', () => {
    const p = villager()
    runStoryHook({
      data: { ...loadGameData(), story: [] },
      player: p,
      before: structuredClone(p),
      event: { kind: 'arrive', mapId: '얼음채집장' },
    })
    expect([p.story, p.storyCount]).toEqual([0, 0])
  })

  // 왜: 출하 표가 12행이 된 지금, 이 훅이 실제로 미는 것은 표본이 아니라 **그
  //     사슬**이다. 위 두 검사는 세계를 비워 두고 재므로 출하 행이 하나도 안 걸린
  //     상태를 재고, 그 사이로 "마디 0 이 도착을 안 문다" 가 지나갈 수 있다.
  it('출하 표에서도 문을 넘은 신규의 마디 0 이 끝난다', () => {
    const data = loadGameData()
    const p = villager({ location: { mapId: '허브채집장', x: 1, y: 1 } })
    const advance = runStoryHook({
      data,
      player: p,
      before: villager({ location: { mapId: '항구마을', x: 1, y: 1 } }),
      event: { kind: 'arrive', mapId: '허브채집장' },
    })
    expect([p.story, p.storyCount]).toEqual([1, 0])
    expect(advance.completed.map((s) => s.step)).toEqual([0])
    expect(advance.skipped).toEqual([])
  })

  // 왜: 게임은 이미 공개돼 돌고 있고 친구들 계정이 살아 있다(설계 ⑦ · 실기 확인
  //     1번). 밀어올림이 사슬을 끝까지 밀지 못하면 얼음 200,000 인 테스터에게
  //     「눈의 마을 북문으로 나가라」가 뜬다.
  it('출하 표에서 고인물은 여섯 마디를 한 번에 지나친다 — 축하는 하나도 안 받는다', () => {
    const data = loadGameData()
    const veteran = villager({
      skills: { ice: 200000, wood: 0, mineral: 0, herb: 0, crafting: 5000 },
      location: { mapId: '얼음채집장', x: 1, y: 1 },
      // 헌납·제작 이력이 있는 고인물이다. **이력이 하나도 없는 쪽**은 출하 사슬
      // 스위트가 따로 잰다 — 밀어올림이 이력을 요구하던 시절에 갈라진 두 사람이다.
      donated: { ice_shard: 1000 },
    })
    const advance = runStoryHook({
      data,
      player: veteran,
      before: structuredClone(veteran),
      event: { kind: 'gather', skill: 'ice' },
    })
    expect(veteran.story).toBe(6)
    expect(advance.completed).toEqual([])
    expect(advance.skipped.map((s) => s.step)).toEqual([0, 1, 2, 3, 4, 5])
  })

  // 왜: `before` 와 `player` 는 둘 다 PlayerState 라 바꿔 넣어도 타입이 안 짖는다.
  //     사슬을 그 사람의 것으로 펴는 유도(`storyVillage` 의 ②)가 봐야 하는 것은
  //     **도착한 뒤**의 자리다 — 밀어올림이 읽으라고 준 `before` 를 유도까지 읽으면
  //     숙련 0 인 사람의 사슬이 "떠나온 곳" 기준으로 서고, 그 답이 저장된 자리와
  //     어긋나는 날 되짚을 자리가 없다(moveService 의 훅 자리 주석과 같은 짝이다).
  it('사슬은 player 의 자리로 편다 — before 의 자리가 아니다', () => {
    const data = worldWith(CHAIN_ROWS)
    // 숙련이 전부 0 이라 마을 유도는 오직 서 있는 자리로만 갈린다(storyVillage ②).
    const before = villager({ location: { mapId: WORLD_MAP_ID, x: 1, y: 1 } })
    const p = villager({ location: { mapId: '항구마을', x: 1, y: 1 } })

    runStoryHook({ data, player: p, before, event: { kind: 'arrive', mapId: '허브채집장' } })
    expect(p.story).toBe(1)
  })
})

/**
 * 여기부터는 **출하 표 그 자체**를 잰다. 위의 검사들이 물은 것은 "표가 문법을
 * 지키는가" 였고, 여기서 묻는 것은 "지금 CSV 가 설계 ③ 의 사슬인가" 다.
 *
 * 두 물음을 나눠 두는 이유: 문법 검사는 표본 행으로 재야 오류마다 하나씩 겨눌 수
 * 있고(worldWith), 사슬 검사는 출하 행으로 재야 뜻이 있다 — 표본이 통과한다는 것은
 * 플레이어가 실제로 걷는 사슬에 대해 아무것도 말해 주지 않는다.
 */
describe('출하 사슬 — 설계 ③ 의 두 표를 그대로 잰다', () => {
  const data = loadGameData()

  /** 그 마을 사람의 사슬 — 숙련 0 이라 마을 유도는 서 있는 자리로만 갈린다(storyVillage ②). */
  function chainOfVillage(villageId: string): StoryStep[] {
    return storyChainOf(data, villager({ location: { mapId: villageId, x: 1, y: 1 } }))
  }

  /** 그 계열의 **보통 노드가 쓰는 표** — 마디 1·2 의 문턱이 이 표의 숙련 증가에서 나온다. */
  function normalTableOf(villageId: string): GatherTableDef {
    const field = villageField(data, villageId)
    const placed = Object.values(data.placements).filter((p) => p.mapId === field.map.id)
    const tableIds = new Set(
      placed
        .map((p) => data.nodes[p.nodeId])
        .filter((node) => node?.variant === 'normal')
        .map((node) => node!.tableId),
    )
    expect([...tableIds], `${villageId} 채집장의 보통 표`).toHaveLength(1)
    return loadGatherTables()[[...tableIds][0]!]!
  }

  // 설계 ③ 의 마디 표(0~5)와 계열별 표를 한 줄에 담는다. 이 네 줄이 어긋나는 날은
  // 사슬을 고친 날이고, 그때 이 표도 함께 고쳐져야 한다.
  //
  // **넷째 칸은 「수집 1단」이 아니라 「마디 3 이 요구하는 개수」다.** 셋은 여전히
  // `{t1}` 슬롯이 채우지만 광물만 CSV 에 100 이 그대로 적혀 있다 — 수집표의 1단은
  // **최종 브라켓 · 최적손 30분**을 겨냥해 교정된 눈금이라(collection.ts) 초반
  // 마디가 그대로 빌려 쓰면 광물만 마디 3 이 14초로 스쳐 지나간다(설계 ③ 의 정정).
  // 그래서 이름을 `t1` 에서 바꿨다: 두 값이 갈라진 지금 옛 이름은 거짓말이다.
  const FIELDS = [
    ['눈의마을', 'ice', 'ice_shard', 200, 'ice_1000', 'snow_powder'],
    ['숲의마을', 'wood', 'soft_log', 200, 'wood_1000', 'compressed_log'],
    ['항구마을', 'herb', 'common_herb', 150, 'herb_1000', 'herb_extract'],
    ['북동쪽마을', 'mineral', 'copper_ore', 100, 'crafting_200', 'copper_hammer'],
  ] as const

  it.each(FIELDS)('%s 의 사슬이 마디 0~5 로 끝까지 선다', (village, skill, item, 헌납수, reach, recipe) => {
    const chain = chainOfVillage(village)
    expect(chain.map((s) => s.step)).toEqual([0, 1, 2, 3, 4, 5])
    expect(chain[0]!.goal).toEqual({ kind: 'arrive', arg: villageField(data, village).map.id })
    expect(chain[1]!.goal).toEqual({ kind: 'gather', arg: skill, count: 1 })
    expect(chain[2]!.goal).toEqual({ kind: 'gather', arg: skill, count: 40 })
    expect(chain[3]!.goal).toEqual({ kind: 'donate', arg: item, count: 헌납수 })
    expect(chain[4]!.goal).toEqual({ kind: 'reach', arg: reach })
    expect(chain[5]!.goal).toEqual({ kind: 'craft', arg: recipe, count: 1 })
  })

  // 왜: 남은 중괄호는 곧 플레이어가 읽는 글이 된다(fillSlots 문서). 슬롯 이름이
  //     아는 것인지는 validateStory 가 보지만, **글자 그대로 `{` 를 적은 행**은
  //     슬롯이 아니라서 그 검사의 그물을 지나간다 — 띠는 「{계열 숙련 1000」을
  //     적고 어느 빌드도 짖지 않는다.
  it.each(FIELDS)('%s 의 사슬에는 안 펴진 슬롯이 하나도 없다', (village) => {
    for (const step of chainOfVillage(village)) {
      for (const text of [step.objective, step.announce, step.goal.arg]) {
        expect(text, `마디 ${step.step}`).not.toMatch(/[{}]/)
      }
    }
  })

  // 왜: 띠에 목적을 적는 마디는 여섯 전부다(설계 ⑥ 방어① — 아크 1 의 사슬만
  //     `true` 이고 그 뒤는 전부 `false`). 하나라도 꺼져 있으면 그 마디를 걷는
  //     3.5분 중 한 토막이 아무 말 없이 지나간다.
  it.each(FIELDS)('%s 의 여섯 마디가 전부 띠에 뜬다', (village) => {
    const chain = chainOfVillage(village)
    expect(chain.map((s) => s.discoverable)).toEqual([true, true, true, true, true, true])
    expect(chain.every((s) => s.objective !== '')).toBe(true)
  })

  /**
   * 그 글이 적은 수들 — 「1,000」 처럼 자릿점을 찍어도 같은 수로 읽는다.
   *
   * `toContain(String(n))` 대신 수를 뽑아 비교하는 이유: 「조합 숙련 2000」 은
   * 글자로는 "200" 을 포함하므로, 문턱 200 을 지키려던 자가 2000 을 통과시킨다.
   */
  function numbersIn(text: string): number[] {
    return [...text.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replaceAll(',', '')))
  }

  /**
   * **objective 는 요구치를 숫자로 옮겨 적지 않는다 — 그 수는 띠가 붙인다.**
   *
   * 한때 마디 4 가 「얼음 숙련 1000」이었고 마디 3 이 「… {아이템} {t1}개」였다.
   * 그러면 한 줄 안에 같은 수가 두 번, 그것도 **두 형식으로** 선다 — 띠가 뒤에
   * 붙이는 진행 숫자는 자릿점을 찍으므로 「얼음 숙련 1000   823 / 1,000」이다
   * (검토가 잡았다). 게다가 그 1000 은 `milestones.csv` 밖으로 한 번 옮겨 적은
   * 사본이라, 원본이 바뀌는 날 조용히 거짓말이 된다 — 설계 ⑥ 이 지키겠다고 한
   * 장치가 하필 「요구치를 숫자로 말하는 문」이라 그때 띠는 장치가 아니라 함정이다.
   *
   * 그래서 규칙을 하나로 세웠다: **목적은 동사만, 수는 진행 숫자만.** 요구치는
   * 띠가 이정표에서 읽어 「823 / 1,000」으로 말한다(questBand 의 progressOf).
   * 사본이 없으므로 아크 2 에서 `ice_1000` 문턱을 손대도 갈라질 자리가 없다.
   *
   * 마디 5 의 `announce` 는 이 자의 밖이다 — 거기 적히는 5000 은 상점 해금치이고
   * 띠가 붙여 주지 않는 수라, 아래 따로 선 자가 `shops.csv` 와 견준다.
   */
  it.each(FIELDS)('%s 의 목적에는 요구치 숫자가 없다 — 띠가 이정표에서 읽어 붙인다', (village) => {
    for (const step of chainOfVillage(village)) {
      expect(numbersIn(step.objective), `마디 ${step.step}: "${step.objective}"`).toEqual([])
    }
  })

  /**
   * **마디 5 의 objective 가 적는 이름은 그 마디가 시키는 레시피의 이름이다.**
   *
   * 띠는 「제작에서 눈 가루를 만들어라」라고 적고 판정은 `snow_powder` 를 센다 —
   * 이름과 id 가 다른 자리에 따로 적혀 있어서, 레시피 이름이 바뀌면 띠가 제작
   * 패널에 없는 물건을 만들라고 시킨다. 슬롯이 아니라 손으로 적은 이름이라
   * `fillText` 도 이것을 못 잡는다.
   */
  it.each(FIELDS)('%s 의 마디 5 는 그 레시피의 이름을 그대로 적는다', (village, _skill, _item, _헌납수, _reach, recipe) => {
    const def = data.recipes[recipe]!
    expect(chainOfVillage(village)[5]!.objective).toContain(def.name)
  })

  /**
   * **마디 5 의 announce 가 적는 숫자와 이름은 그 계열 상점의 실제 해금치와 주인이다.**
   *
   * 아크 1 은 상점을 열지 않고 **말만 한다**(설계 ⑨) — 그 한 줄이 적는 5000 은
   * `shops.csv` 의 `unlockSkill` 을, 「채집장 노인」은 `speakers.csv` 의 `name` 을
   * CSV 밖으로 한 번 옮겨 적은 값이고, 옮겨 적은 것은 원본이 바뀌는 날 조용히
   * 거짓말이 된다. 그 거짓말이 정확히 이 태스크가 지운 것(채집장 노인의
   * 「아직은 아닐세」)과 같은 종류라, 새로 들여온 사본에도 같은 자를 댄다.
   */
  it.each(FIELDS)('%s 의 마디 5 는 그 계열 상점의 해금치와 주인 이름을 그대로 적는다', (village, skill) => {
    const shop = Object.values(data.shops).find((s) => s.skill === skill)
    expect(shop, `${skill} 계열 상점`).toBeDefined()
    const announce = chainOfVillage(village)[5]!.announce
    expect(numbersIn(announce)).toContain(shop!.unlockSkill)
    expect(announce).toContain(data.speakers[shop!.speakerId]!.name)
  })

  /**
   * **밀어올림 문턱 — 마디 0~2 는 설계에 없는 숫자라 유도를 적어 둔다.**
   *
   * 문턱이 지켜야 하는 부등식은 하나다: **그 마디를 지금 걷고 있는 신규가 델타 0
   * 인 채로 닿을 수 있는 값보다 위**여야 한다(StoryCatchUp 의 마지막 문단). 아래로
   * 내려가면 고인물 대신 신규가 밀려 올라가고, 유도등이 마디 하나를 통째로 잃는다.
   *
   * - **마디 0** — `skill.{계열} >= 1`. 문을 넘는 것으로는 숙련이 안 오르므로 이
   *   마디는 스스로 값을 만들지 않고, 신규는 걷는 내내 0 이다(마을에는 노드가
   *   하나도 안 놓여 있다). 1 은 표의 `skillGainMin` — 한 번이라도 캔 손은 반드시
   *   넘는 가장 작은 수다.
   * - **마디 1** — `40 × skillGainMax`. 이 마디는 스스로 숙련을 만든다(실패한
   *   손질도 오른다, gatherService ②). 델타 방어는 첫 **성공** 뒤에야 걸리므로
   *   노출은 첫 성공 앞의 연속 실패뿐이고, 그 한계를 **40회**로 잡는다 — 바로 다음
   *   마디가 요구하는 성공 횟수이고(설계 ③), 그만큼 연달아 실패하는 손은 없다.
   * - **마디 2** — 마디 1 문턱의 두 배. 진입 상한은 「문턱 바로 아래에서 성공한
   *   사람」이라 79+2 = 81 이고, 거기서 다시 (160−81)/2 = 39회 연속 실패해야 밀린다.
   * - **마디 3·4·5** — 계열 숙련 `VETERAN_SKILL`. 아래에 따로 적는다.
   */
  it.each(FIELDS)('%s 의 마디 0~2 밀어올림 문턱이 채집표에서 유도한 값 그대로다', (village, skill) => {
    const chain = chainOfVillage(village)
    const table = normalTableOf(village)
    const failStreak = chain[2]!.goal.count!

    expect(chain[0]!.catchUp).toEqual({
      metric: { kind: 'skill', skill },
      threshold: table.skillGainMin,
    })
    expect(chain[1]!.catchUp).toEqual({
      metric: { kind: 'skill', skill },
      threshold: failStreak * table.skillGainMax,
    })
    expect(chain[2]!.catchUp).toEqual({
      metric: { kind: 'skill', skill },
      threshold: 2 * failStreak * table.skillGainMax,
    })
  })

  /**
   * **고인물 기준선 — 설계 ⑧ 실기 확인 1번이 정한 수다**(「얼음 3,000+ 기존 캐릭터
   * 접속 → 띠가 안 뜬다」). 이 표에서 계열 숙련 밖의 것을 문턱으로 삼지 않는 이유가
   * 이 한 줄이다.
   */
  const VETERAN_SKILL = 3000

  /**
   * **마디 3·4·5 의 밀어올림은 계열 숙련 하나로만 갈린다.**
   *
   * 처음에는 이 셋이 그 마디가 만드는 지표를 그대로 문턱으로 삼았다 — 마디 3 은
   * `collection>=1`, 마디 5 는 `crafting>=200`(광물 500). 유도는 깔끔했지만
   * **재는 것이 숙련이 아니라 이력**이라, 얼음 200,000 인데 **한 번도 안 바친**
   * 또는 **한 번도 안 만든** 계정이 그 마디에서 멈추고 초보 안내 띠를 받았다.
   * 게임은 이미 공개돼 돌고 있고 친구들 계정이 살아 있으므로 이건 가정이 아니다.
   *
   * 밀어올림 문턱이 지켜야 하는 부등식은 하나뿐이다 — **그 마디를 걷는 신규가
   * 델타 0 인 채로 닿을 수 있는 값보다 위**(StoryCatchUp). 3,000 은 그것을 셋 다
   * 지키면서 실기 1번의 기준선과 같은 수다:
   *
   * - **마디 3** 에 선 신규는 t1 개를 모으는 동안만 델타가 0 이고(한 개라도 바치면
   *   델타 방어가 걸린다), 설계 ③ 의 실측으로 그 순간 계열 숙련은 600~800 이다
   *   (60초에 257 · 마디 3 완료 1.5~2.6분). 3,000 은 그 위로 4배다.
   * - **마디 4** 는 신규가 계열 1,000 에 닿는 순간 `metByState` 로 **끝난다** —
   *   밀어올림이 볼 기회 자체가 없다. 문턱이 이정표 문턱(1,000)이든 3,000 이든
   *   신규에게는 같은 마디이고, 다른 것은 계열 1,000~3,000 짜리 계정이 마디 4 를
   *   `skipped`(조용히) 대신 `completed`(축하 한 줄) 로 지난다는 것뿐이다. 그 사람은
   *   방금 마디 3 을 자기 손으로 끝낸 참이라 축하가 어색하지 않다.
   * - **마디 5** 에 선 신규는 계열 1,000 을 막 넘긴 참이고(설계 ③: 3.4분), 조합은
   *   계열 숙련을 안 올린다. 3,000 은 그 위로 3배 — 띠를 무시하고 8분을 더 캐야
   *   닿는다.
   *
   * 광물만 다른 값을 쓰던 것도 이 규칙이 지운다. 광물의 마디 4 는 조합 200 을
   * 가리키는데(광물 1,000 에는 문이 없다) 그 문턱을 밀어올림에도 쓰면 **한 번도
   * 안 만든 광물 고인물**이 마디 4 에서 멈춘다 — 마디 3·5 와 똑같은 사고다.
   */
  it.each(FIELDS)('%s 의 마디 3·4·5 는 계열 숙련 %s 의 고인물 기준선 하나로 갈린다', (village, skill) => {
    const chain = chainOfVillage(village)
    for (const step of [3, 4, 5]) {
      expect(chain[step]!.catchUp, `마디 ${step}`).toEqual({
        metric: { kind: 'skill', skill },
        threshold: VETERAN_SKILL,
      })
    }
  })

  /**
   * **설계 ⑧ 실기 확인 1번 그 자체** — 이력이 하나도 없는 고인물도 띠를 안 받는다.
   *
   * 위 검사는 문턱이 무엇인지를 재고, 이것은 그 문턱들이 **합쳐서** 무엇을 하는지를
   * 잰다: 사슬은 순서대로 걷히므로 한 마디만 이력을 요구해도 그 사람은 거기서
   * 멈춘다. 바친 적도 만든 적도 없는 계정으로 재는 것이 요점이다 — 이력을 채워
   * 주면 이 검사는 고쳐야 했던 그 상태에서도 초록이었다.
   */
  it.each(FIELDS)('%s 의 계열 %s 3,000 고인물은 바친 적도 만든 적도 없이 여섯 마디를 지나친다', (village, skill) => {
    const veteran = villager({
      skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, [skill]: VETERAN_SKILL },
      location: { mapId: village, x: 1, y: 1 },
    })
    const advance = runStoryHook({
      data,
      player: veteran,
      before: structuredClone(veteran),
      event: { kind: 'gather', skill },
    })
    expect(veteran.story).toBe(6)
    expect(advance.completed).toEqual([])
    expect(advance.skipped.map((s) => s.step)).toEqual([0, 1, 2, 3, 4, 5])
  })
})
