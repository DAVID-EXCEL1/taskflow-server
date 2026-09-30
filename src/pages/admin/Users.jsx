import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Users as UsersIcon } from 'lucide-react';
import api, { errMsg } from '../../services/api';
import { useFetch, useDebounced } from '../../components/hooks';
import { PageHeader, Drawer, Badge, TableWrap, Th, Td, Pagination, EmptyState, ErrorState, SkeletonRows, ConfirmDialog, Skeleton } from '../../components/ui';
import { fmtDate, naira, ROLE_LABEL } from '../../utils/format';

export function UserDetail({ id, onClose, onChanged }) {
  const [u, setU] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/users/${id}`).then((r) => setU(r.data.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  const toggle = async () => {
    setBusy(true);
    try { await api.patch(`/users/${id}/status`, { isActive: !u.isActive }); toast.success(u.isActive ? 'Account deactivated' : 'Account activated'); setConfirm(false); await load(); onChanged(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const row = (k, v) => <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-ink-soft">{k}</dt><dd className="text-right font-medium">{v}</dd></div>;
  return (
    <Drawer title={u?.name || 'User'} onClose={onClose} footer={u && <button className={u.isActive ? 'btn-secondary !text-danger' : 'btn-primary'} onClick={() => setConfirm(true)}>{u.isActive ? 'Deactivate account' : 'Activate account'}</button>}>
      {!u ? <div className="space-y-3"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-6" /></div> : (
        <div className="space-y-5">
          <dl className="divide-y divide-line-soft">
            {row('Email', u.email)}{row('Account type', ROLE_LABEL[u.role])}{row('Status', <Badge value={u.isActive ? 'Active' : 'Inactive'} />)}
            {u.organization && row('Organization', u.organization.name)}{row('Joined', fmtDate(u.createdAt))}{row('Last login', fmtDate(u.lastLoginAt))}{row('Tasks created', u.taskCount)}
          </dl>
          <div><h3 className="mb-1 font-semibold">Subscription</h3>
            <dl className="divide-y divide-line-soft">{row('State', <Badge value={u.access?.state === 'None' ? 'Inactive' : u.access?.state} />)}{u.access?.endDate && row('Expiry date', fmtDate(u.access.endDate))}{row('Plan', u.access?.planName || '—')}</dl></div>
          <div><h3 className="mb-2 font-semibold">Payment history</h3>
            {u.payments?.length ? <ul className="space-y-2">{u.payments.map((p) => <li key={p._id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{naira(p.amount)} · {fmtDate(p.paymentDate)}</span><Badge value={p.status} /></li>)}</ul> : <p className="text-sm text-ink-mute">No payments.</p>}</div>
        </div>)}
      {confirm && <ConfirmDialog danger={u.isActive} title={u.isActive ? 'Deactivate account?' : 'Activate account?'} message={u.isActive ? 'They will be unable to log in. Their data is kept.' : 'They will be able to log in again.'} confirmText={u.isActive ? 'Deactivate' : 'Activate'} busy={busy} onConfirm={toggle} onClose={() => setConfirm(false)} />}
    </Drawer>
  );
}

export default function AdminUsers() {
  const [f, setF] = useState({ search: '', role: '', status: '', subscription: '' });
  const [page, setPage] = useState(1);
  const search = useDebounced(f.search);
  const params = { page, limit: 20, ...(search && { search }), ...(f.role && { role: f.role }), ...(f.status && { status: f.status }), ...(f.subscription && { subscription: f.subscription }) };
  const { data, loading, error, reload, pagination } = useFetch('/users', params);
  const [sel, setSel] = useState(null);
  useEffect(() => setPage(1), [search, f.role, f.status, f.subscription]);
  const s = (k, opts, ph) => <select className="input !w-auto" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={ph}><option value="">{ph}</option>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  return (
    <>
      <PageHeader title="Users" subtitle="Everyone registered on the platform." />
      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" /><input className="input !pl-9" placeholder="Search name or email…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search users" /></div>
        {s('role', [['INDIVIDUAL', 'Personal'], ['ORGANIZATION_OWNER', 'Org owners'], ['ORGANIZATION_MEMBER', 'Org members']], 'All types')}
        {s('subscription', [['Active', 'Active'], ['Expired', 'Expired'], ['None', 'Not subscribed']], 'Any subscription')}
        {s('status', [['active', 'Active accounts'], ['inactive', 'Deactivated']], 'Any status')}
      </div>
      <div className="card">
        {loading && !data && <SkeletonRows />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={UsersIcon} title="No users found" text="Try a different search or filter." />}
        {data?.length > 0 && <TableWrap><thead><tr><Th>Name</Th><Th>Type</Th><Th>Organization</Th><Th>Subscription</Th><Th>Expires</Th><Th>Account</Th><Th>Joined</Th></tr></thead>
          <tbody>{data.map((u) => (
            <tr key={u._id} className="cursor-pointer hover:bg-paper" onClick={() => setSel(u._id)}>
              <Td><p className="font-medium">{u.name}</p><p className="text-xs text-ink-mute">{u.email}</p></Td><Td>{ROLE_LABEL[u.role]}</Td><Td>{u.organization?.name || '—'}</Td>
              <Td><Badge value={u.subscriptionStatus === 'None' ? 'Inactive' : u.subscriptionStatus} label={u.subscriptionStatus === 'None' ? 'None' : undefined} /></Td><Td>{fmtDate(u.expiresAt)}</Td><Td><Badge value={u.isActive ? 'Active' : 'Inactive'} label={u.isActive ? 'Active' : 'Deactivated'} /></Td><Td>{fmtDate(u.createdAt)}</Td></tr>))}</tbody></TableWrap>}
        <Pagination pagination={pagination} onPage={setPage} />
      </div>
      {sel && <UserDetail id={sel} onClose={() => setSel(null)} onChanged={reload} />}
    </>
  );
}
