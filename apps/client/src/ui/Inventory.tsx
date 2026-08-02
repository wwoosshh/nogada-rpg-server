import { useGameStore } from '../store/gameStore.js'
import { ItemIcon } from './ItemIcon.js'

export function Inventory(): JSX.Element | null {
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)
  if (!player) return null

  const stacks = Object.entries(player.stacks).sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="panel">
      <div className="section-title">인벤토리</div>
      <div className="inventory__grid">
        {stacks.map(([itemId, count]) => (
          <div className="slot" key={itemId}>
            <span className="slot__label">
              <ItemIcon itemId={itemId} />
              <span className="slot__name">{data.items[itemId]?.name ?? itemId}</span>
            </span>
            <span className="slot__count">{count}</span>
          </div>
        ))}

        {player.instances.map((instance) => {
          const def = data.items[instance.itemId]
          const equipped = Object.values(player.equipped).includes(instance.instanceId)
          return (
            <div className={`slot slot--tier-${def?.toolTier ?? 1}`} key={instance.instanceId}>
              <span className="slot__label">
                <ItemIcon itemId={instance.itemId} />
                <span className="slot__name">{def?.name ?? instance.itemId}</span>
              </span>
              <span className="slot__count">{equipped ? '착용' : ''}</span>
            </div>
          )
        })}

        {stacks.length === 0 && player.instances.length === 0 && (
          <div className="slot">비어 있음</div>
        )}
      </div>
    </div>
  )
}
