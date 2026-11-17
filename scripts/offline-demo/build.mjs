// Bundle the real Funban entry, components and stylesheet. Only the data boundary is replaced.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'
import react from '@vitejs/plugin-react'
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..'),out=path.join(root,'output/share')
const data=path.join(root,'data/local-development/lifecycle-demo')
const state=JSON.parse(fs.readFileSync(path.join(data,'state.json'),'utf8'))
const runs=JSON.parse(fs.readFileSync(path.join(data,'four-task-consistency/runs.json'),'utf8'))
const archive=path.join(data,'state.json.trendwatch')
const archived=fs.readdirSync(archive).filter(id=>/^[a-f0-9-]{36}$/.test(id)).map(id=>JSON.parse(fs.readFileSync(path.join(archive,id,'job.json'),'utf8'))).filter(j=>j.status==='ready').sort((a,b)=>b.createdAt-a.createdAt)
const pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o?.[k]!==undefined).map(k=>[k,o[k]]))
const asset=name=>{const ext=path.extname(name);return `data:${ext==='.svg'?'image/svg+xml':'image/png'};base64,${fs.readFileSync(path.join(root,'public',name)).toString('base64')}`}
// Allowlisted UI fields. Do not export raw state, attachments, comment archives, job prompts or logs.
const board={updatedAt:state.updatedAt,currentMemberId:state.currentMemberId||state.members[0].id,roles:state.roles,criteria:state.criteria.map(c=>pick(c,['id','name','weight','invert','hint','max','step'])),members:state.members.map(m=>({...pick(m,['id','name','role']),avatar:asset(`avatars/${m.id}.png`)})),sprints:state.sprints.map(s=>pick(s,['id','weekStart','goal','goalClosed','closed','roles'])),comments:[],items:state.items.filter(i=>['backlog','inbox'].includes(i.lane)).map(i=>({...pick(i,['id','number','title','body','lane','sprintId','parentId','relatedIds','assigneeId','authorId','scores','priorityScore','matrixBucket','createdAt','archivedAt']),attachments:[],stickers:(i.stickers??[]).map(s=>pick(s,['id','sticker','by','x','y','rot','scale']))}))}
const jobs={}
for(const item of board.items){
 const j=runs.find(r=>r.id===item.id)?.result??archived.find(j=>j.itemId===item.id)
 if(!j?.recommendation)continue
 const r=j.recommendation
 jobs[item.id]={...pick(j,['id','priorityPolicy','evidencePolicy','webSearch','searchOutcome','format','mode','stage','createdAt','completedAt']),itemId:item.id,status:'ready',stale:false,comparisonCurrent:true,context:pick(j.context,['audience','goal','geography','horizon']),message:null,snapshot:{title:item.title,body:item.body,scores:item.scores,criteria:board.criteria},decision:null,recommendation:{...pick(r,['summary','verdict','score','matrixBucket','assessmentKind','preliminary','decisionValue','rationale','limitations','evidenceStrength','scores']),relatedTasks:(r.relatedTasks??[]).map(x=>pick(x,['itemId','reason'])),...(r.comparison?{comparison:pick(r.comparison,['status','itemIds','reason'])}:{}),...(r.regionalApplicability?{regionalApplicability:pick(r.regionalApplicability,['status','summary','sourceUrls'])}:{})},evidence:(j.evidence??[]).map(e=>({...pick(e,['origin','relevance','limitation','applicability','signalType','id','quote','observation','title','retrievedAt','publishedAt']),url:/^https:\/\//.test(e.url)?e.url:''}))}
}
const seed={board,jobs}
const result=await build({configFile:false,root,define:{'process.env.NODE_ENV':JSON.stringify('production')},publicDir:false,logLevel:'warn',plugins:[{
 name:'offline-data-boundary',enforce:'pre',
 resolveId(source){if(/(?:^|\/)portal-session(?:\.ts)?$/.test(source))return path.join(here,'adapter.js');if(source==='virtual:funban-demo-data')return '\0funban-demo-data'},
 load(id){if(id==='\0funban-demo-data')return 'export default '+JSON.stringify(seed)},
 transform(code,id){
  if(!id.startsWith(path.join(root,'src')+'/'))return
  // Embed the same repository assets; do not replace markup or styles.
  let next=code.replace(/(['"])(\/(?:avatars|stickers)\/[^'"?]+(?:\?[^'"]*)?|\/funban-logo\.png)\1/g,(_,q,p)=>JSON.stringify(asset(p.split('?')[0].slice(1))))
  if(id.endsWith('/draft-storage.ts'))next=next.replaceAll('funban-draft-tab','funban-demo-draft-tab').replaceAll("'funban-drafts'","'funban-demo-drafts'")
  return next===code?null:{code:next,map:null}
 }
},react()],build:{write:false,cssCodeSplit:false,assetsInlineLimit:Infinity,lib:{entry:path.join(root,'src/main.tsx'),name:'FunbanDemo',formats:['iife']},minify:true}})
const outputs=(Array.isArray(result)?result:[result]).flatMap(r=>r.output)
const js=outputs.filter(o=>o.type==='chunk').map(o=>o.code).join('\n'),css=outputs.filter(o=>o.type==='asset'&&o.fileName.endsWith('.css')).map(o=>o.source).join('\n')
if(!js||!css)throw Error('Missing application bundle')
const html=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>Funban · офлайн-демо</title><style>${css}</style></head><body><div id="root"></div><script>${js.replace(/<\/script/gi,'<\\/script')}</script></body></html>`
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'Funban-interactive.html'),html)
// Local QA fixture: same allowlisted payload, never included as a separate file in the share archive.
fs.writeFileSync(path.join(out,'component-demo-fixture.json'),JSON.stringify(seed))
fs.writeFileSync(path.join(out,'demo-manifest.json'),JSON.stringify({backlog:board.items.filter(i=>i.lane==='backlog').length,inbox:board.items.filter(i=>i.lane==='inbox').length,savedRecommendations:Object.keys(jobs).length,entry:'src/main.tsx',styles:'src/index.css',boundary:'scripts/offline-demo/adapter.js'},null,2))
console.log('Built real Funban components + CSS into one offline HTML.')
