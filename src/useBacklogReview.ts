import {useEffect,useRef,useState} from 'react'
import type {PriorityReview} from './trendwatch'
import {fetchBoard} from './portal-session'
export type BacklogReview = {
 reviews?: (PriorityReview & {itemId:string})[]
 available:boolean;busy:boolean
 batch:null|{id:string;total:number;completed:number;ready:number;failed:number;cancelled:number;active:boolean}
 jobs:{itemId:string;id:string;status:string;score:number|null;stale:boolean;reviewDue:boolean}[]
}
export function useBacklogReview(revision:number){
 const [data,setData]=useState<BacklogReview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tick,setTick]=useState(0)
 const requestId=useRef<string|null>(null)
 useEffect(()=>{
  let alive=true,timer:ReturnType<typeof setTimeout>
  async function poll(){try{const r=await fetchBoard('/api/backlog/trendwatch');const d=await r.json();if(!r.ok)throw new Error(d.error);if(alive){setData(d);setError('');timer=setTimeout(()=>void poll(),d.busy?2000:60000)}}catch(e){if(alive)setError(e instanceof Error?e.message:'Не удалось загрузить оценки')}}
  void poll()
  return()=>{alive=false;clearTimeout(timer)}
 },[revision,tick])
 useEffect(()=>{const refresh=()=>setTick(n=>n+1);window.addEventListener('funban-research-refresh',refresh);return()=>window.removeEventListener('funban-research-refresh',refresh)},[])
 async function run(stop=false){
  if(busy)return false
  setBusy(true);setError('')
  try{
   if(!stop)requestId.current??=crypto.randomUUID()
   const r=await fetchBoard('/api/backlog/trendwatch',{method:stop?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(stop?{batchId:data?.batch?.id}:{requestId:requestId.current})}),d=await r.json()
   if(!r.ok){requestId.current=null;throw new Error(d.error)}
   setData(d);requestId.current=null;setTick(n=>n+1);return true
  }catch(e){setError(e instanceof Error?e.message:'Не удалось запустить переоценку');return false}finally{setBusy(false)}
 }
 return {data,error,busy,run}
}
