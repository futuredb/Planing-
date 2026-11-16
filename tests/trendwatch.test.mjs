import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { createStateRepository } from '../state-repository.mjs'
import { createTrendwatchService } from '../trendwatch-service.mjs'
import { evidencePacket, validatedRecommendation } from '../trendwatch-contract.mjs'
import { makeBrief, execute } from '../trendwatch-worker.mjs'

const proposedScores=[{criterionId:'impact',value:3,reason:'Польза',basis:[{kind:'task',ref:'body',quote:'Проверить пользу автоматизации'}]},{criterionId:'effort',value:4,reason:'Объём предварительный',basis:[{kind:'task',ref:'body',quote:'Проверить пользу автоматизации'}]}]
const actor={id:'portal:lead',name:'Лид'}
const context={audience:'Дизайнеры',goal:'Сократить ручную подготовку обзоров',geography:'Весь мир',horizon:'3–6 месяцев'}
const criteria=[{id:'impact',name:'Выхлоп',max:3,step:.5,invert:false,hint:'',weight:1},{id:'effort',name:'Напряг',max:10,step:1,invert:true,hint:'',weight:1}]
const recommendation={potential:'medium',confidence:'weak',summary:'Проверить пользу в пилоте',timing:'Начать с проверки гипотезы',nextStep:'Сравнить два обзора',
  reasons:[{text:'Есть пример применения',evidenceIds:['e1']}],limitations:['Эффект для команды не измерен'],scores:[{criterionId:'impact',value:2,reason:'Потенциальная польза требует проверки'}],matrixBucket:'research-next'}
const evidence=[{id:'e1',title:'Источник теста',url:'https://example.com/source',quote:'Тестовый фрагмент источника',observation:'Наблюдение',retrievedAt:'2026-11-12T00:00:00Z',publishedAt:null}]
class Child extends EventEmitter { exitCode=null; stdout={resume(){}}; stderr={resume(){}}; kill(){this.exitCode=0;queueMicrotask(()=>this.emit('close',0));return true} }
async function setup(t,options={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funban-trend-test-')),repository=createStateRepository(path.join(dir,'state.json'))
  const item={id:'task',title:'Исследователь',body:'Проверить пользу автоматизации обзоров для дизайнеров.',lane:'inbox',sprintId:null,parentId:null,relatedIds:[],assigneeId:null,authorId:'m1',scores:{},attachments:[],stickers:[],createdAt:1,archivedAt:null}
  await repository.replace(JSON.stringify({updatedAt:1,members:[{id:'m1',name:'Человек',avatar:'',role:''}],roles:{},criteria,sprints:[],items:[item],comments:[]}),0)
  const children=[]
  const args={repository,directory:path.join(dir,'research'),enabled:true,launch:()=>{const child=new Child();children.push(child);return child},...options}
  const service=createTrendwatchService(args)
  t.after(async()=>{await service.close();await new Promise(resolve=>setImmediate(resolve));fs.rmSync(dir,{recursive:true,force:true})})
  const start=(extra={})=>service.start('task',{requestId:randomUUID(),title:item.title,body:item.body,context,...extra},actor)
  const ready=async()=>{children.at(-1).emit('message',{type:'result',result:{status:'ready',recommendation,evidence}});await service.get('task');children.at(-1).kill()}
  return {dir,repository,item,children,args,service,start,ready}
}

test('исследование отделено от оценок; человек подтверждает атомарно, повтор безопасен',async t=>{
  const x=await setup(t),job=await x.start();await x.ready()
  assert.deepEqual((await x.repository.read()).items[0].scores,{})
  assert.equal((await x.repository.read()).items[0].lane,'inbox')
  const input={jobId:job.id,requestId:randomUUID(),scores:{impact:2.5,effort:2},matrixBucket:'research-next',comment:'Проверить на двух обзорах'}
  await assert.rejects(x.service.confirm('task',{...input,scores:{impact:2}},actor),{statusCode:422})
  await assert.rejects(x.service.confirm('task',{...input,scores:{impact:2.3,effort:2}},actor),{statusCode:422})
  await x.service.confirm('task',input,actor)
  const result=await x.service.confirm('task',input,actor);assert.equal(result.deduplicated,true)
  const board=await x.repository.read();assert.equal(board.items[0].lane,'backlog');assert.equal(board.items[0].sprintId,null)
  assert.equal(board.items[0].trendwatchDecision.confirmedBy,actor.id);assert.equal(board.comments.length,1)
  const spoof=structuredClone(board);spoof.items[0].trendwatchDecision.confirmedBy='attacker'
  await x.repository.replace(JSON.stringify(spoof),board.updatedAt,[],actor)
  assert.equal((await x.repository.read()).items[0].trendwatchDecision.confirmedBy,actor.id)
})
test('повторные и параллельные запросы не запускают второй процесс',async t=>{
  const x=await setup(t),requestId=randomUUID()
  const [a,b]=await Promise.all([x.start({requestId}),x.start({requestId})]);assert.equal(a.id,b.id)
  assert.equal((await x.start()).id,a.id);assert.equal(x.children.length,1)
  await assert.rejects(x.start({context:{...context,goal:'Другая цель'}}),{statusCode:429})
})
test('изменение задачи или критериев запрещает принятие старой рекомендации',async t=>{
  const x=await setup(t),job=await x.start();await x.ready()
  await x.repository.mutate({action:'edit'},state=>{state.criteria[0].max=5;return {state,result:{},touchedIds:['task']}})
  assert.equal((await x.service.get('task')).job.stale,true)
  await assert.rejects(x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),scores:{impact:2,effort:1},matrixBucket:'research-next',comment:''},actor),{statusCode:409})
  assert.equal((await x.repository.read()).items[0].lane,'inbox')
})
test('отмена не принимает запоздалый результат; незавершённый запуск помечается после перезапуска',async t=>{
  const x=await setup(t),job=await x.start()
  await x.service.cancel('task',job.id);x.children[0].emit('message',{type:'result',result:{status:'ready',recommendation,evidence}})
  assert.equal((await x.service.get('task')).job.status,'cancelled')
  await new Promise(resolve=>setImmediate(resolve));const next=await x.start()
  const restarted=createTrendwatchService(x.args)
  assert.equal((await restarted.get('task')).job.status,'interrupted')
  assert.equal((await restarted.get('task')).job.id,next.id);await restarted.close()
})
test('неизвестные ссылки и оценки труда от модели отклоняются',async t=>{
  const x=await setup(t);await x.start()
  x.children[0].emit('message',{type:'result',result:{status:'ready',recommendation:{...recommendation,reasons:[{text:'Выдумано',evidenceIds:['missing']}]},evidence}})
  assert.equal((await x.service.get('task')).job.status,'failed')
  assert.throws(()=>validatedRecommendation({...recommendation,scores:[{criterionId:'effort',value:1,reason:'Угадываю'}]},criteria,evidence))
  assert.deepEqual((await x.repository.read()).items[0].scores,{})
})
test('ошибка, недостаток данных и таймаут не меняют доску',async t=>{
  const x=await setup(t,{timeoutMs:20});await x.start();await new Promise(resolve=>setTimeout(resolve,40))
  assert.equal((await x.service.get('task')).job.status,'failed');assert.deepEqual((await x.repository.read()).items[0].scores,{})
  await x.start();x.children.at(-1).emit('message',{type:'result',result:{status:'insufficient',evidence:[],message:'Мало данных'}})
  assert.equal((await x.service.get('task')).job.status,'insufficient');x.children.at(-1).kill()
  await new Promise(resolve=>setImmediate(resolve));await x.start();x.children.at(-1).emit('message',{type:'error',code:'SECRET_PROVIDER_BODY'})
  const result=await x.service.get('task');assert.equal(result.job.status,'failed');assert.equal(JSON.stringify(result).includes('SECRET_PROVIDER_BODY'),false)
})
test('неподключённый runtime, неполный контекст и несохранённое описание не запускаются',async t=>{
  const x=await setup(t)
  await assert.rejects(x.start({body:'Изменённое локальное описание'}),{statusCode:409})
  await assert.rejects(x.start({context:{...context,audience:''}}))
  assert.equal(x.children.length,0)
  const disabled=createTrendwatchService({...x.args,enabled:false});assert.equal((await disabled.get('task')).available,false)
  await assert.rejects(disabled.start('task',{},actor),{statusCode:503});await disabled.close()
})
test('источники берутся только из завершённого анализа, небезопасные URL исключаются',()=>{
  const packet=evidencePacket({sections:[{analysisStatus:'pending',claims:[{text:'Не проверено',evidenceIds:['bad']}]},{analysisStatus:'complete',claims:[{text:'Проверено',evidenceIds:['e1']}]}],evidence:[{id:'bad',sourceId:'bad',quote:'x'},{id:'e1',sourceId:'s1',quote:'test'}],sources:[{id:'bad',url:'javascript:alert(1)'},{id:'s1',url:'https://example.com',title:'Источник'}]})
  assert.equal(packet.claims.length,1);assert.equal(packet.evidence.length,1)
})
test('повреждение архива исследований не мешает читать и редактировать доску',async t=>{
  const x=await setup(t),id=randomUUID();fs.mkdirSync(path.join(x.args.directory,id),{recursive:true});fs.writeFileSync(path.join(x.args.directory,id,'job.json'),'invalid json')
  const damaged=createTrendwatchService(x.args),status=await damaged.get('task')
  assert.equal(status.available,false);assert.match(status.configurationMessage,/архив/)
  await x.repository.mutate({action:'manual'},state=>{state.items[0].scores={impact:3};return {state,result:{},touchedIds:['task']}})
  assert.equal((await x.repository.read()).items[0].scores.impact,3);await damaged.close()
})
test('адаптер передаёт задачу в настоящий контракт runResearch и валидирует итог (без сети)',async t=>{
  const x=await setup(t),job=await x.start(),stored=JSON.parse(fs.readFileSync(path.join(x.args.directory,job.id,'job.json'),'utf8'))
  const brief=makeBrief(stored);assert.match(brief.answers.questions,/3–6 месяцев/);assert.match(brief.answers.questions,/автоматизации/)
  let called=false
  const runtime={
    openAttemptBudget:async()=>null,auditContext:{run:async(_context,fn)=>fn()},
    runResearch:async(given,_directory,options)=>{called=true;assert.equal(given.answers.topic,x.item.title);assert.equal(options.workflow,'adaptive');assert.equal(options.enableReviewParser,false);assert.equal(options.policy.maxTokens,120000);return {sections:[{analysisStatus:'complete',claims:[{text:'Вывод',evidenceIds:['e1']}],gaps:[]}],sources:[{id:'s1',url:'https://example.com',title:'Источник'}],evidence:[{id:'e1',sourceId:'s1',quote:'Фрагмент'}],stopReason:'source_budget'}},
    team:{role:()=>({json:async(_prompt,input,_limit,validate)=>{assert.equal(input.evidence.length,1);validate(recommendation);return recommendation}})},
  }
  const result=await execute(stored,path.join(x.args.directory,job.id),runtime)
  assert.equal(called,true);assert.equal(result.status,'ready');assert.equal(result.stopReason,'source_budget')
})
test('лимит поиска охватывает предварительные запросы; седьмой не отправляется',async t=>{
  const x=await setup(t),job=await x.start(),stored=JSON.parse(fs.readFileSync(path.join(x.args.directory,job.id,'job.json'),'utf8'))
  let searches=0
  const runtime={openAttemptBudget:async()=>null,auditContext:{run:async(_context,fn)=>fn()},team:{},search:async()=>{searches++;return []},
    runResearch:async(_brief,_directory,{search})=>{for(let i=0;i<6;i++)await search('test');await assert.rejects(search('extra'),{message:'SEARCH_LIMIT'});return {sections:[],sources:[],evidence:[]}}}
  const result=await execute(stored,path.join(x.args.directory,job.id),runtime)
  assert.equal(searches,6);assert.equal(result.status,'insufficient')
})

