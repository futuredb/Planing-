/** Optional real-model check on Apple Silicon: no APIs, web search or board writes. */
import {spawn} from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const home=path.join(os.homedir(),'.local/share/funban')
const cases=[
 {title:'Поисследовать продажи цифровых дизайнов методом conjoint-анализа',body:'Цель бизнеса — продать много цифровых дизайнов. Нужно понять, что необходимо пользователям, что они готовы покупать, наполнение фичами.',question:/дизайн/i},
 {title:'Исправить ошибку загрузки аватара',body:'При загрузке PNG в профиле появляется ошибка 500.',question:null},
 {title:'Исследовать спрос на новый сервис',body:'Хотим понять, кто готов платить.',question:/сервис/i},
 {title:'Подобрать цены на шаблоны презентаций для дизайнеров',body:'Провести conjoint-анализ сочетаний цены и количества слайдов.',question:null},
 {title:'Добавить кнопку экспорта задач в CSV',body:'Пользователи хотят выгружать список задач.',question:null},
 {title:'Поисследовать цифровые дизайны',body:'Имеется в виду оформление банковских карт. Хотим узнать, какие изображения люди готовы покупать.',question:null},
]
const child=spawn(process.env.FUNBAN_CLARIFY_PYTHON||path.join(home,'clarifier-venv/bin/python'),['-u',fileURLToPath(new URL('./clarify-worker.py',import.meta.url)),process.env.FUNBAN_CLARIFY_MODEL||path.join(home,'models/qwen3-4b')],{
 env:{PATH:process.env.PATH,HOME:os.homedir(),HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_IMPLICIT_TOKEN:'1',PYTHONNOUSERSITE:'1',TOKENIZERS_PARALLELISM:'false'},stdio:['pipe','pipe','ignore'],shell:false})
const lines=readline.createInterface({input:child.stdout})
function next(timeout){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>finish(new Error('Local model timed out')),timeout)
 const line=value=>{try{finish(null,JSON.parse(value))}catch{finish(new Error('Invalid model protocol'))}}
 const fail=()=>finish(new Error('Local model unavailable'))
 function finish(error,value){clearTimeout(timer);lines.off('line',line);child.off('error',fail);child.off('close',fail);if(error)reject(error);else resolve(value)}
 lines.once('line',line);child.once('error',fail);child.once('close',fail)
})}
try{
 const warmup=performance.now();assert.equal((await next(30000)).ready,true)
 console.log(JSON.stringify({warmupMs:Math.round(performance.now()-warmup)}))
 for(let round=0;round<2;round++)for(let i=0;i<cases.length;i++){
  const {question:expected,...input}=cases[i],id=`${round}:${i}`
  const started=performance.now(),result=next(2500)
  child.stdin.write(JSON.stringify({id,...input})+'\n')
  const output=await result,elapsedMs=Math.round(performance.now()-started)
  assert.equal(output.id,id)
  console.log(JSON.stringify({round,title:input.title,elapsedMs,question:output.question}))
  if(expected===null)assert.equal(output.question,null)
  else {assert.equal(typeof output.question,'string');assert.match(output.question,expected);assert.ok(output.question.length<=180)}
 }
}finally{lines.close();child.kill('SIGTERM');const timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL')},2000);timer.unref();child.once('close',()=>clearTimeout(timer))}
