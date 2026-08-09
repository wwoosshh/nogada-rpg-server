import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseMaps } from './maps.js'
import { parseMilestones } from './milestones.js'
import { parseSpeakers } from './speakers.js'
import { parseTmx } from './tmx.js'
import { parseDialogueFiles, type DialogueSource } from './dialogueParse.js'
import { collectDialogueNotices, validateGameData, validateSpeakerPlacements } from './validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const csvDir = join(here, '..', 'csv')
const mapsDir = join(here, '..', 'maps')
const dialogueDir = join(here, '..', 'dialogue')
const outDir = join(here, 'generated')

function readCsv(name: string) {
  return parseCsv(readFileSync(join(csvDir, name), 'utf8'))
}

/** dialogue/ 아래 모든 .dlg 파일을 읽는다. 파일 하나 = 화자 하나다. */
function readDialogueSources(): DialogueSource[] {
  const files = readdirSync(dialogueDir).filter((f) => f.endsWith('.dlg'))
  return files.map((file) => ({ file, text: readFileSync(join(dialogueDir, file), 'utf8') }))
}

/**
 * 잘못된 것들을 한 목록으로 보여주고 빌드를 세운다.
 *
 * 이 파일 안에서 실패를 보고하는 곳이 두 군데(문법 오류·검증 위반)라 함수로
 * 묶는다. 두 곳이 각자 출력을 지으면 언젠가 꼴이 갈라지고, 그러면 작가는
 * "이건 다른 종류의 문제인가"부터 고민하게 된다 — dialogueLocation 이 위치
 * 표기를 한 꼴로 묶어 두는 것과 같은 이유다.
 */
function fail(violations: readonly string[]): never {
  console.error(`데이터 검증 실패 — ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

// 문법 오류는 검증보다 **먼저**, 그리고 단독으로 보고한다.
//
// 파싱이 깨진 파일은 규칙을 하나도 내놓지 않는다. 그대로 검증까지 밀고 가면
// "speakers[X]: 대사 파일이 없다" 같은 위반이 줄줄이 따라붙는데, 그건 전부
// 문법 오류 한 줄의 그림자일 뿐이라 정작 고쳐야 할 곳이 자기 결과들에 파묻힌다
// — validate.ts 가 참조 위반이 있으면 도달 가능성 검사를 미루는 것과 같은
// 저울이다.
const { rules: dialogue, errors: dialogueErrors } = parseDialogueFiles(readDialogueSources())
if (dialogueErrors.length > 0) fail(dialogueErrors)

const nodes = parseNodes(readCsv('nodes.csv'))
const recipes = parseRecipes(readCsv('recipes.csv'))

const { maps, terrains, placements } = parseMaps(
  readCsv('maps.csv'),
  (file) => readFileSync(join(mapsDir, file), 'utf8'),
  nodes,
)

const data: GameData = {
  items: parseItems(readCsv('items.csv')),
  nodes,
  recipes,
  maps,
  placements,
  milestones: parseMilestones(readCsv('milestones.csv'), nodes, recipes),
  speakers: parseSpeakers(readCsv('speakers.csv')),
  dialogue,
}

// 화자 배치 검사는 맵을 봐야 해서 GameData 만으로는 할 수 없다 — 그래서
// validateGameData 와 나뉘어 있고, 여기서 둘을 합쳐 한 번에 보고한다.
const violations = [...validateGameData(data), ...validateSpeakerPlacements(data, terrains)]
if (violations.length > 0) fail(violations)

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'gamedata.json'), JSON.stringify(data, null, 2), 'utf8')

// 클라이언트가 이 파일을 import 한다. gamedata.json 과 같은 생성 폴더에 둔다 —
// 저장소에 커밋된 .json 을 두면 .tmx 와 어긋날 수 있고, 그것을 없애려고 이 단계를 만들었다.
mkdirSync(join(outDir, 'maps'), { recursive: true })
for (const map of Object.values(maps)) {
  const json = parseTmx(readFileSync(join(mapsDir, map.file), 'utf8'))
  writeFileSync(join(outDir, 'maps', `${map.id}.json`), JSON.stringify(json), 'utf8')
}

console.log(
  `데이터 빌드 완료 — 아이템 ${Object.keys(data.items).length}, ` +
    `노드 ${Object.keys(data.nodes).length}, 레시피 ${Object.keys(data.recipes).length}, ` +
    `맵 ${Object.keys(data.maps).length}, ` +
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
