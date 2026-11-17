import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { launchCodex, codexEnvironment } from '../trendwatch-codex.mjs'
import { quickHash } from '../trendwatch-quick.mjs'
import { packetHash } from '../trendwatch-lite.mjs'

const job={id:'11111111-1111-4111-8111-111111111111',snapshot:{title:'Задача',body:'Проверить обзор',scores:{},criteria:[]},context:{horizon:'3–6 месяцев'}}
const sources=[{id:'s1',title:'Тест',url:'https://example.com',text:'Сохранённый фрагмент источника.'}]
job.packetHash=packetHash(job,sources)
const review={jobId:job.id,packetHash:job.packetHash,recommendation:{potential:'unknown',confidence:'weak',summary:'Мало данных',timing:'Неизвестно',nextStep:'Проверить',reasons:[{text:'Есть материал',evidenceIds:['E1']}],limitations:['Не измерено'],scores:[],matrixBucket:'research-next'},evidence:[{id:'E1',sourceId:'s1',quote:sources[0].text,observation:'Описание'}]}
function fixture(t,reply,jobData=job){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}))
 fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify(jobData));fs.writeFileSync(path.join(dir,'materials.json'),JSON.stringify({sources}))
 let invocation
 const child=launchCodex(dir,{command:'synthetic-codex',spawnProcess:(command,args,options)=>{
  invocation={command,args,options}
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>{child.killed=true;return true}
  const input=[];child.stdin.on('data',chunk=>input.push(chunk));child.stdin.on('finish',()=>queueMicrotask(()=>reply(child,options.cwd,Buffer.concat(input).toString())))
  return child
 }})
 return {child,invocation}
}
test('Codex bridge: structured result, isolated cwd, no inherited API keys or executable tools',async t=>{
 const {child,invocation}=fixture(t,(child,dir,prompt)=>{
  assert.match(prompt,/Сохранённые материалы/)
  fs.writeFileSync(path.join(dir,'answer.json'),JSON.stringify(review));child.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:12,output_tokens:5}})+'\n');child.emit('close',0)
 })
 const result=await new Promise(resolve=>child.once('message',resolve))
 assert.equal(result.type,'review');assert.deepEqual(result.review,review)
 assert.equal(invocation.options.shell,false);assert.equal(fs.existsSync(invocation.options.cwd),false)
 for(const flag of ['--ignore-user-config','--ephemeral','read-only','features.shell_tool=false','features.multi_agent=false','features.apps=false','web_search="disabled"','forced_login_method="chatgpt"'])assert.ok(invocation.args.includes(flag))
 assert.deepEqual(codexEnvironment({HOME:'/home',PATH:'/bin',OPENAI_API_KEY:'never pass',OPENROUTER_API_KEY:'never pass',NODE_OPTIONS:'unsafe'}),{HOME:'/home',PATH:'/bin'})
})
test('Codex bridge rejects failed turns, malformed answers and unexpected tools',async t=>{
 for(const event of [{type:'turn.failed'},{type:'item.started',item:{type:'command_execution'}},{type:'turn.completed'}]){
  const {child}=fixture(t,(child,dir)=>{fs.writeFileSync(path.join(dir,'answer.json'),'invalid');child.stdout.write(JSON.stringify(event)+'\n');child.emit('close',0)})
  const result=await new Promise(resolve=>child.once('message',resolve));assert.equal(result.type,'error');assert.equal('review' in result,false)
 }
})

test('Codex bridge: error items are diagnostics, final turn status determines success',async t=>{
 const {child}=fixture(t,(child,dir)=>{
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'error',text:'Temporary stream connection issue'}})+'\n')
  fs.writeFileSync(path.join(dir,'answer.json'),JSON.stringify(review))
  child.stdout.write(JSON.stringify({type:'turn.completed'})+'\n');child.emit('close',0)
 })
 const result=await new Promise(resolve=>child.once('message',resolve))
 assert.equal(result.type,'review');assert.equal(child.killed,undefined)
})
test('Codex bridge: failed turn after error item stays failed and retains only diagnostic categories',async t=>{
 const {child}=fixture(t,child=>{
  child.stdout.write(JSON.stringify({type:'item.completed',item:{type:'error',text:'Usage limit; private diagnostic should not be forwarded'}})+'\n')
  child.stdout.write(JSON.stringify({type:'turn.failed'})+'\n');child.emit('close',1)
 })
 const result=await new Promise(resolve=>child.once('message',resolve))
 assert.equal(result.type,'error');assert.equal(result.code,'CODEX_UNAVAILABLE')
 assert.deepEqual(result.diagnostics.tags,['usage','limit'])
 assert.equal(JSON.stringify(result).includes('private diagnostic'),false)
})

