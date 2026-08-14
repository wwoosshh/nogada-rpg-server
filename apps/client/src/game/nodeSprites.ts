/**
 * 채집 노드 스프라이트 목록 — `nodes.csv` 의 `sprite` 칸이 가리키는 그림.
 *
 * **이 목록이 클라이언트에만 있는 것이 의도다** — npcSprites.ts 와 같은 이유다.
 * 서버는 그 노드가 어디 있고 무엇을 내주는지를 판정하지만 그것이 어떻게 생겼는지는
 * 판정하지 않는다. 그림은 화면의 일이라 서버·프로토콜·세이브 어디에도 들어갈
 * 이유가 없다. 데이터는 `sprite` 라는 이름만 실어 나르고, 그 이름이 어느 파일인지는
 * 여기서 풀린다.
 *
 * 파일 자체는 저장소에 없다(`assets/CREDITS.md`: Pipoya 재배포 금지 →
 * `apps/client/public/nodes/` 는 `.gitignore` 대상이고, 잘라 낸 것도 색을 돌린 것도
 * 같은 자리에 선다). 그래서 이 표는 곧 **에셋을 복원했는지 확인하는 목록**이기도
 * 하다 — CREDITS 의 "노드 스프라이트 대장" 표·복원 명령과 한 쌍이고, 한쪽만 고치면
 * 다른 환경에서 그림이 비어 나온다. 셋이 갈라지지 않는지는 nodeSprites.test.ts 가
 * 전수로 대조한다.
 *
 * **열두 장 전부 32×32 한 칸이다**(설계 규범 13). 두 칸짜리 큰 그림을 넣으면 밑변
 * 정렬과 y 정렬 깊이가 따라오는데(`depth.ts` 의 `node = 5` 는 평면이다), 그것은
 * 노드에 얼굴을 붙이는 일이 살 값이 아니다.
 */

/**
 * 아는 그림 전부. 새 노드를 넣을 때 `nodes.csv` 의 `sprite` 칸과 여기와
 * `assets/CREDITS.md` 의 대장 표·복원 명령 셋을 함께 고친다.
 *
 * 지금은 이름 하나에 파일 하나뿐이라 값이 문자열이다 — 화자 시트처럼 종류(`char`·
 * `static`)가 갈리지 않기 때문이다. 노드 그림은 방향도 프레임도 없는 한 장이고,
 * 그것이 32×32 규범의 다른 얼굴이다.
 */
const NODE_SPRITES: Record<string, string> = {
  ice_vein: 'ice_vein.png',
  deep_ice_vein: 'deep_ice_vein.png',
  red_ice_vein: 'red_ice_vein.png',
  thunderstruck_tree: 'thunderstruck_tree.png',
  meteor_vein: 'meteor_vein.png',
  frostbloom_patch: 'frostbloom_patch.png',
  young_tree: 'young_tree.png',
  old_tree: 'old_tree.png',
  copper_vein: 'copper_vein.png',
  iron_vein: 'iron_vein.png',
  herb_patch: 'herb_patch.png',
  rare_herb_patch: 'rare_herb_patch.png',
}

/**
 * 아는 이름 전부. 오류 문구가 "아는 것"을 세는 자리이자, 전수 대조가 **매니페스트
 * 쪽에서** 셀 수 있게 하는 자리다 — CSV 도 CREDITS 도 부르지 않는 칸이 남으면 그
 * 파일이 왜 `public/nodes/` 에 있는지 아무도 모르게 되는데, 그 방향은 목록을
 * 셀 수 있어야만 잡힌다.
 */
export const NODE_SPRITE_IDS: readonly string[] = Object.keys(NODE_SPRITES)

/** 이 파일의 경로. 오류 문구가 "어디를 고치면 되는가"까지 말하게 하려고 상수로 둔다. */
const MANIFEST = 'apps/client/src/game/nodeSprites.ts'

/**
 * 그 이름의 그림 파일. **모르면 조용히 넘어가지 않고 그 자리에서 던진다.**
 *
 * npcSprite() 와 같은 자세다 — 대체 그림을 내주면 오타 하나가 "그 노드만 다른
 * 그림으로 선다"가 되는데, 그건 화면만 봐서는 의도한 것과 구별되지 않아 몇 주씩
 * 살아남는다. 노드는 특히 그렇다: 캡션이 이름을 말해 주므로 그림이 엉뚱해도
 * "원래 저렇게 생긴 건가"로 넘어간다. 빌드는 이 이름을 검사하지 않는다 —
 * 검사하려면 데이터가 클라이언트의 파일 목록을 알아야 하고, 그건 이 목록을
 * 클라이언트에 둔 이유와 정면으로 어긋난다.
 */
export function nodeSpriteFile(sprite: string): string {
  const file = NODE_SPRITES[sprite]
  if (!file) {
    throw new Error(
      `노드 스프라이트 "${sprite}" 를 모른다 — ${MANIFEST} 에 더하거나 ` +
        `packages/data/csv/nodes.csv 의 sprite 칸을 고친다 (아는 것: ${NODE_SPRITE_IDS.join(', ')})`,
    )
  }
  return file
}

/**
 * Phaser 로더에 쓸 키. 화자 시트(`npc:...`)·외형(`player:...`)·맵(`map:...`)과 같은
 * 자세로 앞에 종류를 붙인다 — 타일셋 키는 이름 그대로라, 접두사가 없으면 언젠가
 * `young_tree` 라는 타일셋과 한 캐시 칸을 다툰다.
 */
export function nodeSpriteKey(sprite: string): string {
  return `node:${sprite}`
}
