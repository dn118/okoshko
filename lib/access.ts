/** Identity headers are supplied by Sites, not browser form fields. */
export function isAdminIdentity(headers:Headers,allowedEmail:string|undefined){
 const user=headers.get('oai-authenticated-user-id');
 const email=headers.get('oai-authenticated-user-email');
 return Boolean(user&&email&&allowedEmail&&email.trim().toLowerCase()===allowedEmail.trim().toLowerCase());
}
export function customerSession(req:Request){
 const raw=req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('okoshko_client='))?.split('=')[1];
 if(raw&&/^[a-f0-9]{64}$/.test(raw))return {id:raw,fresh:false};
 return {id:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),fresh:true};
}
export function withCustomerCookie(response:Response,req:Request,session:{id:string;fresh:boolean}){
 if(session.fresh)response.headers.set('Set-Cookie',`okoshko_client=${session.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(req.url).protocol==='https:'?'; Secure':''}`);
 return response;
}
