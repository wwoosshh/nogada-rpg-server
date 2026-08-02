import { useGameStore } from '../store/gameStore.js'

export function Feed(): JSX.Element | null {
  const feed = useGameStore((s) => s.feed)
  if (feed.length === 0) return null

  return (
    <div className="panel feed">
      {feed.map((entry) => (
        <div className={`feed__line--${entry.success ? 'ok' : 'fail'}`} key={entry.id}>
          {entry.text}
        </div>
      ))}
    </div>
  )
}
