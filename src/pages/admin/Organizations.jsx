import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Building2, CreditCard } from 'lucide-react';
import api, { errMsg } from '../../services/api';
import { useFetch, useDebounced } from '../../components/hooks';
import { PageHeader, Drawer, Badge, TableWrap, Th, Td, Pagination, EmptyState, ErrorState, SkeletonRows, ConfirmDialog, Skeleton } from '../../components/ui';
import { fmtDate, naira } from '../../utils/format';

function OrgDetail({ id, onClose, onChanged }) {
  const [o, setO] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/organizations/${id}`).then((r) => setO(r.data.data)).catch((e) => toast.error(errMsg(e)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  const toggle = async () => {
    setBusy(true);
    try { await api.patch(`/organizations/${id}/status`, { isActive: !o.isActive }); toast.success(o.isActive ? 'Organization deactivated' : 'Organization activated'); setConfirm(false); await load(); onChanged(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const row = (k, v) => <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-ink-soft">{k}</dt><dd className="text-right font-medium">{v || '—'}</dd></div>;
  return (
    <Drawer title={o?.name || 'Organization'} onClose={onClose} footer={o && <button className={o.isActive ? 'btn-secondary !text-danger' : 'btn-primary'} onClick={() => setConfirm(true)}>{o.isActive ? 'Deactivate organization' : 'Activate organization'}</button>}>
      {!o ? <div className="space-y-3"><Skeleton className="h-6" /><Skeleton className="h-6" /></div> : (
        <div className="space-y-5">
          <dl className="divide-y divide-line-soft">{row('Type', o.type)}{row('Owner', `${o.owner?.name} (${o.owner?.email})`)}{row('Phone', o.phone)}{row('Address', o.address)}{row('Website', o.website)}{row('Status', <Badge value={o.isActive ? 'Active' : 'Inactive'} />)}{row('Created', fmtDate(o.createdAt))}{row('Teams', o.teams.length)}{row('Tasks', o.taskCount)}</dl>
          <div><h3 className="mb-2 font-semibold">Members ({o.members.length})</h3><ul className="space-y-1.5">{o.members.map((m) => <li key={m._id} className="flex justify-between text-sm"><span>{m.name} <span className="text-ink-mute">{m.email}</span></span><span className="text-xs text-ink-soft">{m.role === 'ORGANIZATION_OWNER' ? 'Owner' : 'Member'}</span></li>)}</ul></div>
          <div><h3 className="mb-2 font-semibold">Payment history</h3>{o.payments.length ? <ul className="space-y-2">{o.payments.map((p) => <li key={p._id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"><span>{naira(p.amount)} · {fmtDate(p.paymentDate)}</span><Badge value={p.status} /></li>)}</ul> : <p className="text-sm text-ink-mute">No payments.</p>}</div>
        </div>)}
      {confirm && <ConfirmDialog danger={o.isActive} title={o.isActive ? 'Deactivate organization?' : 'Activate organization?'} message={o.isActive ? 'Nobody in this organization will be able to log in. All data is kept.' : 'Members will be able to log in again.'} confirmText={o.isActive ? 'Deactivate' : 'Activate'} busy={busy} onConfirm={toggle} onClose={() => setConfirm(false)} />}
    </Drawer>
  );
}

export function AdminOrganizations() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, loading, error, reload, pagination } = useFetch('/organizations', { page, limit: 20, ...(q && { search: q }) });
  const [sel, setSel] = useState(null);
  useEffect(() => setPage(1), [q]);
  return (
    <>
      <PageHeader title="Organizations" subtitle="Business accounts on the platform." />
      <div className="card mb-4 p-3"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" /><input className="input !pl-9" placeholder="Search organizations…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search organizations" /></div></div>
      <div className="card">
        {loading && !data && <SkeletonRows />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={Building2} title="No organizations found" />}
        {data?.length > 0 && <TableWrap><thead><tr><Th>Organization</Th><Th>Owner</Th><Th>Members</Th><Th>Subscription</Th><Th>Expires</Th><Th>Account</Th><Th>Created</Th></tr></thead>
          <tbody>{data.map((o) => (
            <tr key={o._id} className="cursor-pointer hover:bg-paper" onClick={() => setSel(o._id)}>
              <Td><p className="font-medium">{o.name}</p><p className="text-xs text-ink-mute">{o.type}</p></Td><Td><p>{o.owner?.name}</p><p className="text-xs text-ink-mute">{o.owner?.email}</p></Td><Td>{o.memberCount}</Td>
              <Td><Badge value={o.subscriptionStatus === 'None' ? 'Inactive' : o.subscriptionStatus} label={o.subscriptionStatus === 'None' ? 'None' : undefined} /></Td><Td>{fmtDate(o.expiresAt)}</Td><Td><Badge value={o.isActive ? 'Active' : 'Inactive'} label={o.isActive ? 'Active' : 'Deactivated'} /></Td><Td>{fmtDate(o.createdAt)}</Td></tr>))}</tbody></TableWrap>}
        <Pagination pagination={pagination} onPage={setPage} />
      </div>
      {sel && <OrgDetail id={sel} onClose={() => setSel(null)} onChanged={reload} />}
    </>
  );
}

export function AdminSubscriptions() {
  const [f, setF] = useState({ status: '', plan: '' });
  const [page, setPage] = useState(1);
  const { data, loading, error, reload, pagination } = useFetch('/subscriptions', { page, limit: 20, ...(f.status && { status: f.status }), ...(f.plan && { plan: f.plan }) });
  useEffect(() => setPage(1), [f.status, f.plan]);
  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Every subscription period, with its status derived from its dates." />
      <div className="card mb-4 flex flex-wrap gap-2 p-3">
        <select className="input !w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">All statuses</option>{['Active', 'Expired', 'Pending', 'Rejected'].map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input !w-auto" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} aria-label="Plan"><option value="">All plans</option><option value="INDIVIDUAL">Personal</option><option value="BUSINESS">Business</option></select>
      </div>
      <div className="card">
        {loading && !data && <SkeletonRows />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={CreditCard} title="No subscriptions found" />}
        {data?.length > 0 && <TableWrap><thead><tr><Th>Subscriber</Th><Th>Plan</Th><Th>Amount</Th><Th>Start</Th><Th>Expiry</Th><Th>Status</Th></tr></thead>
          <tbody>{data.map((s) => (
            <tr key={s._id}><Td><p className="font-medium">{s.organization?.name || s.user?.name}</p><p className="text-xs text-ink-mute">{s.user?.email || 'Organization'}</p></Td><Td>{s.plan === 'BUSINESS' ? 'Business' : 'Personal'}</Td><Td>{naira(s.amount)}</Td><Td>{fmtDate(s.startDate)}</Td><Td>{fmtDate(s.endDate)}</Td><Td><Badge value={s.effectiveStatus} /></Td></tr>))}</tbody></TableWrap>}
        <Pagination pagination={pagination} onPage={setPage} />
      </div>
    </>
  );
}
