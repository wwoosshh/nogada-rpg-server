import { describe, expect, it } from 'vitest'
import { emptyDialogueHistory } from './dialogue.js'
import { defaultCombatState } from './combatState.js'
import type { PlayerState, RecipeDef, TransitionDef } from './types.js'
import type { CollectionTable } from './collection.js'
import {
  achievedIds,
  barrierDoorsOf,
  gatedRecipesOf,
  isAchieved,
  isPureTitle,
  metricValue,
  milestoneRatio,
  newlyAchieved,
  type MilestoneDef,
  type MilestoneWorld,
} from './milestones.js'

function player(skills: Partial<PlayerState['skills']> = {}): PlayerState {
  return {
    id: 'local',
    // 이름·외형은 이 스위트가 보는 판정에 쓰이지 않는다 — 모양을 맞추는 값이다.
    name: '아무개',
    appearance: 'player',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0, ...skills },
    stacks: {},
    donated: {},
    // 이 스위트의 판정은 돈을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    gold: 0,
    instances: [],
    equipped: {},
    nextActionAt: 0,
    celebrated: [],
    // 사슬은 이 스위트가 보는 판정이 아니다 — PlayerState 의 필수 칸이라 채워만 둔다.
    story: 0,
    storyCount: 0,
    rewarded: [],
    // 가루를 쓴 적 없는 사람이다 — PlayerState 의 필수 칸이라 채워만 둔다.
    weather: null,
    combat: defaultCombatState(),
    dialogueHistory: emptyDialogueHistory(),
    // 이 판정들은 맵을 보지 않는다 — PlayerState 의 필수 칸이라 채워만 둔다.
    location: { mapId: 'world', x: 0, y: 0 },
  }
}

const iceNovice: MilestoneDef = {
  id: 'ice-1000', metric: { kind: 'skill', skill: 'ice' }, threshold: 1000,
  name: '얼음에 익숙해지다', announce: '얼음에 익숙해졌다', effect: { kind: 'title' },
}
const mineralNovice: MilestoneDef = {
  id: 'mineral-1000', metric: { kind: 'skill', skill: 'mineral' }, threshold: 1000,
  name: '광물에 익숙해지다', announce: '광물에 익숙해졌다', effect: { kind: 'title' },
}
const bothNovice: MilestoneDef = {
  id: 'both-1000', metric: { kind: 'every', of: ['ice-1000', 'mineral-1000'] }, threshold: 2,
  name: '고르게 익숙해지다', announce: '두 기술이 고르게 올랐다', effect: { kind: 'title' },
}
const all = [iceNovice, mineralNovice, bothNovice]

/**
 * 판정이 보는 세계 — 이정표 목록과 수집 문턱표.
 *
 * 문턱표를 **인자로 받는** 것이 `metricKind='collection'` 을 가능하게 한 변경이다
 * (총점은 `donated` 만으로는 계산되지 않는다). 이 스위트의 대부분은 방을 보지
 * 않으므로 빈 표를 쓴다 — 빈 방의 총점은 0 이고 만점도 0 이다.
 */
function worldOf(milestones: readonly MilestoneDef[], collection: CollectionTable = {}): MilestoneWorld {
  return { milestones, collection }
}

const world = worldOf(all)

describe('isAchieved — skill', () => {
  it('문턱 미만이면 달성이 아니다', () => {
    expect(isAchieved(iceNovice, player({ ice: 999 }), world)).toBe(false)
  })
  it('문턱에 닿으면 달성이다', () => {
    expect(isAchieved(iceNovice, player({ ice: 1000 }), world)).toBe(true)
  })
  it('다른 기술은 보지 않는다', () => {
    expect(isAchieved(iceNovice, player({ mineral: 999999 }), world)).toBe(false)
  })
})

describe('isAchieved — every', () => {
  it('하나만 채우면 달성이 아니다', () => {
    expect(isAchieved(bothNovice, player({ ice: 5000 }), world)).toBe(false)
  })
  it('둘 다 채우면 달성이다', () => {
    expect(isAchieved(bothNovice, player({ ice: 1000, mineral: 1000 }), world)).toBe(true)
  })
  it('없는 이정표를 가리키면 달성될 수 없다', () => {
    // 데이터 검증이 막지만, 막지 못했을 때 조용히 참이 되면 안 된다.
    const ghost: MilestoneDef = {
      ...bothNovice, id: 'ghost', metric: { kind: 'every', of: ['nope'] }, threshold: 1,
    }
    expect(isAchieved(ghost, player({ ice: 999999, mineral: 999999 }), worldOf([...all, ghost]))).toBe(false)
  })
})

