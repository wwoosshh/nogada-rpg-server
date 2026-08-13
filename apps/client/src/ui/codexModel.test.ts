import { emptyPlayer, loadGameData } from '@nogada/data'
import { collectionScore, COLLECTION_MAX_GRADE, type PlayerState } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import {
  buildCodex,
  isCollectionSlot,
  MAX_DONATE_COUNT,
  maxDonateCount,
  donateToThresholdCount,
  nextCollectionGate,
  nextThresholdOf,
} from './codexModel.js'

/*
 * 수집의 방 모델 — 방이 그릴 순수 데이터를 만든다.
 * 판정(collectionGrade·collectionScore)은 전부 shared 의 것을 그대로 쓰므로,
 * 여기서 검사하는 것은 "화면이 그 판정과 문턱표를 왜곡 없이 옮겨 담는가"다.
 * 실물 데이터를 쓰는 이유는 shopModel.test 와 같다: 방이 진짜로 마주칠 등록부가
 * 이것이고, CSV 가 바뀌면 여기가 먼저 아파야 한다.
 */

const data = loadGameData()

function donatedPlayer(donated: Record<string, number>): PlayerState {
  return { ...emptyPlayer(), donated }
}

/** 문턱 숫자를 테스트에 손으로 적지 않는다 — 그 값은 작가가 조정한다(§6-앞 5). */
function stepsOf(itemId: string): [number, number, number, number] {
  const thresholds = data.collection[itemId]
  if (thresholds === undefined) throw new Error(`칸이 아니다: ${itemId}`)
  return thresholds.steps
}

describe('buildCodex — 계열 묶기', () => {
  // 왜: 방은 계열 넷의 격자다(설계 §6-앞 1). 묶음이 흐트러지면 "광물을 어디까지
  //     모았나"를 한눈에 볼 수 없고, 그것이 이 화면의 존재 이유다.
  it('채집 계열 넷만 묶음이 되고 조합은 칸이 없어 빠진다', () => {
    const view = buildCodex(data, emptyPlayer())
    expect(view.lines.map((l) => l.skill)).toEqual(['ice', 'wood', 'mineral', 'herb'])
    expect(view.lines.map((l) => l.label)).toEqual(['얼음', '나무', '광물', '허브'])
  })

  // 왜: 25칸은 gather_tiers.csv 가 정하고 collection.csv 가 그것과 정확히
  //     일치한다(빌드 검증). 화면이 한 칸이라도 흘리면 그 칸은 영영 보이지
  //     않는 방이 되고, 총점 만점(칸 수 × 4)과도 어긋난다.
  it('문턱표의 모든 칸이 정확히 한 번씩 어느 묶음엔가 들어간다', () => {
    const view = buildCodex(data, emptyPlayer())
    const placed = view.lines.flatMap((l) => l.slots.map((s) => s.itemId))
    expect(placed.slice().sort()).toEqual(Object.keys(data.collection).slice().sort())
    expect(placed.length).toBe(new Set(placed).size)
    expect(view.maxScore).toBe(placed.length * COLLECTION_MAX_GRADE)
  })

  // 왜: 계열은 ItemDef.skill 이 정한다 — 화면이 이름으로 짐작하면 '금 원석'과
  //     '황금 열매'가 같은 묶음에 들어가는 날이 온다.
  it('칸의 계열은 아이템 정의의 skill 을 그대로 따른다', () => {
    const view = buildCodex(data, emptyPlayer())
    for (const line of view.lines) {
      for (const slot of line.slots) {
        expect(data.items[slot.itemId]?.skill).toBe(line.skill)
      }
    }
  })

  // 왜: 잠긴 것까지 보인다(§6-앞 3). 이름을 감추면 원작 목록방이 한 일의
  //     반대가 되고, 어차피 이름도 아이콘도 이미 클라이언트 번들에 있다.
  it('한 번도 안 바친 칸도 이름을 말하고 요구치가 첫 문턱이다', () => {
    const view = buildCodex(data, emptyPlayer())
    const slot = view.lines
      .flatMap((l) => l.slots)
      .find((s) => s.itemId === 'ice_shard')
    expect(slot?.name).toBe(data.items['ice_shard']?.name)
    expect(slot?.donated).toBe(0)
    expect(slot?.grade).toBe(0)
    expect(slot?.nextStep).toBe(stepsOf('ice_shard')[0])
    expect(slot?.remaining).toBe(stepsOf('ice_shard')[0])
  })

  // 왜: 칸 순서는 오래 들여다보는 화면의 자리다. 바친 개수순으로 정렬하면
  //     한 번 바칠 때마다 방의 배치가 통째로 바뀐다.
  it('칸 순서는 문턱표 선언 순서를 계열 안에서 그대로 지킨다', () => {
    const view = buildCodex(data, donatedPlayer({ ice_shard: 999_999 }))
    const declared = Object.keys(data.collection).filter((id) => data.items[id]?.skill === 'ice')
    expect(view.lines[0]?.slots.map((s) => s.itemId)).toEqual(declared)
  })
})

