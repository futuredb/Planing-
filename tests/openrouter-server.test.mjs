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
    FUNBAN_TRENDWATCH_AUTO: '1', FUNBAN_TRENDWATCH_WEB: '1', FUNBAN_TRENDWATCH_CONCEPTS: '1',
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
  for (const route of [endpoint, endpoint + '/confirm', '/api/backlog/trendwatch', '/api/inbox/clarify']) {
    assert.equal((await request(route, input, { Cookie: '' })).status, 401)
    assert.equal((await request(route, input, { Origin: 'https://untrusted.invalid' })).status, 403)
  }
  portal.controls.unavailable = true
  assert.equal((await request(endpoint)).status, 503)
  assert.equal((await request('/api/inbox/clarify', input)).status, 503)
  portal.controls.unavailable = false
  const status = await (await request(endpoint)).json()
  assert.equal(status.available, true); assert.equal(status.mode, 'openrouter'); assert.equal(status.automatic, false) // Legacy AUTO=1 cannot start paid background work.
  assert.equal(JSON.stringify(status).includes(env.OPENROUTER_API_KEY), false)
  const draft = { title: 'Поисследовать продажи цифровых дизайнов', body: 'Хотим увеличить продажи.' }
  assert.deepEqual(await (await request('/api/inbox/clarify', draft)).json(), { question: null })
  assert.deepEqual(await (await request('/api/inbox/clarify', { ...draft, body: 'Это шаблоны презентаций' })).json(), { question: null })
  assert.equal((await request('/api/inbox/clarify', { ...draft, title: 'x' })).status, 422)
  assert.deepEqual(await (await request('/api/inbox/clarify', draft)).json(), { question: null })
  assert.deepEqual(await (await request('/api/inbox/clarify', draft)).json(), { question: null }) // Disabled even when the legacy automatic flag is set.
  assert.equal((await (await request('/api/state')).json()).items.length, 1) // Draft never creates a task.
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
  // Saving context does not launch analysis; a manual launch still receives the full text.
  const board = await (await request('/api/state')).json()
  const answeredBody = draft.body + '\n\nУточнение: Какие именно цифровые дизайны планируем продавать?\nОтвет: Шаблоны презентаций'
  const incoming = { ...item, id: 'answered', lane: 'inbox', title: draft.title, body: answeredBody, priorityScore: undefined }
  const put = await fetch(base + '/api/state', { method: 'PUT', headers: {
    Cookie: 'funban_preview_session=lily', Origin: base, 'Content-Type': 'application/json',
    'X-Funban-Base-Updated-At': String(board.updatedAt),
  }, body: JSON.stringify({ ...board, items: [...board.items, incoming] }) })
  assert.equal(put.status, 200, await put.text())
  assert.equal((await (await request('/api/items/answered/trendwatch')).json()).job, null)
  assert.equal((await request('/api/items/answered/trendwatch', { requestId: crypto.randomUUID(), title: incoming.title, body: answeredBody })).status, 200)
  let automaticJob
  for (let attempt = 0; attempt < 100; attempt++) {
    automaticJob = (await (await request('/api/items/answered/trendwatch')).json()).job
    if (['ready', 'failed'].includes(automaticJob?.status)) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(automaticJob?.status, 'ready', automaticJob?.message)
  assert.equal(automaticJob.automatic, false)
  assert.equal(automaticJob.snapshot.body, answeredBody)
  assert.equal((await (await request('/api/state')).json()).items.find(i => i.id === 'answered').priorityScore, undefined)
  await stop(); env.FUNBAN_TRENDWATCH_AUTO = '0'; await start()
  assert.deepEqual(await (await request('/api/inbox/clarify', draft)).json(), { question: null })
  // Error details survive HTTP serialization and restart; neither score is overwritten.
  await stop(); env.FUNBAN_TEST_OPENROUTER_FAILURE = 'incomplete'; await start()
  const beforeFailure = (await (await request('/api/state')).json()).items[0]
  assert.equal((await request(endpoint, { ...input, requestId: crypto.randomUUID() })).status, 200)
  let failed
  for (let attempt = 0; attempt < 100; attempt++) {
    failed = (await (await request(endpoint)).json()).job
    if (failed?.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failure.code, 'OPENROUTER_INCOMPLETE')
  assert.equal(failed.failure.incompleteReason, 'max_output_tokens')
  assert.equal(failed.failure.phase, 'response')
  assert.equal(JSON.stringify(failed).includes('synthetic-secret'), false)
  assert.deepEqual((await (await request('/api/state')).json()).items[0], beforeFailure)
  const archive = JSON.parse(await fs.readFile(path.join(dir, 'state.json.trendwatch', failed.id, 'job.json'), 'utf8'))
  assert.equal(archive.errorDiagnostics.incompleteReason, 'max_output_tokens')
  assert.equal(JSON.stringify(archive).includes('synthetic-secret'), false)
  await stop(); await start()
  assert.deepEqual((await (await request(endpoint)).json()).job.failure, failed.failure)
  await stop(); env.FUNBAN_TEST_OPENROUTER_FAILURE = 'json'; await start()
  assert.equal((await request(endpoint, { ...input, requestId: crypto.randomUUID() })).status, 200)
  for (let attempt = 0; attempt < 100; attempt++) {
    failed = (await (await request(endpoint)).json()).job
    if (failed?.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(failed.failure.code, 'OPENROUTER_JSON')
  assert.equal(failed.failure.parseIssue, 'non_json')
  assert.equal(failed.failure.answerBytes, 16)
  assert.equal(failed.failure.reasoningTokens, 4000)
  assert.equal(failed.failure.assistantMessages, 1)
  assert.equal(JSON.stringify(failed).includes('synthetic-secret'), false)
  assert.deepEqual((await (await request('/api/state')).json()).items[0], beforeFailure)
  const jsonArchive = JSON.parse(await fs.readFile(path.join(dir, 'state.json.trendwatch', failed.id, 'job.json'), 'utf8'))
  assert.equal(jsonArchive.errorDiagnostics.parseIssue, 'non_json')
  assert.equal(JSON.stringify(jsonArchive).includes('synthetic-secret'), false)
  await stop(); await start()
  assert.deepEqual((await (await request(endpoint)).json()).job.failure, failed.failure)
  await stop(); env.FUNBAN_TEST_OPENROUTER_FAILURE = 'schema'; await start()
  assert.equal((await request(endpoint, { ...input, requestId: crypto.randomUUID() })).status, 200)
  for (let attempt = 0; attempt < 100; attempt++) {
    failed = (await (await request(endpoint)).json()).job
    if (failed?.status === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(failed.failure.code, 'OPENROUTER_SCHEMA')
  assert.equal(failed.failure.answerFormat, 'function_call')
  assert.equal(failed.failure.schemaIssueCount, 6)
  assert.deepEqual(failed.failure.schemaIssues, [0,1,2].flatMap(i=>[
    {field:`sources.${i}.relevance`,code:'invalid_value'}, {field:`sources.${i}`,code:'unrecognized_keys'},
  ]))
  assert.equal(JSON.stringify(failed).includes('synthetic-secret'), false)
  assert.equal(JSON.stringify(failed).includes('private-key'), false)
  assert.deepEqual((await (await request('/api/state')).json()).items[0], beforeFailure)
  const schemaArchive = JSON.parse(await fs.readFile(path.join(dir, 'state.json.trendwatch', failed.id, 'job.json'), 'utf8'))
  assert.deepEqual(schemaArchive.errorDiagnostics.schemaIssues, failed.failure.schemaIssues)
  assert.equal(JSON.stringify(schemaArchive).includes('synthetic-secret'), false)
  await stop(); await start()
  assert.deepEqual((await (await request(endpoint)).json()).job.failure, failed.failure)
  // Runtime switch disables new launches without deleting the saved analysis.
  await stop(); env.FUNBAN_TRENDWATCH_ENABLED = '0'; await start()
  assert.equal((await (await request(endpoint)).json()).available, false)
  assert.deepEqual(await (await request('/api/inbox/clarify', draft)).json(), { question: null })
  assert.equal((await request(endpoint, { ...input, requestId: crypto.randomUUID() })).status, 503)
  assert.equal((await (await request('/api/state')).json()).items[0].priorityScore, 8)
})