describe('metricValue', () => {
  it('기술은 그 숙련도다', () => {
    expect(metricValue(iceNovice, player({ ice: 42 }), world)).toBe(42)
  })
  it('합산은 달성한 개수다', () => {
    expect(metricValue(bothNovice, player({ ice: 1000 }), world)).toBe(1)
    expect(metricValue(bothNovice, player({ ice: 1000, mineral: 1000 }), world)).toBe(2)
  })
})

describe('milestoneRatio', () => {
  it('0 에서 0, 문턱에서 1 이다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 0 }), world)).toBe(0)
    expect(milestoneRatio(iceNovice, player({ ice: 1000 }), world)).toBe(1)
  })
  it('문턱을 넘어도 1 을 넘지 않는다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 99999 }), world)).toBe(1)
  })
  it('절반이면 0.5 다', () => {
    expect(milestoneRatio(iceNovice, player({ ice: 500 }), world)).toBe(0.5)
  })
})

/**
 * every 분기는 지금까지 nextMilestone 비교를 통해서만 간접적으로 돌았다 —
 * 직접 값을 확인하는 테스트가 없었다. 병목(최솟값) 규칙은 이 모듈에서 가장
 * 미묘한 설계 결정이고, 합산 이정표가 "얼마나 왔는가"에 답하는 유일한 길이다 —
 * 그래서 따로 판을 짠다.
 */
describe('milestoneRatio — every', () => {
  it('둘이 다르게 진행 중이면 더 처진 쪽(최솟값)을 쓴다 — 평균이나 최댓값이 아니다', () => {
    // ice 500/1000=0.5, mineral 200/1000=0.2 → 병목은 mineral 이다.
    expect(milestoneRatio(bothNovice, player({ ice: 500, mineral: 200 }), world)).toBe(0.2)
  })
  it('하나가 0이면 나머지가 얼마든 전체는 0이다', () => {
    // mineral 은 이미 문턱을 넘겼어도(비율 1) ice 가 0 이면 병목은 ice 다.
    // metricValue(달성 개수)/threshold 였다면 여기서 0.5(둘 중 하나 달성)를
    // 보고했을 자리다 — milestoneRatio 문서가 경고하는 바로 그 오판이다.
    expect(milestoneRatio(bothNovice, player({ ice: 0, mineral: 1000 }), world)).toBe(0)
  })
  it('하나가 이미 완료여도 나머지가 병목이면 나머지의 비율을 그대로 쓴다', () => {
    // ice 는 완료(비율 1), mineral 은 300/1000=0.3 진행 중 → 0.3 이어야 한다.
    // "하나는 끝났으니 절반은 왔다"는 개수 비율의 착시를 피하는 것이 이
    // 규칙의 존재 이유다.
    expect(milestoneRatio(bothNovice, player({ ice: 1000, mineral: 300 }), world)).toBe(0.3)
  })
})

/**
 * 총점 지표(설계 §6-앞 8) — 이 저장소에서 **숙련도가 아닌 첫 이정표 지표**다.
 *
 * 왜 따로 판을 짜는가: `metricValue` 가 지금까지 `PlayerState` 만 보면 됐던 것과
 * 달리, 총점은 세이브의 `donated` 를 **문턱표로 옮겨야** 나온다. 즉 이 분기가
 * 도는지는 시그니처가 문턱표를 실어 나르는지와 같은 질문이고, 표를 안 넘기면
 * 조용히 0 이 되어 "바쳤는데 칭호가 안 붙는다" 로만 드러난다.
 */
