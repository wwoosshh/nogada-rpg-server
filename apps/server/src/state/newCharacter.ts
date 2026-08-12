import { randomUUID } from 'node:crypto'
import { loadGameData, villageField } from '@nogada/data'
import {
  SKILL_IDS,
  emptyDialogueHistory,
  starterToolFor,
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
 * 신규 플레이어. 시작 마을 기술의 구리 도구 **하나**로 코어 루프의 첫 바퀴를 시작한다.
 *
 * 4종 지급(구 STARTING_TOOL_IDS)이 1종으로 줄어든 이유(설계 §2): 첫 도구를
 * **만드는** 순간이 있어야 한다 — 다 쥐고 시작하면 "맨손으로 힘겹게 모아 첫
 * 도구를 만들자 채집이 빨라진다"는 첫날의 이야기 자체가 없다. 어느 도구인가는
 * 여기 적지 않는다: 마을→기술은 세계의 생김새(villageField)가, 기술→도구는
 * 카탈로그 유도(starterToolFor)가 정하고, 유도가 성립하는 데이터인지는
 * `packages/data` 의 빌드 검증("채집 기술마다 1티어 도구 정확히 하나 +
 * requiredSkill 0 레시피")이 먼저 지킨다.
 */
export function createInitialPlayer(spec: NewCharacterSpec): PlayerState {
  const data = loadGameData()

  const village = data.maps[spec.village]
  // 라우트가 고를 수 있는 마을인지 먼저 본다 — 여기 닿았다면 검사를 건너뛴 것이다.
  if (!village) throw new Error(`시작 마을 "${spec.village}" 이 맵 등록부에 없다`)

  const field = villageField(data, spec.village)
  const starter = starterToolFor(field.skill, data.items)

  const instanceId = randomUUID()
  const instances: ItemInstance[] = [{ instanceId, itemId: starter.id, enhanceLevel: 0 }]
  // 나머지 기술의 슬롯은 비워 둔다 — 빈 슬롯이 신규 캐릭터의 상태다(§4).
  // 첫 도구 제작의 자동 착용이 그 빈 칸을 채우는 순간이 이 게임의 첫 드라마다(§1).
  const equipped: Partial<Record<SkillId, string>> = { [field.skill]: instanceId }

  const skills = Object.fromEntries(SKILL_IDS.map((skill) => [skill, 0])) as Record<SkillId, number>

  return {
    id: spec.id,
    name: spec.name,
    appearance: spec.appearance,
    skills,
    stacks: {},
    // 빈손으로 시작한다 — 첫 골드는 캔 것을 상점에 팔아서 번다(설계 §2).
    // 시작 지급을 골드로 주면 "캔 것이 값이 된다"는 첫 순간이 사라진다.
    gold: 0,
    instances,
    equipped,
    nextActionAt: 0,
    celebrated: [],
    // 달인의 대금은 하나도 받지 않은 채로 시작한다 — 가장 낮은 문턱도 7,587
    // 이고, 그 숫자는 캐서 넘는 것이지 시작할 때 주어지는 것이 아니다.
    rewarded: [],
    dialogueHistory: emptyDialogueHistory(),
    // 하늘에는 아무 일도 없다 — 날씨는 얼음 계열의 가루를 만들어 써야 걸린다.
    weather: null,
    // 시작 자리는 **고른 마을의** spawn 오브젝트가 유일한 출처다 — 좌표를 여기
    // 적으면 맵을 고쳐 그려도 따라오지 않는 숫자가 하나 생기고, 그 칸에 벽을 그린
    // 순간 그 마을을 고른 사람이 전부 벽 속에서 시작한다.
    location: { mapId: village.id, x: village.spawn.x, y: village.spawn.y },
  }
}
