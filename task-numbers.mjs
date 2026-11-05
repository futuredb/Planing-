/** A reference is an entire positive number, optionally prefixed with #. */
export function parseTaskNumber(value) {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !/^#?[1-9]\d*$/.test(value.trim()))
    return null
  const number = Number(value.trim().replace(/^#/, ''))
  return Number.isSafeInteger(number) ? number : null
}

/** Called only inside the repository queue. Tombstones reserve deleted numbers. */
export function assignTaskNumbers(
  state,
  metadata,
  { trustStoredNumbers = false } = {},
) {
  const saved = metadata.taskNumbers
  if (
    saved !== undefined &&
    (!saved ||
      typeof saved !== 'object' ||
      Array.isArray(saved) ||
      !saved.byId ||
      typeof saved.byId !== 'object' ||
      Array.isArray(saved.byId) ||
      !Number.isSafeInteger(saved.next) ||
      saved.next < 1)
  ) {
    throw new Error('Некорректный реестр номеров задач Funban')
  }
  const byId = new Map(Object.entries(saved?.byId ?? {}))
  const reserved = new Set()
  let next = saved?.next ?? 1
  for (const [id, number] of byId) {
    if (!id || parseTaskNumber(number) !== number || reserved.has(number)) {
      throw new Error('Некорректный реестр номеров задач Funban')
    }
    reserved.add(number)
    next = Math.max(next, number + 1)
  }
  if (!saved && trustStoredNumbers) {
    for (const item of state.items) {
      if (item.number === undefined) continue
      if (
        parseTaskNumber(item.number) !== item.number ||
        reserved.has(item.number)
      ) {
        throw new Error('Повторяющийся или некорректный номер задачи Funban')
      }
      byId.set(item.id, item.number)
      reserved.add(item.number)
      next = Math.max(next, item.number + 1)
    }
  }
  if (!Number.isSafeInteger(next)) throw new Error('Закончился диапазон номеров задач')
  let changed = !saved
  const ordered = [...state.items].sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  )
  for (const item of ordered) {
    if (!byId.has(item.id)) {
      if (!Number.isSafeInteger(next) || next >= Number.MAX_SAFE_INTEGER)
        throw new Error('Закончился диапазон номеров задач')
      byId.set(item.id, next++)
      changed = true
    }
    const number = byId.get(item.id)
    if (item.number !== number) {
      item.number = number
      changed = true
    }
  }
  metadata.taskNumbers = { next, byId: Object.fromEntries(byId) }
  return changed || next !== saved?.next
}
