import { z } from 'zod'

export const SkillStateSchema = z.object({
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
})

export const ItemInstanceSchema = z.object({
  instanceId: z.string(),
  itemId: z.string(),
  enhanceLevel: z.number().int().min(0),
})

export const PlayerStateSchema = z.object({
  id: z.string(),
  skills: z.record(z.string(), SkillStateSchema),
  stacks: z.record(z.string(), z.number().int().min(0)),
  instances: z.array(ItemInstanceSchema),
  equipped: z.record(z.string(), z.string()),
  nodeCooldowns: z.record(z.string(), z.number()),
})

export const StateResponseSchema = z.object({ player: PlayerStateSchema })
export type StateResponse = z.infer<typeof StateResponseSchema>

export const GatherRequestSchema = z.object({ nodeId: z.string().min(1) })
export type GatherRequest = z.infer<typeof GatherRequestSchema>
