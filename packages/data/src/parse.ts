import type { ItemDef, NodeDef, RecipeDef, RecipeInput, SkillId } from '@nogada/shared'

type Row = Record<string, string>

/** 따옴표를 지원하지 않는 최소 CSV 파서. 데이터에 쉼표를 넣지 않는다. */
export function parseCsv(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return []

  const header = lines[0]!.split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
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

function toInt(value: string, context: string): number {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new Error(`${context}: "${value}" 는 정수가 아니다`)
  return n
}

export function parseItems(rows: Row[]): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'items.csv')
    const kind = requireCell(row, 'kind', `items.csv[${id}]`)
    if (kind !== 'material' && kind !== 'tool') {
      throw new Error(`items.csv[${id}]: kind 는 material 또는 tool 이어야 한다`)
    }
    const def: ItemDef = {
      id,
      name: requireCell(row, 'name', `items.csv[${id}]`),
      kind,
      icon: requireCell(row, 'icon', `items.csv[${id}]`),
    }
    if (kind === 'tool') {
      def.toolSkill = requireCell(row, 'toolSkill', `items.csv[${id}]`) as SkillId
      def.toolTier = toInt(requireCell(row, 'toolTier', `items.csv[${id}]`), `items.csv[${id}]`)
    }
    out[id] = def
  }
  return out
}

export function parseNodes(rows: Row[]): Record<string, NodeDef> {
  const out: Record<string, NodeDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'nodes.csv')
    const ctx = `nodes.csv[${id}]`
    out[id] = {
      id,
      name: requireCell(row, 'name', ctx),
      skill: requireCell(row, 'skill', ctx) as SkillId,
      tier: toInt(requireCell(row, 'tier', ctx), ctx),
      requiredLevel: toInt(requireCell(row, 'requiredLevel', ctx), ctx),
      yieldItem: requireCell(row, 'yieldItem', ctx),
      yieldMin: toInt(requireCell(row, 'yieldMin', ctx), ctx),
      yieldMax: toInt(requireCell(row, 'yieldMax', ctx), ctx),
      respawnMs: toInt(requireCell(row, 'respawnMs', ctx), ctx),
    }
  }
  return out
}

/** "copper_ore:2|iron_ingot:1" 형식을 파싱한다. */
function parseInputs(raw: string, context: string): RecipeInput[] {
  return raw.split('|').map((part) => {
    const [item, count] = part.split(':')
    if (!item || !count) throw new Error(`${context}: 재료 표기 "${part}" 가 잘못됐다`)
    return { item, count: toInt(count, context) }
  })
}

export function parseRecipes(rows: Row[]): Record<string, RecipeDef> {
  const out: Record<string, RecipeDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'recipes.csv')
    const ctx = `recipes.csv[${id}]`
    out[id] = {
      id,
      name: requireCell(row, 'name', ctx),
      skill: requireCell(row, 'skill', ctx) as SkillId,
      requiredLevel: toInt(requireCell(row, 'requiredLevel', ctx), ctx),
      inputs: parseInputs(requireCell(row, 'inputs', ctx), ctx),
      output: {
        item: requireCell(row, 'outputItem', ctx),
        count: toInt(requireCell(row, 'outputCount', ctx), ctx),
      },
    }
  }
  return out
}
