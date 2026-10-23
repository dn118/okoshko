export const SERVICES = [
  {id:'cut', name:'Мужская стрижка', duration:60, price:120000, description:'Консультация, стрижка и укладка'},
  {id:'beard', name:'Борода и контур', duration:30, price:70000, description:'Форма, аккуратный контур и уход'},
  {id:'combo', name:'Стрижка + борода', duration:90, price:170000, description:'Полный образ за один визит'},
];
export const MASTERS = [{id:'aziz', name:'Азиз', initials:'АЗ', role:'Топ-барбер', color:'#d8e9c8'},{id:'timur', name:'Тимур', initials:'ТИ', role:'Барбер', color:'#e4dbf4'}];
export function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
export function dayOffset(n:number, base=today()) { const d=new Date(base+'T12:00:00+05:00');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10); }
export function minuteLabel(n:number){return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`;}
export function slotTimestamp(date:string,start:number){return Date.parse(`${date}T${minuteLabel(start)}:00+05:00`);}
export function occupiedKeys(master:string,date:string,start:number,duration:number){return Array.from({length:duration/30},(_,i)=>`${master}|${date}|${start+i*30}`);}
export function fitsWait(w:any, slot:any, duration:number, now=Date.now()) {return w.service===slot.service && (w.master==='any'||w.master===slot.master) && w.date===slot.date && slot.start>=w.from && slot.start+duration<=w.to && slotTimestamp(slot.date,slot.start)-now>=w.notice*60000;}
export function validateSlot(data:any, duration:number, config:any, now=Date.now()) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.date)||data.date<today()||data.date>dayOffset(30))throw new Error('Выберите дату в ближайшие 30 дней');
  if(!MASTERS.some(m=>m.id===data.master))throw new Error('Выберите мастера');
  if(!Number.isInteger(data.start)||data.start%30!==0||data.start<config.open||data.start+duration>config.close)throw new Error('Время вне рабочего графика');
  if(slotTimestamp(data.date,data.start)<=now)throw new Error('Это время уже прошло');
}
export const DEFAULT_CONFIG = {name:'FORMA',subtitle:'Барбершоп на каждый день',address:'Демонстрационный барбершоп · Ташкент',open:600,close:1200,holdMinutes:10};

// The overview deliberately includes every upcoming day; the calendar remains day-scoped.
export function overviewAppointments(allocations:any[],date:string,scope:'all'|'day',now=Date.now()){
 return allocations.filter(a=>['confirmed','held','completed','no_show'].includes(a.status)&&
  (scope==='day'?a.date===date:a.kind!=='block'&&['confirmed','held'].includes(a.status)&&slotTimestamp(a.date,a.start+a.duration)>now))
  .sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start||a.id.localeCompare(b.id));
}
