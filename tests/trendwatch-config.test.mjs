import test from 'node:test'
import assert from 'node:assert/strict'
import { trendwatchEnabled } from '../trendwatch-config.mjs'

const config = { NODE_ENV: 'production', HOST: '0.0.0.0', FUNBAN_TRENDWATCH_ENABLED: '1',
  FUNBAN_TRENDWATCH_MODE: 'openrouter', OPENROUTER_API_KEY: 'synthetic-key', FUNBAN_OPENROUTER_MODEL: 'test/model' }

test('network listener requires explicit production OpenRouter opt-in and valid configuration', () => {
  assert.equal(trendwatchEnabled(config), false)
  const server = { ...config, FUNBAN_OPENROUTER_SERVER: '1' }
  assert.equal(trendwatchEnabled(server, 22), true)
  for (const patch of [{ NODE_ENV: 'development' }, { NODE_ENV: '' }, { OPENROUTER_API_KEY: '' },
    { FUNBAN_TRENDWATCH_ENABLED: '0' }, { FUNBAN_OPENROUTER_MODEL: '' }, { FUNBAN_OPENROUTER_MAX_KEY_LIMIT_USD: '21' }]) {
    assert.equal(trendwatchEnabled({ ...server, ...patch }), false)
  }
  for (const mode of ['codex', 'assisted', 'runtime', 'unknown']) {
    assert.equal(trendwatchEnabled({ ...server, FUNBAN_TRENDWATCH_MODE: mode, FUNBAN_TRENDWATCH_ROOT: '/test' }), false)
  }
})

test('loopback adapters preserve availability and legacy Node 24 requirement', () => {
  for (const HOST of ['127.0.0.1', '::1', 'localhost']) {
    for (const mode of ['codex', 'assisted', 'openrouter']) {
      assert.equal(trendwatchEnabled({ ...config, HOST, FUNBAN_TRENDWATCH_MODE: mode }, 22), true)
    }
    const runtime = { ...config, HOST, FUNBAN_TRENDWATCH_MODE: 'runtime', FUNBAN_TRENDWATCH_ROOT: '/test' }
    assert.equal(trendwatchEnabled(runtime, 22), false)
    assert.equal(trendwatchEnabled(runtime, 24), true)
  }
})
