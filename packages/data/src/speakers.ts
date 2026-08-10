import type { Direction, SpeakerDef } from '@nogada/shared'
import { DIRECTIONS } from '@nogada/shared'
import { addUnique, optionalCell, requireCell, toInt } from './parse.js'

type Row = Record<string, string>

const SPEAKER_KINDS = ['npc', 'sign'] as const
type SpeakerKind = (typeof SPEAKER_KINDS)[number]

function isSpeakerKind(value: string): value is SpeakerKind {
  return (SPEAKER_KINDS as readonly string[]).includes(value)
}

function isDirection(value: string): value is Direction {
  return (DIRECTIONS as readonly string[]).includes(value)
}

/**
 * 비어 있으면 아래를 보고 선다.
 *
 * 기본값을 파서가 정하는 것이 중요하다 — 클라이언트가 정하면 "적지 않으면
 * 어느 쪽인가"가 화면 코드에 숨고, 시뮬레이터나 서버가 같은 데이터를 읽을 때
 * 다른 답을 낼 여지가 생긴다. 아래인 이유는 플레이어의 첫 자세와 같다:
 * 사람이 화면 밖이 아니라 화면 안을 향하고 있는 것이 기본이다.
 */
const DEFAULT_FACING: Direction = 'down'

/**
 * speakers.csv 를 파싱한다. 대화 상대(NPC·말하는 사물)의 정의와 배치를 함께 담는다.
 *
 * x·y 는 placements.ts 의 NodePlacement 와 같은 타일 좌표다. mapId 는 지금
 * '얼음채집장' 하나뿐이지만 처음부터 칸으로 둔다 — 맵이 늘어날 때 이 CSV 의
 * 스키마를 다시 마이그레이션하지 않기 위해서다(설계 문서 9장).
 */
export function parseSpeakers(rows: Row[]): Record<string, SpeakerDef> {
  const out: Record<string, SpeakerDef> = {}
  for (const row of rows) {
    const id = requireCell(row, 'id', 'speakers.csv')
    const ctx = `speakers.csv[${id}]`

    const kind = requireCell(row, 'kind', ctx)
    if (!isSpeakerKind(kind)) {
      throw new Error(`${ctx}: kind 는 ${SPEAKER_KINDS.join(' 또는 ')} 이어야 한다`)
    }

    // 선택 칸이다 — 이 칸이 생기기 전에 쓰인 행도, 방향이 없는 사물(간판)의
    // 빈 칸도 그대로 통과해야 한다. 대신 **적었는데 틀린 것**은 막는다:
    // 오타는 "그 화자만 엉뚱한 쪽을 본다"로 드러나는데 방향은 눈에 잘 띄지
    // 않아서 그 상태로 한참 간다.
    const rawFacing = optionalCell(row, 'facing')
    if (rawFacing !== undefined && !isDirection(rawFacing)) {
      throw new Error(`${ctx}: facing 은 ${DIRECTIONS.join(' 또는 ')} 이어야 한다`)
    }

    const def: SpeakerDef = {
      id,
      name: requireCell(row, 'name', ctx),
      kind,
      mapId: requireCell(row, 'mapId', ctx),
      // 타일 좌표는 (0,0) 이 유효한 칸이라 toInt 의 기본 최솟값(1)을 0 으로 낮춘다.
      x: toInt(requireCell(row, 'x', ctx), ctx, 'x', 0),
      y: toInt(requireCell(row, 'y', ctx), ctx, 'y', 0),
      sprite: requireCell(row, 'sprite', ctx),
      facing: rawFacing ?? DEFAULT_FACING,
    }
    addUnique(out, id, def, 'speakers.csv')
  }
  return out
}
