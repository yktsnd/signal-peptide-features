import { UUID, SECRET, validateEvent, contract } from './contract.mjs';
const limits = new Map();
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' } });
const hash = async token => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function bodyOf(request) {
  if (Number(request.headers.get('content-length')) > 24576) throw Error('size');
  const reader=request.body?.getReader();if(!reader)throw Error('body');let bytes=0,parts=[];
  for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>24576){await reader.cancel();throw Error('size');}parts.push(value);}
  const all=new Uint8Array(bytes);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder().decode(all));
}
async function prune(db, now) {
  await db.batch([
    db.prepare('DELETE FROM ux_events WHERE received < ?').bind(now-30*86400000),
    db.prepare('DELETE FROM ux_sessions WHERE expires < ? AND id NOT IN (SELECT stream FROM ux_events)').bind(now),
    db.prepare("DELETE FROM ux_daily WHERE day < date(?/1000,'unixepoch','-180 days')").bind(now)
  ]);
}
async function authorizeStream(request, db, id, now) {
  if(!UUID.test(id))return null;
  const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
  if(!SECRET.test(token||''))return null;
  const row=await db.prepare('SELECT token_hash,revoked,expires FROM ux_sessions WHERE id = ?').bind(id).first();
  return row && !row.revoked && row.expires>now && row.token_hash===await hash(token) ? row : null;
}
function rate(key, limit, now) {
  if(limits.size>5000)for(const [k,v]of limits)if(v.until<now)limits.delete(k);
  const value=limits.get(key);if(!value||value.until<now){if(limits.size>=5000)return false;limits.set(key,{count:1,until:now+3600000});return true;}
  return ++value.count<=limit;
}
export async function telemetryFetch(request,env) {
  const url=new URL(request.url), path=url.pathname;
  if(!path.startsWith('/api/telemetry/'))return null;
  const now=Date.now();
  if(path==='/api/telemetry/config'&&request.method==='GET')return json({enabled:!!env.DB,schema:contract.schema_version,retention:contract.retention});
  if(!env.DB)return json({code:'disabled'},503);
  if(!['GET','POST','DELETE'].includes(request.method))return json({code:'method'},405);
  if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({code:'origin'},403);
  const db=env.DB;
  try {
    if(path==='/api/telemetry/sessions'&&request.method==='POST'){
      const input=await bodyOf(request);
      if(Object.keys(input).some(k=>!['id','token','consent'].includes(k))||!UUID.test(input.id)||!SECRET.test(input.token)||input.consent!=='1')return json({code:'invalid'},422);
      if(!rate('create:'+await hash(request.headers.get('cf-connecting-ip')||'unknown'),30,now))return json({code:'rate'},429);
      const digest=await hash(input.token);
      await db.prepare('INSERT OR IGNORE INTO ux_sessions(id,token_hash,created,expires) VALUES(?,?,?,?)').bind(input.id,digest,now,now+30*86400000).run();
      const row=await db.prepare('SELECT token_hash,revoked,expires FROM ux_sessions WHERE id=?').bind(input.id).first();
      if(!row||row.revoked||row.expires<=now||row.token_hash!==digest)return json({code:'expired'},409);
      await prune(db,now);return json({enabled:true,expires:row.expires});
    }
    const match=path.match(/^\/api\/telemetry\/sessions\/([0-9a-f-]+)(\/events)?$/i);
    if(match){
      const id=match[1];if(!await authorizeStream(request,db,id,now))return json({code:'unauthorized'},401);
      if(request.method==='DELETE'&&!match[2]){
        await db.batch([db.prepare('UPDATE ux_sessions SET revoked=1 WHERE id=?').bind(id),db.prepare('DELETE FROM ux_events WHERE stream=?').bind(id)]);
        return json({deleted:true,aggregates_retained:true});
      }
      if(request.method==='POST'&&match[2]){
        if(!rate('batch:'+id,120,now))return json({code:'rate'},429);
        const input=await bodyOf(request);
        if(Object.keys(input).length!==1||!Array.isArray(input.events)||!input.events.length||input.events.length>30)return json({code:'invalid'},422);
        const events=input.events.map(v=>validateEvent(v,now));
        const count=await db.prepare('SELECT count(*) AS n FROM ux_events WHERE stream=? AND received>=?').bind(id,now-86400000).first();
        if(count.n+events.length>5000)return json({code:'limit'},429);
        await db.batch(events.map(e=>db.prepare('INSERT OR IGNORE INTO ux_events(id,stream,session,seq,received,at,ui,event,target,props) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ux_sessions WHERE id=? AND revoked=0 AND expires>?)').bind(e.id,id,e.session,e.seq,now,e.at,e.ui,e.event,e.target,JSON.stringify(e.props),id,now)));
        return json({accepted:events.map(e=>e.id)});
      }
      return json({code:'method'},405);
    }
    if(path==='/api/telemetry/report'&&request.method==='GET'){
      const identity=request.headers.get('oai-authenticated-user-id');
      const allowed=(env.TELEMETRY_ADMIN_IDS||'').split(',').filter(Boolean);
      if(!identity||!allowed.includes(identity))return json({code:'admin_required'},403);
      await prune(db,now);
      const days=url.searchParams.get('days')==='7'?7:30;
      const since=now-days*86400000;
      if(url.searchParams.get('session')){
        const session=url.searchParams.get('session');if(!UUID.test(session))return json({code:'invalid'},422);
        const rows=await db.prepare('SELECT id,session,seq,at,ui,event,target,props FROM ux_events WHERE session=? AND received>=? ORDER BY seq LIMIT 500').bind(session,since).all();
        return json({events:rows.results,truncated:rows.results.length===500});
      }
      const [daily,sessions,feedback,health,transitions,controls,durations]=await Promise.all([
        db.prepare("SELECT day,ui,event,target,outcome,screen,modality,width,total,duration_sum FROM ux_daily WHERE day>=date(?/1000,'unixepoch') ORDER BY day DESC LIMIT 2000").bind(since).all(),
        db.prepare('SELECT session,count(*) AS events,min(at) AS started,max(at) AS ended FROM ux_events WHERE received>=? GROUP BY session ORDER BY started DESC LIMIT 100').bind(since).all(),
        db.prepare("SELECT props,at FROM ux_events WHERE event='feedback_submitted' AND received>=? ORDER BY at DESC LIMIT 100").bind(since).all(),
        db.prepare('SELECT count(*) AS events,count(DISTINCT session) AS sessions FROM ux_events WHERE received>=?').bind(since).first(),
        db.prepare("WITH ordered AS (SELECT event AS from_event,lead(event) OVER(PARTITION BY stream,session ORDER BY seq) AS to_event FROM ux_events WHERE received>=?) SELECT from_event,to_event,count(*) AS total FROM ordered WHERE to_event IS NOT NULL GROUP BY from_event,to_event ORDER BY total DESC LIMIT 50").bind(since).all(),
        db.prepare("SELECT json_extract(props,'$.control') AS control,event,count(*) AS total FROM ux_events WHERE received>=? AND json_extract(props,'$.control') IS NOT NULL GROUP BY control,event ORDER BY total DESC LIMIT 200").bind(since).all(),
        db.prepare("SELECT event,ui,json_extract(props,'$.width') AS width,json_extract(props,'$.duration_ms') AS duration FROM ux_events WHERE received>=? AND json_extract(props,'$.duration_ms') IS NOT NULL ORDER BY received DESC LIMIT 5000").bind(since).all()
      ]);
      const groups=new Map();for(const row of durations.results){const key=[row.event,row.ui,row.width].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.duration);}const timings=[...groups].map(([key,values])=>{values.sort((a,b)=>a-b);const [event,ui,width]=key.split('|');return {event,ui,width,count:values.length,p50:values[Math.max(0,Math.ceil(values.length*.5)-1)],p95:values[Math.max(0,Math.ceil(values.length*.95)-1)]};});
      return json({days,controls:controls.results,timings,timing_limit:5000,retention:contract.retention,daily:daily.results,sessions:sessions.results,feedback:feedback.results,health,transitions:transitions.results,limits:{daily:2000,sessions:100,feedback:100},aggregate_notice:'Counts remain after personal event deletion; all figures cover consenting sessions only.'});
    }
    return json({code:'not_found'},404);
  }catch{return json({code:'invalid_or_storage'},400);}
}
