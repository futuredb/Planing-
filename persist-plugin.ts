import fs from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

const dataDir = path.resolve('data')
const dataPath = process.env.FUNBAN_DATA || process.env.WEEKBOARD_DATA
const stateFile = dataPath ? path.resolve(dataPath) : path.join(dataDir, 'state.json')

function readBody(req: NodeJS.ReadableStream) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeAtomic(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

function preserveRelatedIds(prevText: string, nextText: string) {
  let prev: { items?: { id: string; relatedIds?: string[] }[] }
  let next: { items?: { id: string; relatedIds?: string[] }[] }
  try {
    prev = JSON.parse(prevText)
    next = JSON.parse(nextText)
  } catch {
    return nextText
  }
  if (!Array.isArray(prev?.items) || !Array.isArray(next?.items)) return nextText
  const incomingHasLinks = next.items.some((it) => Array.isArray(it.relatedIds) && it.relatedIds.length)
  if (incomingHasLinks) return nextText
  const prevById = new Map(prev.items.map((it) => [it.id, it]))
  let changed = false
  next.items = next.items.map((it) => {
    const oldRel = prevById.get(it.id)?.relatedIds
    if (oldRel?.length && !(it.relatedIds ?? []).length) {
      changed = true
      return { ...it, relatedIds: oldRel }
    }
    return it
  })
  return changed ? JSON.stringify(next) : nextText
}

type StoredAttachment = { id: string; dataUrl: string }
type StoredItem = {
  id: string
  lane?: string
  sprintId?: string | null
  archivedAt?: number | null
  attachments?: StoredAttachment[]
}
type StoredState = { updatedAt?: number; items: StoredItem[]; [key: string]: unknown }

function parseState(text: string): StoredState {
  return JSON.parse(text) as StoredState
}

function stateForClient(state: StoredState): StoredState {
  return {
    ...state,
    items: state.items.map((item) => ({
      ...item,
      attachments: (item.attachments ?? []).map((attachment) => ({
        ...attachment,
        dataUrl: `/api/attachments/${encodeURIComponent(attachment.id)}`,
      })),
    })),
  }
}

function restoreAttachmentData(previous: StoredState, incoming: StoredState): StoredState {
  const stored = new Map<string, string>()
  for (const item of previous.items) {
    for (const attachment of item.attachments ?? []) stored.set(attachment.id, attachment.dataUrl)
  }
  return {
    ...incoming,
    items: incoming.items.map((item) => ({
      ...item,
      attachments: (item.attachments ?? []).map((attachment) => {
        if (!attachment.dataUrl.startsWith('/api/attachments/')) return attachment
        const dataUrl = stored.get(attachment.id)
        if (!dataUrl) throw new Error(`Missing attachment ${attachment.id}`)
        return { ...attachment, dataUrl }
      }),
    })),
  }
}

function nextVersion(previous: StoredState) {
  return Math.max(Date.now(), Number(previous.updatedAt ?? 0) + 1)
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function attachPersist(server: { middlewares: Connect.Server }) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  server.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (url.pathname.startsWith('/api/attachments/')) {
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.end('Method Not Allowed')
        return
      }
      const state = fs.existsSync(stateFile) ? parseState(fs.readFileSync(stateFile, 'utf8')) : null
      const id = decodeURIComponent(url.pathname.slice('/api/attachments/'.length))
      const attachment = state?.items
        .flatMap((item) => item.attachments ?? [])
        .find((candidate) => candidate.id === id)
      const match = attachment?.dataUrl.match(
        /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/,
      )
      if (!match) {
        res.statusCode = 404
        res.end('Attachment not found')
        return
      }
      res.setHeader('Content-Type', match[1])
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
      res.end(Buffer.from(match[2], 'base64'))
      return
    }

    const moveMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/move$/)
    if (moveMatch) {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end('Method Not Allowed')
        return
      }
      try {
        const input = JSON.parse(await readBody(req)) as {
          lane?: string
          sprintId?: string | null
        }
        const lanes = new Set(['inbox', 'backlog', 'todo', 'doing', 'done', 'archive'])
        if (!input.lane || !lanes.has(input.lane)) throw new Error('Invalid lane')
        const state = parseState(fs.readFileSync(stateFile, 'utf8'))
        const id = decodeURIComponent(moveMatch[1])
        if (!state.items.some((item) => item.id === id)) {
          sendJson(res, 404, { error: 'Task not found' })
          return
        }
        const updatedAt = nextVersion(state)
        const items = state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                lane: input.lane,
                sprintId: input.sprintId === undefined ? item.sprintId : input.sprintId,
                archivedAt: input.lane === 'archive' ? Date.now() : null,
              }
            : item,
        )
        writeAtomic(stateFile, JSON.stringify({ ...state, items, updatedAt }))
        sendJson(res, 200, { ok: true, updatedAt })
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : 'Invalid move' })
      }
      return
    }

    if (!url.pathname.startsWith('/api/state')) {
      next()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET') {
      if (!fs.existsSync(stateFile)) {
        res.end('null')
        return
      }
      res.end(JSON.stringify(stateForClient(parseState(fs.readFileSync(stateFile, 'utf8')))))
      return
    }

    if (req.method === 'PUT') {
      const body = await readBody(req)
      const prev = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : ''
      const previous = prev ? parseState(prev) : null
      const baseHeader = req.headers['x-funban-base-updated-at']
      const baseVersion = Number(Array.isArray(baseHeader) ? baseHeader[0] : baseHeader)
      if (
        previous &&
        baseHeader !== undefined &&
        Number.isFinite(baseVersion) &&
        baseVersion !== Number(previous.updatedAt)
      ) {
        sendJson(res, 409, { error: 'State changed', currentUpdatedAt: previous.updatedAt })
        return
      }
      const withLinks = prev ? preserveRelatedIds(prev, body) : body
      const incoming = parseState(withLinks)
      const restored = previous ? restoreAttachmentData(previous, incoming) : incoming
      const updatedAt = previous ? nextVersion(previous) : Number(incoming.updatedAt) || Date.now()
      writeAtomic(stateFile, JSON.stringify({ ...restored, updatedAt }))
      res.end(JSON.stringify({ ok: true, updatedAt }))
      return
    }

    next()
  })
}

export function persistPlugin(): Plugin {
  return {
    name: 'team-persist',
    configureServer(server) {
      attachPersist(server)
    },
    configurePreviewServer(server) {
      attachPersist(server)
    },
  }
}
