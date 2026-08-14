import type { CollectionTable } from './collection.js'
import type { DialogueHistory, DialogueRule } from './dialogue.js'
import type { MilestoneDef } from './milestones.js'
import type { Direction, TilePos } from './movement.js'
import type { PlayerWeather, WeatherKind } from './weather.js'

export type SkillId = 'ice' | 'wood' | 'mineral' | 'herb' | 'crafting'

export const SKILL_IDS: readonly SkillId[] = ['ice', 'wood', 'mineral', 'herb', 'crafting'] as const

export const SKILL_LABELS: Record<SkillId, string> = {
  ice: '얼음',
  wood: '나무',
  mineral: '광물',
  herb: '허브',
  crafting: '조합',
}

// STARTING_TOOL_IDS 는 은퇴했다(설계 §6-앞 8) — 시작 지급은 도구 4종이 아니라
// 마을 하나의 도구 1개이고, 그 도구는 상수가 아니라 유도(equipment.ts 의
// starterToolFor: "kind=tool ∧ toolTier=1 ∧ toolSkill=마을 기술")로 정해진다.
// 유도가 성립하는지는 packages/data 의 빌드 검증이 지킨다.

/**
 * 강화 수치가 붙는 순간 개별 정체성이 생겨 스택이 불가능하다.
 * `enhanceLevel` 은 0~ENHANCE_CAP(+5) 이고, 중복 도구를 재료로 먹여 오른다(설계 §5).
 */
export interface ItemInstance {
  instanceId: string
  itemId: string
  enhanceLevel: number
}

/**
 * 플레이어가 있는 곳.
 *
 * `x`·`y` 는 픽셀이 아니라 **타일 좌표**다 — NodePlacement·SpeakerDef 의 x·y 와
 * 같은 값 공간이라 "이 노드가 내 맵에 있는가" 를 변환 없이 바로 비교할 수 있다.
 */
export interface PlayerLocation {
  mapId: string
  x: number
  y: number
}

export interface PlayerState {
  id: string
  /**
   * 캐릭터 이름. 생성할 때 정하고 **유일하지 않다** — 유일성은 계정 아이디가
   * 담당하고 이것은 표시용이다(설계 §4).
   *
   * 상태가 원본이고 `characters.name` 칸은 저장할 때 찍는 사본이다(설계 규범 4).
   * 사람이 DB 를 들여다볼 때 JSONB 를 헤집지 않으려고 두는 칸이지, 읽는 곳은
   * 아니다 — 둘이 갈라지면 이기는 쪽은 언제나 상태다.
   */
  name: string
  /**
   * 외형 id. `APPEARANCES` 중 하나이고 **불투명하다** — 이 값이 시트 파일
   * 이름이라고 가정하지 않는다(클라이언트 매니페스트가 잇는다).
   *
   * 지금은 순수 외형이다. 직업 시스템이 생기면 이 선택 위에 얹는다(설계 §4).
   */
  appearance: string
  /**
   * 기술별 숙련도. 그 행동을 성공한 누적량이며 상한이 없다.
   * 레벨도 경험치도 없다 — 이 숫자 하나가 속도·성공률·수량을 전부 정한다.
   */
  skills: Record<SkillId, number>
  /** 재료·소모품 — itemId 를 키로 개수만 센다 */
  stacks: Record<string, number>
  /**
   * 수집의 방에 **바친** 누적 개수. itemId 를 키로 세고, 칸(채집물 25종)의 것만
   * 뜻이 있다(설계 §6-앞 4·10).
   *
   * `stacks` 와 모양은 같지만 성격이 반대다 — 저쪽은 가진 것이고 이쪽은 **태운
   * 것**이다. 헌납은 되돌릴 수 없으므로(§7 훅) 이 수는 줄지 않고, 그래서
   * 등급·총점을 여기서 다시 계산할 수 있다(`collectionScore`). 등급 자체를
   * 저장하지 않는 이유는 `celebrated` 가 달성 여부를 저장하지 않는 것과 같다:
   * 유도할 수 있는 값을 저장하면 계산값과 어긋날 수 있다.
   *
   * 스키마에는 `.default(() => ({}))` 가 붙는다(protocol.ts) — gold·rewarded 와
   * 같은 이유이고, **참조형이라 기본값이 함수여야 한다**: 리터럴을 주면 세이브
   * 여럿이 같은 객체를 물려받아 한 사람의 헌납이 다른 사람에게도 보인다
   * (dialogueHistory 가 emptyDialogueHistory 를 넘기는 그 자리다).
   */
  donated: Record<string, number>
  /**
   * 가진 돈(정수, 신규 0). 캔 것을 팔면 늘고 사면 준다(설계 §2).
   *
   * 스키마에는 `.default(0)` 이 붙는다(protocol.ts) — 이 필드가 생기기 전의
   * 세이브에는 키가 통째로 없어서, 필수로 두면 그 플레이어가 숙련도·인벤토리·
   * 강화한 도구까지 통째로 버려진다. 돈이 없는 세이브는 "아직 아무것도 팔아
   * 보지 않았다"와 같은 뜻이라 마이그레이션 없이 0 이 맞는 답이다.
   */
  gold: number
  /** 장비·도구 — 개별 행 */
  instances: ItemInstance[]
  /** 생활기술별 착용 도구의 instanceId */
  equipped: Partial<Record<SkillId, string>>
  /**
   * 다음 행동이 가능한 시각 (epoch ms, 서버 시계 기준).
   *
   * 노드별 쿨다운이 아니라 플레이어당 하나다. 원작에 노드 리스폰 개념이 없고,
   * 속도를 정하는 것은 노드가 아니라 행동 간격이다. 기술별로 나누면 여러 기술을
   * 번갈아 눌러 실질 속도를 배로 올릴 수 있다.
   */
  nextActionAt: number
  /**
   * 이미 축하한 이정표 id.
   *
   * 달성 여부 자체는 저장하지 않는다 — 지표가 전부 단조 증가라 PlayerState 로부터
   * 계산되고, 저장하면 계산값과 어긋날 수 있다. 여기 남기는 것은 "두 번 축하하지
   * 않기" 뿐이고 그건 틀려도 피해가 없다.
   */
  celebrated: string[]
  /**
   * 이미 대금을 받은 달인 id(`masters.csv` 의 id).
   *
   * `celebrated` 와 모양은 같지만 성격이 다르다. 이정표는 지표가 단조 증가라
   * 달성 여부를 상태에서 다시 계산할 수 있고, celebrated 는 "두 번 축하하지
   * 않기"일 뿐이라 틀려도 피해가 없다. 이것은 **돈이 걸린 진짜 상태**다 —
   * 여기 남지 않으면 같은 달인이 같은 금액을 다시 준다.
   *
   * 그래서 대사 이력(`said`)에 맡기지 않는다(설계 §6-앞 2): once 사건의
   * `onceKey` 는 조건의 지금 값을 함께 엮으므로, 숙련도가 계속 오르는 동안
   * 말을 걸 때마다 새 키가 되어 무한 지급이 된다.
   */
  rewarded: string[]
  /**
   * 대화 이력.
   *
   * 이정표의 celebrated 와 달리 이것은 유도할 수 없는 진짜 상태다 — 대화는
   * 단조 증가하는 지표가 아니라서 PlayerState 로부터 계산할 수 없다.
   * recent 는 상대마다 최근 몇 개로 묶어 무한히 자라지 않게 한다.
   */
  dialogueHistory: DialogueHistory
  /**
   * 어느 맵 어느 칸에 있는가.
   *
   * 걸음마다 서버에 보내지 않는다 — 전투도 PvP 도 없어서 칸 단위 동기화가
   * 필요 없고, 노가다 루프에 왕복 지연을 얹게 된다. 맵을 넘을 때만 갱신하며,
   * 그때 도착 칸은 서버가 정한다(moveService).
   *
   * 그래서 맵 **안**의 x·y 는 마지막 전환 직후의 값이라 지금 서 있는 칸과
   * 다를 수 있다. 판정에 쓰는 것은 mapId 뿐이고, x·y 는 새로고침했을 때
   * 어디에 세울지에만 쓴다.
   */
  location: PlayerLocation
  /**
   * 지금 이 사람의 하늘. 가루를 쓴 적이 없거나 이미 그쳤으면 `null` 이다.
   *
   * **날씨는 전역이 아니라 개인 상태다**(설계 §6-앞 4). 전역으로 두면 가루 하나로
   * 남의 세계를 바꾸는 권한이 생긴다 — 아무나 100원짜리 가루를 연타해 모든
   * 플레이어의 하늘을 점거할 수 있고, 그때 "왜 내 하늘이 이런가"에 답할 수 있는
   * 화면이 이 게임에는 없다. 개인 상태라면 그 하늘은 그것을 산 사람의 것이고,
   * 대사도 그 사람에게만 달라진다.
   *
   * 만료는 저장된 타이머가 아니라 시각 비교다(`activeWeather`, weather.ts) —
   * 그친 날씨를 지우러 오는 작업이 없으므로 만료된 값이 그대로 남아 있을 수
   * 있고, 그것이 정상이다.
   *
   * 스키마에는 `.default(null)` 이 붙는다(protocol.ts) — gold·rewarded 와 정확히
   * 같은 이유다. 이 필드가 생기기 전의 세이브에는 키가 통째로 없어서, 필수로
   * 두면 그 플레이어가 숙련도·인벤토리·강화한 도구까지 통째로 버려진다.
   */
  weather: PlayerWeather | null
}

