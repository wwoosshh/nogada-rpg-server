import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadGameData, startLocation } from '@nogada/data'
import {
  PlayerStateSchema,
  SKILL_IDS,
  STARTING_TOOL_IDS,
  emptyDialogueHistory,
  resolvePlayerLocation,
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
  const data = loadGameData()
  const items = data.items
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
    // 시작 자리는 시작 맵의 spawn 오브젝트가 유일한 출처다 — 좌표를 여기 적으면
    // 맵을 고쳐 그려도 따라오지 않는 숫자가 하나 생기고, 그 칸에 벽을 그린
    // 순간 새 플레이어가 전부 벽 속에서 시작한다(startLocation 참고).
    location: startLocation(data),
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

  const data = loadGameData()
  const start = startLocation(data)

  const out: Record<string, PlayerState> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const result = PlayerStateSchema.safeParse(value)
    if (result.success) {
      // result.data (원본 value 가 아니라 zod 가 만든 결과)를 그대로 쓸 수 있다.
      // skills 가 SKILL_IDS 키를 그대로 갖는 z.object 라 PlayerState.skills
      // (Record<SkillId, number>) 와 타입이 정확히 맞기 때문이다 — z.record 이던
      // 시절엔 파싱 결과의 키가 string 으로 넓어져 이 대입이 안 됐다.
      //
      // **위치는 여기서 보정한다.** 콘텐츠는 계속 바뀌는데 세이브는 남으므로,
      // maps.csv 에서 맵 id 를 바꾸거나 행을 지우면 없는 맵을 가리키는 세이브가
      // 남는다. 그대로 내보내면 클라이언트가 maps/<없는맵>.json 을 404 로 받은
      // 뒤 검은 화면으로 죽고, 게임 안에서 빠져나올 방법이 없다.
      //
      // 왜 하필 이 자리인가: 세이브 파일은 믿을 수 없는 데이터가 서버로 들어오는
      // **유일한 경계**다(그 밖의 모든 위치는 moveService 가 전환표에서 정한다).
      // 여기서 고쳐 두면 이후의 모든 읽기가, 그리고 다음 저장이 이미 성한 자리를
      // 갖는다 — /api/state 나 클라이언트에서 매번 다시 물을 필요가 없다.
      // 판정 자체는 packages/shared 가 갖는다: 어디에 있는가는 게임 규칙이고,
      // 서버는 그것을 플레이어 상태에 적용하는 주인이다.
      const location = resolvePlayerLocation(data, result.data.location, start)
      if (location !== result.data.location) {
        console.warn(
          `세이브의 플레이어 "${id}" 가 지금 없는 자리(${result.data.location.mapId} ` +
            `${result.data.location.x}, ${result.data.location.y})에 있어 시작 지점으로 되돌린다`,
        )
      }
      out[id] = { ...result.data, location }
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
