/**
 * Production host: `npm run build && npm start`
 * Tasks live in data/state.json (or FUNBAN_DATA). Redeploys of dist/ do not replace that file.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const dataPath = process.env.FUNBAN_DATA || process.env.WEEKBOARD_DATA
const stateFile = dataPath ? path.resolve(dataPath) : path.join(root, 'data', 'state.json')
const port = Number(process.env.PORT || 3000)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, body)
  fs.renameSync(tmp, file)
}

/** Stale tabs often PUT a board without relatedIds and wipe links. Keep old links unless the client sent any. */
function preserveRelatedIds(prevText, nextText) {
  let prev
  let next
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

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

function safeFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const file = path.normalize(path.join(dist, clean === '/' ? 'index.html' : clean))
  if (!file.startsWith(dist)) return null
  return file
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/'

  if (url.startsWith('/api/health')) {
    if (req.method !== 'GET') {
      send(res, 405, 'Method Not Allowed')
      return
    }
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8')
    return
  }

  if (url.startsWith('/api/state')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
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
    send(res, 405, 'Method Not Allowed')
    return
  }

  let file = safeFile(url)
  if (!file) {
    send(res, 400, 'Bad path')
    return
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html')
  }
  if (!fs.existsSync(file)) {
    send(res, 404, 'Build missing. Run npm run build.')
    return
  }
  const type = mime[path.extname(file)] || 'application/octet-stream'
  send(res, 200, fs.readFileSync(file), type)
})

fs.mkdirSync(path.dirname(stateFile), { recursive: true })
server.listen(port, '0.0.0.0', () => {
  console.log(`Funban on http://0.0.0.0:${port}`)
  console.log(`tasks: ${stateFile}`)
})
