import { DIRECTIONS, type Direction, type GameData, type TransitionDef } from '@nogada/shared'
import { requireCell, toInt } from './parse.js'
import type { MapTerrain } from './placements.js'

type Row = Record<string, string>

/** 시작 맵. 도달 가능성 검사의 출발점이고, 새 플레이어가 시작하는 곳이다. */
export const START_MAP_ID = 'world'

function toFacing(value: string, ctx: string): Direction | null {
  if (value === '') return null
  if ((DIRECTIONS as readonly string[]).includes(value)) return value as Direction
  throw new Error(`${ctx}: facing "${value}" 는 알 수 없다 (허용값: ${DIRECTIONS.join(', ')}, 또는 빈 칸)`)
}

export function parseTransitions(rows: Row[]): TransitionDef[] {
  return rows.map((row, i) => {
    const ctx = `transitions.csv[${i + 1}행]`
    return {
      fromMap: requireCell(row, 'fromMap', ctx),
      fromX: toInt(requireCell(row, 'fromX', ctx), ctx, 'fromX', 0),
      fromY: toInt(requireCell(row, 'fromY', ctx), ctx, 'fromY', 0),
      toMap: requireCell(row, 'toMap', ctx),
      toX: toInt(requireCell(row, 'toX', ctx), ctx, 'toX', 0),
      toY: toInt(requireCell(row, 'toY', ctx), ctx, 'toY', 0),
      facing: toFacing(row['facing'] ?? '', ctx),
    }
  })
}

/**
 * 전환을 검증한다. 지형이 필요해서 validateGameData 와 나뉜다 —
 * validateSpeakerPlacements 와 같은 이유다.
 */
export function validateTransitions(
  data: GameData,
  terrains: Record<string, MapTerrain>,
): string[] {
  const violations: string[] = []
  const at = (t: TransitionDef): string => `transitions[${t.fromMap} (${t.fromX}, ${t.fromY})]`

  const seen = new Map<string, TransitionDef>()

  for (const t of data.transitions) {
    for (const [role, mapId] of [['출발', t.fromMap], ['도착', t.toMap]] as const) {
      if (!data.maps[mapId]) {
        violations.push(`${at(t)}: ${role} 맵 "${mapId}" 이 maps.csv 에 없다`)
      }
    }
    if (!data.maps[t.fromMap] || !data.maps[t.toMap]) continue

    const fromKey = `${t.fromMap}:${t.fromX},${t.fromY}`
    if (seen.has(fromKey)) {
      violations.push(`${at(t)}: 같은 칸에서 출발하는 전환이 둘이다 — 무엇이 이길지 정해지지 않는다`)
    }
    seen.set(fromKey, t)

    const from = terrains[t.fromMap]
    const to = terrains[t.toMap]
    if (!from || !to) continue

    if (t.fromX < 0 || t.fromY < 0 || t.fromX >= from.width || t.fromY >= from.height) {
      violations.push(`${at(t)}: 출발 칸이 맵 밖이다 — ${t.fromMap} 은 ${from.width}×${from.height} 칸이다`)
    } else if (from.walls.has(`${t.fromX},${t.fromY}`)) {
      // 맵 안이어도 벽이면 결과는 맵 밖과 같다 — 그 칸에 설 수 없으니 아무도
      // 밟을 수 없고, 전환은 검증을 통과한 채 조용히 죽어 있는다. 도착 칸만
      // 보던 시절엔 이 데이터가 그냥 통과했다. 실제로 이 계획의 첫 예시 좌표가
      // 그런 칸이었고, 도착 칸 검사에 우연히 걸려서야 드러났다.
      violations.push(
        `${at(t)}: 출발 칸 (${t.fromX}, ${t.fromY}) 이 벽이다 — 아무도 그 칸에 설 수 없어 이 전환은 밟히지 않는다. ${t.fromMap} 의 빈 칸으로 옮긴다`,
      )
    }
    if (t.toX < 0 || t.toY < 0 || t.toX >= to.width || t.toY >= to.height) {
      violations.push(`${at(t)}: 도착 칸 (${t.toX}, ${t.toY}) 이 맵 밖이다 — ${t.toMap} 은 ${to.width}×${to.height} 칸이다`)
      continue
    }
    if (to.walls.has(`${t.toX},${t.toY}`)) {
      violations.push(
        `${at(t)}: 도착 칸 (${t.toX}, ${t.toY}) 이 벽이다 — 넘어가자마자 벽 속에 낀다. ${t.toMap} 의 빈 칸으로 옮긴다`,
      )
    }
    const node = Object.values(data.placements).find(
      (p) => p.mapId === t.toMap && p.x === t.toX && p.y === t.toY,
    )
    if (node) {
      violations.push(`${at(t)}: 도착 칸에 노드 ${node.instanceId} 이 있다 — 노드 칸에는 설 수 없다`)
    }
  }

  // 시작 맵에서 걸어서 닿는 맵을 넓혀 간다. 못 닿는 맵은 만들어도 아무도 못 본다.
  const reachable = new Set<string>([START_MAP_ID])
  let grew = true
  while (grew) {
    grew = false
    for (const t of data.transitions) {
      if (reachable.has(t.fromMap) && !reachable.has(t.toMap)) {
        reachable.add(t.toMap)
        grew = true
      }
    }
  }
  for (const mapId of Object.keys(data.maps)) {
    if (!reachable.has(mapId)) {
      violations.push(
        `maps[${mapId}]: 시작 맵 "${START_MAP_ID}" 에서 걸어서 닿을 수 없다 — transitions.csv 에 길을 낸다`,
      )
    }
  }

  return violations
}
