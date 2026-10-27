import http from 'node:http'

// Synthetic identities only. This server is never packaged into production.
export async function startMockPortal() {
  const users = { lily: { id: 'preview-lily', name: 'Лиля' }, ivan: { id: 'preview-ivan', name: 'Ваня' } }
  const controls = { unavailable: false }
  const server = http.createServer((req, res) => {
    const token = /(?:^|;\s*)funban_preview_session=([^;]*)/.exec(req.headers.cookie || '')?.[1]
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    if (controls.unavailable) { res.writeHead(503); res.end('{}'); return }
    const user = Object.hasOwn(users, token) ? users[token] : null
    res.writeHead(user ? 200 : 401)
    res.end(JSON.stringify(user || { error: 'Unauthorized' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/api/access/identity`, controls,
    close: () => new Promise((resolve) => server.close(resolve)) }
}