test('причина остановки по бюджету доходит до карточки и восстанавливается для старого запуска',async t=>{
  const x=await setup(t),job=await x.start()
  fs.writeFileSync(path.join(x.args.directory,job.id,'run.json'),JSON.stringify({stopReason:'planning_token_budget',sources:[]}))
  x.children[0].emit('message',{type:'result',result:{status:'insufficient',evidence:[],stopReason:'planning_token_budget',message:'Уточните задачу'}})
  const current=(await x.service.get('task')).job
  assert.match(current.message,/лимит подготовки плана/i)
  assert.doesNotMatch(current.message,/Уточните задачу/)
  const file=path.join(x.args.directory,job.id,'job.json'),saved=JSON.parse(fs.readFileSync(file));delete saved.stopReason;fs.writeFileSync(file,JSON.stringify(saved))
  const restarted=createTrendwatchService(x.args);t.after(()=>restarted.close())
  assert.match((await restarted.get('task')).job.message,/лимит подготовки плана/i)
})

test('разбор в чате использует сохранённые источники, не запускает worker и не меняет оценки',async t=>{
  const x=await setup(t),original=await x.start()
  fs.writeFileSync(path.join(x.args.directory,original.id,'run.json'),JSON.stringify({stopReason:'planning_token_budget',sources:[{id:'S1',title:'Источник',url:'https://example.com/source',text:'Автор описывает применение инструмента. Эффект не измерен.',retrievedAt:'2026-11-12T00:00:00Z'}]}))
  await x.service.cancel('task',original.id);await new Promise(resolve=>setImmediate(resolve))
  const service=createTrendwatchService({...x.args,mode:'assisted',launch:()=>{throw new Error('Network worker must not start')}});t.after(()=>service.close())
  const input={requestId:randomUUID(),title:x.item.title,body:x.item.body,context};const job=await service.start('task',input,actor)
  assert.equal(job.status,'awaiting_review');assert.equal(job.mode,'assisted')
  assert.equal((await service.start('task',input,actor)).id,job.id)
  const packet=await service.packet('task',job.id)
  assert.match(packet,/Сохранённые материалы/);assert.match(packet,/Эффект не измерен/)
  const result={jobId:job.id,packetHash:job.packetHash,recommendation:{...recommendation,potential:'unknown',scores:[]},evidence:[{id:'e1',sourceId:'S1',quote:'Эффект не измерен.',observation:'Нет измерений'}]}
  await assert.rejects(service.importReview('task',{...result,packetHash:'0'.repeat(64)},actor),{statusCode:409})
  await assert.rejects(service.importReview('task',{...result,evidence:[{...result.evidence[0],quote:'Эффект доказан'}]},actor))
  await assert.rejects(service.importReview('task',{...result,evidence:[{...result.evidence[0],sourceId:'invented'}]},actor))
  const ready=await service.importReview('task',result,actor)
  assert.equal(ready.status,'ready');assert.equal(ready.sourceJobId,original.id)
  assert.equal(ready.evidence[0].url,'https://example.com/source')
  assert.match(await service.report('task',job.id),/разбор в чате/i)
  assert.deepEqual((await x.repository.read()).items[0].scores,{})
  assert.equal((await x.repository.read()).items[0].lane,'inbox')
  await assert.rejects(service.importReview('task',{...result,recommendation:{...result.recommendation,summary:'Перезаписать'}},actor),{statusCode:409})
})

