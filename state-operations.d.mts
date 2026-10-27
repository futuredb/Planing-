import type { StateRepository } from './state-repository.mjs'
export function moveTask(repository: StateRepository, itemId: string, input: {
  lane: string
  sprintId?: string | null
  requestId?: string
}): Promise<{ ok: boolean; itemId: string; lane: string; sprintId: string | null; updatedAt: number }>
