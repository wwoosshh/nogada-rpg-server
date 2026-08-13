import type { EnhanceCostDef, GameData } from '@nogada/shared'
import { ENHANCE_CAP } from '@nogada/shared'
import { requireCell, toInt } from './parse.js'

type Row = Record<string, string>

const FILE = 'enhance_costs.csv'

/**
 * 강화 비용표를 CSV 에서 조립한다 — 원작 UL4 의 그 사다리다(설계 §6-앞 11·12).
 *
 * **한 줄 = 재료 하나**이고, 같은 (티어, 단계)의 줄들이 한 항목으로 접힌다.
 * 한 줄에 재료 넷을 다 적는 꼴(item1..item4)로 만들지 않은 이유는 채집 브라켓의
 * 누적 칸이 준 교훈 그대로다: 고정 칸 수는 "몇 개까지 늘어날 수 있는가"를 미리
 * 정해 버리고, 빈 칸이 오른쪽에 줄줄이 남는다. +5 만 넷을 먹고 나머지는 하나인
 * 지금 모양에서 그것은 표의 5분의 4가 빈 칸이라는 뜻이다.
 *
 * 여기서 던지는 것은 "조립 자체가 안 되는" 구조 오류다 — 음수, 한 단계 안에서
 * 갈라진 골드, 같은 아이템 두 줄. 조립은 되지만 뜻이 어긋나는 것(빠진 단계,
 * 없는 아이템)은 validateEnhanceCosts 가 목록으로 모아 보고한다. 작가가 한 번의
 * 빌드에서 오류 전부를 보게 하려는 것이고, 이 갈래는 gatherTables.ts 와 같다.
 */
export function parseEnhanceCosts(rows: Row[]): EnhanceCostDef[] {
  const out: EnhanceCostDef[] = []
  // 키는 "티어:단계" 다 — 줄 순서가 흩어져 있어도 같은 단계로 모이게 한다.
  const byStep = new Map<string, EnhanceCostDef>()

  for (const raw of rows) {
    const toolTier = toInt(requireCell(raw, 'toolTier', FILE), FILE, 'toolTier')
    const level = toInt(requireCell(raw, 'level', FILE), FILE, 'level')
    const ctx = `${FILE}[${toolTier}티어 +${level}]`
    const itemId = requireCell(raw, 'itemId', ctx)
    // 0 을 허용한다(min 0) — "재료는 안 먹고 골드만" 같은 단계를 표가 표현할 수
    // 있어야 하고, 그것이 뜻이 맞는 모양인지는 CSV 작가가 정할 일이다.
    const count = toInt(requireCell(raw, 'count', ctx), ctx, 'count', 0)
    const gold = toInt(requireCell(raw, 'gold', ctx), ctx, 'gold', 0)

    const key = `${toolTier}:${level}`
    const existing = byStep.get(key)
    if (!existing) {
      const def: EnhanceCostDef = { toolTier, level, materials: [{ item: itemId, count }], gold }
      byStep.set(key, def)
      out.push(def)
      continue
    }

    // 골드는 단계의 값이지 줄의 값이 아니다. 되풀이해 적게 하는 것은 어느 줄만
    // 봐도 그 단계의 값을 알 수 있게 하려는 것이고, 그러려면 갈라진 값이 조용히
    // 통과해서는 안 된다 — 합치면(더하면) 한 줄만 본 사람이 틀리게 되고, 첫 줄만
    // 믿으면 뒤 줄의 숫자가 아무 뜻 없는 장식이 된다.
    if (existing.gold !== gold) {
      throw new Error(
        `${ctx}: 같은 단계인데 골드가 ${existing.gold} 과 ${gold} 로 갈라진다 — 한 단계의 모든 줄에 같은 골드를 적는다`,
      )
    }
    if (existing.materials.some((m) => m.item === itemId)) {
      throw new Error(`${ctx}: 아이템 "${itemId}" 이 한 단계에 두 번 있다 — 개수를 한 줄로 합친다`)
    }
    existing.materials.push({ item: itemId, count })
  }

  return out
}

