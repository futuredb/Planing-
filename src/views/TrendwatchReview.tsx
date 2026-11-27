import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store-context'
import { reviewDate } from '../../priority-score.mjs'
import { itemScore } from '../storage'
import { researchRequest, type ResearchJob, type ResearchState, matrixOptions } from '../trendwatch'
import type { Item } from '../types'
import { Icon } from '../ui/Icon'

const headers={'Content-Type':'application/json'}
const sourceIssues:Record<string,string>={not_in_search_results:'Ссылка не найдена в результатах поиска или цитатах провайдера',duplicate_source:'Повторяется ссылка на тот же источник'}
const regionalIssues:Record<string,string>={source_not_listed:'Ссылка в выводе о РФ отсутствует среди источников ответа',supported_without_source:'Применимость к РФ объявлена подтверждённой, но источник не указан'}
const routingIssues:Record<string,string>={search_performed:'Провайдер сообщил об обращениях к поисковым инструментам для внутренней задачи',outcome_requires_search:'Модель указала результат поиска вместо «Поиск не нужен»',sources_supplied:'Модель приложила внешние источники к внутренней оценке'}
const assessmentKinds:Record<string,string>={bug:'Исправление ошибки',internal_improvement:'Внутреннее улучшение',market_idea:'Рыночная идея',approach_research:'Исследование нового подхода'}
const searchOutcomes:Record<string,string>={not_needed:'Поиск не нужен',insufficient:'Недостаточно оснований',found:'Найдены основания'}
const failurePhases:Record<string,string>={prepare:'Подготовка анализа',budget:'Проверка бюджета ключа',routing:'Выбор режима анализа',generation:'Запрос к модели',response:'Проверка завершения ответа',parse:'Чтение JSON',schema:'Проверка формата оценки',validation:'Проверка источников и согласованности'}
const parseIssues:Record<string,string>={no_final_message:'Нет итогового сообщения модели',empty_text:'Итоговое сообщение пустое',invalid_content:'Неожиданный формат содержимого сообщения',refusal:'Модель отказалась отвечать',unfinished_message:'Итоговое сообщение не завершено',markdown:'JSON обёрнут в Markdown',non_json:'Итоговый текст не читается как JSON',invalid_json:'Ошибка синтаксиса JSON',invalid_function_call:'Некорректная или неоднозначная передача итоговой оценки'}
const schemaIssues:Record<string,string>={invalid_type:'Неверный тип или отсутствует обязательное поле',too_big:'Превышен допустимый размер или значение',too_small:'Недостаточный размер или значение',invalid_format:'Неверный формат',invalid_value:'Значение не входит в допустимый список',unrecognized_keys:'Лишние поля',invalid_union:'Не соответствует допустимым вариантам',custom:'Не пройдена проверка поля'}
const verdicts={recommend:'Рекомендую',clarify:'Стоит уточнить',defer:'Пока отложить'}
const plainSummary=(text:string)=>text.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g,'$1').replace(/\s*\[\d+(?:[,–-]\s*\d+)*\]/g,'').replace(/https?:\/\/\S+/g,'').trim()
const lanes={inbox:'На разбор',backlog:'В бэклоге',todo:'В спринте',doing:'В работе',done:'Выполнено',archive:'В архиве'}

