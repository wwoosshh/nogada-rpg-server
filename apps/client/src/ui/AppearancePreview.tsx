import { playerSprite } from '../game/playerSprites.js'

/**
 * 시트 한 장의 규격 — 96×128 = 3열 × 4행, 프레임 32×32(설계 규범 13).
 *
 * 아래의 크롭 계산이 전부 이 숫자에 기댄다. 규격이 다른 시트가 들어오면
 * 미리보기가 엉뚱한 칸을 보여 주는데, 그것을 막는 것은 추출 시점의 확인이다
 * (assets/CREDITS.md 의 "플레이어 외형 대장").
 */
const FRAME = 32
const SHEET_COLS = 3
const SHEET_ROWS = 4

/**
 * 대기 프레임 — 아래를 보고 선 자세. 가운데 열의 첫 행이다.
 *
 * WorldScene 의 `idleFrame('down')` 과 같은 칸이지만 그 함수를 가져다 쓰지
 * 않는다: 그것은 Phaser 씬 모듈에 얹혀 있어, DOM 화면이 끌어오면 게임에 들어가기
 * 전의 화면이 Phaser 를 통째로 번들에 들인다. 여기 필요한 것은 "가운데 열 첫 행"
 * 이라는 사실 하나뿐이다.
 */
const IDLE_COL = 1
const IDLE_ROW = 0

/**
 * 외형 하나의 대기 자세.
 *
 * **캔버스를 쓰지 않는다**(설계 §5). 시트를 배율만큼 키워 배경으로 깔고 창을
 * 한 칸 크기로 뚫으면 32×32 한 칸만 보인다 — 그림 파일 하나를 그대로 쓰므로
 * 별도의 잘라낸 파일도, Phaser 로더도 필요 없다.
 */
export function AppearancePreview({
  appearance,
  scale = 3,
}: {
  appearance: string
  scale?: number
}): JSX.Element {
  const { file, label } = playerSprite(appearance)
  const size = FRAME * scale

  return (
    <div
      className="appearance__frame"
      role="img"
      aria-label={label}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(sprites/${file})`,
        backgroundSize: `${SHEET_COLS * size}px ${SHEET_ROWS * size}px`,
        backgroundPosition: `-${IDLE_COL * size}px -${IDLE_ROW * size}px`,
      }}
    />
  )
}
