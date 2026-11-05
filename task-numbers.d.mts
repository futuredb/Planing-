export function parseTaskNumber(value: unknown): number | null
export function assignTaskNumbers(
  state: { items: { id: string; number?: number; createdAt: number }[] },
  metadata: Record<string, unknown>,
  options?: { trustStoredNumbers?: boolean },
): boolean