export interface ItemDef {
  id: string
  name: string
  kind: 'material' | 'tool'
  toolSkill?: SkillId
  toolTier?: number
  icon: string
  /**
   * 정가(매수가). 매도가는 이 값의 절반이고, 그 계산은 formulas/price.ts 하나가 소유한다.
   *
   * **선택이 아니라 필수다**(설계 §6-앞 15). 선택으로 두면 "0원"과 "가격을 안
   * 적었다"가 같은 `undefined` 로 뭉쳐서, "쓸 곳도 팔 곳도 없는 아이템"을 잡는
   * 검사(§6-앞 13)가 값을 빠뜨린 행을 조용히 통과시킨다. `price=0` 은 값이
   * 없다는 뜻이 아니라 **팔 수 없다**는 뜻이다(도구가 그렇다).
   */
  price: number
  /**
   * 이 아이템이 속한 계열. 상점이 무엇을 사 주는지가 여기서 나온다(설계 §6-앞 10).
   *
   * 사다리 소속은 지금까지 서버 전용 산출물(gather-tables.json)에만 있어서
   * 클라이언트가 "이 상점에 팔 수 있는 것"을 그릴 수단이 없었다. 여기 드러내는
   * 것은 **소속뿐**이고 순서(=티어=숨은 문턱)는 여전히 서버에만 남으므로
   * 스포일러 금지 규범과 충돌하지 않는다.
   *
   * 도구는 비운다(팔 수 없으니 상점 계열을 물을 일이 없다). 주괴는 사다리 밖이지만
   * `mineral` 을 적는다 — 제련은 광물의 일이고, 그래야 광물상점이 사 준다.
   */
  skill?: SkillId
  /**
   * 증표 효과. 가지고만 있으면(개수 무관) 그 계열 채집에 곱해진다(설계 §5).
   *
   * **새 `kind` 를 만들지 않는 이유**(§6-앞 11): `kind='token'` 을 넣으면
   * `BagPanel` 의 `kind !== 'material'` 가드가 수십만 골드짜리 물건을 가방에서
   * 조용히 숨긴다 — switch 가 아니라 비교라서 컴파일도 통과한다. 그래서 증표는
   * 재료이고, 증표임은 이 선택 칸 하나로만 드러난다.
   *
   * 효과를 실제로 곱하는 것은 `GatherHand` 하나뿐이다(E3) — 여기 있는 것은
   * "무엇인가"이지 "얼마인가"가 아니다.
   */
  tokenEffect?: TokenEffect
  /**
   * 쓰면 무슨 일이 일어나는가. 없으면 **쓸 수 없다** — 재료는 대부분 그렇다.
   *
   * 이 칸 하나가 "사용"이라는 행위의 유일한 자격이다(서버의 `performUse`,
   * 클라이언트의 [사용] 버튼). 증표가 새 `kind` 를 만들지 않은 것과 같은
   * 이유로 여기도 선택 칸이다: `kind='consumable'` 을 만들면 가방 패널의
   * `kind !== 'material'` 가드가 가루를 조용히 숨긴다.
   */
  useEffect?: UseEffect
}