test('импорт в чате отклоняется после изменения задачи; пустой архив не порождает свидетельства',async t=>{
  const x=await setup(t,{mode:'assisted'}),job=await x.start()
  assert.equal(job.status,'awaiting_review');assert.equal(job.sourceCount,0);assert.equal(x.children.length,0)
  assert.match(await x.service.packet('task',job.id),/Материалов нет/)
  await assert.rejects(x.service.importReview('task',{jobId:job.id,packetHash:job.packetHash,recommendation,evidence:[{id:'e1',sourceId:'missing',quote:'Нет в архиве',observation:'Выдумано'}]},actor),{statusCode:422})
  await x.repository.mutate({action:'edit'},state=>{state.items[0].body+=' Изменение.';return {state,result:{},touchedIds:['task']}})
  await assert.rejects(x.service.importReview('task',{jobId:job.id,packetHash:job.packetHash,recommendation,evidence:[{id:'e1',sourceId:'missing',quote:'Нет в архиве',observation:'Выдумано'}]},actor),{statusCode:409})
  assert.equal(x.children.length,0)
})

test('автоматический Codex: один запуск, короткий ответ, отсутствие автоматического подтверждения',async t=>{
 const x=await setup(t),old=await x.start();await x.service.cancel('task',old.id);await new Promise(resolve=>setImmediate(resolve))
 fs.writeFileSync(path.join(x.args.directory,old.id,'run.json'),JSON.stringify({sources:[{id:'S1',title:'Источник',url:'https://example.com',text:'Сохранённый фрагмент источника.'}]}))
 const service=createTrendwatchService({...x.args,mode:'codex'});t.after(()=>service.close())
 const input={requestId:randomUUID(),title:x.item.title,body:x.item.body,context};const next=await service.start('task',input,actor)
 assert.equal(next.status,'queued');assert.equal(next.mode,'codex');assert.equal((await service.start('task',input,actor)).id,next.id)
 const child=x.children.at(-1)
 child.emit('message',{type:'review',review:{jobId:next.id,packetHash:next.packetHash,recommendation:{summary:'Перспектива требует проверки.',verdict:'clarify',scores:proposedScores,relatedTasks:[]}}})
 const result=(await service.get('task')).job
 assert.equal(result.status,'ready');assert.equal(result.mode,'codex');assert.equal(result.decision,null)
 assert.deepEqual((await x.repository.read()).items[0].scores,{})
 assert.match(await service.report('task',next.id),/Короткая ИИ-рекомендация/)
 child.kill()
})
test('Codex без источников оценивает гипотезу по задаче и доске',async t=>{
 const x=await setup(t,{mode:'codex'}),empty=await x.start()
 assert.equal(empty.status,'queued');assert.equal(x.children.length,1);assert.equal(empty.sourceCount,0);assert.equal(empty.format,'quick-v1')
})


test('единый балл: валидация, ручное изменение, атомарное подтверждение, сохранность критериев',async t=>{
 const x=await setup(t,{mode:'codex'}),job=await x.start({context:undefined})
 const recommendation={summary:'Гипотеза: проверить небольшим пилотом.',verdict:'clarify',scores:proposedScores,relatedTasks:[]}
 x.children[0].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation}})
 assert.equal((await x.service.get('task')).job.status,'ready');x.children[0].kill()
 assert.equal((await x.repository.read()).items[0].priorityScore,undefined)
 for(const score of [-1,11,'7',null])await assert.rejects(x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score},actor))
 const input={jobId:job.id,requestId:randomUUID(),score:0}
 await x.service.confirm('task',input,actor)
 assert.equal((await x.service.confirm('task',input,actor)).deduplicated,true)
 const item=(await x.repository.read()).items[0]
 assert.equal(item.priorityScore,0);assert.deepEqual(item.scores,{impact:3,effort:4})
 assert.equal(item.lane,'backlog');assert.equal(item.trendwatchDecision.score,0)
 assert.equal((await x.service.get('task')).job.recommendation.score,6)
 assert.equal(item.matrixBucket,undefined);assert.equal(item.sprintId,null)
 assert.equal((await x.service.get('task')).job.stale,false)
 await x.service.confirm('task',{...input,requestId:randomUUID(),score:10},actor)
 assert.equal((await x.repository.read()).items[0].priorityScore,10)
 assert.equal((await x.service.get('task')).job.stale,false)
 await x.repository.mutate({action:'edit_after_confirmation'},state=>{state.items[0].body+=' Новое описание.';return {state,result:{},touchedIds:['task']}})
 assert.equal((await x.service.get('task')).job.stale,true)
 await assert.rejects(x.service.confirm('task',{...input,requestId:randomUUID(),score:5},actor),{statusCode:409})
})

test('контекст доски: выполненное и архив различаются; изменение блокирует старый ответ',async t=>{
 const x=await setup(t,{mode:'codex'})
 await x.repository.mutate({action:'seed'},state=>{
  state.sprints=[{id:'2026-11-09',weekStart:'2026-11-09',goal:'',goalClosed:false,closed:false}]
  state.items.push({...x.item,id:'done',title:'Исследователь — пилот',lane:'done',sprintId:'2026-11-09'}, {...x.item,id:'archived',lane:'archive',archivedAt:2})
  return {state,result:{},touchedIds:['done','archived']}
 })
 const job=await x.start()
 assert.equal(job.boardContext.items.find(i=>i.id==='done').lane,'done')
 assert.equal(job.boardContext.items.find(i=>i.id==='archived').lane,'archive')
 const recommendation={summary:'Гипотеза: повторно использовать результат пилота.',verdict:'clarify',scores:proposedScores,relatedTasks:[{itemId:'done',reason:'Пилот уже выполнен.'}]}
 x.children[0].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation}})
 assert.equal((await x.service.get('task')).job.status,'ready');x.children[0].kill()
 await x.repository.mutate({action:'edit'},state=>{state.items.find(i=>i.id==='done').body+=' Новый результат.';return {state,result:{},touchedIds:['done']}})
 assert.equal((await x.service.get('task')).job.stale,true)
 await assert.rejects(x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:5},actor),{statusCode:409})
 assert.equal((await x.repository.read()).items[0].lane,'inbox')
})

