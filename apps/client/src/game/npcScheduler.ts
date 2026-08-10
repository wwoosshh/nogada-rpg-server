import {
  npcStateAt,
  type BakedLeg,
  type Direction,
  type GameData,
  type NpcState,
  type PlaceDef,
  type ScheduleDef,
  type SpeakerDef,
  type TilePos,
} from '@nogada/shared'

/**
 * 일과가 있는 NPC 를 화면 쪽 언어로 옮기는 곳. **Phaser 를 모른다.**
 *
 * 서버와 클라이언트는 같은 순수 함수(`npcStateAt`)를 부른다 — 여기서 다시
 * 판정하지 않는다. 이 파일이 하는 일은 그 함수가 내는 "지금 상태"를 씬이 실제로
 * 해야 할 일(스프라이트를 보이고, 자리를 옮기고, 칸을 막고 푸는 것)의 목록으로
 * 바꾸는 것 하나뿐이다.
 *
 * 씬 안에 두지 않은 이유는 dialogueFlow.ts 와 같다: 이 저장소에 Phaser 테스트
 * 하네스가 없으므로 씬에 적힌 규칙은 검증 없는 코드가 된다. 그리고 여기 담긴
 * 규칙(설계 §1·§6)은 전부 화면과 무관한 판단이다 — 걷는 사람은 몸이 없고, 서
 * 있는 사람만 칸을 막고, 서 있는 동안의 방향은 스케줄러의 것이 아니다.
 */

/**
 * 이 맵의 눈으로 본 NPC 의 처지.
 *
 * `NpcActivity`(standing·walking·indoor)에 `away` 하나를 더한 것이다 — 다른
 * 맵에 있는 NPC 는 활동이 무엇이든 이 맵에서는 없는 것과 같고, 그 구분을
 * 여기서 한 번에 하지 않으면 아래 규칙 셋(보이는가·막는가·말이 걸리는가)이
 * 저마다 맵 id 를 다시 비교하게 된다.
 */
export type NpcStance = 'standing' | 'walking' | 'indoor' | 'away'

export interface NpcPresence {
  stance: NpcStance
  tile: TilePos
  /**
   * 걷는 동안의 방향. 서 있을 때는 지점이 적어 둔 방향이고, 없으면 null 이다.
   *
   * null 이 "아래를 본다"가 아닌 것이 중요하다(설계 §6) — 서 있는 동안의 방향은
   * 기존 미세 동작(무작위 전환, 말 걸면 돌아보기)이 소유한다. 여기서 매 틱 값을
   * 내면 그것들이 한 프레임 만에 지워진다.
   */
  facing: Direction | null
}

/** 이 맵 밖 — 다른 맵이거나 아직 한 번도 본 적 없는 상태. 칸은 뜻이 없다. */
function away(): NpcPresence {
  return { stance: 'away', tile: { x: -1, y: -1 }, facing: null }
}

/** 그려지는가. 실내면 맵에 없다(설계 §1). */
function isVisible(stance: NpcStance): boolean {
  return stance === 'standing' || stance === 'walking'
}

/**
 * 그 칸을 차지하는가 — **걸어 들어갈 수 없고, 앞칸에서 말을 걸면 반응한다.**
 *
 * 막는 것과 말이 걸리는 것을 하나로 묶은 이유가 이 파일에서 가장 중요하다:
 * 이 게임에서 **앞칸을 바라볼 수 있는 칸은 걸어 들어갈 수 없는 칸뿐이다.**
 * 방향키는 방향을 바꾸면서 갈 수 있으면 곧바로 한 걸음을 시작하므로(TileMover),
 * 비어 있는 칸은 "그쪽을 보고 선다"가 아예 불가능하다. 그래서 막지 않으면서
 * 말만 걸리는 칸은 게임 안에서 도달할 수 없는 칸이다.
 *
 * - `standing`: 서 있는 사람이다. 지금까지의 정적 화자와 같다.
 * - `walking`: **아니다.** 길 위의 사람은 통과 장식이라 막지도 않고 말도 걸리지
 *   않는다 — 대화 도중에 걸어가 버리는 문제가 원천적으로 없다(설계 §1).
 * - `indoor`: 그림은 없지만 **문은 있다.** 그 칸은 그 사람이 들어간 문이고,
 *   거기서 말을 걸면 서버가 `not_here` 로 답해 "지금 여기 없는 것 같다"가
 *   뜬다(설계 §9.3). 빌드의 경로 굽기도 실내 지점을 지나갈 수 없는 칸으로
 *   세므로(routeBake 의 occupied), 여기서 통과시키면 그 둘이 갈라진다.
 */
