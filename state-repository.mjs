import fs from 'node:fs'
import path from 'node:path'

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

function assertState(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.items)) {
    throw new Error('Некорректный формат состояния Funban')
  }
}

function nextVersion(previous, incoming) {
  return Math.max(
    Date.now(),
    Number(previous?.updatedAt ?? 0) + 1,
    Number(incoming?.updatedAt ?? 0),
  )
}

/** Старые вкладки без связей не должны стирать связи, которые уже есть на сервере. */
function preserveRelatedIds(previous, incoming) {
  if (!Array.isArray(previous?.items) || !Array.isArray(incoming?.items)) return incoming
  const incomingHasLinks = incoming.items.some(
    (item) => Array.isArray(item.relatedIds) && item.relatedIds.length,
  )
  if (incomingHasLinks) return incoming

  const previousById = new Map(previous.items.map((item) => [item.id, item]))
  return {
    ...incoming,
    items: incoming.items.map((item) => {
      const oldLinks = previousById.get(item.id)?.relatedIds
      return oldLinks?.length && !(item.relatedIds ?? []).length
        ? { ...item, relatedIds: oldLinks }
        : item
    }),
  }
}

/**
 * Если MCP изменил задачу после того, как вкладка загрузила доску, сохраняем
 * серверную версию. После следующей синхронизации вкладка снова может её менять.
 */
function preserveConcurrentMcpChanges(previous, incoming, baseVersion, metadata) {
  const incomingById = new Map(incoming.items.map((item) => [item.id, item]))
  const protectedIds = new Set(
    previous.items
      .filter((item) => Number(metadata.touchedAt?.[item.id] ?? 0) > baseVersion)
      .map((item) => item.id),
  )
  if (!protectedIds.size) return { state: incoming, preservedIds: [] }

  const preservedIds = []
  const merged = incoming.items.map((item) => {
    if (!protectedIds.has(item.id)) return item
    const current = previous.items.find((candidate) => candidate.id === item.id)
    if (!current) return item
    preservedIds.push(item.id)
    return current
  })

  const missing = previous.items.filter(
    (item) => protectedIds.has(item.id) && !incomingById.has(item.id),
  )
  preservedIds.push(...missing.map((item) => item.id))

  const protectedSprintIds = new Set(
    [...missing, ...merged]
      .filter((item) => protectedIds.has(item.id) && item.sprintId)
      .map((item) => item.sprintId),
  )
  const incomingSprintIds = new Set((incoming.sprints ?? []).map((sprint) => sprint.id))
  const missingSprints = (previous.sprints ?? []).filter(
    (sprint) => protectedSprintIds.has(sprint.id) && !incomingSprintIds.has(sprint.id),
  )

  return {
    state: {
      ...incoming,
      items: [...missing, ...merged],
      sprints: [...(incoming.sprints ?? []), ...missingSprints],
    },
    preservedIds: [...new Set(preservedIds)],
  }
}

function trimRequests(requests) {
  return Object.fromEntries(
    Object.entries(requests)
      .sort(([, left], [, right]) => Number(right.at) - Number(left.at))
      .slice(0, 1000),
  )
}

export function createStateRepository(stateFile) {
  const metadataFile = `${stateFile}.mcp.json`
  const auditFile = `${stateFile}.audit.jsonl`
  let queue = Promise.resolve()

  function exclusive(operation) {
    const run = queue.then(operation, operation)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  function readState() {
    const state = readJson(stateFile, null)
    if (state) assertState(state)
    return state
  }

  function readMetadata() {
    return readJson(metadataFile, { touchedAt: {}, requests: {} })
  }

  return {
    read() {
      return exclusive(() => readState())
    },

    replace(rawBody, baseVersion) {
      return exclusive(() => {
        const previous = readState()
        let incoming = JSON.parse(rawBody)
        assertState(incoming)

        const metadata = readMetadata()
        incoming = previous ? preserveRelatedIds(previous, incoming) : incoming
        let preservedIds = []
        if (
          previous &&
          Number.isFinite(baseVersion) &&
          Number(baseVersion) < Number(previous.updatedAt ?? 0)
        ) {
          const merged = preserveConcurrentMcpChanges(
            previous,
            incoming,
            Number(baseVersion),
            metadata,
          )
          incoming = merged.state
          preservedIds = merged.preservedIds
        }

        incoming.updatedAt = nextVersion(previous, incoming)
        writeAtomic(stateFile, JSON.stringify(incoming))
        return { state: incoming, preservedIds }
      })
    },

    mutate({ action, requestId }, operation) {
      return exclusive(() => {
        const state = readState()
        if (!state) throw new Error('Доска Funban ещё не создана')
        const metadata = readMetadata()

        if (requestId && metadata.requests?.[requestId]) {
          return { ...metadata.requests[requestId].result, deduplicated: true }
        }

        const outcome = operation(structuredClone(state))
        assertState(outcome.state)
        const version = nextVersion(state, outcome.state)
        outcome.state.updatedAt = version
        writeAtomic(stateFile, JSON.stringify(outcome.state))

        metadata.touchedAt ??= {}
        for (const id of outcome.touchedIds ?? []) metadata.touchedAt[id] = version
        metadata.requests ??= {}
        const result = { ...outcome.result, updatedAt: version, deduplicated: false }
        if (requestId) metadata.requests[requestId] = { at: version, result }
        metadata.requests = trimRequests(metadata.requests)
        writeAtomic(metadataFile, JSON.stringify(metadata))

        fs.appendFileSync(
          auditFile,
          `${JSON.stringify({
            at: new Date(version).toISOString(),
            action,
            requestId: requestId ?? null,
            taskIds: outcome.touchedIds ?? [],
          })}\n`,
        )

        return result
      })
    },
  }
}
