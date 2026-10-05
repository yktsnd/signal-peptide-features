import { contract, validateEvent } from '../../telemetry/contract.mjs';
type Props = Record<string, string | number | boolean>;
type UsageEvent = ReturnType<typeof validateEvent>;
type Stream = {id: string; token: string; expires: number};
const PREF='sp-usage-consent-v1', STREAM='sp-usage-stream-v1';
let ready=false, initialized=false, stream: Stream|null=null, session='',seq=0;
let queue: UsageEvent[]=[], timer: ReturnType<typeof setTimeout>|undefined, sending=false, db: IDBDatabase|null=null;
let dropped=0,retried=0,lastError='',generation=0,activeAt=0;
let context: Props={screen:'input',lang:'ja',execution:'browser',width:'unknown'};
const state={consent:'unset',enabled:false,pending:0,error:'',expires:0,collecting:false};
function publish(){state.collecting=ready;state.pending=queue.length;state.error=lastError;state.expires=stream?.expires||0;if(typeof window!=='undefined')window.dispatchEvent(new Event('ux-state'));}
export function telemetryState(){return {...state};}
function storageGet(k:string){try{return localStorage.getItem(k);}catch{return null;}}
function storageSet(k:string,v:string|null){try{v===null?localStorage.removeItem(k):localStorage.setItem(k,v);return true;}catch{return false;}}
function width(){return innerWidth<600?'small':innerWidth<1100?'medium':'large';}
function dwell(){if(activeAt&&typeof document!=='undefined'&&document.visibilityState==='visible')track('view_duration','view',{duration_ms:Math.min(3600000,performance.now()-activeAt)});activeAt=typeof performance!=='undefined'?performance.now():0;}
export function usageContext(props:Props){if(props.screen&&props.screen!==context.screen)dwell();context={...context,...props};}
async function database(){if(db)return db;return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('sp-usage-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('events',{keyPath:'id'});req.onsuccess=()=>{db=req.result;resolve(db);};req.onerror=()=>reject(Error('storage'));});}
async function stored(operation:'read'|'write'|'remove'|'clear',values:UsageEvent[]=[]){
  const databaseValue=await database();return new Promise<UsageEvent[]>((resolve,reject)=>{const tx=databaseValue.transaction('events',operation==='read'?'readonly':'readwrite'),store=tx.objectStore('events');let rows:UsageEvent[]=[];
    if(operation==='read'){const req=store.getAll();req.onsuccess=()=>rows=req.result;}
    if(operation==='write')values.forEach(e=>store.put(e));
    if(operation==='remove')values.forEach(e=>store.delete(e.id));
    if(operation==='clear')store.clear();tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(Error('storage'));tx.onabort=()=>reject(Error('storage'));
  });
}
const uid=()=>crypto.randomUUID();
export function track(event:string,target:string,props:Props={}){
  if(!ready||state.consent!=='yes'||!stream)return;
  try {
    const value=validateEvent({id:uid(),session,seq:++seq,at:Date.now(),schema:contract.schema_version,ui:contract.ui_version,event,target,props:{...context,width:width(),modality:'system',...props}});
    queue.push(value);if(queue.length>200){const removed=queue.splice(0,queue.length-200);dropped+=removed.length;void stored('remove',removed).catch(()=>{});}
    void stored('write',[value]).catch(()=>{lastError='storage';publish();});publish();schedule(queue.length>=30?0:2000);
  }catch{dropped++;}
}
function schedule(ms:number){if(timer)clearTimeout(timer);timer=setTimeout(()=>void flush(),ms);}
export async function flush(){
  if(sending||!ready||!stream||state.consent!=='yes'||!queue.length)return;
  const token=stream, version=generation,batch=queue.slice(0,30);sending=true;
  try{
    const response=await fetch(`/api/telemetry/sessions/${token.id}/events`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token.token},body:JSON.stringify({events:batch}),keepalive:true,signal:AbortSignal.timeout(8000)});
    if(version!==generation)return;
    if(response.status===401){ready=false;lastError='expired';publish();return;}
    if(response.status===422||response.status===400){queue=queue.filter(e=>!batch.some(b=>b.id===e.id));dropped+=batch.length;await stored('remove',batch).catch(()=>{});lastError='rejected';return;}
    if(!response.ok)throw Error('network');
    const data=await response.json();const accepted=new Set(Array.isArray(data.accepted)?data.accepted:[]);const done=batch.filter(e=>accepted.has(e.id));
    if(done.length!==batch.length)throw Error('network');
    queue=queue.filter(e=>!accepted.has(e.id));await stored('remove',done).catch(()=>{});lastError='';retried=0;
  }catch{if(version===generation){retried++;lastError='network';}}
  finally{sending=false;publish();if(ready&&queue.length)schedule(Math.min(60000,2000*2**Math.min(retried,5)));}
}
export async function setUsageConsent(value:'yes'|'no'){
  const consentGeneration=++generation;ready=false;if(timer)clearTimeout(timer);state.consent=value;storageSet(PREF,value);
  if(value==='no'){queue=[];await stored('clear').catch(()=>{});publish();return;}
  if(!state.enabled){lastError='disabled';publish();return;}
  try{
    const raw=storageGet(STREAM);let existing:Stream|null=null;try{existing=raw?JSON.parse(raw):null;}catch{}
    if(existing?.expires&&existing.expires>Date.now()&&/^[0-9a-f-]{36}$/.test(existing.id)&&/^[0-9a-f]{64}$/.test(existing.token))stream=existing;
    else{const bytes=crypto.getRandomValues(new Uint8Array(32));stream={id:uid(),token:[...bytes].map(n=>n.toString(16).padStart(2,'0')).join(''),expires:Date.now()+30*86400000};await stored('clear').catch(()=>{});}
    const response=await fetch('/api/telemetry/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:stream.id,token:stream.token,consent:'1'})});if(!response.ok)throw Error('network');
    const data=await response.json();if(consentGeneration!==generation||state.consent!=='yes')return;stream.expires=data.expires;storageSet(STREAM,JSON.stringify(stream));
    const previous=await stored('read').catch(()=>[]);const valid=previous.filter(e=>{try{validateEvent(e);return true;}catch{return false;}});queue=valid.slice(-200);const discarded=previous.filter(e=>!queue.includes(e));dropped+=discarded.length;await stored('remove',discarded).catch(()=>{});
    if(consentGeneration!==generation||state.consent!=='yes')return;session=uid();seq=0;activeAt=performance.now();ready=true;lastError='';track('session_started','app');publish();
  }catch{lastError='network';publish();}
}
export async function deleteUsageData(){
  await setUsageConsent('no');
  const raw=storageGet(STREAM);let saved:Stream|null=null;try{saved=raw?JSON.parse(raw):null;}catch{}
  if(saved){try{const response=await fetch(`/api/telemetry/sessions/${saved.id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+saved.token}});if(!response.ok&&response.status!==401)throw Error('network');}catch{lastError='delete_failed';publish();return false;}}
  storageSet(STREAM,null);stream=null;lastError='';publish();return true;
}
export function initTelemetry(){
  if(initialized||typeof window==='undefined')return;initialized=true;context.width=width();
  state.consent=storageGet(PREF)==='yes'?'yes':storageGet(PREF)==='no'?'no':'unset';
  void fetch('/api/telemetry/config').then(r=>r.json()).then(v=>{state.enabled=v.enabled===true;publish();if(state.consent==='yes')void setUsageConsent('yes');}).catch(()=>{lastError='network';publish();});
  const targetOf=(event:globalThis.Event)=>event.target instanceof Element?event.target.closest<HTMLElement>('[data-ux]'):null;
  const modality=(event:globalThis.Event)=>event instanceof MouseEvent&&event.detail===0?'keyboard':typeof PointerEvent!=='undefined'&&event instanceof PointerEvent?event.pointerType||'mouse':'unknown';
  document.addEventListener('click',event=>{const el=targetOf(event);if(el)track('ui_activate','app',{control:el.dataset.ux!,modality:modality(event),outcome:'requested'});},true);
  document.addEventListener('pointerdown',event=>{const el=targetOf(event);if(el?.matches(':disabled'))track('ui_disabled','app',{control:el.dataset.ux!,modality:modality(event)});},true);
  document.addEventListener('toggle',event=>{const el=event.target instanceof HTMLDetailsElement?event.target:null;const control=el?.querySelector<HTMLElement>('summary[data-ux]');if(control)track('ui_toggle','app',{control:control.dataset.ux!,enabled:el!.open?'yes':'no'});},true);
  document.addEventListener('change',event=>{const el=targetOf(event);if(!el)return;const field=el as HTMLInputElement;track('ui_input','app',{control:el.dataset.ux!,filled:!!field.value});},true);
  document.addEventListener('focusin',event=>{const el=targetOf(event);if(el)track('ui_focus','app',{control:el.dataset.ux!});},true);
  const focused=new WeakMap<Element,number>();
  document.addEventListener('focusin',event=>{const el=targetOf(event);if(el&&ready)focused.set(el,performance.now());},true);
  document.addEventListener('focusout',event=>{const el=targetOf(event);if(el&&focused.has(el)){track('ui_blur','app',{control:el.dataset.ux!,duration_ms:Math.min(3600000,performance.now()-focused.get(el)!)});focused.delete(el);}},true);
  let inputTimer:ReturnType<typeof setTimeout>|undefined,hoverTimer:ReturnType<typeof setTimeout>|undefined;
  document.addEventListener('input',event=>{const el=targetOf(event);if(!el||!ready)return;if(inputTimer)clearTimeout(inputTimer);const filled=!!(el as HTMLInputElement).value;inputTimer=setTimeout(()=>track('ui_input','app',{control:el.dataset.ux!,filled}),500);},true);
  document.addEventListener('pointerover',event=>{const el=targetOf(event);if(!el||!ready)return;if(hoverTimer)clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>track('ui_hover','app',{control:el.dataset.ux!,modality:event.pointerType||'unknown'}),1000);},true);
  document.addEventListener('pointerout',()=>{if(hoverTimer)clearTimeout(hoverTimer);},true);
  let scrollTimer:ReturnType<typeof setTimeout>|undefined;
  document.addEventListener('scroll',event=>{if(scrollTimer)clearTimeout(scrollTimer);const el=event.target instanceof Element?event.target:null;scrollTimer=setTimeout(()=>track('ui_scroll','view',{direction:el&&el.scrollWidth>el.clientWidth?'horizontal':'vertical'}),500);},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){if(activeAt)track('view_duration','view',{duration_ms:Math.min(3600000,performance.now()-activeAt)});activeAt=0;track('transport_summary','transport',{dropped,retried,active:false});void flush();}else activeAt=performance.now();});
  window.addEventListener('online',()=>void flush());
  window.addEventListener('error',()=>track('analysis_failed','app',{error:'runtime',outcome:'failed'}));
  window.addEventListener('unhandledrejection',()=>track('analysis_failed','app',{error:'runtime',outcome:'failed'}));
  if(typeof PerformanceObserver!=='undefined')for(const type of ['largest-contentful-paint','event','longtask'])try{new PerformanceObserver(list=>{const entries=list.getEntries();const e=entries.at(-1);if(e)track('performance','performance',{metric:type==='event'?'event_latency':type==='longtask'?'long_task':'lcp',value:Math.min(3600000,type==='largest-contentful-paint'?e.startTime:e.duration)});}).observe({type,buffered:true,...(type==='event'?{durationThreshold:40}:{})});}catch{}
  publish();
}
export function trackView(previous:any,current:any,result:any){
  usageContext({screen:current.tab||'sequence'});
  if(!previous||previous.tab!==current.tab)track('view_changed','view',{screen:current.tab||'sequence'});
  if(!previous||previous.selected!==current.selected||JSON.stringify(previous.selection)!==JSON.stringify(current.selection)){
    const cut=result?.annotations?.cleavage?.value,p=current.selected;track('selection_changed','selection',{position:cut==null?'unknown':Math.abs(p-cut)<=6?'junction':p<=cut?'sp':'mature',bucket:current.selection[1]-current.selection[0]+1<=30?'short':'long',known_cut:cut!=null});
  }
  if(previous&&JSON.stringify(previous.viewport)!==JSON.stringify(current.viewport))track('viewport_changed','viewport',{bucket:current.viewport[1]-current.viewport[0]+1<=100?'short':'long'});
  if(previous&&JSON.stringify(previous.tracks)!==JSON.stringify(current.tracks))track('track_changed','tracks',{count:current.tracks.length});

}
