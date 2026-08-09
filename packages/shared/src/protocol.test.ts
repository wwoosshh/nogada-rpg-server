import { describe, expect, it } from 'vitest'
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

  it('파싱할 때마다 새 빈 이력을 만든다 — 세이브 둘이 같은 배열을 공유하면 안 된다', () => {
    const first = PlayerStateSchema.parse((() => { const s = validSave(); delete s.dialogueHistory; return s })())
    const second = PlayerStateSchema.parse((() => { const s = validSave(); delete s.dialogueHistory; return s })())

    first.dialogueHistory.said.push('노인.greet.abc')
    expect(second.dialogueHistory.said).toEqual([])
  })
})
