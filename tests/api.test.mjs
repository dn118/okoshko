import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {dayOffset,slotTimestamp} from '../lib/domain.ts';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8').replaceAll('--> statement-breakpoint',''));
class Stmt {constructor(query,args=[]){this.query=query;this.args=args;}bind(...args){return new Stmt(this.query,args);}async all(){return {results:sql.prepare(this.query).all(...this.args)};}async run(){const r=sql.prepare(this.query).run(...this.args);return {meta:{changes:Number(r.changes)},success:true};}}
const DB={prepare:q=>new Stmt(q),batch:async items=>{sql.exec('BEGIN');try{const out=[];for(const item of items){const r=sql.prepare(item.query).run(...item.args);out.push({meta:{changes:Number(r.changes)},success:true});}sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
globalThis.__OKOSHKO_TEST_ENV={DB,ADMIN_EMAIL:'owner@example.com'};
let src=readFileSync('lib/engine.ts','utf8').replace("import { env } from 'cloudflare:workers';",'const env = globalThis.__OKOSHKO_TEST_ENV;').replace("'./domain'",JSON.stringify(pathToFileURL(resolve('lib/domain.ts')).href));
mkdirSync('.sites-runtime/tests',{recursive:true});
let tg=readFileSync('lib/telegram.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.__OKOSHKO_TEST_ENV;');writeFileSync('.sites-runtime/tests/telegram.mjs',ts.transpileModule(tg,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);src=src.replace("'./telegram'","'./telegram.mjs'");writeFileSync('.sites-runtime/tests/route.mjs',ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
const {readState,mutate}=await import(pathToFileURL(resolve('.sites-runtime/tests/route.mjs')).href);
const GET=()=>readState({role:'admin'});const POST=req=>mutate(req,{role:'admin'});
const date=dayOffset(2);
const call=async d=>{const r=await POST(new Request('http://okoshko.test/api/state',{method:'POST',headers:{'Content-Type':'application/json','Origin':'http://okoshko.test'},body:JSON.stringify(d)}));return {status:r.status,data:await r.json()};};
const book=(start,extra={})=>call({action:'book',service:'cut',master:'aziz',date,start,name:'Тестовый клиент',phone:'+998900000001',email:'',...extra});
const wait=(name,extra={})=>call({action:'wait',service:'cut',master:'aziz',date,from:600,to:1200,notice:0,name,phone:name==='Первый'?'+998900000002':'+998900000003',email:'',...extra});
test('booking, overlapping race, token authorization, waitlist offer and acceptance',async()=>{
 const [r1,r2]=await Promise.all([book(660),book(690)]);assert.deepEqual([r1.status,r2.status].sort(),[200,409]);
 const winner=r1.status===200?r1:r2;const a=winner.data.allocations.find(a=>a.id===winner.data.createdId);
 let state=await (await GET()).json();assert.equal(state.allocations.length,1,'failed batch leaves no orphan booking');
 assert.equal((await call({action:'cancel',id:a.id,token:'invalid'})).status,404);
 assert.equal((await wait('Первый')).status,200);assert.equal((await wait('Второй')).status,200);
 const cancelled=await call({action:'cancel',id:a.id,token:a.token});assert.equal(cancelled.status,200);
 const offered=cancelled.data.allocations.find(x=>x.status==='held');assert.equal(offered.name,'Первый');
 assert.equal((await book(a.start)).status,409,'held slot cannot be booked');
 const declined=await call({action:'decline',id:offered.id,token:offered.token});assert.equal(declined.status,200);
 const next=declined.data.allocations.find(x=>x.status==='held');assert.equal(next.name,'Второй');
 const accepted=await call({action:'accept',id:next.id,token:next.token});assert.equal(accepted.status,200);assert.equal(accepted.data.allocations.find(x=>x.id===next.id).kind,'booking');
 assert.equal((await call({action:'accept',id:next.id,token:next.token})).status,409,'double acceptance rejected');
 assert.equal((await book(1170)).status,400,'full duration must fit schedule');
});
test('rescheduling is atomic and preserves old appointment when new slot is occupied',async()=>{
 const r=await book(840);const a=r.data.allocations.find(a=>a.id===r.data.createdId);assert.equal(r.status,200);
 const other=await book(960);assert.equal(other.status,200);
 const payload={action:'move',moveId:a.id,moveToken:a.token,service:'cut',master:'aziz',date,start:960,name:a.name,phone:a.phone,email:''};
 assert.equal((await call(payload)).status,409);assert.equal((await (await GET()).json()).allocations.find(x=>x.id===a.id).status,'confirmed');
 const moved=await call({...payload,start:1080});assert.equal(moved.status,200);assert.equal(moved.data.allocations.find(x=>x.id===a.id).status,'cancelled');assert.equal(moved.data.allocations.find(x=>x.id===moved.data.createdId).start,1080);
});
test('expired offers cannot be accepted; the next eligible client receives the slot',async()=>{
 const d=dayOffset(3);const r=await book(660,{date:d});const a=r.data.allocations.find(a=>a.id===r.data.createdId);
 await wait('Первый',{date:d});await wait('Второй',{date:d});const c=await call({action:'cancel',id:a.id,token:a.token});const offer=c.data.allocations.find(x=>x.date===d&&x.status==='held');
 sql.prepare('UPDATE allocations SET expires=? WHERE id=?').run(Date.now()-1,offer.id);
 const accepted=await call({action:'accept',id:offer.id,token:offer.token});assert.equal(accepted.status,409);
 const state=await (await GET()).json();assert.equal(state.allocations.find(x=>x.id===offer.id).status,'expired');assert.equal(state.allocations.find(x=>x.date===d&&x.status==='held').name,'Второй');
});
test('want earlier retains the original appointment until offer acceptance',async()=>{
 const d=dayOffset(4);const r=await book(960,{date:d});const old=r.data.allocations.find(x=>x.id===r.data.createdId);
 const early=await book(660,{date:d});const source=early.data.allocations.find(x=>x.id===early.data.createdId);
 const w=await wait('Первый',{date:d,to:960,replacesId:old.id,replacesToken:old.token});assert.equal(w.status,200);
 const c=await call({action:'cancel',id:source.id,token:source.token});const offer=c.data.allocations.find(x=>x.date===d&&x.status==='held');assert.ok(offer);assert.equal(c.data.allocations.find(x=>x.id===old.id).status,'confirmed');
 const taken=await call({action:'accept',id:offer.id,token:offer.token});assert.equal(taken.status,200);assert.equal(taken.data.allocations.find(x=>x.id===old.id).status,'cancelled');assert.equal(taken.data.allocations.find(x=>x.id===offer.id).status,'confirmed');
});
test('origin, date and contact validation',async()=>{
 const r=await POST(new Request('http://okoshko.test/api/state',{method:'POST',headers:{Origin:'http://evil.test','Content-Type':'application/json'},body:'{}'}));assert.equal(r.status,403);
 assert.equal((await book(660,{date:dayOffset(-1)})).status,400);assert.equal((await book(660,{phone:'123'})).status,400);
});

const clientRead=async key=>await (await readState({role:'client',customerId:key})).json();
const clientCall=async(key,d)=>{const r=await mutate(new Request('http://okoshko.test/api/client',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://okoshko.test'},body:JSON.stringify(d)}),{role:'client',customerId:key});return {status:r.status,data:await r.json()};};
test('client data excludes all foreign contacts, management tokens, notifications and waiters',async()=>{
 const date=dayOffset(6);const payload={action:'book',service:'cut',master:'timur',date,start:660,name:'Клиент А',phone:'+998900000011',email:'a@example.com'};
 const a=await clientCall('client-a',payload);assert.equal(a.status,200);assert.equal(a.data.allocations.length,1);assert.equal(a.data.messages.length,1);assert.equal(a.data.mode,'client');assert.equal(a.data.allocations[0].customer_id,'client-a');
 const b=await clientRead('client-b');assert.equal(b.allocations.length,0);assert.equal(b.messages.length,0);assert.equal(b.waiters.length,0);assert.ok(b.availability.length>0);assert.deepEqual(Object.keys(b.availability[0]).sort(),['date','duration','master','start']);assert.ok(!JSON.stringify(b).includes('a@example.com'));
 const target=a.data.allocations[0];assert.equal((await clientCall('client-b',{action:'cancel',id:target.id,token:target.token})).status,404);
 assert.equal((await clientCall('client-b',{...payload,action:'move',moveId:target.id,moveToken:target.token,start:840})).status,409);
 assert.equal((await clientCall('client-b',{...payload,action:'wait',from:600,to:660,notice:0,replacesId:target.id,replacesToken:target.token})).status,400);
 for(const action of ['seed','settings','block','complete','no_show'])assert.equal((await clientCall('client-a',{action,id:target.id,token:target.token})).status,403);
});
test('waitlist offer and resulting messages stay with the correct client session',async()=>{
 const date=dayOffset(7);const r=await book(660,{date});const a=r.data.allocations.find(x=>x.id===r.data.createdId);
 const w=await clientCall('waiting-client',{action:'wait',service:'cut',master:'aziz',date,from:600,to:900,notice:0,name:'Ждущий клиент',phone:'+998900000017',email:''});assert.equal(w.status,200);assert.equal(w.data.messages.length,1);
 await call({action:'cancel',id:a.id,token:a.token});const state=await clientRead('waiting-client');const offer=state.allocations.find(x=>x.status==='held');assert.ok(offer);assert.equal(offer.customer_id,'waiting-client');assert.equal(state.messages.length,2);
 assert.equal((await clientRead('other-client')).messages.length,0);assert.equal((await clientCall('other-client',{action:'accept',id:offer.id,token:offer.token})).status,404);
 assert.equal((await clientCall('waiting-client',{action:'accept',id:offer.id,token:offer.token})).status,200);
 await clientCall('other-client',{action:'read'});assert.equal((await clientRead('waiting-client')).messages.filter(x=>!x.seen).length,3);
 await clientCall('waiting-client',{action:'read'});assert.equal((await clientRead('waiting-client')).messages.filter(x=>!x.seen).length,0);
});

test('admin API enforces administrator identity for both reads and writes',async()=>{
 let source=readFileSync('app/api/state/route.ts','utf8').replace("import {env} from 'cloudflare:workers';",'const env=globalThis.__OKOSHKO_TEST_ENV;').replace("'../../../lib/access'",JSON.stringify(pathToFileURL(resolve('lib/access.ts')).href)).replace("'../../../lib/engine'",JSON.stringify(pathToFileURL(resolve('.sites-runtime/tests/route.mjs')).href));
 writeFileSync('.sites-runtime/tests/admin-route.mjs',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
 const admin=await import(pathToFileURL(resolve('.sites-runtime/tests/admin-route.mjs')).href);
 assert.equal((await admin.GET(new Request('http://okoshko.test/api/state'))).status,403);
 const foreign={'oai-authenticated-user-id':'someone','oai-authenticated-user-email':'client@example.com'};
 assert.equal((await admin.GET(new Request('http://okoshko.test/api/state',{headers:foreign}))).status,403);
 assert.equal((await admin.POST(new Request('http://okoshko.test/api/state',{method:'POST',headers:foreign,body:JSON.stringify({action:'seed'})}))).status,403);
 const owner={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
 assert.equal((await admin.GET(new Request('http://okoshko.test/api/state',{headers:owner}))).status,200);
});

test('administrator assigns a broad wait request, preserving client ownership and rejecting duplicates',async()=>{
 const date=dayOffset(8),key='assigned-client';
 const w=await clientCall(key,{action:'wait',service:'cut',master:'any',date,from:600,to:1200,notice:0,name:'Клиент очереди',phone:'+998900000028',email:''});assert.equal(w.status,200);
 const waiter=w.data.waiters[0];const payload={action:'assign-wait',waiterId:waiter.id,mode:'confirm',date,master:'timur',start:720,name:'Подмена',customerId:'other-client'};
 assert.equal((await clientCall(key,payload)).status,403);
 const r=await call(payload);assert.equal(r.status,200,JSON.stringify(r.data));const a=r.data.allocations.find(x=>x.id===r.data.assignedId);
 assert.equal(a.status,'confirmed');assert.equal(a.kind,'booking');assert.equal(a.name,waiter.name);assert.equal(a.customer_id,key);assert.equal(a.start,720);assert.equal(r.data.waiters.find(x=>x.id===waiter.id).status,'fulfilled');
 const client=await clientRead(key);assert.equal(client.allocations[0].id,a.id);assert.ok(client.messages.some(x=>x.allocation_id===a.id));assert.equal((await clientRead('unrelated-client')).allocations.length,0);
 assert.equal((await call(payload)).status,409);assert.equal((await clientRead(key)).allocations.length,1);
});
test('assignment validates preferences and occupied slots roll back the entire assignment',async()=>{
 const date=dayOffset(9);const w=await wait('Назначение',{date,master:'timur',from:660,to:900});const waiter=w.data.waiters.find(x=>x.date===date);
 const p={action:'assign-wait',waiterId:waiter.id,mode:'confirm',date,master:'timur',start:720};
 for(const extra of [{start:600},{start:870},{master:'aziz'},{date:dayOffset(10)}])assert.equal((await call({...p,...extra})).status,400);
 await book(720,{date,master:'timur'});const before=await (await GET()).json();assert.equal((await call(p)).status,409);
 const after=await (await GET()).json();assert.equal(after.waiters.find(x=>x.id===waiter.id).status,'waiting');assert.equal(after.allocations.length,before.allocations.length);assert.equal(after.messages.length,before.messages.length);
 assert.equal((await call({...p,start:810})).status,200);
});
test('manual offer needs client acceptance and competing assignments cannot double book',async()=>{
 const date=dayOffset(10);const a=await wait('Первый',{date});const wa=a.data.waiters.find(x=>x.date===date&&x.name==='Первый');const b=await wait('Второй',{date});const wb=b.data.waiters.find(x=>x.date===date&&x.name==='Второй');
 const p={action:'assign-wait',date,master:'aziz',start:660,mode:'offer'};
 const results=await Promise.all([call({...p,waiterId:wa.id}),call({...p,waiterId:wb.id})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const state=await (await GET()).json();const held=state.allocations.find(x=>x.date===date&&x.status==='held');assert.ok(held);assert.equal(state.waiters.filter(x=>x.date===date&&x.status==='waiting').length,1);
 assert.equal((await call({action:'accept',id:held.id,token:held.token})).status,200);
});
test('direct earlier assignment retains original on conflict and releases it after success',async()=>{
 const date=dayOffset(11);const r=await book(960,{date});const old=r.data.allocations.find(x=>x.id===r.data.createdId);await book(660,{date});
 const w=await wait('Первый',{date,to:960,replacesId:old.id,replacesToken:old.token});const waiter=w.data.waiters.find(x=>x.date===date);
 const p={action:'assign-wait',waiterId:waiter.id,date,master:'aziz',start:660,mode:'confirm'};
 assert.equal((await call(p)).status,409);assert.equal((await (await GET()).json()).allocations.find(x=>x.id===old.id).status,'confirmed');
 const assigned=await call({...p,start:780});assert.equal(assigned.status,200);assert.equal(assigned.data.allocations.find(x=>x.id===old.id).status,'cancelled');assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM cells WHERE allocation_id=?').get(old.id).n,0);
});

test('admin and client notification read state are independent',async()=>{
 const date=dayOffset(12),key='read-state-client';await clientCall(key,{action:'book',service:'beard',master:'timur',date,start:660,name:'Уведомления',phone:'+998900000041',email:''});
 assert.ok((await clientRead(key)).messages.some(x=>!x.seen));await call({action:'read'});assert.ok((await clientRead(key)).messages.some(x=>!x.seen),'administrator must not read on behalf of client');
 assert.ok((await (await GET()).json()).messages.every(x=>x.seen));
 await clientCall(key,{action:'read'});await clientCall(key,{action:'book',service:'beard',master:'timur',date,start:720,name:'Уведомления',phone:'+998900000041',email:''});
 await clientCall(key,{action:'read'});assert.ok((await (await GET()).json()).messages.some(x=>!x.seen),'client reading does not mark admin notification read');
});
test('cancelled original booking closes earlier request and releases its pending offer',async()=>{
 const date=dayOffset(13);const r=await book(960,{date});const old=r.data.allocations.find(x=>x.id===r.data.createdId);const w=await wait('Первый',{date,to:960,replacesId:old.id,replacesToken:old.token});const waiter=w.data.waiters.find(x=>x.date===date);
 const offered=await call({action:'assign-wait',waiterId:waiter.id,date,master:'aziz',start:660,mode:'offer'});assert.equal(offered.status,200);
 const cancelled=await call({action:'cancel',id:old.id,token:old.token});assert.equal(cancelled.status,200);assert.equal(cancelled.data.waiters.find(x=>x.id===waiter.id).status,'cancelled');assert.equal(cancelled.data.allocations.find(x=>x.id===offered.data.assignedId).status,'cancelled');
 assert.equal((await book(660,{date})).status,200,'offer tied to cancelled source no longer holds a slot');
});
test('rescheduling original booking closes its waiting earlier request',async()=>{
 const date=dayOffset(14);const r=await book(960,{date});const old=r.data.allocations.find(x=>x.id===r.data.createdId);const w=await wait('Первый',{date,to:960,replacesId:old.id,replacesToken:old.token});const waiter=w.data.waiters.find(x=>x.date===date);
 const moved=await call({action:'move',moveId:old.id,moveToken:old.token,service:old.service,master:old.master,date,start:1080,name:old.name,phone:old.phone,email:''});assert.equal(moved.status,200);assert.equal(moved.data.waiters.find(x=>x.id===waiter.id).status,'cancelled');
});
test('automatic offers obey updated business hours',async()=>{
 const date=dayOffset(15);const r=await book(600,{date});const a=r.data.allocations.find(x=>x.id===r.data.createdId);await wait('Первый',{date});
 assert.equal((await call({action:'settings',open:720,close:1200,holdMinutes:10})).status,200);
 const cancelled=await call({action:'cancel',id:a.id,token:a.token});assert.equal(cancelled.status,200);assert.equal(cancelled.data.allocations.filter(x=>x.date===date&&x.status==='held').length,0);
 await call({action:'settings',open:600,close:1200,holdMinutes:10});
});
test('decline only applies to offers, and invalid repeated completion is rejected',async()=>{
 const date=dayOffset(16);const r=await book(660,{date});const a=r.data.allocations.find(x=>x.id===r.data.createdId);
 assert.equal((await call({action:'decline',id:a.id,token:a.token})).status,409);assert.equal((await call({action:'complete',id:a.id,token:a.token})).status,200);assert.equal((await call({action:'complete',id:a.id,token:a.token})).status,409);
});

test('admin earlier wish retains ownership of the client source appointment',async()=>{
 const date=dayOffset(17),key='admin-assisted-client';const r=await clientCall(key,{action:'book',service:'cut',master:'timur',date,start:960,name:'Свой клиент',phone:'+998900000051',email:''});const old=r.data.allocations[0];
 const w=await wait(old.name,{phone:old.phone,date,master:'timur',to:960,replacesId:old.id,replacesToken:old.token});assert.equal(w.status,200);const waiter=w.data.waiters.find(x=>x.replaces_id===old.id);assert.equal(waiter.customer_id,key);
 const assigned=await call({action:'assign-wait',waiterId:waiter.id,date,master:'timur',start:660,mode:'confirm'});assert.equal(assigned.status,200);
 const client=await clientRead(key);assert.equal(client.waiters.find(x=>x.id===waiter.id).status,'fulfilled');assert.ok(client.allocations.some(x=>x.id===assigned.data.assignedId&&x.status==='confirmed'));assert.ok(client.messages.some(x=>x.title==='Вы в листе ожидания'));
});
test('breaks, no-show, wait removal, settings validation and database interval invariants',async()=>{
 const date=dayOffset(18);assert.equal((await call({action:'block',service:'cut',master:'timur',date,start:660})).status,200);assert.equal((await book(690,{date,master:'timur'})).status,409);
 const r=await book(840,{date,master:'timur'});const a=r.data.allocations.find(x=>x.id===r.data.createdId);const noShow=await call({action:'no_show',id:a.id,token:a.token});assert.equal(noShow.data.allocations.find(x=>x.id===a.id).status,'no_show');
 const w=await wait('Первый',{date});const waiter=w.data.waiters.find(x=>x.date===date);await call({action:'leave-wait',id:waiter.id,token:waiter.token});assert.equal((await (await GET()).json()).waiters.find(x=>x.id===waiter.id).status,'cancelled');
 assert.equal((await call({action:'settings',open:1200,close:600,holdMinutes:10})).status,400);
 const state=await (await GET()).json();for(const a of state.allocations){const count=sql.prepare('SELECT COUNT(*) AS n FROM cells WHERE allocation_id=?').get(a.id).n;assert.equal(count,['confirmed','held','completed','no_show'].includes(a.status)?a.duration/30:0,`intervals for ${a.id} (${a.status})`);}
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM waiters WHERE status LIKE 'assigning:%' OR status LIKE 'closing:%'").get().n,0);
});

test('outdated waiting intervals expire and notify only their owner',async()=>{
 const key='expired-wait-client',date=dayOffset(19);const r=await clientCall(key,{action:'wait',service:'cut',master:'timur',date,from:600,to:1200,notice:0,name:'Жду окно',phone:'+998900000061',email:''});const w=r.data.waiters[0];
 sql.prepare('UPDATE waiters SET date=? WHERE id=?').run(dayOffset(-1),w.id);const client=await clientRead(key);assert.equal(client.waiters[0].status,'expired');assert.ok(client.messages.some(x=>x.title==='Период ожидания закончился'));assert.equal((await call({action:'leave-wait',id:w.id,token:w.token})).status,409);
 assert.equal((await clientRead(key)).messages.filter(x=>x.title==='Период ожидания закончился').length,1,'sweep does not duplicate expiry notifications');
});
