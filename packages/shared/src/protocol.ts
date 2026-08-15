import { z } from 'zod'
import { DEFAULT_APPEARANCE } from './appearance.js'
import { COMBAT_MAX_HP, defaultCombatState } from './combatState.js'
import { emptyDialogueHistory } from './dialogue.js'
import { SKILL_IDS, type PlayerLocation, type SkillId } from './types.js'
import { WEATHER_KINDS } from './weather.js'

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
  // `.min(1)` 이 없다. 아래 기본값이 빈 맵 id 를 자리표시자로 쓰기 때문이다.
  mapId: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
})

/**
 * 이 필드가 생기기 전의 세이브가 떨어질 자리. dialogueHistory 와 같은 이유로
 * 존재하고, **리터럴이 아니라 함수인 이유도 같다** — zod 에 리터럴을 주면 그
 * 한 객체가 모든 파싱 결과에 물려 들어가서, 한 플레이어가 맵을 넘으면 다른
 * 플레이어의 위치까지 같이 움직인다.
 *
 * **왜 시작 맵의 이름이 아니라 빈 문자열인가:** packages/shared 는
 * packages/data 를 import 할 수 없다(게임 규칙이 데이터를 향해 의존하기
 * 시작하면 규칙만 읽어서는 무슨 일이 일어나는지 알 수 없게 된다). 여기 "world"
 * 라고 적으면 시작 맵을 아는 곳이 둘이 되고, 좌표까지 적으면 맵을 고쳐 그려도
 * 따라오지 않는 숫자가 하나 더 생긴다 — 이 태스크가 없앤 바로 그 종류다.
 *
 * 그래서 이 값은 "위치를 모른다"는 뜻의 자리표시자다. 빈 맵 id 는 maps.csv 가
 * 절대 만들 수 없으므로(requireCell 이 빈 칸을 거절한다) 어떤 등록부에도 없고,
 * 서버가 세이브를 읽는 자리에서 `resolvePlayerLocation` 이 **반드시** 이것을
 * 시작 맵의 spawn 으로 바꾼다. 모양만 맞춰 놓고 값은 주인에게 맡기는 것이다.
 */
const defaultLocation = (): PlayerLocation => ({ mapId: '', x: 0, y: 0 })

/**
 * 저장된 하늘. 종류의 목록은 `WEATHER_KINDS`(weather.ts) 하나가 소유한다 —
 * 여기 'rain'·'snow' 를 다시 적으면 날씨가 늘어나는 날 이 문만 옛 목록으로 남아
 * 새 날씨를 쓴 세이브를 통째로 거부한다.
 *
 * `untilMs` 에 하한을 걸지 않는다. 이미 지난 시각은 "그친 날씨"라는 정상적인
 * 상태이고(만료를 지우러 오는 작업이 없다), 그것을 거부하면 며칠 만에 돌아온
 * 사람의 세이브가 읽히지 않는다.
 */
const PlayerWeatherSchema = z.object({
  kind: z.enum(WEATHER_KINDS),
  untilMs: z.number(),
})

/**
 * 저장된 전투 상태(전투 설계 §6). **모든 칸에 기본값이 있다** — combat 키가
 * 통째로 없는 세이브(전투 아크 이전의 전부)가 그대로 통과해야 하기 때문이다
 * (마이그레이션 0). 전투 숙련이 `skills` 가 아니라 여기 사는 이유가 그 반대편이다:
 * skillsShape 는 `.strict()`+필수라 키 하나를 넣는 순간 구세이브가 통째로
 * 거절된다(재현됨, §12-앞 8).
 *
 * `hp` 에 상한 검증을 걸지 않는 이유: 상한(COMBAT_MAX_HP)은 언젠가 장비로
 * 늘어날 수 있는 게임 값이고, 그때 이 문이 옛 상수로 남으면 새 상한의 세이브를
 * 통째로 거절한다 — 이름 규칙을 세이브 게이트에서 안 보는 것과 같은 자리다.
 */
const CombatStateSchema = z.object({
  proficiency: z.number().int().min(0).default(0),
  hp: z.number().min(0).default(COMBAT_MAX_HP),
  lastHitAt: z.number().default(0),
  lastClaim: z
    .object({
      // mapId 가 없는 옛 칸(C4 초판이 쓴 세이브)은 '' 로 받는다 — 어느 맵과도
      // 다른 이름이라 개연성 검사가 한 번 공회전할 뿐, 세이브는 안 깨진다.
      mapId: z.string().default(''),
      x: z.number().int(),
      y: z.number().int(),
      atMs: z.number(),
    })
    .nullable()
    .default(null),
  hunt: z.object({ instanceId: z.string(), monsterHp: z.number() }).nullable().default(null),
  // 함수 기본값 — 리터럴이면 세이브 둘이 같은 slain 을 공유한다(donated 와 같다).
  slain: z.record(z.string(), z.number()).default(() => ({})),
})