/**
 * 사용 효과. 지금은 날씨 하나뿐이지만 `kind` 를 두는 것은 훅을 위해서가 아니라
 * **판정하는 쪽이 무엇을 받았는지 스스로 알아야 하기 때문**이다 — 포션·주문서가
 * 붙는 날 `performUse` 가 분기해야 할 자리가 여기 하나로 드러난다.
 *
 * `minutes` 는 **게임 분**이다(실측 ms 가 아니다). 실측으로 옮기는 환산은
 * `weatherEndsAt`(weather.ts) 하나가 소유한다.
 */
export type UseEffect = { kind: 'weather'; weather: WeatherKind; minutes: number }

/** 증표가 무엇을 곱하는가. `speed` 는 채집 간격을, `sight` 는 표 굴림을 건드린다. */
export type TokenEffect = 'speed' | 'sight'

export const TOKEN_EFFECTS: readonly TokenEffect[] = ['speed', 'sight'] as const

/**
 * 진열 한 칸을 여는 것이 무엇인가 — 숙련이거나, 수집의 방 총점이거나.
 *
 * `skill` 이 재는 것은 언제나 **그 상점의 `skill`** 이다(설계 §6-앞 14). 품목마다
 * 다른 기술을 재게 하면 "얼음상점에서 나무 숙련을 요구하는 칸"이 만들어지고,
 * 그것은 화면에서 되짚을 수 없는 종류의 데이터 오류다. `collection` 이 재는 것은
 * 방 하나뿐이라 애초에 고를 것이 없다(§6-앞 7 의 되사기 진열).
 */
export type ShopUnlockKind = 'skill' | 'collection'

/**
 * 상점 진열 한 칸 — 그 상점이 파는 물건 하나와, 그것을 여는 문턱 **하나**.
 *
 * **두 칸이 아니라 종류 + 값인 이유:** `unlockSkill` 과 `unlockCollection` 을
 * 나란히 두면 "둘 다 적힌 칸"과 "둘 다 빈 칸"이 타입 안에서 표현 가능해지고,
 * 그때 무엇이 이기는지를 판정(tradeService)과 화면(shopModel)이 각자 정하게
 * 된다 — 이 저장소가 이미 한 번 데인 자리다(표시된 규칙과 판정된 규칙의 분기).
 * 한 칸은 정확히 한 문으로 열린다는 것을 모양이 강제하고, CSV 의 두 칸을 이
 * 모양으로 접는 일은 파서 한 곳이 한다(`parseShops`).
 */
export interface ShopStockEntry {
  itemId: string
  /** 무엇이 이 칸을 여는가. */
  unlockBy: ShopUnlockKind
  /** 그 값이 얼마 이상이어야 열리는가. 0 은 "처음부터 열려 있다"이지 빈칸이 아니다. */
  unlockAt: number
}

/**
 * 상점 하나. **대사가 아니라 이 등록부가 상점의 유일한 출처다**(설계 §6-앞 1).
 *
 * 한때 상점은 대사 규칙에 붙는 효과(`!shop=`)로 열릴 예정이었다. 그러면 한 번도
 * 안 열린다 — `selectDialogue` 는 조건이 가장 많은 규칙만 남기는데 네 화자의
 * 거래 암시 규칙은 전부 조건 둘이라 조건 하나짜리 상점 규칙이 언제나 진다.
 * 그래서 `talkService` 는 **이긴 규칙과 무관하게** `speakerId` 로 여기를 조회한다:
 * 대사는 안내이고, 문은 상태가 연다.
 */
export interface ShopDef {
  id: string
  name: string
  /** 이 상점을 여는 화자. 한 화자가 두 상점을 열 수 없다(빌드가 강제한다). */
  speakerId: string
  /** 이 상점이 사고파는 계열. 매도 대상은 이 계열의 재료뿐이다 — 남의 계열은 그 마을에 가야 판다. */
  skill: SkillId
  /** 상점 자체가 열리는 숙련도(원작 그대로 5,000). 미달이면 대사만 나온다. */
  unlockSkill: number
  /** 매수 진열. 매도는 진열이 필요 없다 — 그 계열 재료면 무엇이든 사 준다(설계 §4). */
  stock: ShopStockEntry[]
}

/**
 * 달인 한 명의 1회성 대금. 원작의 그 숫자를 우리 규모로 옮긴 것이다(설계 §6, §6-앞 8).
 *
 * **왜 대사가 아니라 등록부인가**(§6-앞 2): `@story skill.ice>=63235` 는 현행
 * 검증이 즉시 거절한다(한 번만 하는 말의 조건은 전부 `=` 여야 한다). 통과시켰다면
 * `onceKey` 가 숙련도의 지금 값을 스냅샷하므로 말을 걸 때마다 무한 지급됐을 것이다.
 * 지급 판정은 서버가 `skills[skill] >= threshold && !rewarded.includes(id)` 로 한다.
 */
export interface MasterDef {
  id: string
  speakerId: string
  skill: SkillId
  /** 이 숫자를 넘으면 준다. 우리 대사에 이미 심어져 있는 그 기록이다. */
  threshold: number
  /** 한 번만 주는 금액. */
  gold: number
}

/**
 * 노드의 등급 — 목록이 먼저이고 타입이 거기서 나온다.
 *
 * `SKILL_IDS` 처럼 타입과 배열을 따로 적지 **않는** 이유: 등급은 표 id 의 접미사와
 * 짝을 이루고(`gatherTables.ts` 의 전사 함수), 그 짝은 `Record<NodeVariant, …>` 로
 * 전수를 강제한다. 타입에만 값을 더하고 이 배열을 잊으면 파서가 그 등급을 영원히
 * 거절하는데 — CSV 는 거절당하고 타입은 통과하니 — 어느 검사도 안 짖는다.
 * 배열에서 타입을 뽑으면 그 갈라짐이 존재할 수 없다.
 */
