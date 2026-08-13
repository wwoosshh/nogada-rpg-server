/**
 * 맵 위의 한 칸. 노드 배치(`NodePlacement`)와 플레이어 위치(`PlayerLocation`)가
 * 공통으로 갖는 모양이라, 이 술어는 둘을 같은 자리에 놓고 볼 수 있다.
 */
export interface MapCell {
  mapId: string
  x: number
  y: number
}

/**
 * 결계 하나가 감싼 칸 덩어리 — **게이트 걸린 문을 지나야만 닿는 칸들**이다.
 *
 * 벽이 나눈 덩어리(`walkableRegions`)들 중, 시작 칸에서 게이트 없는 문만으로는
 * 닿을 수 없는 것이 여기 남는다. 그러니 "결계 뒤"의 정의는 좌표를 손으로 적은
 * 목록이 아니라 **지형과 문이 함께 만든 사실**이고, 빌드가 그것을 굽는다
 * (`bakeBarrierRegions`, packages/data).
 */
export interface BarrierRegion {
  /** 어느 맵의 덩어리인가. 결계는 맵 안 전환이라 안팎이 같은 맵 이름을 쓴다(설계 §3). */
  mapId: string
  /** 이 덩어리에 속한 칸의 `"x,y"` 키. */
  cells: readonly string[]
}

/**
 * 출하된 결계 구역 전부.
 *
 * **서버만 읽는다** — 확률표(`GatherTables`)와 같은 취급이고 같은 이유의
 * 반대편이 아니다: 저쪽은 숨은 문턱이 스포일되지 않게 감췄고, 이쪽은 감출
 * 것이 없어도 **판정의 재료를 판정받는 쪽에 쥐여 줄 이유가 없다**. 판정의
 * 유일한 주인은 서버다.
 */
export type BarrierRegions = readonly BarrierRegion[]

/**
 * 그 칸이 속한 결계 구역의 번호. 어느 결계에도 없으면 `-1`(= 결계 밖 세상).
 *
 * 선형 탐색이다. 출하 데이터는 구역 넷 · 칸 예순여섯이라 한 번 묻는 값이
 * 수십 번의 문자열 비교이고, 채집은 사람당 초에 한 번꼴이다 — 색인을 미리
 * 지어 두면 그 자료구조가 동결(`deepFreeze`) 밖에 하나 더 생긴다.
 */
function barrierIndexAt(regions: BarrierRegions, cell: MapCell): number {
  const key = `${cell.x},${cell.y}`
  return regions.findIndex((r) => r.mapId === cell.mapId && r.cells.includes(key))
}

/**
 * 이 노드와 이 사람 사이를 결계가 가르는가 — **위조된 요청에만 참이 되는 술어**다.
 *
 * **왜 이것이 필요한가:** 결계는 맵 안 전환이다(`fromMap === toMap`, 설계 §3).
 * 그래서 채집 판정의 맵 검사에게 결계 안과 밖은 **같은 맵**이고, 그 검사만으로는
 * 벽 바깥에 선 사람이 심층 노드의 `instanceId` 하나로 벽 너머를 캐는 것을
 * 못 막는다 — 맵 JSON 은 클라이언트가 받아 가므로 그 id 는 이미 손에 있다.
 *
 * **묻는 것은 "조건을 만족하는가"가 아니라 "지금 그 안에 있는가"다.** 여기서
 * 게이트(숙련·물때)를 다시 재면 안 된다: 허브 결계는 물이 빠졌을 때만 들어갈 수
 * 있지만 들어간 뒤에는 물이 차도 나올 수 있고(설계 §6 — 안내판이 "나오는 길은
 * 막지 않았다"고 약속했다), 안에서 계속 캘 수 있어야 한다. 조건을 다시 재는
 * 고침은 **정당하게 들어간 사람을 물이 들어오는 순간 손 놓게** 만든다.
 *
 * **서버가 답을 아는 이유:** 결계도 전환이라, 넘은 사람의 저장된 위치는 벽
 * 안쪽 도착 칸이다(`moveThroughTransition` 이 갱신한다). 안 넘었으면 바깥
 * 어딘가다. 저장된 `x·y` 가 지금 실제로 서 있는 칸이 아니어도(마지막 전환
 * 도착 칸이다, `PlayerState.location`) **어느 벽 구역인가**는 틀리지 않는다 —
 * 구역을 바꾸는 유일한 방법이 전환이기 때문이다.
 *
 * **"노드는 잠기지 않는다"(milestones.ts)를 되돌리는 것이 아니다.** 그 규범이
 * 금지한 것은 노드 앞에 선 사람을 게임이 못 캔다고 거절하는 일인데, 여기서
 * 거절당하는 사람은 애초에 그 앞에 설 수 없다 — 벽이 막는다. 결계 뒤가 아닌
 * 노드에게는 아무것도 묻지 않으므로(아래 첫 줄), 바깥 세상의 채집은 이 술어가
 * 생기기 전과 한 글자도 다르지 않다.
 */
export function barrierSeparates(
  regions: BarrierRegions,
  node: MapCell,
  standing: MapCell,
): boolean {
  const behind = barrierIndexAt(regions, node)
  // 결계 뒤가 아닌 노드는 묻지 않는다 — 바깥 노드의 판정은 그대로 지나간다.
  if (behind < 0) return false
  return barrierIndexAt(regions, standing) !== behind
}
