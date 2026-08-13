import { ENHANCE_CAP, enhanceCostFor, type GameData, type PlayerState } from '@nogada/shared'

/**
 * 가방의 [강화] 옆에 앉을 요구 readout 을 만든다 — 제작 패널의
 * craftCardModel.ts 와 같은 자리의 파일이고, 같은 자세다: 규칙은 shared 의
 * 것(enhanceCostFor)을 그대로 쓰고, 여기서 하는 계산은 "몇 개 있고 몇 개
 * 필요한가" 뿐이다. 그 비교는 규칙이 아니라 `player.stacks` 와 표를 나란히
 * 놓는 것이고, 서버 performEnhance 의 for 문과 정확히 같은 비교를 화면에
 * 보여주기 위해 한 번 더 하는 것뿐이다. 최종 판정은 언제나 서버다.
 *
 * **이 파일이 있는 이유가 곧 `enhanceCosts` 를 GameData 에 실은 이유다**
 * (§6-앞 13): 요구량을 클라이언트가 모르면 화면은 "강화" 라는 글자만 보여줄 수
 * 있고, 플레이어는 무엇을 얼마나 모아야 하는지 눌러 보고 거절받으며 알아내야
 * 한다. 원작이 쓰던 "요구치를 숫자로 말하는 문"이 강화에도 있어야 한다.
 */

export interface EnhanceMaterialLine {
  /** 아이콘 칩이 ItemIcon 으로 그림을 찾는 열쇠. */
  item: string
  name: string
  have: number
  need: number
  /** 모자라면 false — 화면이 이 줄만 danger 색으로 칠한다. */
  ok: boolean
}

export interface EnhanceRequirement {
  /** 이번 [강화] 가 만들 수치. "+2 도구를 +3 으로" 의 3 이다. */
  nextLevel: number
  materials: EnhanceMaterialLine[]
  goldHave: number
  goldNeed: number
  goldOk: boolean
  /**
   * 재료와 골드를 **전부** 채웠는가.
   *
   * 가방이 [강화] 버튼을 그리는 조건이 이것이다 — 요구 readout 은 못 채워도
   * 보여 주지만(그것이 이 모델의 존재 이유다), 누르면 서버가 거절만 돌려줄
   * 버튼은 그리지 않는다(죽은 버튼 금지, 설계 §8-앞 13).
   */
  affordable: boolean
}

/**
 * 그 도구의 **다음** 강화가 요구하는 것. 말할 다음 단계가 없으면 null.
 *
 * null 인 경우는 셋이다 — ① 같은 itemId 를 착용하고 있지 않다(대상이 없다,
 * §5) ② 착용분이 이미 만강이다 ③ 그 티어·단계의 표가 없다. 셋 다 "강화라는
 * 조작 자체가 성립하지 않는다"는 뜻이고, 그럴 때는 요구도 버튼도 그리지
 * 않는다: 채울 방법이 없는 요구를 적어 두는 것은 안내가 아니라 소음이다.
 *
 * 상한을 보는 곳이 예비 칩 자신이 아니라 **착용 중인 대상**인 이유는 강화의
 * 규칙이 그렇기 때문이다(equipService: 재료는 예비, +1 은 착용분에 붙는다).
 */
export function enhanceRequirementFor(
  data: GameData,
  player: PlayerState,
  itemId: string,
): EnhanceRequirement | null {
  const equippedIds = new Set(Object.values(player.equipped))
  const target = player.instances.find(
    (inst) => equippedIds.has(inst.instanceId) && inst.itemId === itemId,
  )
  if (!target || target.enhanceLevel >= ENHANCE_CAP) return null

  const toolTier = data.items[itemId]?.toolTier
  if (toolTier === undefined) return null

  const nextLevel = target.enhanceLevel + 1
  const cost = enhanceCostFor(data.enhanceCosts, toolTier, nextLevel)
  if (!cost) return null

  const materials = cost.materials.map((need) => {
    const have = player.stacks[need.item] ?? 0
    return {
      item: need.item,
      name: data.items[need.item]?.name ?? need.item,
      have,
      need: need.count,
      ok: have >= need.count,
    }
  })
  const goldOk = player.gold >= cost.gold

  return {
    nextLevel,
    materials,
    goldHave: player.gold,
    goldNeed: cost.gold,
    goldOk,
    affordable: goldOk && materials.every((m) => m.ok),
  }
}
