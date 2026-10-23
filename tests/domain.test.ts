import {test} from 'node:test';
import assert from 'node:assert/strict';
import {occupiedKeys,fitsWait,validateSlot,dayOffset,slotTimestamp,DEFAULT_CONFIG} from '../lib/domain.ts';
test('60-minute appointment locks both 30-minute segments',()=>assert.deepEqual(occupiedKeys('aziz','2030-01-01',660,60),['aziz|2030-01-01|660','aziz|2030-01-01|690']));
test('matching respects master, end of service, and advance notice',()=>{const date=dayOffset(1);const slot={date,master:'aziz',service:'cut',start:660};const w={date,master:'any',service:'cut',from:600,to:720,notice:60};const now=slotTimestamp(date,600);assert.equal(fitsWait(w,slot,60,now),true);assert.equal(fitsWait({...w,to:690},slot,60,now),false);assert.equal(fitsWait({...w,master:'timur'},slot,60,now),false);assert.equal(fitsWait({...w,notice:61},slot,60,now),false);});
test('reject invalid start, overrun, unknown master, and past date',()=>{const d={date:dayOffset(1),master:'aziz',start:660};assert.doesNotThrow(()=>validateSlot(d,60,DEFAULT_CONFIG));assert.throws(()=>validateSlot({...d,start:1190},60,DEFAULT_CONFIG));assert.throws(()=>validateSlot({...d,start:1170},60,DEFAULT_CONFIG));assert.throws(()=>validateSlot({...d,master:'x'},60,DEFAULT_CONFIG));assert.throws(()=>validateSlot({...d,date:dayOffset(-1)},60,DEFAULT_CONFIG));});

test('overview includes appointments on different days and explicit day filter selects only that day',async()=>{
 const {overviewAppointments,dayOffset,slotTimestamp}=await import('../lib/domain.ts');const date=dayOffset(1),next=dayOffset(2);
 const row={kind:'booking',status:'confirmed',start:660,duration:60};const rows=[{...row,id:'b',date:next},{...row,id:'a',date},{...row,id:'cancel',date,status:'cancelled'}];
 assert.deepEqual(overviewAppointments(rows,date,'all',slotTimestamp(date,600)).map(x=>x.id),['a','b']);
 assert.deepEqual(overviewAppointments(rows,date,'day').map(x=>x.id),['a']);
});
