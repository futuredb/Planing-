import { randomUUID } from 'node:crypto'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'

const ACTIVE_LANES = ['inbox', 'backlog', 'todo', 'doing', 'done']
const ALL_LANES = [...ACTIVE_LANES, 'archive']
const SPRINT_LANES = new Set(['todo', 'doing', 'done'])

const INSTRUCTIONS = `Перед первой записью в каждом чате выясни у пользователя имя исполнителя по умолчанию и сохрани его в контексте разговора. При создании задачи всегда передавай assigneeName: явное имя из запроса имеет приоритет, иначе используй имя по умолчанию. Общий токен не является личностью пользователя. Перед созданием ищи дубли через search_tasks. Связи ставь только по найденным точным id. Без отдельного подтверждения не удаляй задачи, не закрывай спринт и не меняй роли.`

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
}

function mondayInTimeZone(timeZone, offsetWeeks = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const utc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))
  const day = new Date(utc).getUTCDay()
  const monday = utc - ((day + 6) % 7) * 86_400_000 + offsetWeeks * 7 * 86_400_000
  return new Date(monday).toISOString().slice(0, 10)
}

function findMember(state, name) {
  if (name === null) return null
  const needle = normalize(name)
  if (!needle) throw new Error('Укажите имя исполнителя из команды или null для задачи без исполнителя')

  const exact = state.members.find(
    (member) => normalize(member.id) === needle || normalize(member.name) === needle,
  )
  if (exact) return exact

  const partial = state.members.filter((member) => normalize(member.name).includes(needle))
  if (partial.length === 1) return partial[0]
  const names = state.members.map((member) => member.name).join(', ')
  throw new Error(`Не удалось однозначно найти исполнителя «${name}». Участники: ${names}`)
}

function ensureSprint(state, id) {
  if (!state.sprints.some((sprint) => sprint.id === id)) {
    state.sprints.push({
      id,
      weekStart: id,
      goal: '',
      goalClosed: false,
      closed: false,
    })
  }
  return id
}

function resolveSprint(state, lane, requested, timeZone) {
  if (!SPRINT_LANES.has(lane)) return null
  if (!requested || requested === 'current') {
    return ensureSprint(state, mondayInTimeZone(timeZone))
  }
  if (requested === 'next') {
    return ensureSprint(state, mondayInTimeZone(timeZone, 1))
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
    throw new Error('Неделя должна быть current, next или датой понедельника YYYY-MM-DD')
  }
  return ensureSprint(state, requested)
}

function validateTaskId(state, id, label = 'Задача') {
  const item = state.items.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`${label} с id «${id}» не найдена`)
  return item
}

function validateRelations(state, taskId, ids) {
  const unique = [...new Set(ids ?? [])].filter((id) => id !== taskId)
  for (const id of unique) validateTaskId(state, id, 'Связанная задача')
  return unique
}

function validateScores(state, scores) {
  if (!scores) return {}
  const criteria = new Map(state.criteria.map((criterion) => [criterion.id, criterion]))
  for (const [id, value] of Object.entries(scores)) {
    const criterion = criteria.get(id)
    if (!criterion) throw new Error(`Критерий оценки «${id}» не найден`)
    if (value < 0 || value > criterion.max) {
      throw new Error(`Оценка «${criterion.name}» должна быть от 0 до ${criterion.max}`)
    }
  }
  return scores
}

function taskView(state, item, publicUrl) {
  const assignee = state.members.find((member) => member.id === item.assigneeId)
  return {
    id: item.id,
    title: item.title,
    description: item.body,
    lane: item.lane,
    sprintId: item.sprintId,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    parentId: item.parentId,
    relatedTaskIds: item.relatedIds ?? [],
    scores: item.scores ?? {},
    createdVia: item.createdVia ?? null,
    url: publicUrl,
  }
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    isError,
  }
}

function safeTool(handler) {
  return async (args) => {
    try {
      return toolResult(await handler(args))
    } catch (error) {
      return toolResult({ error: error instanceof Error ? error.message : String(error) }, true)
    }
  }
}

