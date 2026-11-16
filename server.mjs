import { trendwatchEnabled } from './trendwatch-config.mjs'
import { committedActions } from './activity.mjs'
import {httpMiddleware,emit} from './futuredb-telemetry.mjs';
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
import { moveTask } from './state-operations.mjs'
import { decodeImageDataUrl, findAttachment, stateForClient } from './state-transport.mjs'
import { portalActor, portalRequired, portalLoginUrl, withActor } from './portal-auth.mjs'
import { createTrendwatchService } from './trendwatch-service.mjs'
import { createInboxClarifier } from './inbox-clarifier.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(root, 'dist')
const dataPath = process.env.FUNBAN_DATA || process.env.WEEKBOARD_DATA
const stateFile = dataPath ? path.resolve(dataPath) : path.join(root, 'data', 'state.json')
const port = Number(process.env.PORT || 3000)
const host = process.env.HOST || '0.0.0.0'
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
const repository = createStateRepository(stateFile, {
  onChange(previous, next) {
    for (const action of committedActions(previous, next)) {
      void emit('action', { action, outcome: 'success', route: '/api/state' })
    }
  },
})
const inboxClarifier = createInboxClarifier()
const trendwatch = createTrendwatchService({
  draftLauncher: inboxClarifier.launch, closeDraft: inboxClarifier.close,
  repository, directory: `${stateFile}.trendwatch`,
  mode: process.env.FUNBAN_TRENDWATCH_MODE || 'runtime',
  automatic: process.env.FUNBAN_TRENDWATCH_AUTO === '1',
  reviewIntervalMs: process.env.FUNBAN_TRENDWATCH_AUTO === '1' ? 60000 : 0,
  webSearch: process.env.FUNBAN_TRENDWATCH_WEB === '1',
  conceptReview: process.env.FUNBAN_TRENDWATCH_CONCEPTS === '1',
  enabled: trendwatchEnabled(),
  root: process.env.FUNBAN_TRENDWATCH_ROOT,
  envFile: process.env.FUNBAN_TRENDWATCH_ENV_FILE,
})
const mcpHandler = createFunbanMcpHandler({
  repository,
  publicUrl,
  timeZone: process.env.FUNBAN_TIME_ZONE || 'Europe/Moscow',
})
const handleMcp = toNodeHandler(mcpHandler, {
  onerror: (error) => console.error('MCP request failed:', error.message),
})
let stateResponseCache = { updatedAt: null, state: null }

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

function readBody(req, maxBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let received = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      received += chunk.length
      if (received > maxBytes) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Request body is too large')
        error.statusCode = 413
        reject(error)
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type })
  res.end(body)
}

function serializedState(state, actor) {
  const updatedAt = Number(state?.updatedAt) || 0
  if (!stateResponseCache.state || stateResponseCache.updatedAt !== updatedAt) {
    stateResponseCache = { updatedAt, state: stateForClient(state) }
  }
  return Buffer.from(JSON.stringify({ ...stateResponseCache.state,
    currentMemberId: actor?.id || state.members[0]?.id || '', actors: withActor(state.actors, actor),
  }))
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
  let clean
  try { clean = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const file = path.normalize(path.join(dist, clean === '/' ? 'index.html' : clean))
  if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) return null
  return file
}

