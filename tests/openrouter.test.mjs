import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchOpenRouter, openRouterConfig, safeOpenRouterDiagnostics } from '../trendwatch-openrouter.mjs'
import { quickHash, quickPacket, validateQuickReview } from '../trendwatch-quick.mjs'
import { fetchOpenRouter } from '../openrouter-fetch.mjs'
const env={OPENROUTER_API_KEY:'synthetic-secret',FUNBAN_OPENROUTER_MODEL:'test/model'}
const job={id:'11111111-1111-4111-8111-111111111111',format:'quick-v1',webSearch:true,createdAt:Date.now(),priorityPolicy:'concept-mvp-v1',evidencePolicy:'adaptive-signals-v4',snapshot:{title:'Автоматизировать сбор материалов',body:'Экономия 2 часа в неделю.',criteria:[]},boardContext:{total:0,items:[]},comparisonContext:{items:[]}}
job.packetHash=quickHash(job,[])
const review={jobId:job.id,packetHash:job.packetHash,recommendation:{assessmentKind:'internal_improvement',matrixBucket:'automate',summary:'Экономия 8 часов за четыре недели по данным задачи.',score:7,verdict:'recommend',decisionValue:'Освободить время для концепций.',comparison:{status:'insufficient',itemIds:[],reason:'Нет сравнимых оценок.'},rationale:'Подтверждённая повторная экономия времени.',limitations:'Не известны затраты внедрения.',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Внутренний инструмент.',sourceUrls:[]},relatedTasks:[]},searchOutcome:'not_needed',sources:[]}
test('research notes and strict evaluation use separate requests with one output budget',async t=>{
 const answer={...review,searchOutcome:'insufficient',recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 const x=fixture(t,{fetcher:async(url,{body})=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  const request=JSON.parse(body)
  if(request.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'approach_research'}))
  if(request.tools.some(tool=>tool.type==='openrouter:web_search')){
   const notes=response(null,[],2)
   notes.output[0].content[0].text='Поиск завершён. Прямых подтверждений нет. Это не JSON.'
   return Response.json(notes)
  }
  assert.deepEqual(request.tools,[])
  assert.equal(request.text.format.name,'funban_priority')
  assert.equal(request.text.format.strict,true)
  assert.match(request.input,/Прямых подтверждений нет/)
  return Response.json(response(answer))
 }})
 const r=await x.result
 assert.equal(r.type,'review')
 assert.equal(x.requests.length,4)
 const search=x.requests[2].body,final=x.requests[3].body
 assert.equal(search.tools.length,1)
 assert.equal(search.text,undefined)
 assert.ok(search.max_output_tokens<=8192-200-1024)
 assert.equal(200+200+final.max_output_tokens+2048,8192)
 assert.equal(r.usage.output_tokens,600)
})
test('route is fixed before analysis in inbox and backlog; tool access follows it',async t=>{
 for(const lane of ['inbox','backlog'])for(const kind of ['bug','internal_improvement','market_idea','approach_research']){
  const task={...job,snapshot:{...job.snapshot,lane},commentContext:{items:[{text:'Подтверждённая экономия 2 часа в неделю.'}]}}
  task.packetHash=quickHash(task,[])
  const research=['market_idea','approach_research'].includes(kind)
  const answer={...review,packetHash:task.packetHash,recommendation:{...review.recommendation,assessmentKind:kind},searchOutcome:research?'insufficient':'not_needed'}
  const x=fixture(t,{task,fetcher:async(url,options)=>{
   if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
   const body=JSON.parse(options.body)
   if(body.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:kind}))
   return Response.json(body.tools.length?response({notes:'Синтетические материалы.'},[],1):response(answer))
  }})
  const result=await x.result
  assert.equal(result.type,'review')
  assert.equal(x.requests.length,research?4:3)
  const route=x.requests[1].body,analysis=x.requests.at(-1).body
  // The same priority guidance must reach the provider for both lanes and
  // both research and no-search routes. Responses above are synthetic.
  assert.equal(research?JSON.parse(analysis.input).taskPacket:analysis.input,quickPacket(task,[]))
  for(const rule of ['Не требуй завершённого A/B-теста','Чужой эффект не является прогнозом нашего эффекта','Не назначай автоматический потолок балла','Общее «обе задачи полезны» не обосновывает равенство','Блокировка требует основания в task.body или task.comments','summary, verdict, rationale и score должны описывать одно решение','Для чаевых отделяй долю заказов с чаевыми'])assert.ok(analysis.input.includes(rule),rule)
  assert.equal(route.text.format.name,'funban_route');assert.deepEqual(route.tools,[])
  assert.match(route.input,/Подтверждённая экономия/)
  assert.deepEqual(analysis.tools,[])
  assert.equal(x.requests[2].body.tools.some(tool=>tool.type==='openrouter:web_search'),research)
  const schema=analysis.text.format.schema
  assert.equal(schema.properties.recommendation.properties.assessmentKind.const,kind)
  assert.equal((research?400:200)+analysis.max_output_tokens+2048,8192)
 }
})
function response(answer=review,annotations=[],count=0){return {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(answer),annotations}]}],usage:{input_tokens:100,output_tokens:200,server_tool_use_details:{web_search_requests:count,tool_calls_executed:count}}}}
test('research reserves evaluation budget; absent usage spends the allowance conservatively',async t=>{
 for(const budget of [512,4096,8192])for(const missing of [false,true]){
  const answer={...review,searchOutcome:'insufficient',recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
  const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_MAX_TOKENS:String(budget)},fetcher:async(url,{body})=>{
   if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
   const request=JSON.parse(body),route=request.text?.format?.name==='funban_route',search=request.tools.length>0
   const data=response(route?{assessmentKind:'approach_research'}:search?'Короткие заметки':answer,[],search?1:0)
   if(missing&&(route||search))delete data.usage.output_tokens
   else data.usage.output_tokens=10
   return Response.json(data)
  }})
  const result=await x.result
  assert.equal(result.type,'review')
  const [,route,search,final]=x.requests.map(r=>r.body)
  const routed=missing?route.max_output_tokens:10,researched=missing?search.max_output_tokens:10
  const reserve=Math.min(4096,Math.ceil((budget-routed)*2/3))
  assert.equal(search.max_output_tokens+reserve,budget-routed)
  const remaining=budget-routed-researched
  const correction=remaining>=3072?Math.min(2048,Math.floor(remaining/3)):0
  assert.equal(routed+researched+final.max_output_tokens+correction,budget)
  assert.ok(final.max_output_tokens+correction>=reserve)
  assert.equal(result.usage.output_tokens,missing?undefined:30)
  assert.equal(result.usage.server_tool_use_details.web_search_requests,1)
 }
})
test('invalid or unfinished research stops before evaluation without a retry',async t=>{
 const notes=response('Материалы',[],1)
 const variants=[
  [{...notes,status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},'OPENROUTER_INCOMPLETE'],
  [{...notes,output:[]},'OPENROUTER_RESPONSE'],
  [{...notes,output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]},'OPENROUTER_RESPONSE'],
  [response('x'.repeat(64001),[],1),'OPENROUTER_RESPONSE_SIZE'],
  [submitted(review,[],1),'OPENROUTER_RESPONSE'],
  ...[-1,9000].map(output_tokens=>[{...notes,usage:{...notes.usage,output_tokens}},'OPENROUTER_TOKEN_LIMIT']),
 ]
 for(const [searchAnswer,code] of variants){
  const x=fixture(t,{routeKind:'approach_research',searchAnswer}),result=await x.result
  assert.equal(result.type,'error');assert.equal(result.code,code)
  assert.equal(result.diagnostics.phase,'search');assert.equal(x.requests.length,3)
 }
})
test('evaluation cannot introduce new search or use its own citations as research provenance',async t=>{
 const source={title:'Тест',url:'https://example.com/new',signal:'Факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест',limitation:'Тест'}
 const answer={...review,searchOutcome:'found',sources:[source],recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 for(const searches of [0,1]){
  const x=fixture(t,{fetcher:async(url,{body})=>{
   if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
   const request=JSON.parse(body)
   if(request.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'approach_research'}))
   if(request.tools.length)return Response.json(response('Материалы без этой ссылки',[],1))
   return Response.json(response(answer,[{type:'url_citation',url:source.url}],searches))
  }})
  const result=await x.result
  assert.equal(result.code,searches?'OPENROUTER_SEARCH_LIMIT':'OPENROUTER_VALIDATION')
  if(!searches)assert.equal(result.diagnostics.validationCode,'UNKNOWN_WEB_SOURCE')
  assert.equal(x.requests.length,searches?4:5)
 }
})
test('cancelling research prevents evaluation even when transport returns late',async t=>{
 let release,started
 const ready=new Promise(resolve=>{started=resolve})
 const x=fixture(t,{fetcher:async(url,{body})=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  if(JSON.parse(body).text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'approach_research'}))
  started();await new Promise(resolve=>{release=resolve})
  return Response.json(response('Материалы',[],1))
 }})
 const messages=[];x.child.on('message',m=>messages.push(m))
 await ready
 const closed=once(x.child,'close');x.child.kill();release();await closed
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(x.requests.length,3)
 assert.equal(messages.some(m=>m.type==='review'||m.type==='error'),false)
})
test('all stages share one abort signal and deadline; late search and evaluation cannot succeed',async t=>{
 for(const phase of ['search','generation']){
  const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_TIMEOUT_MS:'1000'},fetcher:async(url,{body,signal})=>{
   if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
   const request=JSON.parse(body)
   if(request.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'approach_research'}))
   if(phase==='search'||!request.tools.length)await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}))
   return Response.json(response('Поздний ответ',[],request.tools.length?1:0))
  }})
  const result=await x.result
  assert.equal(result.code,'OPENROUTER_TIMEOUT');assert.equal(result.diagnostics.phase,phase)
  assert.equal(x.requests.length,phase==='search'?3:4)
  assert.equal(new Set(x.requests.map(r=>r.options.signal)).size,1)
 }
})
function submitted(answer=review,annotations=[],count=0){
 const data=response(answer,annotations,count)
 data.output[0].content[0].text='Источники проверены.'
 data.output.push({type:'function_call',name:'submit_priority',call_id:'test-call',status:'completed',arguments:JSON.stringify(answer)})
 return data
}
function fixture(t,{answer=response(),key={limit:5,limit_remaining:5},config=env,fetcher,task=job,routeKind,routeAnswer,searchAnswer}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openrouter-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify(task));fs.writeFileSync(path.join(dir,'materials.json'),JSON.stringify({sources:[]}))
 const requests=[]
 const child=launchOpenRouter(dir,{env:config,fetchImpl:async(url,options)=>{
  requests.push({url,options,body:options.body?JSON.parse(options.body):null})
  if(fetcher)return fetcher(url,options)
  if(requests.at(-1).body?.text?.format?.name==='funban_route'){
   let kind=routeKind
   try{const last=answer.output.at(-1);kind??=JSON.parse(last.arguments??last.content[0].text).recommendation?.assessmentKind}catch{}
   return Response.json(routeAnswer??response({assessmentKind:kind??'internal_improvement'}))
  }
  if(url.endsWith('/key'))return Response.json({data:key})
  if(requests.at(-1).body?.tools?.some(tool=>tool.type==='openrouter:web_search')){
   const notes=structuredClone(answer)
   notes.output=notes.output.filter(item=>item.type!=='function_call')
   for(const item of notes.output)if(item.type==='message')for(const part of item.content??[])if(part.type==='output_text')part.text='Синтетические материалы исследования.'
   return Response.json(searchAnswer??notes)
  }
  // Evidence belongs to the search response; final evaluation cannot search.
  if(requests.some(r=>r.body?.tools?.some(tool=>tool.type==='openrouter:web_search'))){
   const final=structuredClone(answer)
   final.output=final.output.filter(item=>item.type!=='openrouter:web_search'&&item.type!=='untrusted_tool')
   if(final.usage)final.usage.server_tool_use_details={web_search_requests:0,tool_calls_executed:0}
   return Response.json(final)
  }
  return Response.json(answer)
 }})
 const result=new Promise(resolve=>child.on('message',m=>{if(['review','error'].includes(m.type))resolve(m)}))
 return {child,result,requests}
}
test('internal review: bounded request, no observed searches, credentials only in server headers',async t=>{
 const x=fixture(t),result=await x.result
 assert.equal(result.type,'review');assert.equal(result.review.recommendation.score,7)
 assert.deepEqual(result.web,{calls:0,queries:0,urls:[]})
 assert.equal(x.requests.length,3)
 const request=x.requests[2]
 assert.equal(request.url,'https://openrouter.ai/api/v1/responses')
 assert.equal(request.options.redirect,'error');assert.equal(request.body.store,false)
 assert.equal(request.body.max_output_tokens,7992-2048)
 assert.equal(request.body.stop_server_tools_when,undefined)
 assert.deepEqual(request.body.tools,[])
 assert.equal(request.body.text.format.schema.properties.recommendation.properties.assessmentKind.const,'internal_improvement')
 assert.equal(request.body.text.format.schema.properties.searchOutcome.const,'not_needed')
 assert.equal(request.body.text.format.schema.properties.sources.maxItems,0)
 assert.equal(JSON.stringify(request.body).includes(env.OPENROUTER_API_KEY),false)
 assert.equal(JSON.stringify(result).includes(env.OPENROUTER_API_KEY),false)
 assert.equal(result.usage.output_tokens,400) // Routing + analysis, not just the last response.
})
test('invalid routing stops before analysis, without paid retries or guessing',async t=>{
 for(const routeAnswer of [response({assessmentKind:'unknown'}),response({assessmentKind:'bug',extra:'secret'}),
  {...response({assessmentKind:'bug'}),status:'incomplete'},response({assessmentKind:'bug'},[],1),
  {...response({assessmentKind:'bug'}),usage:{output_tokens:99999}},
  submitted({assessmentKind:'bug'}),
 ]){
  const x=fixture(t,{routeAnswer}),r=await x.result
  assert.equal(r.code,'OPENROUTER_ROUTING');assert.equal(r.diagnostics.phase,'routing')
  assert.equal(x.requests.length,2)
  assert.equal(JSON.stringify(r).includes('secret'),false)
 }
})
test('analysis cannot change the selected kind or skip research after a research route',async t=>{
 for(const [kind,answer] of [
  ['bug',response(review)],
  ['approach_research',response(review)],
  ['market_idea',response({...review,recommendation:{...review.recommendation,assessmentKind:'market_idea'}})],
 ]){
  const r=await fixture(t,{routeKind:kind,answer}).result
  assert.equal(r.code,'OPENROUTER_SCHEMA')
  assert.equal(r.diagnostics.selectedKind,kind)
 }
 const research={...review,recommendation:{...review.recommendation,assessmentKind:'approach_research'},searchOutcome:'insufficient'}
 const r=await fixture(t,{routeKind:'approach_research',answer:response(research)}).result
 assert.equal(r.code,'OPENROUTER_VALIDATION') // A research label cannot invent an actual search.
})
test('explicit token limits are preserved; routing leaves the remainder for analysis',async t=>{
 assert.equal(openRouterConfig(env).maxTokens,8192)
 for(const maxTokens of [4096,8192]){
  const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_MAX_TOKENS:String(maxTokens)}})
  assert.equal((await x.result).type,'review')
  assert.equal(x.requests[1].body.max_output_tokens,1024)
  assert.equal(x.requests[2].body.max_output_tokens,maxTokens-200-Math.min(2048,Math.floor((maxTokens-200)/3)))
  assert.equal(x.requests.length,3) // Budget check, routing, analysis; no paid retry.
 }
})
test('unknown routing usage reserves its full allowance; small budgets remain bounded',async t=>{
 for(const maxTokens of [512,4096,8192]){
  const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_MAX_TOKENS:String(maxTokens)},routeAnswer:{...response({assessmentKind:'internal_improvement'}),usage:{}}})
  assert.equal((await x.result).type,'review')
  const remaining=maxTokens-x.requests[1].body.max_output_tokens
  assert.equal(x.requests[1].body.max_output_tokens+x.requests[2].body.max_output_tokens+(remaining>=3072?Math.min(2048,Math.floor(remaining/3)):0),maxTokens)
 }
})
test('cancelling routing prevents analysis even if the transport returns afterwards',async t=>{
 let release,started
 const ready=new Promise(resolve=>{started=resolve})
 const x=fixture(t,{fetcher:async(url)=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  started();await new Promise(resolve=>{release=resolve})
  return Response.json(response({assessmentKind:'internal_improvement'}))
 }})
 const messages=[];x.child.on('message',m=>messages.push(m))
 await ready
 const closed=new Promise(resolve=>x.child.once('close',resolve));x.child.kill();release();await closed
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(x.requests.length,2);assert.deepEqual(messages,[])
})
test('routing and analysis share one timeout, with no analysis request after expiration',async t=>{
 const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_TIMEOUT_MS:'1000'},fetcher:async(url,{signal})=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('synthetic timeout')),{once:true}))
 }})
 const r=await x.result
 assert.equal(r.code,'OPENROUTER_TIMEOUT');assert.equal(r.diagnostics.phase,'routing')
 assert.equal(x.requests.length,2)
})
test('disabled global search cannot be enabled by a research route',async t=>{
 const task={...job,webSearch:false};task.packetHash=quickHash(task,[])
 const {searchOutcome:_,sources:__,...plain}=review
 const answer={...plain,packetHash:task.packetHash,recommendation:{...plain.recommendation,assessmentKind:'approach_research'}}
 const x=fixture(t,{task,routeKind:'approach_research',answer:response(answer)})
 assert.equal((await x.result).type,'review')
 assert.deepEqual(x.requests[2].body.tools,[])
 assert.equal(x.requests[2].body.text.format.schema.properties.recommendation.properties.assessmentKind.const,'approach_research')
})
test('market research uses provider citations; invented URLs and missing usage are rejected',async t=>{
 const source={title:'Синтетический источник',url:'https://example.com/market',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест рынка',limitation:'Синтетический тест'}
 const market={...review,recommendation:{...review.recommendation,assessmentKind:'approach_research'},searchOutcome:'found',sources:[source]}
 for(const [annotations,count,ok]of [[[{type:'url_citation',url:source.url}],2,true],[[],2,false],[[{type:'url_citation',url:source.url}],0,false],[[{type:'url_citation',url:source.url}],4,false]]){
  const x=fixture(t,{answer:response(market,annotations,count)}),r=await x.result
  assert.equal(r.type,ok?'review':'error')
 }
})
test('internal review with a search is rejected, not silently accepted',async t=>{
 assert.equal((await fixture(t,{answer:response(review,[],1)}).result).type,'error')
})
test('search result URLs establish provenance without assistant citations, for strict evaluation',async t=>{
 const source={title:'Тест',url:'https://example.com/research',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест',limitation:'Тест'}
 const answer={...review,searchOutcome:'found',sources:[source],recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 // Official Responses SDK: outputwebsearchservertoolitem.action.sources.
 const search={type:'openrouter:web_search',status:'completed',action:{type:'search',query:'synthetic query',sources:[{type:'url',url:source.url+'#result'}]}}
 for(const format of [response]){
  const data=format(answer,[],3);data.output.unshift(search)
  const x=fixture(t,{answer:data}),result=await x.result
  assert.equal(result.type,'review')
  assert.deepEqual(result.web,{calls:3,queries:3,urls:[source.url]})
  assert.equal(x.requests.length,4) // No extra search, model or repair request.
 }
})
test('source provenance rejects unverified envelopes, fabricated pages and duplicate sources after one bounded correction',async t=>{
 const source={title:'Тест',url:'https://example.com/research',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест',limitation:'Тест'}
 const answer={...review,searchOutcome:'found',sources:[source],recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 const search={type:'openrouter:web_search',status:'completed',action:{type:'search',query:'synthetic query',sources:[{type:'url',url:source.url}]}}
 const variants=[
  {...search,status:'failed'}, {...search,status:'in_progress'}, {...search,status:undefined}, {...search,error:'private provider error'},
  {...search,type:'untrusted_tool'}, {...search,action:{...search.action,type:'unknown'}},
  {...search,action:{...search.action,sources:[],query:source.url}},
  {...search,action:{...search.action,sources:[{type:'text',url:source.url}]}},
  {...search,action:{...search.action,sources:[{type:'url',url:source.url+'?other=1'}]}},
  {...search,action:{...search.action,sources:[{type:'url',url:source.url+'/other'}]}},
  {...search,action:{...search.action,sources:[{type:'url',url:'http://localhost/private'}]}},
 ]
 for(const item of variants){
  const data=response(answer,[],1);data.output.unshift(item)
  const x=fixture(t,{answer:data}),r=await x.result
  assert.equal(r.diagnostics.validationCode,'UNKNOWN_WEB_SOURCE')
  assert.deepEqual(r.diagnostics.sourceIssues,[{index:1,reason:'not_in_search_results'}])
  assert.equal(x.requests.length,5)
  assert.equal(JSON.stringify(r).includes('https://'),false)
  assert.equal(JSON.stringify(r).includes('private'),false)
 }
 const duplicate={...answer,sources:[source,{...source,url:source.url+'#duplicate'}]}
 const data=response(duplicate,[{type:'url_citation',url:source.url}],1);data.output.unshift(search)
 const x=fixture(t,{answer:data}),r=await x.result
 assert.equal(r.diagnostics.validationCode,'UNKNOWN_WEB_SOURCE')
 assert.deepEqual(r.diagnostics.sourceIssues,[{index:2,reason:'duplicate_source'}])
 assert.equal(r.diagnostics.citationUrlCount,1);assert.equal(r.diagnostics.searchResultUrlCount,1);assert.equal(r.diagnostics.verifiedUrlCount,1)
 assert.equal(x.requests.length,5)
 const clean=safeOpenRouterDiagnostics({sourceIssues:[null,{index:1,reason:'not_in_search_results',url:'private'}, {index:-1,reason:'duplicate_source'}, {index:2,reason:'private'}],searchResultUrlCount:NaN,citationUrlCount:-1,verifiedUrlCount:1})
 assert.deepEqual(clean,{verifiedUrlCount:1,sourceIssues:[{index:1,reason:'not_in_search_results'}]})
 assert.equal(safeOpenRouterDiagnostics({sourceIssues:Array.from({length:20},()=>({index:1,reason:'duplicate_source'}))}).sourceIssues.length,10)
})
test('regional evidence is selected on sources and decoded without a second URL list',async t=>{
 const source={title:'Синтетический источник',url:'https://example.com/region',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест РФ',limitation:'Синтетический тест',regionalEvidence:true}
 const answer={...review,searchOutcome:'found',sources:[source],recommendation:{...review.recommendation,assessmentKind:'approach_research',regionalApplicability:{status:'supported',summary:'Синтетическое основание.'}}}
 const annotations=[{type:'url_citation',url:source.url}]
 const x=fixture(t,{answer:response(answer,annotations,2)}),r=await x.result
 assert.equal(r.type,'review')
 assert.deepEqual(r.review.recommendation.regionalApplicability.sourceUrls,[source.url])
 assert.equal(r.review.sources[0].regionalEvidence,undefined)
 assert.equal(r.review.recommendation.score,7)
 assert.equal(r.review.recommendation.rationale,answer.recommendation.rationale)
 const schema=x.requests.at(-1).body.text.format.schema
 assert.equal(schema.properties.recommendation.properties.regionalApplicability.properties.sourceUrls,undefined)
 assert.equal(schema.properties.sources.items.properties.regionalEvidence.type,'boolean')
 assert.ok(schema.properties.sources.items.required.includes('regionalEvidence'))
 assert.equal(x.requests.length,4)
 const several={...answer,sources:[{...source,url:'https://example.com/global',regionalEvidence:false},source]}
 const selected=await fixture(t,{answer:response(several,[...annotations,{type:'url_citation',url:'https://example.com/global'}],2)}).result
 assert.equal(selected.type,'review')
 assert.deepEqual(selected.review.recommendation.regionalApplicability.sourceUrls,[source.url])
 for(const marker of [undefined,'true',false]){
  const bad={...answer,sources:[{...source,regionalEvidence:marker}]}
  const error=await fixture(t,{answer:response(bad,annotations,2)}).result
  assert.equal(error.code,marker===false?'OPENROUTER_VALIDATION':'OPENROUTER_SCHEMA')
  if(marker===false)assert.deepEqual(error.diagnostics.regionalIssues,['supported_without_source'])
 }
 const invented=await fixture(t,{answer:response(answer,[],2)}).result
 assert.equal(invented.diagnostics.validationCode,'UNKNOWN_WEB_SOURCE')
 const mixed={...answer,recommendation:{...answer.recommendation,regionalApplicability:{...answer.recommendation.regionalApplicability,sourceUrls:[source.url]}}}
 assert.equal((await fixture(t,{answer:response(mixed,annotations,2)}).result).code,'OPENROUTER_SCHEMA')
 const internal={...review,recommendation:{...review.recommendation,regionalApplicability:{status:'unknown',summary:'Внутренний инструмент.'}}}
 assert.equal((await fixture(t,{answer:response(internal)}).result).type,'review')
})
test('regional evidence uses provider page identity without accepting fabricated sources',async t=>{
 const source={title:'Синтетический источник',url:'https://example.com/region',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест РФ',limitation:'Синтетический тест'}
 const make=(sourceUrls,status='conditional')=>({...review,searchOutcome:'found',sources:[source],recommendation:{...review.recommendation,assessmentKind:'approach_research',regionalApplicability:{status,summary:'Синтетическое основание.',sourceUrls}}})
 const annotations=[{type:'url_citation',url:source.url+'#provider-fragment'}]
 for(const output of [response]){
  const answer=make(['https://EXAMPLE.com:443/region#regional-fragment'])
  const x=fixture(t,{answer:output(answer,annotations,3)}),r=await x.result
  assert.equal(r.type,'review')
  assert.equal(r.review.recommendation.score,7)
  assert.equal(x.requests.length,4) // Budget, routing, search, evaluation; no repair call.
  // Service validation returns the normalized evidence; adapter keeps the raw
  // response until that validation and never edits the saved task score.
  for(const [urls,status,issue] of [
   [[], 'supported', 'supported_without_source'],
   [['https://example.com/not-listed'], 'conditional', 'source_not_listed'],
   [['https://example.com/region?different=1'], 'conditional', 'source_not_listed'],
  ]){
   const bad=fixture(t,{answer:output(make(urls,status),annotations,3)}),error=await bad.result
   assert.equal(error.code,'OPENROUTER_VALIDATION')
   assert.equal(error.diagnostics.validationCode,'INVALID_REGIONAL_EVIDENCE')
   assert.deepEqual(error.diagnostics.regionalIssues,[issue])
   assert.equal(JSON.stringify(error).includes('https://'),false)
   assert.equal(bad.requests.length,5)
  }
  const fabricated=await fixture(t,{answer:output(make([source.url]),[],3)}).result
  assert.equal(fabricated.diagnostics.validationCode,'UNKNOWN_WEB_SOURCE')
 }
 assert.deepEqual(safeOpenRouterDiagnostics({regionalIssues:['private-url','source_not_listed','source_not_listed','supported_without_source']}),{regionalIssues:['source_not_listed','supported_without_source']})
})
test('locked internal route rejects actual search, incompatible outcome and supplied sources',async t=>{
 const source={title:'Тест',url:'https://example.com/public',signal:'Тест',publishedAt:null,origin:'Example',relevance:'analogy',applicability:'Тест',limitation:'Тест'}
 for(const [answer,code]of [
  [response(review,[],1),'OPENROUTER_SEARCH_LIMIT'],
  [response({...review,searchOutcome:'insufficient'}),'OPENROUTER_SCHEMA'],
  [response({...review,sources:[source]}),'OPENROUTER_SCHEMA'],
 ]){
  const x=fixture(t,{answer}),r=await x.result
  assert.equal(r.code,code)
  assert.equal(r.diagnostics.selectedKind,'internal_improvement')
  assert.equal(x.requests.length,code==='OPENROUTER_SEARCH_LIMIT'?3:4)
  assert.equal(JSON.stringify(r).includes(source.url),false)
 }
 assert.deepEqual(safeOpenRouterDiagnostics({assessmentKind:'secret',searchOutcome:'secret',webCalls:-1,webQueries:NaN,sourceCount:Infinity,routingIssues:['secret']}),{routingIssues:[]})
})
test('missing configuration makes no requests; unlimited/exhausted keys make no generation',async t=>{
 const missing=fixture(t,{config:{}});assert.equal((await missing.result).code,'OPENROUTER_CONFIG');assert.equal(missing.requests.length,0)
 for(const key of [{limit:null,limit_remaining:10},{limit:6,limit_remaining:6},{limit:5,limit_remaining:0}]){
  const x=fixture(t,{key});assert.equal((await x.result).code,'OPENROUTER_BUDGET');assert.equal(x.requests.length,1)
 }
 for(const patch of [{FUNBAN_OPENROUTER_MODEL:'openrouter/auto'},{FUNBAN_OPENROUTER_MODEL:'test/model:online'},{FUNBAN_OPENROUTER_MAX_TOKENS:'999999'}])assert.throws(()=>openRouterConfig({...env,...patch}))
})
test('HTTP errors are sanitized and never retried',async t=>{
 for(const [status,code]of [[401,'OPENROUTER_AUTH'],[402,'OPENROUTER_CREDITS'],[429,'OPENROUTER_RATE_LIMIT'],[500,'OPENROUTER_UNAVAILABLE']]){
  const x=fixture(t,{fetcher:async()=>new Response('private provider detail synthetic-secret',{status})})
  const r=await x.result;assert.equal(r.code,code);assert.equal(r.diagnostics.httpStatus,status);assert.equal(r.diagnostics.phase,'budget');assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);assert.equal(x.requests.length,1)
 }
})
test('configured proxy receives OpenRouter CONNECT; rejection does not fall back to direct HTTPS', async t => {
  const proxy = createServer()
  t.after(() => new Promise(resolve => proxy.close(resolve)))
  const requests = []
  proxy.on('connect', (request, socket) => {
    requests.push({ authority: request.url, authorization: request.headers.authorization })
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const config = { ...env, OPENROUTER_PROXY_URL: `http://127.0.0.1:${proxy.address().port}` }
  const originalFetch = globalThis.fetch
  let directRequests = 0
  globalThis.fetch = () => { directRequests++; throw new Error('Direct network is disabled in this test') }
  t.after(() => { globalThis.fetch = originalFetch })

  await assert.rejects(fetchOpenRouter('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: 'Bearer synthetic-secret' }, signal: AbortSignal.timeout(2000),
  }, config))
  assert.throws(() => fetchOpenRouter('https://example.com/', {}, config), /Invalid OpenRouter destination/)
  assert.throws(() => openRouterConfig({ ...config, OPENROUTER_PROXY_URL: 'file:///tmp/proxy' }), /OPENROUTER_CONFIG/)
  assert.deepEqual(requests, [{ authority: 'openrouter.ai:443', authorization: undefined }])
  assert.equal(directRequests, 0)
})
test('malformed, oversized, incomplete and mismatched answers fail closed',async t=>{
 for(const [answer,code] of [[{...response(),status:'incomplete'},'OPENROUTER_INCOMPLETE'],[response({...review,jobId:'22222222-2222-4222-8222-222222222222'}),'OPENROUTER_VALIDATION'],[{...response(),extra:'x'.repeat(512001)},'OPENROUTER_RESPONSE_SIZE'],[response({...review,recommendation:{...review.recommendation,score:99}}),'OPENROUTER_SCHEMA']]){
  assert.equal((await fixture(t,{answer}).result).code,code)
 }
})
test('cancellation aborts HTTP and never emits a review',async t=>{
 let started
 const ready=new Promise(resolve=>{started=resolve})
 const x=fixture(t,{fetcher:async(_url,{signal})=>{started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('private')),{once:true}))}})
 const messages=[];x.child.on('message',m=>messages.push(m))
 await ready;const closed=new Promise(resolve=>x.child.once('close',resolve));x.child.kill();await closed
 assert.deepEqual(messages,[]);assert.equal(x.requests.length,1)
})
test('timeout aborts and reports a safe error without retry',async t=>{
 const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_TIMEOUT_MS:'1000'},fetcher:async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('private')),{once:true}))})
 assert.equal((await x.result).code,'OPENROUTER_TIMEOUT');assert.equal(x.requests.length,1)
})

