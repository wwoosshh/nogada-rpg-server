import {
  ENHANCE_CAP,
  enhanceCostFor,
  type EnhanceCostDef,
  type ItemDef,
  type PlayerState,
} from '@nogada/shared'

/**
 * 착용·강화 — 인벤토리 정리 행위의 판정 둘이 한 파일에 산다.
 *
 * 채집·제작과 달리 **행동 간격을 검사도 소비도 하지 않는다**(§6-앞 11 — 정리
 * 행위는 행동이 아니다). 그래도 판정은 서버의 것이다: 무엇이 도구이고 무엇이
 * 재료가 될 수 있는가를 클라이언트 버튼이 아니라 여기가 정한다. 동시 요청은
 * 채집·제작과 같은 applyToCharacter 낙관 잠금이 처리한다.
 */

export interface PerformEquipArgs {
  player: PlayerState
  /** 인스턴스의 itemId 를 정의로 바꿔 어느 슬롯(toolSkill)인지 알아내는 데만 쓴다. */
  items: Record<string, ItemDef>
  instanceId: string
}

/** 응답은 플레이어 통째 하나다(§6-앞 11) — 클라이언트는 상태 적용 경로 하나로 처리한다. */
export interface EquipOutcome {
  player: PlayerState
}

export type EquipErrorCode = 'unknown_instance' | 'not_a_tool'

export type EquipResult = { ok: true; outcome: EquipOutcome } | { ok: false; code: EquipErrorCode }

/**
 * 착용 — 지목한 인스턴스를 그 도구의 `toolSkill` 슬롯에 끼운다(교체).
 *
 * 슬롯은 요청에 없다(§4): 클라이언트가 슬롯을 고를 수 있으면 요청 하나로
 * 곡괭이를 허브 슬롯에 끼울 수 있다. 해제도 없다 — 맨손이 전략인 경우가 없고,
 * 빈 슬롯은 신규 캐릭터의 상태로 충분하다. 착용 중인 것을 다시 지목하면 같은
 * 값을 다시 쓸 뿐이라 따로 막지 않는다(§4 — "아무 일 없음"이 곧 성공).
 */
export function performEquip(args: PerformEquipArgs): EquipResult {
  const instance = args.player.instances.find((i) => i.instanceId === args.instanceId)
  if (!instance) return { ok: false, code: 'unknown_instance' }

  const def = args.items[instance.itemId]
  // kind 만 보면 안 된다(§6-앞 11): toolSkill 은 optional 이라, kind=tool 인데
  // toolSkill 이 빠진 정의가 오면 equipped['undefined'] 유령 슬롯이 생긴다.
  if (!def || def.kind !== 'tool' || !def.toolSkill) return { ok: false, code: 'not_a_tool' }

  const player = structuredClone(args.player)
  player.equipped[def.toolSkill] = instance.instanceId
  return { ok: true, outcome: { player } }
}

export interface PerformEnhanceArgs {
  player: PlayerState
  /** 재료 인스턴스의 티어를 알아내는 데만 쓴다 — 티어가 어느 사다리를 탈지 정한다(§6-앞 12). */
  items: Record<string, ItemDef>
  /** 강화 비용표(GameData.enhanceCosts). 무엇을 얼마나 먹는지는 코드가 아니라 이 표가 안다. */
  costs: readonly EnhanceCostDef[]
  materialInstanceId: string
}

export interface EnhanceOutcome {
  player: PlayerState
}

export type EnhanceErrorCode =
  | 'unknown_instance'
  | 'not_a_tool'
  | 'material_equipped'
  | 'no_target'
  | 'enhance_cap'
  | 'missing_enhance_materials'
  | 'not_enough_gold'

export type EnhanceResult =
  | { ok: true; outcome: EnhanceOutcome }
  | { ok: false; code: EnhanceErrorCode }

