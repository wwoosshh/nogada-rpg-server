import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GameData } from '@nogada/shared'
import { parseCsv, parseItems, parseNodes, parseRecipes } from './parse.js'
import { parseCollection, validateCollection } from './collection.js'
import { parseEnhanceCosts, validateEnhanceCosts } from './enhanceCosts.js'
import { parseGatherTables, validateGatherTables } from './gatherTables.js'
import { parseInns } from './inns.js'
import { parseMaps, type ParsedMaps } from './maps.js'
import { parseMilestones } from './milestones.js'
import { parseStory, validateStory } from './story.js'
import { validateMonsterPatterns } from './monsterChecks.js'
import { parseMonsters } from './monsters.js'
import { parseMasters, parseShops } from './shops.js'
import { parseSpeakers } from './speakers.js'
import { bakeBarrierRegions, parseTransitions, validateTransitions } from './transitions.js'
import { parseDialogueFiles, type DialogueSource } from './dialogueParse.js'
import { validatePlaces } from './places.js'
import { bakeRoutes } from './routeBake.js'
import {
  SCHEDULE_EXT,
  collectScheduleNotices,
  parseScheduleFiles,
  validateSchedules,
  type ScheduleSource,
} from './schedule.js'
import {
  collectDialogueNotices,
  validateGameData,
  validateMapSpawns,
  validateShopTalk,
  validateSpeakerPlacements,
  validateVillageFields,
} from './validate.js'

const here = dirname(fileURLToPath(import.meta.url))
const csvDir = join(here, '..', 'csv')
const mapsDir = join(here, '..', 'maps')
const dialogueDir = join(here, '..', 'dialogue')
const schedulesDir = join(here, '..', 'schedules')
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
 * schedules/ 아래 모든 `.sched` 파일을 읽는다. 파일 하나 = 화자 하나다.
 *
 * 폴더가 없어도 빈 목록으로 넘어간다 — 일과를 사는 NPC 가 하나도 없는 것은
 * 정상이고(오늘이 그렇다), 그 상태에서 빌드가 멈추면 안 된다.
 */
