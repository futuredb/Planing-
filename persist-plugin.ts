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
      writeAtomic(stateFile, body)
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
