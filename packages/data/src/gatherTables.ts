import type { GameData, GatherBracketDef, GatherTableDef, GatherTables, GatherTierDef } from '@nogada/shared'
import { addUnique, optionalCell, requireCell, toInt, toSkillId } from './parse.js'

type Row = Record<string, string>

/**
 * 브라켓 CSV 의 누적 칸 이름. 일곱 개인 것은 가장 긴 사다리(허브·광물 7단)에
 * 맞춘 것이다 — 짧은 사다리는 오른쪽 칸을 비워 둔다(설계 §7-앞 3).
 */
const CUM_COLUMNS = ['cum1', 'cum2', 'cum3', 'cum4', 'cum5', 'cum6', 'cum7'] as const

/** roll 의 정의역 상한. roll = floor(rng × 100001) ∈ 0~100000 이다(설계 §2). */
const ROLL_MAX = 100000

/**
 * 표 셋(메타·사다리·브라켓)을 GatherTables 하나로 조립한다.
 *
 * 왜 CSV 가 셋인가: 한 줄=(표,브라켓,티어)의 세로 단조 수열 162행은 사람이 못
 * 다룬다(설계 §7-앞 3). 사다리와 브라켓을 나누면 브라켓 CSV 한 행이 원작 덤프의
 * 브라켓 블록 하나와 1:1 로 눈 대조가 된다.
 *
 * 여기서 던지는 것은 "조립 자체가 안 되는" 구조 오류다 — 없는 표를 가리키는 행,
 * 번호가 뛴 티어, 중간이 빈 누적 칸. 조립은 되지만 뜻이 어긋나는 것(순증가 위반,
 * ∞ 브라켓 규칙 등)은 validateGatherTables 가 목록으로 모아 보고한다 — 작가가
 * 한 번의 빌드에서 오류 전부를 보게 하기 위해서다.
 */
export function parseGatherTables(metaRows: Row[], tierRows: Row[], bracketRows: Row[]): GatherTables {
  const out: GatherTables = {}

  for (const row of metaRows) {
    const id = requireCell(row, 'tableId', 'gather_tables.csv')
    const ctx = `gather_tables.csv[${id}]`
    const def: GatherTableDef = {
      id,
      skill: toSkillId(requireCell(row, 'skill', ctx), ctx),
      skillGainMin: toInt(requireCell(row, 'skillGainMin', ctx), ctx, 'skillGainMin'),
      skillGainMax: toInt(requireCell(row, 'skillGainMax', ctx), ctx, 'skillGainMax'),
      tiers: [],
      brackets: [],
    }
    addUnique(out, id, def, 'gather_tables.csv')
  }

  for (const row of tierRows) {
    const tableId = requireCell(row, 'tableId', 'gather_tiers.csv')
    const table = out[tableId]
    if (!table) {
      throw new Error(`gather_tiers.csv[${tableId}]: 존재하지 않는 표를 가리킨다 — gather_tables.csv 에 먼저 적는다`)
    }
    const ctx = `gather_tiers.csv[${tableId}]`
    // tier 번호는 자료에 남기지 않고 순서 검증에만 쓴다 — tiers 배열의 자리가
    // 곧 티어(희귀→흔함)이고, 번호를 따로 실으면 자리와 번호가 갈라질 수 있다.
    const tier = toInt(requireCell(row, 'tier', ctx), ctx, 'tier')
    const expected = table.tiers.length + 1
    if (tier !== expected) {
      throw new Error(`${ctx}: tier ${expected} 자리에 ${tier} 이 왔다 — 1부터 빈틈없이 오름차순이어야 한다`)
    }
    const itemId = requireCell(row, 'itemId', ctx)
    if (table.tiers.some((t) => t.itemId === itemId)) {
      throw new Error(`${ctx}: 아이템 "${itemId}" 이 한 표에 두 번 있다`)
    }
    const tierDef: GatherTierDef = { itemId }
    table.tiers.push(tierDef)
  }

  for (const row of bracketRows) {
    const tableId = requireCell(row, 'tableId', 'gather_brackets.csv')
    const table = out[tableId]
    if (!table) {
      throw new Error(
        `gather_brackets.csv[${tableId}]: 존재하지 않는 표를 가리킨다 — gather_tables.csv 에 먼저 적는다`,
      )
    }
    const ctx = `gather_brackets.csv[${tableId}]`
    const rawMax = optionalCell(row, 'bracketMax')
    const bracketMax = rawMax === undefined ? null : toInt(rawMax, ctx, 'bracketMax')

    // 누적 칸은 왼쪽부터 채운다. 중간이 비면 그 뒤 값이 어느 티어의 것인지
    // 자리 짝이 어긋나므로 조립 단계에서 세운다.
    const cumulative: number[] = []
    let sawEmpty: (typeof CUM_COLUMNS)[number] | null = null
    for (const column of CUM_COLUMNS) {
      const raw = optionalCell(row, column)
      if (raw === undefined) {
        sawEmpty = sawEmpty ?? column
        continue
      }
      if (sawEmpty) {
        throw new Error(`${ctx}: ${sawEmpty} 가 비어 있는데 ${column} 가 차 있다 — 빈 칸은 오른쪽 끝에만 온다`)
      }
      // 0 을 허용한다(min 0) — cum1=0 은 "최상 티어가 사실상 없다" 로 경고
      // 대상이지 조립 불능이 아니다(validateGatherTables 의 잭팟 경고).
      cumulative.push(toInt(raw, ctx, column, 0))
    }
    const bracket: GatherBracketDef = { bracketMax, cumulative }
    table.brackets.push(bracket)
  }

  for (const table of Object.values(out)) {
    if (table.tiers.length === 0) {
      throw new Error(`gather_tables.csv[${table.id}]: 티어가 한 줄도 없다 — gather_tiers.csv 에 사다리를 적는다`)
    }
    if (table.brackets.length === 0) {
      throw new Error(`gather_tables.csv[${table.id}]: 브라켓이 한 줄도 없다 — gather_brackets.csv 에 적는다`)
    }
  }

  return out
}