describe('metricKind = collection', () => {
  // 칸 둘짜리 작은 방 — 만점은 2칸 × 4등급 = 8 이다.
  const table: CollectionTable = {
    ice_shard: { itemId: 'ice_shard', steps: [1, 10, 100, 1000] },
    copper_ore: { itemId: 'copper_ore', steps: [1, 10, 100, 1000] },
  }
  const collector: MilestoneDef = {
    id: 'collection-4', metric: { kind: 'collection' }, threshold: 4,
    name: '방에 자리가 잡히다', announce: '빈 칸이 채워지기 시작했다', effect: { kind: 'stock' },
  }
  const room = worldOf([collector], table)
  const donor = (donated: Record<string, number>): PlayerState => ({ ...player(), donated })

  it('지표는 방의 총점이다 — 등급 합이지 바친 개수가 아니다', () => {
    // 얼음 조각 100개 = 3등급, 구리 원석 10개 = 2등급 → 총점 5.
    expect(metricValue(collector, donor({ ice_shard: 100, copper_ore: 10 }), room)).toBe(5)
  })

  it('아무것도 안 바친 사람은 0 이다', () => {
    expect(metricValue(collector, donor({}), room)).toBe(0)
  })

  it('문턱을 넘긴 헌납에서 달성으로 바뀐다', () => {
    // 총점 3(3등급 + 0등급) 에서는 아직이고, 한 칸이 더 오르면 4 가 되어 달성이다.
    expect(isAchieved(collector, donor({ ice_shard: 100 }), room)).toBe(false)
    expect(isAchieved(collector, donor({ ice_shard: 100, copper_ore: 1 }), room)).toBe(true)
  })

  it('문턱표를 못 받으면 총점이 0 이다 — 표가 지표의 절반이라는 증거다', () => {
    // 같은 세이브인데 방(문턱표)이 비면 셀 칸이 없다. 이 줄이 초록인 이유가
    // 곧 시그니처가 표를 실어 날라야 하는 이유다.
    expect(metricValue(collector, donor({ ice_shard: 1000 }), worldOf([collector]))).toBe(0)
  })

  it('진척 비율은 총점/문턱이고 1 에서 잘린다', () => {
    expect(milestoneRatio(collector, donor({ ice_shard: 10 }), room)).toBe(0.5)
    expect(milestoneRatio(collector, donor({ ice_shard: 1000, copper_ore: 1000 }), room)).toBe(1)
  })

  it('every 가 총점 이정표를 가리켜도 그 비율이 그대로 병목으로 들어온다', () => {
    // every 의 재귀는 metricValue 가 아니라 milestoneRatio 를 다시 부른다 —
    // 새 지표가 그 재귀를 타는지는 별개의 질문이라 여기서 따로 못박는다.
    const both: MilestoneDef = {
      id: 'both', metric: { kind: 'every', of: ['collection-4', 'ice-1000'] }, threshold: 2,
      name: '둘 다', announce: '', effect: { kind: 'title' },
    }
    const mixed = worldOf([collector, iceNovice, both], table)
    // 총점 2/4 = 0.5, 얼음 1000/1000 = 1 → 병목은 총점 쪽이다.
    const p = { ...donor({ ice_shard: 10 }), skills: { ...player().skills, ice: 1000 } }
    expect(milestoneRatio(both, p, mixed)).toBe(0.5)
  })
})

describe('achievedIds', () => {
  it('달성한 것만 담는다', () => {
    const ids = achievedIds(world, player({ ice: 1000 }))
    expect([...ids].sort()).toEqual(['ice-1000'])
  })
  it('합산 이정표도 함께 잡힌다', () => {
    const ids = achievedIds(world, player({ ice: 1000, mineral: 1000 }))
    expect([...ids].sort()).toEqual(['both-1000', 'ice-1000', 'mineral-1000'])
  })
})

describe('newlyAchieved', () => {
  it('축하하지 않은 것만 준다', () => {
    const fresh = newlyAchieved(world, player({ ice: 1000 }), ['ice-1000'])
    expect(fresh).toEqual([])
  })
  it('축하 이력이 비어 있으면 달성한 것을 전부 준다', () => {
    const fresh = newlyAchieved(world, player({ ice: 1000 }), [])
    expect(fresh.map((m) => m.id)).toEqual(['ice-1000'])
  })
  it('축하 이력에 없는 id 가 있어도 무시한다', () => {
    // 이정표를 지운 뒤에도 옛 세이브가 살아 있어야 한다.
    const fresh = newlyAchieved(world, player({ ice: 1000 }), ['사라진것'])
    expect(fresh.map((m) => m.id)).toEqual(['ice-1000'])
  })
})