function readScheduleSources(): ScheduleSource[] {
  if (!existsSync(schedulesDir)) return []
  const files = readdirSync(schedulesDir).filter((f) => f.endsWith(SCHEDULE_EXT))
  return files.map((file) => ({ file, text: readFileSync(join(schedulesDir, file), 'utf8') }))
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
const { schedules, errors: scheduleErrors } = parseScheduleFiles(readScheduleSources())
if (dialogueErrors.length > 0 || scheduleErrors.length > 0) fail([...dialogueErrors, ...scheduleErrors])

const nodes = parseNodes(readCsv('nodes.csv'))
const recipes = parseRecipes(readCsv('recipes.csv'))

// 채집 확률표 — 세 CSV(메타·사다리·브라켓)를 조립한다. GameData 에 싣지 않는
// 이유는 §7-앞 9: 브라켓 경계·잭팟 확률이 곧 숨은 문턱이라, 클라이언트 번들에
// 실으면 F12 로 스포일된다. 아래에서 서버 전용 산출물로 따로 굽는다.
const gatherTables = parseGatherTables(
  readCsv('gather_tables.csv'),
  readCsv('gather_tiers.csv'),
  readCsv('gather_brackets.csv'),
)

// 몬스터 다섯 CSV — 종의 상대 패턴과 배치 원점에서 **배치마다 def 를 굽는다**
// (monsters.ts 의 이유: patrol 이 절대 좌표라서다). defs·placements 는 GameData 에
// 실리고(화면이 그린다), drops 만 서버 전용 산출물로 아래에서 따로 굽는다.
const monsterWorld = parseMonsters(
  readCsv('monster_species.csv'),
  readCsv('monster_patrol.csv'),
  readCsv('monster_attacks.csv'),
  readCsv('monster_placements.csv'),
  readCsv('monster_drops.csv'),
)

/**
 * 맵 파일을 읽는다. **없는 파일에 던지지 않고 빈 문자열을 돌려준다.**
 *
 * 예전에는 readFileSync 를 그대로 넘겨서, maps.csv 가 없는 `.tmx` 를 가리키면
 * 빌드가 raw `ENOENT: ... open 'C:\…\ghost.tmx'` 스택 트레이스로 죽었다 —
 * parseMaps 안에 준비돼 있던 안내는 테스트의 가짜 리더에서만 닿았고, 정작
 * 설계 문서가 4절 첫 줄에 적어 둔 검증이 실제로는 없는 셈이었다.
 */
function readMapFile(file: string): string {
  const path = join(mapsDir, file)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

/**
 * 맵 파일에 관한 실패를 검증 위반과 **같은 꼴로** 보고한다.
 *
 * 맵 파일이 없다, 타일셋이 안 박혀 있다, walls 레이어를 안 그렸다, 시작 칸이
 * 없다 — 전부 맵을 그리는 사람의 실수인데, 파싱 단계라는 이유만으로 스택
 * 트레이스가 나오면 그 사람은 "이건 다른 종류의 문제인가"부터 고민하게 된다.
 * 대사 문법 오류를 검증보다 먼저·단독으로 보고하는 것과 같은 자세다: 파싱이
 * 깨진 맵은 규칙을 하나도 내놓지 못하므로 그 한 건만 말하고 멈춘다.
 *
 * 프로그래밍 오류(TypeError 등)는 그대로 다시 던진다 — 그건 작가가 고칠 수
 * 있는 것이 아니라 우리가 고칠 것이고, 스택이 지워지면 찾을 수 없다.
 */
function parseMapsOrFail(): ParsedMaps {
  try {
    return parseMaps(readCsv('maps.csv'), readMapFile, nodes)
  } catch (err) {
    if (!(err instanceof Error) || err instanceof TypeError || err instanceof RangeError) throw err
    fail([err.message])
  }
}

const { maps, terrains, mapJson, placements, places } = parseMapsOrFail()

// 화자 등록부를 먼저 세운다 — 여관 파서가 화자 실재 검사를 그 자리에서 지므로
// (parseInns 문서) 데이터 조립보다 앞서 손에 있어야 한다.
const speakers = parseSpeakers(readCsv('speakers.csv'))

const data: GameData = {
  items: parseItems(readCsv('items.csv')),
  nodes,
  recipes,
  maps,
  transitions: parseTransitions(readCsv('transitions.csv')),
  placements,
  milestones: parseMilestones(readCsv('milestones.csv'), recipes),
  // 스토리 사슬도 GameData 에 싣는다 — 띠에 뜨는 글은 애초에 화면이 읽어 주기로
  // 한 것이라 숨은 문턱이 아니다(이정표를 싣는 그 저울). 슬롯은 여기서 펴지 않는다:
  // 어느 마을의 사슬인지는 세이브가 정하므로 굽는 시점에는 답이 넷이다.
  story: parseStory(readCsv('story.csv')),
  speakers,
  // 상점·달인은 확률표와 달리 GameData 에 싣는다 — 클라이언트가 매도 목록과
  // 진열(잠긴 칸의 요구치까지)을 그려야 한다. 진열을 상점에 붙이는 일까지
  // parseShops 하나가 한다: 어느 상점에도 안 붙은 진열이라는 중간 상태를
  // 만들지 않기 위해서다.
  shops: parseShops(readCsv('shops.csv'), readCsv('shop_stock.csv')),
  masters: parseMasters(readCsv('masters.csv')),
  // 여관도 상점·달인과 같은 자리다(아크 D §2) — 값(여관비)은 화면이 버튼에
  // 숫자로 적어야 하므로 숨은 문턱이 아니고, GameData 에 실린다. 화자 실재
  // 검사는 파서가 그 자리에서 진다(parseInns 문서).
  inns: parseInns(readCsv('inns.csv'), speakers),
  // 강화 비용표도 GameData 에 싣는다(§6-앞 13) — 채집 확률표와 정확히 반대편
  // 결정이다. 저쪽은 브라켓 경계가 곧 숨은 문턱이라 감췄지만, 강화는 **가방이
  // 요구량을 숫자로 적어 주지 못하면** 플레이어가 무엇을 얼마나 모아야 하는지
  // 모른 채 버튼만 눌러 보게 된다.
  enhanceCosts: parseEnhanceCosts(readCsv('enhance_costs.csv')),
  // 문턱표도 GameData 에 싣는다(§6-앞 5) — 강화 비용표와 같은 이유이고 채집
  // 확률표와 반대편이다: 방은 **잠긴 칸에도** 요구치를 숫자로 적어야 한다.
  collection: parseCollection(readCsv('collection.csv')),
  places,
  schedules,
  // 길은 아래에서 굽는다 — 참조가 성립하는지부터 보고 나서다.
  routes: [],
  dialogue,
  // 종·배치는 클라이언트가 그려야 해서 GameData 에 싣는다(전투 §2-1) — 패턴은
  // 화면에 보이는 정보라 숨은 문턱이 아니다. 드랍표만 서버 전용이다(전투 §4).
  monsters: monsterWorld.defs,
  monsterPlacements: monsterWorld.placements,
}

// 화자 배치·시작 칸·전환·지점 검사는 맵을 봐야 해서 GameData 만으로는 할 수
// 없다 — 그래서 validateGameData 와 나뉘어 있고, 여기서 합쳐 한 번에 보고한다.
// 확률표 검사는 표와 GameData 양쪽을 봐야 해서(아이템·노드 참조) 또 나뉘어 있다.
const gatherCheck = validateGatherTables(gatherTables, data)
const violations = [
  // 드랍표가 실린다 — 획득 그물이 "전투 드랍" 출처를 먼저 알아 둔 그 자리다
  // (전투 §12-앞 2). 송곳니는 캐지지도 만들어지지도 않으므로 이 인자가 빠지면
  // 출하 items.csv 가 그대로 빌드를 세운다.
  ...validateGameData(data, gatherTables, monsterWorld.drops),
  ...gatherCheck.violations,
  ...validateEnhanceCosts(data),
  // 형평 검증은 표와 GameData 양쪽을 본다 — 문턱이 몇 분인지는 확률표만이 안다.
  ...validateCollection(data, gatherTables),
  ...validateSpeakerPlacements(data, terrains),
  // 몬스터 패턴 검사(설계 §8 검사 1~4)가 실데이터를 문다 — 구운 def 그대로를
  // 넘기므로, 시뮬이 검사하는 늑대와 화면·판정이 보는 늑대가 같은 늑대다.
  ...validateMonsterPatterns(
    Object.values(monsterWorld.placements).map((p) => ({
      instanceId: p.instanceId,
      mapId: p.mapId,
      def: monsterWorld.defs[p.monsterId]!,
    })),
    terrains,
  ),
  ...validateMapSpawns(data, terrains),
  ...validateTransitions(data, terrains),
  ...validatePlaces(data, terrains),
  ...validateSchedules(data),
  // 마을 → 대표 숙련도는 화면이 아니라 여기서 정해진다(설계 규범 14).
  ...validateVillageFields(data),
  // 사슬은 한 벌인데 마을은 넷이다 — 슬롯이 넷 전부에서 펴지는지를 여기서 본다
  // (퀘스트 설계 ⑧-2: 이 검사가 이 아크에서 가장 값이 크다).
  ...validateStory(data),
  // 문이 이미 열린 사람에게 문이 멀었다고 말하지 않는가(설계 ⑥ 강화 ②) —
  // 상점을 여는 것은 등록부이고 대사는 그것을 설명할 뿐이라, 둘이 어긋나도
  // 어느 화면 하나 이상해지지 않는다. 네 계열 전부가 실제로 어긋나 있었다.
  ...validateShopTalk(data),
]
if (violations.length > 0) fail(violations)

// 길 굽기는 **검증이 끝난 뒤**다. 없는 지점을 가리키는 일과에 길찾기를 돌리면
// "길이 없다" 는 그림자 위반만 잔뜩 나와, 진짜 원인 한 줄이 자기 결과들에
// 파묻힌다 — validate.ts 가 참조 위반이 있으면 도달 가능성 계산을 미루는 것과
// 같은 저울이다.
const { routes, violations: routeViolations } = bakeRoutes(data, terrains)
if (routeViolations.length > 0) fail(routeViolations)
data.routes = routes

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'gamedata.json'), JSON.stringify(data, null, 2), 'utf8')

