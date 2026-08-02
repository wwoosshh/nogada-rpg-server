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
    <img
      className="icon"
      width={size}
      height={size}
      src={`icons/${def?.icon ?? 'missing'}.png`}
      alt={def?.name ?? itemId}
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}