test('короткий ответ: выдуманная связанная задача или балл вне шкалы отклоняются',async t=>{
 const x=await setup(t,{mode:'codex'})
 for(const rec of [{scores:proposedScores.map(s=>({...s,value:11})),relatedTasks:[]},{scores:proposedScores,relatedTasks:[{itemId:'invented',reason:'Дубль'}]}]){
  const job=await x.start()
  x.children.at(-1).emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Короткий вывод',verdict:'clarify',...rec}}})
  assert.equal((await x.service.get('task')).job.status,'failed')
  await new Promise(resolve=>setImmediate(resolve))
 }
 assert.equal((await x.repository.read()).items[0].priorityScore,undefined)
})


test('старое подтверждение критериев явно возвращает задачу к формуле',async t=>{
 const x=await setup(t)
 await x.repository.mutate({action:'seed_score'},state=>{state.items[0].priorityScore=9;return {state,result:{},touchedIds:['task']}})
 const job=await x.start();await x.ready()
 await x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),scores:{impact:2,effort:1},matrixBucket:'research-next',comment:''},actor)
 const item=(await x.repository.read()).items[0]
 assert.equal(item.priorityScore,undefined);assert.deepEqual(item.scores,{impact:2,effort:1})
})

test('авторазбор: только новые заполненные входящие, один запуск, очередь и отсутствие повторов',async t=>{
 const x=await setup(t,{mode:'codex',automatic:true}),before=await x.repository.read()
 await x.repository.mutate({action:'new_incoming'},state=>{
  state.items.push({...x.item,id:'new1',title:'Первый conjoint-анализ'}, {...x.item,id:'new2',title:'Второй conjoint-анализ'}, {...x.item,id:'empty',body:''}, {...x.item,id:'backlog',lane:'backlog'})
  return {state,result:{},touchedIds:['new1','new2','empty','backlog']}
 })
 const after=await x.repository.read()
 await x.service.enqueueCreated(before,after,actor)
 const first=(await x.service.get('new1')).job,second=(await x.service.get('new2')).job
 assert.equal(first.status,'queued');assert.equal(first.automatic,true);assert.equal(second.status,'waiting')
 assert.equal(x.children.length,1);assert.equal((await x.service.get('empty')).job,null);assert.equal((await x.service.get('task')).job,null)
 await x.service.enqueueCreated(before,after,actor)
 assert.equal((await x.service.get('new1')).job.id,first.id);assert.equal(x.children.length,1)
 x.children[0].emit('message',{type:'review',review:{jobId:first.id,packetHash:first.packetHash,recommendation:{summary:'Проверить гипотезу.',verdict:'clarify',scores:proposedScores,relatedTasks:[]}}})
 await x.service.get('new1');x.children[0].kill();await new Promise(resolve=>setImmediate(resolve))
 assert.equal((await x.service.get('new2')).job.status,'queued');assert.equal(x.children.length,2)
 assert.equal((await x.repository.read()).items.find(i=>i.id==='new1').lane,'inbox')
 assert.equal((await x.repository.read()).items.find(i=>i.id==='new1').priorityScore,undefined)
 await x.service.cancel('new2',second.id);await new Promise(resolve=>setImmediate(resolve))
 await x.service.enqueueCreated(before,after,actor)
 assert.equal((await x.service.get('new2')).job.status,'cancelled');assert.equal(x.children.length,2)
})

test('авторазбор: задача, удалённая или перенесённая из очереди, не запускается',async t=>{
 const x=await setup(t,{mode:'codex',automatic:true}),before=await x.repository.read()
 await x.repository.mutate({action:'add'},state=>{state.items.push({...x.item,id:'waiting1'},{...x.item,id:'waiting2'});return {state,result:{},touchedIds:['waiting1','waiting2']}})
 await x.service.enqueueCreated(before,await x.repository.read(),actor)
 await x.repository.mutate({action:'move'},state=>{state.items.find(i=>i.id==='waiting2').lane='backlog';return {state,result:{},touchedIds:['waiting2']}})
 const first=(await x.service.get('waiting1')).job
 await x.service.cancel('waiting1',first.id);await new Promise(resolve=>setImmediate(resolve))
 assert.equal((await x.service.get('waiting2')).job.status,'cancelled');assert.equal(x.children.length,1)
})

test('авторазбор: включение и перезапуск не запускают старые задачи или повторные запросы',async t=>{
 const x=await setup(t,{mode:'codex',automatic:true}),before=await x.repository.read()
 await x.service.enqueueCreated(null,before,actor)
 assert.equal(x.children.length,0)
 await x.repository.mutate({action:'add'},state=>{state.items.push({...x.item,id:'new'});return {state,result:{},touchedIds:['new']}})
 const next=await x.repository.read();await x.service.enqueueCreated(before,next,actor)
 await x.service.close();await new Promise(resolve=>setImmediate(resolve))
 const restarted=createTrendwatchService(x.args);t.after(()=>restarted.close())
 await restarted.enqueueCreated(before,next,actor)
 assert.equal((await restarted.get('new')).job.status,'interrupted');assert.equal(x.children.length,1)
})

const draftInput={title:'Поисследовать цифровые дизайны',body:'Цель бизнеса — продать много цифровых дизайнов.'}
test('необязательный вопрос: один ответ, без изменений доски или архива, с ограничением частоты',async t=>{
 const x=await setup(t,{mode:'codex',automatic:true});const before=await x.repository.read()
 const result=x.service.clarifyDraft(draftInput,actor);await x.service.get('task')
 assert.equal(x.children.length,1)
 x.children[0].emit('message',{type:'review',review:{question:'Какие дизайны продаём?'}})
 assert.deepEqual(await result,{question:'Какие дизайны продаём?'})
 for(let i=1;i<3;i++){
  const next=x.service.clarifyDraft({...draftInput,body:draftInput.body+i},actor);await x.service.get('task')
  x.children[i].emit('message',{type:'review',review:{question:null}});assert.deepEqual(await next,{question:null})
 }
 assert.deepEqual(await x.service.clarifyDraft(draftInput,actor),{question:null});assert.equal(x.children.length,3)
 assert.deepEqual(await x.repository.read(),before);assert.equal((await x.service.get('task')).job,null)
})
test('сохранённая задача запускает оценку, не ожидая необязательного ответа; поздний вопрос игнорируется',async t=>{
 const x=await setup(t,{mode:'codex',automatic:true})
 const pending=x.service.clarifyDraft(draftInput,actor);await x.service.get('task')
 const draftChild=x.children[0],job=await x.start()
 assert.deepEqual(await pending,{question:null});assert.equal(draftChild.exitCode,0)
 assert.equal(job.priorityPolicy,'criteria-v2');assert.equal(x.children.length,2)
 draftChild.emit('message',{type:'review',review:{question:'Поздний вопрос'}})
 assert.equal((await x.service.get('task')).job.id,job.id)
 assert.deepEqual(await x.service.clarifyDraft(draftInput,{...actor,id:'another'}),{question:null})
 assert.equal(x.children.length,2)
})
test('черновик: отмена, таймаут, ошибка и некорректный ответ не блокируют сохранение',async t=>{
 for(const scenario of ['abort','timeout','error','invalid']){
  const x=await setup(t,{mode:'codex',automatic:true,clarificationTimeoutMs:20}),controller=new AbortController()
  const pending=x.service.clarifyDraft(draftInput,actor,controller.signal);await x.service.get('task')
  if(scenario==='abort')controller.abort()
  if(scenario==='timeout')await new Promise(resolve=>setTimeout(resolve,30))
  if(scenario==='error')x.children[0].emit('message',{type:'error',code:'CODEX_UNAVAILABLE'})
  if(scenario==='invalid')x.children[0].emit('message',{type:'review',review:{question:'x'.repeat(181)}})
  assert.deepEqual(await pending,{question:null});assert.equal(x.children[0].exitCode,0)
  assert.ok((await x.start()).id)
 }
})
test('уточнение выключено в ручном режиме и не запускается без сессии автооценки',async t=>{
 const x=await setup(t,{mode:'codex',automatic:false})
 assert.deepEqual(await x.service.clarifyDraft(draftInput,actor),{question:null});assert.equal(x.children.length,0)
 await assert.rejects(x.service.clarifyDraft({...draftInput,title:'a'},actor))
})

