import type { ItemDef, NodeDef, RecipeDef, RecipeInput, SkillId, TokenEffect } from '@nogada/shared'
import { SKILL_IDS, TOKEN_EFFECTS } from '@nogada/shared'

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

/**
 * 있으면 그 값, 없거나 비어 있으면 `undefined`.
 *
 * "없다"와 "비어 있다"를 같게 다루는 것이 핵심이다. 칸이 아예 없는 것은 그
 * 칸이 생기기 전에 쓰인 CSV 이고, 비어 있는 것은 그 행에 해당 없다는 뜻이다 —
 * 부르는 쪽이 하는 일(기본값을 쓴다)은 둘 다 같으므로 여기서 나눠 봐야
 * 부르는 쪽마다 같은 분기를 다시 쓰게 될 뿐이다.
 */
export function optionalCell(row: Row, key: string): string | undefined {
  const value = row[key]
  return value === undefined || value === '' ? undefined : value
}

export function requireCell(row: Row, key: string, context: string): string {
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
 * 없다. 0을 그대로 통과시키면 예컨대 outputCount=-1 이 실려서 rollInt 가 음수
 * 개수를 반환하는 식으로 나중에야 터진다. (예외적으로 0 이 유효한 칸 — 채집표의
 * 누적 상한 — 은 min 0 을 명시해 부른다.)
 */
export function toInt(value: string, context: string, field: string, min = 1): number {
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
export function toSkillId(value: string, context: string): SkillId {
  if (!isSkillId(value)) {
    throw new Error(`${context}: skill "${value}" 는 알 수 없다 (허용값: ${SKILL_IDS.join(', ')})`)
  }
  return value
}

/**
 * `tokenEffect` 칸이 실제 효과 이름인지 검사한다.
 *
 * 오타를 통과시키면 그 증표는 수십만 골드짜리인데 아무 효과도 없는 물건이 된다 —
 * 효과를 곱하는 쪽(GatherHand)이 모르는 이름을 그냥 무시하므로 화면 어디에도
 * 이유가 안 남는다.
 */
export function toTokenEffect(value: string, context: string): TokenEffect {
  if (!(TOKEN_EFFECTS as readonly string[]).includes(value)) {
    throw new Error(`${context}: tokenEffect "${value}" 는 알 수 없다 (허용값: ${TOKEN_EFFECTS.join(', ')})`)
  }
  return value as TokenEffect
}

/** 같은 id 를 가진 행이 이미 있으면 던진다. 조용한 덮어쓰기는 진단 없이 행 하나를 통째로 지운다. */
export function addUnique<T>(out: Record<string, T>, id: string, def: T, csvFile: string): void {
  if (Object.hasOwn(out, id)) {
    throw new Error(`${csvFile}: 중복된 id "${id}"`)
  }
  out[id] = def
}

const INTEGER_ID_PATTERN = /^\d+$/

/**
 * id 가 숫자로만 되어 있으면 던진다.
 *
 * `Record<string, T>` 로 실리는 id 는 자바스크립트 엔진의 정수형 키 규칙에
 * 걸린다 — "2", "10" 같은 순수 숫자 키는 삽입 순서를 무시하고 오름차순으로
 * 재배열되어, JSON.stringify/parse 를 한 번만 왕복해도 CSV 선언 순서(카테고리
 * 묶음 순서 등)가 조용히 깨진다. items.csv·recipes.csv 처럼 그 순서를
 * 화면(가방·제작 카드)이 그대로 쓰는 CSV 에서만 검사한다.
 */
export function assertNotIntegerId(id: string, context: string): void {
  if (INTEGER_ID_PATTERN.test(id)) {
    throw new Error(`${context}: id "${id}" 는 숫자만으로 만들 수 없다 — 목록 순서가 깨진다`)
  }
}

export function parseItems(rows: Row[]): Record<string, ItemDef> {
  const out: Record<string, ItemDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'items.csv')
    const ctx = `items.csv[${id}]`
    assertNotIntegerId(id, ctx)
    const kind = requireCell(row, 'kind', ctx)
    if (kind !== 'material' && kind !== 'tool') {
      throw new Error(`${ctx}: kind 는 material 또는 tool 이어야 한다`)
    }
    const def: ItemDef = {
      id,
      name: requireCell(row, 'name', ctx),
      kind,
      icon: requireCell(row, 'icon', ctx),
      // min 0 을 **명시해서** 부른다 — toInt 의 기본 최솟값은 1 이고, 그대로
      // 두면 도구 13종의 price=0(팔 수 없다)이 전부 거절된다. 그리고 requireCell
      // 이라 빈 칸은 통과하지 못한다: "0원"과 "안 적음"이 같은 값으로 뭉치면
      // 값을 빠뜨린 행이 조용히 "팔 수 없는 물건"이 된다(설계 §6-앞 15).
      price: toInt(requireCell(row, 'price', ctx), ctx, 'price', 0),
    }
    // 계열은 선택 칸이다 — 도구는 팔 수 없으니 상점 계열을 물을 일이 없어 비운다.
    // 적혀 있으면 실재하는 기술이어야 한다(오타는 그 아이템을 어느 상점도 사 주지
    // 않는 물건으로 만든다). 그 계열이 채집 사다리와 어긋나는지는 표를 함께 보는
    // validateGameData 의 몫이다.
    const skill = optionalCell(row, 'skill')
    if (skill !== undefined) def.skill = toSkillId(skill, ctx)
    // 증표는 새 kind 가 아니라 이 선택 칸으로만 드러난다(설계 §6-앞 11) —
    // kind='token' 을 만들면 가방 패널의 `kind !== 'material'` 가드가 수십만
    // 골드짜리 물건을 조용히 숨긴다. 값은 두 가지뿐이고, 오타는 "샀는데 아무
    // 효과도 없는 증표"가 되므로 여기서 막는다. 나머지 증표 제약(레시피 산출물
    // 금지·표 티어 금지·toolSkill 금지·skill 필수)은 레시피와 표를 함께 보는
    // validateGameData 의 몫이다.
    const tokenEffect = optionalCell(row, 'tokenEffect')
    if (tokenEffect !== undefined) def.tokenEffect = toTokenEffect(tokenEffect, ctx)
    if (kind === 'tool') {
      def.toolSkill = toSkillId(requireCell(row, 'toolSkill', ctx), ctx)
      def.toolTier = toInt(requireCell(row, 'toolTier', ctx), ctx, 'toolTier')
    }
    addUnique(out, id, def, 'items.csv')
  }
  return out
}

