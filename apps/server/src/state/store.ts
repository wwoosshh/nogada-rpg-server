import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadGameData } from '@nogada/data'
import {
  SKILL_IDS,
  STARTING_TOOL_IDS,
  type ItemInstance,
  type PlayerState,
  type SkillId,
  type SkillState,
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

  const skills = Object.fromEntries(
    SKILL_IDS.map((skill) => [skill, { level: 1, xp: 0 }]),
  ) as Record<SkillId, SkillState>

  return { id, skills, stacks: {}, instances, equipped, nodeCooldowns: {} }
}

/**
 * M1 저장소 — JSON 파일 한 개.
 * M4 에서 PostgreSQL 로 교체하되 get/save 인터페이스는 유지한다.
 */
export class PlayerStore {
  private players: Record<string, PlayerState>

  constructor(private readonly filePath: string) {
    this.players = existsSync(filePath)
      ? (JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, PlayerState>)
      : {}
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
