import { DEV_ONLY_MAP_IDS } from '@nogada/data'
import type { GameData, PlayerState, TilePos } from '@nogada/shared'
import { guidingStep } from './questBand.js'

/**
 * 미니맵이 **무엇을 어디에 얹는가**(설계 ⑤·⑧-7) — Phaser 없는 순수 조립.
 *
 * questBand.ts 와 같은 자세다: 무엇을 얹을지는 여기서 정하고, 그것을 화면의
 * 네모와 삼각형으로 만드는 일은 HudScene 의 몫이다. 그래서 이 파일이 내리는
 * 판단은 브라우저 없이 잴 수 있다 — 그림이 실제로 나오는지는 못 재지만,
 * **개발용 시험장으로 가는 문을 안 찍는가**는 잴 수 있다.
 *
 * **여기에 없는 것 둘.** 흰 점(나)은 `mover.tile` 직독이라 씬이 직접 읽고(설계 ⑤ —
 * 실시간 자리는 스토어에 없다), 채집 노드와 결계 영역은 아예 안 얹는다: 노드를 다
 * 찍으면 채집장을 걸어 다니며 찾는 일이 사라지고(스토리가 가리키는 하나만 찍는다),
 * 결계는 서버 전용 산출물이라 클라가 좌표를 손에 쥔 적이 없다
 * (`hiddenThresholds.test.ts` 가 그 가드를 지킨다).
 */

/** 이정표 탭·띠와 같은 자리표 — 문에 적히는 「85,000」의 쉼표가 거기서 온다. */
const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 상자의 자리와 크기 — 설계 ⑤ 가 정한 값이다(`left:9 top:39`, 테두리 포함 116×116).
 *
 * **상자는 고정이고 그림이 그 안에 맞춰 들어간다**(minimapFit). 배율은 맵마다
 * 1.40(월드맵 80×80)~4.67(사냥터 24×18)px/타일로 흔들리지만 상자가 안 흔들리므로
 * 레이아웃은 고정이다 — 이 한 줄이 미니맵을 헤더 밑 한 줄에 띠와 나란히 세울 수
 * 있게 하는 전부다.
 *
 * 그리는 것은 HudScene 인데 값이 여기 있는 이유는 BAND 와 같다: **자리를 무는
 * 검사**가 이 수들을 봐야 하고(minimap.test.ts — 미니맵 오른끝과 띠 왼끝의 관계),
 * 그 검사가 Phaser 를 켤 수는 없다.
 */
export const MINIMAP = {
  x: 9,
  y: 39,
  /** 테두리를 포함한 바깥 한 변. */
  size: 116,
  /** 테두리 두께. 안쪽 그림판은 `size - border * 2` 다. */
  border: 2,
} as const

/** 그림이 들어가는 안쪽 한 변 — 112. */
export const MINIMAP_INNER = MINIMAP.size - MINIMAP.border * 2

/** 안쪽 그림판의 왼쪽 위 모서리(화면 좌표). */
export const MINIMAP_ORIGIN = { x: MINIMAP.x + MINIMAP.border, y: MINIMAP.y + MINIMAP.border } as const

/** 맵 하나가 상자 안에 놓이는 방식 — 배율과, 남는 곳을 나눈 여백. */
export interface MinimapFit {
  /** 타일 하나가 화면에서 몇 px 인가. */
  scale: number
  /** 안쪽 그림판 왼쪽 위에서 그림 왼쪽 위까지. */
  offsetX: number
  offsetY: number
  /** 그림 자체의 크기(px). */
  width: number
  height: number
}

/**
 * 맵 전체를 상자 안에 **contain-fit** 한다 — 잘리지 않게 넣고 남는 곳은 배경이다.
 *
 * 두 축 중 **작은 배율**을 쓰는 것이 곧 "안 잘린다"이다. 큰 쪽을 쓰면 긴 축이
 * 상자 밖으로 나가고, 하필 그 밖이 세계의 절반인 맵이 있다(월드맵 80×80 은
 * 정사각이라 티가 안 나지만 북동쪽마을은 75×20 이다 — 가로를 채우면 세로가
 * 남고, 세로를 채우면 가로의 4분의 3이 사라진다).
 */
