import type {
  MilestoneDef,
  MilestoneEffect,
  MilestoneMetric,
  RecipeDef,
} from '@nogada/shared'
import { addUnique, requireCell, toInt, toSkillId } from './parse.js'

type Row = Record<string, string>

/*
 * requireCell·toInt·toSkillId·addUnique 는 packages/data/src/parse.ts 것을 그대로
 * 쓴다. 예전에는 이 파일이 넷을 손으로 옮겨 적고 있었는데, addUnique 만 시그니처가
 * 달랐다(여긴 "본 적 있는 id 집합"만 표시하는 3-인자, parse.ts 는 실제 값을 저장하는
 * 제네릭 4-인자) — 이름과 오류 메시지("중복된 id")는 같은데 인자 개수가 다른 것을
 * 나란히 두면 둘 중 뭐가 진짜인지 매번 다시 확인해야 한다. parse.ts 쪽이 더 일반적
 * 이라(값을 저장 안 하고 싶으면 그냥 `true` 를 넣으면 된다) 이쪽 것을 지우고
 * parse.ts 쪽으로 합쳤다 — 아래 seenIds 호출부가 그 방식이다.
 */

/** "a|b|c" 를 파싱한다. 빈 항목("a||b", "a|", "|a")은 허용하지 않는다 — 빈 id 를 가리키는 참조가 된다. */
function parsePipeList(value: string, context: string, field: string): string[] {
  const parts = value.split('|')
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`${context}: ${field} "${value}" 에 빈 항목이 있다`)
  }
  return parts
}

const METRIC_KINDS = ['skill', 'every', 'collection'] as const
// 'nodes' 는 은퇴했다(설계 §7-앞 2) — 노드 tier 게이트가 폐지되어 선언할 게이트가 없다.
const EFFECT_KINDS = ['repeat', 'recipes', 'stock', 'barrier', 'title'] as const

/**
 * 인자를 안 쓰는 종류에 인자가 적혀 있으면 그 자리에서 거절한다.
 *
 * 조용히 무시하면 작가는 자기가 적은 것이 무언가를 한다고 믿는다 — `collection`
 * 의 metricArg 에 `ice` 를 적어 두면 "얼음 칸만 세는 총점"으로 읽히지만 실제로는
 * 방 전체를 세고, 그 오해는 화면 어디에도 드러나지 않는다.
 */
function requireEmpty(row: Row, field: string, ctx: string, why: string): void {
  const value = (row[field] ?? '').trim()
  if (value !== '') throw new Error(`${ctx}: ${field} 에 "${value}" 가 적혔다 — ${why}`)
}

function toMetric(row: Row, ctx: string): MilestoneMetric {
  const kind = requireCell(row, 'metricKind', ctx)

  // 인자를 요구하기 **전에** 인자 없는 종류를 가른다 — requireCell 은 빈 칸을
  // 던지므로, 위에 두면 인자가 없는 것이 정상인 지표를 적을 방법이 사라진다.
  if (kind === 'collection') {
    requireEmpty(row, 'metricArg', ctx, '수집 총점은 방 하나의 점수라 고를 인자가 없다')
    return { kind: 'collection' }
  }

  const arg = requireCell(row, 'metricArg', ctx)

  if (kind === 'skill') return { kind: 'skill', skill: toSkillId(arg, ctx) }
  if (kind === 'every') return { kind: 'every', of: parsePipeList(arg, ctx, 'metricArg') }

  throw new Error(`${ctx}: metricKind "${kind}" 는 알 수 없다 (허용값: ${METRIC_KINDS.join(', ')})`)
}

/**
 * `recipes` 효과가 가리키는 대상이 실재하는지 여기서 바로 검사한다.
 *
 * 이정표는 게이트를 선언할 뿐이므로, 선언한 대상이 없으면 그 자체로 데이터 오류다 —
 * placements.ts 가 노드 참조를 파싱 시점에 바로 검사하는 것과 같은 이유로, validate.ts 의
 * 나중 단계까지 미루지 않는다.
 *
 * 반대로 `every` 의 metricArg 가 가리키는 이정표 id 는 여기서 검사하지 않는다 — 그 이정표가
 * CSV 뒤쪽에 나오는 전방 참조일 수 있어서, 전체 목록이 다 모여야 판단할 수 있다
 * (validate.ts 가 GameData 전체를 놓고 검사한다).
 */
