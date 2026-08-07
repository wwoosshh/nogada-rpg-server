import type { ItemDef, NodeDef, RecipeDef, RecipeInput, SkillId } from '@nogada/shared'
import { SKILL_IDS } from '@nogada/shared'

type Row = Record<string, string>

/** 따옴표를 지원하지 않는 최소 CSV 파서. 데이터에 쉼표를 넣지 않는다. */
export function parseCsv(text: string): Row[] {
  const rawLines = text.split(/\r?\n/)
  const lines: { lineNumber: number; content: string }[] = []
  rawLines.forEach((raw, i) => {
    const content = raw.trim()
    if (content.length > 0) lines.push({ lineNumber: i + 1, content })
  })
  if (lines.length === 0) return []

  const header = lines[0]!.content.split(',')
  return lines.slice(1).map(({ lineNumber, content }) => {
    const cells = content.split(',')
    // 칸 개수가 헤더와 다르면 잘못 자른 것이다 — 흔한 원인은 따옴표 없는 값 안의 쉼표.
    // 초과분을 조용히 버리면 뒤 칸들이 밀려 엉뚱한 필드에서 오해의 소지가 있는
    // 오류(예: 이름 조각이 skill 값으로 읽힘)가 난다.
    if (cells.length !== header.length) {
      throw new Error(`${lineNumber}행: 칸 개수가 헤더와 다르다 (헤더 ${header.length}개, 이 행 ${cells.length}개)`)
    }
    const row: Row = {}
    header.forEach((key, i) => {
      row[key] = cells[i] ?? ''
    })
    return row
  })
}

function requireCell(row: Row, key: string, context: string): string {
  const value = row[key]
  if (value === undefined || value === '') {
    throw new Error(`${context}: 필수 항목 "${key}" 가 비어 있다`)
  }
  return value
}

/**
 * 정수로 변환하고 최솟값을 만족하는지 검사한다.
 *
 * 기본 최솟값은 1 이다 — 이 CSV들의 정수 필드(등급, 개수, 숙련도 증가량)는
 * 전부 "몇 등급/몇 개/얼마나 늘어나는지"를 세는 값이라 0 이하가 의미 있는 경우가
 * 없다. 0을 그대로 통과시키면 예컨대 yieldMin=-1 이 실려서 rollInt 가 음수 개수를
 * 반환하는 식으로 나중에야 터진다.
 */
function toInt(value: string, context: string, field: string, min = 1): number {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new Error(`${context}: ${field} "${value}" 는 정수가 아니다`)
  if (n < min) throw new Error(`${context}: ${field} "${value}" 는 ${min} 이상이어야 한다`)
  return n
}

/**
 * 소수로 변환하고 범위를 검사한다.
 *
 * baseChance 처럼 0~1 사이여야 하는 확률값용이다. 정수 검사(toInt)를 그대로
 * 쓰면 0.5 가 통과하지 못하고, 검사를 아예 빼면 1.5 같은 값이 실려 성공률이
 * 상한에 눌러붙는 형태로 나중에야 드러난다.
 */
function toFloat(value: string, context: string, field: string, min: number, max: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`${context}: ${field} "${value}" 는 숫자가 아니다`)
  if (n < min || n > max) {
    throw new Error(`${context}: ${field} "${value}" 는 ${min} 이상 ${max} 이하여야 한다`)
  }
  return n
}

function isSkillId(value: string): value is SkillId {
  return (SKILL_IDS as readonly string[]).includes(value)
}

/** CSV 의 skill/toolSkill 칸이 실제 SKILL_IDS 에 속하는지 검사한다. 오타가 조용히 통과하는 것을 막는다. */
function toSkillId(value: string, context: string): SkillId {
  if (!isSkillId(value)) {
    throw new Error(`${context}: skill "${value}" 는 알 수 없다 (허용값: ${SKILL_IDS.join(', ')})`)
  }
  return value
}