/**
 * 표의 뜻을 검사한다. 위반 목록을 돌려준다(빌드가 다른 검사들과 함께 인쇄한다).
 *
 * GameData 를 통째로 받는 이유: 표는 자기 안에서만 보면 온전한데도 게임에서는
 * 죽어 있을 수 있다 — 아이템 등록부에 없는 재료를 가리키거나, 어떤 도구의
 * 티어에 표가 아예 없거나(그 도구는 영원히 강화할 수 없다). 그 물음은 표와
 * 아이템을 함께 보는 자리에서만 물을 수 있다.
 */
export function validateEnhanceCosts(data: GameData): string[] {
  const violations: string[] = []
  const costs = data.enhanceCosts

  // ---- 재료 참조 ----
  for (const cost of costs) {
    const at = `enhance_costs[${cost.toolTier}티어 +${cost.level}]`
    for (const material of cost.materials) {
      const def = Object.hasOwn(data.items, material.item) ? data.items[material.item] : undefined
      if (!def) {
        violations.push(`${at}: 존재하지 않는 아이템 "${material.item}" 을 요구한다`)
        continue
      }
      // 도구는 stacks 에 살지 않고 인스턴스로 산다 — 개수로 셀 수 없으니
      // performEnhance 의 `stacks[item] ?? 0` 이 언제나 0 을 읽어, 그 단계는
      // 아무도 넘을 수 없는 문이 된다.
      if (def.kind !== 'material') {
        violations.push(
          `${at}: "${material.item}" 은 ${def.kind} 다 — 강화가 먹을 수 있는 것은 스택에 사는 재료뿐이다`,
        )
      }
    }
  }

  // ---- 사다리의 완결성 ----
  //
  // 한 티어의 표는 1..ENHANCE_CAP 을 빠짐없이, 그리고 그것만 가져야 한다.
  // 중간이 비면 플레이어가 그 단계에서 막히는데, 그 막힘은 "재료가 모자라다"
  // 도 "상한이다"도 아닌 침묵이라 화면 어디에도 이유가 안 남는다.
  const levelsByTier = new Map<number, number[]>()
  for (const cost of costs) {
    const levels = levelsByTier.get(cost.toolTier) ?? []
    levels.push(cost.level)
    levelsByTier.set(cost.toolTier, levels)
  }

  for (const [tier, levels] of levelsByTier) {
    const seen = new Set(levels)
    for (let level = 1; level <= ENHANCE_CAP; level++) {
      if (!seen.has(level)) {
        violations.push(`enhance_costs[${tier}티어]: +${level} 단계가 없다 — 1 부터 ${ENHANCE_CAP} 까지 빠짐없어야 한다`)
      }
    }
    for (const level of [...seen].sort((a, b) => a - b)) {
      if (level > ENHANCE_CAP) {
        violations.push(
          `enhance_costs[${tier}티어]: +${level} 단계가 있는데 상한은 +${ENHANCE_CAP} 이다 — 아무도 닿을 수 없는 줄이다`,
        )
      }
    }
  }

  // ---- 도구마다 표가 있는가 ----
  //
  // 티어는 코드 상수가 아니라 items.csv 가 정한다(§6-앞 12). 그러니 "1~3 이
  // 있는가"가 아니라 "지금 있는 도구들이 쓰는 티어가 전부 있는가"를 묻는다 —
  // 4티어 도구가 생기는 날 이 검사가 그 자리에서 표를 요구한다.
  for (const item of Object.values(data.items)) {
    if (item.kind !== 'tool' || item.toolTier === undefined) continue
    if (!levelsByTier.has(item.toolTier)) {
      violations.push(
        `items[${item.id}]: ${item.toolTier}티어 도구인데 enhance_costs.csv 에 그 티어의 표가 없다 — 영원히 강화할 수 없는 도구다`,
      )
    }
  }

  return violations
}
