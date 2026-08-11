import { randomUUID } from 'node:crypto'
import { loadGameData } from '@nogada/data'
import {
  SKILL_IDS,
  STARTING_TOOL_IDS,
  emptyDialogueHistory,
  type ItemInstance,
  type PlayerState,
  type SkillId,
} from '@nogada/shared'

/**
 * 사람이 캐릭터 생성 화면에서 고른 것. 나머지는 전부 게임이 정한다.
 *
 * 마을을 **맵 id 로** 받는 이유: 시작 마을은 곧 첫 자리이고, 그 자리는 그 맵의
 * spawn 오브젝트가 갖고 있다(설계 §4). 좌표를 넘겨받으면 맵을 고쳐 그려도
 * 따라오지 않는 숫자가 하나 생긴다.
 */
export interface NewCharacterSpec {
  id: string
  name: string
  appearance: string
  /** 시작 마을의 맵 id. 고를 수 있는 마을 목록은 데이터가 정한다(startVillages). */
  village: string
}

/**
 * 신규 플레이어. 시작 도구 하나로 코어 루프의 첫 바퀴를 시작할 수 있다.
 *
 * 시작 장비는 `STARTING_TOOL_IDS` 가 유일한 출처다. 여기에 아이템 ID 를 다시 적으면
 * 진실 공급원이 둘로 갈라진다 — `packages/data` 의 빌드 타임 검증도 그 상수를 보고
 * "시작 도구가 실재하는 도구인가" 와 "무엇이 채집·제작으로 도달 가능한가" 를 판단한다.
 */
export function createInitialPlayer(spec: NewCharacterSpec): PlayerState {
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

  const village = data.maps[spec.village]
  // 라우트가 고를 수 있는 마을인지 먼저 본다 — 여기 닿았다면 검사를 건너뛴 것이다.
  if (!village) throw new Error(`시작 마을 "${spec.village}" 이 맵 등록부에 없다`)

  return {
    id: spec.id,
    name: spec.name,
    appearance: spec.appearance,
    skills,
    stacks: {},
    instances,
    equipped,
    nextActionAt: 0,
    celebrated: [],
    dialogueHistory: emptyDialogueHistory(),
    // 시작 자리는 **고른 마을의** spawn 오브젝트가 유일한 출처다 — 좌표를 여기
    // 적으면 맵을 고쳐 그려도 따라오지 않는 숫자가 하나 생기고, 그 칸에 벽을 그린
    // 순간 그 마을을 고른 사람이 전부 벽 속에서 시작한다.
    location: { mapId: village.id, x: village.spawn.x, y: village.spawn.y },
  }
}
