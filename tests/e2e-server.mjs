/** Test-only proxy. Every reset starts the actual production server with a fresh, isolated state file. */
import http from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startMockPortal } from './mock-portal.mjs'

const directory = await mkdtemp(path.join(os.tmpdir(), 'funban-e2e-'))
const dataFile = path.join(directory, 'state.json')
const port = Number(process.env.FUNBAN_TEST_PORT || 4174)
const serverPort = Number(process.env.FUNBAN_TEST_SERVER_PORT || 4175)
const target = `http://127.0.0.1:${serverPort}`
const controls = { failWrites: false, rejectWrites: false, freezePoll: false, delayWrite: 0, delayMove: 0, delayNextMove: 0 }
const events = []
const portal = await startMockPortal()
let portalSession = 'lily'
let child
async function start() {
  child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(serverPort), FUNBAN_DATA: dataFile, FUNBAN_PUBLIC_URL: `http://127.0.0.1:${port}/`, FUNBAN_PORTAL_IDENTITY_URL: portal.url, FUNBAN_MCP_TOKEN: process.env.FUNBAN_TEST_MCP_TOKEN || '', DASHBOARD_INGEST_URL: '', DASHBOARD_INGEST_TOKEN: '' },
    stdio: 'inherit',
  })
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${target}/api/health`)).ok) return } catch {}
    if (child.exitCode !== null) throw new Error('Production server exited')
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Production server did not start')
}
async function stop() {
  if (!child || child.exitCode !== null) return
  const current = child
  current.kill('SIGTERM')
  await new Promise((resolve) => current.once('exit', resolve))
}
await start()
const proxy = http.createServer(async (req, res) => {
  try {
    if (req.url === '/__test/preview' && process.env.FUNBAN_PREVIEW_ASSETS) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(await readFile(path.join(process.env.FUNBAN_PREVIEW_ASSETS, 'index.html')))
      return
    }
    if (req.url === '/__test/checks.js' && process.env.FUNBAN_PREVIEW_ASSETS) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' })
      res.end(await readFile(path.join(process.env.FUNBAN_PREVIEW_ASSETS, 'checks.js')))
      return
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    if (req.url === '/__test/portal' && req.method === 'POST') {
      const input = JSON.parse(body)
      if (Object.hasOwn(input, 'session')) portalSession = input.session
      if (Object.hasOwn(input, 'unavailable')) portal.controls.unavailable = Boolean(input.unavailable)
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return
    }
    if (req.url.startsWith('/__test/probe?')) {
      const query = new URL(req.url, target).searchParams
      const route = query.get('path') || '/'
      if (!route.startsWith('/') || route.startsWith('//')) throw new Error('Invalid probe path')
      const cookie = query.get('session')
      const response = await fetch(target + route, { redirect: 'manual',
        method: query.get('method') || 'GET',
        headers: { ...(cookie ? { Cookie: `funban_preview_session=${cookie}` } : {}),
          'X-Auth-User': 'spoofed@future-db.ru', 'X-Funban-Actor-Id': 'm2' },
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: response.status, location: response.headers.get('location'), body: await response.text() })); return
    }
    if (req.url === '/__test/control') {
      if (req.method === 'POST') Object.assign(controls, JSON.parse(body))
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ controls, events: events.slice(-100) }))
      return
    }
    if (req.url === '/__test/reset' && req.method === 'POST') {
      portalSession = 'lily'; portal.controls.unavailable = false
      await stop()
      await Promise.all([`${dataFile}.mcp.json`, `${dataFile}.audit.jsonl`].map((file) => rm(file, { force: true })))
      await writeFile(dataFile, body)
      await start()
      Object.assign(controls, { failWrites: false, rejectWrites: false, freezePoll: false, delayWrite: 0, delayMove: 0, delayNextMove: 0 })
      events.length = 0
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    if (req.url === '/futuredb-telemetry.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' })
      res.end('/* Analytics is disabled for isolated tests. */')
      return
    }
    const direct = req.url.startsWith('/__test/direct/')
    const route = direct ? req.url.slice('/__test/direct'.length) : req.url
    if (!direct && controls.freezePoll && req.method === 'GET' && route.startsWith('/api/state?') && !route.endsWith('=-1')) {
      res.writeHead(304); res.end(); return
    }
    if (!direct && controls.failWrites && (req.method === 'PUT' || req.method === 'POST') && route.startsWith('/api/')) {
      events.push({ method: req.method, route, status: 503 })
      res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"Test outage"}'); return
    }
    if (!direct && controls.rejectWrites && req.method === 'PUT' && route === '/api/state') {
      events.push({ method: req.method, route, status: 422 })
      res.writeHead(422, { 'Content-Type': 'application/json' }); res.end('{"error":"Тестовый отказ записи"}'); return
    }
    const isMove = req.method === 'POST' && route.endsWith('/move')
    const delay = !direct && (req.method === 'PUT' ? controls.delayWrite : isMove ? controls.delayNextMove || controls.delayMove : 0)
    if (!direct && isMove) controls.delayNextMove = 0
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    const headers = { ...req.headers }
    headers.cookie = `funban_preview_session=${portalSession || 'expired'}`
    delete headers.host
    delete headers.connection
    delete headers['content-length']
    delete headers['accept-encoding']
    const response = await fetch(`${target}${route}`, {
      method: req.method, headers, redirect: 'manual',
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    })
    if (route.startsWith('/api/')) events.push({ method: req.method, route, status: response.status })
    if (events.length > 300) events.shift()
    res.statusCode = response.status
    for (const [key, value] of response.headers) {
      if (!['transfer-encoding', 'content-length', 'content-encoding', 'connection'].includes(key)) res.setHeader(key, value)
    }
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'text/plain' })
    res.end(error.message)
  }
})
proxy.listen(port, '127.0.0.1', () => console.log(`Funban E2E proxy on http://127.0.0.1:${port}`))
async function shutdown() { proxy.close(); await stop(); await portal.close(); await rm(directory, { recursive: true, force: true }) }
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