export function minimapFit(mapWidth: number, mapHeight: number): MinimapFit {
  const scale = Math.min(MINIMAP_INNER / mapWidth, MINIMAP_INNER / mapHeight)
  const width = mapWidth * scale
  const height = mapHeight * scale
  return {
    scale,
    offsetX: (MINIMAP_INNER - width) / 2,
    offsetY: (MINIMAP_INNER - height) / 2,
    width,
    height,
  }
}

/**
 * 칸 하나의 **가운데**가 화면 어디인가.
 *
 * 가운데인 이유: 얹는 것들(흰 점·문 네모·깃발)이 전부 원점 0.5 의 작은 도형이라
 * 칸의 왼쪽 위에 놓으면 배율이 큰 맵(사냥터 4.67px/타일)에서 반 칸씩 왼쪽 위로
 * 쏠린다.
 */
export function tileToScreen(fit: MinimapFit, x: number, y: number): { x: number; y: number } {
  return {
    x: MINIMAP_ORIGIN.x + fit.offsetX + (x + 0.5) * fit.scale,
    y: MINIMAP_ORIGIN.y + fit.offsetY + (y + 0.5) * fit.scale,
  }
}

/**
 * 깃발 그림의 크기 — 깃대 높이와 깃폭·깃높이.
 *
 * 화면 쪽 값인데 여기 있는 이유는 MINIMAP 과 같다: **이것이 상자를 넘지 않는가**를
 * 재려면 자가 이 수들을 봐야 한다. 깃발은 칸 위로 서므로 맨 윗줄의 칸에서는
 * 상자 밖(헤더 자리)으로 삐져나갈 수 있고, 그것은 화면에서 "테두리가 깨진 것"으로
 * 보인다 — 실제로 눈의마을 북문(맨 윗줄)에서 그렇게 나왔다.
 */
export const FLAG = { poleHeight: 9, bannerWidth: 7, bannerHeight: 6 } as const

/** 깃발 하나를 어디에 어떻게 세우는가. */
export interface FlagGlyph {
  /** 깃대 밑동 — 가리키는 칸의 가운데다. */
  x: number
  y: number
  /**
   * 깃대가 **위로** 서는가.
   *
   * 맨 윗줄의 칸에는 위로 설 자리가 없다(눈의마을 북문이 그렇다). 그때는 아래로
   * 뒤집는다 — 밑동은 여전히 그 칸이고 깃발만 반대쪽에 달린다. 상자 안으로
   * 밀어 넣는(밑동을 옮기는) 쪽을 택하지 않은 이유는, 그러면 깃발이 가리키는
   * 칸이 실제 목적지와 한 칸 넘게 어긋나기 때문이다 — 가리키는 것이 일이다.
   *
   * 아래로 뒤집을 자리는 언제나 있다: 위로 설 자리가 없다는 것은 그 칸이 상자
   * 맨 위라는 뜻이고, 상자는 112px 이라 아래로는 100px 넘게 남는다.
   */
  up: boolean
}

export function flagGlyph(fit: MinimapFit, x: number, y: number): FlagGlyph {
  const at = tileToScreen(fit, x, y)
  return { x: at.x, y: at.y, up: at.y - MINIMAP_ORIGIN.y >= FLAG.poleHeight }
}

/** 지도 위의 문 하나. */
export interface MinimapDoor {
  /** 밟는 칸(`fromX`·`fromY`). 도착 칸이 아니다 — 플레이어가 걸어가야 하는 자리다. */
  x: number
  y: number
  /**
   * `gateSkill` 이 걸린 문이면 요구 숫자, 아니면 null.
   *
   * 적는 이유는 설계 ⑥ 의 「요구치를 숫자로 말하는 문」이 강화되는 자리라서다 —
   * 오늘 85,000 은 벽 앞에 서야만 보인다.
   */
  gate: string | null
}

export interface MinimapMarks {
  doors: MinimapDoor[]
  /** 지금 걸린 마디의 목적지. 유도등이 꺼졌거나 이 맵에서 가리킬 곳이 없으면 null. */
  flag: TilePos | null
}

