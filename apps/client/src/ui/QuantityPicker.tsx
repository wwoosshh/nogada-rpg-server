/**
 * 수량 고르개 — `−` / 큰 숫자 / `+` / `전부`.
 *
 * **고를 것이 하나뿐이면(max ≤ 1) 버튼을 그리지 않는다**: 증표는 하나로 충분하고
 * (경제 §6-앞 16) 한 개 남은 재료도 고를 여지가 없다 — 눌러도 아무 일 없는 버튼 셋을
 * 그리는 대신 숫자만 남긴다(죽은 버튼 금지, 가방·제작 §8-앞 13). 숫자 자리는 그대로라
 * 선택을 옮겨도 화면이 튀지 않는다.
 *
 * **상점(ShopPanel)과 가방의 헌납 확인(BagPanel)이 같은 이것을 쓴다**(수집의 방
 * §6-앞 1 — "수량 선택은 상점의 그것을 재사용"). 원래 살던 곳은 ShopPanel.tsx
 * 안이었는데, 가방이 그것을 import 하면 화면 둘의 의존 방향이 거꾸로 서므로
 * 자기 파일로 나왔다 — 옮긴 것은 자리뿐이고 클래스 이름(`.shop__qty`)은 그대로다:
 * 두 화면에서 같은 것이 같은 모양으로 보여야 손가락이 매번 다시 배우지 않는다.
 */
export function QuantityPicker({
  count,
  max,
  onChange,
}: {
  count: number
  max: number
  onChange: (next: number) => void
}): JSX.Element {
  const fmt = (n: number): string => n.toLocaleString('ko-KR')
  return (
    <div className="shop__qty">
      {/* 라벨을 늘 둔다 — 증표처럼 고를 것이 하나뿐인 칸에서는 버튼이 없어
          큰 숫자 하나만 남는데, 그것만으로는 그 숫자가 수량인지 값인지 읽히지
          않는다(개당 값이 바로 위에 있다). */}
      <span className="shop__qty-label">수량</span>
      {max > 1 && (
        <button
          type="button"
          className="shop__step"
          aria-label="하나 줄이기"
          disabled={count <= 1}
          onClick={() => onChange(count - 1)}
        >
          −
        </button>
      )}
      <span className="shop__qty-num">{fmt(count)}</span>
      {max > 1 && (
        <>
          <button
            type="button"
            className="shop__step"
            aria-label="하나 늘리기"
            disabled={count >= max}
            onClick={() => onChange(count + 1)}
          >
            +
          </button>
          <button type="button" className="shop__step shop__step--all" onClick={() => onChange(max)}>
            전부
          </button>
        </>
      )}
    </div>
  )
}
