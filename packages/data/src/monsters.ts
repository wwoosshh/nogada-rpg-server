import type {
  Direction,
  MonsterAttackDef,
  MonsterDef,
  MonsterDropDef,
  MonsterDropTables,
  MonsterPlacements,
} from '@nogada/shared'
import { DIRECTIONS } from '@nogada/shared'
import { addUnique, requireCell, toInt } from './parse.js'

type Row = Record<string, string>

/**
 * 몬스터 다섯 CSV(종·순찰·공격·배치·드랍)를 `{ defs, placements, drops }` 로 편다.
 *
 * **배치별로 def 를 굽는 것이 이 파서의 결정이다.** `MonsterDef.patrol` 은 절대
 * 좌표다 — C1 의 순수함수 설계에서 `monsterStateAt` 은 지형도 원점도 모른다.
 * 그래서 같은 종을 세 자리에 놓으려면 종의 상대 순찰에 배치 원점을 더해 배치마다
 * def 를 굽고, `monsterId = instanceId` 가 된다. 대안(원점을 placement 에 싣고
 * 판정마다 평행이동)은 C4 의 판정·C5 의 렌더 전부에 파급되므로 여기서 굽는다 —
 * shared 는 건드리지 않는다.
 *
 * 드랍표도 같은 이유로 종 표 하나를 배치 키마다 건다 — fightService 가
 * `drops[placement.monsterId]` 로 찾기 때문이다.
 *
 * 여기서 던지는 것은 "조립 자체가 안 되는" 구조 오류다(gatherTables 의 그 저울):
 * 없는 종 참조, 없는 direction, 정수 아닌 수치, 음수 위상, 빈 개체값, 넘치는
 * chance 합. 조립은 되지만 뜻이 어긋나는 것(벽 위 순찰, 겹치는 창, 풀 수 없는
 * 패턴)은 지형을 함께 보는 validateMonsterPatterns(C2, 설계 §8)가 목록으로 보고한다.
 */
export interface ParsedMonsters {
  defs: Record<string, MonsterDef>
  placements: MonsterPlacements
  drops: MonsterDropTables
}

/** 종 하나의 중간 모양 — 상대 순찰과 공격표. 배치가 이것을 원점과 함께 굽는다. */
interface SpeciesDef {
  id: string
  name: string
  periodMs: number
  /** 상대 순찰 시간표(슬롯 단위로 이미 펴져 있다). RLE 의 행 순서가 곧 슬롯 순서다. */
  patrol: { dx: number; dy: number }[]
  attacks: MonsterAttackDef[]
  drops: MonsterDropDef[]
}

function toDirection(value: string, ctx: string): Direction {
  if (!(DIRECTIONS as readonly string[]).includes(value)) {
    throw new Error(`${ctx}: direction "${value}" 는 알 수 없다 (허용값: ${DIRECTIONS.join(', ')})`)
  }
  return value as Direction
}

/**
 * chance 칸 — 0 초과 1 이하의 소수다(MonsterDropDef). toInt 를 못 쓰는 이유는
 * baseChance 와 같고, 0 을 거르는 이유는 "절대 안 나오는 드랍 줄"이 오타와
 * 구별되지 않기 때문이다 — 안 나올 줄은 적지 않는다.
 */
function toChance(value: string, ctx: string): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n > 1) {
    throw new Error(`${ctx}: chance "${value}" 는 0 초과 1 이하여야 한다`)
  }
  return n
}

/** 그 행이 가리키는 종. 없으면 던진다 — gather_tiers 가 없는 표를 거절하는 그 문장이다. */
function speciesOf(table: Record<string, SpeciesDef>, row: Row, csv: string): SpeciesDef {
  const id = requireCell(row, 'species', csv)
  const species = table[id]
  if (!species) {
    throw new Error(`${csv}[${id}]: 존재하지 않는 종을 가리킨다 — monster_species.csv 에 먼저 적는다`)
  }
  return species
}