function holdsTile(stance: NpcStance): boolean {
  return stance === 'standing' || stance === 'indoor'
}

/**
 * 씬이 이번 틱에 해야 할 일 하나.
 *
 * 명령으로 내는 이유는 "무엇이 달라졌는가"가 곧 씬이 만질 것의 전부이기
 * 때문이다. 매 틱 지금 상태를 통째로 밀어 넣으면 서 있는 NPC 의 방향을 60번씩
 * 덮어쓰게 되고(그러면 미세 동작이 죽는다), 막힌 칸 집합도 매 틱 다시 짓게 된다.
 */
export type NpcCommand =
  /**
   * 이 맵에 나타났다. 스프라이트를 보이고 그 자리로 **끌지 말고 놓는다**.
   * `walking` 이면 지금 길 위이므로 심심풀이 방향 전환이 붙지 않는다.
   */
  | { kind: 'spawn'; speakerId: string; tile: TilePos; facing: Direction | null; walking: boolean }
  /** 이 맵에서 사라졌다(실내로 들어갔거나 다른 맵으로 넘어갔다). */
  | { kind: 'despawn'; speakerId: string }
  /** 자리나 방향이 달라졌다. `facing` 이 null 이면 지금 보고 있는 쪽을 그대로 둔다. */
  | { kind: 'move'; speakerId: string; tile: TilePos; facing: Direction | null; walking: boolean }
  /** 그 칸을 차지했다 — 걸어 들어갈 수 없고, 앞칸에서 말을 걸면 반응한다. */
  | { kind: 'claim'; speakerId: string; tile: TilePos }
  /** 그 칸을 놓았다. */
  | { kind: 'release'; speakerId: string; tile: TilePos }

function sameTile(a: TilePos, b: TilePos): boolean {
  return a.x === b.x && a.y === b.y
}

/**
 * 이전 처지에서 지금 처지로 가려면 씬이 무엇을 해야 하는가.
 *
 * 순서가 규칙의 일부다: **놓기 → 그리기 → 잡기.** 옛 칸을 먼저 놓지 않으면
 * 한 칸 옆으로 옮겨 선 NPC 가 옛 칸을 영영 막은 채로 남는다.
 */
export function diffPresence(
  speakerId: string,
  prev: NpcPresence,
  next: NpcPresence,
): NpcCommand[] {
  const out: NpcCommand[] = []

  const heldBefore = holdsTile(prev.stance)
  const heldNow = holdsTile(next.stance)
  // 같은 칸을 계속 잡고 있으면 아무것도 하지 않는다 — 서 있는 NPC 는 하루의
  // 대부분을 이 가지에서 보낸다.
  const holdsSame = heldBefore && heldNow && sameTile(prev.tile, next.tile)

  if (heldBefore && !holdsSame) {
    out.push({ kind: 'release', speakerId, tile: prev.tile })
  }

  const shownBefore = isVisible(prev.stance)
  const shownNow = isVisible(next.stance)
  const walking = next.stance === 'walking'
  if (!shownBefore && shownNow) {
    out.push({ kind: 'spawn', speakerId, tile: next.tile, facing: next.facing, walking })
  } else if (shownBefore && !shownNow) {
    out.push({ kind: 'despawn', speakerId })
  } else if (shownBefore && shownNow) {
    // 걷는 동안에는 방향도 스케줄러의 것이라 방향만 바뀌어도 알린다. 서 있는
    // 동안에는 처지가 바뀐 그 순간에만 알린다 — 그 뒤의 방향은 미세 동작의
    // 것이다(설계 §6).
    const turned = prev.facing !== next.facing
    const shifted = !sameTile(prev.tile, next.tile) || prev.stance !== next.stance
    if (shifted || (walking && turned)) {
      out.push({ kind: 'move', speakerId, tile: next.tile, facing: next.facing, walking })
    }
  }

  if (heldNow && !holdsSame) {
    out.push({ kind: 'claim', speakerId, tile: next.tile })
  }

  return out
}

/** 그 시각의 상태를 이 맵의 처지로 옮긴다. 다른 맵이면 없는 것과 같다. */
export function presenceOnMap(state: NpcState, mapId: string): NpcPresence {
  if (state.mapId !== mapId) return away()
  return { stance: state.activity, tile: state.tile, facing: state.facing }
}

