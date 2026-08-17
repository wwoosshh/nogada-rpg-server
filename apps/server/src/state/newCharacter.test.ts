import {
  START_MAP_ID,
  WORLD_MAP_ID,
  emptyPlayer,
  loadGameData,
  startLocation,
  startVillages,
  storyChainOf,
  storyVillage,
} from '@nogada/data'
import { DEFAULT_APPEARANCE, SKILL_IDS, type SkillId } from '@nogada/shared'
import { describe, expect, it } from 'vitest'
import { createInitialPlayer } from './newCharacter.js'

/** 고른 것을 매번 적지 않는다 — 이 스위트가 보는 것은 고른 뒤에 게임이 정하는 나머지다. */
const born = (id: string, village = START_MAP_ID) =>
  createInitialPlayer({ id, name: '아무개', appearance: DEFAULT_APPEARANCE, village })

/**
 * 마을 → 시작 도구 대응(설계 §2). 코드는 이 표를 어디에도 적지 않고
 * `villageField(마을).skill` → `starterToolFor` 로 유도한다 — 그래서 테스트가
 * 이 표를 **글자로** 들고 있어야 한다. 유도의 어느 고리(전환표·노드 배치·
 * items.csv 의 toolTier)가 바뀌어 약속이 조용히 달라지면 여기가 잡는다.
 */
const VILLAGE_STARTER: Record<string, { skill: SkillId; toolId: string }> = {
  눈의마을: { skill: 'ice', toolId: 'copper_chisel' },
  숲의마을: { skill: 'wood', toolId: 'copper_axe' },
  북동쪽마을: { skill: 'mineral', toolId: 'copper_pickaxe' },
  항구마을: { skill: 'herb', toolId: 'copper_sickle' },
}

