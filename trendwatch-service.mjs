import { conceptTeamContext } from './trendwatch-concepts.mjs'
import { reviewDate, priorityReviewState, REVIEW_PERIOD_MS } from './priority-score.mjs'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { startSchema, confirmationSchema, snapshot, fingerprint, validScore, validatedRecommendation, researchStopMessage } from './trendwatch-contract.mjs'
import { compactMaterials, packetHash, reviewPacket, reviewImportSchema, validateSavedReview, reviewReport } from './trendwatch-lite.mjs'
import { launchOpenRouter, openRouterErrorMessage, safeOpenRouterDiagnostics } from './trendwatch-openrouter.mjs'
import { launchCodex, codexErrorMessage } from './trendwatch-codex.mjs'
import { boardContext, taskComments, comparisonContext, comparisonInputsMatch, quickHash, quickConfirmationSchema, validateQuickReview, quickReport, draftInputSchema, draftReviewSchema } from './trendwatch-quick.mjs'
import { withActor } from './portal-auth.mjs'

const workerFile = fileURLToPath(new URL('./trendwatch-worker.mjs', import.meta.url))
const quickMode=mode=>['codex','openrouter'].includes(mode)
const activeStatuses = new Set(['waiting','queued','running'])
const stages = new Set(['planning','collecting','analyzing','organizing','synthesizing','evaluating','validating','improving','summarizing','prioritizing'])
const fail = (statusCode,message) => Object.assign(new Error(message),{statusCode})
function writeJson(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700})
  const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file)
}
export function createTrendwatchService({ repository, directory, enabled=false, root='', envFile, mode='runtime', automatic=false, webSearch=false, conceptReview=false,
  clarificationTimeoutMs=2500, reviewIntervalMs=0,
  launch=(jobDirectory)=>mode==='codex'?launchCodex(jobDirectory):mode==='openrouter'?launchOpenRouter(jobDirectory):fork(workerFile,[],{cwd:jobDirectory,env:{...process.env,FUNBAN_TRENDWATCH_ROOT:root,
    ...(envFile?{FUNBAN_TRENDWATCH_ENV_FILE:envFile}:{}),NODE_OPTIONS:'',RESEARCH_PRESENTATION:'false'},silent:true}),
  draftLauncher, closeDraft=()=>{},
  timeoutMs=(quickMode(mode)?5:15)*60*1000,
}) {
  if(!['runtime','assisted','codex','openrouter'].includes(mode))throw new Error('Unknown research mode')
  const jobs=new Map(), children=new Map()
  const draftRequests=new Map()
  let draft=null
  let queue=Promise.resolve(), closed=false, storageError=false
  const exclusive=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next}
  const save=job=>writeJson(path.join(directory,job.id,'job.json'),job)
  try { if(fs.existsSync(directory)) for(const id of fs.readdirSync(directory)) {
    if(!/^[a-f0-9-]{36}$/.test(id))continue
    const job=JSON.parse(fs.readFileSync(path.join(directory,id,'job.json'),'utf8'))
    if(job.id!==id)throw new Error('Некорректные данные исследования')
    // Older adapters dropped stopReason; recover it without rewriting the archive.
    if(job.status==='insufficient'&&!job.stopReason&&fs.existsSync(path.join(directory,id,'run.json'))){
      try{job.stopReason=JSON.parse(fs.readFileSync(path.join(directory,id,'run.json'),'utf8')).stopReason}catch{/* Keep the original message when the old report cannot be read. */}
    }
    if(activeStatuses.has(job.status)){job.status='interrupted';job.message='Исследование прервано перезапуском сервера. Повторный запуск выполняется вручную.';save(job)}
    jobs.set(id,job)
  } } catch { storageError=true; console.error('Trendwatch storage is unavailable; manual task review remains available.') }
  const available=()=>enabled&&!closed&&!storageError
  const latest=itemId=>[...jobs.values()].filter(job=>job.itemId===itemId).sort((a,b)=>b.createdAt-a.createdAt)[0]
  const reviewState=(item)=>priorityReviewState(item,[...jobs.values()].filter(j=>j.itemId===item.id&&j.status==='ready').map(j=>j.completedAt??j.createdAt).sort((a,b)=>a-b)[0])
  const snapshotMatches=(job,item,criteria)=>{
    const capture=snapshot(item,criteria)
    if(['adaptive-signals-v2','adaptive-signals-v3','adaptive-signals-v4'].includes(job.evidencePolicy))capture.matrixBucket=job.snapshot.matrixBucket
    return fingerprint(capture)===job.fingerprint
  }
  const commentsMatch=(job,state,item)=>job.commentContext?fingerprint(job.commentContext)===fingerprint(taskComments(state,item)):job.priorityPolicy!=='concept-mvp-v1'||taskComments(state,item).total===0
  const isStale=(job,state)=>!state?.items.some(item=>{
    if(item.id!==job.itemId)return false
    const confirmedCapture=snapshot(item,state.criteria)
    if(['adaptive-signals-v2','adaptive-signals-v3','adaptive-signals-v4'].includes(job.evidencePolicy)&&item.trendwatchDecision)confirmedCapture.matrixBucket=item.trendwatchDecision.matrixBucket
    const confirmed=item.trendwatchDecision?.jobId===job.id&&item.trendwatchDecision.reviewFingerprint===fingerprint(confirmedCapture)
    return (snapshotMatches(job,item,state.criteria)||confirmed)&&commentsMatch(job,state,item)&&comparisonInputsMatch(job.comparisonContext,state)&&(!job.boardContext||fingerprint(boardContext(state,item,job.priorityPolicy==='concept-mvp-v1'))===fingerprint(job.boardContext))
  })
  const comparisonFor=(state,item,sourceJobs=[...jobs.values()])=>comparisonContext(state,item,{items:state.items},sourceJobs.filter(j=>!isStale(j,state)))
  const comparisonCurrent=(job,state)=>job.evidencePolicy!=='adaptive-signals-v4'||!job.recommendation?.comparison||job.recommendation.comparison.status==='insufficient'||job.recommendation.comparison.itemIds.every(id=>{
    const peer=job.comparisonContext?.items.find(i=>i.itemId===id)
    const current=[...jobs.values()].filter(j=>j.itemId===id&&j.status==='ready'&&!isStale(j,state)).sort((a,b)=>b.createdAt-a.createdAt)[0]
    return peer&&current&&peer.aiScore===current.recommendation?.score
  })
  const publicJob=(job,state)=>job?{id:job.id,itemId:job.itemId,status:job.status,stage:job.stage,createdAt:job.createdAt,completedAt:job.completedAt,
    reviewCycleDueAt:job.reviewCycleDueAt,batchId:job.batchId,priorityPolicy:job.priorityPolicy,teamContext:job.teamContext,commentContext:job.commentContext,evidencePolicy:job.evidencePolicy,webSearch:job.webSearch??false,searchOutcome:job.searchOutcome,webUsage:job.webUsage,automatic:job.automatic??false,format:job.format,boardContext:job.boardContext,comparisonContext:job.comparisonContext,mode:job.mode??'runtime',packetHash:job.packetHash,sourceJobId:job.sourceJobId,sourceCount:job.sourceCount,
    sourceMessage:researchStopMessage(job.sourceStopReason),stopReason:job.stopReason,
    context:job.context,snapshot:job.snapshot,recommendation:job.recommendation??null,evidence:job.evidence??[],message:(job.status==='insufficient'?researchStopMessage(job.stopReason):null)||job.message||null,
    failure:job.status==='failed'&&job.mode==='openrouter'&&openRouterErrorMessage(job.errorCode)?{code:job.errorCode,...safeOpenRouterDiagnostics(job.errorDiagnostics)}:null,
    stale:isStale(job,state),comparisonCurrent:comparisonCurrent(job,state),reviewAt:reviewDate(job),reviewDue:reviewDate(job)!==null&&Date.now()>=reviewDate(job),
    decision:state?.items.find(item=>item.id===job.itemId)?.trendwatchDecision??null}:null
  function terminate(child){child.kill('SIGTERM');const t=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL')},2000);t.unref();child.once('close',()=>clearTimeout(t))}
  async function pump(){
    if(!available()||children.size)return
    for(const job of [...jobs.values()].filter(j=>j.status==='waiting').sort((a,b)=>a.createdAt-b.createdAt)){
      const state=await repository.read(),item=state?.items.find(i=>i.id===job.itemId)
      if(!item||item.lane!==(job.batchId?'backlog':'inbox')||!snapshotMatches(job,item,state.criteria)||!commentsMatch(job,state,item)||(job.batchId&&isStale(job,state))){
        job.status='cancelled';job.message='Задача или контекст изменились до запуска. Повторите анализ вручную.';save(job);continue
      }
      if(!job.batchId){job.boardContext=boardContext(state,item,job.priorityPolicy==='concept-mvp-v1');if(['adaptive-signals-v3','adaptive-signals-v4'].includes(job.evidencePolicy))job.comparisonContext=comparisonFor(state,item)}
      const {sources}=JSON.parse(fs.readFileSync(path.join(directory,job.id,'materials.json'),'utf8'))
      job.packetHash=quickHash(job,sources);job.status='queued';job.stage='prioritizing';job.message=null;save(job)
      run(job)
      if(children.size)return
    }
  }
  function run(job) {
    let child
    try{child=launch(path.join(directory,job.id));children.set(job.id,child)}catch{job.status='failed';job.message='Не удалось запустить исследование. Проверьте локальное подключение Trendwancher.';save(job);return}
    child.stdout?.resume();child.stderr?.resume()
    const deadline=setTimeout(()=>void exclusive(()=>{if(activeStatuses.has(job.status)){job.status='failed';job.message='Достигнут лимит времени исследования. Материалы сохранены, оценку можно выставить вручную.';save(job);terminate(child)}}),timeoutMs)
    deadline.unref()
    child.on('message',message=>void exclusive(()=>{
      if(!activeStatuses.has(job.status))return
      try{
        if(JSON.stringify(message).length>500000)throw new Error('RESULT_TOO_LARGE')
        if(message?.type==='stage'&&stages.has(message.stage)){job.status='running';job.stage=message.stage;save(job)}
        else if(message?.type==='error'){job.status='failed';job.message=openRouterErrorMessage(message.code)||codexErrorMessage(message.code)||'Исследование не завершилось. Проверьте подключение поиска, модели и доступный лимит; задачу можно оценить вручную.';job.errorCode=String(message.code).slice(0,100);if(typeof message.itemType==='string'&&/^[a-zA-Z_]{1,64}$/.test(message.itemType))job.errorItemType=message.itemType;if(job.mode==='openrouter'){job.errorDiagnostics=safeOpenRouterDiagnostics(message.diagnostics);job.completedAt=Date.now()}else if(message.diagnostics&&JSON.stringify(message.diagnostics).length<1000)job.errorDiagnostics=message.diagnostics;save(job);if(quickMode(job.mode))terminate(child)}
        else if(message?.type==='review'&&quickMode(job.mode)){
          if(job.webSearch)writeJson(path.join(directory,job.id,'web-response.json'),{review:message.review,web:message.web??null})
          const input=job.format==='quick-v1'?message.review:reviewImportSchema.parse(message.review)
          const {sources}=JSON.parse(fs.readFileSync(path.join(directory,job.id,'materials.json'),'utf8'))
          if(job.format!=='quick-v1'&&(input.jobId!==job.id||input.packetHash!==job.packetHash||packetHash(job,sources)!==job.packetHash))throw new Error('PACKET_MISMATCH')
          const result=job.format==='quick-v1'?validateQuickReview(input,job,sources,message.web):validateSavedReview(input,job,sources)
          Object.assign(job,result,{status:'ready',completedAt:Date.now(),message:job.webSearch&&result.searchOutcome!=='not_needed'?'Короткая оценка с лёгким веб-поиском. Итог подтверждает человек.':job.format==='quick-v1'?'Короткая оценка по задаче и контексту доски, без нового поиска. Итог подтверждает человек.':'Короткий разбор Codex по сохранённым материалам. Нового поиска не было. Цитаты сверены с архивом; оценку подтверждает человек.'})
          if(message.usage)job.usage=Object.fromEntries(['input_tokens','cached_input_tokens','output_tokens'].filter(k=>Number.isSafeInteger(message.usage[k])&&message.usage[k]>=0).map(k=>[k,message.usage[k]]))
          fs.writeFileSync(path.join(directory,job.id,'report.md'),(job.format==='quick-v1'?quickReport(job):reviewReport(job)),{mode:0o600});save(job)
        }
        else if(message?.type==='result'){
          const result=message.result
          if(!['ready','insufficient'].includes(result?.status)||!Array.isArray(result.evidence)||result.evidence.length>24)throw new Error('RESULT_SCHEMA')
          for(const entry of result.evidence){const url=new URL(entry.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||typeof entry.id!=='string'||typeof entry.quote!=='string')throw new Error('EVIDENCE_SCHEMA')}
          const recommendation=result.status==='ready'?validatedRecommendation(result.recommendation,job.snapshot.criteria,result.evidence):null
          Object.assign(job,{status:result.status,recommendation,evidence:result.evidence,stopReason:typeof result.stopReason==='string'?result.stopReason.slice(0,100):null,message:typeof result.message==='string'?result.message.slice(0,2000):null,completedAt:Date.now()});save(job)
        }
      }catch(error){job.status='failed';job.message=error.message==='INCONSISTENT_PRIORITY_COMPARISON'?'Балл ИИ противоречит сравнению с другими задачами. Ответ отклонён; сохранённая оценка не изменена.':error.message==='UNKNOWN_RELATED_TASK'?'ИИ сослался на задачу, которой нет в переданном контексте доски. Ответ отклонён; сохранённая оценка не изменена.':'Ответ исследования не прошёл проверку. Оценки задачи не изменены.';if(['INCONSISTENT_PRIORITY_COMPARISON','INVALID_PRIORITY_COMPARISON','WEB_SEARCH_NOT_VERIFIED','MISSING_WEB_EVIDENCE','UNKNOWN_WEB_SOURCE','PACKET_MISMATCH','UNKNOWN_RELATED_TASK'].includes(error.message))job.errorCode=error.message;save(job);terminate(child)}
    }).catch(()=>{terminate(child)}))
    child.on('error',()=>void exclusive(()=>{if(activeStatuses.has(job.status)){job.status='failed';job.message='Не удалось запустить исследование.';save(job)}}).catch(()=>{}))
    child.on('close',()=>{clearTimeout(deadline);children.delete(job.id);void exclusive(async()=>{if(activeStatuses.has(job.status)){job.status='failed';job.message='Процесс исследования завершился без рекомендации. Задача сохранена.';save(job)}await pump()}).catch(()=>{})})
  }
  async function startJob(itemId,raw,actor,auto=false,batch=null,cycleDueAt=null){
      if(!available())throw fail(503,'ИИ-анализ не подключён')
      if(auto&&cycleDueAt===null&&latest(itemId))return publicJob(latest(itemId),await repository.read())
      const input=startSchema.parse(raw)
      const state=batch?.state??await repository.read(), item=state?.items.find(item=>item.id===itemId)
      if(!item)throw fail(404,'Сначала сохраните задачу')
      if(item.lane!=='inbox'&&item.lane!=='backlog')throw fail(409,'Запуск доступен во входящих и бэклоге')
      if(item.lane==='backlog'&&!quickMode(mode))throw fail(409,'Для оценки бэклога включите режим Codex или OpenRouter.')
      if(item.title!==input.title||item.body!==input.body)throw fail(409,'Описание изменилось или ещё не сохранилось. Дождитесь сохранения и повторите запуск.')
      if(item.title.trim().length<3||(item.lane!=='backlog'&&item.body.trim().length<20))throw fail(422,'Добавьте название и описание задачи: что хотим проверить или улучшить.')
      draft?.stop() // Saving/assessing a real task takes precedence over an optional draft question.
      const previous=[...jobs.values()].find(j=>j.requestId===input.requestId)
      if(previous){if(previous.itemId!==itemId||previous.actorId!==actor.id)throw fail(409,'Запрос уже использован');return publicJob(previous,state)}
      const capture=snapshot(item,state.criteria), hash=fingerprint(capture), current=latest(itemId)
      if(mode==='assisted'&&current?.status==='awaiting_review'&&current.fingerprint===hash&&fingerprint(current.context)===fingerprint(input.context))return publicJob(current,state)
      if(current&&activeStatuses.has(current.status)&&current.fingerprint===hash&&commentsMatch(current,state,item)&&fingerprint(current.context)===fingerprint(input.context))return publicJob(current,state)
      const occupied=children.size||[...jobs.values()].some(j=>activeStatuses.has(j.status))
      if(!auto&&!batch&&occupied)throw fail(429,'Одно исследование уже выполняется. Дождитесь завершения или отмените его.')
      const job={id:randomUUID(),requestId:input.requestId,itemId,actorId:actor.id,snapshot:capture,fingerprint:hash,context:input.context,
        createdAt:Math.max(Date.now(),(current?.createdAt??0)+1),status:'queued',stage:'planning',mode,automatic:auto,...(cycleDueAt!==null?{reviewCycleDueAt:cycleDueAt}:{}),...(batch?{batchId:batch.id,batchCreatedAt:batch.createdAt}: {})}
      if(quickMode(mode))Object.assign(job,{format:'quick-v1',priorityPolicy:conceptReview?'concept-mvp-v1':'criteria-v2',evidencePolicy:conceptReview?'adaptive-signals-v4':'idea-relevance-v1',...(conceptReview?{teamContext:structuredClone(conceptTeamContext),commentContext:taskComments(state,item)}:{}),webSearch,boardContext:boardContext(state,item,conceptReview)})
      if(['adaptive-signals-v3','adaptive-signals-v4'].includes(job.evidencePolicy))job.comparisonContext=comparisonFor(state,item,batch?.analysisJobs)
      if(mode==='assisted'||quickMode(mode)){
        let sources=[],sourceJob
        for(const previous of [...jobs.values()].filter(j=>j.itemId===itemId).sort((a,b)=>b.createdAt-a.createdAt)){
          // A changed task must not inherit evidence collected for a different product interpretation.
          if(quickMode(mode)&&(previous.fingerprint!==hash||previous.evidencePolicy!==job.evidencePolicy||fingerprint(previous.commentContext??null)!==fingerprint(job.commentContext??null)))continue
          const materialFile=path.join(directory,previous.id,['assisted','codex','openrouter'].includes(previous.mode)?'materials.json':'run.json')
          if(!fs.existsSync(materialFile))continue
          let data;try{data=JSON.parse(fs.readFileSync(materialFile,'utf8'))}catch{throw fail(503,'Не удалось прочитать сохранённые материалы. Доступна ручная оценка.')}
          sources=compactMaterials(data.sources)
          if(sources.length){sourceJob=previous;break}
        }
        Object.assign(job,{status:'awaiting_review',sourceJobId:sourceJob?.id??null,sourceStopReason:sourceJob?.stopReason??sourceJob?.sourceStopReason??null,
          sourceCount:sources.length,packetHash:packetHash(job,sources),message:sources.length?'Задание для чата подготовлено. Скачайте материалы, выполните короткий разбор в чате и загрузите JSON с рекомендацией.':'Сохранённых материалов для этой задачи нет. Доступна ручная оценка; новый поиск не запускался.'})
        if(quickMode(mode))Object.assign(job,{status:'queued',stage:'prioritizing',packetHash:quickHash(job,sources),message:null})
        save(job)
        writeJson(path.join(directory,job.id,'materials.json'),{sources})
      }
      if(batch||auto&&occupied)Object.assign(job,{status:'waiting',stage:'waiting',message:'Ожидает завершения предыдущего разбора.'})
      save(job);jobs.set(job.id,job);if(mode==='runtime'||quickMode(mode)&&job.status==='queued'){run(job);if(job.status==='failed')await pump()}
      return publicJob(job,state)
  }
  const backlogState=state=>{
    const items=(state?.items??[]).filter(i=>i.lane==='backlog')
    const current=items.map(i=>latest(i.id)).filter(Boolean)
    const lastBatch=[...jobs.values()].filter(j=>j.batchId).sort((a,b)=>b.batchCreatedAt-a.batchCreatedAt)[0]
    const batchJobs=lastBatch?[...jobs.values()].filter(j=>j.batchId===lastBatch.batchId):[]
    return {available:available()&&quickMode(mode),busy:children.size>0||[...jobs.values()].some(j=>activeStatuses.has(j.status)),
      batch:lastBatch?{id:lastBatch.batchId,total:batchJobs.length,completed:batchJobs.filter(j=>!activeStatuses.has(j.status)).length,ready:batchJobs.filter(j=>j.status==='ready').length,failed:batchJobs.filter(j=>['failed','interrupted'].includes(j.status)).length,cancelled:batchJobs.filter(j=>j.status==='cancelled').length,active:batchJobs.some(j=>activeStatuses.has(j.status))}:null,
      reviews:items.map(item=>({itemId:item.id,...reviewState(item)})),
      jobs:current.map(j=>({itemId:j.itemId,id:j.id,status:j.status,score:j.status==='ready'?j.recommendation?.score??null:null,stale:isStale(j,state),reviewDue:reviewDate(j)!==null&&Date.now()>=reviewDate(j)}))}
  }
  async function maintainReviews(){
    if(!available()||!quickMode(mode))return
    let state=await repository.read()
    if(!state)return
    const overdue=state.items.filter(i=>i.lane==='backlog'&&!i.parentId&&reviewState(i).needsDecision&&Date.now()>=reviewState(i).returnAt&&!(i.priorityReview?.returnedAt>=reviewState(i).dueAt))
    if(overdue.length){
      await repository.mutate({action:'return_overdue_reviews'},current=>{
        const touchedIds=[]
        for(const item of current.items){
          if(!overdue.some(i=>i.id===item.id)||item.lane!=='backlog')continue
          const status=reviewState(item)
          if(!status.needsDecision||Date.now()<status.returnAt||(item.priorityReview?.returnedAt>=status.dueAt))continue
          item.priorityReview={reviewedAt:status.dueAt-REVIEW_PERIOD_MS,returnedAt:Date.now(),reason:'overdue',previousBucket:item.matrixBucket??item.priorityReview?.previousBucket??null}
          item.matrixBucket=null;touchedIds.push(item.id)
        }
        return {state:current,touchedIds,result:{}}
      })
      state=await repository.read()
    }
    if(!automatic||children.size||[...jobs.values()].some(j=>activeStatuses.has(j.status)))return
    const candidate=state.items.filter(i=>i.lane==='backlog'&&!i.parentId&&i.title.trim().length>=3).map(item=>({item,status:reviewState(item)}))
      .filter(({item,status})=>status.needsDecision&&![...jobs.values()].some(j=>j.itemId===item.id&&(j.reviewCycleDueAt===status.dueAt||j.createdAt>=status.dueAt)))
      .sort((a,b)=>a.status.dueAt-b.status.dueAt)[0]
    if(candidate){
      const {item,status}=candidate
      await repository.mutate({action:'mark_priority_review'},current=>{
        const target=current.items.find(i=>i.id===item.id)
        if(!target||target.lane!=='backlog'||reviewState(target).dueAt!==status.dueAt)throw fail(409,'Решение изменилось во время пересмотра')
        if(!target.priorityReview)target.priorityReview={reviewedAt:status.dueAt-REVIEW_PERIOD_MS}
        return {state:current,touchedIds:[item.id],result:{}}
      })
      await startJob(item.id,{requestId:randomUUID(),title:item.title,body:item.body},{id:'system:priority-review',name:'Автоматический пересмотр'},true,null,status.dueAt)
    }
  }
  const reviewTimer=reviewIntervalMs>0?setInterval(()=>void exclusive(maintainReviews).catch(()=>console.error('Automatic priority review could not complete.')),reviewIntervalMs):null
  reviewTimer?.unref()
  const service={
    maintainReviews:()=>exclusive(maintainReviews),
    decideReview:(itemId,raw,actor)=>exclusive(async()=>{
      if(!raw||!['keep','reject'].includes(raw.action)||typeof raw.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(raw.requestId)||!Number.isFinite(raw.expectedUpdatedAt))throw fail(422,'Некорректное решение')
      return repository.mutate({action:'decide_priority_review',requestId:`priority:${actor.id}:${itemId}:${raw.requestId}`},state=>{
        if(state.updatedAt!==raw.expectedUpdatedAt)throw fail(409,'Доска изменилась. Обновите данные и повторите решение.')
        const item=state.items.find(i=>i.id===itemId)
        if(!item||!['inbox','backlog'].includes(item.lane))throw fail(409,'Решение доступно во входящих и бэклоге')
        item.priorityReview={reviewedAt:Date.now(),...(raw.action==='reject'?{reason:'rejected',previousBucket:item.matrixBucket??item.priorityReview?.previousBucket??null,returnedAt:Date.now()}: {})}
        if(raw.action==='reject')Object.assign(item,{matrixBucket:null,lane:'backlog',sprintId:null})
        return {state,touchedIds:[itemId],result:{ok:true}}
      })
    }),
    backlog:()=>exclusive(async()=>backlogState(await repository.read())),
    startBacklog:(raw,actor)=>exclusive(async()=>{
      if(!available()||!quickMode(mode))throw fail(503,'ИИ-переоценка недоступна')
      if(!raw||Object.keys(raw).some(k=>k!=='requestId')||typeof raw.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(raw.requestId))throw fail(422,'Некорректный запрос переоценки')
      const state=await repository.read(),existing=[...jobs.values()].find(j=>j.batchId===raw.requestId)
      if(existing){if(existing.actorId!==actor.id)throw fail(409,'Запрос уже использован');return backlogState(state)}
      if(children.size||[...jobs.values()].some(j=>activeStatuses.has(j.status)))throw fail(429,'Дождитесь завершения текущего анализа или остановите его')
      const items=state.items.filter(i=>i.lane==='backlog')
      if(!items.length)throw fail(409,'В бэклоге пока нет задач')
      if(items.length>200)throw fail(422,'За один запуск можно переоценить до 200 задач')
      // Validate the whole snapshot before starting any external work.
      for(const item of items){startSchema.parse({requestId:randomUUID(),title:item.title,body:item.body});if(item.title.trim().length<3)throw fail(422,'Для переоценки у всех задач должно быть название от 3 символов')}
      const batch={id:raw.requestId,createdAt:Date.now(),state:structuredClone(state),analysisJobs:structuredClone([...jobs.values()].filter(j=>j.status==='ready'))}
      const prepared=[]
      try{for(const item of items)prepared.push(await startJob(item.id,{requestId:randomUUID(),title:item.title,body:item.body},actor,false,batch))}
      catch(error){for(const entry of prepared){const job=jobs.get(entry.id);job.status='cancelled';job.message='Подготовка очереди прервана';save(job)}throw error}
      await pump()
      return backlogState(state)
    }),
    cancelBacklog:(raw,actor)=>exclusive(async()=>{
      if(typeof raw?.batchId!=='string')throw fail(422,'Укажите переоценку')
      const selected=[...jobs.values()].filter(j=>j.batchId===raw.batchId)
      if(!selected.length)throw fail(404,'Переоценка не найдена')
      if(selected.some(j=>j.actorId!==actor.id))throw fail(403,'Остановить переоценку может её автор')
      for(const job of selected)if(activeStatuses.has(job.status)){job.status='cancelled';job.message='Переоценка остановлена. Оценки задачи сохранены.';save(job);const child=children.get(job.id);if(child)terminate(child)}
      return backlogState(await repository.read())
    }),
    clarifyDraft: async(raw,actor,signal)=>{
      const input=draftInputSchema.parse(raw)
      // Wrap the promise: waiting for a model must never hold the state/job mutex.
      const {result}=await exclusive(()=>{
        if(!available()||!quickMode(mode)||mode==='openrouter'&&!draftLauncher||!automatic||signal?.aborted||draft||(!draftLauncher&&(children.size||[...jobs.values()].some(j=>activeStatuses.has(j.status)))))return {result:Promise.resolve({question:null})}
        const now=Date.now()
        for(const [id,entry]of draftRequests)if(now-entry.time>=30000)draftRequests.delete(id)
        const entry=draftRequests.get(actor.id)
        if((entry?.count??0)>=3||(!entry&&draftRequests.size>=128))return {result:Promise.resolve({question:null})}
        draftRequests.set(actor.id,{time:entry?.time??now,count:(entry?.count??0)+1})
        const temp=fs.mkdtempSync(path.join(os.tmpdir(),'funban-draft-'));fs.chmodSync(temp,0o700)
        const result=new Promise(resolve=>{
          let child,timer,finished=false
          const abort=()=>finish({question:null})
          const finish=value=>{
            if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort)
            if(draft?.stop===abort)draft=null
            if(child&&child.exitCode===null)terminate(child)
            fs.rmSync(temp,{recursive:true,force:true});resolve(value)
          }
          draft={stop:abort}
          try{
            writeJson(path.join(temp,'job.json'),{format:'clarify-v1',snapshot:input})
            writeJson(path.join(temp,'materials.json'),{sources:[]})
            child=(draftLauncher??launch)(temp)
            child.stdout?.resume();child.stderr?.resume()
            child.on('message',message=>{
              if(message?.type==='review'){const parsed=draftReviewSchema.safeParse(message.review);finish(parsed.success?parsed.data:{question:null})}
              else if(message?.type==='error')abort()
            })
            child.once('error',abort);child.once('close',abort)
            timer=setTimeout(abort,clarificationTimeoutMs);timer.unref()
            signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
          }catch{abort()}
        })
        return {result}
      })
      return result
    },
    get: itemId=>exclusive(async()=>{
      const state=await repository.read()
      if(!state?.items.some(item=>item.id===itemId))throw fail(404,'Задача не найдена')
      return {available:available(),mode,automatic:automatic&&quickMode(mode)&&available(),review:state.items.find(i=>i.id===itemId)?reviewState(state.items.find(i=>i.id===itemId)):null,configurationMessage:storageError?'Не удалось прочитать архив исследований. Доступна ручная оценка.':available()?null:'ИИ-анализ не подключён. Доступна ручная оценка.',job:publicJob(latest(itemId),state)}
    }),
    enqueueCreated: async(previous,next,actor)=>{
      if(!previous||!automatic||!quickMode(mode)||!available())return
      const existing=new Set(previous.items.map(i=>i.id))
      for(const item of next.items){
        if(existing.has(item.id)||item.lane!=='inbox'||item.parentId||item.title.trim().length<3||item.body.trim().length<20)continue
        await service.start(item.id,{requestId:randomUUID(),title:item.title,body:item.body},actor,true)
      }
    },
    start: (itemId,raw,actor,auto=false)=>exclusive(()=>startJob(itemId,raw,actor,auto)),

    packet: (itemId,jobId)=>exclusive(()=>{
      const job=jobs.get(jobId)
      if(!job||job.itemId!==itemId||job.mode!=='assisted')throw fail(404,'Задание для чата не найдено')
      const {sources}=JSON.parse(fs.readFileSync(path.join(directory,job.id,'materials.json'),'utf8'))
      return reviewPacket(job,sources)
    }),
    importReview: (itemId,raw,actor)=>exclusive(async()=>{
      if(!available()||mode!=='assisted')throw fail(503,'Разбор в чате не включён')
      const input=reviewImportSchema.parse(raw),job=jobs.get(input.jobId),state=await repository.read()
      const item=state?.items.find(item=>item.id===itemId)
      if(!job||job.itemId!==itemId||job.mode!=='assisted'||job.status!=='awaiting_review'||latest(itemId)?.id!==job.id)throw fail(409,'Подготовьте актуальное задание для чата. Готовая рекомендация не перезаписывается.')
      if(!item||item.lane!=='inbox'||!snapshotMatches(job,item,state.criteria)||input.packetHash!==job.packetHash)throw fail(409,'Задача, критерии или пакет материалов изменились. Подготовьте новое задание для чата.')
      const {sources}=JSON.parse(fs.readFileSync(path.join(directory,job.id,'materials.json'),'utf8'))
      if(packetHash(job,sources)!==job.packetHash)throw fail(409,'Пакет материалов изменился')
      let result;try{result=validateSavedReview(input,job,sources)}catch{throw fail(422,'Рекомендация не прошла проверку: используйте цитаты из задания, существующие ссылки на свидетельства и допустимые оценки.')}
      const ready={...job,...result,status:'ready',completedAt:Date.now(),importedBy:actor.id,
        message:'Краткий разбор в чате по сохранённым материалам. Нового сбора не было. Совпадение цитат с архивом проверено; истинность заявлений источников не подтверждена автоматически.'}
      fs.writeFileSync(path.join(directory,job.id,'report.md'),reviewReport(ready),{mode:0o600})
      save(ready);jobs.set(ready.id,ready)
      return publicJob(ready,state)
    }),
    cancel: (itemId,jobId)=>exclusive(async()=>{
      const job=jobs.get(jobId)
      if(!job||job.itemId!==itemId)throw fail(404,'Исследование не найдено')
      if(activeStatuses.has(job.status)){job.status='cancelled';job.message='Исследование отменено. Оценки задачи не изменены.';save(job);const child=children.get(job.id);if(child)terminate(child)}
      return publicJob(job,await repository.read())
    }),
    confirm: (itemId,raw,actor)=>exclusive(async()=>{
      const compact=raw&&Object.hasOwn(raw,'score')
      const input=(compact?quickConfirmationSchema:confirmationSchema).parse(raw),job=jobs.get(input.jobId)
      if(!job||job.itemId!==itemId||job.status!=='ready')throw fail(409,'Рекомендация ещё не готова')
      if(latest(itemId)?.id!==job.id)throw fail(409,'Появилось более новое исследование. Обновите карточку.')
      return repository.mutate({action:'confirm_trendwatch',requestId:`trendwatch:${actor.id}:${itemId}:${job.id}:${input.requestId}`},state=>{
        const item=state.items.find(item=>item.id===itemId)
        if(!item||!['inbox','backlog'].includes(item.lane)||isStale(job,state)||(reviewDate(job)!==null&&Date.now()>=reviewDate(job)))throw fail(409,'Рекомендация устарела: изменился контекст или прошло 30 дней. Обновите её или оцените задачу вручную.')
        if(!compact&&(!state.criteria.length||Object.keys(input.scores).length!==state.criteria.length||state.criteria.some(c=>!Object.hasOwn(input.scores,c.id)||!validScore(input.scores[c.id],c))))throw fail(422,'Заполните все критерии в пределах их шкал')
        const criterionScores=compact&&['criteria-v1','criteria-v2'].includes(job.priorityPolicy)?Object.fromEntries(job.recommendation.scores.filter(s=>s.value!==null).map(s=>[s.criterionId,s.value])):null
        if(compact&&Object.hasOwn(input,'matrixBucket')&&(!Object.hasOwn(input,'expectedMatrixBucket')||input.expectedMatrixBucket!==(item.matrixBucket??null)))throw fail(409,'Стопка изменилась. Проверьте новое положение карточки.')
        const matrixBucket=compact?(input.score===0?null:Object.hasOwn(input,'matrixBucket')?input.matrixBucket:item.matrixBucket??null):input.matrixBucket
        const decision={jobId:job.id,confirmedAt:Date.now(),confirmedBy:actor.id,confirmedByName:actor.name,scores:compact?(criterionScores??item.scores):input.scores,matrixBucket,comment:input.comment??'',...(compact?{score:input.score,...(job.priorityPolicy==='criteria-v2'?{preliminary:job.recommendation.preliminary}:{})}: {})}
        Object.assign(item,{...(compact?{priorityScore:input.score,...(input.score===0&&(item.lane==='backlog'||item.matrixBucket!=null)||Object.hasOwn(input,'matrixBucket')?{matrixBucket}:{}),...(criterionScores?{scores:criterionScores}:{})}:{scores:input.scores,matrixBucket,lane:'backlog',sprintId:null,archivedAt:null}),trendwatchDecision:decision})
        // Confirming an incoming task saves the lead's score and moves it atomically.
        if(item.lane==='inbox')Object.assign(item,{lane:'backlog',sprintId:null,archivedAt:null})
        if(criterionScores&&input.score===job.recommendation.score)delete item.priorityScore
        item.priorityReview={reviewedAt:decision.confirmedAt}
        if(compact)decision.reviewFingerprint=fingerprint(snapshot(item,state.criteria))
        if(!compact)delete item.priorityScore
        state.actors=withActor(state.actors,actor)
        if(input.comment)state.comments.push({id:randomUUID(),itemId,authorId:actor.id,text:input.comment,createdAt:decision.confirmedAt})
        return {state,touchedIds:[itemId],result:{ok:true,decision}}
      })
    }),
    report: (itemId,jobId)=>exclusive(()=>{
      const job=jobs.get(jobId)
      if(!job||job.itemId!==itemId)throw fail(404,'Исследование не найдено')
      const file=path.join(directory,job.id,'report.md')
      if(!fs.existsSync(file))throw fail(404,'Отчёт ещё не сформирован')
      return fs.readFileSync(file,'utf8')
    }),
    close: ()=>exclusive(()=>{closed=true;clearInterval(reviewTimer);draft?.stop();closeDraft();for(const [id,child]of children){const job=jobs.get(id);if(activeStatuses.has(job.status)){job.status='interrupted';job.message='Исследование остановлено вместе с локальным сервером.';save(job)}terminate(child)}}),
  }
  return service
}