/**
 * 이 맵에 하루 중 한 번이라도 발을 들일 수 있는 일과들.
 *
 * 지금 여기 있는가가 아니라 **올 수 있는가**를 묻는다 — 프리로드가 이것을 쓰기
 * 때문이다(설계 §6). 지금 여기 있는 사람만 시트를 실으면, 광장에서 걸어 들어오는
 * 사람이 문턱을 넘는 순간 그림이 없다.
 *
 * 화자 id 순으로 정렬한다. 순회 순서가 Object.keys 에 매달리면 같은 데이터에서도
 * 명령 순서가 달라져, 어긋났을 때 무엇이 원인인지 좁히기 어렵다.
 */
export function schedulesForMap(data: GameData, mapId: string): ScheduleDef[] {
  return Object.keys(data.schedules)
    .sort()
    .map((id) => data.schedules[id]!)
    .filter((schedule) =>
      schedule.entries.some((entry) =>
        entry.placeIds.some((placeId) => data.places[placeId]?.mapId === mapId),
      ),
    )
}

/**
 * 이 맵이 그려야 할 화자 전부 — 일과가 데려올 수 있는 사람과, 좌표에 고정된 사람.
 *
 * 일과가 있는 화자에게 `speakers.csv` 의 `mapId` 는 더 이상 "어느 맵에 있는가"가
 * 아니다(그 사람의 자리는 시각이 정한다). 그래서 그 한 칸으로 거르던 자리는
 * 전부 이 함수로 온다 — 프리로드도 스폰도 같은 목록을 봐야, 시트는 실었는데
 * 스프라이트가 없거나 그 반대인 상태가 생기지 않는다.
 */
export function speakersForMap(data: GameData, mapId: string): SpeakerDef[] {
  const scheduled = new Set(Object.keys(data.schedules))
  const visiting = new Set(schedulesForMap(data, mapId).map((s) => s.speakerId))

  return Object.keys(data.speakers)
    .sort()
    .map((id) => data.speakers[id]!)
    .filter((speaker) =>
      scheduled.has(speaker.id) ? visiting.has(speaker.id) : speaker.mapId === mapId,
    )
}

export interface NpcSchedulerOptions {
  /** 지금 그리고 있는 맵. 씬이 다시 시작되면 스케줄러도 새로 만든다. */
  mapId: string
  /** 이 맵에 올 수 있는 일과들 — `schedulesForMap` 의 결과. */
  schedules: readonly ScheduleDef[]
  places: Record<string, PlaceDef>
  routes: readonly BakedLeg[]
}

/**
 * 매 프레임 "지금 몇 시인가"만 받아 씬이 할 일을 내놓는 것.
 *
 * 시각 말고는 아무것도 받지 않는 것이 이 클래스의 값어치다 — 같은 시각을 넣으면
 * 언제나 같은 처지가 나오므로(`npcStateAt` 이 순수 함수다), 테스트가 하루를
 * 몇 밀리초 단위로 걸어 다니며 명령을 확인할 수 있다.
 *
 * 이전 처지를 여기서 들고 있는 것이 유일한 상태다. 씬이 들고 있게 하면 씬이
 * "지난 프레임에 어디 있었나"의 주인이 되고, 맵을 넘을 때 그것을 비우는 일이
 * 하나 더 늘어난다 — 스케줄러를 통째로 새로 만들면 그 기억도 함께 사라진다.
 */
export class NpcScheduler {
  private readonly previous = new Map<string, NpcPresence>()

  constructor(private readonly options: NpcSchedulerOptions) {}

  /** 이 스케줄러가 보고 있는 화자들. 씬이 스프라이트를 미리 만들 때 쓴다. */
  get speakerIds(): string[] {
    return this.options.schedules.map((s) => s.speakerId)
  }

  tick(nowMs: number): NpcCommand[] {
    const { mapId, schedules, places, routes } = this.options
    const commands: NpcCommand[] = []

    for (const schedule of schedules) {
      const state = npcStateAt(schedule, places, routes, nowMs)
      const next = presenceOnMap(state, mapId)
      const prev = this.previous.get(schedule.speakerId) ?? away()
      commands.push(...diffPresence(schedule.speakerId, prev, next))
      this.previous.set(schedule.speakerId, next)
    }

    return commands
  }
}
