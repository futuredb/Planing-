import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchOpenRouterClarifier, openRouterClarifierConfig } from '../trendwatch-openrouter.mjs'

const env={OPENROUTER_API_KEY:'synthetic-key',FUNBAN_OPENROUTER_MODEL:'test/main',FUNBAN_OPENROUTER_CLARIFY_MODEL:'test/fast'}
const response=review=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(review)}]}]})
function setup(t,options={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funban-or-draft-'))
  fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify({format:'clarify-v1',snapshot:{title:'Поисследовать продажи цифровых дизайнов',body:'x'.repeat(4000)}}))
  const requests=[],children=[]
  const fetchImpl=async(url,init)=>{
    requests.push({url,...init,body:init.body&&JSON.parse(init.body)})
    return url.endsWith('/key')?Response.json({data:{limit:5,limit_remaining:5}}):response({question:'Какие именно цифровые дизайны планируем продавать?'})
  }
  const launch=(overrides={})=>{const child=launchOpenRouterClarifier(dir,{env,fetchImpl,...options,...overrides});children.push(child);return child}
  t.after(()=>{children.forEach(child=>child.kill());fs.rmSync(dir,{recursive:true,force:true})})
  return {dir,requests,launch}
}
test('OpenRouter draft: bounded context, fast model, strict JSON, no tools, budget before generation',async t=>{
  const x=setup(t),child=x.launch(),done=once(child,'close'),messages=[]
  child.on('message',m=>messages.push(m));await done
  assert.deepEqual(messages,[{type:'review',review:{question:'Какие именно цифровые дизайны планируем продавать?'}}])
  assert.deepEqual(x.requests.map(r=>new URL(r.url).pathname),['/api/v1/key','/api/v1/responses'])
  const body=x.requests[1].body
  assert.equal(body.model,'test/fast');assert.equal(body.max_output_tokens,128)
  assert.equal(body.reasoning.enabled,false);assert.equal(body.store,false)
  assert.deepEqual(body.tools,[]);assert.equal(body.provider.data_collection,'deny')
  assert.equal(body.text.format.strict,true);assert.equal(body.text.format.name,'funban_clarification')
  assert.equal(JSON.parse(body.input).body.length,800)
  assert.deepEqual(Object.keys(JSON.parse(body.input)),['title','body'])
  assert.equal(x.requests[0].redirect,'error')
  assert.equal(openRouterClarifierConfig({...env,FUNBAN_OPENROUTER_CLARIFY_MODEL:''}).model,'test/main')
  assert.equal(openRouterClarifierConfig(env).timeoutMs,2300)
})
test('OpenRouter draft: clear task may return no question; invalid answers never escape',async t=>{
  for(const review of [{question:null},{question:'Не вопрос'},{question:'слово '.repeat(21)+'?'},{question:'x'.repeat(181)+'?'},{question:'Что?',extra:true}]){
    const x=setup(t),child=x.launch({fetchImpl:async url=>url.endsWith('/key')?Response.json({data:{limit:5,limit_remaining:5}}):response(review)}),done=once(child,'close'),messages=[]
    child.on('message',m=>messages.push(m));await done
    assert.deepEqual(messages,review.question===null?[{type:'review',review:{question:null}}]:[{type:'error'}])
  }
})
test('OpenRouter draft: invalid config, budget and HTTP errors never retry or reveal diagnostics',async t=>{
  for(const failure of ['config','unlimited','exhausted','auth','rate','malformed']){
    const calls=[],x=setup(t),child=x.launch({env:{...env,...(failure==='config'?{FUNBAN_OPENROUTER_CLARIFY_MODEL:'openrouter/auto'}:{})},fetchImpl:async url=>{
      calls.push(url)
      if(failure==='auth'||failure==='rate')return new Response('private diagnostic',{status:failure==='auth'?401:429})
      if(failure==='malformed')return new Response('private malformed response')
      return Response.json({data:{limit:failure==='unlimited'?null:5,limit_remaining:failure==='exhausted'?0:5}})
    }}),done=once(child,'close'),messages=[]
    child.on('message',m=>messages.push(m));await done
    assert.deepEqual(messages,[{type:'error'}]);assert.equal(calls.length,failure==='config'?0:1)
  }
})
test('OpenRouter draft: cancellation and deadline abort fetch and suppress late responses',async t=>{
  for(const stage of ['key','generation'])for(const cancel of [true,false]){
    let signal,startedResolve
    const started=new Promise(resolve=>{startedResolve=resolve})
    const x=setup(t),child=x.launch({timeoutMs:30,fetchImpl:async(url,init)=>{
      if(stage==='generation'&&url.endsWith('/key'))return Response.json({data:{limit:5,limit_remaining:5}})
      signal=init.signal;startedResolve()
      return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
    }}),done=once(child,'close'),messages=[]
    child.on('message',m=>messages.push(m));await started
    if(cancel)child.kill()
    await done;assert.equal(signal.aborted,true);assert.deepEqual(messages,[])
  }
  let resolveLate
  const x=setup(t),child=x.launch({fetchImpl:async url=>url.endsWith('/key')?Response.json({data:{limit:5,limit_remaining:5}}):new Promise(resolve=>{resolveLate=resolve})}),done=once(child,'close'),messages=[]
  child.on('message',m=>messages.push(m))
  while(!resolveLate)await new Promise(resolve=>setImmediate(resolve))
  child.kill();await done;resolveLate(response({question:'Поздний вопрос?'}))
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(messages,[])
})
