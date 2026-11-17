import { openRouterConfigurationMessage } from '../trendwatch-openrouter.mjs'
/** Persistent local-only development board. Codex recommendations by default. */
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startMockPortal } from '../tests/mock-portal.mjs'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
process.chdir(root)
const mode=process.env.FUNBAN_TRENDWATCH_MODE||'codex'
if(!['assisted','runtime','codex','openrouter'].includes(mode))throw new Error('Неизвестный режим исследования')
if(mode==='openrouter'&&openRouterConfigurationMessage()){console.error(openRouterConfigurationMessage());process.exit(1)}
if(mode==='runtime'){
process.env.FUNBAN_TRENDWATCH_ROOT ||= path.resolve(root,'../../Trendwancher_v2_gpt')
const check=spawn(process.execPath,['trendwatch-worker.mjs','--check'],{cwd:root,env:process.env,stdio:'inherit'})
const status=await new Promise(resolve=>{check.on('exit',resolve);check.on('error',()=>resolve(1))})
if(status!==0){console.error('Trendwancher не подключён. Проверьте FUNBAN_TRENDWATCH_ROOT и настройки модели/поиска.');process.exit(1)}
}
const port=Number(process.env.FUNBAN_LOCAL_PORT||4338),serverPort=port+1
const dataFile=path.resolve(process.env.FUNBAN_LOCAL_DATA||path.join(root,'data/local-development/lifecycle-demo/state.json'))
await mkdir(path.dirname(dataFile),{recursive:true,mode:0o700})
const clarifierHome=path.join(os.homedir(),'.local/share/funban')
const localPython=path.join(clarifierHome,'clarifier-venv/bin/python')
const localModel=path.join(clarifierHome,'models/qwen3-4b')
const clarifierEnv=process.platform==='darwin'&&existsSync(localPython)&&existsSync(path.join(localModel,'model.safetensors'))?{FUNBAN_CLARIFY_PYTHON:localPython,FUNBAN_CLARIFY_MODEL:localModel}:{}
const portal=await startMockPortal()
const child=spawn(process.execPath,['server.mjs'],{cwd:root,stdio:'inherit',env:{...clarifierEnv,...process.env,
  NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(serverPort),FUNBAN_DATA:dataFile,
  FUNBAN_PUBLIC_URL:`http://127.0.0.1:${port}/`,FUNBAN_PORTAL_IDENTITY_URL:portal.url,
  FUNBAN_TRENDWATCH_CONCEPTS:process.env.FUNBAN_TRENDWATCH_CONCEPTS||'1',FUNBAN_TRENDWATCH_ENABLED:'1',FUNBAN_TRENDWATCH_WEB:process.env.FUNBAN_TRENDWATCH_WEB||'1',FUNBAN_TRENDWATCH_AUTO:process.env.FUNBAN_TRENDWATCH_AUTO||(mode==='openrouter'?'0':'1'),FUNBAN_TRENDWATCH_MODE:mode,FUNBAN_MCP_TOKEN:'',DASHBOARD_INGEST_URL:'',DASHBOARD_INGEST_TOKEN:'',
}})
const proxy=http.createServer((req,res)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host)){res.writeHead(403);res.end('Недопустимый адрес локального сервера');return}
  if(req.url.startsWith('/__test/')){res.writeHead(404);res.end();return}
  if(req.url==='/futuredb-telemetry.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end('/* Local development: telemetry disabled. */');return}
  const upstream=http.request({host:'127.0.0.1',port:serverPort,path:req.url,method:req.method,
    headers:{...req.headers,host:`127.0.0.1:${serverPort}`,cookie:'funban_preview_session=lily'}},response=>{
    res.writeHead(response.statusCode,response.headers);response.pipe(res)
  })
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Локальный сервер ещё запускается.')})
  req.on('aborted',()=>upstream.destroy());res.on('close',()=>{if(!res.writableEnded)upstream.destroy()});req.pipe(upstream)
})
let stopping=false
async function shutdown(){if(stopping)return;stopping=true;proxy.close();child.kill('SIGTERM');await portal.close()}
child.on('error',()=>void shutdown());child.on('exit',()=>void shutdown())
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown())
proxy.on('error',()=>void shutdown())
proxy.listen(port,'127.0.0.1',()=>console.log(`Local development board: http://127.0.0.1:${port}/\nPersistent data: ${dataFile}`))