describe('등급과 다음 문턱', () => {
  // 왜: 문턱에 닿으면 오른다(shared 의 collectionGrade). 화면이 "50/50"을 적어
  //     놓고 별을 안 주면 그 숫자가 거짓말이 된다.
  it('문턱에 정확히 닿으면 등급이 오르고 한 개 모자라면 안 오른다', () => {
    const [t1] = stepsOf('ice_shard')
    expect(slotOf(buildCodex(data, donatedPlayer({ ice_shard: t1 })), 'ice_shard').grade).toBe(1)
    expect(slotOf(buildCodex(data, donatedPlayer({ ice_shard: t1 - 1 })), 'ice_shard').grade).toBe(0)
  })

  // 왜: "다음 문턱까지 몇 개"가 이 방이 플레이어에게 주는 유일한 목표다
  //     (§6-앞 3 — 이미 만난 물건의 목표는 숨기지 않는다).
  it('다음 문턱은 지금 등급의 바로 다음 단이고 남은 개수는 그 차이다', () => {
    const [t1, t2] = stepsOf('copper_ore')
    const slot = slotOf(buildCodex(data, donatedPlayer({ copper_ore: t1 })), 'copper_ore')
    expect(slot.grade).toBe(1)
    expect(slot.nextStep).toBe(t2)
    expect(slot.remaining).toBe(t2 - t1)
  })

  // 왜: 만강에는 말할 목표가 없다. 없는 문턱을 0 으로 적으면 화면이 "다음까지
  //     0개"라고 말하고, 그건 곧 오른다는 뜻으로 읽힌다.
  it('만강이면 다음 문턱도 남은 개수도 없다', () => {
    const steps = stepsOf('copper_ore')
    const slot = slotOf(buildCodex(data, donatedPlayer({ copper_ore: steps[3] })), 'copper_ore')
    expect(slot.grade).toBe(COLLECTION_MAX_GRADE)
    expect(slot.nextStep).toBeNull()
    expect(slot.remaining).toBeNull()
    expect(nextThresholdOf(steps[3], data.collection['copper_ore']!)).toBeNull()
  })
})

describe('총점', () => {
  // 왜: 화면의 총점과 상점 되사기·이정표가 읽는 총점이 갈라지면, 방이 60 이라
  //     적어 둔 자리에서 상점이 잠긴 채로 있는다(§6-앞 7·8).
  it('머리의 총점은 shared 의 collectionScore 와 같은 수다', () => {
    const donated = { ice_shard: stepsOf('ice_shard')[2], copper_ore: stepsOf('copper_ore')[0] }
    const view = buildCodex(data, donatedPlayer(donated))
    expect(view.score).toBe(collectionScore(donated, data.collection))
    expect(view.score).toBe(4)
  })

  // 왜: 계열 점수는 그 묶음이 스스로 말하는 진척이다. 합이 총점과 어긋나면
  //     둘 중 하나가 거짓이고, 어느 쪽인지 화면에서는 알 수 없다.
  it('계열 점수의 합이 총점과 같고 각 계열의 만점은 칸 수 × 4 다', () => {
    const view = buildCodex(data, donatedPlayer({ sage: stepsOf('sage')[1], gold_ore: 1 }))
    expect(view.lines.reduce((sum, l) => sum + l.score, 0)).toBe(view.score)
    for (const line of view.lines) {
      expect(line.maxScore).toBe(line.slots.length * COLLECTION_MAX_GRADE)
    }
  })

  // 왜: 세이브의 키는 문자열이라 표에 없는 것이 들어 있을 수 있다(옛 아이템 id).
  //     그것이 점수를 만들면 만점이 100 이 아니게 되어 이정표 비율이 어긋난다.
  it('칸이 아닌 것이 세이브에 있어도 총점에 오르지 않는다', () => {
    const view = buildCodex(data, donatedPlayer({ copper_ingot: 9999, ghost_item: 9999 }))
    expect(view.score).toBe(0)
  })
})

