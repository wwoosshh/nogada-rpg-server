import { APPEARANCES, type AppearanceId } from '@nogada/shared'

/**
 * 외형 id → 그림 파일과 사람이 읽는 이름.
 *
 * **이 표가 클라이언트에만 있는 것이 의도다** — npcSprites.ts 와 같은 이유이고,
 * 설계가 그 규칙에 낸 명시적 탈출구이기도 하다(규범 4): 외형 id 는 불투명하고,
 * 그것이 어느 파일인지·화면에 뭐라고 적히는지는 그림의 일이라 서버·프로토콜·
 * 세이브 어디에도 들어갈 이유가 없다. 서버는 "그 id 가 목록에 있는가" 까지만
 * 판정한다(shared 의 `isAppearance`).
 *
 * 파일 자체는 저장소에 없다(`assets/CREDITS.md`: Pipoya 재배포 금지 →
 * `apps/client/public/sprites/` 는 `.gitignore` 대상). 그래서 이 표는 곧
 * **에셋을 복원했는지 확인하는 목록**이기도 하다 — CREDITS 의 "플레이어 외형
 * 대장" 표와 한 쌍이고, 한쪽만 고치면 다른 환경에서 그림이 비어 나온다.
 *
 * `label` 이 생김새만 말하고 직업·성격을 말하지 않는 것은 지금 외형이 순수
 * 외형이기 때문이다 — "약초꾼" 이라고 적어 두면 직업 시스템이 생기는 날 그
 * 이름이 거짓이 된다.
 */

export interface PlayerSpriteDef {
  /** `apps/client/public/sprites/` 아래의 파일 이름. */
  file: string
  /** 외형 선택 화면에 적히는 이름. */
  label: string
}

/**
 * 아는 외형 전부. 새 외형을 넣을 때 `APPEARANCES`(shared)와 여기와
 * `assets/CREDITS.md` 의 복원 방법 셋을 함께 고친다 — 그 셋이 갈라지지 않는지는
 * playerSprites.test.ts 가 전수로 대조한다.
 *
 * 모든 시트는 **96×128 = 3열 × 4행, 프레임 32×32** 다(설계 규범 13). 규격이
 * 다른 시트를 넣으면 프레임 번호가 통째로 어긋나 걷는 방향이 뒤섞인다 —
 * WorldScene 이 프레임을 번호로만 고르기 때문이다.
 */
const PLAYER_SPRITES: Record<AppearanceId, PlayerSpriteDef> = {
  player: { file: 'player.png', label: '은빛 갑옷' },
  blue_hat: { file: 'blue_hat.png', label: '파란 챙모자' },
  olive_armor: { file: 'olive_armor.png', label: '올리브 갑옷' },
  silver_hair: { file: 'silver_hair.png', label: '은빛 머리' },
  rose_tunic: { file: 'rose_tunic.png', label: '분홍 상의' },
  violet_hat: { file: 'violet_hat.png', label: '보라 모자' },
  teal_robe: { file: 'teal_robe.png', label: '청록 예복' },
}

/** 이 파일의 경로. 오류 문구가 "어디를 고치면 되는가"까지 말하게 하려고 상수로 둔다. */
const MANIFEST = 'apps/client/src/game/playerSprites.ts'

/**
 * 그 외형의 그림. **모르는 id 는 조용히 기본 외형으로 바꾸지 않고 던진다.**
 *
 * npcSprite() 와 같은 자세다. 다만 여기엔 조용한 대체가 특히 나쁜 이유가 하나
 * 더 있다: 플레이어는 언제나 화면 한가운데 있으므로, 남의 시트로 그려도 그것이
 * "내가 고른 것" 인지 아닌지 본인은 알 수 없다. 옛 세이브의 빈 값은 여기까지
 * 오지 않는다 — 스키마가 읽는 순간 `DEFAULT_APPEARANCE` 로 채운다.
 */
export function playerSprite(appearance: string): PlayerSpriteDef {
  const def = (PLAYER_SPRITES as Record<string, PlayerSpriteDef>)[appearance]
  if (!def) {
    throw new Error(
      `플레이어 외형 "${appearance}" 를 모른다 — ${MANIFEST} 에 더하거나 ` +
        `packages/shared 의 APPEARANCES 를 고친다 (아는 것: ${APPEARANCES.join(', ')})`,
    )
  }
  return def
}

/**
 * Phaser 로더에 쓸 키. 화자 시트(`npc:...`)·맵(`map:...`)과 같은 자세로 종류를
 * 앞에 붙인다 — 접두사가 없으면 `player` 라는 타일셋이 생기는 날 한 캐시 칸을 다툰다.
 */
export function playerSpriteKey(appearance: string): string {
  return `player:${appearance}`
}