// No real API calls: every failure is injected through fetchImpl.
test('diagnostics distinguish transport failures and retain only safe metadata',async t=>{
 const x=fixture(t,{fetcher:async()=>{throw new TypeError('private synthetic-secret proxy.internal',{cause:Object.assign(new Error('private'),{code:'ENOTFOUND'})})}})
 const r=await x.result
 assert.equal(r.code,'OPENROUTER_NETWORK')
 assert.equal(r.diagnostics.phase,'budget')
 assert.equal(r.diagnostics.networkCode,'ENOTFOUND')
 assert.equal(typeof r.diagnostics.elapsedMs,'number')
 assert.equal(JSON.stringify(r).includes('private'),false)
 assert.equal(JSON.stringify(r).includes('synthetic-secret'),false)
 assert.equal(x.requests.length,1)
})
test('incomplete generation, invalid JSON, schema and evidence have distinct diagnostics',async t=>{
 const cases=[
  [{...response(),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}},'OPENROUTER_INCOMPLETE','response','max_output_tokens'],
  [{...response(),output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'private synthetic-secret'}]}]},'OPENROUTER_JSON','parse'],
  [response({...review,recommendation:{...review.recommendation,score:99}}),'OPENROUTER_SCHEMA','schema'],
  [response({...review,jobId:'22222222-2222-4222-8222-222222222222'}),'OPENROUTER_VALIDATION','validation'],
 ]
 for(const [answer,code,phase,reason]of cases){
  const r=await fixture(t,{answer}).result
  assert.equal(r.code,code);assert.equal(r.diagnostics.phase,phase)
  if(reason)assert.equal(r.diagnostics.incompleteReason,reason)
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false)
  if(phase==='schema')assert.deepEqual(r.diagnostics.schemaIssues,[{field:'recommendation.score',code:'too_big'}])
  if(phase==='validation')assert.equal(r.diagnostics.validationCode,'PACKET_MISMATCH')
 }
})

