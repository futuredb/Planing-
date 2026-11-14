import { useEffect, useRef, useState } from 'react'
import { fetchBoard } from './portal-session'

/** Bounded optional clarification. Typing and saving never wait for the model. */
export function useInboxClarification(title:string,body:string) {
  const [question,setQuestion]=useState<{text:string;title:string}|null>(null)
  const [answer,setAnswer]=useState('')
  const [revision,setRevision]=useState(0)
  const controller=useRef<AbortController|null>(null)
  const generation=useRef(0),attempts=useRef(0),skipped=useRef(false)
  const latest=useRef({title,body})
  useEffect(()=>{latest.current={title,body}},[title,body])
  const lastAttempt=useRef('')
  useEffect(()=>()=>{generation.current++;controller.current?.abort()},[])
  useEffect(()=>{
    const key=JSON.stringify([title,body])
    if(skipped.current||controller.current||attempts.current>=3||title.trim().length<12||lastAttempt.current===key||question?.title===title)return
    const timer=setTimeout(async()=>{
      const version=generation.current
      const abort=new AbortController();controller.current=abort
      lastAttempt.current=key;attempts.current++
      try{
        const response=await fetchBoard('/api/inbox/clarify',{method:'POST',headers:{'Content-Type':'application/json'},signal:abort.signal,body:JSON.stringify({title:title.slice(0,500),body:body.slice(0,4000)})})
        if(!response.ok)return
        const result=await response.json()
        if(version===generation.current&&key===JSON.stringify([latest.current.title,latest.current.body])&&typeof result.question==='string'&&result.question.length>0&&result.question.length<=180){
          setQuestion({text:result.question,title});setAnswer('')
        }
      }catch{/* Optional: adding a task remains available even when the model is offline. */}
      finally{
        if(controller.current===abort)controller.current=null
        if(version===generation.current)setRevision(value=>value+1)
      }
    },400)
    // Let an in-flight request finish; coalesce new keystrokes into the next attempt.
    return()=>clearTimeout(timer)
  },[title,body,question,revision])
  const current=question?.title===title?question.text:null
  function skip(){skipped.current=true;generation.current++;controller.current?.abort();controller.current=null;setQuestion(null);setAnswer('')}
  function reset(){skip();skipped.current=false;attempts.current=0;lastAttempt.current=''}
  return {question:current,answer,setAnswer,skip,reset,
    context:current&&answer.trim()?`Уточнение: ${current}\nОтвет: ${answer.trim()}`:''}
}
