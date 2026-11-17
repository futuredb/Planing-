import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchOpenRouter, openRouterConfig } from '../trendwatch-openrouter.mjs'
import { quickHash } from '../trendwatch-quick.mjs'
import { fetchOpenRouter } from '../openrouter-fetch.mjs'
const env={OPENROUTER_API_KEY:'synthetic-secret',FUNBAN_OPENROUTER_MODEL:'test/model'}
const job={id:'11111111-1111-4111-8111-111111111111',format:'quick-v1',webSearch:true,createdAt:Date.now(),priorityPolicy:'concept-mvp-v1',evidencePolicy:'adaptive-signals-v4',snapshot:{title:'Автоматизировать сбор материалов',body:'Экономия 2 часа в неделю.',criteria:[]},boardContext:{total:0,items:[]},comparisonContext:{items:[]}}
job.packetHash=quickHash(job,[])
const review={jobId:job.id,packetHash:job.packetHash,recommendation:{assessmentKind:'internal_improvement',matrixBucket:'automate',summary:'Экономия 8 часов за четыре недели по данным задачи.',score:7,verdict:'recommend',decisionValue:'Освободить время для концепций.',comparison:{status:'insufficient',itemIds:[],reason:'Нет сравнимых оценок.'},rationale:'Подтверждённая повторная экономия времени.',limitations:'Не известны затраты внедрения.',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Внутренний инструмент.',sourceUrls:[]},relatedTasks:[]},searchOutcome:'not_needed',sources:[]}
function response(answer=review,annotations=[],count=0){return {status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(answer),annotations}]}],usage:{input_tokens:100,output_tokens:200,server_tool_use_details:{web_search_requests:count,tool_calls_executed:count}}}}
function fixture(t,{answer=response(),key={limit:5,limit_remaining:5},config=env,fetcher}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'openrouter-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify(job));fs.writeFileSync(path.join(dir,'materials.json'),JSON.stringify({sources:[]}))
 const requests=[]
 const child=launchOpenRouter(dir,{env:config,fetchImpl:async(url,options)=>{
  requests.push({url,options,body:options.body?JSON.parse(options.body):null})
  if(fetcher)return fetcher(url,options)
  return Response.json(url.endsWith('/key')?{data:key}:answer)
 }})
 const result=new Promise(resolve=>child.on('message',m=>{if(['review','error'].includes(m.type))resolve(m)}))
 return {child,result,requests}
}
test('internal review: bounded request, no observed searches, credentials only in server headers',async t=>{
 const x=fixture(t),result=await x.result
 assert.equal(result.type,'review');assert.equal(result.review.recommendation.score,7)
 assert.deepEqual(result.web,{calls:0,queries:0,urls:[]})
 assert.equal(x.requests.length,2)
 const request=x.requests[1]
 assert.equal(request.url,'https://openrouter.ai/api/v1/responses')
 assert.equal(request.options.redirect,'error');assert.equal(request.body.store,false)
 assert.equal(request.body.max_output_tokens,4096);assert.equal(request.body.max_tool_calls,3)
 assert.equal(request.body.tools[0].parameters.engine,'exa');assert.equal(request.body.tools[0].parameters.max_uses,3)
 assert.equal(JSON.stringify(request.body).includes(env.OPENROUTER_API_KEY),false)
 assert.equal(JSON.stringify(result).includes(env.OPENROUTER_API_KEY),false)
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
  assert.deepEqual(await x.result,{type:'error',code});assert.equal(x.requests.length,1)
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
 for(const answer of [{...response(),status:'incomplete'},response({...review,jobId:'22222222-2222-4222-8222-222222222222'}),{...response(),extra:'x'.repeat(512001)},response({...review,recommendation:{...review.recommendation,score:99}})]){
  assert.equal((await fixture(t,{answer}).result).code,'OPENROUTER_RESPONSE')
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