export const NODE_VARIANTS = ['normal', 'deep', 'special'] as const

export type NodeVariant = (typeof NODE_VARIANTS)[number]

/**
 * 노드가 지는 시각 조건 — 밤이거나 물때다(노드 종류 설계 §3).
 *
 * `NODE_VARIANTS` 와 같은 방향으로 적는다(목록이 먼저, 타입은 거기서). 이유도
 * 같다: 조건이 하나 늘어나는 날 파서의 허용 목록을 손으로 안 고쳐도 되도록.
 *
 * **시각을 숫자로 적지 않는다.** `transitions.csv` 의 `gateTide` 가 시각이 아니라
 * 표시인 것과 같은 이유다(time.ts 의 `TIDE_WINDOWS` 문서) — 창을 데이터에 적게
 * 하면 그 숫자가 노드마다 갈라지고, 갈라져도 화면 어디에도 흔적이 안 남는다.
 * 여기 있는 것은 "어느 세계의 사실을 보는가" 하나이고, 그 사실의 숫자는
 * `time.ts` 가 소유한다.
 */
export const NODE_TIME_REQUIREMENTS = ['night', 'tide'] as const

export type NodeTimeRequirement = (typeof NODE_TIME_REQUIREMENTS)[number]

export interface NodeDef {
  id: string
  name: string
  skill: SkillId
  /**
   * 이 노드가 굴리는 확률표의 id. 무엇이 나오는가는 노드가 아니라 표가 정한다.
   *
   * 표 자체는 GameData 에 없다 — 브라켓 경계와 잭팟 확률이 곧 숨은 문턱이라
   * 클라이언트에 실으면 F12 로 스포일된다(설계 §7-앞 9). 빌드가 서버 전용
   * 산출물(gather-tables.json)로 따로 굽고 서버만 읽는다.
   */
  tableId: string
  /**
   * 이 노드가 어느 등급인가 — 결계 안(`deep`)인가, 바깥(`normal`)인가, 조건이
   * 열릴 때만 서는 옆길(`special`)인가. 마커 색의 출처이기도 하다.
   *
   * **채집 티어 스펙은 이 칸을 "표시 전용"이라 적었고 그것이 대가를 치렀다**
   * (결계 설계 계기 둘): 심층 노드 넷이 이름과 색만 심층인 채 바깥과 같은 표를
   * 굴렸고, 얼음안내판은 그 위에서 거짓말을 했다. 지금은 등급마다 `tableId` 의
   * 접미사가 정해져 있고(결계 계획 B2, validateGameData 가 강제한다 — 오래
   * "§9-앞 5" 로 적혀 있었는데 그 번호는 전수 시뮬의 표 목록 하드코딩 얘기다) 그 표가
   * 자기 등급의 산출을 진다. 즉 이 칸은 **판정에 쓰인다** — 직접 읽히는 것이
   * 아니라 자기와 짝지어진 표를 통해서다.
   *
   * **2값이 3값이 되면서 그 강제가 부등식으로 바뀌었다.** 옛 검사는
   * `isDeepTableId(tableId) !== (variant === 'deep')` 한 줄이라 `special` + 접미사
   * 없는 표를 양쪽 다 false 로 읽어 통과시킨다 — 아크 A 가 노드에 그림을 달았으므로
   * 그 거짓말은 이제 화면에서 보인다(붉은 얼음 광맥이 보통 얼음을 준다).
   * 그래서 검사가 전사 함수(`variantOfTableId`)를 부르는 등식이 됐다.
   *
   * 판정에 쓰이는 티어는 여전히 없다(도구 등급 게이트는 §7-앞 8 에서 은퇴했다).
   * 심층을 지키는 것은 노드의 자격 검사가 아니라 **그 앞의 결계 전환**이다.
   */
  variant: NodeVariant
  /**
   * 이 노드가 맵에 세우는 그림의 **이름**. 파일 경로가 아니다.
   *
   * 화자가 이미 선 자리다(`apps/client/src/game/npcSprites.ts:1-14`): 서버는
   * 노드가 어디 있고 무엇을 내놓는지 판정하지만 **그것이 어떻게 생겼는지는
   * 판정하지 않는다** — 그림은 화면의 일이라 서버·프로토콜·세이브 어디에도
   * 들어갈 이유가 없다. 그래서 데이터는 `sprite` 라는 이름만 실어 나르고, 그
   * 이름이 어느 파일인지는 클라이언트 매니페스트에서 풀린다(설계 §5, §9-앞 12).
   * 여기서 파일 이름까지 나르면 데이터가 클라이언트의 디렉터리 구조를 알게 되고,
   * 그 순간 그림을 옮기는 일이 CSV 마이그레이션이 된다.
   *
   * **판정에 쓰이지 않는다.** `variant` 와 갈리는 지점이 그것이다 — variant 는
   * 자기와 짝지어진 표를 통해 산출에 닿지만, 이 칸은 어느 서비스도 어느 검증도
   * 읽지 않는다. 그래도 비어 있으면 파싱이 거절한다: 얼굴 없는 노드는 맵에서
   * 색칠한 네모로 남는데, 그 상태는 "아직 안 그린 것"과 화면상 구별되지 않는다.
   */
  sprite: string
  /**
   * 이 하늘일 때만 캘 수 있다. 비면 하늘을 안 본다(설계 §3).
   *
   * **`variant` 와 갈리는 지점:** variant 는 자기와 짝지어진 표를 통해 **무엇이
   * 나오는가**에 닿지만, 이 칸은 **언제 캘 수 있는가**만 정한다 — 굴림
   * (`gatherOutcome`)의 인자가 되지 않는다. 조건을 판정 경로에 넣으면 같은
   * 노드가 날씨에 따라 다른 분포를 갖게 되고, 그 차이는 표를 읽어도 안 보인다.
   *
   * **`undefined` 가 "언제나 열림" 이다.** 출하 여덟 행이 전부 그쪽이라
   * (parse.test.ts 가 그것을 문다) 이 아크는 기존 채집을 한 톨도 바꾸지 않는다.
   * 'clear' 같은 자리표시를 두지 않는 이유는 `activeWeather` 와 같다 — 없는
   * 하늘에 이름을 주면 부정으로 건 조건이 맑은 날 참이 되기 시작한다.
   */
  requireWeather?: WeatherKind
  /**
   * 이 시각 조건이 맞을 때만 캘 수 있다. 비면 시계를 안 본다(설계 §3).
   *
   * `requireWeather` 와 함께 걸 수 있고, 그러면 **둘 다** 만족돼야 열린다 —
   * 판정은 `nodeAvailable`(nodeAvailability.ts) 하나가 짓는다. 여기서 짝을
   * 금지하지 않는 이유는 결계가 숙련과 물때를 함께 지는 것과 같다: 조건을
   * 배타로 만들면 "눈 오는 밤" 같은 자리를 데이터가 표현할 수 없다.
   */
  requireTime?: NodeTimeRequirement
}

