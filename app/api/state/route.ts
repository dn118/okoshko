import {env} from 'cloudflare:workers';
import {isAdminIdentity} from '../../../lib/access';
import {readState,mutate} from '../../../lib/engine';
export const dynamic='force-dynamic';
const denied=()=>Response.json({error:'Доступ только для администратора'},{status:403,headers:{'Cache-Control':'no-store'}});
export async function GET(req:Request){if(!isAdminIdentity(req.headers,env.ADMIN_EMAIL))return denied();return readState({role:'admin'});}
export async function POST(req:Request){if(!isAdminIdentity(req.headers,env.ADMIN_EMAIL))return denied();return mutate(req,{role:'admin'});}
