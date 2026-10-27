import fs from 'node:fs'
import path from 'node:path'
import { restoreAttachmentData } from './state-transport.mjs'
import { attributeChanges } from './portal-auth.mjs'

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`Не удалось прочитать данные Funban: ${error.message}`, { cause: error })
  }
}

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

export function isSprintWeek(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && date.getUTCDay() === 1
}

function assertState(state) {
  const invalid = () => { throw new Error('Некорректный формат состояния Funban') }
  if (!state || typeof state !== 'object' || !Number.isFinite(state.updatedAt)) invalid()
  for (const key of ['members', 'criteria', 'sprints', 'items', 'comments']) {
    if (!Array.isArray(state[key])) invalid()
    const ids = new Set()
    for (const entry of state[key]) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) invalid()
      ids.add(entry.id)
    }
  }
  const members = new Set(state.members.map((entry) => entry.id))
  const actors = new Set(members)
  if (state.actors !== undefined && !Array.isArray(state.actors)) invalid()
  for (const actor of state.actors ?? []) {
    if (!actor || typeof actor.id !== 'string' || !actor.id.startsWith('portal:') || actors.has(actor.id) ||
        typeof actor.name !== 'string' || !actor.name.trim() || actor.name.length > 200) invalid()
    actors.add(actor.id)
  }
  const sprints = new Set(state.sprints.map((entry) => entry.id))
  const items = new Set(state.items.map((entry) => entry.id))
  if (!members.size || !state.roles || typeof state.roles !== 'object' || Array.isArray(state.roles)) invalid()
  for (const member of state.members) {
    if (typeof member.name !== 'string' || typeof member.role !== 'string' || typeof member.avatar !== 'string') invalid()
  }
  for (const sprint of state.sprints) {
    if (typeof sprint.goal !== 'string' || typeof sprint.weekStart !== 'string' ||
        !isSprintWeek(sprint.id) || sprint.weekStart !== sprint.id ||
        typeof sprint.goalClosed !== 'boolean' || typeof sprint.closed !== 'boolean') invalid()
  }
  for (const criterion of state.criteria) {
    if (typeof criterion.name !== 'string' || typeof criterion.hint !== 'string' ||
        typeof criterion.invert !== 'boolean' || !Number.isFinite(criterion.weight) ||
        !Number.isFinite(criterion.max) || criterion.max <= 0 ||
        !Number.isFinite(criterion.step) || criterion.step <= 0) invalid()
  }
  const attachmentIds = new Set()
  for (const item of state.items) {
    if (!['inbox', 'backlog', 'todo', 'doing', 'done', 'archive'].includes(item.lane) ||
      typeof item.title !== 'string' || typeof item.body !== 'string' ||
      !Array.isArray(item.attachments) || !Array.isArray(item.stickers) ||
      !Array.isArray(item.relatedIds) || !item.scores || typeof item.scores !== 'object' || Array.isArray(item.scores) ||
      Object.values(item.scores).some((score) => !Number.isFinite(score)) || !Number.isFinite(item.createdAt) ||
      (item.archivedAt != null && !Number.isFinite(item.archivedAt)) ||
      (item.parentId != null && !items.has(item.parentId)) ||
      (item.sprintId != null && !sprints.has(item.sprintId)) ||
      (item.assigneeId != null && !members.has(item.assigneeId)) ||
      (item.authorId != null && !actors.has(item.authorId)) ||
      (['todo', 'doing', 'done'].includes(item.lane) && !item.sprintId) ||
      item.relatedIds.some((id) => !items.has(id) || id === item.id)) invalid()
    for (const attachment of item.attachments) {
      if (!attachment || typeof attachment.id !== 'string' || !attachment.id || attachmentIds.has(attachment.id) ||
          typeof attachment.name !== 'string' || typeof attachment.mime !== 'string' ||
          typeof attachment.dataUrl !== 'string' ||
          !(attachment.dataUrl.startsWith('/api/attachments/') || /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,/i.test(attachment.dataUrl))) invalid()
      attachmentIds.add(attachment.id)
    }
    for (const sticker of item.stickers) {
      if (!sticker || typeof sticker.id !== 'string' || typeof sticker.sticker !== 'string' ||
          !actors.has(sticker.by) || !['x', 'y', 'rot', 'scale'].every((key) => Number.isFinite(sticker[key]))) invalid()
    }
  }
  const parents = new Map(state.items.map((item) => [item.id, item.parentId]))
  const visited = new Set()
  for (const item of state.items) {
    const chain = new Set()
    let id = item.id
    while (id && !visited.has(id)) {
      if (chain.has(id)) invalid()
      chain.add(id)
      id = parents.get(id)
    }
    for (const ancestor of chain) visited.add(ancestor)
  }
  for (const comment of state.comments) if (!items.has(comment.itemId) || !actors.has(comment.authorId) || typeof comment.text !== 'string' || !Number.isFinite(comment.createdAt)) invalid()
}

function conflict(message, currentUpdatedAt) {
  const error = new Error(message)
  error.statusCode = 409
  error.currentUpdatedAt = Number(currentUpdatedAt) || 0
  return error
}

