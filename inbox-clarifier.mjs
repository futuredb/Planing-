import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

/** One warm, offline model. No HTTP port, shell, tools, history or remote fallback. */
export function createInboxClarifier({python=process.env.FUNBAN_CLARIFY_PYTHON,model=process.env.FUNBAN_CLARIFY_MODEL,
  script=fileURLToPath(new URL('./scripts/clarify-worker.py',import.meta.url)),spawnProcess=spawn,requestTimeoutMs=3000}={}) {
  let worker,ready=false,busy=false,current=null,buffer='',closed=false,pendingId=null,requestTimer
  function stop(){
    ready=false;closed=true;clearTimeout(requestTimer)
    if(current){const request=current;current=null;request.emit('message',{type:'error'})}
    if(worker&&worker.exitCode===null){worker.kill('SIGTERM');const timer=setTimeout(()=>{if(worker.exitCode===null)worker.kill('SIGKILL')},2000);timer.unref();worker.once('close',()=>clearTimeout(timer))}
  }
  if(python&&model){
    try{
      worker=spawnProcess(python,['-u',script,model],{stdio:['pipe','pipe','pipe'],shell:false,
        env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'en_US.UTF-8',PYTHONNOUSERSITE:'1',HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',TOKENIZERS_PARALLELISM:'false'}})
      worker.stderr?.resume() // Never log task text or Python/provider diagnostics.
      worker.stdin.on('error',stop)
      const warmup=setTimeout(stop,30000);warmup.unref()
      worker.once('error',()=>{clearTimeout(warmup);stop()})
      worker.once('close',()=>{clearTimeout(warmup);clearTimeout(requestTimer);closed=true;ready=false;busy=false;if(current){const request=current;current=null;request.emit('message',{type:'error'})}})
      worker.stdout.setEncoding('utf8')
      worker.stdout.on('data',chunk=>{
        buffer+=chunk
        if(buffer.length>16384){stop();return}
        let end
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1)
          try{
            const message=JSON.parse(line)
            if(closed)return
            if(message.ready===true){clearTimeout(warmup);ready=true;console.log('Local inbox clarifier ready.');continue}
            if(!pendingId||message.id!==pendingId){stop();return}
            clearTimeout(requestTimer);busy=false;pendingId=null
            if(current&&message.id===current.id){const request=current;current=null;request.emit('message',{type:'review',review:{question:message.question}})}
          }catch{stop();return}
        }
      })
    }catch{stop()}
  }
  return {
    launch(directory){
      const request=new EventEmitter();request.id=randomUUID();request.exitCode=null
      request.kill=()=>{if(request.exitCode!==null)return;request.exitCode=0;if(current===request)current=null;queueMicrotask(()=>request.emit('close',0))}
      if(closed||!ready||busy){queueMicrotask(()=>request.emit('message',{type:'error'}));return request}
      try{
        const {snapshot}=JSON.parse(fs.readFileSync(path.join(directory,'job.json'),'utf8'))
        current=request;busy=true;pendingId=request.id
        requestTimer=setTimeout(stop,requestTimeoutMs);requestTimer.unref()
        worker.stdin.write(JSON.stringify({id:request.id,title:snapshot.title.slice(0,500),body:snapshot.body.slice(0,800)})+'\n')
      }catch{queueMicrotask(()=>request.emit('message',{type:'error'}))}
      return request
    },
    close(){closed=true;stop()},
  }
}