/** 아무것도 안 얹는다. 캐릭터가 없는 화면과 사슬이 끝난 사람이 같은 답을 받는다. */
const NO_FLAG: TilePos | null = null

/**
 * 이 맵 위에 얹을 것들.
 *
 * `mapId` 를 스토어의 `player.location.mapId` 에서 읽지 않고 인자로 받는 이유는
 * WorldScene 이 자기 `mapId` 를 붙잡아 두는 이유와 같다: 전환 응답이 도착하면
 * 스토어의 맵 id 는 먼저 바뀌고 화면은 아직 이전 맵이다. 그 사이에 스토어를 읽으면
 * **이전 맵 그림 위에 새 맵의 문**을 찍는다.
 */
export function minimapMarks(
  data: GameData,
  player: PlayerState | null,
  mapId: string,
): MinimapMarks {
  return { doors: doorsOn(data, mapId), flag: flagOn(data, player, mapId) }
}

/**
 * 이 맵에서 나가는 문들 — **개발용 시험장으로 가는 것만 뺀다**(설계 ⑤).
 *
 * `눈의마을,0,15 → 개발맵` 은 spawn 에서 15칸으로 **목표인 북문(20칸)보다 가깝다.**
 * 표식을 따라간 신규가 노드 13개짜리 개발 샌드박스에 들어간다 — 그리고 거기에는
 * 네 계열의 노드가 다 섞여 있어 자기 마을이 무엇이었는지도 흐려진다.
 *
 * 결계 문(`fromMap === toMap`)은 뺄 이유가 없어 그대로 찍는다. 그 문이 어디 있고
 * 얼마를 요구하는지는 오늘 벽 앞에 서야만 보이는 정보다.
 */
function doorsOn(data: GameData, mapId: string): MinimapDoor[] {
  const out: MinimapDoor[] = []
  for (const t of data.transitions) {
    if (t.fromMap !== mapId || DEV_ONLY_MAP_IDS.includes(t.toMap)) continue
    out.push({ x: t.fromX, y: t.fromY, gate: t.gateValue === undefined ? null : fmt(t.gateValue) })
  }
  return out
}

/**
 * 지금 걸린 마디의 목적지가 이 맵 어디인가.
 *
 * **유도등의 스위치는 띠와 같은 하나다**(`guidingStep`) — 사슬이 끝났거나 그 마디가
 * `discoverable` 이 아니면 깃발도 없다. 두 곳에서 각자 정하면 설계 ⑥ 방어①이 남긴
 * 손잡이("칸 하나를 비우면 유도등이 꺼진다")를 내려도 지도에는 여전히 깃발이 선다.
 *
 * 목적지가 다른 맵이면 **그 맵으로 가는 문 위에** 찍는다(설계 ⑤). 그것이 첫 60초의
 * 화살표다 — 눈의마을 북문은 spawn 에서 20칸 위라 화면에 한 번도 안 보이는데,
 * 미니맵에는 처음부터 보인다.
 */
