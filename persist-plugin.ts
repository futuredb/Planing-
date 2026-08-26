import fs from 'node:fs'
import path from 'node:path'
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

function attachPersist(server: { middlewares: Connect.Server }) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  server.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith('/api/state')) {
      next()
      return
    }

    res.setHeader('Content-Type', 'application/json')

    if (req.method === 'GET') {
      if (!fs.existsSync(stateFile)) {
        res.end('null')
        return
      }
      res.end(fs.readFileSync(stateFile, 'utf8'))
      return
    }

    if (req.method === 'PUT') {
      const body = await readBody(req)
      const prev = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : ''
      writeAtomic(stateFile, prev ? preserveRelatedIds(prev, body) : body)
      res.end(JSON.stringify({ ok: true }))
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