export function parseMonsters(
  speciesRows: Row[],
  patrolRows: Row[],
  attackRows: Row[],
  placementRows: Row[],
  dropRows: Row[],
): ParsedMonsters {
  const species: Record<string, SpeciesDef> = {}

  for (const row of speciesRows) {
    const id = requireCell(row, 'id', 'monster_species.csv')
    const ctx = `monster_species.csv[${id}]`
    const def: SpeciesDef = {
      id,
      name: requireCell(row, 'name', ctx),
      periodMs: toInt(requireCell(row, 'periodMs', ctx), ctx, 'periodMs'),
      patrol: [],
      attacks: [],
      drops: [],
    }
    addUnique(species, id, def, 'monster_species.csv')
  }

  for (const row of patrolRows) {
    const sp = speciesOf(species, row, 'monster_patrol.csv')
    const ctx = `monster_patrol.csv[${sp.id}]`
    // dx·dy 는 원점 기준 상대 좌표라 음수가 정상이다 — toInt 의 기본 최솟값(1)을
    // 명시적으로 푼다. 정수 검사는 그대로 남는다.
    const dx = toInt(requireCell(row, 'dx', ctx), ctx, 'dx', Number.MIN_SAFE_INTEGER)
    const dy = toInt(requireCell(row, 'dy', ctx), ctx, 'dy', Number.MIN_SAFE_INTEGER)
    // slots ≥ 1 — 0 슬롯 행은 시간표에 설 자리가 없는데, 조용히 접으면 "행을
    // 적었으니 슬롯이 있다"고 믿는 작가의 주기 산술(주기 ÷ 슬롯 수)이 어긋난다.
    const slots = toInt(requireCell(row, 'slots', ctx), ctx, 'slots')
    for (let i = 0; i < slots; i++) sp.patrol.push({ dx, dy })
  }

  for (const row of attackRows) {
    const sp = speciesOf(species, row, 'monster_attacks.csv')
    const ctx = `monster_attacks.csv[${sp.id}]`
    sp.attacks.push({
      telegraphStartMs: toInt(requireCell(row, 'telegraphStartMs', ctx), ctx, 'telegraphStartMs', 0),
      telegraphMs: toInt(requireCell(row, 'telegraphMs', ctx), ctx, 'telegraphMs'),
      activeMs: toInt(requireCell(row, 'activeMs', ctx), ctx, 'activeMs'),
      direction: toDirection(requireCell(row, 'direction', ctx), ctx),
      reach: toInt(requireCell(row, 'reach', ctx), ctx, 'reach'),
    })
  }

  for (const row of dropRows) {
    const sp = speciesOf(species, row, 'monster_drops.csv')
    const ctx = `monster_drops.csv[${sp.id}]`
    sp.drops.push({
      itemId: requireCell(row, 'itemId', ctx),
      chance: toChance(requireCell(row, 'chance', ctx), ctx),
    })
    // 합은 줄이 늘 때마다 다시 잰다 — 처치 한 번의 굴림은 roll 하나를 누적 합에
    // 대므로(rollMonsterDrop), 합이 1 을 넘으면 넘친 만큼 뒤 줄이 눌리는데 그
    // 어긋남은 수천 번 잡아 통계를 내기 전엔 안 보인다.
    const sum = sp.drops.reduce((acc, d) => acc + d.chance, 0)
    if (sum > 1) {
      throw new Error(
        `${ctx}: chance 합계가 ${sum} 로 1 을 넘는다 — 드랍 굴림은 누적 합이라 넘친 만큼 뒤 줄이 눌린다. 줄들의 chance 를 합 1 이하로 줄인다`,
      )
    }
  }

  const out: ParsedMonsters = { defs: {}, placements: {}, drops: {} }

  for (const row of placementRows) {
    const instanceId = requireCell(row, 'instanceId', 'monster_placements.csv')
    const ctx = `monster_placements.csv[${instanceId}]`
    const sp = speciesOf(species, row, 'monster_placements.csv')
    const originX = toInt(requireCell(row, 'originX', ctx), ctx, 'originX', 0)
    const originY = toInt(requireCell(row, 'originY', ctx), ctx, 'originY', 0)

    // 배치마다 def 를 굽는다(위 문서) — 순찰·공격 전부 새 객체다. 배치들이 배열
    // 하나를 공유하면 한 배치를 고친 것이 다른 배치를 따라 움직인다.
    addUnique(
      out.defs,
      instanceId,
      {
        id: instanceId,
        name: sp.name,
        periodMs: sp.periodMs,
        patrol: sp.patrol.map(({ dx, dy }) => ({ x: originX + dx, y: originY + dy })),
        attacks: sp.attacks.map((a) => ({ ...a })),
      },
      'monster_placements.csv',
    )
    out.placements[instanceId] = {
      instanceId,
      // 종 id 가 아니라 instanceId 다 — def 가 배치별로 구워졌으므로 이 배치의
      // 패턴을 아는 def 는 자기 이름의 것뿐이다.
      monsterId: instanceId,
      mapId: requireCell(row, 'mapId', ctx),
      // 위상은 0 이 정상(첫 배치)이고 음수는 뜻이 없다 — t + 오프셋으로만 쓰인다.
      phaseOffsetMs: toInt(requireCell(row, 'phaseOffsetMs', ctx), ctx, 'phaseOffsetMs', 0),
      maxHp: toInt(requireCell(row, 'maxHp', ctx), ctx, 'maxHp'),
      sweepDamage: toInt(requireCell(row, 'sweepDamage', ctx), ctx, 'sweepDamage'),
    }
    out.drops[instanceId] = {
      monsterId: instanceId,
      drops: sp.drops.map((d) => ({ ...d })),
    }
  }

  return out
}
