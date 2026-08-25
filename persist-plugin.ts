import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const dataDir = path.resolve('data')
const stateFile = path.join(dataDir, 'state.json')

function readBody(req: NodeJS.ReadableStream) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function persistPlugin(): Plugin {
  return {
    name: 'team-persist',
    configureServer(server) {
      fs.mkdirSync(dataDir, { recursive: true })
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
          fs.writeFileSync(stateFile, body)
          res.end(JSON.stringify({ ok: true }))
          return
        }

        next()
      })
    },
  }
}
