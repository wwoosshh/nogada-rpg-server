import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { START_MAP_ID, loadGameData } from '@nogada/data'
import {
  PlayerStateSchema,
  SKILL_IDS,
  STARTING_TOOL_IDS,
  emptyDialogueHistory,
  type ItemInstance,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'

/**
 * 신규 플레이어. 시작 도구 하나로 코어 루프의 첫 바퀴를 시작할 수 있다.
 *
 * 시작 장비는 `STARTING_TOOL_IDS` 가 유일한 출처다. 여기에 아이템 ID 를 다시 적으면
 * 진실 공급원이 둘로 갈라진다 — `packages/data` 의 빌드 타임 검증도 그 상수를 보고
 * "시작 도구가 실재하는 도구인가" 와 "무엇이 채집·제작으로 도달 가능한가" 를 판단한다.
 */
export function createInitialPlayer(id: string): PlayerState {
  const items = loadGameData().items
  const instances: ItemInstance[] = []
  const equipped: Partial<Record<SkillId, string>> = {}

  for (const toolId of STARTING_TOOL_IDS) {
    const def = items[toolId]
    // packages/data 의 검증이 빌드 타임에 막아 주므로 여기 도달하면 데이터가 어긋난 것이다.
    // 조용히 넘기면 곡괭이 없는 플레이어가 생겨 코어 루프가 시작부터 막힌다.
    if (!def) throw new Error(`STARTING_TOOL_IDS: 존재하지 않는 아이템 "${toolId}"`)
    if (!def.toolSkill) throw new Error(`STARTING_TOOL_IDS: "${toolId}" 에 toolSkill 이 없다`)

    const instanceId = randomUUID()
    instances.push({ instanceId, itemId: toolId, enhanceLevel: 0 })
    equipped[def.toolSkill] = instanceId
  }

  const skills = Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as Record<SkillId, number>

  return {
    id,
    skills,
    stacks: {},
    instances,
    equipped,
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
    // 시작 맵은 START_MAP_ID 가 유일한 출처다 — 도달 가능성 검증도 같은 상수에서
    // 출발한다. 칸은 world.tmx 의 spawn 오브젝트가 가리키는 자리다. protocol.ts 의
    // 옛 세이브 기본값과 같아야 하고, 그 일치는 store.test.ts 가 지킨다.
    location: { mapId: START_MAP_ID, x: 15, y: 16 },
  }
}

/**
 * 저장 파일을 읽되 형식이 맞지 않는 항목은 버린다.
 *
 * 숙련도 자료형이 바뀌었으므로 이전 세이브를 그대로 신뢰하면 객체를 숫자로 더하는
 * 식의 오류가 판정 한복판에서 터진다. 마이그레이션하지 않기로 한 이상, 조용히
 * 버리고 새로 만드는 편이 낫다 — 개발용 세이브 하나뿐이다.
 *
 * 실제 유저 데이터가 생기기 전에 이 결정을 뒤집어야 한다.
 */
function readPlayers(filePath: string): Record<string, PlayerState> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    console.warn('세이브 파일을 읽지 못해 버린다')
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null) return {}

  const out: Record<string, PlayerState> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const result = PlayerStateSchema.safeParse(value)
    if (result.success) {
      // result.data (원본 value 가 아니라 zod 가 만든 결과)를 그대로 쓸 수 있다.
      // skills 가 SKILL_IDS 키를 그대로 갖는 z.object 라 PlayerState.skills
      // (Record<SkillId, number>) 와 타입이 정확히 맞기 때문이다 — z.record 이던
      // 시절엔 파싱 결과의 키가 string 으로 넓어져 이 대입이 안 됐다.
      out[id] = result.data
    } else {
      console.warn(`세이브의 플레이어 "${id}" 가 현재 형식과 맞지 않아 버린다`)
    }
  }
  return out
}

/**
 * M1 저장소 — JSON 파일 한 개.
 * M4 에서 PostgreSQL 로 교체하되 get/save 인터페이스는 유지한다.
 */
export class PlayerStore {
  private players: Record<string, PlayerState>

  constructor(private readonly filePath: string) {
    this.players = existsSync(filePath) ? readPlayers(filePath) : {}
  }

  /** 깊은 복사본을 돌려준다. 호출자가 마음대로 고쳐도 save 전까지 반영되지 않는다. */
  get(id: string): PlayerState {
    const existing = this.players[id]
    if (existing) return structuredClone(existing)

    const created = createInitialPlayer(id)
    this.players[id] = created
    this.persist()
    return structuredClone(created)
  }

  save(player: PlayerState): void {
    this.players[player.id] = structuredClone(player)
    this.persist()
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.players, null, 2), 'utf8')
  }
}