export const PlayerStateSchema = z.object({
  id: z.string(),
  // 이름과 외형은 계정·캐릭터 생성에서 생긴 필드라, 그 전에 저장된 세이브에는
  // 키가 통째로 없다. dialogueHistory·location 과 **정확히 같은 이유로** 기본값을
  // 단다 — 필수로 두면 옛 세이브가 형식 오류로 통째로 읽히지 않는다.
  //
  // 입력 규칙(2~12자, 목록에 있는 외형)을 여기 걸지 **않는** 이유: 이 스키마는
  // 이미 저장된 것을 읽는 게이트이지 사람이 방금 타이핑한 것을 보는 문이 아니다.
  // 규칙은 언젠가 조여지는데(금지어, 외형 목록에서 하나 뺌) 그때 이 스키마가
  // 그것을 강제하면 이미 그 이름으로 놀던 사람의 세이브가 읽히지 않는다.
  // 사람이 적는 것을 보는 문은 account.ts 의 요청 스키마다.
  name: z.string().default(''),
  appearance: z.string().default(DEFAULT_APPEARANCE),
  skills: z.object(skillsShape).strict(),
  stacks: z.record(z.string(), z.number().int().min(0)),
  // gold·rewarded 와 **같은 이유로** 기본값을 단다: 이 필드는 수집의 방 아크에서
  // 생겼으므로 그 전에 저장된 플레이어에게는 키가 통째로 없고, 필수로 두면
  // readPlayers(store.ts)가 그 플레이어를 통째로 버린다 — 숙련도도 인벤토리도
  // 강화한 도구도 같이. 아무것도 안 바친 세이브는 "방이 통째로 비어 있다"와 같은
  // 뜻이라 마이그레이션 없이 빈 객체가 맞는 답이다.
  //
  // 기본값이 **함수**인 이유는 dialogueHistory 와 같다(§6-앞 10 이 이 규칙을
  // 이름으로 못박았다): 참조형 리터럴을 주면 키가 없는 세이브들이 zod 가 만든
  // **같은 객체 하나**를 공유해서, 한 사람이 바친 것이 다른 사람의 방에도
  // 나타난다. 그때 총점은 아무도 재현할 수 없는 수가 된다.
  //
  // `.min(0)` 인 이유는 stacks 와 같다 — 헌납은 더하기만 하므로 음수는 어떤
  // 경로로도 생기지 않는다.
  donated: z.record(z.string(), z.number().int().min(0)).default(() => ({})),
  // dialogueHistory·location 과 **정확히 같은 이유로** 기본값을 단다: 이 필드는
  // 경제 아크에서 생겼으므로 그 전에 저장된 플레이어에게는 키가 통째로 없고,
  // 필수로 두면 readPlayers(store.ts)가 그 플레이어를 통째로 버린다 — 숙련도도
  // 인벤토리도 강화한 도구도 넘긴 이정표도 같이. 돈이 없는 세이브는 "아직
  // 아무것도 팔아 보지 않았다"와 같은 뜻이라 0 이 맞는 답이다.
  //
  // `.min(0)` 인 이유는 stacks 와 같다 — 음수 잔고는 어떤 경로로도 생기지 않으므로
  // (매수는 잔액을 먼저 본다) 있다면 손으로 고친 것이거나 버그가 쓴 것이다.
  gold: z.number().int().min(0).default(0),
  instances: z.array(ItemInstanceSchema),
  equipped: z.record(z.string(), z.string()),
  nextActionAt: z.number(),
  celebrated: z.array(z.string()),
  // gold 와 **같은 이유로** 기본값을 단다: 이 필드는 경제 아크에서 생겼으므로 그
  // 전에 저장된 플레이어에게는 키가 통째로 없고, 필수로 두면 readPlayers(store.ts)
  // 가 그 플레이어를 통째로 버린다. 아무에게도 대금을 받지 않은 세이브는 "아직
  // 그 문턱을 넘고 말을 걸어 본 적 없다"와 같은 뜻이라 빈 목록이 맞는 답이다 —
  // 그리고 그 사람은 조건을 이미 넘겼다면 다음 대화에서 제 몫을 받는다.
  rewarded: z.array(z.string()).default([]),
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
  //
  // 그 "시작 칸"이 무엇인지는 여기서 정하지 않는다 — defaultLocation 참고.
  location: PlayerLocationSchema.default(defaultLocation),
  // gold·rewarded 와 **정확히 같은 이유로** 기본값을 단다: 이 필드는 제작 확장
  // 아크에서 생겼으므로 그 전에 저장된 플레이어에게는 키가 통째로 없고, 필수로
  // 두면 readPlayers(store.ts)가 그 플레이어를 통째로 버린다 — 숙련도도
  // 인벤토리도 강화한 도구도 넘긴 이정표도 같이. 가루를 쓴 적 없는 세이브는
  // "지금 하늘에 아무 일도 없다"와 같은 뜻이라 null 이 마이그레이션 없이 맞는
  // 답이다.
  //
  // 여기 기본값은 리터럴이어도 된다 — dialogueHistory·location 이 함수를 쓰는
  // 이유(세이브 둘이 같은 객체를 물려받아 한쪽의 변경이 다른 쪽에 보인다)가
  // null 에는 없다. 값을 고쳐 쓰는 곳도 없다: 날씨는 언제나 통째로 새 객체로
  // 덮어써진다(useService).
  weather: PlayerWeatherSchema.nullable().default(null),
  // gold·weather 와 **정확히 같은 이유로** 기본값을 단다: 전투 아크 전의 세이브에는
  // 이 키가 통째로 없다. 기본값이 함수인 이유는 dialogueHistory 와 같다 — 안쪽
  // slain 이 참조형이라, 리터럴이면 세이브 둘이 같은 기록을 공유한다.
  combat: CombatStateSchema.default(defaultCombatState),
})

