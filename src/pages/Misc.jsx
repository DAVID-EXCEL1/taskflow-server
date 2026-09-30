import { useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, Activity as ActivityIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api, { errMsg } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../components/hooks';
import { PageHeader, EmptyState, ErrorState, SkeletonRows, Pagination, Field, Spinner, cx } from '../components/ui';
import { fmtDateTime, timeAgo, ROLE_LABEL } from '../utils/format';

export function Notifications() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload, pagination, extra } = useFetch('/notifications', { page, limit: 20 });
  const nav = useNavigate();
  const open = async (n) => { if (!n.read) await api.patch(`/notifications/${n._id}/read`).catch(() => {}); if (n.link) nav(n.link); else reload(); };
  const readAll = async () => { await api.post('/notifications/read-all'); reload(); };
  return (
    <>
      <PageHeader title="Notifications" subtitle={extra?.unread ? `${extra.unread} unread` : 'You are all caught up.'}>{extra?.unread > 0 && <button className="btn-secondary" onClick={readAll}>Mark all as read</button>}</PageHeader>
      <div className="card">
        {loading && !data && <SkeletonRows />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={Bell} title="No notifications yet" text="Payments, assignments and reminders will show up here." />}
        <ul>{data?.map((n) => (
          <li key={n._id}><button onClick={() => open(n)} className={cx('flex w-full items-start gap-3 border-b border-line-soft px-4 py-3 text-left hover:bg-paper', !n.read && 'bg-brand-light/40')}>
            <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand')} />
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{n.title}</span><span className="block text-sm text-ink-soft">{n.message}</span><span className="text-xs text-ink-mute">{timeAgo(n.createdAt)}</span></span></button></li>))}</ul>
        <Pagination pagination={pagination} onPage={setPage} />
      </div>
    </>
  );
}

export function ActivityPage() {
  const { isAdmin } = useAuth();
  const [page, setPage] = useState(1);
  const { data, loading, error, reload, pagination } = useFetch('/activity', { page, limit: 30 });
  return (
    <>
      <PageHeader title="Activity" subtitle={isAdmin ? 'Important events across the platform.' : 'Important events in your organization.'} />
      <div className="card">
        {loading && !data && <SkeletonRows />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={ActivityIcon} title="No activity yet" />}
        <ul>{data?.map((a) => (
          <li key={a._id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line-soft px-4 py-3 text-sm">
            <span><span className="font-medium">{a.actorName || 'System'}</span> <span className="text-ink-soft">{a.message}</span></span>
            <span className="flex items-center gap-2 text-xs text-ink-mute"><code className="rounded bg-line-soft px-1.5 py-0.5">{a.action}</code>{fmtDateTime(a.createdAt)}</span></li>))}</ul>
        <Pagination pagination={pagination} onPage={setPage} />
      </div>
    </>
  );
}

export function Profile() {
  const { user, setUser, role } = useAuth();
  const [p, setP] = useState({ name: user.name, phone: user.phone || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [b1, setB1] = useState(false); const [b2, setB2] = useState(false);
  const saveProfile = async (e) => { e.preventDefault(); setB1(true); try { const { data } = await api.put('/auth/profile', p); setUser(data.user); toast.success('Profile updated'); } catch (er) { toast.error(errMsg(er)); } finally { setB1(false); } };
  const savePw = async (e) => { e.preventDefault(); setB2(true); try { await api.put('/auth/password', pw); toast.success('Password changed'); setPw({ currentPassword: '', newPassword: '' }); } catch (er) { toast.error(errMsg(er)); } finally { setB2(false); } };
  return (
    <>
      <PageHeader title="Profile" subtitle={`${ROLE_LABEL[role]} account`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={saveProfile} className="card space-y-4 p-5">
          <h2 className="font-semibold">Your details</h2>
          <Field label="Full name"><input className="input" required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
          <Field label="Email"><input className="input" value={user.email} disabled /></Field>
          <Field label="Phone"><input className="input" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
          <button className="btn-primary" disabled={b1}>{b1 && <Spinner />}Save profile</button>
        </form>
        <form onSubmit={savePw} className="card space-y-4 p-5">
          <h2 className="font-semibold">Change password</h2>
          <Field label="Current password"><input className="input" type="password" required autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" hint="At least 8 characters, with a letter and a number."><input className="input" type="password" required minLength={8} autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
          <button className="btn-primary" disabled={b2}>{b2 && <Spinner />}Update password</button>
        </form>
      </div>
    </>
  );
}