describe('createInitialPlayer', () => {
  it('다섯 생활기술을 숙련도 0으로 시작한다', () => {
    expect(born('local').skills).toEqual({ ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 })
  })

  // 왜: 시작 지급이 4종에서 1종으로 줄었다(§2 — 첫 도구 "제작"의 순간을 만들려고).
  //     마을의 채집장이 가르치는 기술의 도구 하나만 손에 쥐고, 나머지는 맨손으로
  //     힘겹게 모아 첫 도구를 만드는 것이 첫날의 이야기다.
  it('마을마다 그 마을 채집장 기술의 구리 도구 하나만 지급하고 착용시킨다', () => {
    for (const [village, expected] of Object.entries(VILLAGE_STARTER)) {
      const p = born('local', village)
      expect(p.instances.map((i) => i.itemId)).toEqual([expected.toolId])
      expect(p.instances[0]!.enhanceLevel).toBe(0)
      expect(p.equipped[expected.skill]).toBe(p.instances[0]!.instanceId)
    }
  })

  // 왜: 빈 슬롯이 신규 캐릭터의 상태다(§4 — 해제 없음의 근거이자 §6-앞 16 의
  //     "빈 칸 4"). 다른 기술 슬롯이 채워져 있으면 첫 도구 제작의 자동 착용이
  //     "빈 칸이 채워지는" 드라마가 아니라 교체가 된다.
  it('지급한 기술 외의 슬롯은 전부 비어 있다', () => {
    for (const [village, expected] of Object.entries(VILLAGE_STARTER)) {
      const p = born('local', village)
      for (const skill of SKILL_IDS) {
        if (skill !== expected.skill) expect(p.equipped[skill]).toBeUndefined()
      }
    }
  })

  // 왜: 위 대응표는 마을 넷을 글자로 안다. 세계에 마을이 늘거나 이름이 바뀌면
  //     이 표가 낡는데, 낡은 표로는 위 두 테스트가 새 마을을 그냥 지나친다 —
  //     그래서 목록 자체가 표와 일치하는지 못박는다.
  it('시작 마을 목록(startVillages)이 대응표의 마을들과 정확히 같다', () => {
    const villages = startVillages(loadGameData()).map((m) => m.id)
    expect([...villages].sort()).toEqual(Object.keys(VILLAGE_STARTER).sort())
  })

  it('인스턴스 ID 는 플레이어마다 다르다', () => {
    expect(born('a').instances[0]!.instanceId).not.toBe(born('b').instances[0]!.instanceId)
  })

  it('인벤토리 스택은 비어 있다', () => {
    expect(born('local').stacks).toEqual({})
  })

  // 왜: 시작 자금을 주면 "캔 것을 팔아 첫 돈을 번다"는 경제의 첫 순간이 사라진다
  //     (설계 §2). 빈손이 신규 캐릭터의 상태라는 점에서 빈 스택·빈 슬롯과 같은 줄이다.
  it('빈손으로 시작한다 — 첫 골드는 채집한 것을 팔아서 번다', () => {
    expect(born('local').gold).toBe(0)
  })

  // 왜: 유도등이 겨냥한 사람이 정확히 이 사람이다(퀘스트 설계 ③ — 첫 3.5분).
  //     빈손·빈 스택·빈 슬롯과 같은 줄의 "아직 아무것도 하지 않았다" 이고, 첫 값이
  //     어긋나면 신규가 사슬 한가운데에서 시작해 띠가 「가방을 열어 바쳐라」부터
  //     말한다. 세이브 게이트(protocol.test.ts)는 **옛 세이브의 기본값**만 보므로
  //     신규의 첫 값은 여기서만 물린다.
  it('사슬의 첫 마디에서, 아직 아무것도 세지 않은 채로 시작한다', () => {
    expect([born('local').story, born('local').storyCount]).toEqual([0, 0])
  })

  // 왜: `emptyPlayer` 는 "신규와 같은 상태" 를 흉내 낸다고 스스로 적어 두었고
  //     (packages/data 의 emptyPlayer.ts), 대사 시뮬레이터(`pnpm content dialogue`)와
  //     공급자↔선언 드리프트 검사가 그 약속 위에 선다. 두 벌이 갈라지면 시뮬레이터가
  //     신규에게 안 뜨는 대사를 뜬다고 말한다 — 두 값이 함께 보이는 자리는 여기뿐이다.
  it('대사 시뮬레이터의 빈 플레이어도 같은 첫 마디에 선다', () => {
    const empty = emptyPlayer()
    expect([empty.story, empty.storyCount]).toEqual([0, 0])
    expect([empty.story, empty.storyCount]).toEqual([born('local').story, born('local').storyCount])
  })

  // 왜: 이름과 외형은 사람이 고른 것이고, 상태가 그것의 원본이다(설계 규범 4).
  //     생성이 이 둘을 흘리면 캐릭터를 만든 다음 화면이 남의 이름을 보여 준다.
  it('고른 이름과 외형이 상태에 그대로 남는다', () => {
    const p = createInitialPlayer({ id: 'x', name: '노가다', appearance: 'elder', village: START_MAP_ID })
    expect(p.name).toBe('노가다')
    expect(p.appearance).toBe('elder')
  })

  // 왜: 시작 칸 (15, 16) 은 예전에 서버·프로토콜·시뮬레이터 세 곳에 글자로
  //     박혀 있었고, 셋을 서로 묶는 테스트는 있어도 **맵에 묶는 것은
  //     아무것도 없었다** — 시작 맵의 그 칸에 벽을 그리면 새 플레이어가
  //     전부 벽 속에서 시작한다. 이제 시작 칸은 맵의 spawn 오브젝트가 갖고,
  //     여기서 그 둘이 같은 값인지 못 박는다.
  it('시작 칸은 시작 맵의 spawn 오브젝트가 가리키는 칸이다', () => {
    const data = loadGameData()
    const p = born('local')
    expect(p.location).toEqual(startLocation(data))
    expect(p.location).toEqual({
      mapId: '눈의마을',
      x: data.maps['눈의마을']!.spawn.x,
      y: data.maps['눈의마을']!.spawn.y,
    })
  })

  // 왜: "시작 마을 = 첫 숙련도" 가 이 게임의 설계인데, 고른 마을이 자리에
  //     반영되지 않으면 넷 다 같은 곳에서 시작한다 — 고르게 한 것이 거짓이 된다.
  it('고른 마을의 spawn 에서 시작한다 — 마을마다 다른 자리다', () => {
    const data = loadGameData()
    const places = new Set<string>()

    for (const village of startVillages(data)) {
      const p = born('local', village.id)
      expect(p.location).toEqual({ mapId: village.id, x: village.spawn.x, y: village.spawn.y })
      places.add(`${p.location.mapId}:${p.location.x},${p.location.y}`)
    }

    expect(places.size).toBe(startVillages(data).length)
  })

  // 왜: 없는 맵을 받아 조용히 시작 맵으로 떨어뜨리면, 고른 마을과 선 자리가
  //     다른 캐릭터가 생기고 아무도 그것을 모른다.
  it('없는 마을로는 캐릭터를 만들지 않는다', () => {
    expect(() => born('local', '없는마을')).toThrow('없는마을')
  })

  // 왜: 고른 마을은 **유도로 복원이 안 되는 사실**이다(PlayerState.startVillage).
  //     여기서 안 적으면 세계 어디에도 안 남고, 숙련이 전부 0 인 채로 월드맵에
  //     한 칸 나가는 순간 유도가 전환표 첫 마을(눈의마을)을 낸다 — 북동쪽마을을
  //     고른 사람이 「눈의 마을 북문으로 나가라」를 읽는다. 자리(location)만으로는
  //     안 된다: 그 값은 걸을 때마다 바뀐다.
  it('고른 마을을 상태에 적는다 — 걸어 나가도 안 지워지는 유일한 기록이다', () => {
    for (const village of startVillages(loadGameData())) {
      expect(born('local', village.id).startVillage).toBe(village.id)
    }
  })

  // 왜: 그리고 그 값이 실제로 **그 마을의 사슬**을 편다. 위 검사는 글자가 적혔다는
  //     것만 말하고, 그 글자를 아무도 안 읽어도 초록이다.
  it('네 마을이 각자 자기 사슬을 걷는다 — 자리가 어디든', () => {
    const data = loadGameData()
    for (const village of startVillages(data)) {
      const p = born('local', village.id)
      // 마을에서 한 칸 나갔다. 유도라면 여기서 전부 눈의마을이 된다.
      p.location = { mapId: WORLD_MAP_ID, x: 1, y: 1 }
      expect([village.id, storyVillage(data, p).id]).toEqual([village.id, village.id])
      expect(storyChainOf(data, p)[0]!.objective).toContain(village.name)
    }
  })
})
