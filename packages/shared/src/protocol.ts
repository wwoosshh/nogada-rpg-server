import { z } from 'zod'
import { emptyDialogueHistory } from './dialogue.js'
import { SKILL_IDS, type PlayerLocation, type SkillId } from './types.js'

export const ItemInstanceSchema = z.object({
  instanceId: z.string(),
  itemId: z.string(),
  enhanceLevel: z.number().int().min(0),
})

/**
 * SKILL_IDS 로부터 모양을 만든다 — 다섯 개를 손으로 나열하면 기술이 추가될 때
 * (명상·낚시·헌혈) 이 스키마가 갱신을 놓칠 수 있다.
 *
 * z.record(z.string(), ...) 였을 때는 `{}` 도, 키 하나만 있는 객체도 통과했다.
 * 이 스키마는 세이브 파일이 아직 유효한지 판단하는 유일한 게이트라서, 키가
 * 빠진 세이브가 통과하면 그 스킬은 서버에서 undefined 로 읽히고
 * proficiencyProgress(undefined, ...) 가 NaN 을 반환해 성공률이 NaN 이 되고,
 * rng() < NaN 은 항상 false 라 영원히 0% 성공률로 채집만 반복된다 — 에러도
 * 로그도 없이. .strict() 는 그 반대 방향(SKILL_IDS 에 없는 키)도 막는다.
 */
const skillsShape = Object.fromEntries(
  SKILL_IDS.map((id) => [id, z.number().int().min(0)]),
) as Record<SkillId, z.ZodNumber>

/**
 * DialogueHistory 의 저장 형태. said·recent 의 내용(onceKey 인코딩, 규칙 id)까지는
 * 검증하지 않는다 — 여기서는 "문자열 배열"과 "문자열 키를 가진 문자열 배열
 * 레코드"라는 모양만 본다. 내용이 가리키는 규칙이 사라졌더라도(콘텐츠 개정)
 * newlyAchieved 의 celebrated 처리와 같은 이유로 조용히 무시되어야 하지, 세이브
 * 전체를 거부할 이유가 아니다.
 */
const DialogueHistorySchema = z.object({
  said: z.array(z.string()),
  recent: z.record(z.string(), z.array(z.string())),
  // `.default({})` 라 이 필드가 생기기 전의 세이브도 그대로 통과한다. 없으면
  // 빈 기록으로 읽히고, 그건 "아직 아무와도 말해 본 적 없다"와 같은 뜻이라
  // 마이그레이션 없이 맞는 답이다 — 필수로 두면 기존 세이브가 통째로 버려진다.
  lastTalkAt: z.record(z.string(), z.number()).default({}),
})

const PlayerLocationSchema = z.object({
  mapId: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
})

/**
 * 이 필드가 생기기 전의 세이브가 떨어질 자리. dialogueHistory 와 같은 이유로
 * 존재하고, **리터럴이 아니라 함수인 이유도 같다** — zod 에 리터럴을 주면 그
 * 한 객체가 모든 파싱 결과에 물려 들어가서, 한 플레이어가 맵을 넘으면 다른
 * 플레이어의 위치까지 같이 움직인다.
 *
 * 맵 id 를 여기 글자로 적는다. packages/shared 는 packages/data 를 import 할 수
 * 없어서(게임 규칙이 데이터를 향해 의존하기 시작하면 규칙만 읽어서는 무슨 일이
 * 일어나는지 알 수 없게 된다) START_MAP_ID 를 볼 방법이 없다. 그래서 시작 맵을
 * 아는 곳이 둘이 되고, 그 둘이 갈라지는 순간은 서버 테스트가 잡는다
 * (store.test.ts 의 "location 이 생기기 전의 세이브도…"). 좌표는 world.tmx 의
 * spawn 오브젝트가 가리키는 칸이다.
 */
const defaultLocation = (): PlayerLocation => ({ mapId: 'world', x: 15, y: 16 })