// 확률표는 **서버 전용 산출물**이다(§7-앞 9) — gamedata.json(클라이언트가 통째로
// 받아 가는 파일)에 넣지 않고 따로 굽는다. 읽는 문은 loadGatherTables() 하나이고
// apps/server 만 import 한다. 클라이언트 번들에 브라켓 경계가 실리는 순간 숨은
// 문턱 전부가 F12 로 스포일된다.
writeFileSync(join(outDir, 'gather-tables.json'), JSON.stringify(gatherTables, null, 2), 'utf8')

// 몬스터 드랍표도 **서버 전용 산출물**이다(전투 §4) — 확률표와 같은 한 줄이
// 근거다: 드랍 확률이 곧 숨은 문턱이라 gamedata.json 에 실리는 순간 F12 로
// 스포일된다. 읽는 문은 loadMonsterDrops() 하나이고 apps/server 만 import 한다.
writeFileSync(join(outDir, 'monster-drops.json'), JSON.stringify(monsterWorld.drops, null, 2), 'utf8')

// 결계 뒤 칸들도 **서버 전용 산출물**이다 — 확률표와 같은 취급이고 근거도 같은
// 한 줄이다(채집 티어 스펙 §7-앞 9, 바로 위와 같은 출처). 결계 스펙 §9-앞 에는
// 이 규범이 없다 — 오래 §9-앞 18 로 적혀 있었는데 그 번호는 "계기 절의 숫자 셋을
// 고친다"다.
// 읽는 문은 loadBarrierRegions() 하나이고 apps/server 만 import 한다.
//
// 확률표를 감추는 이유(브라켓 경계가 곧 숨은 문턱이라 F12 로 스포일된다)와는
// 다르다: 벽은 클라이언트가 맵 JSON 으로 이미 보고 있으므로 여기 감출 비밀은
// 없다. 그런데도 gamedata.json 에 싣지 않는 것은 **판정의 재료를 판정받는 쪽에
// 쥐여 줄 이유가 없기** 때문이다 — 이 표를 클라이언트가 갖는다고 할 수 있는 일이
// 하나도 늘지 않는데(화면은 벽으로 이미 밀린다), 서버가 위조 요청을 거르는
// 근거만 번들에 복사된다.
const barrierRegions = bakeBarrierRegions(data, terrains)
writeFileSync(join(outDir, 'barrier-regions.json'), JSON.stringify(barrierRegions, null, 2), 'utf8')

