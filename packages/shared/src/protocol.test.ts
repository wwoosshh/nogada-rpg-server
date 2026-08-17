import { describe, expect, it } from 'vitest'
import { DEFAULT_APPEARANCE } from './appearance.js'
import { PlayerStateSchema } from './protocol.js'

/**
 * SKILL_IDS 다섯 개를 전부 채운 유효한 세이브. 각 테스트가 여기서 하나씩만
 * 어긋내 무엇이 그 위반을 잡아내는지 분명하게 한다.
 */
function validSave(): Record<string, unknown> {
  return {
    id: 'local',
    skills: { ice: 0, wood: 0, mineral: 0, herb: 0, crafting: 0 },
    stacks: { copper_ore: 3 },
    instances: [{ instanceId: 'i1', itemId: 'copper_pickaxe', enhanceLevel: 0 }],
    equipped: { mineral: 'i1' },
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: { said: [], recent: {} },
  }
}

describe('PlayerStateSchema', () => {
  it('다섯 숙련도 키가 모두 있는 완전한 세이브를 받아들인다', () => {
    expect(PlayerStateSchema.safeParse(validSave()).success).toBe(true)
  })

  // 전투 아크의 슬롯 확장(EquipSlot = SkillId | 'combat', §12-앞 8)이 세이브
  // 게이트를 스치지도 않는다는 증거 한 쌍. equipped 는 열린 레코드라 combat
  // 키가 있어도 없어도 통과하고, skills 는 다섯 키 그대로다 — SKILL_IDS 에
  // combat 을 넣는 길은 skillsShape(.strict()+필수)가 combat 키 없는 세이브
  // 전부를 버리게 만든다(재현됨). 이 테스트가 그 함정의 문지기다.
  it('combat 슬롯이 든 세이브도, 없는 구세이브도 받아들인다 — 착용은 열린 레코드라 슬롯이 늘어도 스키마는 그대로다', () => {
    // validSave() 가 곧 구세이브다: equipped 에 combat 없음, skills 는 다섯 키.
    expect(PlayerStateSchema.safeParse(validSave()).success).toBe(true)

    const armed = validSave()
    ;(armed.equipped as Record<string, string>).combat = 'i1'
    expect(PlayerStateSchema.safeParse(armed).success).toBe(true)
  })

  it('skills 에 combat 을 적은 세이브는 거부한다 — 전투 숙련은 기술 다섯이 아니라 전투 상태(설계 §6)의 몫이다', () => {
    const save = validSave()
    ;(save.skills as Record<string, number>).combat = 0
    expect(PlayerStateSchema.safeParse(save).success).toBe(false)
  })

  // skills 가 z.record 이던 시절엔 이 케이스가 통과했다 — 그러면 빠진 스킬은
  // 서버에서 undefined 로 읽히고, proficiencyProgress(undefined, ...) 는 NaN 을
  // 반환해 성공률이 NaN 이 되고, rng() < NaN 은 항상 false 라 그 스킬은 영원히
  // 0% 성공률로 채집만 반복된다 — 에러도 로그도 없이. 기술 목록이 늘어나는
  // 순간(명상·낚시·헌혈) 기존 세이브 전부가 이 상태에 빠진다.
  it('숙련도 키가 하나라도 빠지면 거부한다', () => {
    const save = validSave()
    const skills = save.skills as Record<string, number>
    delete skills.crafting

    expect(PlayerStateSchema.safeParse(save).success).toBe(false)
  })

  // 옛 스킬 id(mining 등)가 섞여 들어오는 경우를 잡는다 — SKILL_IDS 에 없는 키를
  // 조용히 허용하면 오타·구세대 세이브가 형식 검사를 통과해 버린다.
  it('알 수 없는 숙련도 키가 섞여 있으면 거부한다', () => {
    const save = validSave()
    const skills = save.skills as Record<string, number>
    skills.mining = 5

    expect(PlayerStateSchema.safeParse(save).success).toBe(false)
  })

  // dialogueHistory 가 없는 세이브는 형식이 깨진 것이 아니라 **그 필드가 생기기
  // 전의 것**이다. 거부하면 store.ts 의 readPlayers 가 플레이어를 통째로 버려
  // 숙련도도 인벤토리도 같이 사라진다.
  it('dialogueHistory 가 통째로 없는 옛 세이브를 빈 이력으로 받아들인다', () => {
    const save = validSave()
    delete save.dialogueHistory

    const parsed = PlayerStateSchema.safeParse(save)
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.dialogueHistory).toEqual({ said: [], recent: {}, lastTalkAt: {} })
  })

  // 왜: 이름·외형은 계정이 생긴 뒤의 필드다. dialogueHistory 와 같은 이유로
  //     기본값이 필요하다 — 필수로 두면 그 전에 저장된 세이브가 형식 오류로
  //     읽히지 않고, 숙련도도 강화한 도구도 같이 사라진다. 외형의 기본값이
  //     'player' 인 것은 그 세이브가 실제로 그 시트로 그려지고 있었기 때문이다.
  it('이름·외형이 없던 시절의 세이브도 기본값으로 살아난다', () => {
    const parsed = PlayerStateSchema.safeParse(validSave())

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.name).toBe('')
    expect(parsed.success && parsed.data.appearance).toBe(DEFAULT_APPEARANCE)
  })

  // 왜: 이 스키마는 **이미 저장된 것**을 읽는 게이트다. 사람이 방금 타이핑한
  //     이름을 보는 문(account.ts 의 요청 스키마)과 규칙이 같으면, 이름 규칙을
  //     조이는 날 이미 그 이름으로 놀던 사람의 세이브가 통째로 읽히지 않는다.
  it('생성 규칙에 어긋나는 이름이 든 세이브도 읽는다 — 규칙은 입력의 문에서만 본다', () => {
    const save = { ...validSave(), name: '한', appearance: '없어진외형' }

    expect(PlayerStateSchema.safeParse(save).success).toBe(true)
  })

  // 왜: gold 는 경제 아크에서 생긴 필드다. dialogueHistory·location 과 **정확히
  //     같은 이유로** 기본값이 필요하다 — 필수로 두면 그 전에 저장된 세이브가
  //     readPlayers 에서 통째로 버려지고, 숙련도도 강화한 도구도 함께 사라진다.
  //     돈이 없는 세이브는 "아직 아무것도 팔아 보지 않았다"와 같은 뜻이라 0 이
  //     마이그레이션 없이 맞는 답이다.
  it('gold 가 통째로 없는 옛 세이브를 0 원으로 받아들인다', () => {
    const parsed = PlayerStateSchema.safeParse(validSave())

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.gold).toBe(0)
  })

  it('적혀 있는 골드는 그대로 읽는다', () => {
    const parsed = PlayerStateSchema.safeParse({ ...validSave(), gold: 12345 })

    expect(parsed.success && parsed.data.gold).toBe(12345)
  })

  // 왜: 음수 골드는 어떤 경로로도 생길 수 없다(매수는 잔액을 먼저 본다). 세이브에
  //     그런 값이 있다면 손으로 고쳤거나 버그가 쓴 것이고, 둘 다 조용히 읽어
  //     들이면 안 된다 — stacks 의 min(0) 과 같은 부류의 게이트다.
  it('음수 골드는 거부한다 — 빚은 이 게임의 상태가 아니다', () => {
    expect(PlayerStateSchema.safeParse({ ...validSave(), gold: -1 }).success).toBe(false)
  })

  // 왜: rewarded 도 경제 아크에서 생긴 필드이고, gold 와 같은 이유로 기본값이
  //     필요하다. 그 기본값이 **빈 목록**이어야 하는 이유가 하나 더 있다 —
  //     다른 무엇으로 살아나면 달인이 준 적 없는 돈을 이미 받은 것으로 기억해,
  //     그 사람은 넘긴 문턱의 대금을 평생 못 받는다.
  it('rewarded 가 통째로 없는 옛 세이브를 빈 목록으로 받아들인다', () => {
    const parsed = PlayerStateSchema.safeParse(validSave())

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.rewarded).toEqual([])
  })

  it('적혀 있는 대금 기록은 그대로 읽는다', () => {
    const parsed = PlayerStateSchema.safeParse({ ...validSave(), rewarded: ['ice_master'] })

    expect(parsed.success && parsed.data.rewarded).toEqual(['ice_master'])
  })

  // 왜: story·storyCount 는 스토리 아크에서 생긴 필드다. gold 와 **정확히 같은
  //     이유로** 기본값이 필요하고, 이 아크에서는 그 대가가 특히 크다 — 게임은
  //     이미 공개돼 돌고 있어서 이 기본값이 없으면 **살아 있는 친구들 계정 전부**가
  //     readPlayers 에서 통째로 버려진다. 사슬을 한 번도 못 본 세이브는 "첫 마디에
  //     서 있다"와 같은 뜻이라 마이그레이션 없이 0 이 맞는 답이다.
  //
  //     그 사람들이 초보 안내를 안 받는 것은 이 기본값이 아니라 story.csv 의
  //     catchUp 이 진다(설계 ⑦) — 여기 0 은 "아직 아무 판정도 안 돌았다"일 뿐이다.
  it('story·storyCount 가 통째로 없는 옛 세이브를 첫 마디로 받아들인다', () => {
    const parsed = PlayerStateSchema.safeParse(validSave())

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.story).toBe(0)
    expect(parsed.success && parsed.data.storyCount).toBe(0)
  })

  it('적혀 있는 마디와 델타는 그대로 읽는다', () => {
    const parsed = PlayerStateSchema.safeParse({ ...validSave(), story: 3, storyCount: 77 })

    expect(parsed.success && parsed.data.story).toBe(3)
    expect(parsed.success && parsed.data.storyCount).toBe(77)
  })

  // 왜: 마디도 델타도 더하기로만 움직인다 — 음수나 소수는 어떤 경로로도 생기지
  //     않으므로 있다면 손으로 고쳤거나 버그가 쓴 것이다(gold·stacks 와 같은 게이트).
  it('음수·소수 마디는 거부한다', () => {
    expect(PlayerStateSchema.safeParse({ ...validSave(), story: -1 }).success).toBe(false)
    expect(PlayerStateSchema.safeParse({ ...validSave(), storyCount: 1.5 }).success).toBe(false)
  })

  // 왜: 사슬은 CSV 가 정하는 게임 값이라 길이가 늘어난다. 여기 상한을 박아 두면
  //     사슬을 늘리는 날 이미 끝낸 사람의 세이브가 통째로 거절된다 — hp 에 상한
  //     검증을 안 거는 것과 같은 자리다.
  it('지금 사슬보다 큰 마디 번호도 읽는다 — 상한은 데이터의 것이지 게이트의 것이 아니다', () => {
    expect(PlayerStateSchema.safeParse({ ...validSave(), story: 9999 }).success).toBe(true)
  })

  // 왜: weather 는 제작 확장 아크에서 생긴 필드다. gold·rewarded 와 **정확히 같은
  //     이유로** 기본값이 필요하다 — 필수로 두면 그 전에 저장된 세이브가
  //     readPlayers 에서 통째로 버려진다. 가루를 쓴 적 없는 세이브는 "지금 하늘에
  //     아무 일도 없다"와 같은 뜻이라 null 이 마이그레이션 없이 맞는 답이다.
  it('weather 가 통째로 없는 옛 세이브를 맑은 하늘(null)로 받아들인다', () => {
    const parsed = PlayerStateSchema.safeParse(validSave())

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.weather).toBeNull()
  })

  it('적혀 있는 날씨는 그대로 읽는다', () => {
    const weather = { kind: 'snow', untilMs: 1_767_225_600_000 }
    const parsed = PlayerStateSchema.safeParse({ ...validSave(), weather })

    expect(parsed.success && parsed.data.weather).toEqual(weather)
  })

  // 왜: 모르는 날씨가 통과하면 그 값은 사실로 공급되고(facts.ts), 어떤 대사
  //     조건과도 안 맞으면서 화면은 그릴 수 없는 하늘을 그리려 든다. 값의 목록은
  //     WEATHER_KINDS 하나가 소유하고 세이브의 문도 그것으로 잠근다.
  it('알 수 없는 날씨 종류가 든 세이브는 거부한다', () => {
    const save = { ...validSave(), weather: { kind: 'storm', untilMs: 1 } }

    expect(PlayerStateSchema.safeParse(save).success).toBe(false)
  })

  // 왜: 기본값이 리터럴 하나뿐이면 세이브 둘이 **같은 배열**을 물려받을 수 있다.
  //     그러면 한 사람이 얼음 달인에게 받은 기록이 다른 사람에게도 "이미 받음"
  //     으로 보여 100만 골드가 조용히 사라진다 — 빈 이력이 파싱마다 새로
  //     만들어져야 하는 것과 정확히 같은 이유다.
  it('파싱할 때마다 새 빈 목록을 만든다 — 세이브 둘이 같은 rewarded 를 공유하면 안 된다', () => {
    const first = PlayerStateSchema.parse(validSave())
    const second = PlayerStateSchema.parse(validSave())

    first.rewarded.push('ice_master')
    expect(second.rewarded).toEqual([])
  })

  // 왜: donated 는 수집의 방 아크에서 생긴 필드다. gold·rewarded 와 같은 이유로
  //     기본값이 필요하고, 아무것도 안 바친 세이브는 "방이 통째로 비어 있다"와
  //     같은 뜻이라 빈 객체가 마이그레이션 없이 맞는 답이다.
  it('donated 가 통째로 없는 옛 세이브를 빈 방으로 받아들인다', () => {
    const parsed = PlayerStateSchema.safeParse(validSave())

    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.donated).toEqual({})
  })

  it('적혀 있는 헌납 기록은 그대로 읽는다', () => {
    const parsed = PlayerStateSchema.safeParse({ ...validSave(), donated: { copper_ore: 130 } })

    expect(parsed.success && parsed.data.donated).toEqual({ copper_ore: 130 })
  })

  it('음수 헌납은 거부한다 — 헌납은 더하기만 하므로 음수는 손으로 고친 파일이거나 버그가 쓴 것이다', () => {
    expect(PlayerStateSchema.safeParse({ ...validSave(), donated: { copper_ore: -1 } }).success).toBe(false)
  })

  // 왜: rewarded 와 정확히 같은 사고인데 대가가 더 크다 — 참조형 기본값이
  //     리터럴이면 세이브 둘이 **같은 객체**를 물려받고, 한 사람이 바친 것이
  //     다른 사람의 방과 총점에 나타난다. 그때 총점은 아무도 재현할 수 없는
  //     수가 되고, 그 수로 열린 되사기 진열도 마찬가지다(§6-앞 10 이 이
  //     규칙을 필드 이름과 함께 못박은 이유).
  it('파싱할 때마다 새 빈 방을 만든다 — 세이브 둘이 같은 donated 를 공유하면 안 된다', () => {
    const first = PlayerStateSchema.parse(validSave())
    const second = PlayerStateSchema.parse(validSave())

    first.donated['copper_ore'] = 130
    expect(second.donated).toEqual({})
  })

  it('파싱할 때마다 새 빈 이력을 만든다 — 세이브 둘이 같은 배열을 공유하면 안 된다', () => {
    const first = PlayerStateSchema.parse((() => { const s = validSave(); delete s.dialogueHistory; return s })())
    const second = PlayerStateSchema.parse((() => { const s = validSave(); delete s.dialogueHistory; return s })())

    first.dialogueHistory.said.push('노인.greet.abc')
    expect(second.dialogueHistory.said).toEqual([])
  })

  // 왜: 전투 상태(설계 §6)는 통째로 `.default()` 라 마이그레이션 0 이어야 한다 —
  //     combat 키가 없는 세이브는 전투 아크 이전의 모든 세이브다. 필수로 두면
  //     readPlayers 가 그 플레이어를 숙련도·인벤토리째 통째로 버린다.
  it('combat 이 통째로 없는 옛 세이브를 만혈·무교전으로 받아들인다', () => {
    const parsed = PlayerStateSchema.parse(validSave())
    expect(parsed.combat).toEqual({
      proficiency: 0,
      hp: 100,
      lastHitAt: 0,
      lastClaim: null,
      hunt: null,
      slain: {},
    })
  })

  it('적혀 있는 전투 상태는 그대로 읽는다', () => {
    const save = {
      ...validSave(),
      combat: {
        proficiency: 42, hp: 61, lastHitAt: 5, lastClaim: { mapId: '사냥터', x: 1, y: 2, atMs: 9 },
        hunt: { instanceId: 'wolf-1', monsterHp: 3 }, slain: { 'wolf-2': 7 },
      },
    }
    const parsed = PlayerStateSchema.parse(save)
    expect(parsed.combat.proficiency).toBe(42)
    expect(parsed.combat.lastClaim).toEqual({ mapId: '사냥터', x: 1, y: 2, atMs: 9 })
    expect(parsed.combat.hunt).toEqual({ instanceId: 'wolf-1', monsterHp: 3 })
    expect(parsed.combat.slain).toEqual({ 'wolf-2': 7 })
  })

  // 왜: mapId 는 lastClaim 에 나중에 들어온 칸이다(전환 공회전, §2-3). 그 전에
  //     적힌 세이브를 통째로 거절하면 칸 하나 때문에 캐릭터가 죽는다 — '' 는
  //     어느 맵과도 다른 이름이라 개연성 검사가 한 번 공회전할 뿐이다.
  it('mapId 가 없는 옛 lastClaim 은 빈 이름으로 받는다', () => {
    const save = {
      ...validSave(),
      combat: { proficiency: 0, hp: 100, lastHitAt: 0, lastClaim: { x: 1, y: 2, atMs: 9 }, hunt: null, slain: {} },
    }
    const parsed = PlayerStateSchema.parse(save)
    expect(parsed.combat.lastClaim).toEqual({ mapId: '', x: 1, y: 2, atMs: 9 })
  })

  it('파싱할 때마다 새 전투 상태를 만든다 — 세이브 둘이 같은 slain 을 공유하면 안 된다', () => {
    const first = PlayerStateSchema.parse(validSave())
    const second = PlayerStateSchema.parse(validSave())

    first.combat.slain['wolf-1'] = 123
    expect(second.combat.slain).toEqual({})
  })
})
