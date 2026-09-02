import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'

const sharedToken = 'test-shared-token'

function fixture() {
  return {
    updatedAt: 1_000,
    members: [
      { id: 'm1', name: 'Лиля', role: '', avatar: '' },
      { id: 'm2', name: 'Ваня', role: '', avatar: '' },
    ],
    currentMemberId: 'm1',
    roles: {},
    criteria: [
      {
        id: 'impact',
        name: 'Влияние',
        weight: 1,
        invert: false,
        hint: '',
        max: 5,
        step: 1,
      },
    ],
    sprints: [],
    items: [
      {
        id: 'existing-1',
        title: 'Проверить реквизиты',
        body: '',
        lane: 'backlog',
        sprintId: null,
        parentId: null,
        relatedIds: [],
        assigneeId: 'm2',
        authorId: 'm1',
        scores: {},
        attachments: [],
        stickers: [],
        createdAt: 900,
        archivedAt: null,
      },
    ],
    comments: [],
  }
}

async function freePort() {
  const socket = net.createServer()
  await new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const address = socket.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => socket.close(resolve))
  return port
}

async function waitForServer(url, processLogs) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}api/health`)
      if (response.ok) return
    } catch {
      // The child process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Funban did not start:\n${processLogs.join('')}`)
}

function jsonResult(result) {
  const text = result.content.find((entry) => entry.type === 'text')?.text
  assert.ok(text, 'tool should return JSON text')
  return JSON.parse(text)
}

test('MCP creates assigned linked tasks once and protects them from a stale tab', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'funban-mcp-'))
  const stateFile = path.join(tempDir, 'state.json')
  const initialState = fixture()
  fs.writeFileSync(stateFile, JSON.stringify(initialState))

  const port = await freePort()
  const rootUrl = `http://127.0.0.1:${port}/`
  const processLogs = []
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      FUNBAN_DATA: stateFile,
      FUNBAN_MCP_TOKEN: sharedToken,
      FUNBAN_PUBLIC_URL: rootUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => processLogs.push(chunk.toString()))
  child.stderr.on('data', (chunk) => processLogs.push(chunk.toString()))

  let client
  t.after(async () => {
    await client?.close()
    if (child.exitCode === null) child.kill('SIGTERM')
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve()
      else child.once('exit', resolve)
    })
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  await waitForServer(rootUrl, processLogs)

  const unauthorized = await fetch(`${rootUrl}mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  assert.equal(unauthorized.status, 401)
  assert.equal(unauthorized.headers.get('www-authenticate'), 'Bearer')

  client = new Client({ name: 'funban-integration-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${rootUrl}mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${sharedToken}` } },
  })
  await client.connect(transport)

  const tools = await client.listTools()
  assert.deepEqual(
    tools.tools.map((tool) => tool.name).sort(),
    ['create_task', 'get_context', 'link_tasks', 'search_tasks', 'update_task'],
  )

  const context = jsonResult(await client.callTool({ name: 'get_context', arguments: {} }))
  assert.deepEqual(context.members.map((member) => member.name), ['Лиля', 'Ваня'])
  assert.match(context.defaultAssigneeRule, /текущего чата/i)

  const request = {
    requestId: 'chat-request-001',
    title: 'Упростить новый онбординг',
    description: 'Описание сформировано из сообщения пользователя.',
    lane: 'todo',
    sprint: 'next',
    assigneeName: 'Лиля',
    relatedTaskIds: [],
    scores: { impact: 4 },
  }
  const first = jsonResult(
    await client.callTool({ name: 'create_task', arguments: request }),
  )
  assert.equal(first.task.assignee.name, 'Лиля')
  assert.equal(first.task.createdVia, 'agent')
  assert.equal(first.deduplicated, false)

  const repeated = jsonResult(
    await client.callTool({ name: 'create_task', arguments: request }),
  )
  assert.equal(repeated.task.id, first.task.id)
  assert.equal(repeated.deduplicated, true)

  const found = jsonResult(
    await client.callTool({
      name: 'search_tasks',
      arguments: { query: 'онбординг', limit: 10 },
    }),
  )
  assert.equal(found.length, 1)
  assert.equal(found[0].id, first.task.id)

  const linked = jsonResult(
    await client.callTool({
      name: 'link_tasks',
      arguments: {
        requestId: 'link-request-001',
        taskId: first.task.id,
        relatedTaskIds: ['existing-1'],
      },
    }),
  )
  assert.ok(linked.task.relatedTaskIds.includes('existing-1'))

  const updated = jsonResult(
    await client.callTool({
      name: 'update_task',
      arguments: {
        requestId: 'update-request-001',
        taskId: first.task.id,
        assigneeName: 'Ваня',
        lane: 'doing',
      },
    }),
  )
  assert.equal(updated.task.assignee.name, 'Ваня')
  assert.equal(updated.task.sprintId, first.task.sprintId)

  const storedAfterMcp = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  assert.equal(
    storedAfterMcp.items.filter((item) => item.id === first.task.id).length,
    1,
  )
  assert.equal(
    storedAfterMcp.items.find((item) => item.id === first.task.id).createdVia,
    'agent',
  )
  assert.ok(storedAfterMcp.items[0].relatedIds.includes('existing-1'))
  assert.ok(
    storedAfterMcp.items.find((item) => item.id === 'existing-1').relatedIds.includes(first.task.id),
  )

  const staleSave = await fetch(`${rootUrl}api/state`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Funban-Base-Updated-At': String(initialState.updatedAt),
    },
    body: JSON.stringify(initialState),
  })
  assert.equal(staleSave.status, 200)
  const staleSaveResult = await staleSave.json()
  assert.ok(staleSaveResult.preservedIds.includes(first.task.id))

  const storedAfterStaleSave = await fetch(`${rootUrl}api/state`).then((response) =>
    response.json(),
  )
  assert.ok(storedAfterStaleSave.items.some((item) => item.id === first.task.id))
  assert.ok(
    storedAfterStaleSave.sprints.some((sprint) => sprint.id === first.task.sprintId),
  )

  const legacyTabSave = await fetch(`${rootUrl}api/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initialState),
  })
  assert.equal(legacyTabSave.status, 200)
  const storedAfterLegacyTab = await fetch(`${rootUrl}api/state`).then((response) =>
    response.json(),
  )
  assert.ok(storedAfterLegacyTab.items.some((item) => item.id === first.task.id))
})