/** 채집 사다리의 한 단. 표의 tiers 순서가 곧 의미다 — 희귀 → 흔함. */
export interface GatherTierDef {
  itemId: string
}

/**
 * 숙련 브라켓 하나의 누적 확률표.
 *
 * `cumulative[i]` 는 "roll ≤ 이 값이면 tiers[i]" 의 상한이다(오름차순, 최대
 * 100000). 어느 값에도 안 걸리는 roll 은 실패다 — 마지막 누적과 100000 사이가
 * 실패 질량이다.
 */
export interface GatherBracketDef {
  /** 이 브라켓이 받는 숙련 상한(proficiency ≤ bracketMax). null = ∞(마지막 브라켓). */
  bracketMax: number | null
  cumulative: number[]
}

/**
 * 채집 확률표 하나. 채집장(기술) 하나가 표 하나를 갖는다.
 *
 * 성패 무관 숙련 증가치(skillGainMin~Max)는 노드가 아니라 표가 소유한다
 * (설계 §7-앞 3) — 같은 표를 공유하는 노드들이 다른 증가치를 가질 이유가 없다.
 */
export interface GatherTableDef {
  id: string
  skill: SkillId
  skillGainMin: number
  skillGainMax: number
  /**
   * 이 표가 그 계열의 **재는 표**인가 — 수집의 방 형평·조기도달 검증이 계열마다
   * 이 표 하나로만 25칸 문턱을 잰다(결계 §9-앞 1·2).
   *
   * 왜 표에 이 표시가 필요한가: 검증은 표를 순회하며 **같은 25칸**을 재므로,
   * 계열에 표가 둘이 되는 순간(바깥·심층) 한 칸의 t4 가 두 표의 ∞ 양쪽에서
   * 25~35분 대역을 동시에 만족해야 한다. 실측 허용창이 0.84×~1.23× 라
   * 어떤 문턱을 적어도 빌드가 안 서는 교착이 된다.
   *
   * 판정에는 안 쓴다 — 빌드가 무엇으로 재는지를 정하는 표시일 뿐이고, 게임은
   * 이 값을 한 번도 보지 않는다.
   */
  equity: boolean
  /** 희귀 → 흔함 순서. brackets 의 cumulative 와 자리로 짝을 이룬다. */
  tiers: GatherTierDef[]
  /** 숙련 브라켓 오름차순. 마지막 하나만 bracketMax 가 null(∞)이다. */
  brackets: GatherBracketDef[]
}

export type GatherTables = Record<string, GatherTableDef>

/** 강화 한 단계가 먹는 원재료 한 줄. */
export interface EnhanceMaterial {
  item: string
  count: number
}

/**
 * (도구 티어 × 강화 단계) 하나의 값. 원작 UL4 를 그대로 옮긴 자리다(설계 §6-앞 11·12).
 *
 * **계열이 아니라 단계가 재료를 정한다.** +1 은 나무, +2 는 허브, +3 은 얼음,
 * +4 는 광물, +5 는 네 계열 각 1 — 도구가 무엇이든 같은 사다리를 탄다. 계열
 * 대응(얼음 도구는 얼음 재료)으로 뒤집으면 원작이 UL4 에 심어 둔 "계열이 서로를
 * 먹인다"는 성질이 통째로 사라진다.
 *
 * **티어가 키에 들어가는 이유**(§6-앞 12): 같은 표가 구리에선 도구 값의
 * 99.9% 이고 미스릴에선 0.5% 였다. 티어마다 배수를 곱해야 사다리가 끝까지 벽이다.
 *
 * `gold` 는 **단계 하나의 값**이지 재료 줄마다의 값이 아니다 — CSV 는 같은 단계의
 * 모든 줄에 같은 골드를 되풀이해 적고(어느 줄만 봐도 그 단계의 값을 알 수 있게),
 * 파서가 그 일치를 강제한 뒤 하나로 접는다.
 */
export interface EnhanceCostDef {
  toolTier: number
  /** 강화 후의 수치(1..ENHANCE_CAP). "+3 으로 올리는 값"이지 "+3 에서 내는 값"이 아니다. */
  level: number
  materials: EnhanceMaterial[]
  gold: number
}

export interface RecipeInput {
  item: string
  count: number
}

