import { COLLECTION_MAX_GRADE } from '@nogada/shared'
import { useGameStore } from '../store/gameStore.js'
import { buildCodex, nextCollectionGate, type CodexSlot } from './codexModel.js'
import { ItemIcon } from './ItemIcon.js'

/**
 * 수집의 방(DOM) — 가방·제작·상점의 형제다. TopBar 가 마운트한다(App.tsx 가
 * 불가침이라 게임 중 React 가 그릴 수 있는 자리가 상단 바뿐이라는 사정은 그
 * 셋과 같다).
 *
 * **왜 캔버스가 아니라 DOM 인가**(설계 §6-앞 1): 상세 메뉴(PanelScene)는 Phaser
 * 라 텍스트 줄만 그린다 — 격자도 아이콘도 그 안에 그릴 수단이 없다. 가방·제작·
 * 상점을 DOM 으로 옮겼던 그 벽을 방이 다시 만난 것이라, 같은 답을 쓴다:
 * `.panel` 껍데기 재사용 + `openPanel` 리터럴 하나. ESC/B 로 닫히는 것도, 세계
 * 입력 잠금도, 가상 컨트롤러가 숨는 것도 값 무관이라 공짜로 따라온다.
 *
 * **숨기는 것은 없다**(§6-앞 3). 한 번도 안 바친 칸도 아이콘과 이름을 그대로
 * 보여주고 회색조로만 물러난다 — 은닉은 애초에 지킬 수 없고(이름도 아이콘도
 * 이미 번들에 있다), 원작 목록방이 한 일이 정확히 "잠긴 것까지 보인다"였다.
 * 잠긴 칸이 말하는 `0/N` 은 제작 패널의 잠긴 카드·상점의 잠긴 진열과 같은 문법
 * 이고, 흐림 대상 밖에서 가장 밝은 것도 같다(가방·제작 §8-앞 11).
 *
 * **읽기 전용 화면이다.** 바치는 손은 가방에 있다(재료 줄의 `[바치기]`) — 물건은
 * 가방에 있고 거기가 손이 있는 자리이며, 방은 결과를 보는 곳이다(설계 §5).
 * 그래서 이 패널에는 버튼이 닫기 하나뿐이고, 죽은 버튼도 없다.
 */
