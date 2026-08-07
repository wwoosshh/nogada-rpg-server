import { z } from 'zod'
import { SKILL_IDS, type SkillId } from './types.js'

export const ItemInstanceSchema = z.object({
  instanceId: z.string(),
  itemId: z.string(),
  enhanceLevel: z.number().int().min(0),
})

/**
 * SKILL_IDS 로부터 모양을 만든다 — 다섯 개를 손으로 나열하면 기술이 추가될 때
 * (명상·낚시·헌혈) 이 스키마가 갱신을 놓칠 수 있다.
 *
 * z.record(z.string(), ...) 였을 때는 `{}` 도, 키 하나만 있는 객체도 통과했다.
 * 이 스키마는 세이브 파일이 아직 유효한지 판단하는 유일한 게이트라서, 키가
 * 빠진 세이브가 통과하면 그 스킬은 서버에서 undefined 로 읽히고
 * proficiencyProgress(undefined, ...) 가 NaN 을 반환해 성공률이 NaN 이 되고,
 * rng() < NaN 은 항상 false 라 영원히 0% 성공률로 채집만 반복된다 — 에러도
 * 로그도 없이. .strict() 는 그 반대 방향(SKILL_IDS 에 없는 키)도 막는다.
 */
const skillsShape = Object.fromEntries(
  SKILL_IDS.map((id) => [id, z.number().int().min(0)]),
) as Record<SkillId, z.ZodNumber>

export const PlayerStateSchema = z.object({
  id: z.string(),
  skills: z.object(skillsShape).strict(),
  stacks: z.record(z.string(), z.number().int().min(0)),
  instances: z.array(ItemInstanceSchema),
  equipped: z.record(z.string(), z.string()),
  nextActionAt: z.number(),
})

export const StateResponseSchema = z.object({ player: PlayerStateSchema })
export type StateResponse = z.infer<typeof StateResponseSchema>

export const GatherRequestSchema = z.object({ nodeId: z.string().min(1) })
export type GatherRequest = z.infer<typeof GatherRequestSchema>

export const CraftRequestSchema = z.object({ recipeId: z.string().min(1) })
export type CraftRequest = z.infer<typeof CraftRequestSchema>