test('unknown provider data and diagnostics fields cannot leak into errors',async t=>{
 assert.deepEqual(safeOpenRouterDiagnostics({schemaIssues:[{field:'private',code:'too_big',message:'secret'}]}),{schemaIssues:[{field:'other',code:'too_big'}]})
 assert.deepEqual(safeOpenRouterDiagnostics({phase:'private',networkCode:'secret',validationCode:'secret',incompleteReason:'secret',responseStatus:'secret',elapsedMs:Infinity,httpStatus:999,outputTokens:-1,headers:{Authorization:'secret'},message:'secret',stack:'secret'}),{})
 assert.deepEqual(safeOpenRouterDiagnostics({parseIssue:'synthetic-secret',answerBytes:'secret',reasoningTokens:-1,assistantMessages:Infinity,outputItems:1e10,textParts:NaN,answer:'synthetic-secret'}),{})
 for(const [answer,code] of [[{status:'failed',error:{message:'private synthetic-secret'}},'OPENROUTER_PROVIDER'],[null,'OPENROUTER_RESPONSE']]){
  const r=await fixture(t,{answer}).result
  assert.equal(r.code,code);assert.equal(JSON.stringify(r).includes('synthetic-secret'),false)
 }
 const broken=await fixture(t,{fetcher:async()=>new Response('private synthetic-secret',{status:200})}).result
 assert.equal(broken.code,'OPENROUTER_JSON');assert.equal(broken.diagnostics.phase,'budget')
})
test('generation transport failure is distinct from budget failure',async t=>{
 const x=fixture(t,{fetcher:async url=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  throw new TypeError('private',{cause:Object.assign(new Error('private'),{code:'UND_ERR_HEADERS_TIMEOUT'})})
 }})
 const r=await x.result
 assert.equal(r.code,'OPENROUTER_NETWORK');assert.equal(r.diagnostics.phase,'routing')
 assert.equal(r.diagnostics.networkCode,'UND_ERR_HEADERS_TIMEOUT');assert.equal(x.requests.length,2)
})

