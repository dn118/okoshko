import {env} from 'cloudflare:workers';
import {getChatGPTUser,chatGPTSignInPath} from '../chatgpt-auth';
import AdminDashboard from '../../components/AdminDashboard';
export const dynamic='force-dynamic';
export const metadata={title:'Панель администратора — Окошко'};
export default async function AdminPage(){
 const user=await getChatGPTUser();
 if(!user)return <main className="admin-gate"><a className="customer-logo" href="/">окошко<span>.</span></a><div className="admin-gate-card"><span className="portal-label">ДЛЯ СОТРУДНИКОВ</span><h1>Панель администратора</h1><p>Войдите через ChatGPT под аккаунтом владельца. Клиенту вход в этот кабинет не нужен.</p><a className="button primary" href={chatGPTSignInPath('/admin')} target="_top">Войти в кабинет</a><a className="text-button" href="/">Перейти к записи клиента</a></div></main>;
 if(!env.ADMIN_EMAIL||user.email.trim().toLowerCase()!==env.ADMIN_EMAIL.trim().toLowerCase())return <main className="admin-gate"><div className="admin-gate-card"><span className="portal-label">ДОСТУП ОГРАНИЧЕН</span><h1>Кабинет для администратора</h1><p>Этот аккаунт не назначен администратором. Для записи к мастеру откройте клиентскую страницу.</p><a className="button primary" href="/">Записаться на визит</a></div></main>;
 return <AdminDashboard/>;
}
