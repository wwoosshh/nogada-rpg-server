/**
 * 몬스터 스프라이트 목록 — `monsters` 등록부의 monsterId 가 가리키는 그림.
 *
 * nodeSprites·npcSprites 와 같은 자리이고 같은 이유다: 서버는 몬스터가 어디서
 * 무엇을 하는지 판정하지만 어떻게 생겼는지는 판정하지 않는다 — 그림은 화면의
 * 일이라 이 목록이 클라이언트에만 있다. 파일 자체는 저장소에 없다
 * (assets/CREDITS.md 의 재배포 금지 — public/ 은 .gitignore 대상, 원본과 복원
 * 명령은 그 문서의 "몬스터 스프라이트 대장"에 있다). 계약은 하나다: 모르는
 * 이름이면 조용히 넘어가지 않고 그 자리에서 던진다.
 */
const MONSTER_SPRITES: Record<string, string> = {
  // 세 줄인 이유: def 가 배치별로 구워지므로(packages/data 의 monsters.ts —
  // patrol 이 절대 좌표라서다) monsterId = instanceId 다. 몬스터가 늘면 이
  // 목록이 배치 수만큼 자라니, 종 칸을 매니페스트 키로 옮기는 것이 다음 아크의
  // 씨앗이다 — 그때까지는 셋이 같은 그림 한 장을 가리키는 것이 정직한 상태다.
  'wolf-1': 'monster_wolf.png',
  'wolf-2': 'monster_wolf.png',
  'wolf-3': 'monster_wolf.png',
}

export const MONSTER_SPRITE_IDS: readonly string[] = Object.keys(MONSTER_SPRITES)

/** 이 파일의 경로. 오류 문구가 "어디를 고치면 되는가"까지 말하게 하려고 상수로 둔다. */
const MANIFEST = 'apps/client/src/game/monsterSprites.ts'

/**
 * 그 몬스터의 시트 파일. 모르면 던진다 — 대체 그림을 내주면 오타 하나가
 * "그 몬스터만 다른 그림으로 선다"가 되고, 화면만 봐서는 의도와 구별되지 않는다
 * (nodeSprites 의 그 자세).
 */
export function monsterSpriteFile(monsterId: string): string {
  const file = MONSTER_SPRITES[monsterId]
  if (!file) {
    throw new Error(
      `몬스터 스프라이트 "${monsterId}" 를 모른다 — ${MANIFEST} 에 더하거나 ` +
        `packages/data/csv 의 몬스터 데이터를 고친다 (아는 것: ${MONSTER_SPRITE_IDS.join(', ') || '없음'})`,
    )
  }
  return file
}

/** Phaser 로더 키. node:·npc: 와 같은 규칙 — 접두사 없이는 같은 이름의 타일셋과 캐시 칸을 다툰다. */
export function monsterSpriteKey(monsterId: string): string {
  return `monster:${monsterId}`
}