export interface RecipeDef {
  id: string
  name: string
  /**
   * 제작 패널의 섹션 헤더. 카테고리 등장 순서는 recipes.csv 에서 그 카테고리가
   * 처음 나타난 순서를 따른다(정렬하지 않는다) — 원작이 쓰던 "요구치를 숫자로
   * 말하는 문" 배치가 CSV 저자의 손을 그대로 따라간다.
   */
  category: string
  skill: SkillId
  /** 이 레시피를 여는 데 필요한 조합 숙련도 */
  requiredSkill: number
  /** 숙련도가 요구치와 같을 때의 성공률 */
  baseChance: number
  inputs: RecipeInput[]
  output: RecipeInput
  /**
   * 제작 1회당 숙련도 증가량의 범위. 요구 숙련도와 함께 증가하지만 비례하지는 않으므로
   * 필요도가 높을수록 요구치 대비 증가 비율이 낮아진다. 설계 문서의 기준점 표를 참조한다.
   */
  skillGainMin: number
  skillGainMax: number
  /**
   * 문을 여는 **두 번째 숫자** — 이 레시피가 속한 계열의 채집 숙련도(설계 §6-앞 9·10).
   *
   * 왜 문이 둘인가: 같은 레시피가 플레이 순서에 따라 0.2분과 11시간을 오간다.
   * 조합 25,000 인 사람이 얼음을 오늘 처음 캐면 얼음 레시피는 "열렸다"고
   * 표시되지만 그 재료는 그에게 0.01% 드랍이다 — 진짜 문턱은 조합 숙련이
   * 아니라 **그 재료를 내주는 계열의 채집 브라켓**이기 때문이다.
   *
   * 둘은 함께 있거나 함께 없다(parseRecipes 가 강제한다). 한쪽만 적히면
   * "무엇의 숫자인지" 또는 "얼마인지"를 모르는 문이 되므로 조용히 통과시키지
   * 않는다. 없으면 지금까지처럼 `requiredSkill`(조합) 하나만이 문이다.
   */
  gateSkill?: SkillId
  gateValue?: number
}

/**
 * 맵 한 장. `file` 은 `packages/data/maps/` 안의 `.tmx` 이름이다.
 *
 * width·height 를 여기 싣는 이유는 검증과 서버가 "그 칸이 맵 안인가"를 물어야
 * 하는데, 맵 파일 전체를 GameData 에 싣는 것은 낭비이기 때문이다 — 지형(벽)은
 * 빌드 시점에만 필요하므로 GameData 로 넘어오지 않는다.
 */
export interface MapDef {
  id: string
  name: string
  file: string
  width: number
  height: number
  /**
   * 이 맵에서 시작하는 칸. 맵 파일의 `spawn` 오브젝트가 유일한 출처다.
   *
   * 두 자리에서 쓰인다 — 새 플레이어가 서는 칸, 그리고 세이브의 `location` 이
   * 없어진 맵을 가리킬 때 돌아오는 칸이다. 좌표를 코드에 적지 않는 이유가
   * 여기 있다: 맵을 고쳐 그리면 시작 칸이 함께 움직여야 하는데, 코드에 적힌
   * 숫자는 따라오지 않는다. 빌드가 이 칸이 벽·노드·화자 위가 아닌지 본다
   * (validateMapSpawns).
   */
  spawn: TilePos
}

/**
 * 맵과 맵을 잇는 칸 하나. 그 칸을 밟으면 넘어간다.
 *
 * 왜 맵 파일이 아니라 별도 표인가: 전환은 맵 두 개에 걸친 사실이라, 한쪽
 * 맵에 적으면 반대쪽과 어긋나도 알 방법이 없다. 한곳에 모으면 빌드가 양쪽을
 * 같이 본다.
 *
 * `facing` 이 null 이면 들어온 방향을 그대로 유지한다.
 */
export interface TransitionDef {
  fromMap: string
  fromX: number
  fromY: number
  toMap: string
  toX: number
  toY: number
  facing: Direction | null
  /**
   * 이 문이 요구하는 숙련도 — 결계다(설계 §2).
   *
   * 둘은 함께 있거나 함께 없다(parseTransitions 가 강제한다). 레시피의
   * `gateSkill`/`gateValue` 와 같은 짝이고 같은 규칙이다: 한쪽만 적히면
   * "무엇의 숫자인지" 또는 "얼마인지"를 모르는 문이 서는데, 그 어긋남은
   * 화면 어디에도 흔적을 남기지 않는다.
   *
   * **이 두 칸은 클라이언트 번들에 실린다.** 확률표를 뺀 이유(브라켓 경계가
   * 곧 숨은 문턱이라 F12 로 스포일된다)는 여기 없다 — 요구치를 숫자로 말하는
   * 문은 이 저장소의 규범이고(GameData 주석), 화면이 "결계가 밀어낸다 — 광물
   * 숙련 85,000 (지금 63,240)" 을 스스로 조립하려면 이 숫자가 손에 있어야 한다.
   * 부등호 자체는 화면이 갖지 않는다: shared 의 `transitionGate` 하나뿐이다.
   *
   * **역방향(나오는 문)에는 걸지 않는다** — 빌드가 그것을 강제한다
   * (validateTransitions 의 갇힘 방지 검사). 나중에 이 값을 올리는 날, 그
   * 사이 숙련의 플레이어가 결계 안에서 영구히 갇히기 때문이다.
   */
  gateSkill?: SkillId
  gateValue?: number
  /**
   * 이 문이 **물때도 지는가** — 허브 결계 하나뿐이다(설계 §6·§9-앞 17).
   *
   * `항구약초지기` 는 처음부터 조건 **둘**을 말했다 — "물이 크게 빠질 때,
   * 저 끝 바위에 안개가 안 걷히는 데가 있네." 숙련만 걸면 그 대사는 여전히
   * 없는 것을 가리킨다.
   *
   * **시각이 아니라 표시(적혀 있음/없음)인 이유:** 물때는 문의 속성이 아니라
   * 세계의 사실이라 값은 `TIDE_WINDOWS`(shared/time.ts) 한 곳에 있다. 여기에
   * 시각을 적게 하면 안내판이 적는 숫자, 화면이 밀려남에 적는 숫자, 그리고
   * 이 칸이 셋으로 갈라진다 — 갈라져도 어느 화면 하나 이상해지지 않는다.
   * `gather_tables.csv` 의 `equity` 칸과 같은 자세다.
   *
   * **역방향(나오는 문)에는 걸지 않는다** — 숙련 게이트와 같은 규범이고
   * (§9-앞 17: 시간 조건도 들어가는 것만 막는다), 같은 검사가 강제한다.
   * 물때 문은 특히 위험한데, 시각은 플레이어가 올릴 수 있는 숫자가 아니라
   * 나오는 문에 걸리면 그냥 몇 시간짜리 감옥이 되기 때문이다.
   */
  gateTide?: boolean
}

