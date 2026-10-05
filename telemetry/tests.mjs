import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { contract, validateEvent } from './contract.mjs';
import { telemetryFetch } from './server.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const root=new URL('../',import.meta.url);
const migration=readFileSync(new URL(root.pathname.includes('signal-peptide-public')?'drizzle/0000_usage.sql':'src/signal_peptide_features/usage.sql',root),'utf8');
class DB{
 constructor(file){this.file=file;this.sql({schema:migration});}
 sql(input){const program=`import sqlite3,json,sys\nx=json.loads(sys.argv[2]); db=sqlite3.connect(sys.argv[1]); db.row_factory=sqlite3.Row\nif 'schema' in x: db.executescript(x['schema']); out=[]\nelse:\n out=[]\n for item in x['items']:\n  c=db.execute(item['sql'],item['params']); rows=[dict(r) for r in c.fetchall()] if c.description else []; out.append({'results':rows,'meta':{'changes':c.rowcount}})\ndb.commit(); db.close(); print(json.dumps(out))`;
 const r=spawnSync('python',['-c',program,this.file,JSON.stringify(input)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
 prepare(sql){const db=this;return {sql,params:[],bind(...params){return {...this,params};},async first(){return db.sql({items:[this]})[0].results[0]||null;},async all(){return db.sql({items:[this]})[0];},async run(){return db.sql({items:[this]})[0];}};}
 async batch(items){return this.sql({items});}
}
const event=()=>({id:randomUUID(),session:randomUUID(),seq:1,at:Date.now(),schema:'1.0',ui:contract.ui_version,event:'analysis_completed',target:'analysis',props:{outcome:'success',screen:'sequence',duration_ms:12,known_cut:true}});
function fixture(){const folder=mkdtempSync(join(tmpdir(),'sp-usage-'));return {env:{DB:new DB(join(folder,'test.db')),TELEMETRY_ADMIN_IDS:'test-owner'},close:()=>rmSync(folder,{recursive:true,force:true})};}
const id=randomUUID(), token='a'.repeat(64);
function request(path,method='GET',data,auth){return new Request('https://example.org/api/telemetry/'+path,{method,headers:{...(method!=='GET'?{Origin:'https://example.org','Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+auth}:{}),'cf-connecting-ip':randomUUID()},...(data?{body:JSON.stringify(data)}:{})});}
async function open(env){const r=await telemetryFetch(request('sessions','POST',{id,token,consent:'1'}),env);assert.equal(r.status,200);}
test('contract rejects research content, arbitrary strings, unknown controls, invalid dates and nonfinite numbers',()=>{
 assert.deepEqual(validateEvent(event()).props,event().props);
 for(const patch of [{sequence:'MKKLLAAA'},{filename:'private.fasta'},{query:'private query'},{control:'unregistered'},{duration_ms:Infinity},{outcome:'MKKLLAAA'}])assert.throws(()=>validateEvent({...event(),props:patch}));
 assert.throws(()=>validateEvent({...event(),sequence:'MKKLLAAA'}));assert.throws(()=>validateEvent({...event(),at:Date.now()-2*86400000}));
});
test('every authored control has a registered ID, including interactive SVGs',()=>{
 const ids=[];for(const name of ['App','Workspace','SequenceViewer','Guide','UsageSettings']){const source=readFileSync(new URL('frontend/src/'+name+'.tsx',root),'utf8');for(const match of source.matchAll(/<(button|a|input|select|textarea|summary)(?=[\s>])([^>]*)(?:>|$)/g)){assert.match(match[2],/data-ux="([a-z0-9-]+)"/);const value=match[2].match(/data-ux="([a-z0-9-]+)"/)[1];assert(contract.controls.includes(value),value);ids.push(value);}}
 assert(ids.length>=83);assert(contract.controls.includes('sequenceviewer-svg-001'));assert(contract.controls.includes('sequenceviewer-svg-002'));
});
test('public endpoint requires stream authorization, same origin, and rejects entire malformed batches',async()=>{const f=fixture();try{
 await open(f.env);assert.equal((await telemetryFetch(request(`sessions/${id}/events`,'POST',{events:[event()]},'b'.repeat(64)),f.env)).status,401);
 const bad=event();bad.props.sequence='MKKLLAAA';assert.equal((await telemetryFetch(request(`sessions/${id}/events`,'POST',{events:[event(),bad]},token),f.env)).status,400);
 const foreign=request(`sessions/${id}/events`,'POST',{events:[event()]},token);foreign.headers.set('Origin','https://foreign.org');assert.equal((await telemetryFetch(foreign,f.env)).status,403);
 assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM ux_events').first()).n,0);
 assert.equal((await telemetryFetch(request('report'),f.env)).status,403);
 const owner=request('report');owner.headers.set('oai-authenticated-user-id','not-owner');assert.equal((await telemetryFetch(owner,f.env)).status,403);
 f.env.TELEMETRY_ADMIN_EMAILS='owner@example.org';const emailOnly=request('report');emailOnly.headers.set('oai-authenticated-user-email','owner@example.org');assert.equal((await telemetryFetch(emailOnly,f.env)).status,403);
 const signedOwner=request('report');signedOwner.headers.set('oai-authenticated-user-id','site-scoped-owner');signedOwner.headers.set('oai-authenticated-user-email','owner@example.org');assert.equal((await telemetryFetch(signedOwner,f.env)).status,200);
 }finally{f.close();}});
test('retry deduplication, daily aggregation, administrator timeline and revocable deletion',async()=>{const f=fixture();try{
 await open(f.env);const e=event();for(let i=0;i<2;i++)assert.equal((await telemetryFetch(request(`sessions/${id}/events`,'POST',{events:[e]},token),f.env)).status,200);
 assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM ux_events').first()).n,1);assert.equal((await f.env.DB.prepare('SELECT sum(total) AS n FROM ux_daily').first()).n,1);
 const r=request('report');r.headers.set('oai-authenticated-user-id','test-owner');const report=await(await telemetryFetch(r,f.env)).json();assert.equal(report.health.events,1);assert.equal(report.daily[0].duration_sum,12);
 const t=request('report?session='+e.session);t.headers.set('oai-authenticated-user-id','test-owner');assert.equal((await(await telemetryFetch(t,f.env)).json()).events.length,1);
 assert.equal((await telemetryFetch(request(`sessions/${id}`,'DELETE',undefined,token),f.env)).status,200);
 assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM ux_events').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT sum(total) AS n FROM ux_daily').first()).n,1);
 assert.equal((await telemetryFetch(request(`sessions/${id}/events`,'POST',{events:[event()]},token),f.env)).status,401);
 assert.equal((await telemetryFetch(request('sessions','POST',{id,token,consent:'1'}),f.env)).status,409);
 }finally{f.close();}});
test('retention prunes raw records at 30 days and aggregates at 180 days',async()=>{const f=fixture();try{
 await open(f.env);const e=event();await f.env.DB.prepare('INSERT INTO ux_events VALUES(?,?,?,?,?,?,?,?,?,?)').bind(e.id,id,e.session,1,Date.now()-31*86400000,e.at,e.ui,e.event,e.target,JSON.stringify(e.props)).run();
 await f.env.DB.prepare("INSERT INTO ux_daily VALUES('2020-01-01','0.5','ui_activate','app','unknown','input','mouse','small',1,0)").run();
 const r=request('report');r.headers.set('oai-authenticated-user-id','test-owner');await telemetryFetch(r,f.env);
 assert.equal((await f.env.DB.prepare('SELECT count(*) AS n FROM ux_events').first()).n,0);assert.equal((await f.env.DB.prepare('SELECT sum(total) AS n FROM ux_daily').first()).n,1);
 }finally{f.close();}});
