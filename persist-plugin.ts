import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { createStateRepository } from './state-repository.mjs'
import { moveTask } from './state-operations.mjs'
import { decodeImageDataUrl, findAttachment, stateForClient } from './state-transport.mjs'

const dataPath = process.env.FUNBAN_DATA || process.env.WEEKBOARD_DATA
const stateFile = dataPath ? path.resolve(dataPath) : path.resolve('data/state.json')
const repository = createStateRepository(stateFile)

function readBody(req: IncomingMessage, maxBytes = 32 * 1024 * 1024) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= maxBytes) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > maxBytes) {
        const error = Object.assign(new Error('Request body is too large'), { statusCode: 413 })
        reject(error)
      } else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

function attachPersist(server: { middlewares: Connect.Server }) {
  server.middlewares.use((req, res, next) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname.startsWith('/api/attachments/')) {
        if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        const id = decodeURIComponent(url.pathname.slice('/api/attachments/'.length))
        const attachment = findAttachment(await repository.read(), id)
        const decoded = attachment ? decodeImageDataUrl(attachment.dataUrl) : null
        if (!attachment || !decoded) { res.statusCode = 404; res.end('Attachment not found'); return }
        res.setHeader('Content-Type', decoded.mime)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
        if (!decoded.inline) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name || 'file')}`)
        res.end(decoded.body)
        return
      }
      const move = url.pathname.match(/^\/api\/items\/([^/]+)\/move$/)
      if (move) {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
        const input = JSON.parse(await readBody(req, 8 * 1024))
        sendJson(res, 200, await moveTask(repository, decodeURIComponent(move[1]), input))
        return
      }
      if (!url.pathname.startsWith('/api/state')) { next(); return }
      if (req.method === 'GET') {
        const since = url.searchParams.get('since')
        const state = since === null ? await repository.read() : await repository.readIfVersion(Number(since))
        if (!state && since !== null) { res.statusCode = 304; res.end(); return }
        sendJson(res, 200, stateForClient(state))
        return
      }
      if (req.method === 'PUT') {
        const header = req.headers['x-funban-base-updated-at']
        const parsed = Number(Array.isArray(header) ? header[0] : header)
        const deleteHeader = req.headers['x-funban-deleted-roots']
        const deletedRoots = deleteHeader ? JSON.parse(String(deleteHeader)) : []
        if (!Array.isArray(deletedRoots) || deletedRoots.some((id) => typeof id !== 'string')) throw new Error('Некорректный список удалённых задач')
        const result = await repository.replace(await readBody(req), Number.isFinite(parsed) ? parsed : 0, deletedRoots)
        sendJson(res, 200, { ok: true, updatedAt: result.state.updatedAt, preservedIds: result.preservedIds })
        return
      }
      res.statusCode = 405
      res.end('Method Not Allowed')
    })().catch((error: Error & { statusCode?: number; currentUpdatedAt?: number }) => {
      sendJson(res, error.statusCode || 400, { error: error.message, currentUpdatedAt: error.currentUpdatedAt })
    })
  })
}

export function persistPlugin(): Plugin {
  return {
    name: 'team-persist',
    configureServer(server) { attachPersist(server) },
    configurePreviewServer(server) { attachPersist(server) },
  }
}
