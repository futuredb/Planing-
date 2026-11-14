/** Local Codex CLI bridge. Credentials stay in Codex; no shell interpolation. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import { reviewImportSchema, reviewPacket } from './trendwatch-lite.mjs'
import { quickSchema, quickPacket, webLimits, publicWebUrl, draftReviewSchema, draftPacket } from './trendwatch-quick.mjs'

export function codexEnvironment(env=process.env) {
  return Object.fromEntries(['PATH','HOME','CODEX_HOME','TMPDIR','LANG','LC_ALL','SYSTEMROOT'].filter(key=>env[key]).map(key=>[key,env[key]]))
}
export function codexArguments(directory,webSearch=false,draft=false) {
  const disabled=['shell_tool','shell_snapshot','apps','remote_plugin','multi_agent','hooks','browser_use','browser_use_external','computer_use','image_generation','view_image','code_mode','code_mode_host','memories','skill_mcp_dependency_install']
  return ['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--cd',directory,'--json',
    '--output-schema',path.join(directory,'schema.json'),'--output-last-message',path.join(directory,'answer.json'),
    '-c','forced_login_method="chatgpt"','-c','approval_policy="never"','-c',`web_search="${webSearch?'live':'disabled'}"`,
    ...(webSearch?['-c','tools.web_search.context_size="low"']:[]),
    ...disabled.filter(name=>!webSearch||name!=='code_mode_host').flatMap(name=>['-c',`features.${name}=false`]),
    // Current ChatGPT models expose tools through the isolated code-mode host.
    // With that host disabled the model has no web tool, even with web_search=live.
    ...(webSearch?['-c','features.code_mode_host=true','-c','features.standalone_web_search=true']:[]),
    ...(draft?['-c','model_reasoning_effort="low"']:[]),'-']
}
export function launchCodex(jobDirectory,{command=process.env.FUNBAN_CODEX_BIN||'codex',spawnProcess=spawn}={}) {
  const job=JSON.parse(fs.readFileSync(path.join(jobDirectory,'job.json'),'utf8'))
  const {sources}=JSON.parse(fs.readFileSync(path.join(jobDirectory,'materials.json'),'utf8'))
  const webSearch=job.format==='quick-v1'&&job.webSearch===true
  const draft=job.format==='clarify-v1'
  const schema=draft?draftReviewSchema:job.format==='quick-v1'?quickSchema(job):reviewImportSchema
  const packet=draft?draftPacket:job.format==='quick-v1'?quickPacket:reviewPacket
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'funban-codex-'));fs.chmodSync(directory,0o700)
  let child
  try{
    fs.writeFileSync(path.join(directory,'schema.json'),JSON.stringify(z.toJSONSchema(schema)),{mode:0o600})
    child=spawnProcess(command,codexArguments(directory,webSearch,draft),{cwd:directory,env:codexEnvironment(),stdio:['pipe','pipe','pipe'],shell:false})
  }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error}
  let bytes=0,buffer='',failure=null,completed=false,usage=null,diagnostics=null
  const webCalls=new Map(),webUrls=new Set(),queryTexts=new Set()
  const queryCount=()=>[...webCalls.values()].reduce((sum,count)=>sum+count,0)
  function collectUrls(value,depth=0){
    if(!value||typeof value!=='object'||depth>12)return
    for(const [key,entry]of Object.entries(value)){
      if(['url','href'].includes(key)&&typeof entry==='string'){const url=publicWebUrl(entry);if(url&&webUrls.size<100)webUrls.add(url)}
      else if(entry&&typeof entry==='object')collectUrls(entry,depth+1)
    }
  }
  const fail=(code,itemType,diagnostics)=>{if(failure)return;failure=code;child.emit('message',{type:'error',code,...(typeof itemType==='string'&&/^[a-zA-Z_]{1,64}$/.test(itemType)?{itemType}:{}),...(diagnostics?{diagnostics}:{})});child.kill('SIGTERM')}
  child.stdout.setEncoding('utf8')
  child.stdout.on('data',chunk=>{
    bytes+=Buffer.byteLength(chunk);if(bytes>256*1024){fail('CODEX_OUTPUT_LIMIT');return}
    buffer+=chunk.toString();let newline
    while((newline=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue
      let event;try{event=JSON.parse(line)}catch{fail('CODEX_PROTOCOL');return}
      if(event.type==='turn.failed'||event.type==='error')fail('CODEX_UNAVAILABLE',undefined,diagnostics)
      if(event.type==='turn.completed'){completed=true;usage=event.usage??null}
      if(event.item?.type==='error'){
        const message=JSON.stringify(event.item)
        const tags=['schema','quota','rate limit','unauthorized','authentication','connection','reconnecting','model','unsupported','invalid','usage','limit','retry','login','refresh','stream','billing','credit','capacity','insufficient','permission','denied','not found','failed','timed out','expired'].filter(tag=>message.toLowerCase().includes(tag))
        const status=message.match(/(?:status|HTTP)[: ]+(\d{3})/i)?.[1]??null
        const schemaRule=message.match(/['"](?:minimum|maximum|minLength|maxLength|pattern|additionalProperties|required|type|format)['"] (?:is not permitted|is required|must be)/)?.[0]??null
        diagnostics={tags,status,schemaRule,itemKeys:Object.keys(event.item).filter(key=>/^[a-zA-Z_]{1,40}$/.test(key))}
      }
      if(event.item?.type==='web_search'&&webSearch){
        const item=event.item,id=item.id
        if(typeof id!=='string'||!id||id.length>200){fail('CODEX_PROTOCOL');return}
        const count=item.action?.type==='search'?Math.max(1,item.action.queries?.length??0):0
        webCalls.set(id,Math.max(webCalls.get(id)??0,count))
        if(webCalls.size>webLimits.calls||queryCount()>webLimits.queries){fail('CODEX_WEB_LIMIT');return}
        if(event.type==='item.completed'){
          if(job.evidencePolicy&&item.action?.type==='search'){
            for(const query of item.action.queries??[item.action.query])if(typeof query==='string'&&queryTexts.size<webLimits.queries)queryTexts.add(query.slice(0,400))
          }
          // Provenance only: a completed tool call is not proof that every source claim is true.
          collectUrls(item.results)
          if(['open_page','find_in_page'].includes(item.action?.type))collectUrls(item.action)
        }
      }else if(event.item?.type&&!['error','agent_message','reasoning','plan','todo_list'].includes(event.item.type))fail('CODEX_UNEXPECTED_TOOL',event.item.type)
    }
  })
  // Never pass provider messages, credentials or stderr through to the browser.
  child.stderr.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>256*1024)fail('CODEX_OUTPUT_LIMIT')})
  child.stdin.on('error',()=>fail('CODEX_UNAVAILABLE'))
  child.once('error',()=>{fs.rmSync(directory,{recursive:true,force:true})})
  child.once('close',code=>{
    try{
      if(failure)return
      if(code!==0||!completed){child.emit('message',{type:'error',code:'CODEX_UNAVAILABLE',diagnostics});return}
      const file=path.join(directory,'answer.json')
      if(fs.statSync(file).size>64*1024)throw new Error('OUTPUT_LIMIT')
      const review=schema.parse(JSON.parse(fs.readFileSync(file,'utf8')))
      child.emit('message',{type:'review',review,usage,...(webSearch?{web:{calls:webCalls.size,queries:queryCount(),urls:[...webUrls],...(job.evidencePolicy?{queryTexts:[...queryTexts]}:{})}}:{})})
    }catch{child.emit('message',{type:'error',code:'CODEX_INVALID_RESULT'})}
    finally{fs.rmSync(directory,{recursive:true,force:true})}
  })
  child.stdin.end(packet(job,sources))
  return child
}

export const codexErrorMessage=code=>({
  CODEX_WEB_LIMIT:'Достигнут лимит лёгкого веб-поиска. Разбор остановлен без автоматического повтора; оценка задачи не изменена.',
  CODEX_UNAVAILABLE:'Codex не завершил разбор. Проверьте вход через ChatGPT и доступные лимиты. Автоматического повторного запуска не будет; оценки задачи сохранены.',
  CODEX_INVALID_RESULT:'Ответ Codex не прошёл проверку формата. Оценки задачи не изменены.',
  CODEX_OUTPUT_LIMIT:'Ответ Codex превысил допустимый размер. Разбор остановлен, оценки задачи не изменены.',
  CODEX_UNEXPECTED_TOOL:'Codex попытался использовать инструмент вне короткого разбора. Запуск остановлен, оценки задачи не изменены.',
  CODEX_PROTOCOL:'Не удалось прочитать ответ Codex. Оценки задачи не изменены.',
}[code]||null)
