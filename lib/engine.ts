import {deliverTelegram} from './telegram';
import { env } from 'cloudflare:workers';
import { SERVICES, MASTERS, DEFAULT_CONFIG, today, dayOffset, minuteLabel, occupiedKeys, fitsWait, validateSlot, slotTimestamp } from './domain';
export type RequestContext={role:'admin'|'client';customerId?:string};
const response=(data:any,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const id=()=>crypto.randomUUID();
const db=()=>{if(!env.DB)throw new Error('База данных пока недоступна');return env.DB;};
async function all(sql:string,...v:any[]){return (await db().prepare(sql).bind(...v).all()).results as any[];}
async function config(){const r=await all('SELECT value FROM settings WHERE key=?','salon');return r.length?JSON.parse(r[0].value):DEFAULT_CONFIG;}
function contact(d:any){if(typeof d.name!=='string'||d.name.trim().length<2||d.name.length>80)throw new Error('Укажите имя от 2 до 80 символов');if(typeof d.phone!=='string'||!/^\+?[\d\s()\-]{9,22}$/.test(d.phone)||d.phone.replace(/\D/g,'').length<9)throw new Error('Укажите корректный номер телефона');if(d.email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)||d.email.length>160))throw new Error('Проверьте email');}
function msg(title:string,body:string,recipient:string,allocationId:string|null=null,customerId:string|null=null){return db().prepare('INSERT INTO messages (id,title,body,recipient,allocation_id,created,seen,customer_id) VALUES (?,?,?,?,?,?,0,COALESCE(?,(SELECT customer_id FROM allocations WHERE id=?)))').bind(id(),title,body,recipient,allocationId,Date.now(),customerId,allocationId);}
async function offerNext(slot:any){
 const c=await config();const list=await all("SELECT * FROM waiters WHERE status='waiting' ORDER BY created,id");
 for(const raw of list){const w={...raw,from:raw.from_minute,to:raw.to_minute};const service=SERVICES.find(s=>s.id===w.service);
  if(w.replaces_id){const original=(await all("SELECT * FROM allocations WHERE id=? AND status='confirmed' AND kind='booking'",w.replaces_id))[0];if(!original||slotTimestamp(slot.date,slot.start)>=slotTimestamp(original.date,original.start))continue;}
  if(service){try{validateSlot(slot,service.duration,c);}catch{continue;}}
  if(!service||!fitsWait(w,{...slot,service:w.service},service.duration)||service.duration>slot.duration)continue;
  const oid=id(), expires=Date.now()+c.holdMinutes*60000;
  const statements=[db().prepare("INSERT INTO allocations (id,token,kind,status,name,phone,email,service,master,date,start,duration,wait_id,expires,created,customer_id) SELECT ?,?,'offer','held',?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM waiters WHERE id=? AND status='waiting')").bind(oid,id(),w.name,w.phone,w.email,w.service,slot.master,slot.date,slot.start,service.duration,w.id,expires,Date.now(),w.customer_id,w.id)];
  for(const key of occupiedKeys(slot.master,slot.date,slot.start,service.duration))statements.push(db().prepare('INSERT INTO cells (key,allocation_id) SELECT ?,? WHERE EXISTS (SELECT 1 FROM allocations WHERE id=?)').bind(key,oid,oid));
  statements.push(db().prepare("UPDATE waiters SET status='offered' WHERE id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=?)").bind(w.id,oid));
  statements.push(db().prepare("INSERT INTO messages (id,title,body,recipient,allocation_id,created,seen,customer_id) SELECT ?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM allocations WHERE id=?)").bind(id(),'Освободилось ваше время',`${service.name} · ${slot.date} в ${minuteLabel(slot.start)}. Подтвердите в течение ${c.holdMinutes} мин.`,w.name,oid,Date.now(),w.customer_id,oid));
  try{await db().batch(statements);const made=await all('SELECT id FROM allocations WHERE id=?',oid);if(made.length)return oid;}catch(e){if(!String(e).includes('UNIQUE'))throw e;return null;}
 }return null;
}
// Close wishes whose source visit was changed, together with their held offers.
async function closeLinkedRequests(originalId:string){
 const list=await all("SELECT w.* FROM waiters w JOIN allocations a ON a.id=w.replaces_id WHERE w.replaces_id=? AND a.status!='confirmed' AND w.status IN ('waiting','offered')",originalId);
 const freed:any[]=[];
 for(const w of list){
  const offers=await all("SELECT * FROM allocations WHERE wait_id=? AND kind='offer' AND status='held'",w.id);
  const marker='closing:'+id();
  const st=[db().prepare("UPDATE waiters SET status=? WHERE id=? AND status IN ('waiting','offered') AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND status!='confirmed')").bind(marker,w.id,originalId)];
  for(const a of offers){st.push(db().prepare("UPDATE allocations SET status='cancelled' WHERE id=? AND status='held' AND EXISTS(SELECT 1 FROM waiters WHERE id=? AND status=?)").bind(a.id,w.id,marker));st.push(db().prepare("DELETE FROM cells WHERE allocation_id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND status='cancelled')").bind(a.id,a.id));}
  st.push(db().prepare('INSERT INTO messages (id,title,body,recipient,allocation_id,created,seen,customer_id) SELECT ?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM waiters WHERE id=? AND status=?)').bind(id(),'Пожелание «Хочу раньше» закрыто','Исходный визит изменён или отменён. Связанное предложение снято; при необходимости создайте новое пожелание.',w.name,originalId,Date.now(),w.customer_id,w.id,marker));
  st.push(db().prepare("UPDATE waiters SET status='cancelled' WHERE id=? AND status=?").bind(w.id,marker));await db().batch(st);
  for(const a of offers)if((await all('SELECT status FROM allocations WHERE id=?',a.id))[0]?.status==='cancelled')freed.push(a);
 }
 for(const a of freed)await offerNext(a);
}
async function sweep(){
 const pending=await all("SELECT * FROM waiters WHERE status='waiting'");
 for(const w of pending){const duration=SERVICES.find(s=>s.id===w.service)?.duration||60;
  if(slotTimestamp(w.date,w.to_minute-duration)>Date.now()+w.notice*60000)continue;
  const marker='expiring:'+id();await db().batch([
   db().prepare("UPDATE waiters SET status=? WHERE id=? AND status='waiting'").bind(marker,w.id),
   db().prepare('INSERT INTO messages (id,title,body,recipient,allocation_id,created,seen,customer_id) SELECT ?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM waiters WHERE id=? AND status=?)').bind(id(),'Период ожидания закончился',`На ${w.date} в диапазоне ${minuteLabel(w.from_minute)}–${minuteLabel(w.to_minute)} подходящее время не нашлось. Можно оставить новое пожелание.`,w.name,null,Date.now(),w.customer_id,w.id,marker),
   db().prepare("UPDATE waiters SET status='expired' WHERE id=? AND status=?").bind(w.id,marker),
  ]);
 }
 const dangling=await all("SELECT DISTINCT w.replaces_id FROM waiters w JOIN allocations a ON a.id=w.replaces_id WHERE a.status!='confirmed' AND w.status IN ('waiting','offered')");
 for(const w of dangling)await closeLinkedRequests(w.replaces_id);
 const expired=await all("SELECT * FROM allocations WHERE kind='offer' AND status='held' AND expires<=?",Date.now());
 for(const a of expired){await db().batch([
  db().prepare("UPDATE allocations SET status='expired' WHERE id=? AND status='held' AND expires<=?").bind(a.id,Date.now()),
  db().prepare("DELETE FROM cells WHERE allocation_id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND status='expired')").bind(a.id,a.id),
  db().prepare("UPDATE waiters SET status='expired' WHERE id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND status='expired')").bind(a.wait_id,a.id),
 ]);const r=await all('SELECT status FROM allocations WHERE id=?',a.id);if(r[0]?.status==='expired')await offerNext(a);}
}
async function adminMessages(){
 const rows=await all('SELECT * FROM messages ORDER BY created DESC LIMIT 100');
 const stored=(await all("SELECT value FROM settings WHERE key='admin_read_messages'"))[0];
 const seen=new Set<string>(stored?JSON.parse(stored.value):[]);
 return rows.map(m=>({...m,seen:seen.has(m.id)?1:0}));
}
async function state(ctx:RequestContext){
 await sweep();try{await deliverTelegram();}catch{/* Delivery failure must not undo or hide a valid booking. */}const base={services:SERVICES,masters:MASTERS,config:await config(),today:today()};
 if(ctx.role==='admin')return {...base,allocations:await all('SELECT * FROM allocations ORDER BY date,start,created'),waiters:await all('SELECT * FROM waiters ORDER BY created'),messages:await adminMessages(),mode:'admin'};
 return {...base,availability:await all("SELECT master,date,start,duration FROM allocations WHERE status IN ('confirmed','held','completed','no_show') AND date>=?",today()),allocations:await all('SELECT * FROM allocations WHERE customer_id=? ORDER BY date,start,created',ctx.customerId),waiters:await all('SELECT * FROM waiters WHERE customer_id=? ORDER BY created',ctx.customerId),messages:await all('SELECT * FROM messages WHERE customer_id=? ORDER BY created DESC LIMIT 100',ctx.customerId),mode:'client'};
}
export async function readState(ctx:RequestContext){try{return response(await state(ctx));}catch(e){console.error(e);return response({error:'Не удалось загрузить данные. Попробуйте обновить страницу.'},500);}}
export async function mutate(req:Request,ctx:RequestContext){
 try{
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return response({error:'Недопустимый источник запроса'},403);
  if(Number(req.headers.get('content-length')||0)>20000)return response({error:'Слишком большой запрос'},413);
  const d=await req.json() as any;
  if(ctx.role==='client'&&!['book','wait','move','cancel','accept','decline','leave-wait','read'].includes(d.action))return response({error:'Это действие доступно только администратору'},403);
  await sweep();const c=await config();
  if(d.action==='assign-wait'){
   if(ctx.role!=='admin')return response({error:'Это действие доступно только администратору'},403);
   if(!['confirm','offer'].includes(d.mode))throw new Error('Выберите способ назначения');
   const w=(await all('SELECT * FROM waiters WHERE id=?',d.waiterId))[0];
   if(!w||w.status!=='waiting')return response({error:'Заявка уже обработана. Обновите очередь.'},409);
   const svc=SERVICES.find(s=>s.id===w.service);if(!svc)throw new Error('Услуга недоступна');
   validateSlot(d,svc.duration,c);
   if(!fitsWait({...w,from:w.from_minute,to:w.to_minute},{...d,service:w.service},svc.duration))throw new Error('Время не соответствует пожеланиям клиента или запасу на дорогу');
   const original=w.replaces_id?(await all("SELECT * FROM allocations WHERE id=? AND kind='booking' AND status='confirmed'",w.replaces_id))[0]:null;
   if(w.replaces_id&&(!original||slotTimestamp(d.date,d.start)>=slotTimestamp(original.date,original.start)))throw new Error('Выберите время раньше действующей записи');
   const aid=id(),token=id(),marker='assigning:'+aid,held=d.mode==='offer',expires=held?Date.now()+c.holdMinutes*60000:null;
   const st=[db().prepare("UPDATE waiters SET status=? WHERE id=? AND status='waiting' AND (? IS NULL OR EXISTS(SELECT 1 FROM allocations WHERE id=? AND kind='booking' AND status='confirmed'))").bind(marker,w.id,w.replaces_id,w.replaces_id),
    db().prepare('INSERT INTO allocations (id,token,kind,status,name,phone,email,service,master,date,start,duration,wait_id,expires,created,customer_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM waiters WHERE id=? AND status=?)').bind(aid,token,held?'offer':'booking',held?'held':'confirmed',w.name,w.phone,w.email,w.service,d.master,d.date,d.start,svc.duration,w.id,expires,Date.now(),w.customer_id,w.id,marker)];
   if(original&&!held)st.push(db().prepare('DELETE FROM cells WHERE allocation_id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=?)').bind(original.id,aid));
   for(const key of occupiedKeys(d.master,d.date,d.start,svc.duration))st.push(db().prepare('INSERT INTO cells (key,allocation_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM allocations WHERE id=?)').bind(key,aid,aid));
   if(original&&!held)st.push(db().prepare("UPDATE allocations SET status='cancelled' WHERE id=? AND status='confirmed' AND EXISTS(SELECT 1 FROM allocations WHERE id=?)").bind(original.id,aid));
   st.push(db().prepare('UPDATE waiters SET status=? WHERE id=? AND status=? AND EXISTS(SELECT 1 FROM allocations WHERE id=?)').bind(held?'offered':'fulfilled',w.id,marker,aid));
   st.push(db().prepare('INSERT INTO messages (id,title,body,recipient,allocation_id,created,seen,customer_id) SELECT ?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM allocations WHERE id=?)').bind(id(),held?'Администратор предложил время':'Запись подтверждена администратором',`${svc.name} · ${d.date} в ${minuteLabel(d.start)} · ${MASTERS.find(m=>m.id===d.master)?.name}.${held?' Подтвердите в течение '+c.holdMinutes+' мин.':original?' Предыдущая запись освобождена.':' Визит добавлен в ваши записи.'}`,w.name,aid,Date.now(),w.customer_id,aid));
   st.push(db().prepare("UPDATE waiters SET status='waiting' WHERE id=? AND status=?").bind(w.id,marker));
   try{await db().batch(st);}catch(e){if(String(e).includes('UNIQUE'))return response({error:'Это время уже занято. Заявка остаётся в очереди — выберите другое окно.'},409);throw e;}
   if(!(await all('SELECT id FROM allocations WHERE id=?',aid)).length)return response({error:'Заявка или исходная запись уже изменена. Обновите очередь.'},409);
   if(original&&!held){await closeLinkedRequests(original.id);await offerNext(original);}
   return response({...(await state(ctx)),assignedId:aid,assignedDate:d.date});
  }
  if(d.action==='move'){
   contact(d);const old=(await all('SELECT * FROM allocations WHERE id=? AND token=?',d.moveId,d.moveToken))[0];
   if(!old||(ctx.role==='client'&&old.customer_id!==ctx.customerId)||old.kind!=='booking'||old.status!=='confirmed')return response({error:'Запись уже изменена или недоступна'},409);
   const svc=SERVICES.find(s=>s.id===d.service);if(!svc)throw new Error('Выберите услугу');validateSlot(d,svc.duration,c);
   if(old.date===d.date&&old.start===d.start&&old.master===d.master&&old.service===d.service)throw new Error('Выберите другое время');
   const aid=id(),token=id(),marker='moving:'+aid;
   const st=[db().prepare("UPDATE allocations SET status=? WHERE id=? AND status='confirmed'").bind(marker,old.id),
    db().prepare('DELETE FROM cells WHERE allocation_id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND status=?)').bind(old.id,old.id,marker),
    db().prepare("INSERT INTO allocations (id,token,kind,status,name,phone,email,service,master,date,start,duration,wait_id,created,customer_id) SELECT ?,?,'booking','confirmed',?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM allocations WHERE id=? AND status=?)").bind(aid,token,d.name.trim(),d.phone,d.email||'',svc.id,d.master,d.date,d.start,svc.duration,old.wait_id,Date.now(),old.customer_id,old.id,marker)];
   for(const key of occupiedKeys(d.master,d.date,d.start,svc.duration))st.push(db().prepare('INSERT INTO cells (key,allocation_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM allocations WHERE id=?)').bind(key,aid,aid));
   st.push(db().prepare("UPDATE allocations SET status='cancelled' WHERE id=? AND status=?").bind(old.id,marker));
   try{await db().batch(st);}catch(e){if(String(e).includes('UNIQUE'))return response({error:'Новое время уже занято. Прежняя запись сохранена.'},409);throw e;}
   if(!(await all('SELECT id FROM allocations WHERE id=?',aid)).length)return response({error:'Запись уже изменилась. Обновите расписание.'},409);
   await db().batch([msg('Запись перенесена',`Новое время: ${d.date} в ${minuteLabel(d.start)}. Прежнее время освобождено.`,d.name,aid)]);await closeLinkedRequests(old.id);await offerNext(old);
   return response({...(await state(ctx)),createdId:aid,createdToken:token});
  }
  if(d.action==='book'||d.action==='block'){
   const service=SERVICES.find(s=>s.id===d.service);if(!service)throw new Error('Выберите услугу');validateSlot(d,service.duration,c);
   if(d.action==='book')contact(d);const aid=id(), token=id();
   const st=[db().prepare('INSERT INTO allocations (id,token,kind,status,name,phone,email,service,master,date,start,duration,created,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(aid,token,d.action==='block'?'block':'booking','confirmed',d.action==='block'?'Перерыв / недоступно':d.name.trim(),d.action==='block'?'':d.phone,d.email||'',service.id,d.master,d.date,d.start,service.duration,Date.now(),ctx.customerId||null)];
   for(const key of occupiedKeys(d.master,d.date,d.start,service.duration))st.push(db().prepare('INSERT INTO cells (key,allocation_id) VALUES (?,?)').bind(key,aid));
   if(d.action==='book')st.push(msg('Запись подтверждена',`${service.name} · ${d.date} в ${minuteLabel(d.start)}. Адрес: ${c.address}`,d.name.trim(),aid));
   try{await db().batch(st);}catch(e){if(String(e).includes('UNIQUE'))return response({error:'Это время уже заняли. Выберите другое или встаньте в лист ожидания.'},409);throw e;}
   return response({...(await state(ctx)),createdId:aid,createdToken:token});
  }
  if(d.action==='wait'){
   contact(d);if(!SERVICES.some(s=>s.id===d.service)||!['any',...MASTERS.map(m=>m.id)].includes(d.master))throw new Error('Выберите услугу и мастера');
   const dur=SERVICES.find(s=>s.id===d.service)!.duration;
   if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||d.date<today()||d.date>dayOffset(30)||!Number.isInteger(d.from)||!Number.isInteger(d.to)||d.from<c.open||d.to>c.close||d.to-d.from<dur||!Number.isInteger(d.notice)||d.notice<0||d.notice>1440||d.from%30||d.to%30||slotTimestamp(d.date,d.to)<=Date.now())throw new Error('Проверьте дату, диапазон и время на дорогу');
   const count=await all("SELECT id FROM waiters WHERE phone=? AND date=? AND service=? AND status IN ('waiting','offered')",d.phone,d.date,d.service);if(count.length)throw new Error('Вы уже в очереди на эту услугу в выбранный день');
   let customerId=ctx.customerId||null;
   if(d.replacesId){const original=(await all("SELECT * FROM allocations WHERE id=? AND token=? AND status='confirmed' AND kind='booking'",d.replacesId,d.replacesToken))[0];if(!original||(ctx.role==='client'&&original.customer_id!==ctx.customerId))throw new Error('Исходная запись недоступна');if(ctx.role==='admin')customerId=original.customer_id;
    if(d.service!==original.service)throw new Error('Для переноса выберите исходную услугу');if(slotTimestamp(d.date,d.from)>=slotTimestamp(original.date,original.start))throw new Error('Выберите время раньше исходной записи');}
   const wid=id(),token=id();await db().batch([db().prepare("INSERT INTO waiters (id,token,name,phone,email,service,master,date,from_minute,to_minute,notice,status,created,replaces_id,customer_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,'waiting',?,?,?)").bind(wid,token,d.name.trim(),d.phone,d.email||'',d.service,d.master,d.date,d.from,d.to,d.notice,Date.now(),d.replacesId||null,customerId),msg('Вы в листе ожидания',`Ищем время ${d.date}, ${minuteLabel(d.from)}–${minuteLabel(d.to)}. Предложения появятся в центре уведомлений.`,d.name.trim(),null,customerId)]);
   const cancelled=await all("SELECT * FROM allocations WHERE status='cancelled' ORDER BY created DESC");for(const a of cancelled)await offerNext(a);
   return response({...(await state(ctx)),createdId:wid,createdToken:token});
  }
  if(['cancel','accept','decline','complete','no_show'].includes(d.action)){
   const list=await all('SELECT * FROM allocations WHERE id=?',d.id);const a=list[0];if(!a||a.token!==d.token||(ctx.role==='client'&&(a.customer_id!==ctx.customerId||a.kind==='block')))return response({error:'Запись не найдена или ссылка недействительна'},404);
   if(d.action==='accept'){
    const w=(await all('SELECT * FROM waiters WHERE id=?',a.wait_id))[0];const old=w?.replaces_id?(await all('SELECT * FROM allocations WHERE id=?',w.replaces_id))[0]:null;
    const st=[db().prepare("UPDATE allocations SET kind='booking',status='confirmed',expires=NULL WHERE id=? AND kind='offer' AND status='held' AND expires>? AND (? IS NULL OR EXISTS(SELECT 1 FROM allocations WHERE id=? AND status='confirmed'))").bind(a.id,Date.now(),w?.replaces_id||null,w?.replaces_id||null),db().prepare("UPDATE waiters SET status='fulfilled' WHERE id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND kind='booking' AND status='confirmed')").bind(a.wait_id,a.id)];
    if(old){st.push(db().prepare("UPDATE allocations SET status='cancelled' WHERE id=? AND status='confirmed' AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND kind='booking' AND status='confirmed')").bind(old.id,a.id));st.push(db().prepare("DELETE FROM cells WHERE allocation_id=? AND EXISTS(SELECT 1 FROM allocations WHERE id=? AND status='cancelled')").bind(old.id,old.id));}
    const result=await db().batch(st);if(!result[0].meta.changes)return response({error:'Предложение уже недействительно или исходная запись изменена'},409);
    await db().batch([msg('Место ваше!',`Запись подтверждена: ${a.date} в ${minuteLabel(a.start)}.${old?' Предыдущая запись освобождена.':''}`,a.name,a.id)]);if(old){await closeLinkedRequests(old.id);await offerNext(old);}
   }else if(d.action==='complete'||d.action==='no_show'){
    const changed=await db().prepare("UPDATE allocations SET status=? WHERE id=? AND kind='booking' AND status='confirmed'").bind(d.action==='complete'?'completed':'no_show',a.id).run();
    if(!changed.meta.changes)return response({error:'Этот визит уже обработан'},409);
    await closeLinkedRequests(a.id);
    await db().batch([msg('Статус визита обновлён',`${a.date} в ${minuteLabel(a.start)}: ${d.action==='complete'?'визит состоялся':'отмечено отсутствие клиента'}.`,a.name,a.id)]);
   }else{
    if(d.action==='decline'&&(a.kind!=='offer'||a.status!=='held'))return response({error:'Можно отклонить только действующее предложение'},409);
    const status=d.action==='decline'?'declined':'cancelled';
    const r=await db().prepare("UPDATE allocations SET status=? WHERE id=? AND status IN ('confirmed','held')").bind(status,a.id).run();if(!r.meta.changes)return response({error:'Эта запись уже обработана'},409);
    await db().batch([db().prepare('DELETE FROM cells WHERE allocation_id=?').bind(a.id),...(a.wait_id?[db().prepare("UPDATE waiters SET status=? WHERE id=?").bind(status,a.wait_id)]:[]),msg(status==='declined'?'Предложение отклонено':'Запись отменена',`${a.date} в ${minuteLabel(a.start)}. Время освобождено.`,a.name,a.id)]);
    await closeLinkedRequests(a.id);await offerNext(a);
   }
   return response(await state(ctx));
  }
  if(d.action==='leave-wait'){if(ctx.role==='client'&&!(await all('SELECT id FROM waiters WHERE id=? AND customer_id=?',d.id,ctx.customerId)).length)return response({error:'Заявка не найдена'},404);const changed=await db().prepare("UPDATE waiters SET status='cancelled' WHERE id=? AND token=? AND status='waiting'").bind(d.id,d.token).run();if(!changed.meta.changes)return response({error:'Заявка уже обработана или недоступна'},409);return response(await state(ctx));}
  if(d.action==='read'){if(ctx.role==='client')await db().prepare('UPDATE messages SET seen=1 WHERE customer_id=?').bind(ctx.customerId).run();else {const rows=await all('SELECT id FROM messages ORDER BY created DESC LIMIT 100');await db().prepare("INSERT INTO settings (key,value) VALUES ('admin_read_messages',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(rows.map(x=>x.id))).run();}return response(await state(ctx));}
  if(d.action==='settings'){
   if(!Number.isInteger(d.open)||!Number.isInteger(d.close)||d.open<360||d.close>1380||d.open%30||d.close%30||d.close-d.open<180||![5,10,15].includes(d.holdMinutes))throw new Error('Проверьте часы работы и срок предложения');
   const value={...c,open:d.open,close:d.close,holdMinutes:d.holdMinutes};await db().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('salon',JSON.stringify(value)).run();return response(await state(ctx));
  }
  if(d.action==='seed'){
   const exists=await all("SELECT value FROM settings WHERE key='seeded'");if(exists.length)throw new Error('Демонстрационные данные уже добавлены');
   const date=dayOffset(1);const data:[string,string,string,string,number][]=[['Александр','+998 90 123 45 67','cut','aziz',660],['Дмитрий','+998 91 234 56 78','beard','timur',720],['Рустам','+998 93 345 67 89','combo','aziz',900]];
   const st:any[]=[db().prepare("INSERT INTO settings (key,value) VALUES ('seeded','1')")];
   for(const [name,phone,service,master,start] of data){const aid=id(),duration=SERVICES.find(s=>s.id===service)!.duration;st.push(db().prepare("INSERT INTO allocations (id,token,kind,status,name,phone,email,service,master,date,start,duration,created) VALUES (?,?,'booking','confirmed',?,?,'',?,?,?,?,?,?)").bind(aid,id(),name,phone,service,master,date,start,duration,Date.now()));for(const key of occupiedKeys(master,date,start,duration))st.push(db().prepare('INSERT INTO cells (key,allocation_id) VALUES (?,?)').bind(key,aid));}
   st.push(db().prepare("INSERT INTO waiters (id,token,name,phone,email,service,master,date,from_minute,to_minute,notice,status,created) VALUES (?,?,'Михаил','+998 94 456 78 90','','cut','aziz',?,600,840,0,'waiting',?)").bind(id(),id(),date,Date.now()));
   try{await db().batch(st);}catch{throw new Error('Не удалось добавить примеры: время уже занято');}return response(await state(ctx));
  }
  throw new Error('Неизвестное действие');
 }catch(e){const message=e instanceof Error?e.message:'Ошибка запроса';if(/D1|SQL|constraint|database/i.test(message)){console.error(e);return response({error:'Не удалось сохранить. Обновите данные и попробуйте снова.'},500);}return response({error:message},400);}
}