export const StateResponseSchema = z.object({ player: PlayerStateSchema })
export type StateResponse = z.infer<typeof StateResponseSchema>

export const GatherRequestSchema = z.object({ instanceId: z.string().min(1) })
export type GatherRequest = z.infer<typeof GatherRequestSchema>

export const CraftRequestSchema = z.object({ recipeId: z.string().min(1) })
export type CraftRequest = z.infer<typeof CraftRequestSchema>

/**
 * 착용 요청. 인스턴스 하나뿐이다 — 어느 슬롯에 낄지는 담기지 않는다(§6-앞 11).
 *
 * 슬롯은 그 도구의 toolSkill 이 정한다(§4). 클라이언트가 슬롯을 고를 수 있게
 * 하는 순간 요청 하나로 곡괭이를 허브 슬롯에 끼울 수 있다 — TalkRequest 가
 * 규칙 id 를 담지 않는 것과 같은 이유다.
 */
export const EquipRequestSchema = z.object({ instanceId: z.string().min(1) })
export type EquipRequest = z.infer<typeof EquipRequestSchema>

/**
 * 강화 요청. **재료** 인스턴스 하나뿐이다 — 대상은 담기지 않는다(§6-앞 11).
 *
 * 대상은 "같은 itemId 의 착용 중 인스턴스"라는 규칙(§5)이 정한다. 대상까지
 * 받으면 규칙 밖의 조합(다른 itemId 로의 강화)을 요청이 표현할 수 있게 된다.
 */
export const EnhanceRequestSchema = z.object({ materialInstanceId: z.string().min(1) })
export type EnhanceRequest = z.infer<typeof EnhanceRequestSchema>

/**
 * 사용 요청. 아이템 id 하나뿐이다.
 *
 * 개수는 담기지 않는다 — 거래(SellRequest)와 정반대의 이유다. 거래는 판정 대상의
 * 크기를 사람만 알지만, 사용은 **언제나 하나**다: 둘을 한 번에 써도 두 번째가
 * 첫 번째를 덮어쓸 뿐이라(남은 시간은 버려진다, useService) 개수를 받는 순간
 * 요청 하나로 "돈만 배로 나가는" 조합을 표현할 수 있게 된다.
 *
 * 무슨 효과가 나는지도 담기지 않는다 — 그것은 아이템 정의(`useEffect`)가 정하는
 * 판정이고, 요청이 고를 수 있게 하면 100원짜리 가루로 3시간짜리 하늘을 산다.
 */
export const UseRequestSchema = z.object({ itemId: z.string().min(1) })
export type UseRequest = z.infer<typeof UseRequestSchema>

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
 * 수량. **요청이 수량을 담는 첫 사례**이고, 앞선 요청들의 최소성(EquipRequest·
 * EnhanceRequest·TalkRequest·MoveRequest 가 각자 그 이유를 적는다)에 대한 예외다.
 *
 * **왜 예외인가:** 앞의 것들이 요청에서 뺀 값은 전부 **서버가 규칙으로 유도할 수
 * 있는 것**이었다 — 슬롯은 그 도구의 toolSkill 이, 강화 대상은 "같은 itemId 의
 * 착용 인스턴스"가, 목적지는 밟은 칸의 전환이 정한다. 담으면 요청 하나로 규칙
 * 밖의 조합을 표현할 수 있게 되므로 뺐다. 수량은 그런 값이 아니다. "가진 것
 * 전부"로 정하면 하나만 팔고 싶은 사람이 그것을 말할 방법이 없고, "언제나 하나"로
 * 정하면 999개를 파는 데 요청 999번이 든다. 수량은 판정의 결과가 아니라 **판정
 * 대상의 크기**이고, 그것을 아는 것은 사람뿐이다.
 *
 * 그래서 상한은 스키마가 든다. `.int()` 가 NaN·Infinity·소수를 막고(`0.5`개를
 * 팔면 스택은 소수가 되고 골드는 내림으로 사라진다), `.max(999)` 가 총액이
 * `Number.MAX_SAFE_INTEGER` 를 넘겨 잔고 비교가 무의미해지는 요청을 막는다 —
 * 999 는 원작의 소지 상한이라 "한 번에 다 판다"에 모자라지도 않는다.
 */