function assertSafeReplacement(previous, incoming, deletedRoots = []) {
  if (!previous?.items?.length) return
  const incomingIds = new Set(incoming.items.map((item) => item.id))
  const removedCount = previous.items.reduce(
    (count, item) => count + (incomingIds.has(item.id) ? 0 : 1),
    0,
  )
  const removed = previous.items.filter((item) => !incomingIds.has(item.id))
  const removedIds = new Set(removed.map((item) => item.id))
  const roots = removed.filter((item) => !item.parentId || !removedIds.has(item.parentId))
  const confirmed = new Set(deletedRoots)
  const isExplicitDeletion = roots.length > 0 && roots.every((item) => confirmed.has(item.id))
  if (!isExplicitDeletion && ((incoming.items.length === 0 && previous.items.length > 0) || removedCount > 5)) {
    throw conflict(
      `Защита Funban отклонила массовое удаление ${removedCount} задач`,
      previous.updatedAt,
    )
  }
}

function nextVersion(previous, incoming) {
  void incoming
  return Math.max(
    Date.now(),
    Number(previous?.updatedAt ?? 0) + 1,
  )
}

function trimRequests(requests) {
  return Object.fromEntries(
    Object.entries(requests)
      .sort(([, left], [, right]) => Number(right.at) - Number(left.at))
      .slice(0, 1000),
  )
}

export function createStateRepository(stateFile, { onChange = () => {} } = {}) {
  const metadataFile = `${stateFile}.mcp.json`
  const auditFile = `${stateFile}.audit.jsonl`
  let queue = Promise.resolve()
  let cachedState

  function exclusive(operation) {
    const run = queue.then(operation, operation)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function readState() {
    if (cachedState !== undefined) return cachedState
    if (!fs.existsSync(stateFile)) {
      cachedState = null
      return null
    }
    const state = readJson(stateFile, undefined)
    assertState(state)
    cachedState = state
    return state
  }

  function writeState(state) {
    writeAtomic(stateFile, JSON.stringify(state))
    cachedState = state
  }

  function notify(previous, next) {
    try { Promise.resolve(onChange(previous, next)).catch(() => {}) } catch {}
  }

  function readMetadata(state) {
    const metadata = state._funbanMetadata ?? readJson(metadataFile, { touchedAt: {}, requests: {} })
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
        (metadata.requests && (typeof metadata.requests !== 'object' || Array.isArray(metadata.requests))) ||
        (metadata.touchedAt && (typeof metadata.touchedAt !== 'object' || Array.isArray(metadata.touchedAt)))) {
      throw new Error('Некорректные метаданные Funban')
    }
    return structuredClone(metadata)
  }

  return {
    read() {
      return exclusive(() => readState())
    },

    readIfVersion(version) {
      return exclusive(() => {
        const state = readState()
        if (state && Number(state.updatedAt) === Number(version)) return null
        return state
      })
    },

    replace(rawBody, baseVersion, deletedRoots = [], actor = null) {
      return exclusive(() => {
        const previous = readState()
        let incoming = JSON.parse(rawBody)
        assertState(incoming)
        incoming = attributeChanges(previous, incoming, actor)
        assertState(incoming)

        if (previous && Number(baseVersion) !== Number(previous.updatedAt)) {
          throw conflict(
            'Доска изменилась после загрузки этой вкладки. Обновите данные и повторите действие.',
            previous.updatedAt,
          )
        }
        incoming = previous ? restoreAttachmentData(previous, incoming) : incoming
        assertSafeReplacement(previous, incoming, deletedRoots)
        delete incoming._funbanMetadata
        if (previous?._funbanMetadata) incoming._funbanMetadata = previous._funbanMetadata

        incoming.updatedAt = nextVersion(previous, incoming)
        writeState(incoming)
        notify(previous, incoming)
        return { state: incoming, preservedIds: [] }
      })
    },

    mutate({ action, requestId }, operation) {
      return exclusive(() => {
        const state = readState()
        if (!state) throw new Error('Доска Funban ещё не создана')
        const metadata = readMetadata(state)

        if (requestId && Object.hasOwn(metadata.requests ?? {}, requestId)) {
          return { ...metadata.requests[requestId].result, deduplicated: true }
        }

        const outcome = operation(structuredClone(state))
        assertState(outcome.state)
        const version = nextVersion(state, outcome.state)
        outcome.state.updatedAt = version
        metadata.touchedAt ??= {}
        for (const id of outcome.touchedIds ?? []) metadata.touchedAt[id] = version
        metadata.requests ??= {}
        const result = { ...outcome.result, updatedAt: version, deduplicated: false }
        if (requestId) metadata.requests = { ...metadata.requests, [requestId]: { at: version, result } }
        metadata.requests = trimRequests(metadata.requests)
        outcome.state._funbanMetadata = metadata
        // Board data and request deduplication are committed together.
        writeState(outcome.state)
        // Keep the old sidecar for rollback compatibility; the state file is authoritative.
        try { writeAtomic(metadataFile, JSON.stringify(metadata)) } catch (error) { console.error('Funban metadata mirror failed:', error.message) }
        try {
          fs.appendFileSync(auditFile, `${JSON.stringify({
            at: new Date(version).toISOString(), action, requestId: requestId ?? null,
            taskIds: outcome.touchedIds ?? [],
          })}\n`)
        } catch (error) { console.error('Funban audit log failed:', error.message) }

        notify(state, outcome.state)
        return result
      })
    },
  }
}