/**
 * 강화 — 예비 도구 하나 + **그 단계의 원재료 + 골드**를 소모해 같은 itemId 의
 * 착용 중 인스턴스를 +1 한다. 성공은 100%(v1 — 도박 강화는 훅)이고, 재료 도구의
 * 강화 수치는 버려진다(+2 재료도 +1 만큼 — 합성식은 훅).
 *
 * **왜 예비 도구 하나로는 부족한가**(§6-앞 11): 원작 UL4 는 세 가지를 함께
 * 먹었다 — 원재료를, 단계마다 **다른 계열**로 회전시켜, 골드와 나란히. 예비
 * 도구 하나만 먹던 우리 v1 은 그 사다리에서 원작이 심어 둔 "계열이 서로를
 * 먹인다"를 통째로 버렸고, 그 결과 정제품·원재료의 평생 수요가 몇 시간 만에
 * 끝났다. 무엇을 얼마나 먹는가는 표(enhance_costs.csv)가 알고 여기는 모른다.
 *
 * 대상은 요청에 없다: "같은 itemId 의 착용 인스턴스"라는 규칙이 정하므로,
 * 대상까지 받으면 규칙 밖의 조합(다른 itemId 로의 강화)을 요청이 표현할 수 있게 된다.
 *
 * 거절의 순서가 곧 안내의 순서다(useService·tradeService 와 같은 원칙): 도구가
 * 아닌 것에 "재료가 모자라다"고 답하면 플레이어는 있지도 않은 요구를 채우러 간다.
 */
export function performEnhance(args: PerformEnhanceArgs): EnhanceResult {
  const material = args.player.instances.find((i) => i.instanceId === args.materialInstanceId)
  if (!material) return { ok: false, code: 'unknown_instance' }

  // 티어가 필요해지면서 강화도 정의를 본다(예전엔 안 봤다). performEquip 과 같은
  // 이유로 kind 만 보면 안 된다 — toolTier 는 optional 이라, 도구인데 등급이
  // 빠진 정의가 오면 어느 사다리를 탈지 정할 수 없다.
  const def = args.items[material.itemId]
  if (!def || def.kind !== 'tool' || def.toolTier === undefined) {
    return { ok: false, code: 'not_a_tool' }
  }

  const equippedIds = new Set(Object.values(args.player.equipped))
  // 착용 중이면 재료가 될 수 없다. 재료=대상 동일 인스턴스(자기 자신을 먹여 +1
  // 하면서 개수는 그대로인 증식)도 이 검사 하나가 자연 차단한다(§6-앞 11) —
  // 대상이 되려면 착용 중이어야 하고, 착용 중이면 여기서 걸리기 때문이다.
  if (equippedIds.has(material.instanceId)) return { ok: false, code: 'material_equipped' }

  const target = args.player.instances.find(
    (i) => equippedIds.has(i.instanceId) && i.itemId === material.itemId,
  )
  if (!target) return { ok: false, code: 'no_target' }
  if (target.enhanceLevel >= ENHANCE_CAP) return { ok: false, code: 'enhance_cap' }

  // **올라간 뒤의 수치**로 값을 묻는다 — +2 를 +3 으로 만드는 값은 3 의 값이다.
  // 표에 그 (티어, 단계)가 없으면 이 도구는 강화할 방법이 없는 것이므로 재료
  // 부족이 아니라 "그런 도구가 아니다"로 답한다(빌드 검증이 먼저 막으므로,
  // 여기 닿았다면 검증을 거치지 않은 데이터다).
  const cost = enhanceCostFor(args.costs, def.toolTier, target.enhanceLevel + 1)
  if (!cost) return { ok: false, code: 'not_a_tool' }

  for (const need of cost.materials) {
    if ((args.player.stacks[need.item] ?? 0) < need.count) {
      return { ok: false, code: 'missing_enhance_materials' }
    }
  }
  if (args.player.gold < cost.gold) return { ok: false, code: 'not_enough_gold' }

  // 여기서부터 상태가 바뀐다 — **거절이 전부 끝난 뒤**다. 검사 사이에 상태를
  // 조금씩 고치면 거절 경로가 반쯤 먹힌 재료를 남긴다.
  const player = structuredClone(args.player)
  for (const need of cost.materials) {
    const remaining = (player.stacks[need.item] ?? 0) - need.count
    // 0 이 되면 키를 지운다 — "가진 적 없음"과 같은 모양으로 만드는 것이 제작·
    // 거래·사용 서비스의 관례이고, 가방이 0개짜리 줄로 늘어나지 않게 하는 것도 같다.
    if (remaining > 0) player.stacks[need.item] = remaining
    else delete player.stacks[need.item]
  }
  player.gold -= cost.gold

  // target 은 args.player.instances 에서 찾은 것이라 클론에도 반드시 있다.
  const equipped = player.instances.find((i) => i.instanceId === target.instanceId)!
  equipped.enhanceLevel += 1
  player.instances = player.instances.filter((i) => i.instanceId !== material.instanceId)
  return { ok: true, outcome: { player } }
}
