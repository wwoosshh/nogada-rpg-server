/**
 * 고를 수 있는 외형 id.
 *
 * 실제 시트는 Pipoya 캐릭터 팩에서 추출한다 — 라이선스 에셋이라 저장소에 없고
 * (assets/CREDITS.md 의 복원 레시피), 클라이언트 매니페스트가 id ↔ 시트 파일을
 * 잇는다(`apps/client/src/game/playerSprites.ts`). 여기 있는 것은 "서버가
 * 무엇을 받아들이는가" 하나뿐이다.
 *
 * **왜 shared 인가:** 서버의 검증과 클라이언트의 선택 화면이 같은 목록을 봐야
 * 하기 때문이다. 둘이 갈라지면 화면에 보이는 외형을 골랐는데 저장이 400 으로
 * 거절되거나, 반대로 저장된 외형에 그릴 시트가 없다. 그 어긋남을 잡는 것이
 * playerSprites.test.ts 의 전수 대조다(설계 규범 4).
 *
 * id 는 **불투명하다** — 이 값이 시트 파일 이름이라고 가정하지 않는다. 그것이
 * 스프라이트를 shared 에 들이지 않고도 외형을 고르게 하는 탈출구다. 이름이
 * 생김새를 가리키는 것은(모자·갑옷·머리색) 지금 외형이 **순수 외형**이기
 * 때문이다 — 직업 시스템은 이 선택 위에 얹힌다(설계 §4).
 *
 * 순서가 곧 생성 화면에 놓이는 순서다.
 */
export const APPEARANCES = [
  // 계정이 생기기 전부터 클라이언트가 하드코딩해 쓰던 시트. 목록의 첫 칸이자
  // 옛 세이브의 기본값이라 여기 남는다.
  'player',
  'blue_hat',
  'olive_armor',
  'silver_hair',
  'rose_tunic',
  'violet_hat',
  'teal_robe',
] as const

export type AppearanceId = (typeof APPEARANCES)[number]

/**
 * 외형을 고른 적 없는 캐릭터의 외형.
 *
 * 계정이 생기기 전의 세이브에는 이 필드가 통째로 없다 — 그 세이브가 가리키는
 * 것은 클라이언트가 그때 하드코딩해 쓰던 시트 하나이므로, 기본값도 그것이다.
 */
export const DEFAULT_APPEARANCE: AppearanceId = 'player'

/** 이 문자열이 고를 수 있는 외형인가. 서버가 임의 문자열을 거절하는 자리다. */
export function isAppearance(value: string): value is AppearanceId {
  return (APPEARANCES as readonly string[]).includes(value)
}