describe('바칠 수 있는 것과 팔 수 있는 것은 다르다', () => {
  // 왜: 가방의 [바치기] 자격이 이 한 줄이다. 팔 수 있는 것(계열이 있는 재료
  //     전부)을 자격으로 삼으면 주괴·증표·가루에까지 버튼이 붙고, 눌러도
  //     서버가 not_collectable 로 거절하는 죽은 버튼이 된다(§8-앞 13).
  it('캔 것만 칸이다 — 주괴·증표·가루·도구는 아니다', () => {
    expect(isCollectionSlot(data, 'ice_shard')).toBe(true)
    expect(isCollectionSlot(data, 'mithril_ore')).toBe(true)
    // 만든 것은 "모았다"의 뜻이 아니다(§6-앞 4).
    expect(isCollectionSlot(data, 'copper_ingot')).toBe(false)
    expect(isCollectionSlot(data, 'mithril_ingot')).toBe(false)
    // 증표·가루는 보유 효과와 소모품이라 사고가 크다(설계 §3).
    expect(isCollectionSlot(data, 'ice_speed_token')).toBe(false)
    expect(isCollectionSlot(data, 'rain_powder')).toBe(false)
    // 도구는 애초에 재료 줄에 서지 않는다 — 그래도 자격이 스스로 말해야 한다.
    expect(isCollectionSlot(data, 'copper_chisel')).toBe(false)
    expect(isCollectionSlot(data, 'ghost_item')).toBe(false)
  })

  // 왜: 상속 키가 정의 행세를 하면 `constructor` 를 바치는 요청이 화면을 통과한다.
  it('상속 키는 칸이 아니다', () => {
    expect(isCollectionSlot(data, 'constructor')).toBe(false)
    expect(isCollectionSlot(data, 'toString')).toBe(false)
  })

  // 왜: 스택에는 상한이 없어 절벽 뒤 플레이어는 수만 개를 든다. 화면이 서버
  //     스키마 상한 위를 고르게 두면 bad_request 만 돌아온다(protocol 의 DonateCount).
  it('한 번에 바칠 수 있는 개수는 가진 만큼이되 요청 상한을 넘지 않는다', () => {
    expect(maxDonateCount(12)).toBe(12)
    expect(maxDonateCount(MAX_DONATE_COUNT + 500)).toBe(MAX_DONATE_COUNT)
  })
})

function slotOf(view: ReturnType<typeof buildCodex>, itemId: string) {
  const slot = view.lines.flatMap((l) => l.slots).find((s) => s.itemId === itemId)
  if (slot === undefined) throw new Error(`칸이 화면에 없다: ${itemId}`)
  return slot
}

describe('문턱까지 고르기 — 되돌릴 수 없는 행위에서 "정확히 그만큼"을 손이 닿는 곳에', () => {
  /*
   * 수량 고르개는 −/+/전부 셋뿐이라, 문턱까지 정확히 바치려면 +를 수천 번 눌러야
   * 한다. 실질 선택지가 "1개 아니면 전량"이 되는데, 그것은 헌납이 고치겠다고 한
   * 원작의 "전량 소멸"이 조작으로 되살아난 모양이다. 그래서 화면은 "다음 문턱까지"
   * 한 칸을 함께 준다. 이 함수는 그 칸이 몇 개인가만 답한다.
   */
  it('다음 문턱까지 모자란 만큼을 답한다 — 가진 것이 그보다 많을 때', () => {
    const steps = stepsOf('ice_shard')
    const count = donateToThresholdCount(steps[0], steps[0] + 999, {
      itemId: 'ice_shard',
      steps,
    })
    // 1단을 막 채운 사람의 다음 목표는 2단이고, 모자란 만큼은 t2 - t1 이다.
    expect(count).toBe(steps[1] - steps[0])
  })

  it('가진 것으로 문턱에 못 닿으면 답하지 않는다 — 있지도 않은 수량을 권하지 않는다', () => {
    const steps = stepsOf('ice_shard')
    expect(donateToThresholdCount(0, 1, { itemId: 'ice_shard', steps })).toBeNull()
  })

  it('가진 것이 정확히 모자란 만큼이면 답하지 않는다 — [전부] 가 이미 그 일을 한다', () => {
    const steps = stepsOf('ice_shard')
    expect(donateToThresholdCount(0, steps[0], { itemId: 'ice_shard', steps })).toBeNull()
  })

  it('만강인 칸은 답하지 않는다 — 더 오를 등급이 없다', () => {
    const steps = stepsOf('ice_shard')
    expect(
      donateToThresholdCount(steps[3], steps[3], { itemId: 'ice_shard', steps }),
    ).toBeNull()
  })

  it('한 요청 상한을 넘는 문턱은 답하지 않는다 — 서버가 bad_request 로 거절할 수량이다', () => {
    // 문턱이 상한보다 먼 칸을 지어낸다(출하 데이터에는 없다 — 상한이 100,000 이다).
    const steps: [number, number, number, number] = [1, MAX_DONATE_COUNT + 1, 2, 3]
    expect(
      donateToThresholdCount(1, MAX_DONATE_COUNT + 5, { itemId: 'made_up', steps }),
    ).toBeNull()
  })
})

