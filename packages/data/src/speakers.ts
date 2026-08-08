import type { SpeakerDef } from '@nogada/shared'
import { addUnique, requireCell, toInt } from './parse.js'

type Row = Record<string, string>

const SPEAKER_KINDS = ['npc', 'sign'] as const
type SpeakerKind = (typeof SPEAKER_KINDS)[number]

function isSpeakerKind(value: string): value is SpeakerKind {
  return (SPEAKER_KINDS as readonly string[]).includes(value)
}

/**
 * speakers.csv 를 파싱한다. 대화 상대(NPC·말하는 사물)의 정의와 배치를 함께 담는다.
 *
 * x·y 는 placements.ts 의 NodePlacement 와 같은 타일 좌표다. mapId 는 지금
 * 'world' 하나뿐이지만 처음부터 칸으로 둔다 — 맵이 늘어날 때 이 CSV 의
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

    const def: SpeakerDef = {
      id,
      name: requireCell(row, 'name', ctx),
      kind,
      mapId: requireCell(row, 'mapId', ctx),
      // 타일 좌표는 (0,0) 이 유효한 칸이라 toInt 의 기본 최솟값(1)을 0 으로 낮춘다.
      x: toInt(requireCell(row, 'x', ctx), ctx, 'x', 0),
      y: toInt(requireCell(row, 'y', ctx), ctx, 'y', 0),
      sprite: requireCell(row, 'sprite', ctx),
    }
    addUnique(out, id, def, 'speakers.csv')
  }
  return out
}
