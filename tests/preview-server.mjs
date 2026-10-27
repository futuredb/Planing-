/** Builds a browser-only regression panel; checks run only when clicked in Codex preview. */
import { build } from 'vite'
import { copyFile, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const assets = await mkdtemp(path.join(os.tmpdir(), 'funban-preview-assets-'))
await copyFile(new URL('./preview.html', import.meta.url), path.join(assets, 'index.html'))
await build({
  configFile: false,
  build: {
    outDir: assets, emptyOutDir: false,
    lib: { entry: fileURLToPath(new URL('./preview-checks.ts', import.meta.url)), formats: ['es'], fileName: () => 'checks.js' },
    minify: false,
  },
})
process.env.FUNBAN_PREVIEW_ASSETS = assets
process.env.FUNBAN_TEST_PORT ||= '4330'
process.env.FUNBAN_TEST_SERVER_PORT ||= '4331'
process.env.FUNBAN_TEST_MCP_TOKEN = 'preview-only-token'
await import('./e2e-server.mjs')
console.log(`Open http://127.0.0.1:${process.env.FUNBAN_TEST_PORT}/__test/preview in Codex preview.`)
