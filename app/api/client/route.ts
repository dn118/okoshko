import {customerSession,withCustomerCookie} from '../../../lib/access';
import {readState,mutate} from '../../../lib/engine';
export const dynamic='force-dynamic';
export async function GET(req:Request){const session=customerSession(req);return withCustomerCookie(await readState({role:'client',customerId:session.id}),req,session);}
export async function POST(req:Request){const session=customerSession(req);return withCustomerCookie(await mutate(req,{role:'client',customerId:session.id}),req,session);}
