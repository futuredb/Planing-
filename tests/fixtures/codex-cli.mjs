#!/usr/bin/env node
/** Explicit synthetic CLI for local HTTP/browser tests. Never contacts a model. */
import fs from 'node:fs'
const args=process.argv.slice(2),chunks=[]
for await(const chunk of process.stdin)chunks.push(chunk)
const prompt=Buffer.concat(chunks).toString(),marker='## Шаблон ответа\n'
const result=JSON.parse(prompt.slice(prompt.lastIndexOf(marker)+marker.length))
const taskMarker=['## Данные задачи и доски\n','## Данные задачи, критериев и доски\n'].find(m=>prompt.includes(m))
const taskTitle=taskMarker?JSON.parse(prompt.split(taskMarker)[1].split('\n## Сохранённые материалы')[0]).task.title:prompt
if(taskTitle.includes('Сбой Codex')){console.log(JSON.stringify({type:'turn.failed'}));process.exit(1)}
if('question' in result){
 await new Promise(resolve=>setTimeout(resolve,prompt.includes('Медленное уточнение')?60000:100))
 result.question=prompt.includes('Продукт уже определён')?null:'Какие цифровые дизайны: оформление карт, шаблоны или другое?'
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(result))
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:10}}));process.exit(0)
}
await new Promise(resolve=>setTimeout(resolve,taskTitle.includes('Долгий Codex')?60000:500))
result.recommendation.summary='Синтетическая рекомендация Codex для локального теста.'
if('score' in result.recommendation||('scores' in result.recommendation&&'relatedTasks' in result.recommendation)){
 result.recommendation.verdict='recommend'
 const marker=prompt.includes('## Данные задачи, критериев и доски\n')?'## Данные задачи, критериев и доски\n':'## Данные задачи и доски\n',data=JSON.parse(prompt.split(marker)[1].split('\n## Сохранённые материалы')[0])
 if(result.recommendation.scores){
 const grounded='basis' in result.recommendation.scores[0]
 result.recommendation.scores=data.task.criteria.map(c=>{
 const outputOnly=data.task.title.includes('Один критерий')
 const unknown=grounded&&(outputOnly&&c.id!=='c-output'||data.task.title.includes('Нет оснований')||c.invert&&data.task.title.includes('Неизвестный напряг'))
 return {criterionId:c.id,value:unknown?null:outputOnly?2:c.invert?3:c.max,reason:unknown?'Нет сведений об объёме работы.':'Синтетическое основание для теста.',...(grounded?{basis:unknown?[]:[{kind:'task',ref:'body',quote:data.task.body.slice(0,100)}]}:{assumed:c.invert})}
 })
 }
 else result.recommendation.score=data.task.title.startsWith('Очередь теста ')?Number(data.task.title.match(/Очередь теста (\d+)/)[1])%11:7
 const similar=data.board.items.find(item=>item.title.includes('AI-исследователь'))
 if(similar)result.recommendation.relatedTasks=[{itemId:similar.id,reason:'Похожая задача: сначала проверить отличие.'}]
}else{
result.recommendation.reasons=[{text:'Тестовое основание',evidenceIds:['E1']}]
result.evidence=[{id:'E1',sourceId:'s1',quote:'Синтетическое свидетельство для изолированной проверки.',observation:'Синтетический тест'}]
}
if('searchOutcome' in result){
 result.searchOutcome='found'
 result.sources=[{title:'Синтетический источник',url:'https://example.com/research',signal:'Тестовый внешний сигнал, не исследование рынка.',publishedAt:null,...(prompt.includes('## Поиск актуальности идеи')?{signalType:'market_change',applicability:'Синтетическая проверка связи с задачей, не вывод о рынке.'}:{})}]
 if('rationale' in result.recommendation){
  result.recommendation.summary='Синтетическая рекомендация [1] и [2].'
  result.recommendation.regionalApplicability={status:'conditional',summary:'Применимость к РФ требует местной проверки: тестовые примеры дают только аналогию.',sourceUrls:['https://example.com/research-1']}
  result.recommendation.rationale='Синтетический вывод: профиль команды учитывается; польза MVP сопоставлена с предыдущим пилотом.'
  result.recommendation.limitations='Это проверка интерфейса; тестовые источники не доказывают спрос.'
  result.recommendation.evidenceStrength='moderate'
  result.sources=Array.from({length:3},(_,i)=>({title:`Синтетический пример ${i+1}`,url:`https://example.com/research-${i+1}`,signal:'Синтетический факт для проверки отображения.',publishedAt:null,origin:`Тестовый первоисточник ${i+1}`,relevance:i===2?'analogy':'direct',applicability:'Связь с приоритетом MVP в тестовом сценарии.',limitation:'Не настоящий рыночный источник.'}))
 }
 for(const item of [{id:'search',type:'web_search',action:{type:'search',query:'synthetic topic'}},...result.sources.map((s,i)=>({id:`open-${i}`,type:'web_search',action:{type:'open_page',url:s.url}}))])console.log(JSON.stringify({type:'item.completed',item}))
}
if('rationale' in result.recommendation){
 const data=JSON.parse(prompt.split('## Данные задачи и доски\n')[1].split('\n## Сохранённые материалы')[0])
 if('decisionValue' in result.recommendation){result.recommendation.decisionValue='Решить, применять ли исследуемый подход: синтетический тест.';result.recommendation.comparison={status:'insufficient',itemIds:[],reason:'Синтетический тест: преимущество по очередности не установлено.'}}
 if(data.task.comments?.items.length)result.recommendation.rationale=`Синтетическая проверка передачи комментария: ${data.task.comments.items[0].text}`
}
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(result))
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:10}}))