/**
 * 노드는 이제 표를 가리킬 뿐이다 — 무엇이 얼마나 나오는지는 전부 확률표
 * (gather_tables 3파일)가 정하고, 노드에 남는 것은 자리(어느 기술·어느 표)와
 * 외형(variant)뿐이다(설계 §3.2). tableId 가 실재하는 표인지는 표를 함께 보는
 * validateGameData 가 검사한다.
 */
export function parseNodes(rows: Row[]): Record<string, NodeDef> {
  const out: Record<string, NodeDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'nodes.csv')
    const ctx = `nodes.csv[${id}]`
    const variant = requireCell(row, 'variant', ctx)
    if (variant !== 'normal' && variant !== 'deep') {
      throw new Error(`${ctx}: variant "${variant}" 는 알 수 없다 (허용값: normal, deep)`)
    }
    const def: NodeDef = {
      id,
      name: requireCell(row, 'name', ctx),
      skill: toSkillId(requireCell(row, 'skill', ctx), ctx),
      tableId: requireCell(row, 'tableId', ctx),
      variant,
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

/**
 * category 칸을 읽어 trim 하고, trim 후에도 빈 값이면 던진다.
 *
 * `requireCell` 은 `=== ''` 만 보므로 공백 한 칸짜리 셀(`" "`)이 그대로
 * 통과해 제작 패널에 이름 없는 섹션 헤더가 뜨는 구멍이 있다 — 여기서 trim 한
 * 뒤 다시 검사해 막는다. validate.ts 가 아니라 여기(parse.ts)에서 검사하는
 * 이유는 validate 는 값을 변형하지 않는 계층이고, trim 은 값을 바꾸는
 * 일이라 파싱 시점에 해야 하기 때문이다.
 */
function requireCategory(row: Row, context: string): string {
  const trimmed = requireCell(row, 'category', context).trim()
  if (trimmed === '') {
    throw new Error(`${context}: category 가 공백뿐이다 — 분류 이름을 채워야 한다`)
  }
  return trimmed
}

/**
 * 계열 문턱 두 칸(`gateSkill`,`gateValue`)을 읽어 레시피에 붙인다 —
 * 문을 여는 두 번째 숫자다(설계 §6-앞 9·10).
 *
 * **둘은 함께 있거나 함께 없어야 한다.** 한쪽만 적힌 행을 통과시키면 저자는
 * 문턱을 걸었다고 믿는데 게임에는 문이 없거나(값 없음) 무엇의 숫자인지 모르는
 * 문(기술 없음)이 선다 — 그 어긋남은 화면 어디에도 흔적을 남기지 않는다.
 */
function applyGate(def: RecipeDef, row: Row, ctx: string): void {
  const gateSkill = optionalCell(row, 'gateSkill')
  const gateValue = optionalCell(row, 'gateValue')
  if ((gateSkill === undefined) !== (gateValue === undefined)) {
    throw new Error(
      `${ctx}: gateSkill 과 gateValue 는 함께 적거나 함께 비워야 한다 (지금 gateSkill="${gateSkill ?? ''}", gateValue="${gateValue ?? ''}")`,
    )
  }
  if (gateSkill === undefined || gateValue === undefined) return

  // 오류 문구에 칸 이름을 실어 준다 — 그냥 ctx 로 부르면 `skill` 칸을 지적하는
  // 것처럼 읽혀서, 멀쩡한 칸을 들여다보게 만든다.
  const skill = toSkillId(gateSkill, `${ctx}.gateSkill`)
  if (skill === 'crafting') {
    throw new Error(
      `${ctx}: gateSkill 은 채집 계열이어야 한다 — 조합 숙련도는 이미 requiredSkill 이 지키는 문이다`,
    )
  }
  def.gateSkill = skill
  def.gateValue = toInt(gateValue, ctx, 'gateValue')
}

export function parseRecipes(rows: Row[]): Record<string, RecipeDef> {
  const out: Record<string, RecipeDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'recipes.csv')
    const ctx = `recipes.csv[${id}]`
    assertNotIntegerId(id, ctx)
    const def: RecipeDef = {
      id,
      name: requireCell(row, 'name', ctx),
      category: requireCategory(row, ctx),
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
    applyGate(def, row, ctx)
    addUnique(out, id, def, 'recipes.csv')
  }
  return out
}
