import { ENHANCE_CAP, type ItemDef, type PlayerState } from '@nogada/shared'

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
  materialInstanceId: string
}

export interface EnhanceOutcome {
  player: PlayerState
}

export type EnhanceErrorCode = 'unknown_instance' | 'material_equipped' | 'no_target' | 'enhance_cap'

export type EnhanceResult =
  | { ok: true; outcome: EnhanceOutcome }
  | { ok: false; code: EnhanceErrorCode }

/**
 * 강화 — 재료(미착용 예비 도구)를 소모해 **같은 itemId 의 착용 중** 인스턴스를
 * +1 한다(§5). 성공은 100%(v1 — 도박 강화는 훅)이고, 재료의 강화 수치는
 * 버려진다(+2 재료도 +1 만큼 — 합성식은 훅).
 *
 * 대상은 요청에 없다: "같은 itemId 의 착용 인스턴스"라는 규칙이 정하므로,
 * 대상까지 받으면 규칙 밖의 조합(다른 itemId 로의 강화)을 요청이 표현할 수 있게 된다.
 */
export function performEnhance(args: PerformEnhanceArgs): EnhanceResult {
  const material = args.player.instances.find((i) => i.instanceId === args.materialInstanceId)
  if (!material) return { ok: false, code: 'unknown_instance' }

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

  const player = structuredClone(args.player)
  // target 은 args.player.instances 에서 찾은 것이라 클론에도 반드시 있다.
  const equipped = player.instances.find((i) => i.instanceId === target.instanceId)!
  equipped.enhanceLevel += 1
  player.instances = player.instances.filter((i) => i.instanceId !== material.instanceId)
  return { ok: true, outcome: { player } }
}
