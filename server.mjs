/**
 * Production host: `npm run build && npm start`
 * Tasks live in data/state.json (or FUNBAN_DATA). Redeploys of dist/ do not replace that file.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { hostHeaderValidation, originValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { createFunbanMcpHandler } from './funban-mcp.mjs'
import { createStateRepository } from './state-repository.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const dataPath = process.env.FUNBAN_DATA || process.env.WEEKBOARD_DATA
const stateFile = dataPath ? path.resolve(dataPath) : path.join(root, 'data', 'state.json')
const port = Number(process.env.PORT || 3000)
const publicUrl = process.env.FUNBAN_PUBLIC_URL || 'https://funban.future-db.ru/'
const mcpToken = process.env.FUNBAN_MCP_TOKEN || ''
const allowedMcpHostnames = [
  new URL(publicUrl).hostname,
  'localhost',
  '127.0.0.1',
  '[::1]',
  ...(process.env.FUNBAN_ALLOWED_HOSTS || '').split(',').map((host) => host.trim()),
].filter(Boolean)
const validateMcpHost = hostHeaderValidation([...new Set(allowedMcpHostnames)])
const validateMcpOrigin = originValidation([...new Set(allowedMcpHostnames)])
const repository = createStateRepository(stateFile)
const mcpHandler = createFunbanMcpHandler({
  repository,
  publicUrl,
  timeZone: process.env.FUNBAN_TIME_ZONE || 'Europe/Moscow',
})
const handleMcp = toNodeHandler(mcpHandler, {
  onerror: (error) => console.error('MCP request failed:', error.message),
})

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

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

function hasValidBearerToken(req) {
  const header = String(req.headers.authorization || '')
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return false
  const actual = Buffer.from(header.slice(prefix.length))
  const expected = Buffer.from(mcpToken)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function safeFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const file = path.normalize(path.join(dist, clean === '/' ? 'index.html' : clean))
  if (!file.startsWith(dist)) return null
  return file
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/'

  if (url === '/mcp' || url.startsWith('/mcp?')) {
    if (!validateMcpHost(req, res) || !validateMcpOrigin(req, res)) return
    if (!mcpToken) {
      send(
        res,
        503,
        JSON.stringify({ error: 'MCP is not configured' }),
        'application/json; charset=utf-8',
      )
      return
    }
    if (!hasValidBearerToken(req)) {
      res.setHeader('WWW-Authenticate', 'Bearer')
      send(res, 401, JSON.stringify({ error: 'Unauthorized' }), 'application/json; charset=utf-8')
      return
    }
    await handleMcp(req, res)
    return
  }

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
      const state = await repository.read()
      res.end(JSON.stringify(state))
      return
    }
    if (req.method === 'PUT') {
      try {
        const body = await readBody(req)
        const baseHeader = req.headers['x-funban-base-updated-at']
        const parsedBase = Number(Array.isArray(baseHeader) ? baseHeader[0] : baseHeader)
        const baseVersion = Number.isFinite(parsedBase) ? parsedBase : 0
        const result = await repository.replace(body, baseVersion)
        res.end(
          JSON.stringify({
            ok: true,
            updatedAt: result.state.updatedAt,
            preservedIds: result.preservedIds,
          }),
        )
      } catch (error) {
        send(
          res,
          400,
          JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid state' }),
          'application/json; charset=utf-8',
        )
      }
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
  console.log(`MCP: ${mcpToken ? '/mcp enabled' : 'disabled (set FUNBAN_MCP_TOKEN)'}`)
})

async function shutdown() {
  await mcpHandler.close()
  server.close()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
