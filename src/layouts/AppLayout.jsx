import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ListChecks, Tags, Users, UsersRound, Building2, Activity, CreditCard, Bell, User, LogOut, Menu, X, Wallet, Settings, ShieldCheck, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { cx } from '../components/ui';
import { ROLE_LABEL, timeAgo } from '../utils/format';

export const APP_NAME = 'TaskDesk';

function navFor(auth) {
  if (auth.isAdmin) return [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/users', label: 'Users', icon: Users },
    { to: '/admin/organizations', label: 'Organizations', icon: Building2 },
    { to: '/admin/payments', label: 'Payments', icon: Wallet },
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: CreditCard },
    { to: '/admin/activity', label: 'Activity', icon: Activity },
    { to: '/admin/settings', label: 'Payment details', icon: Settings },
  ];
  const items = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/tasks', label: 'Tasks', icon: ListChecks },
  ];
  if (auth.isIndividual || auth.isOwner) items.push({ to: '/categories', label: 'Categories', icon: Tags });
  if (auth.isOrg) items.push({ to: '/teams', label: auth.isOwner ? 'Teams' : 'My teams', icon: UsersRound });
  if (auth.isOrg) items.push({ to: '/members', label: 'Members', icon: Users });
  if (auth.isOwner) items.push({ to: '/organization', label: 'Organization', icon: Building2 }, { to: '/activity', label: 'Activity', icon: Activity });
  items.push({ to: '/subscription', label: 'Subscription', icon: CreditCard });
  return items;
}

function SubscriptionBanner() {
  const { access, isAdmin, isMember } = useAuth();
  if (isAdmin || !access) return null;
  if (!access.canWrite) {
    const expired = access.state === 'Expired';
    return (
      <div className="border-b border-danger/20 bg-danger-light px-4 py-3">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <p className="flex items-start gap-2 text-sm text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{expired ? 'Your subscription has expired. Renew your subscription to continue managing your tasks.' : access.message} <span className="text-danger/80">Your account is read-only.</span></span></p>
          {isMember ? <span className="text-xs text-danger/80">Ask your organization owner to renew.</span>
            : access.state !== 'Pending' && <Link to="/subscription" className="btn-danger !py-1.5">{expired ? 'Renew Subscription' : 'Subscribe now'}</Link>}
        </div>
      </div>
    );
  }
  if (access.expiringSoon && !isMember) {
    return (
      <div className="border-b border-amber/30 bg-amber-light px-4 py-2.5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-sm text-amber-900">
          <p className="flex items-center gap-2"><Clock className="h-4 w-4" />{access.daysLeft <= 1 ? 'Your subscription expires tomorrow.' : `Your subscription expires in ${access.daysLeft} days.`}</p>
          <Link to="/subscription" className="font-medium underline">Renew now</Link>
        </div>
      </div>
    );
  }
  return null;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef();
  const nav = useNavigate();
  const load = async () => { try { const { data } = await api.get('/notifications', { params: { limit: 8 } }); setItems(data.data); setUnread(data.unread); } catch { /* ignore */ } };
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const click = async (n) => { setOpen(false); if (!n.read) { await api.patch(`/notifications/${n._id}/read`); load(); } if (n.link) nav(n.link); };
  const readAll = async () => { await api.post('/notifications/read-all'); load(); };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen(!open); if (!open) load(); }} className="relative rounded-lg p-2 text-ink-soft hover:bg-line-soft" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="rise absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><p className="font-semibold">Notifications</p>{unread > 0 && <button onClick={readAll} className="text-xs font-medium text-brand">Mark all read</button>}</div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? <p className="px-4 py-8 text-center text-sm text-ink-soft">You're all caught up.</p> : items.map((n) => (
              <button key={n._id} onClick={() => click(n)} className={cx('block w-full border-b border-line-soft px-4 py-3 text-left hover:bg-paper', !n.read && 'bg-brand-light/40')}>
                <p className="text-sm font-medium">{n.title}</p><p className="text-xs text-ink-soft">{n.message}</p><p className="mt-1 text-[11px] text-ink-mute">{timeAgo(n.createdAt)}</p>
              </button>))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block px-4 py-2.5 text-center text-sm font-medium text-brand">View all</Link>
        </div>
      )}
    </div>
  );
}

export default function AppLayout() {
  const auth = useAuth();
  const [menu, setMenu] = useState(false);
  const nav = navFor(auth);
  const close = () => setMenu(false);

  const sidebar = (
    <nav className="flex h-full flex-col bg-ink text-white">
      <div className="flex items-center gap-2 px-5 py-5"><div className="rounded-lg bg-brand p-1.5"><ListChecks className="h-5 w-5" /></div><span className="font-display text-xl font-bold">{APP_NAME}</span></div>
      {auth.isOrg && auth.user.organization && <p className="mx-5 mb-2 truncate rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/80">{auth.user.organization.name}</p>}
      {auth.isAdmin && <p className="mx-5 mb-2 flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-xs text-white/80"><ShieldCheck className="h-3.5 w-3.5" />Platform admin</p>}
      <div className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={close} className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', isActive ? 'bg-brand text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')}>
            <Icon className="h-[18px] w-[18px]" />{label}
          </NavLink>))}
      </div>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/profile" onClick={close} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/10">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-semibold">{auth.user.name[0]}</div>
          <div className="min-w-0"><p className="truncate text-sm font-medium">{auth.user.name}</p><p className="text-xs text-white/60">{ROLE_LABEL[auth.role]}</p></div>
        </NavLink>
        <button onClick={auth.logout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white"><LogOut className="h-[18px] w-[18px]" />Log out</button>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      {menu && (<div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-ink/50" onClick={close} /><div className="absolute inset-y-0 left-0 w-72 max-w-[85%]">{sidebar}</div><button onClick={close} className="absolute right-3 top-3 rounded-full bg-white p-1.5" aria-label="Close menu"><X className="h-4 w-4" /></button></div>)}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-white px-4 py-2.5 lg:px-8">
          <button className="rounded-lg p-2 text-ink-soft hover:bg-line-soft lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1"><NotificationBell /><Link to="/profile" className="rounded-lg p-2 text-ink-soft hover:bg-line-soft" aria-label="Profile"><User className="h-5 w-5" /></Link></div>
        </header>
        <SubscriptionBanner />
        <main className="flex-1 overflow-y-auto"><div className="mx-auto max-w-7xl px-4 py-6 lg:px-8"><Outlet /></div></main>
      </div>
    </div>
  );
}
