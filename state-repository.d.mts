export type Board = { updatedAt: number; [key: string]: unknown }
export type StateRepository = {
  read(): Promise<Board | null>
  readIfVersion(version: number): Promise<Board | null>
  replace(body: string, baseVersion: number, deletedRoots?: string[]): Promise<{ state: Board; preservedIds: string[] }>
}
export function createStateRepository(file: string): StateRepository
export function isSprintWeek(value: unknown): boolean