test('быстрое локальное уточнение не ждёт фонового веб-исследования',async t=>{
 const localChild=new Child()
 const x=await setup(t,{mode:'codex',automatic:true,draftLauncher:()=>localChild})
 await x.start()
 const pending=x.service.clarifyDraft(draftInput,actor);await x.service.get('task')
 localChild.emit('message',{type:'review',review:{question:'Какие дизайны продаём?'}})
 assert.deepEqual(await pending,{question:'Какие дизайны продаём?'})
 assert.equal(x.children.length,1);assert.equal(x.children[0].exitCode,null)
 assert.equal((await x.service.get('task')).job.status,'queued')
})

test('изменение исходной задачи исключает материалы прежней продуктовой трактовки',async t=>{
 const x=await setup(t,{mode:'codex'})
 const old=await x.start();x.children[0].kill();await new Promise(resolve=>setImmediate(resolve));await x.service.get('task')
 fs.writeFileSync(path.join(x.dir,'research',old.id,'materials.json'),JSON.stringify({sources:[{id:'old',title:'UI kits',url:'https://example.com/figma',text:'Figma UI kits '.repeat(20),retrievedAt:new Date().toISOString(),publishedAt:null}]}))
 const state=await x.repository.read();x.item.body='Исследовать продажи цифровых дизайнов. Категория продукта не определена.'
 state.items[0].body=x.item.body;await x.repository.replace(JSON.stringify(state),state.updatedAt)
 const next=await x.start()
 assert.equal(next.sourceCount,0);assert.equal(next.priorityPolicy,'criteria-v2');assert.equal(next.sourceJobId,null)
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(x.dir,'research',next.id,'materials.json'))).sources,[])
})

test('расчёт по критериям, пересмотр через 30 дней в бэклоге и сохранность решения человека',async t=>{
 const x=await setup(t,{mode:'codex'}),job=await x.start()
 const ready=async job=>{x.children.at(-1).emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Выхлоп повышает оценку, напряг ограничивает.',verdict:'clarify',scores:proposedScores,relatedTasks:[]}}});await x.service.get('task');x.children.at(-1).kill();await new Promise(r=>setImmediate(r))}
 await ready(job)
 let result=(await x.service.get('task')).job
 assert.equal(result.recommendation.score,6)
 const reviewAt=result.completedAt+30*86400000
 assert.equal(result.reviewAt,reviewAt);assert.equal(result.reviewDue,false)
 await x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:6},actor)
 let item=(await x.repository.read()).items[0]
 assert.deepEqual(item.scores,{impact:3,effort:4});assert.equal(item.priorityScore,undefined);assert.equal(item.lane,'backlog')
 await x.repository.mutate({action:'move'},state=>{state.items[0].lane='backlog';return{state,touchedIds:['task'],result:{}}})
 const before=await x.repository.read()
 const clock=t.mock.method(Date,'now',()=>reviewAt-1)
 assert.equal((await x.service.get('task')).job.reviewDue,false)
 clock.mock.mockImplementation(()=>reviewAt)
 assert.equal((await x.service.get('task')).job.reviewDue,true)
 assert.equal((await x.service.get('task')).job.stale,false)
 await assert.rejects(x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:9},actor),{statusCode:409})
 assert.deepEqual(await x.repository.read(),before)
 const refreshed=await x.start();await ready(refreshed)
 assert.deepEqual(await x.repository.read(),before)
 assert.equal((await x.service.get('task')).job.reviewDue,false)
 await x.service.confirm('task',{jobId:refreshed.id,requestId:randomUUID(),score:8},actor)
 item=(await x.repository.read()).items[0]
 assert.equal(item.priorityScore,8);assert.equal(item.lane,'backlog');assert.deepEqual(item.scores,{impact:3,effort:4})
 clock.mock.restore()
})

test('unknown criteria are not saved as zeros or inherited guesses; partial confirmation stays preliminary',async t=>{
 const x=await setup(t,{mode:'codex'})
 await x.repository.mutate({action:'old_guess'},state=>{state.items[0].scores={impact:1,effort:7};return {state,result:{},touchedIds:['task']}})
 const job=await x.start(),before=await x.repository.read()
 const scores=[{...proposedScores[0],value:2},{criterionId:'effort',value:null,reason:'Объём неизвестен.',basis:[]}]
 x.children[0].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Польза для выбора решения.',verdict:'clarify',scores,relatedTasks:[]}}})
 let result=(await x.service.get('task')).job
 assert.equal(result.recommendation.score,6.7);assert.equal(result.recommendation.preliminary,true)
 assert.deepEqual(await x.repository.read(),before)
 x.children[0].kill()
 await x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:6.7},actor)
 const item=(await x.repository.read()).items[0]
 assert.deepEqual(item.scores,{impact:2});assert.equal(item.priorityScore,undefined)
 assert.equal(item.trendwatchDecision.preliminary,true);assert.equal(item.trendwatchDecision.score,6.7)
 result=(await x.service.get('task')).job
 assert.equal(result.stale,false);assert.equal(result.decision.preliminary,true)
})

test('concept MVP persists profile, requires human confirmation, preserves old criteria and invalidates on inbox changes',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},state=>{state.items[0].scores={impact:1,effort:7};state.items.push({...state.items[0],id:'other',title:'Соседняя идея'});return{state,touchedIds:['task','other'],result:{}}})
 const job=await x.start(),before=await x.repository.read()
 assert.equal(job.priorityPolicy,'concept-mvp-v1');assert.equal(job.teamContext.version,'fintech-concepts-1');assert.equal(job.boardContext.items[0].id,'other')
 x.children[0].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Синтетический вывод.',verdict:'clarify',score:6,assessmentKind:'market_idea',matrixBucket:'research-next',decisionValue:'Решить, применять ли подход.',comparison:{status:'insufficient',itemIds:[],reason:'Пока нет материалов для сравнения.'},rationale:'Польза MVP команде.',limitations:'Нет внешних оснований.',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Нет местных данных.',sourceUrls:[]},relatedTasks:[]}}})
 assert.equal((await x.service.get('task')).job.status,'ready')
 assert.deepEqual(await x.repository.read(),before)
 x.children[0].kill()
 await x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:8},actor)
 const item=(await x.repository.read()).items[0]
 assert.equal(item.priorityScore,8);assert.equal(item.trendwatchDecision.score,8);assert.deepEqual(item.scores,{impact:1,effort:7});assert.equal(item.lane,'backlog')
 assert.equal((await x.service.get('task')).job.stale,false)
 await x.repository.mutate({action:'edit'},state=>{state.items[1].body='Изменён контекст соседней идеи';return{state,touchedIds:['other'],result:{}}})
 assert.equal((await x.service.get('task')).job.stale,true)
 await assert.rejects(x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:7},actor),{statusCode:409})
})

