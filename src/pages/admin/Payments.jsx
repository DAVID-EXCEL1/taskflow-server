import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, X, Paperclip, Wallet } from 'lucide-react';
import api, { errMsg } from '../../services/api';
import { useFetch } from '../../components/hooks';
import { PageHeader, Tabs, Badge, TableWrap, Th, Td, Pagination, EmptyState, ErrorState, SkeletonRows, ConfirmDialog, Modal, Field, Spinner } from '../../components/ui';
import { fmtDate, naira } from '../../utils/format';
import { openProof } from '../Subscription';

export default function AdminPayments() {
  const [status, setStatus] = useState('Pending');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload, pagination } = useFetch('/payments', { page, limit: 20, ...(status && { status }) });
  const [approve, setApprove] = useState(null);
  const [reject, setReject] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setPage(1), [status]);

  const doApprove = async () => {
    setBusy(true);
    try { const { data: r } = await api.post(`/payments/${approve._id}/approve`); toast.success(r.message); setApprove(null); reload(); } catch (e) { toast.error(errMsg(e)); setApprove(null); reload(); } finally { setBusy(false); }
  };
  const doReject = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.post(`/payments/${reject._id}/reject`, { reason }); toast.success('Payment rejected'); setReject(null); setReason(''); reload(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const who = (p) => p.organization ? { name: p.organization.name, sub: `${p.submittedBy?.name} · Business` } : { name: p.user?.name, sub: `${p.user?.email} · Individual` };

  return (
    <>
      <PageHeader title="Payments" subtitle="Review bank transfers and activate subscriptions." />
      <div className="mb-4"><Tabs value={status} onChange={setStatus} tabs={[{ value: 'Pending', label: 'Pending' }, { value: 'Approved', label: 'Approved' }, { value: 'Rejected', label: 'Rejected' }, { value: '', label: 'All' }]} /></div>
      <div className="card">
        {loading && !data && <SkeletonRows />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={Wallet} title={status === 'Pending' ? 'No payments waiting' : 'No payments found'} text={status === 'Pending' ? 'New payment requests will appear here.' : undefined} />}
        {data?.length > 0 && <TableWrap><thead><tr><Th>Customer</Th><Th>Amount</Th><Th>Payment date</Th><Th>Reference</Th><Th>Proof</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>{data.map((p) => { const w = who(p); return (
            <tr key={p._id}>
              <Td><p className="font-medium">{w.name}</p><p className="text-xs text-ink-mute">{w.sub}</p></Td><Td className="font-medium">{naira(p.amount)}</Td><Td>{fmtDate(p.paymentDate)}</Td>
              <Td><span className="text-ink-soft">{p.reference || '—'}</span>{p.description && <p className="max-w-[180px] truncate text-xs text-ink-mute" title={p.description}>{p.description}</p>}</Td>
              <Td>{p.hasProof ? <button className="inline-flex items-center gap-1 text-sm font-medium text-brand" onClick={() => openProof(p._id)}><Paperclip className="h-3.5 w-3.5" />View</button> : <span className="text-ink-mute">None</span>}</Td>
              <Td><Badge value={p.status} />{p.status !== 'Pending' && p.reviewedBy && <p className="mt-1 text-xs text-ink-mute">{fmtDate(p.reviewedAt)}</p>}{p.rejectionReason && <p className="mt-1 max-w-[160px] text-xs text-danger">{p.rejectionReason}</p>}</Td>
              <Td className="text-right">{p.status === 'Pending' && <span className="inline-flex gap-1.5"><button className="btn-primary !px-3 !py-1.5" onClick={() => setApprove(p)}><Check className="h-4 w-4" />Approve</button><button className="btn-secondary !px-3 !py-1.5 !text-danger" onClick={() => setReject(p)}><X className="h-4 w-4" />Reject</button></span>}</Td>
            </tr>); })}</tbody></TableWrap>}
        <Pagination pagination={pagination} onPage={setPage} />
      </div>
      {approve && <ConfirmDialog title="Approve this payment?" message={`${who(approve).name} paid ${naira(approve.amount)}. The subscription starts now, or when their current period ends if they are renewing. The expiry date is calculated automatically.`} confirmText="Approve payment" busy={busy} onConfirm={doApprove} onClose={() => setApprove(null)} />}
      {reject && (
        <Modal title="Reject payment" onClose={() => setReject(null)} size="sm" footer={<><button className="btn-secondary" onClick={() => setReject(null)}>Cancel</button><button form="rej" className="btn-danger" disabled={busy}>{busy && <Spinner />}Reject payment</button></>}>
          <form id="rej" onSubmit={doReject} className="space-y-3"><p className="text-sm text-ink-soft">{who(reject).name} will be notified. Give a reason so they can fix it.</p><Field label="Reason (optional)"><textarea className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. We could not find this transfer" /></Field></form>
        </Modal>)}
    </>
  );
}
