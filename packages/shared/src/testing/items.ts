import type { EquipSlot, ItemDef } from '../types.js'

/**
 * 테스트용 아이템 정의 하나. **테스트에서만 쓴다** — 그래서 index.ts 가 아니라
 * `@nogada/shared/testing` 서브경로로만 나간다(클라이언트 번들에 실리지 않는다).
 *
 * 왜 픽스처를 한곳에 모으는가: `ItemDef` 에 **필수** 칸이 하나 생기는 순간
 * (`price` 가 그랬다) 세 패키지에 흩어진 47개 리터럴이 전부 컴파일 오류가 된다.
 * 그때 고칠 곳이 47곳이면 사람은 "일단 컴파일되게" 아무 값이나 채우고, 그 값이
 * 무엇을 뜻하는지는 아무도 다시 안 본다. 여기 하나면 새 칸의 기본값을 **한 번**
 * 정하고 그 이유를 이 자리에 적을 수 있다.
 *
 * 기본값은 "가장 심심한 재료" 다 — id 를 이름·아이콘으로 그대로 쓰고 `price=0`
 * (팔 수 없다). 테스트가 신경 쓰는 칸만 overrides 로 덮으면, 그 테스트가 무엇을
 * 보고 있는지가 픽스처 한 줄에 그대로 드러난다.
 */
export function testItem(id: string, overrides: Partial<ItemDef> = {}): ItemDef {
  return { id, name: id, kind: 'material', icon: id, price: 0, ...overrides }
}

/**
 * 도구 하나. `kind='tool'` 과 짝인 `toolSkill`·`toolTier` 를 자리 인자로 받는다.
 *
 * 세 칸을 따로 적게 두지 않는 이유: 도구인데 `toolSkill` 이 빠진 정의는 실제
 * 버그의 모양이라(§6-앞 11) 그것을 **일부러** 만드는 테스트가 있다. 정상 도구를
 * 만드는 길이 짧고 확실해야 그 일부러가 눈에 띈다 — 그런 정의는 이 함수를 쓰지
 * 않고 testItem(id, { kind: 'tool', ... }) 로 적어 의도를 드러낸다.
 *
 * 도구의 `price` 가 0 인 것은 기본값을 물려받은 것이 아니라 출하 데이터가 그렇다
 * (도구는 팔 수 없다, 설계 §8).
 */
export function testTool(id: string, toolSkill: EquipSlot, toolTier: number, overrides: Partial<ItemDef> = {}): ItemDef {
  return testItem(id, { kind: 'tool', toolSkill, toolTier, ...overrides })
}
