import { z } from 'zod'

export const ItemInstanceSchema = z.object({
  instanceId: z.string(),
  itemId: z.string(),
  enhanceLevel: z.number().int().min(0),
})

export const PlayerStateSchema = z.object({
  id: z.string(),
  skills: z.record(z.string(), z.number().int().min(0)),
  stacks: z.record(z.string(), z.number().int().min(0)),
  instances: z.array(ItemInstanceSchema),
  equipped: z.record(z.string(), z.string()),
  nodeCooldowns: z.record(z.string(), z.number()),
})

export const StateResponseSchema = z.object({ player: PlayerStateSchema })
export type StateResponse = z.infer<typeof StateResponseSchema>

export const GatherRequestSchema = z.object({ nodeId: z.string().min(1) })
export type GatherRequest = z.infer<typeof GatherRequestSchema>

export const CraftRequestSchema = z.object({ recipeId: z.string().min(1) })
export type CraftRequest = z.infer<typeof CraftRequestSchema>
