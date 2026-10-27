import { isSprintWeek } from './state-repository.mjs'

export async function moveTask(repository, itemId, input) {
  const lanes = new Set(['inbox', 'backlog', 'todo', 'doing', 'done', 'archive'])
  if (!lanes.has(input.lane)) throw new Error('Некорректный статус задачи')
  if (input.sprintId !== undefined && input.sprintId !== null && typeof input.sprintId !== 'string') {
    throw new Error('Некорректный спринт задачи')
  }
  return repository.mutate(
    { action: 'move_task', requestId: typeof input.requestId === 'string' ? input.requestId : null },
    (state) => {
      const item = state.items.find((candidate) => candidate.id === itemId)
      if (!item) {
        const error = new Error('Задача не найдена')
        error.statusCode = 404
        throw error
      }
      const sprintId = ['inbox', 'backlog'].includes(input.lane)
        ? null
        : input.sprintId === undefined ? item.sprintId : input.sprintId
      if (sprintId && !state.sprints.some((sprint) => sprint.id === sprintId)) {
        if (!isSprintWeek(sprintId)) {
          throw new Error('Неделя должна начинаться в понедельник')
        }
        state.sprints.push({ id: sprintId, weekStart: sprintId, goal: '', goalClosed: false, closed: false })
      }
      if (['todo', 'doing', 'done'].includes(input.lane) && !sprintId) {
        throw new Error('Для задачи спринта нужна неделя')
      }
      return {
        state: {
          ...state,
          items: state.items.map((candidate) => candidate.id === itemId
            ? { ...candidate, lane: input.lane, sprintId, archivedAt: input.lane === 'archive' ? Date.now() : null }
            : candidate),
        },
        touchedIds: [itemId],
        result: { ok: true, itemId, lane: input.lane, sprintId },
      }
    },
  )
}