function flagOn(data: GameData, player: PlayerState | null, mapId: string): TilePos | null {
  if (!player) return NO_FLAG
  const step = guidingStep(data, player)
  if (!step) return NO_FLAG

  const goal = step.goal
  // 서 있는 자리가 아니라 **서버가 아는 자리**를 기준으로 고른다. 걸음은 서버로
  // 안 가므로 이 값은 맵 안에서 움직이지 않고(도착 칸 그대로다), 그래서 「가장
  // 가까운 광맥」이 걸을 때마다 다른 광맥으로 옮겨 다니지 않는다 — 따라가라고
  // 세운 표식이 따라가는 동안 도망가면 표식이 아니다.
  const anchor = player.location

  if (goal.kind === 'arrive') {
    return goal.arg === mapId ? NO_FLAG : doorTo(data, mapId, goal.arg, anchor)
  }
  if (goal.kind === 'gather') {
    const spots = gatherSpots(data, goal.arg)
    const here = spots.filter((spot) => spot.mapId === mapId)
    // 칸만 낸다 — 어느 맵인지는 이미 이 맵이고, 남겨 두면 깃발이 자기가 온 곳을
    // 들고 다니게 된다(문 쪽 답과 모양이 달라진다).
    if (here.length > 0) {
      const spot = nearest(here, anchor)
      return { x: spot.x, y: spot.y }
    }

    // 다른 맵에 있다 — 그 맵이 하나로 정해질 때만 문을 찍는다. 여럿이면 어느
    // 채집장을 가리키는지 세계가 말해 주지 않으므로, 지어내는 대신 안 찍는다.
    const maps = new Set(spots.map((spot) => spot.mapId))
    if (maps.size !== 1) return NO_FLAG
    return doorTo(data, mapId, [...maps][0]!, anchor)
  }
  // donate·craft·reach — 가방과 제작 패널에서 일어나는 일이라 지도 위에 자리가
  // 없다. 억지로 어딘가를 가리키면 깃발이 "여기로 가면 된다"는 거짓말을 한다.
  return NO_FLAG
}

/**
 * 그 계열을 **실제로 캘 수 있는 칸들** — 보통 노드만, 개발용 시험장은 빼고.
 *
 * 심층은 결계 뒤라 가리킬 수 없고(설계 ③ 이 사슬을 1,000 까지만 끌고 간다),
 * 특수는 조건이 붙어 늘 거기 있지 않다(붉은 얼음 광맥은 눈이 와야 깨어난다).
 * 개발맵을 빼는 이유는 문을 뺀 이유와 같고, 뺀 덕에 계열마다 남는 맵이 하나가
 * 된다 — 개발맵에는 네 계열의 보통 노드가 다 놓여 있다.
 */
function gatherSpots(data: GameData, skill: string): { mapId: string; x: number; y: number }[] {
  const out: { mapId: string; x: number; y: number }[] = []
  for (const p of Object.values(data.placements)) {
    if (DEV_ONLY_MAP_IDS.includes(p.mapId)) continue
    const node = data.nodes[p.nodeId]
    if (!node || node.skill !== skill || node.variant !== 'normal') continue
    out.push({ mapId: p.mapId, x: p.x, y: p.y })
  }
  return out
}

/** 이 맵에서 그 맵으로 가는 문 — 여럿이면 기준 칸에서 가장 가까운 것. 없으면 null. */
function doorTo(data: GameData, fromMap: string, toMap: string, anchor: TilePos): TilePos | null {
  const doors = data.transitions
    .filter((t) => t.fromMap === fromMap && t.toMap === toMap)
    .map((t) => ({ x: t.fromX, y: t.fromY }))
  return doors.length === 0 ? null : nearest(doors, anchor)
}

/**
 * 기준 칸에서 가장 가까운 것 — **직선 거리**로 재고, 동점이면 위·왼쪽이 이긴다.
 *
 * 맨해튼이 아니라 직선인 이유는 이것이 **지도 위의 거리**이기 때문이다. 얼음채집장
 * 도착 칸 (15,24) 에서 광맥 (9,21) 과 (6,24) 는 맨해튼으로 둘 다 9 라 동점인데,
 * 그림에서 (9,21) 이 눈에 띄게 가깝다(6.7 대 9.0). 깃발은 걸음 수를 말하는 것이
 * 아니라 화면의 어느 쪽을 보라고 말하는 것이다.
 *
 * 동점 규칙을 두는 이유: 없으면 배치 순서가 답을 정하고, 그 순서는 `.tmx` 안의
 * 오브젝트 차례라 맵을 손보는 날 소리 없이 바뀐다.
 */
function nearest<T extends TilePos>(items: readonly T[], anchor: TilePos): T {
  let best = items[0]!
  let bestDist = distSq(best, anchor)
  for (const item of items.slice(1)) {
    const d = distSq(item, anchor)
    if (d < bestDist || (d === bestDist && (item.y < best.y || (item.y === best.y && item.x < best.x)))) {
      best = item
      bestDist = d
    }
  }
  return best
}

function distSq(a: TilePos, b: TilePos): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2
}