test('final JSON is read separately from intermediate assistant messages',async t=>{
 const answer=response()
 const final=answer.output[0]
 // Multiple text parts of ONE final message still form one JSON document.
 const json=final.content[0].text,cut=Math.floor(json.length/2)
 final.content=[{type:'output_text',text:json.slice(0,cut)},{type:'output_text',text:json.slice(cut)}]
 answer.output.unshift({type:'message',role:'assistant',content:[{type:'output_text',text:'Сначала проверю контекст.'}]},{type:'reasoning',summary:[]})
 const x=fixture(t,{answer}),r=await x.result
 assert.equal(r.type,'review');assert.equal(r.review.recommendation.score,7)
 assert.equal(x.requests.length,3)
})

test('unusable final output is diagnosed without falling back to an earlier valid answer',async t=>{
 const message=content=>({type:'message',role:'assistant',content})
 const cases=[
  [[], 'no_final_message'],
  [[{type:'reasoning',summary:[{text:'synthetic-secret'}]}], 'no_final_message'],
  [[message([])], 'empty_text'],
  [[{type:'message',role:'assistant',content:'synthetic-secret'}], 'invalid_content'],
  [[message([null])], 'invalid_content'],
  [[{...message([{type:'output_text',text:JSON.stringify(review)}]),phase:'commentary'}], 'no_final_message'],
  [[message([{type:'output_text',text:'   '}])], 'empty_text'],
  [[message([{type:'output_text',text:{secret:'synthetic-secret'}}])], 'invalid_content'],
  [[message([{type:'refusal',refusal:'synthetic-secret'}])], 'refusal'],
  [[{...message([{type:'output_text',text:JSON.stringify(review)}]),status:'incomplete'}], 'unfinished_message'],
  [[message([{type:'output_text',text:'```json\n{"secret":"synthetic-secret"}\n```'}])], 'markdown'],
  [[message([{type:'output_text',text:'synthetic-secret'}])], 'non_json'],
  [[message([{type:'output_text',text:'{"secret":"synthetic-secret"'}])], 'invalid_json'],
 ]
 for(const [output,parseIssue]of cases){
  const answer={...response(),output:[...response().output,...output],usage:{output_tokens:400,output_tokens_details:{reasoning_tokens:300}}}
  if(!output.length)answer.output=[]
  const x=fixture(t,{answer}),r=await x.result
  assert.equal(r.type,'error',parseIssue);assert.equal(r.diagnostics.parseIssue,parseIssue)
  assert.equal(r.diagnostics.outputItems,answer.output.length)
  assert.equal(r.diagnostics.reasoningTokens,300)
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false)
  assert.equal(x.requests.length,['invalid_content','refusal','unfinished_message'].includes(parseIssue)?3:4)
 }
})

