import { useGameStore } from '../store/gameStore.js'

interface ItemIconProps {
  itemId: string
  /** 화면에 그릴 한 변의 길이(px). 원본 32의 정수 배수만 쓴다. */
  size?: 32 | 64
}

/**
 * 아이템 아이콘. 원본은 32x32 픽셀아트이므로 정수 배율로만 확대한다.
 * 아이콘 파일이 없으면 조용히 빈 칸을 남긴다 — 데이터 추가 중에 화면이 깨지지 않게 한다.
 */
export function ItemIcon({ itemId, size = 32 }: ItemIconProps): JSX.Element {
  const data = useGameStore((s) => s.data)
  const def = data.items[itemId]

  return (
    // 왜 key 와 onLoad 둘 다: CraftPanel 상세 아이콘처럼 같은 <img> 를 레시피
    // 선택마다 재사용하는 자리가 있다 — src 만 바뀌고 엘리먼트는 그대로다.
    // key={itemId} 는 React 가 아예 새 <img> 를 마운트하게 해 이전 onError 의
    // visibility:hidden 잔여 인라인 스타일을 물려받지 않게 한다(방어선 1).
    // onLoad 리셋은 React 가 재사용을 택하는 경로(같은 부모, 같은 위치)에서도
    // 새 이미지가 실제로 그려질 때 visibility 를 되돌린다(방어선 2) — 하나만
    // 있으면 두 재사용 경로 중 하나가 뚫린다.
    <img
      key={itemId}
      className="icon"
      width={size}
      height={size}
      src={`icons/${def?.icon ?? 'missing'}.png`}
      alt={def?.name ?? itemId}
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
      onLoad={(e) => {
        e.currentTarget.style.visibility = ''
      }}
    />
  )
}
