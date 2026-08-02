import type { FastifyInstance } from 'fastify'
import { LOCAL_PLAYER_ID } from '../state/constants.js'
import type { PlayerStore } from '../state/store.js'

export function registerStateRoutes(app: FastifyInstance, store: PlayerStore): void {
  app.get('/api/state', () => ({ player: store.get(LOCAL_PLAYER_ID) }))
}