export function CodexPanel(): JSX.Element | null {
  const open = useGameStore((s) => s.openPanel === 'codex')
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)

  if (!open || player === null) return null

  const view = buildCodex(data, player)
  const gate = nextCollectionGate(data.milestones, view.score)

  return (
    <div className="panel">
      <section className="panel__card">
        <header className="panel__header">
          <h2 className="panel__title">수집의 방</h2>
          {/* 총점은 이 화면에서 가장 자주 보는 숫자라 헤더에 상주한다 — 상점
              패널의 소지금과 같은 자리, 같은 이유다. 이 수가 되사기 진열을
              여는 그 수이므로(§6-앞 7) 만점과 함께 적어 거리를 읽게 한다.

              이름은 `총점` 이 아니라 `수집 점수` 다 — 상점의 잠긴 진열이 이미
              그 글자로 같은 수를 말한다(shopModel). 한 숫자가 두 화면에서 다른
              이름을 달면, 처음 보는 사람은 두 눈금이 같은 것인지 확인할 방법이 없다.

              그리고 만점 옆에 **다음 문**을 적는다: 100 은 문이 아니고, 실제로
              열리는 수는 30·60 이다(nextCollectionGate 문서). */}
          <span className="codex__score" aria-label="수집 점수">
            수집 점수 {view.score}/{view.maxScore}
            {gate !== null && <span className="codex__gate"> · 다음 문 {gate.threshold}</span>}
          </span>
          <button
            type="button"
            className="panel__close"
            aria-label="닫기"
            onClick={() => useGameStore.getState().setOpenPanel(null)}
          >
            ✕
          </button>
        </header>
        <div className="codex__body">
          {view.lines.map((line) => (
            <section key={line.skill} className="codex__line">
              <h3 className="bag__section">
                {line.label}{' '}
                <span className="codex__line-score">
                  {line.score}/{line.maxScore}
                </span>
              </h3>
              <ul className="codex__slots">
                {line.slots.map((slot) => (
                  <SlotCell key={slot.itemId} slot={slot} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}

const fmt = (n: number): string => n.toLocaleString('ko-KR')

/**
 * 칸 하나 — 아이콘 · 이름 · 등급 · 숫자.
 *
 * 잠긴 칸(한 번도 안 바침)과 채운 칸의 차이는 **흐림과 숫자의 뜻**뿐이다:
 * 잠긴 칸은 `0/첫 문턱` 만 말하고(남은 개수를 따로 적지 않는다 — 그 둘이 같은
 * 수라 두 번 적으면 화면이 시끄럽다), 채운 칸은 `바친 개수/다음 문턱` 위에
 * `다음까지 N개` 를 얹는다. 만강은 목표가 없으므로 `가득` 이라고만 적는다 —
 * 없는 문턱을 0 으로 적으면 "곧 오른다"로 읽힌다.
 */
function SlotCell({ slot }: { slot: CodexSlot }): JSX.Element {
  const untouched = slot.donated === 0
  const full = slot.nextStep === null
  return (
    <li className={`codex__slot${untouched ? ' codex__slot--untouched' : ''}`}>
      <ItemIcon itemId={slot.itemId} />
      <span className="codex__slot-name">{slot.name}</span>
      <GradePips grade={slot.grade} />
      <span className="codex__slot-num">
        {full ? fmt(slot.donated) : `${fmt(slot.donated)}/${fmt(slot.nextStep ?? 0)}`}
      </span>
      <span className="codex__slot-next">
        {full ? '가득' : untouched ? '' : `다음까지 ${fmt(slot.remaining ?? 0)}개`}
      </span>
      {/* 만강 문턱은 **모든 상태에서** 적는다. 잠긴 칸에 `0/1` 만 적으면 그 칸이
          26분짜리인지 10시간짜리인지 알 길이 없고(첫 문턱과 만강이 1 대 1,600 인
          칸이 있다), 그것을 아는 유일한 방법이 되돌릴 수 없는 헌납 한 번이 된다.
          자리를 늘 차지하게 두는 것은 격자가 상태마다 튀지 않게 하기 위해서다. */}
      <span className="codex__slot-final">만강 {fmt(slot.finalStep)}</span>
    </li>
  )
}

/**
 * 등급 네 눈금 — 별 대신 칸이다.
 *
 * 글리프(★)를 쓰지 않는 이유: 이 게임의 글꼴은 16 격자 비트맵(Neo둥근모)이라
 * 별은 대체 글꼴로 떨어져 혼자 다른 그림체가 된다. 제작 패널의 재료 부족 점
 * (`.craft__row-dot`)과 같은 8px 네모라 방과 목록이 같은 언어를 쓴다.
 *
 * 개수를 `COLLECTION_MAX_GRADE` 에서 유도하는 것이 요점이다(shared 의 그 상수
 * 문서) — 4 를 박아 두면 문턱이 다섯 단이 되는 날 화면만 조용히 옛 방이 된다.
 * 눈금 자체는 장식이라 aria-hidden 이고, 등급은 묶음이 말로 한 번 말한다.
 */
function GradePips({ grade }: { grade: number }): JSX.Element {
  return (
    <span className="codex__pips" aria-label={`등급 ${grade}/${COLLECTION_MAX_GRADE}`}>
      {Array.from({ length: COLLECTION_MAX_GRADE }, (_, i) => (
        <span
          key={i}
          className={`codex__pip${i < grade ? ' codex__pip--on' : ''}`}
          aria-hidden="true"
        />
      ))}
    </span>
  )
}
