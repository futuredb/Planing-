import { isDeepStrictEqual } from 'node:util'

// One committed task change is one operation, irrespective of HTTP/MCP retries.
// Only fixed category names leave the repository: no task contents or identifiers.
function comparableItem(item) {
  return { ...item, attachments: item.attachments ?? [], relatedIds: [...(item.relatedIds ?? [])].sort(),
    stickers: item.stickers ?? [], scores: item.scores ?? {} }
}

export function committedActions(previous, next) {
  if (!previous) return [] // Initial board import is not user activity.
  const actions = []
  const before = new Map(previous.items.map((item) => [item.id, item]))
  const after = new Map(next.items.map((item) => [item.id, item]))
  for (const [id, item] of after) {
    const old = before.get(id)
    if (!old) actions.push('funban.task.created')
    else if (!isDeepStrictEqual(comparableItem(old), comparableItem(item))) {
      actions.push(old.lane !== item.lane || old.sprintId !== item.sprintId
        ? 'funban.task.moved' : 'funban.task.updated')
    }
  }
  for (const id of before.keys()) if (!after.has(id)) actions.push('funban.task.deleted')
  const comments = new Set((previous.comments ?? []).map((comment) => comment.id))
  for (const comment of next.comments ?? []) if (!comments.has(comment.id)) actions.push('funban.comment.created')
  const sprints = new Map((previous.sprints ?? []).map((sprint) => [sprint.id, sprint]))
  for (const sprint of next.sprints ?? []) {
    if (!isDeepStrictEqual(sprints.get(sprint.id), sprint)) actions.push('funban.sprint.updated')
    sprints.delete(sprint.id)
  }
  for (const _ of sprints) actions.push('funban.sprint.updated')
  return actions
}
