import type { CombatState, MonsterPlacement, MonsterState } from '@nogada/shared'

/**
 * 몬스터 렌더의 순수 계산 — MonsterSprite(Phaser)가 매 프레임 부르고, 테스트는
 * 씬 없이 여기만 문다.
 *
 * **NpcSprite 의 추격 보간을 쓰지 않는 이유가 이 파일의 존재 이유다**(설계
 * §12-앞 16). NpcSprite 는 "알려 준 칸을 향해 초당 일정 픽셀로 걷는다" — 추격
 * 속도가 목표 속도와 같아 정상 상태에서 수학 위치보다 0~1칸 뒤진다(실측).
 * 화자에게는 그 지연이 연출이지만 몬스터에게는 판정 오차다: 서버의 사거리·피격
 * 판정은 `monsterStateAt` 의 수학 위치를 보므로, 화면의 늑대가 뒤지면 장판과
 * 몸이 어긋나 "본 대로 피했는데 맞았다"가 된다. 그래서 몬스터의 픽셀은 이전
 * 프레임이라는 숨은 상태 없이 `tile→nextTile 을 progress 로 섞은 자리` 하나로
 * 매 프레임 그 자리에서 계산한다 — 같은 t 는 언제나 같은 픽셀이다.
 */

/** 타일 한 칸(px). WorldScene 의 TILE 과 같은 값이고 이유도 같다 — 월드는 32px 격자다. */
const TILE = 32

/** 그 상태의 몬스터가 서 있는 픽셀(칸 중심). 걷는 중이면 두 칸 사이의 그 비율 지점이다. */
export function monsterPixelCenter(state: MonsterState): { x: number; y: number } {
  return {
    x: (state.tile.x + (state.nextTile.x - state.tile.x) * state.progress) * TILE + TILE / 2,
    y: (state.tile.y + (state.nextTile.y - state.tile.y) * state.progress) * TILE + TILE / 2,
  }
}

/**
 * 화면이 그릴 이 배치의 HP — hunt(단수)가 이 배치를 가리킬 때만 깎인 값이다.
 *
 * 서버(fightService)가 hpBefore 를 정하는 분기와 같은 모양이어야 HP 바가
 * 거짓말하지 않는다: 다른 배치를 때리는 순간 이전 몬스터는 만혈로 돌아간다
 * (§4 — 한 번에 하나를 상대하는 단순화의 값).
 */
export function monsterHpOf(placement: MonsterPlacement, hunt: CombatState['hunt']): number {
  return hunt?.instanceId === placement.instanceId ? hunt.monsterHp : placement.maxHp
}
