import type {
  MilestoneDef,
  MilestoneEffect,
  MilestoneMetric,
  NodeDef,
  RecipeDef,
  SkillId,
} from '@nogada/shared'
import { SKILL_IDS } from '@nogada/shared'

type Row = Record<string, string>

function requireCell(row: Row, key: string, context: string): string {
  const value = row[key]
  if (value === undefined || value === '') {
    throw new Error(`${context}: 필수 항목 "${key}" 가 비어 있다`)
  }
  return value
}

/**
 * 정수로 변환하고 최솟값을 만족하는지 검사한다. packages/data/src/parse.ts 의 toInt 와
 * 같은 규칙이다 — 기본 최솟값 1은 이 CSV의 threshold 가 "얼마 이상이어야 달성인지"를
 * 세는 값이라 0 이하가 의미 있는 경우가 없기 때문이다.
 */
function toInt(value: string, context: string, field: string, min = 1): number {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new Error(`${context}: ${field} "${value}" 는 정수가 아니다`)
  if (n < min) throw new Error(`${context}: ${field} "${value}" 는 ${min} 이상이어야 한다`)
  return n
}

function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as readonly string[]).includes(value)
}

/** skill 칸이 실제 SKILL_IDS 에 속하는지 검사한다. parse.ts 의 toSkillId 와 같은 오류 형식이다. */
function toSkillId(value: string, context: string): SkillId {
  if (!isSkillId(value)) {
    throw new Error(`${context}: skill "${value}" 는 알 수 없다 (허용값: ${SKILL_IDS.join(', ')})`)
  }
  return value
}

/** 같은 id 를 가진 행이 이미 있으면 던진다. parse.ts 의 addUnique 와 같은 오류 형식이다. */
function addUnique(seen: Record<string, true>, id: string, csvFile: string): void {
  if (Object.hasOwn(seen, id)) {
    throw new Error(`${csvFile}: 중복된 id "${id}"`)
  }
  seen[id] = true
}

/** "a|b|c" 를 파싱한다. 빈 항목("a||b", "a|", "|a")은 허용하지 않는다 — 빈 id 를 가리키는 참조가 된다. */
function parsePipeList(value: string, context: string, field: string): string[] {
  const parts = value.split('|')
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`${context}: ${field} "${value}" 에 빈 항목이 있다`)
  }
  return parts
}

const METRIC_KINDS = ['skill', 'every'] as const
const EFFECT_KINDS = ['repeat', 'recipes', 'nodes', 'title'] as const

function toMetric(row: Row, ctx: string): MilestoneMetric {
  const kind = requireCell(row, 'metricKind', ctx)
  const arg = requireCell(row, 'metricArg', ctx)

  if (kind === 'skill') return { kind: 'skill', skill: toSkillId(arg, ctx) }
  if (kind === 'every') return { kind: 'every', of: parsePipeList(arg, ctx, 'metricArg') }

  throw new Error(`${ctx}: metricKind "${kind}" 는 알 수 없다 (허용값: ${METRIC_KINDS.join(', ')})`)
}

/**
 * `recipes`·`nodes` 효과가 가리키는 대상이 실재하는지 여기서 바로 검사한다.
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
  nodes: Record<string, NodeDef>,
  recipes: Record<string, RecipeDef>,
): MilestoneEffect {
  const kind = requireCell(row, 'effectKind', ctx)

  if (kind === 'title') return { kind: 'title' }

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

  if (kind === 'nodes') {
    const ids = parsePipeList(requireCell(row, 'effectArg', ctx), ctx, 'effectArg')
    for (const id of ids) {
      if (!Object.hasOwn(nodes, id)) {
        throw new Error(`${ctx}: 존재하지 않는 노드 "${id}" 를 가리킨다`)
      }
    }
    return { kind: 'nodes', ids }
  }

  throw new Error(`${ctx}: effectKind "${kind}" 는 알 수 없다 (허용값: ${EFFECT_KINDS.join(', ')})`)
}

/**
 * milestones.csv 를 파싱한다. 정의 순서를 그대로 보존하는 배열을 돌려준다 —
 * nextMilestone(packages/shared)이 동점일 때 이 순서로 정하기 때문이다.
 */
export function parseMilestones(
  rows: Row[],
  nodes: Record<string, NodeDef>,
  recipes: Record<string, RecipeDef>,
): MilestoneDef[] {
  const out: MilestoneDef[] = []
  const seenIds: Record<string, true> = {}

  for (const row of rows) {
    const id = requireCell(row, 'id', 'milestones.csv')
    const ctx = `milestones.csv[${id}]`
    addUnique(seenIds, id, 'milestones.csv')

    out.push({
      id,
      metric: toMetric(row, ctx),
      threshold: toInt(requireCell(row, 'threshold', ctx), ctx, 'threshold'),
      name: requireCell(row, 'name', ctx),
      announce: row['announce'] ?? '',
      effect: toEffect(row, ctx, nodes, recipes),
    })
  }

  return out
}