export const PlayerStateSchema = z.object({
  id: z.string(),
  skills: z.object(skillsShape).strict(),
  stacks: z.record(z.string(), z.number().int().min(0)),
  instances: z.array(ItemInstanceSchema),
  equipped: z.record(z.string(), z.string()),
  nextActionAt: z.number(),
  celebrated: z.array(z.string()),
  // 안쪽 lastTalkAt 과 **같은 이유로** 바깥 필드에도 기본값을 단다. 안쪽만
  // 챙기고 바깥을 필수로 두면 그 배려가 닿는 세이브가 하나도 없다 —
  // dialogueHistory 자체가 대화 태스크에서 생긴 필드라, 그 전에 저장된
  // 플레이어는 이 키가 통째로 없어서 여기서 먼저 걸리고 readPlayers(store.ts)
  // 가 플레이어를 통째로 버린다. 숙련도도, 인벤토리도, 강화한 도구도, 넘긴
  // 이정표도 같이. 없는 이력은 "아직 아무와도 말해 본 적 없다"와 같은 뜻이라
  // 마이그레이션 없이 그것이 맞는 답이다.
  //
  // 기본값을 리터럴이 아니라 emptyDialogueHistory 로 주는 이유가 둘이다: 빈
  // 이력의 모양을 두 곳에 적지 않는 것이 하나이고(그 함수가 유일한 출처다),
  // zod 가 파싱마다 그 함수를 다시 불러 **새 객체**를 만들게 하는 것이 다른
  // 하나다 — 리터럴을 주면 세이브들이 같은 said 배열을 공유해서 한 플레이어가
  // 들은 말이 다른 플레이어에게도 "이미 말했다"가 된다.
  dialogueHistory: DialogueHistorySchema.default(emptyDialogueHistory),
  // dialogueHistory 와 **정확히 같은 이유로** 기본값을 단다. 이 필드는 다중 맵
  // 태스크에서 생겼으므로 그 전에 저장된 플레이어에게는 키가 통째로 없고,
  // 필수로 두면 readPlayers(store.ts)가 그 플레이어를 통째로 버린다 — 숙련도도
  // 인벤토리도 강화한 도구도 넘긴 이정표도 같이. 위치가 없는 세이브는 시작 맵의
  // 시작 칸에 있는 것과 같은 뜻이라 마이그레이션 없이 그것이 맞는 답이다.
  location: PlayerLocationSchema.default(defaultLocation),
})

export const StateResponseSchema = z.object({ player: PlayerStateSchema })
export type StateResponse = z.infer<typeof StateResponseSchema>

export const GatherRequestSchema = z.object({ instanceId: z.string().min(1) })
export type GatherRequest = z.infer<typeof GatherRequestSchema>

export const CraftRequestSchema = z.object({ recipeId: z.string().min(1) })
export type CraftRequest = z.infer<typeof CraftRequestSchema>

/**
 * 대화 요청. 화자 id 하나뿐이다.
 *
 * 어떤 줄이 나올지는 요청에 담기지 않는다 — 그것은 서버가 정하는 판정이고,
 * 클라이언트가 규칙 id 를 지목할 수 있게 하는 순간 대사가 곧 효과가 되는
 * 앞으로의 설계(설계 문서 4.5)에서 그 효과를 클라이언트가 고르게 된다.
 */
export const TalkRequestSchema = z.object({ speakerId: z.string().min(1) })
export type TalkRequest = z.infer<typeof TalkRequestSchema>

/**
 * 전환 요청. **밟은 칸**만 담는다 — 어디로 갈지는 담기지 않는다.
 *
 * TalkRequest 가 규칙 id 를 담지 않는 것과 같은 이유다. 목적지를 클라이언트가
 * 고를 수 있게 하는 순간, 요청 하나로 아무 맵 아무 칸에나 설 수 있다. 이 칸에
 * 전환이 있는지, 있다면 어디로 가는지는 서버가 data.transitions 에서 찾는다.
 *
 * 맵 id 를 함께 보내지 않는 것도 같은 이유다 — 지금 어느 맵에 있는지는 서버가
 * 이미 PlayerState.location 으로 안다.
 */
export const MoveRequestSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
})
export type MoveRequest = z.infer<typeof MoveRequestSchema>
