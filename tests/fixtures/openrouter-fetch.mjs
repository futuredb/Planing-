/** Synthetic transport loaded ONLY by tests via --import. Never shipped in the image. */
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url)
  if (target.hostname === '127.0.0.1') return realFetch(url, options)
  if (target.origin !== 'https://openrouter.ai') throw new Error('TEST_EXTERNAL_NETWORK_BLOCKED')
  if (target.pathname === '/api/v1/key') return Response.json({ data: { limit: 5, limit_remaining: 5 } })
  if (target.pathname !== '/api/v1/responses') throw new Error('TEST_UNEXPECTED_REQUEST')
  const input = JSON.parse(options.body).input
  const marker = '## Шаблон ответа\n'
  const result = JSON.parse(input.slice(input.lastIndexOf(marker) + marker.length))
  Object.assign(result.recommendation, {
    score: 7, verdict: 'recommend', assessmentKind: 'internal_improvement', matrixBucket: 'automate',
    summary: 'Синтетическая проверка: 2 часа в неделю, около 8 часов за четыре недели.',
    rationale: 'Подтверждённая повторная экономия времени.', limitations: 'Стоимость внедрения неизвестна.',
    evidenceStrength: 'limited', decisionValue: 'Освободить время команды.',
    comparison: { status: 'insufficient', itemIds: [], reason: 'Нет сравнимых оценок.' },
    regionalApplicability: { status: 'unknown', summary: 'Внутренняя задача.', sourceUrls: [] }, relatedTasks: [],
  })
  result.searchOutcome = 'not_needed'; result.sources = []
  return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [
    { type: 'output_text', text: JSON.stringify(result), annotations: [] },
  ] }], usage: { input_tokens: 100, output_tokens: 100, server_tool_use_details: { web_search_requests: 0, tool_calls_executed: 0 } } })
}