/** 브라켓을 메시지에서 부르는 이름 — 작가가 CSV 에서 눈으로 찾는 열쇠는 상한값이다. */
function bracketLabel(bracket: GatherBracketDef): string {
  return bracket.bracketMax === null ? '∞' : `≤${bracket.bracketMax}`
}

export interface GatherTablesCheck {
  /** 빌드를 세우는 오류. */
  violations: string[]
  /** 빌드는 통과하지만 설계 의도(잭팟·최종 실패 0%)에서 벗어난 것 — 작가에게 알린다. */
  warnings: string[]
}

/**
 * 표의 뜻을 검사한다. 위반 목록과 경고 목록을 나눠 돌려준다.
 *
 * GameData 를 함께 받는 이유: 표는 GameData 에 실리지 않지만(클라이언트 번들
 * 금지, 설계 §7-앞 9) 아이템·노드와 서로를 가리키므로, 그 참조가 성립하는지는
 * 양쪽을 다 보는 자리에서만 물을 수 있다. 노드 쪽 참조(없는 tableId)는
 * validateGameData 가 본다 — 그쪽의 조기 반환(참조 위반 시 도달 가능성 생략)에
 * 끼어야 해서다.
 */
export function validateGatherTables(tables: GatherTables, data: GameData): GatherTablesCheck {
  const violations: string[] = []
  const warnings: string[] = []

  for (const table of Object.values(tables)) {
    const at = `gather[${table.id}]`

    if (table.skillGainMin > table.skillGainMax) {
      violations.push(`${at}: skillGainMin(${table.skillGainMin}) 이 skillGainMax(${table.skillGainMax}) 보다 크다`)
    }

    // ∞ 브라켓은 정확히 하나, 마지막이어야 한다(설계 §7-앞 4). 없으면 상한 밖
    // 숙련도(예: 500001)가 어느 브라켓에도 안 걸려 라이브에서 판정 불능이 된다.
    const infinite = table.brackets.filter((b) => b.bracketMax === null)
    if (infinite.length === 0) {
      violations.push(
        `${at}: bracketMax 가 빈 칸(∞)인 브라켓이 없다 — 마지막 행의 bracketMax 를 비워야 상한 밖 숙련도 판정을 받는다`,
      )
    } else if (infinite.length > 1) {
      violations.push(
        `${at}: bracketMax 가 빈 칸(∞)인 브라켓이 ${infinite.length}개다 — 정확히 하나, 마지막 행이어야 한다`,
      )
    } else if (table.brackets.at(-1)!.bracketMax !== null) {
      violations.push(`${at}: ∞ 브라켓이 마지막이 아니다 — 그 뒤의 브라켓은 영원히 선택되지 않는다`)
    }

    // 유한 상한은 순오름차순이어야 한다. 브라켓은 "첫 번째 bracketMax ≥ 숙련도"
    // 로 골라지므로, 역순이나 같은 값 뒤의 브라켓은 영원히 선택되지 않는다.
    const finite = table.brackets.map((b) => b.bracketMax).filter((m): m is number => m !== null)
    for (let i = 1; i < finite.length; i++) {
      if (finite[i]! <= finite[i - 1]!) {
        violations.push(`${at}: 브라켓 상한이 오름차순이 아니다 — ${finite[i - 1]} 다음에 ${finite[i]} 이 왔다`)
      }
    }

    for (const bracket of table.brackets) {
      const bat = `${at} 브라켓(${bracketLabel(bracket)})`

      if (bracket.cumulative.length !== table.tiers.length) {
        violations.push(
          `${bat}: 누적 칸 수(${bracket.cumulative.length})가 티어 수(${table.tiers.length})와 다르다 — 티어마다 누적 상한이 하나씩 있어야 한다`,
        )
      }

      for (let i = 0; i < bracket.cumulative.length; i++) {
        const cum = bracket.cumulative[i]!
        if (cum > ROLL_MAX) {
          violations.push(`${bat}: 누적 ${cum} 이 ${ROLL_MAX} 을 넘는다 — roll 은 0~${ROLL_MAX} 이다`)
        }
        // 순증가 검사. 같은 값은 폭 0 — "roll ≤ 상한 첫 매치" 규칙에서 앞
        // 티어가 전부 가로채므로 그 티어는 영원히 안 나온다(설계 §7-앞 5).
        if (i > 0 && cum <= bracket.cumulative[i - 1]!) {
          violations.push(
            `${bat}: 누적이 순증가가 아니다 — cum${i + 1}(${cum}) 가 cum${i}(${bracket.cumulative[i - 1]}) 이하다. 같은 값은 폭 0, 영원히 안 나오는 티어다`,
          )
        }
      }
    }

    for (let i = 0; i < table.tiers.length; i++) {
      const itemId = table.tiers[i]!.itemId
      if (!Object.hasOwn(data.items, itemId)) {
        violations.push(`${at} 티어 ${i + 1}: 존재하지 않는 아이템 "${itemId}" 을 가리킨다`)
      }
    }

    // 고아 표 — CSV 에는 있지만 어느 노드도 안 가리키면 게임에 없는 표다.
    // "노드를 놓는 것을 잊었다" 를 배치 검사가 잡는 것과 같은 부류다.
    const users = Object.values(data.nodes).filter((n) => n.tableId === table.id)
    if (users.length === 0) {
      violations.push(`${at}: 어느 노드도 이 표를 가리키지 않는다 — 플레이어가 닿을 방법이 없는 표다`)
    }

    // 한 표는 한 기술의 노드만 가리킨다(설계 §7-앞 5). 다른 기술의 노드가 이
    // 표를 굴리면 그 채집이 엉뚱한 기술의 숙련으로 브라켓을 고르게 된다.
    for (const node of users) {
      if (node.skill !== table.skill) {
        violations.push(
          `nodes[${node.id}]: 기술(${node.skill})이 표 "${table.id}" 의 기술(${table.skill})과 다르다 — 한 표는 한 기술의 노드만 가리킨다`,
        )
      }
    }

    // ---- 경고 — 빌드는 통과하지만 설계 의도에서 벗어난 모양 ----

    // 최종 브라켓 실패 0% 는 원작 준용값이지 강제가 아니다 — 다만 벗어나면
    // "끝까지 올려도 빈손이 나온다" 는 큰 체감 변화라 작가가 알아야 한다(§7-앞 5).
    const last = table.brackets.at(-1)!
    const lastCum = last.cumulative.at(-1)
    if (last.bracketMax === null && lastCum !== undefined && lastCum < ROLL_MAX) {
      warnings.push(
        `${at}: 최종(∞) 브라켓에 실패가 남는다 — 마지막 누적이 ${lastCum} 이라 ${ROLL_MAX - lastCum}/${ROLL_MAX + 1} 은 빈손이다. 원작 준용은 ${ROLL_MAX}(실패 0%)이다`,
      )
    }

    // 첫 브라켓의 최상 티어가 누적 0 이면 roll=0 하나(1/100001)로 줄어든다 —
    // "숙련 0 부터 아주 가끔 전설급"(설계 §1)이 사실상 사라진다.
    const first = table.brackets[0]!
    if (first.cumulative[0] === 0) {
      warnings.push(
        `${at}: 첫 브라켓(${bracketLabel(first)})의 최상 티어 누적이 0 이다 — 숙련 0 의 잭팟이 사실상 사라진다`,
      )
    }
  }

  return { violations, warnings }
}
