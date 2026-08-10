/**
 * 화자 스프라이트 목록 — `speakers.csv` 의 `sprite` 칸이 가리키는 그림.
 *
 * **이 목록이 클라이언트에만 있는 것이 의도다.** 서버는 화자가 어디 있고 무슨
 * 말을 하는지를 판정하지만 그가 어떻게 생겼는지는 판정하지 않는다 — 그림은
 * 화면의 일이라 서버·프로토콜·세이브 어디에도 들어갈 이유가 없다. 데이터는
 * `sprite` 라는 이름만 실어 나르고, 그 이름이 어느 파일인지는 여기서 풀린다.
 *
 * 파일 자체는 저장소에 없다(`assets/CREDITS.md`: Pipoya 재배포 금지 →
 * `apps/client/public/sprites/` 는 `.gitignore` 대상). 그래서 이 표는 곧
 * **에셋을 복원했는지 확인하는 목록**이기도 하다 — CREDITS 의 "화자 스프라이트
 * 대장" 표와 한 쌍이고, 한쪽만 고치면 다른 환경에서 그림이 비어 나온다.
 */

/**
 * 사람이냐 사물이냐.
 *
 * `char` 는 Pipoya 3열×4행 캐릭터 시트다 — 방향이 있고, 언젠가 걷는다.
 * `static` 은 한 장짜리 그림이라 방향이 없다. 안내판에 방향을 주면 "북쪽을
 * 보고 선 간판" 같은, 세계에 존재하지 않는 상태가 표현 가능해진다.
 */
export type NpcSpriteKind = 'char' | 'static'

export interface NpcSpriteDef {
  /** `apps/client/public/sprites/` 아래의 파일 이름. */
  file: string
  kind: NpcSpriteKind
}

/**
 * 아는 스프라이트 전부. 새 화자를 넣을 때 CSV 의 `sprite` 칸과 여기와
 * `assets/CREDITS.md` 의 복원 방법 셋을 함께 고친다.
 */
const NPC_SPRITES: Record<string, NpcSpriteDef> = {
  npc_elder: { file: 'npc_elder.png', kind: 'char' },
  npc_innkeeper: { file: 'npc_innkeeper.png', kind: 'char' },
  npc_child: { file: 'npc_child.png', kind: 'char' },
  npc_logger: { file: 'npc_logger.png', kind: 'char' },
  npc_herbalist: { file: 'npc_herbalist.png', kind: 'char' },
  npc_miner: { file: 'npc_miner.png', kind: 'char' },
  sign_wood: { file: 'sign_wood.png', kind: 'static' },
}

/** 이 파일의 경로. 오류 문구가 "어디를 고치면 되는가"까지 말하게 하려고 상수로 둔다. */
const MANIFEST = 'apps/client/src/game/npcSprites.ts'

/**
 * 그 이름의 그림을 찾는다. **모르면 조용히 넘어가지 않고 그 자리에서 던진다.**
 *
 * 대체 그림을 내주고 싶어지는 자리다. 그러면 오타 하나가 "그 화자만 다른 사람
 * 얼굴로 나온다"가 되는데, 그건 화면만 봐서는 의도한 것과 구별되지 않아 몇
 * 주씩 살아남는다. 빌드는 이 이름을 검사하지 않는다 — 검사하려면 데이터가
 * 클라이언트의 파일 목록을 알아야 하고, 그건 이 목록을 클라이언트에 둔 이유와
 * 정면으로 어긋난다. 그래서 잡히는 자리가 여기 하나뿐이고, 여기서 세게 잡는다.
 */
export function npcSprite(id: string): NpcSpriteDef {
  const def = NPC_SPRITES[id]
  if (!def) {
    const known = Object.keys(NPC_SPRITES).join(', ')
    throw new Error(
      `화자 스프라이트 "${id}" 를 모른다 — ${MANIFEST} 에 더하거나 ` +
        `packages/data/csv/speakers.csv 의 sprite 칸을 고친다 (아는 것: ${known})`,
    )
  }
  return def
}

/**
 * Phaser 로더에 쓸 키. 맵 키(`map:...`)와 같은 자세로 앞에 종류를 붙인다 —
 * 타일셋 키는 이름 그대로라, 접두사가 없으면 언젠가 `sign_wood` 라는 타일셋과
 * 부딪힌다.
 */
export function npcSpriteKey(id: string): string {
  return `npc:${id}`
}