test('intermediate provider citations survive final-message extraction; invented URLs still fail',async t=>{
 const source={title:'Синтетический источник',url:'https://example.com/market',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест рынка',limitation:'Синтетический тест'}
 const market={...review,recommendation:{...review.recommendation,assessmentKind:'approach_research'},searchOutcome:'found',sources:[source]}
 for(const cited of [true,false]){
  const answer=response(market,[],1)
  answer.output.unshift({type:'message',role:'assistant',content:[{type:'output_text',text:'Результат поиска.',annotations:cited?[{type:'url_citation',url:source.url}]:[]}]})
  const r=await fixture(t,{answer}).result
  assert.equal(r.type,cited?'review':'error')
  if(!cited)assert.equal(r.code,'OPENROUTER_VALIDATION')
 }
})

test('evaluation after search uses strict JSON with the complete source schema and no tools',async t=>{
 const answer={...review,recommendation:{...review.recommendation,assessmentKind:'approach_research'},searchOutcome:'insufficient'}
 const x=fixture(t,{answer:response(answer,[],1)}),r=await x.result
 assert.equal(r.type,'review');assert.equal(r.review.recommendation.score,7)
 const body=x.requests[3].body,format=body.text.format
 assert.equal(format.strict,true);assert.deepEqual(body.tools,[])
 assert.equal(format.schema.additionalProperties,false)
 assert.deepEqual(format.schema.properties.sources.items.properties.relevance.enum,['direct','analogy'])
 assert.equal(format.schema.properties.sources.items.additionalProperties,false)
 assert.equal(body.max_output_tokens,7792-2048)
 assert.equal(x.requests.length,4) // Budget + routing + search + evaluation; no repair.
})

test('market reviews after search still require provider citations and measured search usage',async t=>{
 const source={title:'Синтетический источник',url:'https://example.com/market',signal:'Тестовый факт',publishedAt:null,origin:'Example',relevance:'direct',applicability:'Тест рынка',limitation:'Синтетический тест'}
 const market={...review,recommendation:{...review.recommendation,assessmentKind:'approach_research'},searchOutcome:'found',sources:[source]}
 for(const [cited,count,expected] of [[true,2,'review'],[false,2,'error'],[true,0,'error'],[true,4,'error']]){
  const x=fixture(t,{answer:response(market,cited?[{type:'url_citation',url:source.url}]:[],count)})
  assert.equal((await x.result).type,expected);assert.equal(x.requests.length,count>3?3:expected==='error'?5:4)
 }
})

test('invalid or ambiguous submission never falls back to earlier valid JSON or invokes a function',async t=>{
 const valid=submitted().output.at(-1)
 for(const calls of [
  [{...valid,name:'private-function'}], [valid,valid],
  [{...valid,status:'incomplete'}], [{...valid,arguments:{secret:'synthetic-secret'}}],
  [{...valid,arguments:'{"secret":"synthetic-secret"'}],
  [valid,...response().output],
 ]){
  const x=fixture(t,{routeKind:'approach_research',searchAnswer:response({notes:'Нет оснований.'},[],1),answer:{...response(),output:[...response().output,...calls]}}),r=await x.result
  assert.equal(r.type,'error');assert.equal(r.code,'OPENROUTER_JSON')
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false)
  assert.equal(JSON.stringify(r).includes('private-function'),false)
  assert.equal(x.requests.length,4)
 }
})

