import {chromium,expect} from '@playwright/test'
import fs from 'node:fs'
import {pathToFileURL} from 'node:url'
const dir='output/share',seed=JSON.parse(fs.readFileSync(dir+'/component-demo-fixture.json')),now=Date.now(),DAY=86400000
const board=structuredClone(seed.board),jobs=structuredClone(seed.jobs)
for(const i of board.items){const days=i.id==='demo-review-soon'?5:i.id==='demo-review-due'?-5:i.id==='demo-review-returned'?-15:30;i.priorityReview={reviewedAt:now+(days-30)*DAY,...(i.id==='demo-review-returned'?{returnedAt:now-DAY,reason:'overdue',previousBucket:'research-next'}:{})};if(i.id==='demo-review-returned')i.matrixBucket=null}
for(const j of Object.values(jobs)){j.createdAt=now;j.completedAt=now;j.stale=false;j.reviewDue=false;j.decision=null}
const review=i=>({dueAt:i.priorityReview.reviewedAt+30*DAY,needsDecision:i.lane==='backlog'&&now>=i.priorityReview.reviewedAt+30*DAY,returnAt:i.priorityReview.reviewedAt+44*DAY,returnedAt:i.priorityReview.returnedAt??null,reason:i.priorityReview.reason??null,previousBucket:i.priorityReview.previousBucket??null})
const browser=await chromium.launch(),ctx=await browser.newContext({viewport:{width:1440,height:1050}})
// The reference UI comes from localhost:4338. All data requests are fulfilled in-memory;
// no write or AI request reaches the running local server.
const ref=await ctx.newPage();await ref.clock.setFixedTime(now)
await ref.route('**/*',async route=>{
 const u=new URL(route.request().url())
 if(u.origin!=='http://127.0.0.1:4338')return route.abort()
 if(!u.pathname.startsWith('/api/')){if(u.pathname.includes('telemetry'))return route.fulfill({body:''});return route.continue()}
 if(route.request().method()!=='GET')return route.fulfill({status:403,json:{error:'Read-only visual reference'}})
 let response
 if(u.pathname==='/api/state')response=board
 else if(u.pathname==='/api/backlog/trendwatch')response={available:false,busy:false,batch:null,reviews:board.items.filter(i=>i.lane==='backlog').map(i=>({itemId:i.id,...review(i)})),jobs:Object.values(jobs).map(j=>({itemId:j.itemId,id:j.id,status:'ready',score:j.recommendation.score,stale:false,reviewDue:false}))}
 else {const id=u.pathname.match(/\/items\/([^/]+)\/trendwatch$/)?.[1],item=board.items.find(i=>i.id===id);response=item?{available:true,mode:'codex',automatic:false,job:jobs[id]??null,review:review(item),configurationMessage:null}:{}}
 return route.fulfill({json:response,headers:{'X-Funban-Actor-Id':board.currentMemberId}})
})
const demo=await ctx.newPage();await demo.clock.setFixedTime(now)
await ref.goto('http://127.0.0.1:4338/');await demo.goto(pathToFileURL(process.cwd()+'/'+dir+'/Funban-interactive.html').href)
async function nav(p,name){await p.getByRole('button',{name,exact:true}).first().click()}
const metrics=async(p,selectors)=>{const out={};for(const s of selectors)out[s]=await p.locator(s).first().evaluate(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.x,y:r.y,width:r.width,height:r.height,font:s.font,borderRadius:s.borderRadius,padding:s.padding,gap:s.gap,color:s.color,background:s.backgroundColor}});return out}
for(const [width,height]of [[1440,1050],[390,844]]){
 await ref.setViewportSize({width,height});await demo.setViewportSize({width,height})
 for(const name of ['Бэклог','Входящие']){
  for(const p of [ref,demo]){await nav(p,name);await expect(p.locator(name==='Бэклог'?'.matrix-card':'.inbox-list > li')).toHaveCount(name==='Бэклог'?50:2);await expect(p.locator('.ai-score-button').first()).not.toHaveText('—');await p.screenshot({path:`${dir}/compare-${p===ref?'original':'demo'}-${width}-${name==='Бэклог'?'backlog':'inbox'}.png`,animations:'disabled'})}
  const selectors=name==='Бэклог'?['.context-bar','.backlog-matrix','.matrix-card','.matrix-unassigned','.ai-score-button','.matrix-score']:['.context-bar','.inbox-list','.inbox-item-controls','.ai-score-button','.inbox-item-actions .compact-button']
  const a=await metrics(ref,selectors),b=await metrics(demo,selectors)
  if(JSON.stringify(a)!==JSON.stringify(b)){fs.writeFileSync(`${dir}/visual-mismatch.json`,JSON.stringify({width,name,a,b},null,2));throw Error('Visual geometry mismatch: '+width+' '+name)}
 }
}
// Desktop recommendation: same component, with the deliberate offline explanatory line.
for(const p of [ref,demo]){await p.setViewportSize({width:1440,height:1050});await p.locator('.inbox-list > li').filter({hasText:'Автоматизировать сбор материалов'}).locator('.ai-score-button').click();await expect(p.getByRole('dialog').getByLabel('Оценка приоритета')).toHaveValue('7');await p.screenshot({path:`${dir}/compare-${p===ref?'original':'demo'}-dialog.png`,animations:'disabled'})}
fs.writeFileSync(`${dir}/visual-comparison.txt`,'PASS: identical layout and computed styles for backlog/inbox at 1440 and 390 px with the same isolated data. Original served on 4338; all API requests intercepted, writes blocked. Modal uses same component; offline message is intentional.\n')
console.log('PASS: original vs demo layout/styles equal at desktop/mobile. Reference read-only; screenshots captured.')
await browser.close()
