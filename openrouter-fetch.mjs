import { fetch as fetchWithDispatcher, ProxyAgent } from 'undici'

const openRouterOrigin = 'https://openrouter.ai'
const agents = new Map()

export function openRouterProxyUrl(env = process.env) {
  const value = env.OPENROUTER_PROXY_URL?.trim()
  if (!value) return null
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid OPENROUTER_PROXY_URL')
  }
  return url.href
}

export function fetchOpenRouter(input, init, env = process.env) {
  const url = new URL(input)
  if (url.origin !== openRouterOrigin || url.username || url.password) {
    throw new Error('Invalid OpenRouter destination')
  }
  const options = { ...init, redirect: 'error' }
  const proxy = openRouterProxyUrl(env)
  if (!proxy) return globalThis.fetch(url, options)

  let dispatcher = agents.get(proxy)
  if (!dispatcher) {
    dispatcher = new ProxyAgent(proxy)
    agents.set(proxy, dispatcher)
  }
  return fetchWithDispatcher(url, { ...options, dispatcher })
}
