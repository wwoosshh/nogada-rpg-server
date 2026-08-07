import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parsePlacements } from './placements.js'
import { validateGameData } from './validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const csvDir = join(here, '..', 'csv')
const mapsDir = join(here, '..', 'maps')
const outDir = join(here, 'generated')

function readCsv(name: string) {
  return parseCsv(readFileSync(join(csvDir, name), 'utf8'))
}

const nodes = parseNodes(readCsv('nodes.csv'))
const mapJson: unknown = JSON.parse(readFileSync(join(mapsDir, 'world.json'), 'utf8'))

const data: GameData = {
  items: parseItems(readCsv('items.csv')),
  nodes,
  recipes: parseRecipes(readCsv('recipes.csv')),
  placements: parsePlacements(mapJson, nodes),
}

const violations = validateGameData(data)
if (violations.length > 0) {
  console.error(`데이터 검증 실패 — ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'gamedata.json'), JSON.stringify(data, null, 2), 'utf8')

console.log(
  `데이터 빌드 완료 — 아이템 ${Object.keys(data.items).length}, ` +
    `노드 ${Object.keys(data.nodes).length}, 레시피 ${Object.keys(data.recipes).length}, ` +
    `배치 ${Object.keys(data.placements).length}`,
)