export function createFunbanMcpHandler({ repository, publicUrl, timeZone = 'Europe/Moscow' }) {
  return createMcpHandler(
    () => {
      const server = new McpServer(
        { name: 'funban', version: '0.1.0' },
        { instructions: INSTRUCTIONS },
      )

      server.registerTool(
        'get_context',
        {
          title: 'Контекст Funban',
          description: 'Получить участников, недели, критерии оценки и правила постановки задач.',
          annotations: { readOnlyHint: true },
        },
        safeTool(async () => {
          const state = await repository.read()
          if (!state) throw new Error('Доска Funban ещё не создана')
          return {
            currentWeek: mondayInTimeZone(timeZone),
            nextWeek: mondayInTimeZone(timeZone, 1),
            members: state.members.map(({ id, name }) => ({ id, name })),
            criteria: state.criteria.map(({ id, name, hint, max, step, invert, weight }) => ({
              id,
              name,
              hint,
              max,
              step,
              invert,
              weight,
            })),
            lanes: {
              inbox: 'Новая идея без разбора',
              backlog: 'Задача для дальнейшей приоритизации',
              todo: 'Запланировано в спринт',
              doing: 'В работе',
              done: 'Готово',
            },
            defaultAssigneeRule:
              'Возьми имя по умолчанию из текущего чата. Явно указанный в задаче участник имеет приоритет.',
          }
        }),
      )

      server.registerTool(
        'search_tasks',
        {
          title: 'Поиск задач Funban',
          description:
            'Найти существующие задачи перед созданием новой или установкой связей. Возвращает точные id.',
          inputSchema: z.object({
            query: z.string().max(300).default('').describe('Слова из заголовка или описания'),
            lane: z.enum(ALL_LANES).optional().describe('Ограничить поиск одной колонкой'),
            limit: z.number().int().min(1).max(50).default(10),
          }),
          annotations: { readOnlyHint: true },
        },
        safeTool(async ({ query, lane, limit }) => {
          const state = await repository.read()
          if (!state) throw new Error('Доска Funban ещё не создана')
          const needle = normalize(query)
          return state.items
            .filter((item) => !lane || item.lane === lane)
            .filter((item) => !needle || normalize(`${item.title} ${item.body}`).includes(needle))
            .sort((left, right) => right.createdAt - left.createdAt)
            .slice(0, limit)
            .map((item) => taskView(state, item, publicUrl))
        }),
      )

      server.registerTool(
        'create_task',
        {
          title: 'Создать задачу в Funban',
          description:
            'Создать одну задачу после проверки дублей. assigneeName всегда передавай явно: участник из запроса или имя по умолчанию из чата.',
          inputSchema: z.object({
            requestId: z
              .string()
              .min(8)
              .max(120)
              .describe('Уникальный id пользовательского запроса; при повторе используй тот же id'),
            title: z.string().trim().min(1).max(180),
            description: z.string().max(8000).default(''),
            lane: z.enum(ACTIVE_LANES).default('inbox'),
            sprint: z
              .string()
              .optional()
              .describe('Для todo/doing/done: current, next или понедельник YYYY-MM-DD'),
            assigneeName: z
              .string()
              .nullable()
              .describe('Явный исполнитель или исполнитель по умолчанию из текущего чата; null — без исполнителя'),
            parentId: z.string().nullable().default(null),
            relatedTaskIds: z.array(z.string()).max(20).default([]),
            scores: z.record(z.string(), z.number()).optional(),
          }),
          annotations: { destructiveHint: false, idempotentHint: true },
        },
        safeTool(async (input) =>
          repository.mutate(
            { action: 'create_task', requestId: input.requestId },
            (state) => {
              const assignee = findMember(state, input.assigneeName)
              const parent = input.parentId ? validateTaskId(state, input.parentId, 'Родительская задача') : null
              const id = randomUUID()
              const relatedIds = validateRelations(state, id, input.relatedTaskIds)
              const now = Date.now()
              const item = {
                id,
                title: input.title,
                body: input.description,
                lane: input.lane,
                sprintId: resolveSprint(state, input.lane, input.sprint, timeZone),
                parentId: parent?.id ?? null,
                relatedIds,
                assigneeId: assignee?.id ?? null,
                authorId: null,
                scores: validateScores(state, input.scores),
                attachments: [],
                stickers: [],
                createdVia: 'agent',
                createdAt: now,
                archivedAt: null,
              }
              state.items.unshift(item)
              for (const relatedId of relatedIds) {
                const related = validateTaskId(state, relatedId)
                related.relatedIds = [...new Set([...(related.relatedIds ?? []), id])]
              }
              return {
                state,
                touchedIds: [id, ...relatedIds],
                result: { task: taskView(state, item, publicUrl) },
              }
            },
          ),
        ),
      )

      server.registerTool(
        'update_task',
        {
          title: 'Обновить задачу в Funban',
          description: 'Обновить безопасные поля существующей задачи. Не удаляет и не архивирует задачи.',
          inputSchema: z.object({
            requestId: z.string().min(8).max(120),
            taskId: z.string().min(1),
            title: z.string().trim().min(1).max(180).optional(),
            description: z.string().max(8000).optional(),
            lane: z.enum(ACTIVE_LANES).optional(),
            sprint: z.string().optional(),
            assigneeName: z.string().nullable().optional(),
            scores: z.record(z.string(), z.number()).optional(),
          }),
          annotations: { destructiveHint: false, idempotentHint: true },
        },
        safeTool(async (input) =>
          repository.mutate(
            { action: 'update_task', requestId: input.requestId },
            (state) => {
              const item = validateTaskId(state, input.taskId)
              const hasChange = ['title', 'description', 'lane', 'sprint', 'assigneeName', 'scores'].some(
                (key) => Object.hasOwn(input, key),
              )
              if (!hasChange) throw new Error('Не передано ни одного изменения')

              if (input.title !== undefined) item.title = input.title
              if (input.description !== undefined) item.body = input.description
              if (input.assigneeName !== undefined) {
                item.assigneeId = findMember(state, input.assigneeName)?.id ?? null
              }
              if (input.scores !== undefined) item.scores = validateScores(state, input.scores)
              if (input.lane !== undefined) item.lane = input.lane
              if (input.lane !== undefined || input.sprint !== undefined) {
                const keepExistingSprint =
                  SPRINT_LANES.has(item.lane) && input.sprint === undefined && item.sprintId
                item.sprintId = keepExistingSprint
                  ? item.sprintId
                  : resolveSprint(state, item.lane, input.sprint, timeZone)
              }
              item.archivedAt = null

              return {
                state,
                touchedIds: [item.id],
                result: { task: taskView(state, item, publicUrl) },
              }
            },
          ),
        ),
      )

      server.registerTool(
        'link_tasks',
        {
          title: 'Связать задачи в Funban',
          description:
            'Добавить двусторонние связи между существующими задачами. Сначала найди их точные id через search_tasks.',
          inputSchema: z.object({
            requestId: z.string().min(8).max(120),
            taskId: z.string().min(1),
            relatedTaskIds: z.array(z.string()).min(1).max(20),
          }),
          annotations: { destructiveHint: false, idempotentHint: true },
        },
        safeTool(async ({ requestId, taskId, relatedTaskIds }) =>
          repository.mutate({ action: 'link_tasks', requestId }, (state) => {
            const item = validateTaskId(state, taskId)
            const relatedIds = validateRelations(state, taskId, relatedTaskIds)
            item.relatedIds = [...new Set([...(item.relatedIds ?? []), ...relatedIds])]
            for (const relatedId of relatedIds) {
              const related = validateTaskId(state, relatedId)
              related.relatedIds = [...new Set([...(related.relatedIds ?? []), taskId])]
            }
            return {
              state,
              touchedIds: [taskId, ...relatedIds],
              result: { task: taskView(state, item, publicUrl) },
            }
          }),
        ),
      )

      return server
    },
    { responseMode: 'json' },
  )
}