test('all six nested source violations remain visible without exposing values or extra keys',async t=>{
 const source={title:'Test',url:'https://example.com',signal:'Test',publishedAt:null,origin:'Test',relevance:'synthetic-secret',applicability:'Test',limitation:'Test','private-key':'synthetic-secret'}
 const bad={...review,recommendation:{...review.recommendation,assessmentKind:'approach_research'},searchOutcome:'found',sources:[source,source,source]}
 for(const answer of [response(bad)]){
  const x=fixture(t,{answer}),r=await x.result
  assert.equal(r.code,'OPENROUTER_SCHEMA')
  assert.equal(r.diagnostics.schemaIssueCount,6)
  assert.deepEqual(r.diagnostics.schemaIssues,[0,1,2].flatMap(i=>[
   {field:`sources.${i}.relevance`,code:'invalid_value'},
   {field:`sources.${i}`,code:'unrecognized_keys'},
  ]))
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false)
  assert.equal(JSON.stringify(r).includes('private-key'),false)
  assert.equal(safeOpenRouterDiagnostics(r.diagnostics).schemaIssues.length,6)
 }
})

test('nested diagnostic allowlist accepts schema paths only, with bounded size',()=>{
 const fields=['sources.0.url','recommendation.regionalApplicability.sourceUrls.1','recommendation.relatedTasks.0.itemId','recommendation.comparison.itemIds.0','recommendation.scores.0.basis.1.kind']
 for(const field of fields)assert.equal(safeOpenRouterDiagnostics({schemaIssues:[{field,code:'invalid_value'}]}).schemaIssues[0].field,field)
 for(const field of ['sources.secret.url','sources.0.private','sources.999999999.url','recommendation.scores.0.basis.0.secret','recommendation.secret','']){
  assert.equal(safeOpenRouterDiagnostics({schemaIssues:[{field,code:'invalid_value'}]}).schemaIssues[0].field,'other')
 }
 assert.equal(safeOpenRouterDiagnostics({schemaIssues:Array.from({length:100},()=>({field:'sources',code:'invalid_type'}))}).schemaIssues.length,10)
})

