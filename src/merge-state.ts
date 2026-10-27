import type { AppState } from './types'

type Choice = 'local' | 'remote'

function equal(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function entityArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.id === 'string')
}

function merge(base: unknown, local: unknown, remote: unknown, path: string, choice: Choice, conflicts: string[]): unknown {
  if (equal(local, base)) return remote
  if (equal(remote, base) || equal(local, remote)) return local
  if (entityArray(base) && entityArray(local) && entityArray(remote)) {
    const old = new Map(base.map((item) => [item.id, item]))
    const ours = new Map(local.map((item) => [item.id, item]))
    const theirs = new Map(remote.map((item) => [item.id, item]))
    const ids = [...new Set([...remote.map((item) => item.id), ...local.map((item) => item.id)])]
    return ids.map((id) => merge(old.get(id), ours.get(id), theirs.get(id), `${path}.${id}`, choice, conflicts)).filter((item) => item !== undefined)
  }
  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])
    const result: Record<string, unknown> = Object.create(null)
    for (const key of keys) {
      if (key === 'updatedAt' || key === 'currentMemberId') {
        result[key] = key === 'updatedAt' ? remote[key] : local[key]
        continue
      }
      const value = merge(base[key], local[key], remote[key], `${path}.${key}`, choice, conflicts)
      if (value !== undefined) result[key] = value
    }
    return result
  }
  conflicts.push(path)
  return choice === 'local' ? local : remote
}

// A task deletion also removes descendants, comments and incoming links. Treat
// concurrent edits to that graph as one conflict so either choice stays valid.
function mergeDeletions(base: AppState, local: AppState, remote: AppState, choice: Choice) {
  const sides = [structuredClone(local), structuredClone(remote)]
  const originals = [local, remote]
  const baseItems = new Map(base.items.map((item) => [item.id, item]))
  const conflicts: string[] = []
  for (const side of [0, 1]) {
    const ours = originals[side]
    const theirs = originals[1 - side]
    const oursIds = new Set(ours.items.map((item) => item.id))
    const theirsIds = new Set(theirs.items.map((item) => item.id))
    const deleted = new Set(base.items.filter((item) => !oursIds.has(item.id)).map((item) => item.id))
    const roots = base.items.filter((item) => deleted.has(item.id) && (!item.parentId || !deleted.has(item.parentId)))
    for (const root of roots) {
      if (!theirsIds.has(root.id)) continue
      const tree = new Set([root.id])
      let size = 0
      while (size !== tree.size) {
        size = tree.size
        for (const item of [...base.items, ...theirs.items]) if (item.parentId && tree.has(item.parentId)) tree.add(item.id)
      }
      const graph = (board: AppState) => ({
        items: board.items.filter((item) => tree.has(item.id)),
        comments: board.comments.filter((comment) => tree.has(comment.itemId)),
        incoming: board.items.filter((item) => !tree.has(item.id)).map((item) => ({ id: item.id, links: item.relatedIds.filter((id) => tree.has(id)) })).filter((item) => item.links.length),
      })
      if (equal(graph(base), graph(theirs))) continue
      conflicts.push(`board.items.${root.id}`)
      const deleteWins = choice === (side === 0 ? 'local' : 'remote')
      const other = sides[1 - side]
      if (deleteWins) {
        other.items = other.items.filter((item) => !tree.has(item.id)).map((item) => ({ ...item, relatedIds: item.relatedIds.filter((id) => !tree.has(id)) }))
        other.comments = other.comments.filter((comment) => !tree.has(comment.itemId))
      } else {
        const restored = sides[side]
        for (const id of tree) {
          const original = baseItems.get(id)
          if (original && deleted.has(id) && !restored.items.some((item) => item.id === id)) restored.items.push(structuredClone(original))
        }
        restored.items = restored.items.map((item) => ({
          ...item,
          relatedIds: [...new Set([...item.relatedIds, ...(baseItems.get(item.id)?.relatedIds ?? []).filter((id) => tree.has(id))])],
        }))
        const commentIds = new Set(restored.comments.map((comment) => comment.id))
        restored.comments.push(...base.comments.filter((comment) => tree.has(comment.itemId) && !commentIds.has(comment.id)).map((comment) => structuredClone(comment)))
      }
    }
  }
  return { local: sides[0], remote: sides[1], conflicts }
}

export function mergeBoards(base: AppState, local: AppState, remote: AppState, choice: Choice = 'local') {
  const prepared = mergeDeletions(base, local, remote, choice)
  const conflicts: string[] = []
  const state = merge(base, prepared.local, prepared.remote, 'board', choice, conflicts) as AppState
  return { state, conflicts: [...new Set([...prepared.conflicts, ...conflicts])] }
}

export function conflictDetails(base: AppState, local: AppState, remote: AppState) {
  function atPath(state: AppState, path: string): unknown {
    let value: unknown = state
    for (const part of path.split('.').slice(1)) {
      if (Array.isArray(value)) value = value.find((entry) => entry?.id === part)
      else if (isRecord(value)) value = value[part]
      else return undefined
    }
    return value
  }
  function describe(value: unknown) {
    if (value === undefined || value === null) return 'Удалено или не указано'
    if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value || 'Пусто'
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return 'Изменён список или запись'
  }
  function describeTask(board: AppState, id: string) {
    const task = board.items.find((item) => item.id === id)
    if (!task) return 'Задача удалена вместе с её частями и комментариями'
    const tree = new Set([id])
    let size = 0
    while (size !== tree.size) {
      size = tree.size
      for (const item of board.items) if (item.parentId && tree.has(item.parentId)) tree.add(item.id)
    }
    const comments = board.comments.filter((comment) => tree.has(comment.itemId))
    const latest = comments.at(-1)
    return `Задача сохранена. Частей: ${tree.size - 1}, комментариев: ${comments.length}.${latest ? ` Последний комментарий: «${describe(latest.text)}»` : ''}`
  }
  const labels: Record<string, string> = { title: 'Название', body: 'Описание', goal: 'Цель', lane: 'Статус', assigneeId: 'Исполнитель' }
  return mergeBoards(base, local, remote).conflicts.map((path) => {
    const parts = path.split('.')
    const task = parts[1] === 'items' ? local.items.find((item) => item.id === parts[2]) ?? remote.items.find((item) => item.id === parts[2]) : null
    return {
      path,
      label: `${task?.title ? `${task.title} · ` : ''}${labels[parts.at(-1) ?? ''] ?? 'Данные'}`,
      local: parts[1] === 'items' && parts.length === 3 ? describeTask(local, parts[2]) : describe(atPath(local, path)),
      remote: parts[1] === 'items' && parts.length === 3 ? describeTask(remote, parts[2]) : describe(atPath(remote, path)),
    }
  })
}
