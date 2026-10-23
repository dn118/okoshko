import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isAdminIdentity,customerSession,withCustomerCookie} from '../lib/access.ts';
test('admin requires both platform identity and configured matching email',()=>{
 const h=new Headers({'oai-authenticated-user-id':'site-user','oai-authenticated-user-email':'OWNER@example.com'});
 assert.equal(isAdminIdentity(h,'owner@example.com'),true);
 assert.equal(isAdminIdentity(new Headers(),'owner@example.com'),false);
 assert.equal(isAdminIdentity(h,undefined),false);
 assert.equal(isAdminIdentity(h,'someone@example.com'),false);
 h.delete('oai-authenticated-user-id');assert.equal(isAdminIdentity(h,'owner@example.com'),false);
});
test('client capability is a random HttpOnly cookie; malformed cookie is replaced',()=>{
 const req=new Request('https://okoshko.test/api/client');const a=customerSession(req),b=customerSession(req);assert.equal(a.id.length,64);assert.notEqual(a.id,b.id);
 const r=withCustomerCookie(new Response('{}'),req,a);assert.match(r.headers.get('set-cookie')!,/HttpOnly; SameSite=Lax/);assert.match(r.headers.get('set-cookie')!,/; Secure/);
 const again=customerSession(new Request(req,{headers:{cookie:'okoshko_client='+a.id}}));assert.equal(again.id,a.id);assert.equal(again.fresh,false);
 assert.equal(customerSession(new Request(req,{headers:{cookie:'okoshko_client=forged'}})).fresh,true);
});