const webJob={...job,format:'quick-v1',webSearch:true,createdAt:Date.now(),boardContext:{total:0,items:[]}}
webJob.packetHash=quickHash(webJob,sources)
const webReview={jobId:webJob.id,packetHash:webJob.packetHash,recommendation:{summary:'Синтетический сигнал [1].',score:6,verdict:'clarify',relatedTasks:[]},searchOutcome:'found',sources:[{title:'Пример',url:'https://example.com/research',signal:'Тестовое наблюдение',publishedAt:null}]}
const send=(child,event)=>child.stdout.write(JSON.stringify(event)+'\n')
test('web mode allows only bounded search, captures source provenance and keeps other tools disabled',async t=>{
 const {child,invocation}=fixture(t,(child,dir,prompt)=>{
  assert.match(prompt,/лёгкий веб-поиск/)
  send(child,{type:'item.started',item:{id:'s',type:'web_search',action:{type:'search',queries:['public topic']}}})
  send(child,{type:'item.completed',item:{id:'s',type:'web_search',action:{type:'search',queries:['public topic']}}})
  send(child,{type:'item.completed',item:{id:'o',type:'web_search',action:{type:'open_page',url:'https://example.com/research'}}})
  fs.writeFileSync(path.join(dir,'answer.json'),JSON.stringify(webReview));send(child,{type:'turn.completed'});child.emit('close',0)
 },webJob)
 const result=await new Promise(resolve=>child.once('message',resolve))
 assert.equal(result.type,'review');assert.deepEqual(result.web,{calls:2,queries:1,urls:['https://example.com/research']})
 assert.ok(invocation.args.includes('features.code_mode_host=true'));assert.ok(invocation.args.includes('features.standalone_web_search=true'));assert.equal(invocation.args.includes('features.code_mode_host=false'),false);assert.ok(invocation.args.includes('web_search="live"'));assert.ok(invocation.args.includes('features.shell_tool=false'))
})
test('web budget stops excess calls, batched queries, and still rejects executable tools',async t=>{
 for(const scenario of ['calls','queries','shell']){
  const {child}=fixture(t,child=>{
   if(scenario==='calls')for(let i=0;i<7;i++)send(child,{type:'item.started',item:{id:String(i),type:'web_search',action:{type:'open_page',url:'https://example.com'}}})
   if(scenario==='queries')send(child,{type:'item.completed',item:{id:'s',type:'web_search',action:{type:'search',queries:['a','b','c','d']}}})
   if(scenario==='shell')send(child,{type:'item.started',item:{id:'s',type:'command_execution'}})
   child.emit('close',1)
  },webJob)
  const result=await new Promise(resolve=>child.once('message',resolve))
  assert.equal(result.code,scenario==='shell'?'CODEX_UNEXPECTED_TOOL':'CODEX_WEB_LIMIT');assert.equal(child.killed,true)
 }
})

test('draft clarification uses a short schema and disables web/executable tools',async t=>{
 const {child,invocation}=fixture(t,(child,dir,prompt)=>{
  assert.match(prompt,/Черновик задачи/)
  fs.writeFileSync(path.join(dir,'answer.json'),JSON.stringify({question:'Какой продукт?'}));send(child,{type:'turn.completed'});child.emit('close',0)
 },{format:'clarify-v1',snapshot:{title:'Неоднозначная задача',body:'Описание'}})
 const result=await new Promise(resolve=>child.once('message',resolve))
 assert.deepEqual(result.review,{question:'Какой продукт?'})
 for(const flag of ['web_search="disabled"','features.shell_tool=false','features.code_mode_host=false','model_reasoning_effort="low"'])assert.ok(invocation.args.includes(flag))
})

test('idea search retains bounded actual query text in the private web audit',async t=>{
 const focused={...webJob,priorityPolicy:'criteria-v2',evidencePolicy:'idea-relevance-v1',snapshot:{title:'Продажи цифровых дизайнов',body:'Изучить продажи цифровых дизайнов.',criteria:[{id:'impact',name:'Выхлоп',max:3,step:.5,invert:false}]}}
 focused.packetHash=quickHash(focused,sources)
 const answer={jobId:focused.id,packetHash:focused.packetHash,recommendation:{summary:'Поиск не изменил оценку.',verdict:'clarify',scores:[{criterionId:'impact',value:null,reason:'Недостаточно оснований.',basis:[]}],relatedTasks:[]},searchOutcome:'insufficient',sources:[]}
 const {child}=fixture(t,(child,dir)=>{
  send(child,{type:'item.completed',item:{id:'q',type:'web_search',action:{type:'search',query:'digital design assets purchasing trends 2026'}}})
  fs.writeFileSync(path.join(dir,'answer.json'),JSON.stringify(answer));send(child,{type:'turn.completed'});child.emit('close',0)
 },focused)
 const result=await new Promise(resolve=>child.once('message',resolve))
 assert.equal(result.type,'review');assert.deepEqual(result.web.queryTexts,['digital design assets purchasing trends 2026'])
})