/**
 * 맵 위에 놓인 노드 하나. `nodeId` 는 종류이고 `instanceId` 가 그 칸이다.
 *
 * 같은 종류가 여러 칸에 있으므로 종류만으로는 어느 것인지 알 수 없다.
 * 서버가 앞칸 판정을 검증하려면, 그리고 나중에 고갈을 넣으려면 칸을 지목해야 한다.
 *
 * `x`·`y` 는 픽셀이 아니라 **타일 좌표**다.
 */
export interface NodePlacement {
  instanceId: string
  nodeId: string
  /** 어느 맵의 칸인가. SpeakerDef.mapId 와 같은 값 공간이다. */
  mapId: string
  x: number
  y: number
}

/**
 * 대화 상대 하나 — NPC 이거나 말하는 사물(간판·잠긴 문·기념비 등)이다.
 *
 * 사물을 NPC 와 같은 타입으로 두는 이유는 설계 문서 2장에 있다: 규칙도
 * 대사창도 서버 경로도 같고, 다른 것은 `kind` 뿐이라 굳이 타입을 나누면
 * 화자를 다루는 모든 코드가 두 갈래로 갈라진다.
 *
 * `mapId`·`x`·`y` 는 NodePlacement 와 같은 성격이다 — 지금 맵은 `world`
 * 하나뿐이지만 처음부터 맵 id 를 넣어 둔다(설계 문서 9장). 맵이 하나뿐인
 * 지금 넣는 비용은 필드 하나이고, 나중에 맵이 늘 때 넣으면 이미 나간
 * speakers.csv 전체를 마이그레이션해야 한다.
 */
export interface SpeakerDef {
  id: string
  name: string
  /** 'sign' 은 간판처럼 서서 안내만 하는 사물이다. 사람처럼 움직이지 않는다. */
  kind: 'npc' | 'sign'
  mapId: string
  /** 타일 좌표. NodePlacement 의 x·y 와 같다. */
  x: number
  y: number
  sprite: string
  /**
   * 처음 서 있을 때 바라보는 쪽. CSV 에서는 선택 칸이고 비어 있으면 아래다.
   *
   * **판정에 쓰이지 않는다.** 서버의 대화 검사도 클라이언트의 앞칸 판정도
   * x·y 만 본다 — 화자가 어느 쪽을 보고 있든 말은 걸린다. 그래서 이 값은
   * 규칙이 아니라 연출이고, 클라이언트가 첫 자세를 정할 때만 읽는다.
   *
   * 그런데도 shared 에 두는 이유는 이것이 **작가가 데이터에 적는 것**이기
   * 때문이다. 노인이 채집장 입구를 내려다보고 서 있는 것은 그 자리를 고른
   * 사람의 결정이라, 클라이언트가 매번 다시 추측할 일이 아니다.
   *
   * `sign` 은 이 값을 쓰지 않는다 — 사물에는 앞뒤가 없다(npcSprites.ts 의
   * `static` 종류).
   */
  facing: Direction
}

/**
 * NPC 가 일과 중에 서는 자리 하나. 맵의 `places` 오브젝트 레이어가 유일한 출처다.
 *
 * **왜 CSV 가 아닌가:** 시작 칸(`MapDef.spawn`)을 맵 파일로 옮긴 것과 같은
 * 이유다 — 맵을 다시 그리면 지점이 눈에 보이는 곳에서 함께 움직인다. 좌표를
 * 맵 밖에 적으면 맵 수정이 지점을 벽 속에 남기고, 빌드는 "벽"이라고만 말한다.
 *
 * `id` 는 맵을 넘어 전역으로 유일하다 — 일과(`.sched`)가 맵을 적지 않고 이름
 * 하나로만 지점을 부르기 때문이다. 통근하는 NPC 의 일과에 맵을 적게 하면
 * 같은 사실이 두 곳에 적히고, 지점이 다른 맵으로 옮겨 갈 때 갈라진다.
 */
export interface PlaceDef {
  id: string
  mapId: string
  /** 타일 좌표. NodePlacement 의 x·y 와 같다. */
  x: number
  y: number
  /**
   * 실내 지점인가. 도착하면 맵에서 사라진다(밤에 여관 안으로 들어가는 것).
   *
   * 실내 맵이 생기면 이 지점만 그 맵으로 옮기면 된다 — 그때까지는 "그 문
   * 칸에서 안으로 사라진다" 가 실내의 뜻이다.
   */
  indoor: boolean
  /**
   * 그 지점에 서 있을 때 바라보는 쪽. 없으면 걸어온 방향을 그대로 유지한다.
   *
   * SpeakerDef.facing 과 같은 성격이다 — 판정이 아니라 연출이고, 그 자리를
   * 고른 사람이 데이터에 적는 것이다.
   */
  facing: Direction | null
}

/**
 * 일과 한 줄 — 그 시각에 그 지점에 **도착해 있다**.
 *
 * 출발 시각은 적지 않는다. 빌드가 구운 경로의 길이로 역산한다(도착 −
 * 걸음수 × NPC_STEP_MS). 작가가 "22:00 여관안" 을 읽고 "22시엔 여관에 있다"로
 * 이해하는 것이 맞다 — 출발 의미론이면 지금 어디 있는지 알려고 다음 줄을
 * 읽어야 한다.
 */
export interface ScheduleEntry {
  /** 하루 중 도착 시각(분, 0~1439). `HH:MM` 을 분으로 편 것이다. */
  arriveMinute: number
  /**
   * 변주 후보. 날짜 시드가 그중 하나를 고른다(`A | B`). 언제나 최소 하나다.
   *
   * 후보가 여럿이면 빌드는 **모든** 후보 조합의 길을 굽고 모든 조합이 시간
   * 안에 닿는지 본다 — 어느 날 어느 후보가 뽑힐지 미리 알 수 없어서다.
   */
  placeIds: string[]
}

/**
 * 화자 한 명의 하루. `schedules/<화자id>.sched` 파일 하나가 이것 하나다.
 *
 * 하루 단위로 반복한다. 마지막 줄의 지점에서 다음 날 첫 줄의 출발 시각까지
 * 머문다 — 그 되감기 구간도 다른 줄과 똑같은 도착 규칙을 지켜야 한다.
 */
