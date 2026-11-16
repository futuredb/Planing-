import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { startMockPortal } from './mock-portal.mjs'

test('production OpenRouter: portal, Origin, review, confirmation and restart preserve separate scores', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'funban-server-ai-'))
  const portal = await startMockPortal()
  const socket = net.createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const base = `http://127.0.0.1:${port}`
  const item = { id: 'task', title: 'Автоматизировать сбор материалов', body: 'Подтверждённая экономия 2 часа в неделю с учётом проверки.',
    lane: 'backlog', sprintId: null, parentId: null, relatedIds: [], assigneeId: null, authorId: 'm1',
    priorityScore: 4, scores: {}, matrixBucket: 'automate', attachments: [], stickers: [], createdAt: 1, archivedAt: null }
  await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ updatedAt: 1, members: [{ id: 'm1', name: 'Тест', avatar: '', role: '' }],
    roles: {}, criteria: [], sprints: [], items: [item], comments: [] }))
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(FUNBAN_|OPENROUTER_|DASHBOARD_|NODE_OPTIONS)/.test(key)))
  Object.assign(env, { NODE_ENV: 'production', HOST: process.env.FUNBAN_TEST_BIND_HOST || '127.0.0.1', PORT: String(port),
    FUNBAN_DATA: path.join(dir, 'state.json'), FUNBAN_PUBLIC_URL: base, FUNBAN_PORTAL_IDENTITY_URL: portal.url,
    FUNBAN_TRENDWATCH_MODE: 'openrouter', FUNBAN_TRENDWATCH_ENABLED: '1', FUNBAN_OPENROUTER_SERVER: '1',
    FUNBAN_TRENDWATCH_AUTO: '0', FUNBAN_TRENDWATCH_WEB: '1', FUNBAN_TRENDWATCH_CONCEPTS: '1',
    OPENROUTER_API_KEY: 'synthetic-server-key', FUNBAN_OPENROUTER_MODEL: 'test/model',
    DASHBOARD_INGEST_URL: '', DASHBOARD_INGEST_TOKEN: '' })
  let child
  const stop = async () => {
    if (!child || child.exitCode !== null) return
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM'); await exited
  }
  t.after(async () => { await stop(); await portal.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const start = async () => {
    child = spawn(process.execPath, ['--import', './tests/fixtures/openrouter-fetch.mjs', 'server.mjs'], { env, stdio: 'pipe' })
    let logs = ''
    child.stdout.on('data', data => { logs += data }); child.stderr.on('data', data => { logs += data })
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, logs)
      try { if ((await fetch(`${base}/api/health`)).ok) return } catch { /* Startup only. */ }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`Server did not start: ${logs}`)
  }
  const request = (route, data, headers = {}) => fetch(base + route, { method: data ? 'POST' : 'GET',
    headers: { Cookie: 'funban_preview_session=lily', Origin: base, 'Content-Type': 'application/json', ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}) })
  const endpoint = '/api/items/task/trendwatch'
  const input = { requestId: crypto.randomUUID(), title: item.title, body: item.body }
  await start()
  for (const route of ['/api/state', endpoint, '/api/backlog/trendwatch']) {
    assert.equal((await fetch(base + route)).status, 401)
  }
  for (const route of [endpoint, endpoint + '/confirm', '/api/backlog/trendwatch']) {
    assert.equal((await request(route, input, { Cookie: '' })).status, 401)
    assert.equal((await request(route, input, { Origin: 'https://untrusted.invalid' })).status, 403)
  }
  portal.controls.unavailable = true
  assert.equal((await request(endpoint)).status, 503)
  portal.controls.unavailable = false
  const status = await (await request(endpoint)).json()
  assert.equal(status.available, true); assert.equal(status.mode, 'openrouter'); assert.equal(status.automatic, false)
  assert.equal(JSON.stringify(status).includes(env.OPENROUTER_API_KEY), false)
  assert.equal((await request(endpoint, input)).status, 200)
  let job
  for (let attempt = 0; attempt < 100; attempt++) {
    job = (await (await request(endpoint)).json()).job
    if (['ready', 'failed'].includes(job?.status)) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(job.status, 'ready', job.message)
  assert.equal(job.recommendation.score, 7); assert.equal(job.webUsage.queries, 0)
  assert.equal((await (await request('/api/state')).json()).items[0].priorityScore, 4)
  assert.equal((await request(endpoint + '/confirm', { requestId: crypto.randomUUID(), jobId: job.id, score: 8 })).status, 200)
  const saved = (await (await request('/api/state')).json()).items[0]
  assert.equal(saved.priorityScore, 8); assert.equal(saved.matrixBucket, 'automate')
  await stop(); await start()
  assert.equal((await (await request('/api/state')).json()).items[0].priorityScore, 8)
  assert.equal((await (await request(endpoint)).json()).job.recommendation.score, 7)
  // Runtime switch disables new launches without deleting the saved analysis.
  await stop(); env.FUNBAN_TRENDWATCH_ENABLED = '0'; await start()
  assert.equal((await (await request(endpoint)).json()).available, false)
  assert.equal((await request(endpoint, { ...input, requestId: crypto.randomUUID() })).status, 503)
  assert.equal((await (await request('/api/state')).json()).items[0].priorityScore, 8)
})