/**
 * `barrier` 효과가 무엇을 여는가 — 그 정의는 이 함수 하나다.
 *
 * 왜 술어를 두는가: 화면(이정표 탭)과 빌드 검증이 같은 질문을 한다 — "이 이정표가
 * 여는 문이 어느 것인가". 둘이 각자 `gateSkill === … && gateValue === …` 를 옮겨
 * 적으면, 짝짓는 규칙이 바뀌는 날 한쪽만 따라가고 그 어긋남은 "빌드는 초록인데
 * 목록이 딴소리를 한다" 로만 드러난다.
 */
describe('barrierDoorsOf', () => {
  const iceDoor: TransitionDef = {
    fromMap: '얼음채집장', fromX: 5, fromY: 4, toMap: '얼음채집장', toX: 5, toY: 2,
    facing: 'up', gateSkill: 'ice', gateValue: 85000,
  }
  const iceExit: TransitionDef = {
    fromMap: '얼음채집장', fromX: 5, fromY: 2, toMap: '얼음채집장', toX: 5, toY: 4, facing: 'down',
  }
  const herbDoor: TransitionDef = {
    fromMap: '허브채집장', fromX: 29, fromY: 16, toMap: '허브채집장', toX: 29, toY: 14,
    facing: 'up', gateSkill: 'herb', gateValue: 85000, gateTide: true,
  }
  const iceBarrier: MilestoneDef = {
    id: 'ice_85000', metric: { kind: 'skill', skill: 'ice' }, threshold: 85000,
    name: '얼음 결계를 넘을 수 있다', announce: '', effect: { kind: 'barrier' },
  }

  it('같은 계열·같은 숫자를 요구하는 문만 고른다', () => {
    const doors = barrierDoorsOf(iceBarrier, [iceDoor, iceExit, herbDoor])
    expect(doors).toEqual([iceDoor])
  })

  // 왜: 나오는 문은 게이트가 없다(§9-앞 16). 그것까지 세면 목록이 "결계 2곳" 이라
  //     적으면서 실제로 넘어야 할 벽은 하나인 화면이 된다.
  it('게이트 없는 나오는 문은 세지 않는다', () => {
    expect(barrierDoorsOf(iceBarrier, [iceExit])).toEqual([])
  })

  // 왜: 숫자가 다르면 다른 문이다. 문턱을 90,000 으로 올리면서 이정표를 안 고친 날
  //     이 목록이 비고, 빌드가 그 사실을 위반으로 말한다.
  it('숫자가 다른 문은 남이다', () => {
    expect(barrierDoorsOf({ ...iceBarrier, threshold: 90000 }, [iceDoor])).toEqual([])
  })

  // 왜: 효과가 barrier 가 아닌 이정표에 문을 붙여 주면, 화면이 칭호 줄 아래에
  //     결계 문구를 적는다. 짝은 효과가 선언한 것에만 붙는다.
  it('barrier 가 아닌 효과에는 문이 붙지 않는다', () => {
    expect(barrierDoorsOf({ ...iceBarrier, effect: { kind: 'title' } }, [iceDoor])).toEqual([])
  })

  // 왜: 문이 요구하는 것은 계열 숙련도다. 총점·합산 지표로는 어느 계열인지 말할
  //     수 없으므로 짝지을 수 없고, 빌드가 그 조합 자체를 위반으로 잡는다.
  it('지표가 숙련도가 아니면 짝지을 계열이 없다', () => {
    expect(barrierDoorsOf({ ...iceBarrier, metric: { kind: 'collection' } }, [iceDoor])).toEqual([])
  })
})

/**
 * 레시피의 **두 번째 문**(채집 문턱)과 이정표의 짝 — 이 짝이 없어서 목록방이
 * 문을 장식이라고 불렀다.
 *
 * `ice_1000` 은 effectKind 가 `title` 인데 실제로는 비 가루·눈 가루를 연다. 그
 * 사실이 `effect` 칸이 아니라 `recipes.csv` 의 `gateSkill`·`gateValue` 에 있어서
 * 이정표 탭은 그 자리에 「칭호 — 효과는 없다」를 적고 있었다.
 */