const TradeCount = z.number().int().min(1).max(999)

/**
 * 매도 요청. 어느 상점에, 무엇을, 몇 개.
 *
 * 값은 담기지 않는다 — 매도가는 `sellPrice` 가 정하는 유도값이고, 클라이언트가
 * 값을 보낼 수 있게 하는 순간 요청 하나로 자기 물건에 자기가 값을 매긴다.
 * 상점 id 를 담는 이유는 그 반대다: **누구에게 파는가**는 유도할 수 없다(같은
 * 재료를 사 주는 상점이 여럿일 수 있고, 접근 판정도 상점마다 다르다).
 */
export const SellRequestSchema = z.object({
  shopId: z.string().min(1),
  itemId: z.string().min(1),
  count: TradeCount,
})
export type SellRequest = z.infer<typeof SellRequestSchema>

/** 매수 요청. 모양이 매도와 같다 — 판정만 반대편이다(진열·잔고·중복). */
export const BuyRequestSchema = z.object({
  shopId: z.string().min(1),
  itemId: z.string().min(1),
  count: TradeCount,
})
export type BuyRequest = z.infer<typeof BuyRequestSchema>

/**
 * 헌납 수량. **거래의 999(`TradeCount`)를 쓰지 않는다**(설계 §6-앞 12) — 그
 * 상한은 원작의 소지 상한이라는 근거가 있었는데, `stacks` 에는 그런 상한이 없다.
 * 절벽(숙련 50만) 뒤 사람은 흔한 칸을 분당 수백 개씩 캔다(수집 형평 검증 주석의
 * 실측: 금 원석 536.8개/분) — 하루만 놔둬도 스택이 수만이 된다. 999 로 묶으면
 * 그 스택 하나를 방에 옮기는 데만 수십 번을 눌러야 하고, 그것은 "숨기는 것은
 * 없다"(§6-앞 3)의 반대편 실패다 — 방이 칸을 보여주고는 채우기를 지루하게 만든다.
 *
 * 100,000 은 문턱표의 가장 큰 4단(금 원석 16,000)보다 한 자릿수 이상 여유를 두어
 * 방문 한 번으로 어떤 칸이든 4단까지 채울 수 있게 하면서도, `.int()` 와 함께
 * 총액이 `Number.MAX_SAFE_INTEGER` 를 넘겨 소지 비교가 무의미해지는 요청은
 * 여전히 막는다 — TradeCount 가 999 로 하는 것과 같은 자리의 방어다.
 */
const DonateCount = z.number().int().min(1).max(100_000)

/**
 * 헌납 요청. 무엇을, 몇 개.
 *
 * 상점 id 가 없다 — 거래와 달리 **누구에게 바치는가를 고를 자리가 없다**: 방은
 * 하나뿐이고 위치·시각과도 무관하다(§6-앞 12 — 접근 판정도 행동 간격도 없다).
 * 등급이 오르는가는 담기지 않는다 — 그것은 `collectionGrade`(shared)가 정하는
 * 유도값이라, 요청이 등급을 보낼 수 있게 하면 클라이언트가 제 등급을 스스로
 * 매기게 된다.
 */
export const DonateRequestSchema = z.object({
  itemId: z.string().min(1),
  count: DonateCount,
})
export type DonateRequest = z.infer<typeof DonateRequestSchema>

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

/**
 * 전투 요청(전투 설계 §2-2). 배치 인스턴스와 **주장 칸** — 어느 쪽도 판정 결과를
 * 담지 않는다: 명중·피격·처치는 전부 서버가 monsterStateAt 으로 정하는 판정이고,
 * 클라이언트가 그것을 보낼 수 있게 하면 요청 하나로 자기 명중을 자기가 매긴다.
 *
 * (x, y) 는 MoveRequest 처럼 주장이다 — 서버는 걸음마다 위치를 받지 않으므로
 * 참을 알 수 없고, 대신 속도 개연성(claimPlausible)이 주장 사이의 일관성을 문다.
 */
export const FightRequestSchema = z.object({
  instanceId: z.string().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
})
export type FightRequest = z.infer<typeof FightRequestSchema>
