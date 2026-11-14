import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createInboxClarifier} from '../inbox-clarifier.mjs'
function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'funban-clarifier-test-'))
 fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify({snapshot:{title:'Цифровые дизайны',body:'x'.repeat(4000)}}))
 const worker=new EventEmitter();worker.stdin=new PassThrough();worker.stdout=new PassThrough();worker.stderr=new PassThrough();worker.exitCode=null
 worker.kill=()=>{worker.exitCode=0;queueMicrotask(()=>worker.emit('close',0));return true}
 const inputs=[];worker.stdin.on('data',chunk=>inputs.push(JSON.parse(chunk.toString())))
 let invocation
 const bridge=createInboxClarifier({python:'/test/python',model:'/test/model',spawnProcess:(...args)=>{invocation=args;return worker},...options})
 t.after(()=>{bridge.close();fs.rmSync(dir,{recursive:true,force:true})})
 return {bridge,worker,dir,inputs,invocation,send:value=>worker.stdout.write(JSON.stringify(value)+'\n')}
}
test('local clarifier: warm worker, bounded task context, offline environment and one active request',async t=>{
 const x=fixture(t)
 assert.equal((await once(x.bridge.launch(x.dir),'message'))[0].type,'error')
 x.send({ready:true})
 const first=x.bridge.launch(x.dir),result=once(first,'message')
 assert.equal((await once(x.bridge.launch(x.dir),'message'))[0].type,'error')
 assert.equal(x.inputs.length,1);assert.equal(x.inputs[0].body.length,800)
 x.send({id:x.inputs[0].id,question:'Какие дизайны?'})
 assert.deepEqual((await result)[0],{type:'review',review:{question:'Какие дизайны?'}})
 assert.equal(x.invocation[2].shell,false)
 assert.equal(x.invocation[2].env.HF_HUB_OFFLINE,'1')
 assert.equal(x.invocation[2].env.HF_HUB_DISABLE_IMPLICIT_TOKEN,'1')
 assert.equal('OPENAI_API_KEY' in x.invocation[2].env,false)
 first.kill()
})
test('local clarifier: cancelled request cannot leak into the next draft; worker stays warm',async t=>{
 const x=fixture(t);x.send({ready:true})
 const first=x.bridge.launch(x.dir);let replies=0;first.on('message',()=>replies++);first.kill()
 x.send({id:x.inputs[0].id,question:'Старый вопрос?'})
 assert.equal(replies,0);assert.equal(x.worker.exitCode,null)
 const next=x.bridge.launch(x.dir),result=once(next,'message')
 x.send({id:x.inputs[1].id,question:null})
 assert.deepEqual((await result)[0].review,{question:null});next.kill()
})
test('local clarifier: malformed output, oversized output, wrong request ID and crash fail closed',async t=>{
 for(const failure of ['malformed','size','id','crash']){
  const x=fixture(t);x.send({ready:true})
  const request=x.bridge.launch(x.dir),result=once(request,'message')
  if(failure==='malformed')x.worker.stdout.write('invalid\n')
  if(failure==='size')x.worker.stdout.write('x'.repeat(16385))
  if(failure==='id')x.send({id:'wrong',question:'Не показывать?'})
  if(failure==='crash'){x.worker.exitCode=1;x.worker.emit('close',1)}
  assert.equal((await result)[0].type,'error');request.kill()
 }
})
test('local clarifier: no configured model means no external fallback or process',async()=>{
 const bridge=createInboxClarifier({python:'',model:'',spawnProcess:()=>assert.fail('must not spawn')})
 assert.equal((await once(bridge.launch('/not-read'),'message'))[0].type,'error');bridge.close()
})

test('local clarifier: a stuck generation is terminated even after browser cancellation',async t=>{
 const x=fixture(t,{requestTimeoutMs:10});x.send({ready:true})
 const request=x.bridge.launch(x.dir);request.kill()
 await new Promise(resolve=>setTimeout(resolve,25))
 assert.equal(x.worker.exitCode,0)
 assert.equal((await once(x.bridge.launch(x.dir),'message'))[0].type,'error')
})