async function handleRequest(req, res) {
  httpMiddleware()(req,res);
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

  if (new URL(url, 'http://127.0.0.1').pathname === '/api/health') {
    if (req.method !== 'GET') {
      send(res, 405, 'Method Not Allowed')
      return
    }
    await repository.read()
    send(res, 200, JSON.stringify({ ok: true }), 'application/json; charset=utf-8')
    return
  }

  let actor
  try { actor = await portalActor(req) } catch {
    send(res, 503, JSON.stringify({ error: 'Портал авторизации временно недоступен' }), 'application/json; charset=utf-8')
    return
  }
  if (portalRequired && !actor) {
    res.setHeader('Cache-Control', 'private, no-store')
    if (url.startsWith('/api/')) {
      send(res, 401, JSON.stringify({ error: 'Войдите в портал', loginUrl: portalLoginUrl }), 'application/json; charset=utf-8')
    } else {
      res.setHeader('Location', portalLoginUrl)
      send(res, 302, 'Войдите в портал')
    }
    return
  }
  if (actor) {
    res.setHeader('X-Funban-Actor-Id', actor.id)
    res.setHeader('X-Funban-Actor-Name', encodeURIComponent(actor.name))
  }
  res.setHeader('Cache-Control', 'private, no-store')

  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers.origin) {
    const origin = new URL(req.headers.origin)
    const requestHost = String(req.headers.host || '')
    if (origin.host !== requestHost && origin.origin !== new URL(publicUrl).origin) {
      send(res, 403, 'Недопустимый источник запроса')
      return
    }
  }

  if (url.startsWith('/api/attachments/')) {
    if (req.method !== 'GET') {
      send(res, 405, 'Method Not Allowed')
      return
    }
    try {
      const requestUrl = new URL(url, 'http://127.0.0.1')
      const id = decodeURIComponent(requestUrl.pathname.slice('/api/attachments/'.length))
      const attachment = findAttachment(await repository.read(), id)
      const decoded = attachment ? decodeImageDataUrl(attachment.dataUrl) : null
      if (!decoded) {
        send(res, 404, 'Attachment not found')
        return
      }
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Cache-Control', 'private, no-store')
      if (!decoded.inline) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name || 'file')}`)
      send(res, 200, decoded.body, decoded.mime)
    } catch {
      send(res, 400, 'Bad attachment id')
    }
    return
  }

  if(url==='/api/inbox/clarify'){
    if(!actor){send(res,401,JSON.stringify({error:'Войдите в портал'}),'application/json');return}
    if(req.method!=='POST'){send(res,405,'Method Not Allowed');return}
    const controller=new AbortController(),abort=()=>controller.abort()
    res.once('close',abort)
    try{
      const input=JSON.parse(await readBody(req,20*1024))
      const result=await trendwatch.clarifyDraft(input,actor,controller.signal)
      if(!res.destroyed)send(res,200,JSON.stringify(result),'application/json; charset=utf-8')
    }catch(error){
      if(!res.destroyed)send(res,error?.name==='ZodError'||error instanceof SyntaxError?422:503,JSON.stringify({question:null}),'application/json')
    }finally{res.removeListener('close',abort)}
    return
  }

  if(url==='/api/backlog/trendwatch'){
    if(!actor){send(res,401,JSON.stringify({error:'Войдите в портал'}),'application/json');return}
    try{
      let result
      if(req.method==='GET')result=await trendwatch.backlog()
      else if(req.method==='POST')result=await trendwatch.startBacklog(JSON.parse(await readBody(req,2048)),actor)
      else if(req.method==='DELETE')result=await trendwatch.cancelBacklog(JSON.parse(await readBody(req,2048)),actor)
      else{send(res,405,'Method Not Allowed');return}
      send(res,200,JSON.stringify(result),'application/json; charset=utf-8')
    }catch(error){const invalid=error?.name==='ZodError'||error instanceof SyntaxError;send(res,error.statusCode||(invalid?422:500),JSON.stringify({error:error.statusCode?error.message:invalid?'Проверьте данные задач':'Не удалось выполнить переоценку'}),'application/json; charset=utf-8')}
    return
  }

  const trendMatch = new URL(url, 'http://127.0.0.1').pathname.match(/^\/api\/items\/([^/]+)\/trendwatch(?:\/(confirm|report|packet|review|decision))?$/)
  if (trendMatch) {
    if (!actor) { send(res, 401, JSON.stringify({ error: 'Войдите в портал' }), 'application/json; charset=utf-8'); return }
    try {
      const itemId = decodeURIComponent(trendMatch[1]), action = trendMatch[2]
      let result
      if (req.method === 'GET' && !action) result = await trendwatch.get(itemId)
      else if (req.method === 'POST' && !action) result = await trendwatch.start(itemId, JSON.parse(await readBody(req, 20 * 1024)), actor)
      else if (req.method === 'POST' && action === 'decision') result = await trendwatch.decideReview(itemId, JSON.parse(await readBody(req, 2048)), actor)
      else if (req.method === 'POST' && action === 'confirm') result = await trendwatch.confirm(itemId, JSON.parse(await readBody(req, 20 * 1024)), actor)
      else if (req.method === 'POST' && action === 'review') result = await trendwatch.importReview(itemId, JSON.parse(await readBody(req, 64 * 1024)), actor)
      else if (req.method === 'GET' && action === 'packet') {
        const jobId = new URL(url, 'http://127.0.0.1').searchParams.get('jobId')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Disposition', 'attachment; filename="research-task.txt"')
        send(res, 200, await trendwatch.packet(itemId, jobId), 'text/plain; charset=utf-8'); return
      }
      else if (req.method === 'DELETE' && !action) {
        const input = JSON.parse(await readBody(req, 1024))
        result = await trendwatch.cancel(itemId, input.jobId)
      } else if (req.method === 'GET' && action === 'report') {
        const jobId = new URL(url, 'http://127.0.0.1').searchParams.get('jobId')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        send(res, 200, await trendwatch.report(itemId, jobId), 'text/plain; charset=utf-8'); return
      } else { send(res, 405, 'Method Not Allowed'); return }
      send(res, 200, JSON.stringify(result), 'application/json; charset=utf-8')
    } catch (error) {
      const invalid = error?.name === 'ZodError' || error instanceof SyntaxError
      send(res, Number(error?.statusCode) || (invalid ? 422 : 500), JSON.stringify({ error: invalid ? 'Проверьте заполнение полей исследования и оценки' : error?.statusCode ? error.message : 'Не удалось выполнить действие исследования. Задача сохранена.' }), 'application/json; charset=utf-8')
    }
    return
  }

  const moveMatch = new URL(url, 'http://127.0.0.1').pathname.match(/^\/api\/items\/([^/]+)\/move$/)
  if (moveMatch) {
    if (req.method !== 'POST') {
      send(res, 405, 'Method Not Allowed')
      return
    }
    try {
      const itemId = decodeURIComponent(moveMatch[1])
      const input = JSON.parse(await readBody(req, 8 * 1024))
      const result = await moveTask(repository, itemId, input)
      send(res, 200, JSON.stringify(result), 'application/json; charset=utf-8')
    } catch (error) {
      send(
        res,
        Number(error?.statusCode) || 400,
        JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid move' }),
        'application/json; charset=utf-8',
      )
    }
    return
  }

  if (url.startsWith('/api/state')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.method === 'GET') {
      const requestUrl = new URL(url, 'http://127.0.0.1')
      const since = requestUrl.searchParams.get('since')
      const state = since === null
        ? await repository.read()
        : await repository.readIfVersion(Number(since))
      if (!state) {
        if (since === null) res.end('null')
        else { res.writeHead(304); res.end() }
        return
      }
      res.end(serializedState(state, actor))
      return
    }
    if (req.method === 'PUT') {
      try {
        const body = await readBody(req)
        const baseHeader = req.headers['x-funban-base-updated-at']
        const parsedBase = Number(Array.isArray(baseHeader) ? baseHeader[0] : baseHeader)
        const baseVersion = Number.isFinite(parsedBase) ? parsedBase : 0
        const deleteHeader = req.headers['x-funban-deleted-roots']
        const deletedRoots = deleteHeader ? JSON.parse(String(deleteHeader)) : []
        if (!Array.isArray(deletedRoots) || deletedRoots.some((id) => typeof id !== 'string')) throw new Error('Некорректный список удалённых задач')
        const previous = await repository.read()
        const result = await repository.replace(body, baseVersion, deletedRoots, actor)
        // Task persistence succeeds independently of AI availability. No model is awaited here.
        try { await trendwatch.enqueueCreated(previous, result.state, actor) }
        catch { console.error('Automatic recommendation could not be queued; task saved, manual review available.') }
        res.end(
          JSON.stringify({
            ok: true,
            updatedAt: result.state.updatedAt,
            preservedIds: result.preservedIds,
            taskNumbers: Object.fromEntries(result.state.items.map((item) => [item.id, item.number])),
          }),
        )
      } catch (error) {
        send(
          res,
          Number(error?.statusCode) || 400,
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Invalid state',
            currentUpdatedAt: Number(error?.currentUpdatedAt) || undefined,
          }),
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
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error('Funban request failed:', error.message)
    if (!res.headersSent) send(res, 503, 'Сервис временно недоступен')
    else res.destroy()
  })
})

fs.mkdirSync(path.dirname(stateFile), { recursive: true })
server.listen(port, host, () => {
  console.log(`Funban on http://${host}:${port}`)
  console.log(`tasks: ${stateFile}`)
  console.log(`MCP: ${mcpToken ? '/mcp enabled' : 'disabled (set FUNBAN_MCP_TOKEN)'}`)
})

async function shutdown() {
  await trendwatch.close()
  await mcpHandler.close()
  server.close()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
