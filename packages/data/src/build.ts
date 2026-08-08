import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DialogueRule, GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMilestones } from './milestones.js'
import { parsePlacements } from './placements.js'
import { parseSpeakers } from './speakers.js'
import { parseDialogue } from './dialogueParse.js'
import { collectDialogueNotices, validateGameData } from './validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const csvDir = join(here, '..', 'csv')
const mapsDir = join(here, '..', 'maps')
const dialogueDir = join(here, '..', 'dialogue')
const outDir = join(here, 'generated')

function readCsv(name: string) {
  return parseCsv(readFileSync(join(csvDir, name), 'utf8'))
}

/** dialogue/ 아래 모든 .dlg 파일을 읽어 하나의 배열로 합친다. 파일 하나 = 화자 하나다. */
function readAllDialogue(): DialogueRule[] {
  const files = readdirSync(dialogueDir).filter((f) => f.endsWith('.dlg'))
  return files.flatMap((f) => parseDialogue(readFileSync(join(dialogueDir, f), 'utf8'), f))
}

const nodes = parseNodes(readCsv('nodes.csv'))
const recipes = parseRecipes(readCsv('recipes.csv'))
const mapJson: unknown = JSON.parse(readFileSync(join(mapsDir, 'world.json'), 'utf8'))

const data: GameData = {
  items: parseItems(readCsv('items.csv')),
  nodes,
  recipes,
  placements: parsePlacements(mapJson, nodes),
  milestones: parseMilestones(readCsv('milestones.csv'), nodes, recipes),
  speakers: parseSpeakers(readCsv('speakers.csv')),
  dialogue: readAllDialogue(),
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
    `배치 ${Object.keys(data.placements).length}, 이정표 ${data.milestones.length}, ` +
    `화자 ${Object.keys(data.speakers).length}, 대사 ${data.dialogue.length}`,
)

// 공급자가 없는 사실(weather 등)을 쓴 대사는 빌드를 막지 않는다 — 작가가
// 미리 써 둔 것이지 오타가 아니기 때문이다(설계 문서 6.3). 대신 여기서
// 안내로 알린다: 위반과 달리 이건 실패가 아니라 "아직은 안 나온다"는 정보다.
const notices = collectDialogueNotices(data)
if (notices.length > 0) {
  console.log(`안내 — ${notices.length}건`)
  for (const n of notices) console.log(`  - ${n}`)
}