// 클라이언트가 이 파일을 실행 중에 받아 간다. gamedata.json 과 같은 생성 폴더에 둔다 —
// 저장소에 커밋된 .json 을 두면 .tmx 와 어긋날 수 있고, 그것을 없애려고 이 단계를 만들었다.
//
// parseMaps 가 이미 파싱해 둔 것을 그대로 쓴다. 예전엔 여기서 같은 .tmx 를
// 두 번째로 읽어 두 번째로 파싱했다 — 맵이 수십 장이 되면 그 낭비가 맵 수만큼이고,
// 두 번 읽는 사이에 파일이 바뀌면 검증한 맵과 내보낸 맵이 달라질 수도 있다.
//
// **먼저 비운다.** 여기 쓰기만 하고 지우지 않던 동안, 이름을 바꾸거나 없앤 맵의
// .json 이 계속 남았다 — 실제로 `world.json` 과 `시험숲.json` 이 그렇게 살아
// 있었고, 프로덕션 빌드는 이 폴더를 통째로 dist/maps 로 복사하므로 없는 맵이
// 배포물에까지 따라갔다. 생성 폴더의 내용은 언제나 지금의 maps.csv 와 .tmx 가
// 정한 것이어야 한다.
//
// gamedata.json 은 이 폴더 밖(생성 폴더 바로 아래)이라 함께 지워지지 않는다 —
// 그쪽은 매번 통째로 덮어써지므로 남을 것이 없다.
rmSync(join(outDir, 'maps'), { recursive: true, force: true })
mkdirSync(join(outDir, 'maps'), { recursive: true })
for (const [id, json] of Object.entries(mapJson)) {
  writeFileSync(join(outDir, 'maps', `${id}.json`), JSON.stringify(json), 'utf8')
}