test('comments enter new analysis, edits invalidate it, and confirmed scores survive',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true,webSearch:true})
 const comment={id:'support',itemId:'task',authorId:'m1',text:'Синтетический замер: 6 часов за неделю.',createdAt:1}
 await x.repository.mutate({action:'comment'},state=>{state.items.push({...x.item,id:'other'});state.comments.push(comment);return{state,touchedIds:['task'],result:{}}})
 const finish=async job=>{
  x.children.at(-1).emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Тестовый вывод.',score:6,verdict:'clarify',assessmentKind:'market_idea',matrixBucket:'research-next',decisionValue:'Решить, применять ли подход.',comparison:{status:'insufficient',itemIds:[],reason:'Пока нет материалов для сравнения.'},rationale:'По комментарию автора.',limitations:'Тест',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Не проверено',sourceUrls:[]},relatedTasks:[]},searchOutcome:'insufficient',sources:[]},web:{calls:1,queries:1,urls:[]}})
  assert.equal((await x.service.get('task')).job.status,'ready');x.children.at(-1).kill();await new Promise(r=>setImmediate(r))
 }
 let job=await x.start()
 assert.equal(job.commentContext.items[0].text,comment.text);assert.equal(job.webSearch,true)
 await finish(job)
 await x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:8},actor)
 const saved=(await x.repository.read()).items[0].trendwatchDecision
 await x.repository.mutate({action:'other-comment'},state=>{state.comments.push({...comment,id:'elsewhere',itemId:'other',text:'Не передавать'});return{state,touchedIds:[],result:{}}})
 assert.equal((await x.service.get('task')).job.stale,false)
 await x.repository.mutate({action:'edit-comment'},state=>{state.comments[0].text='Синтетическое исправление: 3 часа, не 6.';return{state,touchedIds:['task'],result:{}}})
 assert.equal((await x.service.get('task')).job.stale,true)
 await assert.rejects(x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:9},actor),{statusCode:409})
 const previousHash=job.packetHash;job=await x.start()
 assert.notEqual(job.packetHash,previousHash);assert.match(job.commentContext.items[0].text,/3 часа/);assert.equal(job.commentContext.total,1)
 await finish(job)
 await x.repository.mutate({action:'delete-comment'},state=>{state.comments=state.comments.filter(c=>c.id!=='support');return{state,touchedIds:['task'],result:{}}})
 assert.equal((await x.service.get('task')).job.stale,true)
 assert.deepEqual((await x.repository.read()).items[0].trendwatchDecision,saved)
 assert.equal((await x.repository.read()).items[0].priorityScore,8)
})

test('backlog batch: all 39 tasks run serially on one snapshot; scores change only on confirmation',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true,webSearch:true})
 await x.repository.mutate({action:'seed-backlog'},state=>{state.items=Array.from({length:39},(_,i)=>({...x.item,id:`task-${i}`,title:`Синтетическая задача ${i}`,body:i?'Синтетическое описание':'',lane:'backlog',scores:{impact:1,effort:2},priorityScore:4}));return{state,result:{}}})
 const before=await x.repository.read(),request={requestId:randomUUID()}
 const first=await x.service.startBacklog(request,actor)
 assert.equal(first.batch.total,39);assert.equal(first.batch.active,true);assert.equal(x.children.length,1)
 assert.equal((await x.service.startBacklog(request,actor)).batch.id,first.batch.id)
 await assert.rejects(x.service.startBacklog({requestId:randomUUID()},actor),{statusCode:429})
 for(let i=0;i<39;i++){
  const job=(await x.service.get(`task-${i}`)).job
  assert.equal(job.batchId,request.requestId);assert.equal(job.status,'queued');assert.equal(job.boardContext.items.length,38)
  assert.equal(x.children.length,i+1)
  x.children[i].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Синтетический разбор.',score:i%11,verdict:'clarify',assessmentKind:'market_idea',matrixBucket:'research-next',decisionValue:'Решить, применять ли подход.',comparison:{status:'insufficient',itemIds:[],reason:'Пока нет материалов для сравнения.'},rationale:'Тест приоритета',limitations:'Тест',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Тест',sourceUrls:[]},relatedTasks:[]},searchOutcome:'insufficient',sources:[]},web:{calls:1,queries:1,urls:[]}})
  assert.equal((await x.service.get(`task-${i}`)).job.status,'ready')
  x.children[i].kill();await new Promise(r=>setImmediate(r));await x.service.backlog()
 }
 const completed=await x.service.backlog()
 assert.equal(completed.batch.ready,39);assert.equal(completed.batch.active,false)
 assert.deepEqual(await x.repository.read(),before)
 const job=(await x.service.get('task-0')).job
 await x.service.confirm('task-0',{requestId:randomUUID(),jobId:job.id,score:8},actor)
 const after=await x.repository.read()
 assert.equal(after.items[0].priorityScore,8);assert.equal(after.items[0].lane,'backlog');assert.deepEqual(after.items[0].scores,before.items[0].scores)
 assert.deepEqual(after.items.slice(1),before.items.slice(1))
})

test('backlog queue: changed comments skip a task; cancellation stops the remaining work',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},state=>{state.items=Array.from({length:3},(_,i)=>({...x.item,id:`task-${i}`,lane:'backlog'}));return{state,result:{}}})
 const batch=await x.service.startBacklog({requestId:randomUUID()},actor)
 await x.repository.mutate({action:'comment'},state=>{state.comments.push({id:'c',itemId:'task-1',authorId:'m1',text:'Новые данные',createdAt:1});return{state,result:{}}})
 x.children[0].kill();await new Promise(r=>setImmediate(r));await x.service.backlog()
 assert.equal((await x.service.get('task-0')).job.status,'failed')
 assert.equal((await x.service.get('task-1')).job.status,'cancelled')
 assert.equal((await x.service.get('task-2')).job.status,'queued')
 assert.equal(x.children.length,2)
 await assert.rejects(x.service.cancelBacklog({batchId:batch.batch.id},{id:'other'}),{statusCode:403})
 await assert.rejects(x.service.cancelBacklog({},actor),{statusCode:422})
 await x.service.cancelBacklog({batchId:batch.batch.id},actor)
 assert.equal((await x.service.get('task-2')).job.status,'cancelled')
 assert.equal((await x.service.backlog()).batch.active,false)
})

test('backlog queue: restart interrupts pending jobs and never resumes spending automatically',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},state=>{state.items=[{...x.item,lane:'backlog'},{...x.item,id:'second',lane:'backlog'}];return{state,result:{}}})
 await x.service.startBacklog({requestId:randomUUID()},actor)
 await x.service.close();await new Promise(r=>setImmediate(r))
 const restarted=createTrendwatchService(x.args)
 t.after(()=>restarted.close())
 const result=await restarted.backlog()
 assert.equal(result.batch.active,false);assert.equal(result.batch.failed,2);assert.equal(x.children.length,1)
})