describe('gatedRecipesOf', () => {
  const rainPowder: RecipeDef = {
    id: 'rain_powder', name: '비 가루', category: '가루', skill: 'crafting',
    requiredSkill: 0, baseChance: 0.6, inputs: [], output: { item: 'rain_powder', count: 1 },
    skillGainMin: 1, skillGainMax: 2, gateSkill: 'ice', gateValue: 1000,
  }
  const snowPowder: RecipeDef = { ...rainPowder, id: 'snow_powder', name: '눈 가루' }
  const compressedLog: RecipeDef = {
    ...rainPowder, id: 'compressed_log', name: '압축 목재', gateSkill: 'wood', gateValue: 1000,
  }
  /** 문이 하나뿐인 레시피 — 조합 숙련만 본다. 채집 쪽 짝이 없다. */
  const copperIngot: RecipeDef = {
    ...rainPowder, id: 'copper_ingot', name: '구리 주괴', gateSkill: undefined, gateValue: undefined,
  }
  const table: Record<string, RecipeDef> = {
    rain_powder: rainPowder, snow_powder: snowPowder,
    compressed_log: compressedLog, copper_ingot: copperIngot,
  }

  it('계열과 문턱이 둘 다 맞는 레시피만 붙는다', () => {
    expect(gatedRecipesOf(iceNovice, table).map((r) => r.name)).toEqual(['비 가루', '눈 가루'])
  })

  // 왜: 이 함수가 생긴 이유 그 자체다. effect 를 봤다면 title 인 ice_1000 은
  //     빈 목록을 받고, 화면은 다시 「칭호 — 효과는 없다」로 돌아간다.
  it('effect 가 title 이어도 문을 찾는다 — effectKind 를 아예 안 본다', () => {
    expect(iceNovice.effect.kind).toBe('title')
    expect(gatedRecipesOf(iceNovice, table)).toHaveLength(2)
  })

  // 왜: 숫자가 다르면 다른 문이다. 얼음 10,000 짜리 레시피를 1,000 줄에 적으면
  //     플레이어는 1,000 에서 열릴 것을 기다리다 안 열리는 것을 본다.
  it('문턱이 다르면 짝이 아니다', () => {
    expect(gatedRecipesOf({ ...iceNovice, threshold: 10000 }, table)).toEqual([])
  })

  it('계열이 다르면 짝이 아니다', () => {
    expect(gatedRecipesOf(mineralNovice, table)).toEqual([])
  })

  // 왜: 채집 문턱이 없는 레시피(조합 숙련 하나만이 문인 것)가 아무 이정표에나
  //     붙으면, 목록이 열지도 않는 것을 열린다고 말한다.
  it('gateSkill 이 없는 레시피는 어디에도 안 붙는다', () => {
    const onlyIngot = { copper_ingot: copperIngot }
    expect(gatedRecipesOf(iceNovice, onlyIngot)).toEqual([])
    expect(gatedRecipesOf(mineralNovice, onlyIngot)).toEqual([])
  })

  // 왜: barrierDoorsOf 와 같은 이유다 — 총점·합산 지표에는 짝지을 계열이 없다.
  it('지표가 숙련도가 아니면 짝지을 계열이 없다', () => {
    expect(gatedRecipesOf(bothNovice, table)).toEqual([])
  })

  describe('isPureTitle', () => {
    // 왜: 이정표 탭이 접을 것을 이 술어로 고른다. effect.kind === 'title' 만으로
    //     물으면 실제 문 다섯(ice_1000·wood_1000·wood_50000·herb_1000·herb_50000)이
    //     통째로 접힌 자루 안으로 들어간다 — 신규가 첫 3분에 만날 문들이다.
    it('여는 레시피가 있으면 순수 칭호가 아니다', () => {
      expect(isPureTitle(iceNovice, table)).toBe(false)
    })
    it('아무것도 안 열면 순수 칭호다', () => {
      expect(isPureTitle(mineralNovice, table)).toBe(true)
    })
    it('title 이 아니면 애초에 칭호가 아니다', () => {
      const repeat: MilestoneDef = { ...mineralNovice, effect: { kind: 'repeat', skill: 'mineral' } }
      expect(isPureTitle(repeat, table)).toBe(false)
    })
  })
})