console.log(
  `데이터 빌드 완료 — 아이템 ${Object.keys(data.items).length}, ` +
    `노드 ${Object.keys(data.nodes).length}, 레시피 ${Object.keys(data.recipes).length}, ` +
    `채집표 ${Object.keys(gatherTables).length}, ` +
    `맵 ${Object.keys(data.maps).length}, ` +
    `스토리 마디 ${data.story.length}, ` +
    `배치 ${Object.keys(data.placements).length}, 이정표 ${data.milestones.length}, ` +
    `화자 ${Object.keys(data.speakers).length}, 대사 ${data.dialogue.length}, ` +
    `상점 ${Object.keys(data.shops).length}, ` +
    `진열 ${Object.values(data.shops).reduce((sum, shop) => sum + shop.stock.length, 0)}, ` +
    `달인 ${data.masters.length}, ` +
    `여관 ${Object.keys(data.inns).length}, ` +
    `강화비용 ${data.enhanceCosts.length}, ` +
    `수집칸 ${Object.keys(data.collection).length}, ` +
    `전환 ${data.transitions.length}, ` +
    `결계구역 ${barrierRegions.length}(칸 ${barrierRegions.reduce((n, r) => n + r.cells.length, 0)}), ` +
    `지점 ${Object.keys(data.places).length}, 일과 ${Object.keys(data.schedules).length}, ` +
    `몬스터 배치 ${Object.keys(data.monsterPlacements).length}`,
)

// 표의 경고는 빌드를 막지 않는다 — 최종 브라켓에 실패가 남거나 첫 브라켓의
// 잭팟이 사라진 것은 오타가 아니라 설계 의도에서 벗어난 "모양"이라, 작가가
// 보고 판단할 일이다(§7-앞 5 의 경고 승격).
if (gatherCheck.warnings.length > 0) {
  console.log(`채집표 경고 — ${gatherCheck.warnings.length}건`)
  for (const w of gatherCheck.warnings) console.log(`  - ${w}`)
}

// 공급자가 없는 사실(weather 등)을 쓴 대사는 빌드를 막지 않는다 — 작가가
// 미리 써 둔 것이지 오타가 아니기 때문이다(설계 문서 6.3). 대신 여기서
// 안내로 알린다: 위반과 달리 이건 실패가 아니라 "아직은 안 나온다"는 정보다.
//
// 두 NPC 가 같은 시각 같은 지점에 서는 것도 같은 자리에서 알린다 — 겹쳐 서기는
// 의도일 수 있어서 막지 않는다(설계 §3).
const notices = [...collectDialogueNotices(data), ...collectScheduleNotices(data)]
if (notices.length > 0) {
  console.log(`안내 — ${notices.length}건`)
  for (const n of notices) console.log(`  - ${n}`)
}