test('backlog explains incompatible research mode without creating a job',async t=>{
 for(const mode of ['assisted','runtime']){
  const x=await setup(t,{mode})
  await x.repository.mutate({action:'seed'},state=>{state.items[0].lane='backlog';return{state,result:{}}})
  await assert.rejects(x.start(),{statusCode:409,message:'Для оценки бэклога включите режим Codex или OpenRouter.'})
  assert.equal(x.children.length,0)
  assert.equal((await x.service.get('task')).job,null)
 }
})

test('adaptive internal review stores zero web usage and leaves old scores intact',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true,webSearch:true})
 const before=await x.repository.read(),job=await x.start()
 assert.equal(job.evidencePolicy,'adaptive-signals-v4')
 x.children[0].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{assessmentKind:'bug',matrixBucket:'take-next',summary:'Тест исправления',score:6,verdict:'clarify',decisionValue:'Решить, применять ли подход.',comparison:{status:'insufficient',itemIds:[],reason:'Пока нет материалов для сравнения.'},rationale:'Влияние ошибки',limitations:'Тест',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Не требуется',sourceUrls:[]},relatedTasks:[]},searchOutcome:'not_needed',sources:[]},web:{calls:0,queries:0,urls:[]}})
 const ready=(await x.service.get('task')).job
 assert.equal(ready.status,'ready');assert.equal(ready.searchOutcome,'not_needed');assert.deepEqual(ready.webUsage,{calls:0,queries:0});assert.match(ready.message,/без нового поиска/)
 assert.deepEqual(await x.repository.read(),before)
})

async function finishAdaptive(x,job,score=7,comparison=null){
 x.children.at(-1).emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{assessmentKind:'internal_improvement',matrixBucket:'automate',summary:'Тест внутренней пользы',score,verdict:'recommend',decisionValue:'Решить, применять ли подход.',comparison:comparison??{status:'insufficient',itemIds:[],reason:'Пока нет материалов для сравнения.'},rationale:'Проверено на тесте',limitations:'Тест',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Не требуется',sourceUrls:[]},relatedTasks:[]}}})
 assert.equal((await x.service.get(job.itemId)).job.status,'ready')
 x.children.at(-1).kill();await new Promise(r=>setImmediate(r))
}

test('monthly review runs once, remains red until lead decision and preserves a manual bucket move',async t=>{
 let now=1800000000000;t.mock.method(Date,'now',()=>now)
 const x=await setup(t,{mode:'codex',conceptReview:true,automatic:true})
 await x.repository.mutate({action:'seed'},state=>{Object.assign(state.items[0],{lane:'backlog',priorityScore:5,matrixBucket:'research-next',createdAt:now});return{state,result:{}}})
 const first=await x.start();await finishAdaptive(x,first)
 await x.service.confirm('task',{jobId:first.id,requestId:randomUUID(),score:5},actor)
 now+=30*86400000-1;await x.service.maintainReviews();assert.equal(x.children.length,1)
 now++;await x.service.maintainReviews();assert.equal(x.children.length,2)
 const refreshed=(await x.service.get('task')).job;assert.equal(refreshed.reviewCycleDueAt,now)
 await x.service.maintainReviews();assert.equal(x.children.length,2)
 await x.repository.mutate({action:'manual-move'},state=>{state.items[0].matrixBucket='take-next';return{state,result:{}}})
 await finishAdaptive(x,refreshed,8)
 assert.equal((await x.service.get('task')).job.stale,false)
 assert.equal((await x.service.get('task')).review.needsDecision,true)
 assert.equal((await x.repository.read()).items[0].priorityScore,5)
 await assert.rejects(x.service.confirm('task',{jobId:refreshed.id,requestId:randomUUID(),score:8,matrixBucket:'automate',expectedMatrixBucket:'research-next'},actor),{statusCode:409})
 await x.service.confirm('task',{jobId:refreshed.id,requestId:randomUUID(),score:8},actor)
 assert.equal((await x.repository.read()).items[0].matrixBucket,'take-next')
 await x.repository.mutate({action:'move-after-confirm'},state=>{state.items[0].matrixBucket='need-finish';return{state,result:{}}})
 assert.equal((await x.service.get('task')).job.stale,false)
 await x.repository.mutate({action:'move-back'},state=>{state.items[0].matrixBucket='take-next';return{state,result:{}}})
 assert.equal((await x.service.get('task')).review.needsDecision,false)
 await x.service.confirm('task',{jobId:refreshed.id,requestId:randomUUID(),score:8,matrixBucket:'automate',expectedMatrixBucket:'take-next'},actor)
 assert.equal((await x.repository.read()).items[0].matrixBucket,'automate')
 await x.service.confirm('task',{jobId:refreshed.id,requestId:randomUUID(),score:0},actor)
 assert.equal((await x.repository.read()).items[0].matrixBucket,null)
})

test('14 days overdue returns to unreviewed once, preserving score and former bucket; lead can keep or reject',async t=>{
 let now=1800000000000;t.mock.method(Date,'now',()=>now)
 const x=await setup(t,{mode:'codex',conceptReview:true,automatic:true})
 await x.repository.mutate({action:'seed'},state=>{Object.assign(state.items[0],{lane:'backlog',priorityScore:5,matrixBucket:'research-next',createdAt:now});state.items.push({...state.items[0],id:'inbox',lane:'inbox'});return{state,result:{}}})
 now+=30*86400000;await x.service.maintainReviews();const job=(await x.service.get('task')).job
 await finishAdaptive(x,job,8)
 assert.equal((await x.service.get('task')).review.needsDecision,true)
 now+=14*86400000-1;await x.service.maintainReviews();assert.equal((await x.repository.read()).items[0].matrixBucket,'research-next')
 now++;await x.service.maintainReviews()
 let state=await x.repository.read(),item=state.items[0]
 assert.equal(item.priorityScore,5);assert.equal(item.matrixBucket,null);assert.equal(item.priorityReview.previousBucket,'research-next');assert.equal(item.priorityReview.reason,'overdue')
 assert.equal(state.items[1].matrixBucket,'research-next');assert.equal(x.children.length,1)
 await x.repository.mutate({action:'manual-restore'},s=>{s.items[0].matrixBucket='take-next';return{state:s,result:{}}})
 await x.service.maintainReviews();assert.equal((await x.repository.read()).items[0].matrixBucket,'take-next')
 state=await x.repository.read();await x.service.decideReview('task',{action:'keep',requestId:randomUUID(),expectedUpdatedAt:state.updatedAt},actor)
 assert.equal((await x.service.get('task')).review.needsDecision,false)
 state=await x.repository.read();const request={action:'reject',requestId:randomUUID(),expectedUpdatedAt:state.updatedAt}
 await x.service.decideReview('task',request,actor);assert.equal((await x.service.decideReview('task',request,actor)).deduplicated,true)
 state=await x.repository.read();assert.equal(state.items[0].matrixBucket,null);assert.equal(state.items[0].priorityScore,5);assert.equal(state.items[0].priorityReview.reason,'rejected')
 const forged=structuredClone(state);forged.items[0].priorityReview={reviewedAt:now+99999999999}
 await x.repository.replace(JSON.stringify(forged),state.updatedAt,[],actor)
 assert.deepEqual((await x.repository.read()).items[0].priorityReview,state.items[0].priorityReview)
})

test('failed scheduled review does not retry after restart or change saved priority',async t=>{
 let now=1800000000000;t.mock.method(Date,'now',()=>now)
 const x=await setup(t,{mode:'codex',conceptReview:true,automatic:true})
 await x.repository.mutate({action:'seed'},state=>{Object.assign(state.items[0],{lane:'backlog',priorityScore:5,matrixBucket:'automate',createdAt:now-30*86400000});return{state,result:{}}})
 await x.service.maintainReviews();assert.equal(x.children.length,1)
 x.children[0].emit('message',{type:'error',code:'CODEX_UNAVAILABLE'});await x.service.get('task');await new Promise(r=>setImmediate(r))
 await x.service.close();const restarted=createTrendwatchService(x.args);t.after(()=>restarted.close())
 await restarted.maintainReviews();assert.equal(x.children.length,1)
 assert.equal((await x.repository.read()).items[0].priorityScore,5)
 assert.equal((await restarted.get('task')).review.needsDecision,true)
})


test('invented related task is rejected with a specific reason without changing saved scores',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 const initial=await x.repository.read();initial.items[0].priorityScore=4
 await x.repository.replace(JSON.stringify(initial),initial.updatedAt,[],actor)
 const before=await x.repository.read(),job=await x.start()
 x.children[0].emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation:{summary:'Синтетический вывод.',verdict:'clarify',score:6,assessmentKind:'internal_improvement',matrixBucket:'research-next',decisionValue:'Решить, применять ли подход.',comparison:{status:'insufficient',itemIds:[],reason:'Пока нет материалов для сравнения.'},rationale:'Тест связей.',limitations:'Тест.',evidenceStrength:'limited',regionalApplicability:{status:'unknown',summary:'Не требуется.',sourceUrls:[]},relatedTasks:[{itemId:'invented-id',reason:'Такой задачи нет.'}]}}})
 const result=await x.service.get('task')
 assert.equal(result.job.status,'failed')
 assert.match(result.job.message,/ИИ сослался на задачу, которой нет/)
 assert.equal(JSON.parse(fs.readFileSync(path.join(x.dir,'research',job.id,'job.json'),'utf8')).errorCode,'UNKNOWN_RELATED_TASK')
 assert.deepEqual(await x.repository.read(),before)
})

