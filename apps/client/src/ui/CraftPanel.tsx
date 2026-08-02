import { canCraft, type RecipeDef } from '@nogada/shared'
import { useState } from 'react'
import { selectCraftChance, selectToolTier, useGameStore } from '../store/gameStore.js'
import { ItemIcon } from './ItemIcon.js'

export function CraftPanel(): JSX.Element | null {
  const player = useGameStore((s) => s.player)
  const data = useGameStore((s) => s.data)
  const craft = useGameStore((s) => s.craft)
  const [open, setOpen] = useState(false)

  if (!player) return null

  const recipes = Object.values(data.recipes).sort((a, b) => a.requiredLevel - b.requiredLevel)

  return (
    <div className="panel">
      <div className="tabs">
        <button
          className={`tabs__button ${open ? 'tabs__button--active' : ''}`}
          onClick={() => setOpen((v) => !v)}
        >
          제작 {open ? '닫기' : '열기'}
        </button>
      </div>

      {open && (
        <div className="craft__list">
          {recipes.map((recipe) => (
            <RecipeRow key={recipe.id} recipe={recipe} onCraft={() => void craft(recipe.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function RecipeRow({ recipe, onCraft }: { recipe: RecipeDef; onCraft: () => void }): JSX.Element {
  const player = useGameStore((s) => s.player)!
  const data = useGameStore((s) => s.data)

  const levelOk = canCraft({
    skillLevel: player.skills[recipe.skill].level,
    toolTier: selectToolTier(recipe.skill),
    recipe,
  })

  const shortages = recipe.inputs.filter((input) => (player.stacks[input.item] ?? 0) < input.count)
  const enabled = levelOk && shortages.length === 0
  // 서버 판정과 같은 공식이다. 표시값과 실제 결과가 어긋날 수 없다.
  const chance = selectCraftChance(recipe.id)

  return (
    <button className="recipe" disabled={!enabled} onClick={onCraft}>
      <span className="slot__label">
        <ItemIcon itemId={recipe.output.item} />
        <span>
          <div>{recipe.name}</div>
          <div className="recipe__inputs">
            {recipe.inputs
              .map((input) => {
                const have = player.stacks[input.item] ?? 0
                const name = data.items[input.item]?.name ?? input.item
                return `${name} ${have}/${input.count}`
              })
              .join(' · ')}
          </div>
          {!levelOk && <div className="recipe__short">숙련도 {recipe.requiredLevel} 필요</div>}
        </span>
      </span>
      <span className="recipe__chance">{Math.round(chance * 100)}%</span>
    </button>
  )
}