export function TrendwatchReview({item,onOpen,preview=false,refreshKey=''}:{item:Item;onOpen:(id:string)=>void;preview?:boolean;refreshKey?:string}) {
  const {state,syncStatus}=useStore()
  const uid=useId()
  const [opened,setOpened]=useState(false)
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer)},[])
  const dialogRef=useRef<HTMLDialogElement>(null)
  const [connection,setConnection]=useState<ResearchState|null>(null)
  const [job,setJob]=useState<ResearchJob|null>(null)
  const [score,setScore]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  const initialized=useRef(''),startId=useRef<string|null>(null),confirmId=useRef<string|null>(null),operation=useRef(0)
  const running=job?.status==='waiting'||job?.status==='running'||job?.status==='queued'
  const recommendation=job?.recommendation
  const quick=recommendation&&'score' in recommendation?recommendation:null
  const reviewAt=reviewDate(job)
  const pendingReview=Boolean(connection?.review?.needsDecision)
  const reviewDue=reviewAt!==null&&now>=reviewAt
  const internalAssessment=quick?.assessmentKind==='bug'||quick?.assessmentKind==='internal_improvement'
  const conceptBased=job?.priorityPolicy==='concept-mvp-v1'
  const criteriaBased=job?.priorityPolicy==='criteria-v1'||job?.priorityPolicy==='criteria-v2'
  const unknownEffort=quick?.scores?.some(s=>s.value===null&&job?.snapshot.criteria.find(c=>c.id===s.criterionId)?.invert)
  const knownCount=quick?.scores?.filter(s=>s.value!==null).length??0
  const stale=Boolean(job&&(job.stale||job.snapshot.title!==item.title||job.snapshot.body!==item.body))

  useEffect(()=>{
    // New inbox rows render before the server assigns their permanent number.
    if(item.number===undefined||syncStatus!=='saved')return
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined
    async function poll(){
      const version=operation.current
      try{
        const result=await researchRequest<ResearchState>(item.id)
        if(!alive||operation.current!==version)return
        setConnection(result);setJob(result.job)
        if(result.job?.status==='ready'&&result.job.recommendation&&initialized.current!==result.job.id){
          initialized.current=result.job.id;confirmId.current=null
          const rec=result.job.recommendation
          // Archived recommendations keep their original meaning; never invent missing scores.
          const proposed='score' in rec?rec.score:itemScore(item,state.criteria)
          const accepted=result.job.decision?.jobId===result.job.id?itemScore(item,state.criteria):undefined
          setScore(accepted!=null?String(accepted):proposed===null?'':String(proposed))
        }
        if(result.job?.status==='waiting'||result.job?.status==='queued'||result.job?.status==='running')timer=setTimeout(()=>void poll(),1500)
      }catch(e){if(alive){setError(e instanceof Error?e.message:'Ошибка загрузки');timer=setTimeout(()=>void poll(),5000)}}
    }
    void poll()
    return()=>{alive=false;clearTimeout(timer)}
  },[item,state.criteria,state.items,state.comments,syncStatus,retry,opened,refreshKey])

  useEffect(()=>{
    if(!opened)return
    const dialog=dialogRef.current
    if(!dialog)return
    const overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    dialog.showModal()
    return()=>{dialog.close();document.body.style.overflow=overflow}
  },[opened])

  function openTask(id:string){
    dialogRef.current?.close()
    setOpened(false)
    onOpen(id)
  }

  async function action(fn:()=>Promise<void>){
    if(busy)return
    operation.current++;setBusy(true);setError('')
    try{await fn()}catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить действие')}
    finally{setBusy(false);setRetry(n=>n+1);window.dispatchEvent(new Event('funban-research-refresh'))}
  }
  async function start(){
    startId.current??=crypto.randomUUID()
    await action(async()=>{
      setJob(await researchRequest<ResearchJob>(item.id,'',{method:'POST',headers,body:JSON.stringify({requestId:startId.current,title:item.title,body:item.body})}))
      startId.current=null
    })
  }
  const complete=score.trim()!==''&&Number.isFinite(Number(score))&&Number(score)>=0&&Number(score)<=10
  const contextReady=item.title.trim().length>=3&&(item.lane==='backlog'||item.body.trim().length>=20)
  const unsupportedMode=item.lane==='backlog'&&connection!==null&&!['codex','openrouter'].includes(connection.mode)
  const startDisabled=connection?.offline||unsupportedMode||busy||running||syncStatus!=='saved'||!connection?.available||!contextReady
  async function confirm(){
    confirmId.current??=crypto.randomUUID()
    await action(async()=>{
      await researchRequest(item.id,'/confirm',{method:'POST',headers,body:JSON.stringify({requestId:confirmId.current,jobId:job?.id,score:Number(score)})})
      window.dispatchEvent(new Event('funban-refresh'))
      dialogRef.current?.close()
    })
  }

  async function decideReview(decision:'keep'|'reject'){
    await action(async()=>{
      await researchRequest(item.id,'/decision',{method:'POST',headers,body:JSON.stringify({action:decision,requestId:crypto.randomUUID(),expectedUpdatedAt:state.updatedAt})})
      window.dispatchEvent(new Event('funban-refresh'))
    })
  }
  const accepted=job?.decision?.jobId===job?.id&&job?.decision?.score!==undefined
  const confirmed=item.lane!=='inbox'&&accepted&&!stale&&!reviewDue&&complete&&Number(score)===job?.decision?.score
  const badgeScore=quick?.score??null
  const preliminary=quick?.preliminary
  const badgeValue=running?'…':badgeScore??'—'
  const coverage=preliminary&&quick?.scores&&typeof badgeValue==='number'?`${knownCount}/${job?.snapshot.criteria.length}`:null
  const badgeLabel=running?'ИИ готовит оценку':stale||reviewDue?`Оценка ИИ устарела: ${badgeScore??'—'} из 10`:badgeScore!==null?`${preliminary?'Частичный балл ИИ':preview?'Предложение ИИ':'Оценка ИИ'}: ${badgeScore} из 10${coverage?`, учтено критериев: ${coverage}`:''}`:'Оценка ИИ ещё не получена'

  const relatedTasks=quick?.relatedTasks.length?<ul className="research-related">{quick.relatedTasks.map(related=>{
        const other=state.items.find(i=>i.id===related.itemId)
        return other?<li key={other.id}><button type="button" className="text-button" onClick={()=>openTask(other.id)}>{other.title}</button><span className="research-muted">{lanes[other.lane]} · {related.reason}</span></li>:null
      })}</ul>:null
  const summary=plainSummary(recommendation?.summary??'')

  return <>
    <button type="button" className={`ai-score-button${running?' is-running':''}`} aria-label={badgeLabel} title={`${badgeLabel}. Открыть рекомендацию`} aria-haspopup="dialog" aria-expanded={opened} aria-controls={opened?`${uid}-dialog`:undefined} onClick={()=>setOpened(true)}>
      <svg className="ai-score-spark" width="16" height="18" viewBox="0 0 20 22" fill="currentColor" aria-hidden="true"><path d="M8 3l2.1 5.9L16 11l-5.9 2.1L8 19l-2.1-5.9L0 11l5.9-2.1L8 3Z"/><path d="m16 0 1.1 2.9L20 4l-2.9 1.1L16 8l-1.1-2.9L12 4l2.9-1.1L16 0Z"/></svg>
      <span>{badgeValue}</span>
    </button>
    {opened?createPortal(<dialog ref={dialogRef} id={`${uid}-dialog`} className="ai-review-dialog" aria-labelledby={`${uid}-heading`} onKeyDown={event=>{
      if(event.key!=='Tab')return
      const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])')].filter(el=>el.tabIndex>=0&&el.getClientRects().length>0)
      const first=controls[0],last=controls.at(-1)
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }} onClose={()=>setOpened(false)} onClick={event=>{
      if(event.target!==event.currentTarget)return
      const rect=event.currentTarget.getBoundingClientRect()
      if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)event.currentTarget.close()
    }}>
    <div className="ai-review-heading"><div><span className="eyebrow">{conceptBased?internalAssessment?'Приоритет · ближайший месяц':'Приоритет MVP · ближайший месяц':criteriaBased?'Приоритет · ближайший месяц':'Рекомендация'}</span><h2 id={`${uid}-heading`}>Рекомендация ИИ</h2></div><button type="button" className="icon-button" aria-label="Закрыть рекомендацию" onClick={()=>dialogRef.current?.close()}><Icon name="close"/></button></div>
    <p className="ai-review-task">{item.title}</p>
    {error?<p className="research-error" role="alert">{error}</p>:null}
    {!connection&&!error?<p className="research-muted" role="status">{syncStatus==='saved'?'Загружаем рекомендацию…':'Сохраняем задачу…'}</p>:null}
    {connection&&(!connection.available||connection.offline)?<p className="research-muted">{connection.configurationMessage}</p>:null}
    {connection?.available&&unsupportedMode?<p className="research-muted">Оценка бэклога недоступна в текущем режиме сервера.</p>:null}
    {running?<div className="research-quick-actions" role="status"><span>{job?.status==='waiting'?'Ожидает завершения предыдущего разбора…':job?.webSearch?'Оцениваем задачу; при необходимости проверяем рынок…':'Сравниваем с задачами и готовим короткий вывод…'}</span><button type="button" className="text-button" disabled={busy} onClick={()=>void action(async()=>{setJob(await researchRequest<ResearchJob>(item.id,'',{method:'DELETE',headers,body:JSON.stringify({jobId:job!.id})}))})}>Отменить</button></div>:null}
    {job&&!running&&job.status!=='ready'?<p className="research-muted" role="status">{job.message||'Рекомендация не готова. Можно повторить запуск или оценить вручную.'}</p>:null}
    {job?.status==='failed'&&job.failure?<details className="research-muted">
      <summary>Детали ошибки</summary>
      <p>Код: {job.failure.code}<br/>Этап: {failurePhases[job.failure.phase??'']??'Не сохранён'}
        {job.failure.elapsedMs!==undefined?<><br/>Длительность: {Math.ceil(job.failure.elapsedMs/1000)} сек.</>:null}
        {job.failure.httpStatus!==undefined?<><br/>HTTP: {job.failure.httpStatus}</>:null}
        {job.failure.networkCode?<><br/>Сеть: {job.failure.networkCode}</>:null}
        {job.failure.responseStatus?<><br/>Статус ответа: {job.failure.responseStatus}</>:null}
        {job.failure.incompleteReason?<><br/>Причина: {job.failure.incompleteReason==='max_output_tokens'?'Достигнут лимит выходных токенов':'Ответ остановлен фильтром содержимого'}</>:null}
        {job.failure.validationCode?<><br/>Проверка: {job.failure.validationCode}</>:null}
        {job.failure.selectedKind?<><br/>Выбранный режим: {assessmentKinds[job.failure.selectedKind]??'Неизвестен'}</>:null}
        {job.failure.assessmentKind?<><br/>Тип задачи по ответу модели: {assessmentKinds[job.failure.assessmentKind]??'Неизвестен'}</>:null}
        {job.failure.searchOutcome?<><br/>Результат поиска по ответу модели: {searchOutcomes[job.failure.searchOutcome]??'Неизвестен'}</>:null}
        {job.failure.webQueries!==undefined?<><br/>Поисковых запросов по данным провайдера: {job.failure.webQueries}</>:null}
        {job.failure.webCalls!==undefined?<><br/>Вызовов серверных инструментов: {job.failure.webCalls}</>:null}
        {job.failure.sourceCount!==undefined?<><br/>Источников в ответе: {job.failure.sourceCount}</>:null}
        {job.failure.searchResultUrlCount!==undefined?<><br/>Адресов в результатах поиска: {job.failure.searchResultUrlCount}</>:null}
        {job.failure.citationUrlCount!==undefined?<><br/>Адресов в цитатах провайдера: {job.failure.citationUrlCount}</>:null}
        {job.failure.verifiedUrlCount!==undefined?<><br/>Всего уникальных адресов для проверки: {job.failure.verifiedUrlCount}</>:null}
        {job.failure.sourceIssues?.map((issue,index)=>sourceIssues[issue.reason]?<span key={index}><br/>Источник №{issue.index}: {sourceIssues[issue.reason]}</span>:null)}
        {job.failure.routingIssues?.map(issue=>routingIssues[issue]?<span key={issue}><br/>Причина: {routingIssues[issue]}</span>:null)}
        {job.failure.regionalIssues?.map(issue=>regionalIssues[issue]?<span key={issue}><br/>Причина: {regionalIssues[issue]}</span>:null)}
        {job.failure.outputTokens!==undefined?<><br/>Выходных токенов: {job.failure.outputTokens}</>:null}
        {job.failure.answerFormat?<><br/>Формат итога: {job.failure.answerFormat==='function_call'?'Структурированный результат':'Текст JSON'}</>:null}
        {job.failure.parseIssue?<><br/>Разбор: {parseIssues[job.failure.parseIssue]??'Неизвестная причина'}</>:null}
        {job.failure.reasoningTokens!==undefined?<><br/>Токенов рассуждения: {job.failure.reasoningTokens}</>:null}
        {job.failure.outputItems!==undefined?<><br/>Элементов ответа: {job.failure.outputItems}</>:null}
        {job.failure.assistantMessages!==undefined?<><br/>Сообщений модели: {job.failure.assistantMessages}</>:null}
        {job.failure.textParts!==undefined?<><br/>Текстовых частей: {job.failure.textParts}</>:null}
        {job.failure.answerBytes!==undefined?<><br/>Размер итогового текста: {job.failure.answerBytes} байт</>:null}
        {job.failure.schemaIssueCount!==undefined?<><br/>Нарушений формата: {job.failure.schemaIssueCount}</>:null}
        {job.failure.schemaIssues?.map((issue,index)=><span key={index} style={{overflowWrap:'anywhere'}}><br/>{issue.field}: {schemaIssues[issue.code]??issue.code} ({issue.code})</span>)}
        <br/>Запуск: <span style={{overflowWrap:'anywhere'}}>{job.id}</span>
      </p>
    </details>:null}
    {pendingReview?<p className="priority-review-alert" role="status">Нужен пересмотр. Сохранённые балл и стопка остаются решением лида.</p>:null}
    {connection?.review?.reason==='overdue'?<p className="research-muted">Задача возвращена в «Не разобрано»: срок пересмотра просрочен на 14 дней.{connection.review.previousBucket?` Прежняя стопка: ${matrixOptions.find(o=>o.value===connection.review?.previousBucket)?.label}.`:''}</p>:null}
    {reviewDue?<p className="research-notice" role="status">Пора пересмотреть: оценке больше 30 дней. Сохранённый балл не изменён.</p>:null}
    {recommendation?<>
      <p className="research-quick-summary">{summary.length>500?summary.slice(0,497)+'…':summary}</p>
      {quick?.decisionValue&&quick.evidenceStrength?<p className="research-muted">Основания: {quick.evidenceStrength==='strong'?'сильные':quick.evidenceStrength==='moderate'?'умеренные':'ограниченные'}. Это надёжность подтверждений, а не балл приоритета.</p>:null}
      {quick?.preliminary?<p className="research-muted research-preliminary">{quick.score===null?'Недостаточно оснований для балла':`Частичная оценка · ${knownCount} из ${job?.snapshot.criteria.length} критериев`}{unknownEffort?' · Напряг не учтён':''}</p>:null}
      {criteriaBased&&quick?.scores?<details className="research-criteria"><summary>Как рассчитано · {quick.score??'—'}/10</summary><dl>{job.snapshot.criteria.map(c=>{
        const entry=quick.scores?.find(s=>s.criterionId===c.id)
        return entry?<div key={c.id}><dt>{c.name}<strong>{entry.value===null?'Не оценено':`${entry.value} / ${c.max}`}</strong></dt><dd>{entry.assumed?<span className="research-assumption">Предположение · </span>:null}{entry.reason}{entry.basis?.map((basis,i)=><small className="research-basis" key={i}>{basis.kind==='web'?`Сигнал источника: ${basis.quote}`:`${basis.kind==='task'?'Из задачи':basis.kind==='board'?'Из доски':'Из материала'}: «${basis.quote}»`}</small>)}</dd></div>:null
      })}</dl><p className="research-muted">Среднее известных нормированных оценок × известные поправки. Неизвестные критерии не снижают балл; итог округлён до десятых. Баллы с разным набором критериев напрямую не сопоставимы.</p></details>:null}
      {(conceptBased||job?.webSearch&&job.evidence.length)&&job?<details className="research-web-sources">
        <summary>{conceptBased?'Почему такая оценка':`Источники · ${job.evidence.length}`}</summary>
        <div className="research-explanation">
          {conceptBased?<>
            <section>{quick?.decisionValue?<><h3>Что даст результат</h3><p>{quick.decisionValue}</p></>:null}<h3>Почему {quick?.score} из 10</h3><p>{quick?.rationale}</p>{quick?.comparison&&job.comparisonCurrent===false?<p className="research-muted">Оценка сравниваемой задачи изменилась. Повторите анализ, чтобы обновить объяснение очередности.</p>:quick?.comparison?<><h3>{quick.comparison.status==='advantage'?'Почему раньше':quick.comparison.status==='equal'?'Равный приоритет':quick.comparison.status==='behind'?'Почему позже':'Очередность не установлена'}</h3><p>{quick.comparison.reason}</p></>:null}</section>
            {!internalAssessment?<section className="research-regional"><h3>Применимость к РФ</h3>
              <p>{quick?.regionalApplicability?.summary??'В этой рекомендации применимость к РФ отдельно не проверялась. Повторите анализ для региональной проверки.'}</p>
              {quick?.regionalApplicability?<p className="research-muted">{quick.regionalApplicability.status==='supported'?'Есть местные основания':quick.regionalApplicability.status==='conditional'?'Перенос опыта — гипотеза':'Недостаточно местных оснований'}</p>:null}
            </section>:null}
          </>:null}
          {job.evidence.length?<section><h3>Примеры · {job.evidence.length}</h3><ol>{job.evidence.map(source=><li key={source.id}>
            <div className="research-source-heading"><a href={source.url} title={source.title} target="_blank" rel="noopener noreferrer">{source.origin||source.title}</a><span className="research-muted">{source.publishedAt||'Без даты'}</span></div>
            <p>{source.observation}</p>
            {source.applicability?<p>{source.applicability}</p>:null}
            {source.relevance||source.limitation?<p className="research-muted">{source.relevance==='direct'?'Прямое основание':source.relevance==='analogy'?'Аналогия':''}{source.limitation?` · ${source.limitation}`:''}</p>:null}
          </li>)}</ol></section>:null}
        </div>
      </details>:null}
      {!conceptBased?relatedTasks:null}
      {stale?<p className="research-error" role="status">Задача или контекст доски изменились. Повторите анализ.</p>:null}
      <div className="research-quick-actions research-decision">
        <div className="research-score-control"><div className="research-score-entry"><strong>{quick?.score===null?'Ваша оценка':conceptBased?(confirmed||score!==String(quick?.score)?'Ваша оценка':'Балл ИИ'):quick?.preliminary?(confirmed||score!==String(quick.score)?'Ваша оценка':'Балл ИИ'):quick?(quick.verdict==='clarify'&&(job?.priorityPolicy==='business-v2'||job?.priorityPolicy==='business-v3'||criteriaBased)?'Проверить гипотезу':verdicts[quick.verdict]):'Оцените задачу'}</strong>
        <label className="research-quick-score" htmlFor={`${uid}-score`}><span className="sr-only">Оценка приоритета</span><input id={`${uid}-score`} type="number" min={0} max={10} step="any" value={score} placeholder="—" aria-invalid={!complete} aria-describedby={`${uid}-score-hint`} disabled={busy||running} onChange={e=>{setScore(e.target.value);confirmId.current=null}}/><span>/ 10</span></label>
        </div><span id={`${uid}-score-hint`} className="research-score-hint research-muted" aria-live="polite">{!complete?'Введите оценку от 0 до 10':''}</span></div>
        <button type="button" className="primary-button compact-button" title={item.lane==='inbox'?'Сохранить вашу оценку и перенести задачу в бэклог':undefined} disabled={busy||running||stale||reviewDue||!complete||confirmed||syncStatus!=='saved'} onClick={()=>void confirm()}>{confirmed?'Подтверждено':'Подтвердить'}<Icon name="check" size={16}/></button>
      </div>
      {confirmed?<p className={conceptBased?'sr-only':'research-notice'} role="status">Оценка сохранена. Задача остаётся в бэклоге.</p>:null}
      {criteriaBased&&quick&&complete&&score!==String(quick.score)?<p className="research-muted">Ваша оценка заменит расчётный итог. Неизвестные критерии останутся без оценки.</p>:null}
    </>:!running?<div className="research-quick-actions"><button type="button" className="secondary-button compact-button" disabled={Boolean(startDisabled)} onClick={()=>void start()}><Icon name="agent" size={16}/>Получить ИИ-рекомендацию</button><button type="button" className="text-button" onClick={()=>openTask(item.id)}>Оценить вручную</button></div>:null}
    {!contextReady?<p className="research-muted">Добавьте описание задачи, чтобы ИИ мог её оценить. <button type="button" className="text-button" onClick={()=>openTask(item.id)}>Дополнить</button></p>:null}
    {connection?.available||recommendation&&!running?<div className="research-review-actions">
      {recommendation&&!running?<button type="button" className="secondary-button compact-button ai-pearl-button" disabled={Boolean(startDisabled)} title="Новый разбор по актуальным данным. Использует лимиты аккаунта; подтверждённая оценка сохранится до вашего решения." onClick={()=>void start()}><span>Повторить анализ</span></button>:null}
      {connection?.available&&item.lane==='backlog'&&pendingReview?<button type="button" className="secondary-button compact-button" disabled={busy||syncStatus!=='saved'} onClick={()=>void decideReview('keep')} title="Начать новый отсчёт 30 дней, сохранив текущие балл и стопку">Сбросить счётчик</button>:null}
      {connection?.available?<button type="button" className="secondary-button compact-button" disabled={busy||syncStatus!=='saved'} title="Не согласиться с рекомендацией и отправить задачу на разбор, сохранив старый балл" onClick={()=>void decideReview('reject')}>В «Не разобрано»</button>:null}
    </div>:null}
    </dialog>,document.body):null}
  </>
}
