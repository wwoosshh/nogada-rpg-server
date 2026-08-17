import type { GameData } from '@nogada/shared'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderScale } from '../game/viewport.js'
import { useGameStore } from '../store/gameStore.js'
import { worldMapImage } from './worldMapImage.js'
import { mapRegistry, worldMapMarks } from './worldMapModel.js'

/**
 * 전체화면 세계 지도(DOM) — 미니맵을 누르면 열린다(설계 ⑤ 후반부·⑧-9).
 *
 * 가방·제작·상점·수집의 방의 형제다. TopBar 가 마운트하는 것도, `.panel` 껍데기를
 * 재사용하는 것도, `openPanel` 리터럴 하나로 끝나는 것도 같다 — B/ESC 로 닫히는
 * 것도 세계 입력이 잠기는 것도 가상 컨트롤러가 숨는 것도 값 무관한 규칙이라
 * (PanelScene.applyInput·applyWorldLock) 공짜로 따라온다.
 *
 * **왜 전체 출혈이 아니라 `.panel` 인가**(설계 ⑤): 전체 화면을 쓰면 월드맵이
 * 4.69px/타일까지 커지지만, 안 쓰는 이유는 가독성이 아니라 **남는 가로**다. 본문
 * 776 중 지도가 정사각 251 을 쓰고 남는 475 에 등록부가 선다(실측 — 치수의 출처와
 * 설계값과의 차이는 ui.css 의 `.worldmap` 문서에 있다). 그 등록부가 이 화면의 진짜
 * 이유다 — 월드맵에는 문이 넷뿐이고 채집장은 하나도 월드맵에 없어서, 그림만 보여
 * 주는 지도는 플레이어가 실제로 가고 싶은 곳을 한 곳도 못 찍는다.
 *
 * **읽기 전용 화면이다**(설계 ⑨). 줄 선택 → 지도 강조 → 깃발 찍기는 아크 2이고,
 * `visited` 필드도 가/불가 구분도 없다 — 안 가 본 곳의 이름을 그대로 적는 것이
 * 「잠긴 것까지 보이는 목록방」이라는 이 게임의 장치다.
 */
export function MapPanel(): JSX.Element | null {
  const open = useGameStore((s) => s.openPanel === 'map')
  const mapId = useGameStore((s) => s.player?.location.mapId ?? null)
  const data = useGameStore((s) => s.data)

  if (!open || mapId === null) return null

  return (
    <div className="panel">
      <section className="panel__card">
        <header className="panel__header">
          <h2 className="panel__title">세계 지도</h2>
          <button
            type="button"
            className="panel__close"
            aria-label="닫기"
            onClick={() => useGameStore.getState().setOpenPanel(null)}
          >
            ✕
          </button>
        </header>
        {/* 본문 두 단 — 왼쪽이 그림, 오른쪽이 등록부. 훅을 쓰는 쪽(그림)을 별도
            컴포넌트로 두는 이유는 위의 이른 반환 때문이다: 같은 함수 안에 두면
            패널이 닫혀 있는 프레임에 훅이 안 불려 React 가 순서를 잃는다. */}
        <div className="worldmap">
          <WorldMapPicture data={data} />
          <Registry data={data} mapId={mapId} />
        </div>
      </section>
    </div>
  )
}

/**
 * 그림 — 월드맵 한 장과 그 위의 이름표 넷.
 *
 * 상자 크기를 **재서** 굽는다(박아 넣지 않는다). 812×375 에서 본문 높이는 `.panel`
 * 껍데기가 정하고, 지도는 그 높이의 정사각이라 251px = 3.14px/타일이 나온다(실측).
 * 그 수를 여기 적지 않는 이유는 창을 리사이즈한 데스크톱과 노치가 다른 폰에서
 * 그림만 상자를 벗어나기 때문이다.
 *
 * **첫 열림 ≈100ms, 두 번째부터 0ms**(실측 — 58KB 맵 JSON 내려받기 14ms 포함,
 * 타일셋 여섯 장은 전부 캐시라 304 다). 그 값이 어디서 오고 왜 부팅이 아니라 첫
 * 열림에 내는지는 worldMapImage 의 문서에 있다.
 */