function toEffect(
  row: Row,
  ctx: string,
  recipes: Record<string, RecipeDef>,
): MilestoneEffect {
  const kind = requireCell(row, 'effectKind', ctx)

  if (kind === 'title') return { kind: 'title' }

  // `stock` 이 무엇을 여는지는 effectArg 가 아니라 **진열이 안다**: 같은 총점을
  // 요구하는 shop_stock.csv 의 행들이 그 목록이다(§6-앞 7). 여기에 한 번 더 적게
  // 하면 두 벌이 갈라지고, 그 어긋남은 "목록엔 적혔는데 상점엔 없다"로만 드러난다.
  // 둘이 맞물리는지는 validate.ts 가 양방향으로 본다.
  if (kind === 'stock') {
    requireEmpty(row, 'effectArg', ctx, '무엇이 열리는지는 같은 문턱을 요구하는 shop_stock.csv 의 unlockCollection 행들이 정한다')
    return { kind: 'stock' }
  }

  // `barrier` 는 `stock` 의 전환판이다 — 무엇이 열리는지는 effectArg 가 아니라
  // **문이 안다**: 같은 계열·같은 숫자를 요구하는 transitions.csv 의 gateSkill·
  // gateValue 행들이 그 목록이다(shared 의 barrierDoorsOf). 여기에 한 번 더 적게
  // 하면 두 벌이 갈라지고, 그 어긋남은 "목록엔 적혔는데 그 칸엔 문이 없다"로만
  // 드러난다. 둘이 맞물리는지는 validate.ts 가 양방향으로 본다.
  //
  // 계열을 여기서 안 받는 이유: 그것은 이미 metricKind=skill 의 metricArg 다.
  // 문턱도 threshold 다 — 짝의 열쇠 둘이 모두 이 행에 이미 있으므로, 효과 칸이
  // 더 적을 것은 없다. 둘이 어긋나는 조합(예: 지표가 총점인데 효과가 barrier)은
  // 이 행 하나만 봐서는 판단할 수 없어 validate.ts 가 진다.
  if (kind === 'barrier') {
    requireEmpty(row, 'effectArg', ctx, '무엇이 열리는지는 같은 계열·같은 숫자를 요구하는 transitions.csv 의 gateSkill·gateValue 행들이 정한다')
    return { kind: 'barrier' }
  }

  if (kind === 'repeat') {
    const arg = requireCell(row, 'effectArg', ctx)
    return { kind: 'repeat', skill: toSkillId(arg, ctx) }
  }

  if (kind === 'recipes') {
    const ids = parsePipeList(requireCell(row, 'effectArg', ctx), ctx, 'effectArg')
    for (const id of ids) {
      if (!Object.hasOwn(recipes, id)) {
        throw new Error(`${ctx}: 존재하지 않는 레시피 "${id}" 를 가리킨다`)
      }
    }
    return { kind: 'recipes', ids }
  }

  throw new Error(`${ctx}: effectKind "${kind}" 는 알 수 없다 (허용값: ${EFFECT_KINDS.join(', ')})`)
}

/**
 * milestones.csv 를 파싱한다. 정의 순서를 그대로 보존하는 배열을 돌려준다 —
 * 이정표 탭(apps/client/src/game/detailMenuTabs.ts 의 buildMilestoneRows)이
 * 동점 진척을 이 순서로 정렬하기 때문이다.
 */
export function parseMilestones(
  rows: Row[],
  recipes: Record<string, RecipeDef>,
): MilestoneDef[] {
  const out: MilestoneDef[] = []
  const seenIds: Record<string, true> = {}

  for (const row of rows) {
    const id = requireCell(row, 'id', 'milestones.csv')
    const ctx = `milestones.csv[${id}]`
    // parse.ts 의 addUnique 는 값을 저장하는 4-인자 제네릭이다 — 여기서는 저장할
    // 값이 필요 없고 "본 적 있다"만 표시하면 되므로 true 를 넣는다.
    addUnique(seenIds, id, true, 'milestones.csv')

    out.push({
      id,
      metric: toMetric(row, ctx),
      threshold: toInt(requireCell(row, 'threshold', ctx), ctx, 'threshold'),
      name: requireCell(row, 'name', ctx),
      announce: row['announce'] ?? '',
      effect: toEffect(row, ctx, recipes),
    })
  }

  return out
}