test('disabled web uses the existing strict text schema without any tools after routing',async t=>{
 const task={...job,webSearch:false};task.packetHash=quickHash(task,[])
 const {searchOutcome:_,sources:__,...plain}=review
 const answer={...plain,packetHash:task.packetHash}
 const x=fixture(t,{task,answer:response(answer)}),r=await x.result
 assert.equal(r.type,'review');assert.equal(r.review.recommendation.score,7)
 assert.deepEqual(x.requests[2].body.tools,[])
 assert.equal(x.requests[2].body.text.format.name,'funban_priority')
 assert.equal(x.requests[2].body.text.format.strict,true)
 assert.equal(x.requests.length,3)
 assert.equal((await fixture(t,{task,answer:submitted(answer)}).result).diagnostics.parseIssue,'invalid_function_call')
})

test('one correction repairs JSON without another search and accounts for every attempt',async t=>{
 let attempts=0
 const x=fixture(t,{fetcher:async(url,{body})=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  const request=JSON.parse(body)
  if(request.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'internal_improvement'}))
  attempts++
  const data=response()
  if(attempts===1)data.output[0].content[0].text='broken JSON synthetic-secret'
  else {
   assert.deepEqual(request.tools,[])
   assert.match(request.instructions,/исправ/)
   assert.equal(JSON.stringify(request).includes('synthetic-secret'),false)
  }
  return Response.json(data)
 }})
 const r=await x.result
 assert.equal(r.type,'review');assert.equal(attempts,2)
 assert.equal(r.usage.output_tokens,600)
 assert.ok(x.requests[2].body.max_output_tokens+200<=8192)
 assert.equal(x.requests[3].body.max_output_tokens+400,8192)
})
test('regional mismatch can be corrected once without relaxing source validation',async t=>{
 let attempts=0
 const good={...review,searchOutcome:'insufficient',recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 const x=fixture(t,{fetcher:async(url,{body})=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  const request=JSON.parse(body)
  if(request.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'approach_research'}))
  if(request.tools.length)return Response.json(response('Нет подтверждений',[],1))
  attempts++
  return Response.json(response(attempts===1?{...good,recommendation:{...good.recommendation,regionalApplicability:{status:'supported',summary:'Ошибка ссылки',sourceUrls:['https://example.com/fake']}}}:good))
 }})
 const r=await x.result
 assert.equal(r.type,'review');assert.equal(attempts,2)
 assert.equal(r.web.calls,1);assert.equal(r.usage.output_tokens,800)
 assert.deepEqual(r.review.sources,[])
})
test('unfinished search yields an explicitly preliminary assessment without fabricated evidence',async t=>{
 const task={...job,mode:'openrouter'}
 task.packetHash=quickHash(task,[])
 const answer={...review,packetHash:task.packetHash,searchOutcome:'insufficient',recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 const x=fixture(t,{task,fetcher:async(url,{body})=>{
  if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
  const request=JSON.parse(body)
  if(request.text?.format?.name==='funban_route')return Response.json(response({assessmentKind:'approach_research'}))
  if(request.tools.length)return Response.json({...response('unfinished',[],1),status:'incomplete',incomplete_details:{reason:'max_output_tokens'}})
  assert.deepEqual(request.tools,[])
  assert.match(request.instructions,/предварительн/)
  assert.equal(request.text.format.schema.properties.sources.maxItems,0)
  return Response.json(response(answer))
 }})
 const r=await x.result
 assert.equal(r.type,'review');assert.equal(r.web.unavailable,true)
 assert.deepEqual(r.review.sources,[]);assert.equal(x.requests.length,4)
})

test('correction is bounded and missing usage cannot replenish the shared budget',async t=>{
 for(const budget of [2048,8192])for(const missing of [false,true]){
  let attempts=0,charged=0
  const x=fixture(t,{config:{...env,FUNBAN_OPENROUTER_MAX_TOKENS:String(budget)},fetcher:async(url,{body})=>{
   if(url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
   const request=JSON.parse(body)
   assert.ok(charged+request.max_output_tokens<=budget)
   if(request.text?.format?.name==='funban_route'){
    charged+=200
    return Response.json(response({assessmentKind:'internal_improvement'}))
   }
   attempts++
   const data=response()
   data.output[0].content[0].text='malformed'
   charged+=missing?request.max_output_tokens:200
   if(missing)delete data.usage.output_tokens
   return Response.json(data)
  }})
  const r=await x.result
  assert.equal(r.type,'error');assert.equal(r.code,'OPENROUTER_JSON')
  assert.equal(attempts,budget===8192?2:1)
  assert.ok(charged<=budget)
  assert.equal(r.diagnostics.repairAttempts,budget===8192?1:undefined)
 }
})


test('preliminary marker cannot admit sources, strong evidence or a different adapter',()=>{
 const task={...job,mode:'openrouter'}
 task.packetHash=quickHash(task,[])
 const answer={...review,packetHash:task.packetHash,searchOutcome:'insufficient',recommendation:{...review.recommendation,assessmentKind:'approach_research'}}
 const web={unavailable:true,calls:1,queries:1,urls:[]}
 assert.equal(validateQuickReview(answer,task,[],web).researchUnavailable,true)
 for(const strength of ['moderate','strong'])assert.equal(validateQuickReview({...answer,recommendation:{...answer.recommendation,evidenceStrength:strength}},task,[],web).recommendation.evidenceStrength,'limited')
 assert.throws(()=>validateQuickReview(answer,{...task,mode:'codex'},[],web),/WEB_SEARCH_NOT_VERIFIED/)
 assert.throws(()=>validateQuickReview(answer,task,[],{...web,urls:['https://example.com']}),/WEB_SEARCH_NOT_VERIFIED/)
 const source={title:'Test',url:'https://example.com',signal:'Test',publishedAt:null,origin:'Test',relevance:'direct',applicability:'Test',limitation:'Test'}
 assert.throws(()=>validateQuickReview({...answer,sources:[source]},task,[],web),/WEB_SEARCH_NOT_VERIFIED/)
})