describe('칸은 사다리 전체를 말한다 — 픽 넷을 그려 놓고 숫자 하나만 말하지 않는다', () => {
  /*
   * 화면은 등급 픽을 넷 그리는데 `nextStep` 은 그중 하나만 말한다. 그리고 숨은
   * 문턱은 첫 문턱보다 수백 배 크다(`ice_gem` 1 → 710, `gold_ore` 1 → 1,600).
   * 그래서 첫 개를 바치기 **전**에는 이 칸이 26분짜리인지 10시간짜리인지 알 길이
   * 없고, 그것을 아는 유일한 방법이 "되돌릴 수 없는 헌납을 한 번 해 보는 것"이
   * 된다 — 규범 §6-앞 3(숨기는 것은 없다)이 금지한 바로 그 모양이다.
   */
  it('만강 문턱을 잠긴 칸도 말한다 — 이 칸이 결국 몇 개짜리인가', () => {
    const view = buildCodex(data, emptyPlayer())
    const slots = view.lines.flatMap((line) => line.slots)
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect(slot.finalStep).toBe(stepsOf(slot.itemId)[3])
    }
  })

  it('만강 문턱은 다 채운 뒤에도 남는다 — `가득` 이 얼마짜리 가득인지 말한다', () => {
    const steps = stepsOf('ice_shard')
    const view = buildCodex(data, donatedPlayer({ ice_shard: steps[3] }))
    const slot = view.lines.flatMap((l) => l.slots).find((s) => s.itemId === 'ice_shard')
    expect(slot?.remaining).toBeNull()
    expect(slot?.finalStep).toBe(steps[3])
  })
})

describe('바친 개수를 세는 규칙은 총점과 같아야 한다', () => {
  /*
   * `collectionScore` 는 `Object.hasOwn` 으로 조회하고 그 이유를 주석에 적어 두었다
   * (세이브에서 온 객체라 상속 키가 정의 행세를 할 수 있다). `buildCodex` 가 맨손
   * 조회를 하면 같은 세이브에서 머리의 총점과 칸의 개수가 갈린다 — 플레이어가
   * 확인할 방법이 없는 거짓말이다.
   */
  it('상속된 키는 바친 것이 아니다 — 머리의 총점과 칸이 같은 답을 한다', () => {
    // 프로토타입에 얹은 값: 맨손 조회(`donated[id] ?? 0`)에는 잡히고 hasOwn 에는 안 잡힌다.
    const donated = Object.create({ ice_shard: 999_999 }) as Record<string, number>
    const view = buildCodex(data, { ...emptyPlayer(), donated })
    const slot = view.lines.flatMap((l) => l.slots).find((s) => s.itemId === 'ice_shard')
    expect(slot?.donated).toBe(0)
    expect(slot?.grade).toBe(0)
    expect(view.score).toBe(collectionScore(donated, data.collection))
  })
})

describe('머리가 실제 문을 가리킨다 — 만점은 문이 아니다', () => {
  /*
   * 헤더는 `총점 N/100` 만 적었는데, 100 은 문이 아니다. 실제로 무언가 열리는
   * 수는 30(흔한 것 되사기)과 60(귀한 것 되사기)이고, 그 수는 다른 패널(상세
   * 메뉴 이정표 탭)에만 있었다 — 게다가 신규 캐릭터에서는 그 넷이 전부 ratio 0
   * 이라 탭 맨 아래로 밀린다. 방이 자기 문을 모르면 "왜 모아야 하는가"의 답이
   * 화면 밖에 있다.
   */
  it('아직 안 넘은 가장 가까운 수집 문턱과 그 이름을 답한다', () => {
    const gate = nextCollectionGate(data.milestones, 0)
    expect(gate).not.toBeNull()
    expect(gate?.threshold).toBe(10)
  })

  it('넘은 문은 지나친다 — 31점이면 30 이 아니라 60 을 가리킨다', () => {
    expect(nextCollectionGate(data.milestones, 31)?.threshold).toBe(60)
  })

  it('문턱과 같은 점수는 이미 넘은 것이다 — 30점에서 다음은 60', () => {
    expect(nextCollectionGate(data.milestones, 30)?.threshold).toBe(60)
  })

  it('만점이면 가리킬 문이 없다', () => {
    expect(nextCollectionGate(data.milestones, 100)).toBeNull()
  })

  it('수집이 아닌 이정표는 쳐다보지 않는다 — 숙련 문턱이 방의 문일 수 없다', () => {
    const gate = nextCollectionGate(data.milestones, 0)
    const def = data.milestones.find((m) => m.threshold === gate?.threshold && m.name === gate?.name)
    expect(def?.metric.kind).toBe('collection')
  })
})
