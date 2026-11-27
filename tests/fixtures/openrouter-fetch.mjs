/** Synthetic transport loaded ONLY by tests via --import. Never shipped in the image. */
const realFetch = globalThis.fetch
globalThis.fetch = async (url, options = {}) => {
  const target = new URL(url)
  if (target.hostname === '127.0.0.1') return realFetch(url, options)
  if (target.origin !== 'https://openrouter.ai') throw new Error('TEST_EXTERNAL_NETWORK_BLOCKED')
  if (target.pathname === '/api/v1/key') return Response.json({ data: { limit: 5, limit_remaining: 5 } })
  if (target.pathname !== '/api/v1/responses') throw new Error('TEST_UNEXPECTED_REQUEST')
  const payload = JSON.parse(options.body)
  let input = payload.input
  if (payload.text?.format?.name === 'funban_clarification') {
    const { body } = JSON.parse(input)
    return Response.json({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [
      { type: 'output_text', text: JSON.stringify({ question: body.includes('шаблоны презентаций') ? null : 'Какие именно цифровые дизайны планируем продавать?' }) },
    ] }] })
  }
  if(payload.text?.format?.name==='funban_route'){
    if(payload.tools.length)throw new Error('TEST_ROUTE_HAS_TOOLS')
    if(process.env.FUNBAN_TEST_OPENROUTER_FAILURE==='routing')return Response.json({status:'incomplete',output:[]})
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({assessmentKind:process.env.FUNBAN_TEST_OPENROUTER_FAILURE==='schema'?'approach_research':'internal_improvement'})}]}],usage:{input_tokens:20,output_tokens:20}})
  }
  if (process.env.FUNBAN_TEST_OPENROUTER_FAILURE === 'incomplete') return Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},private:'synthetic-secret',usage:{output_tokens:4096}})
  if (process.env.FUNBAN_TEST_OPENROUTER_FAILURE === 'json') return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'synthetic-secret'}]}],usage:{output_tokens:4740,output_tokens_details:{reasoning_tokens:4000}}})
  if(payload.tools.some(tool=>tool.type==='openrouter:web_search'))return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Синтетические материалы.'}]}],usage:{output_tokens:100,server_tool_use_details:{web_search_requests:1,tool_calls_executed:1}}})
  if(input.startsWith('{'))input=JSON.parse(input).taskPacket
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
  const schema=payload.text?.format?.schema
  if(!schema||schema.properties.sources.items.properties.relevance.enum.join(',')!=='direct,analogy')throw new Error('TEST_MISSING_STRICT_PRIORITY_SCHEMA')
  if(payload.tools.length)throw new Error('TEST_EVALUATION_HAS_TOOLS')
  if(process.env.FUNBAN_TEST_OPENROUTER_FAILURE==='schema'){
    const source={title:'Test',url:'https://example.com',signal:'Test',publishedAt:null,origin:'Test',relevance:'synthetic-secret',applicability:'Test',limitation:'Test','private-key':'synthetic-secret'}
    result.recommendation.assessmentKind='approach_research';result.searchOutcome='found';result.sources=[source,source,source]
  }
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{input_tokens:100,output_tokens:100}})
}
