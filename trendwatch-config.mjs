import { openRouterConfigurationMessage } from './trendwatch-openrouter.mjs'

// CLI/runtime adapters remain local. Only the HTTP OpenRouter adapter may be
// explicitly enabled on a production listener, protected by Team Portal.
export function trendwatchEnabled(env = process.env, nodeMajor = Number(process.versions.node.split('.')[0])) {
  if (env.FUNBAN_TRENDWATCH_ENABLED !== '1') return false
  const local = ['127.0.0.1', '::1', 'localhost'].includes(env.HOST || '0.0.0.0')
  const mode = env.FUNBAN_TRENDWATCH_MODE || 'runtime'
  if (mode === 'openrouter') {
    return (local || env.NODE_ENV === 'production' && env.FUNBAN_OPENROUTER_SERVER === '1') &&
      !openRouterConfigurationMessage(env)
  }
  if (!local) return false
  return ['assisted', 'codex'].includes(mode) || mode === 'runtime' && Boolean(env.FUNBAN_TRENDWATCH_ROOT) && nodeMajor >= 24
}