test('peer evidence is frozen per analysis; new reports do not overwrite it and changed comments invalidate it',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},s=>{s.items.push({...x.item,id:'peer',title:'Другой подход',priorityScore:3});return{state:s,result:{}}})
 const runPeer=()=>x.service.start('peer',{requestId:randomUUID(),title:'Другой подход',body:x.item.body},actor)
 const peer=await runPeer();await finishAdaptive(x,peer,8)
 const before=await x.repository.read(),job=await x.start()
 assert.equal(job.comparisonContext.items.length,1);assert.equal(job.comparisonContext.items[0].jobId,peer.id)
 assert.equal('score' in job.comparisonContext.items[0],false)
 await finishAdaptive(x,job,8)
 assert.deepEqual(await x.repository.read(),before)
 const newer=await runPeer();await finishAdaptive(x,newer,5)
 let result=(await x.service.get('task')).job
 assert.equal(result.stale,false);assert.equal(result.comparisonContext.items[0].jobId,peer.id)
 await x.repository.mutate({action:'comment'},s=>{s.comments.push({id:'new',itemId:'peer',authorId:'m1',text:'Изменившееся основание.',createdAt:Date.now()});return{state:s,result:{}}})
 result=(await x.service.get('task')).job;assert.equal(result.stale,true)
 const next=await x.start();assert.deepEqual(next.comparisonContext.items,[])
})

test('comparison finds ready peer evidence outside the brief board context',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},s=>{
  for(let n=0;n<45;n++)s.items.push({...x.item,id:`near-${n}`,createdAt:n+2})
  s.items.push({...x.item,id:'peer',title:'Другой подход',body:'Изучить перспективность нового метода.'})
  return{state:s,result:{}}
 })
 const peer=await x.service.start('peer',{requestId:randomUUID(),title:'Другой подход',body:'Изучить перспективность нового метода.'},actor)
 await finishAdaptive(x,peer,8)
 const job=await x.start()
 assert.equal(job.boardContext.items.some(i=>i.id==='peer'),false)
 assert.deepEqual(job.comparisonContext.items.map(i=>i.itemId),['peer'])
})

test('a new peer score retires the old comparison without changing the task score or board',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},s=>{s.items.push({...x.item,id:'peer',title:'Другой подход',priorityScore:10});return{state:s,result:{}}})
 const startPeer=()=>x.service.start('peer',{requestId:randomUUID(),title:'Другой подход',body:x.item.body},actor)
 await finishAdaptive(x,await startPeer(),6)
 const before=await x.repository.read(),job=await x.start()
 assert.equal(job.comparisonContext.items[0].aiScore,6)
 await finishAdaptive(x,job,7,{status:'advantage',itemIds:['peer'],reason:'Общий процесс пригодится чаще.'})
 assert.equal((await x.service.get('task')).job.comparisonCurrent,true)
 await finishAdaptive(x,await startPeer(),6)
 assert.equal((await x.service.get('task')).job.comparisonCurrent,true)
 await finishAdaptive(x,await startPeer(),8)
 const result=(await x.service.get('task')).job
 assert.equal(result.comparisonCurrent,false)
 assert.equal(result.recommendation.score,7)
 assert.equal(result.stale,false)
 assert.deepEqual(await x.repository.read(),before)
})

test('contradictory comparison is rejected with an explanation and never changes saved scores',async t=>{
 const x=await setup(t,{mode:'codex',conceptReview:true})
 await x.repository.mutate({action:'seed'},s=>{s.items.push({...x.item,id:'peer',title:'Другой подход'});return{state:s,result:{}}})
 const peer=await x.service.start('peer',{requestId:randomUUID(),title:'Другой подход',body:x.item.body},actor)
 await finishAdaptive(x,peer,6)
 const before=await x.repository.read(),job=await x.start()
 const recommendation={...(await x.service.get('peer')).job.recommendation,score:7,comparison:{status:'equal',itemIds:['peer'],reason:'Равный приоритет при разных баллах.'}}
 x.children.at(-1).emit('message',{type:'review',review:{jobId:job.id,packetHash:job.packetHash,recommendation}})
 const result=(await x.service.get('task')).job
 assert.equal(result.status,'failed');assert.match(result.message,/Балл ИИ противоречит/)
 assert.deepEqual(await x.repository.read(),before)
})

for(const mode of ['codex','openrouter'])test(`${mode}: inbox confirmation preserves AI score; backlog review is available`,async t=>{
 const x=await setup(t,{mode,conceptReview:true})
 const before=await x.repository.read(),job=await x.start()
 await finishAdaptive(x,job,7)
 assert.deepEqual(await x.repository.read(),before)
 await x.service.confirm('task',{jobId:job.id,requestId:randomUUID(),score:9},actor)
 const state=await x.repository.read()
 assert.equal(state.items[0].lane,'backlog')
 assert.equal(state.items[0].priorityScore,9)
 assert.equal((await x.service.get('task')).job.recommendation.score,7)
 const next=await x.start()
 assert.equal(next.mode,mode)
 assert.equal(next.format,'quick-v1')
})