function WorldMapPicture({ data }: { data: GameData }): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [boxSize, setBoxSize] = useState(0)
  const [drawn, setDrawn] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  // 자리를 잡은 **뒤에** 재야 한다 — useEffect 로 재면 한 프레임 늦고, 그 한
  // 프레임에 상자가 0 이라 첫 굽기가 0px 짜리로 나간다.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = (): void => setBoxSize(Math.round(box.clientWidth))
    measure()
    // 창 크기·주소 표시줄·화면 회전 — 높이가 움직이면 정사각인 이 상자의 폭도
    // 함께 움직인다. 그때 다시 굽지 않으면 그림만 옛 크기로 늘어난다.
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (boxSize <= 0) return
    let alive = true
    worldMapImage(boxSize, renderScale())
      .then((image) => {
        const canvas = canvasRef.current
        // 패널이 그새 닫혔으면 그릴 곳이 없다. 구운 것은 모듈이 붙잡아 두므로
        // 버려지는 것은 이 한 번의 그리기뿐이다.
        if (!alive || !canvas) return
        canvas.width = image.canvas.width
        canvas.height = image.canvas.height
        canvas.getContext('2d')?.drawImage(image.canvas, 0, 0)
        setDrawn({ width: image.cssWidth, height: image.cssHeight })
      })
      .catch((err: unknown) => {
        // 조용히 빈 상자로 두지 않는다 — 그것은 "맵이 어두운 곳"과 화면에서
        // 구분되지 않는다. 등록부는 그림과 무관하게 그대로 산다.
        if (alive) setFailed(err instanceof Error ? err.message : String(err))
      })
    return () => {
      alive = false
    }
  }, [boxSize])

  return (
    <div className="worldmap__box" ref={boxRef}>
      {failed !== null ? (
        <p className="worldmap__note">지도를 못 그렸다 — {failed}</p>
      ) : drawn === null ? (
        <p className="worldmap__note">지도를 여는 중…</p>
      ) : null}
      <div
        className="worldmap__frame"
        style={drawn === null ? { display: 'none' } : { width: drawn.width, height: drawn.height }}
      >
        <canvas
          className="worldmap__canvas"
          ref={canvasRef}
          role="img"
          aria-label="세계 지도"
        />
        {/* 이름표 — 그림 위에 얹는 유일한 것이다. 채집 노드도 결계 영역도 안
            얹는다(설계 ⑤·⑨): 노드를 다 찍으면 채집장을 걸어 다니며 찾는 일이
            사라지고, 결계 좌표는 애초에 클라가 손에 쥔 적이 없다. */}
        {worldMapMarks(data).map((mark) => (
          <span
            key={mark.mapId}
            className="worldmap__pin"
            style={{ left: `${mark.leftPercent}%`, top: `${mark.topPercent}%` }}
          >
            {mark.name}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * 등록부 — 열 장소를 홉 순서로. 개발용 시험장은 없다.
 *
 * 무엇이 실리고 어떤 차례인지는 전부 `worldMapModel` 이 데이터에서 유도한다.
 * 여기서 하는 일은 그 결과를 줄로 놓는 것뿐이다 — 이 파일에 맵 이름을 한 글자도
 * 적지 않는 것이 「맵이 느는 날 등록부가 저절로 는다」의 전부다.
 */
function Registry({ data, mapId }: { data: GameData; mapId: string }): JSX.Element {
  return (
    <div className="worldmap__list">
      {/* 「홉」이 무엇의 단위인지 적힌 곳이 게임 안에 없다 — 띠가 A 를 처음
          말했던 것과 같은 자리라 한 줄을 쓴다. */}
      <p className="worldmap__caption">여기서 문을 몇 번 지나면 닿는가</p>
      <ol className="worldmap__rows">
        {mapRegistry(data, mapId).map((entry) => (
          <li
            key={entry.mapId}
            className={`worldmap__row${entry.hops === 0 ? ' worldmap__row--here' : ''}`}
          >
            <span className="worldmap__place">{entry.name}</span>
            <span className="worldmap__hops">{entry.hops === 0 ? '여기' : `${entry.hops}홉`}</span>
            {/* 열리는 것이 없으면 빈 칸이다 — 「없음」을 적지 않는다. 자리표시를
                지어내지 않는 것은 사실 공급자와 같은 자세이고, 열 줄 중 둘이
                비어 있는 것이 오늘의 참이다. */}
            <span className="worldmap__opens">{entry.opens.join(' · ')}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