export interface ScheduleDef {
  speakerId: string
  /** 도착 시각 오름차순. 최소 한 줄이다 — 빈 일과는 빌드가 막는다. */
  entries: ScheduleEntry[]
}

/** 구운 경로 위의 칸 하나. 맵을 넘는 구간에서 mapId 가 바뀐다. */
export interface RouteStep {
  mapId: string
  x: number
  y: number
}

/**
 * 지점에서 지점까지 빌드가 구워 둔 길 하나.
 *
 * 런타임은 보간만 한다 — 길찾기를 실행 중에 돌리면 서버와 클라이언트가 각자
 * 다른 최단 경로를 고를 수 있고(같은 길이의 길이 여럿이다), 그러면 NPC 가
 * 두 화면에서 다른 골목으로 간다.
 */
export interface BakedLeg {
  fromPlace: string
  toPlace: string
  /**
   * 첫 칸이 출발 지점, 마지막 칸이 도착 지점이다. 걸음 수는 `steps.length - 1`
   * 이라 같은 지점으로의 0길이 걸음(한 줄짜리 일과의 되감기)도 칸 하나로
   * 표현된다 — 0 으로 나누지 않는다.
   */
  steps: RouteStep[]
}

export interface GameData {
  items: Record<string, ItemDef>
  nodes: Record<string, NodeDef>
  recipes: Record<string, RecipeDef>
  /** 맵 등록부. 키는 mapId 다. */
  maps: Record<string, MapDef>
  /** 맵과 맵을 잇는 칸들. 순서에 의미는 없다. */
  transitions: TransitionDef[]
  placements: Record<string, NodePlacement>
  /** 정의 순서를 유지한다 — 이정표 탭이 동점 진척을 이 순서로 정렬한다(detailMenuTabs.ts) */
  milestones: MilestoneDef[]
  speakers: Record<string, SpeakerDef>
  /**
   * 상점 등록부. 키는 shopId 다.
   *
   * **확률표와 달리 이것은 GameData 에 싣는다** — 클라이언트가 매도 목록(가방 ∩
   * 그 상점 계열)과 진열(잠긴 칸의 요구치까지)을 그려야 하기 때문이다. 표를 뺀
   * 이유(브라켓 경계가 곧 숨은 문턱이라 F12 로 스포일된다, §7-앞 9)는 여기 없다:
   * 상점의 값과 요구치는 애초에 화면이 숫자로 말해 주기로 한 것들이다.
   */
  shops: Record<string, ShopDef>
  /**
   * 달인 대금 등록부. 순서에 뜻은 없지만 배열인 것은 키가 화자·기술 둘 다일 수
   * 있어서다 — 서버는 화자로 찾고, 검증은 기술로 센다. 이것도 클라이언트가 본다
   * (대금이 들어온 뒤 무엇이 들어왔는지 화면이 말해야 한다).
   */
  masters: MasterDef[]
  /**
   * 강화 비용표. 한 항목이 (도구 티어 × 강화 단계) 하나다.
   *
   * **확률표와 달리 이것은 GameData 에 싣는다**(§6-앞 13). 채집 표를 뺀 이유는
   * "브라켓 경계가 곧 숨은 문턱이라 F12 로 스포일된다"였는데, 강화 비용에는
   * 숨길 것이 없다 — 오히려 **가방이 요구량을 적어 주지 못하면** 플레이어는
   * 무엇을 얼마나 모아야 하는지 모른 채 [강화] 를 눌러 보고 거절만 받는다.
   * 원작이 쓰던 "요구치를 숫자로 말하는 문"이 여기서도 그대로여야 한다.
   * 상점 진열(shops)을 싣는 이유와 같은 자리이고, 채집 표(GatherTables)와
   * 정확히 반대편이다.
   *
   * 배열인 것은 키가 둘(toolTier·level)이라서다 — masters 가 배열인 것과 같은
   * 사정이다. 찾는 문은 enhanceCostFor 하나다.
   */
  enhanceCosts: EnhanceCostDef[]
  /**
   * 수집의 방 문턱표. 키는 itemId 이고 칸은 채집물 25종 전부다(§6-앞 4).
   *
   * **확률표와 달리 이것은 GameData 에 싣는다**(§6-앞 5). 채집 표를 뺀 이유는
   * "브라켓 경계가 곧 숨은 문턱이라 F12 로 스포일된다"였는데, 방의 문턱에는
   * 숨길 것이 없다 — 오히려 **잠긴 칸에도 요구치를 적는 것**이 이 방의 규범이다
   * (§6-앞 3: 숨기는 것은 없다). 화면이 "0/50" 을 못 적으면 플레이어는 무엇을
   * 얼마나 모아야 하는지 모른 채 회색 칸만 보게 된다. 강화 비용표를 싣는 것과
   * 같은 자리이고, 채집 표(GatherTables)와 정확히 반대편이다.
   */
  collection: CollectionTable
  /** 지점 등록부. 키는 지점 id 이고 맵을 넘어 유일하다. */
  places: Record<string, PlaceDef>
  /** 일과가 있는 화자만. 키는 화자 id 다 — `.sched` 가 없는 화자는 여기 없고 좌표에 고정이다. */
  schedules: Record<string, ScheduleDef>
  /**
   * 빌드가 구운 길. 일과가 요구하는 모든 (지점→지점) 구간이 들어 있다.
   *
   * 배열인 것은 순서에 뜻이 있어서가 아니라 키가 둘(from·to)이라서다 —
   * 런타임은 두 지점으로 찾는다.
   */
  routes: BakedLeg[]
  /**
   * 모든 화자의 모든 대사 규칙이 화자 구분 없이 한 배열에 담긴다.
   *
   * speaker 별로 미리 나누지 않는 것은 selectDialogue 자체가 `speaker`
   * 매개변수로 걸러 받도록 설계됐기 때문이다(dialogue.ts 참고) — 여기서
   * 미리 나누면 "이미 걸러서 넘겨야 한다"는 관례가 하나 더 생기고, 그건
   * 정확히 Task 1 리뷰가 지적하고 없앤 종류의 함정이다.
   */
  dialogue: DialogueRule[]
}
