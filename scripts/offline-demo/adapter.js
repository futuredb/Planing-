// Build-only replacement for portal-session. Never calls fetch or any remote service.
import seed from 'virtual:funban-demo-data'
import {priorityReviewState} from '../../priority-score.mjs'
export const portalLoginUrl = '#'
const key='funban-component-demo-v1'
const clone=x=>structuredClone(x)
let board=clone(seed.board),jobs=clone(seed.jobs)
const anchor=Date.now(),DAY=86400000
for(const item of board.items){
 const days=item.id==='demo-review-soon'?5:item.id==='demo-review-due'?-5:item.id==='demo-review-returned'?-15:30
 item.priorityReview={reviewedAt:anchor+(days-30)*DAY,...(item.id==='demo-review-returned'?{returnedAt:anchor-DAY,reason:'overdue',previousBucket:'research-next'}:{})}
 if(item.id==='demo-review-returned')item.matrixBucket=null
}
for(const job of Object.values(jobs)){job.createdAt=anchor;job.completedAt=anchor;job.stale=false;job.reviewDue=false;job.decision=null}
try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved?.board?.items&&saved.version===1){board=saved.board;for(const j of Object.values(jobs)){j.decision=board.items.find(i=>i.id===j.itemId)?.trendwatchDecision??null}}}catch{/* File storage can be blocked; keep an in-memory demo. */}
function persist(){board.updatedAt=Math.max(Date.now(),board.updatedAt+1);try{localStorage.setItem(key,JSON.stringify({version:1,board}))}catch{}}
function maintain(){let changed=false;for(const i of board.items){const r=priorityReviewState(i,null);if(i.lane==='backlog'&&!r.returnedAt&&Date.now()>=r.returnAt){i.priorityReview={...i.priorityReview,returnedAt:Date.now(),reason:'overdue',previousBucket:i.matrixBucket??null};i.matrixBucket=null;changed=true}}if(changed)persist()}
function reply(data,status=200){return new Response(status===304?null:JSON.stringify(data),{status,headers:{'Content-Type':'application/json','X-Funban-Actor-Id':board.currentMemberId}})}
function publicJob(item){const j=jobs[item.id];if(!j)return null;return {...clone(j),stale:j.snapshot.title!==item.title||j.snapshot.body!==item.body,decision:item.trendwatchDecision??null}}
const offlineMessage='Офлайн-демо: показана сохранённая рекомендация. Новые ИИ-запуски отключены; изменения сохраняются только в этом браузере.'
export async function fetchBoard(input,init={}){
 maintain()
 const url=new URL(String(input),'https://offline.invalid'),method=init.method??'GET',body=init.body?JSON.parse(init.body):{}
 if(url.pathname==='/api/state'){
  if(method==='GET')return Number(url.searchParams.get('since'))>=board.updatedAt?reply(null,304):reply(clone(board))
  if(method==='PUT'){
   if(!Array.isArray(body.items))return reply({error:'Некорректная доска'},422)
   if(Number(init.headers?.['X-Funban-Base-Updated-At'])!==board.updatedAt)return reply({currentUpdatedAt:board.updatedAt},409)
   const numbers={};let next=Math.max(0,...board.items.map(i=>i.number??0))
   board={...body,currentMemberId:board.currentMemberId};for(const i of board.items)if(!i.number){i.number=++next;numbers[i.id]=i.number}
   persist();return reply({ok:true,updatedAt:board.updatedAt,preservedIds:[],taskNumbers:numbers})
  }
 }
 if(url.pathname==='/api/backlog/trendwatch'){
  if(method!=='GET')return reply({error:offlineMessage},403)
  return reply({available:false,busy:false,batch:null,reviews:board.items.filter(i=>i.lane==='backlog').map(i=>({itemId:i.id,...priorityReviewState(i,null)})),jobs:board.items.map(i=>{const j=publicJob(i);return j?{itemId:i.id,id:j.id,status:j.status,score:j.recommendation?.score??null,stale:j.stale,reviewDue:false}:null}).filter(Boolean)})
 }
 if(url.pathname==='/api/inbox/clarify')return reply({question:null})
 const match=url.pathname.match(/^\/api\/items\/([^/]+)\/(move|trendwatch)(\/confirm|\/decision)?$/)
 if(match){
  const item=board.items.find(i=>i.id===decodeURIComponent(match[1]));if(!item)return reply({error:'Задача не найдена'},404)
  if(match[2]==='move'&&method==='POST'){item.lane=body.lane;if(body.sprintId!==undefined)item.sprintId=body.sprintId;persist();return reply({ok:true,updatedAt:board.updatedAt})}
  if(method==='GET')return reply({available:true,offline:true,automatic:false,mode:'codex',configurationMessage:offlineMessage,review:priorityReviewState(item,null),job:publicJob(item)})
  if(match[3]==='/confirm'&&method==='POST'){
   const job=publicJob(item)
   if(!job||job.stale||job.id!==body.jobId||typeof body.score!=='number'||!Number.isFinite(body.score)||body.score<0||body.score>10)return reply({error:'Проверьте рекомендацию и оценку от 0 до 10'},422)
   item.priorityScore=body.score;if(body.score===0)item.matrixBucket=null
   if(item.lane==='inbox'){item.lane='backlog';item.sprintId=null;item.archivedAt=null}
   item.trendwatchDecision={jobId:job.id,score:body.score,confirmedAt:Date.now(),confirmedBy:board.currentMemberId,confirmedByName:'Лид (демо)',scores:item.scores,matrixBucket:item.matrixBucket??null,comment:''}
   item.priorityReview={reviewedAt:Date.now()};persist();return reply({ok:true,decision:item.trendwatchDecision})
  }
  if(match[3]==='/decision'&&method==='POST'&&['keep','reject'].includes(body.action)){
   item.priorityReview={reviewedAt:Date.now(),...(body.action==='reject'?{returnedAt:Date.now(),reason:'rejected',previousBucket:item.matrixBucket??null}:{})}
   if(body.action==='reject'){item.matrixBucket=null;item.lane='backlog';item.sprintId=null}persist();return reply({ok:true})
  }
 }
 return reply({error:offlineMessage},403)
}
