/* FutureDB Analytics 1.0.0: metadata only, first-party identity, bounded offline queue. */
(()=>{'use strict';
 const script=document.currentScript;const resourceId=script?.dataset.resource;const endpoint=script?.dataset.endpoint||'https://dashboard.future-db.ru/api/v1/events/client';if(!resourceId||window.futuredbAnalytics)return;
 const uid=()=>crypto.randomUUID();const key=`fdb.queue.${resourceId}`,sessionKey=`fdb.session.${resourceId}`;
 const storage={get(k){try{return localStorage.getItem(k);}catch{return null;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
 let visitor=document.cookie.split('; ').find(x=>x.startsWith('fdb_visitor='))?.split('=')[1];if(!/^[a-f0-9-]{36}$/.test(visitor||'')){visitor=uid();const domain=location.hostname==='future-db.ru'||location.hostname.endsWith('.future-db.ru')?'; Domain=.future-db.ru':'';document.cookie=`fdb_visitor=${visitor}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}${domain}`;}
 let lastInput=Date.now(),busy=false;const device=/Android|iPhone|Mobile/i.test(navigator.userAgent)?'mobile':/iPad|Tablet/i.test(navigator.userAgent)?'tablet':'desktop';
 const read=()=>{try{const data=JSON.parse(storage.get(key)||'[]');return Array.isArray(data)?data:[];}catch{return [];}};
 const session=(touch)=>{let saved;try{saved=JSON.parse(storage.get(sessionKey)||'null');}catch{}if(!saved||Date.now()-saved.last>1800000)saved={id:uid(),last:Date.now()};if(touch)saved.last=Date.now();storage.set(sessionKey,JSON.stringify(saved));return saved.id;};
 function emit(kind,fields={},touch=true){const event={version:1,eventId:uid(),resourceId,occurredAt:new Date().toISOString(),kind,visitorId:visitor,sessionId:session(touch),identityKind:'browser',device,sdkVersion:'1.0.0',...fields};const queue=read();queue.push(event);storage.set(key,JSON.stringify(queue.slice(-500)));}
 async function flush(){if(busy||!navigator.onLine)return;const batch=read().slice(0,50);if(!batch.length)return;busy=true;try{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({events:batch}),credentials:'omit',keepalive:true});if(response.ok){const result=await response.json();if(result.accepted+result.duplicates===batch.length){const ids=new Set(batch.map(e=>e.eventId));storage.set(key,JSON.stringify(read().filter(e=>!ids.has(e.eventId))));}}}catch{}finally{busy=false;}}
 const safeRoute=()=>location.pathname.replace(/[a-f0-9-]{24,}/gi,':id').replace(/[^a-zA-Z0-9_./:\[\]-]/g,'').slice(0,200)||'/';
 function view(){emit('page_view',{route:safeRoute()});void flush();}
 function track(action,outcome='success'){if(!/^[a-zA-Z0-9_.:-]{1,100}$/.test(action)||!['success','error','started','cancelled','cache_hit'].includes(outcome))return;lastInput=Date.now();emit('action',{action,outcome,route:safeRoute()});void flush();}
 window.futuredbAnalytics={track,version:'1.0.0'};
 window.addEventListener('futuredb:action',event=>{if(event.detail&&typeof event.detail.name==='string')track(event.detail.name,event.detail.outcome||'success');});
 for(const type of ['pointerdown','keydown','touchstart'])document.addEventListener(type,()=>{lastInput=Date.now();session(true);},{passive:true});
 for(const method of ['pushState','replaceState']){const original=history[method];history[method]=function(...args){const before=location.pathname;const result=original.apply(this,args);if(before!==location.pathname)view();return result;};}
 window.addEventListener('popstate',view);window.addEventListener('online',()=>void flush());
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){lastInput=Date.now();session(true);}void flush();});
 setInterval(()=>{if(document.visibilityState==='visible'&&Date.now()-lastInput<300000)emit('heartbeat',{route:safeRoute()},false);void flush();},60000);
 setInterval(()=>void flush(),15000);view();
})();