/** 같은 id 를 가진 행이 이미 있으면 던진다. 조용한 덮어쓰기는 진단 없이 행 하나를 통째로 지운다. */
function addUnique<T>(out: Record<string, T>, id: string, def: T, csvFile: string): void {
  if (Object.hasOwn(out, id)) {
    throw new Error(`${csvFile}: 중복된 id "${id}"`)
  }
  out[id] = def
}

export function parseItems(rows: Row[]): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'items.csv')
    const ctx = `items.csv[${id}]`
    const kind = requireCell(row, 'kind', ctx)
    if (kind !== 'material' && kind !== 'tool') {
      throw new Error(`${ctx}: kind 는 material 또는 tool 이어야 한다`)
    }
    const def: ItemDef = {
      id,
      name: requireCell(row, 'name', ctx),
      kind,
      icon: requireCell(row, 'icon', ctx),
    }
    if (kind === 'tool') {
      def.toolSkill = toSkillId(requireCell(row, 'toolSkill', ctx), ctx)
      def.toolTier = toInt(requireCell(row, 'toolTier', ctx), ctx, 'toolTier')
    }
    addUnique(out, id, def, 'items.csv')
  }
  return out
}

export function parseNodes(rows: Row[]): Record<string, NodeDef> {
  const out: Record<string, NodeDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'nodes.csv')
    const ctx = `nodes.csv[${id}]`
    const def: NodeDef = {
      id,
      name: requireCell(row, 'name', ctx),
      skill: toSkillId(requireCell(row, 'skill', ctx), ctx),
      tier: toInt(requireCell(row, 'tier', ctx), ctx, 'tier'),
      baseChance: toFloat(requireCell(row, 'baseChance', ctx), ctx, 'baseChance', 0.01, 1),
      yieldItem: requireCell(row, 'yieldItem', ctx),
      yieldMin: toInt(requireCell(row, 'yieldMin', ctx), ctx, 'yieldMin'),
      yieldMax: toInt(requireCell(row, 'yieldMax', ctx), ctx, 'yieldMax'),
      skillGainMin: toInt(requireCell(row, 'skillGainMin', ctx), ctx, 'skillGainMin'),
      skillGainMax: toInt(requireCell(row, 'skillGainMax', ctx), ctx, 'skillGainMax'),
    }
    addUnique(out, id, def, 'nodes.csv')
  }
  return out
}

/** "copper_ore:2|iron_ingot:1" 형식을 파싱한다. */
function parseInputs(raw: string, context: string): RecipeInput[] {
  return raw.split('|').map((part) => {
    const [item, count] = part.split(':')
    if (!item || !count) throw new Error(`${context}: 재료 표기 "${part}" 가 잘못됐다`)
    return { item, count: toInt(count, context, `inputs(${item})`) }
  })
}

export function parseRecipes(rows: Row[]): Record<string, RecipeDef> {
  const out: Record<string, RecipeDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'recipes.csv')
    const ctx = `recipes.csv[${id}]`
    const def: RecipeDef = {
      id,
      name: requireCell(row, 'name', ctx),
      skill: toSkillId(requireCell(row, 'skill', ctx), ctx),
      requiredSkill: toInt(requireCell(row, 'requiredSkill', ctx), ctx, 'requiredSkill', 0),
      baseChance: toFloat(requireCell(row, 'baseChance', ctx), ctx, 'baseChance', 0.01, 1),
      inputs: parseInputs(requireCell(row, 'inputs', ctx), ctx),
      output: {
        item: requireCell(row, 'outputItem', ctx),
        count: toInt(requireCell(row, 'outputCount', ctx), ctx, 'outputCount'),
      },
      skillGainMin: toInt(requireCell(row, 'skillGainMin', ctx), ctx, 'skillGainMin'),
      skillGainMax: toInt(requireCell(row, 'skillGainMax', ctx), ctx, 'skillGainMax'),
    }
    addUnique(out, id, def, 'recipes.csv')
  }
  return out
}
