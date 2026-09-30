import { useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, Upload, FileText, Landmark } from 'lucide-react';
import api, { errMsg } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../components/hooks';
import { PageHeader, Modal, Field, Spinner, Badge, TableWrap, Th, Td, EmptyState, SkeletonRows, ErrorState } from '../components/ui';
import { naira, fmtDate, toInputDate } from '../utils/format';

export async function openProof(paymentId) {
  try {
    const { data } = await api.get(`/payments/${paymentId}/proof`, { responseType: 'blob' });
    window.open(URL.createObjectURL(data), '_blank', 'noopener');
  } catch (e) { toast.error('Could not open the proof of payment.'); }
}

export default function Subscription() {
  const { access, isMember, refresh } = useAuth();
  const info = useFetch('/settings/payment');
  const pays = useFetch('/payments', { limit: 50 });
  const subs = useFetch('/subscriptions', { limit: 50 });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ amount: access?.price || '', paymentDate: toInputDate(new Date()), reference: '', description: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!access) return null;
  const renewing = access.state === 'Active' || access.state === 'Expired';
  const stateTone = { Active: 'Active', Expired: 'Expired', Pending: 'Pending', Rejected: 'Rejected', None: 'Inactive' }[access.state];

  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v !== '' && fd.append(k, v));
      if (file) fd.append('proof', file);
      const { data } = await api.post('/payments', fd);
      toast.success(data.message); setOpen(false); setFile(null); await refresh(); pays.reload(); subs.reload();
    } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const pickFile = (e) => {
    const x = e.target.files[0];
    if (!x) return setFile(null);
    if (x.size > 3 * 1024 * 1024) { toast.error('Proof must be 3MB or smaller.'); e.target.value = ''; return; }
    setFile(x);
  };
  const copyNum = () => { navigator.clipboard.writeText(info.data.accountNumber); toast.success('Account number copied'); };

  return (
    <>
      <PageHeader title="Subscription" subtitle={isMember ? "Your organization's subscription covers you." : 'Manage your plan and payments.'} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-start justify-between"><div><p className="text-sm text-ink-soft">{access.planName} plan</p><p className="font-display text-3xl font-bold">{naira(access.price)}<span className="text-base font-normal text-ink-soft"> / month</span></p></div><Badge value={stateTone} label={access.state === 'None' ? 'Not subscribed' : access.state} /></div>
          <dl className="mt-4 space-y-2 text-sm">
            {access.state === 'Active' && <><div className="flex justify-between"><dt className="text-ink-soft">Expires</dt><dd className="font-medium">{fmtDate(access.endDate)}</dd></div><div className="flex justify-between"><dt className="text-ink-soft">Days left</dt><dd className="font-medium">{access.daysLeft}</dd></div></>}
            {access.state === 'Expired' && <div className="flex justify-between"><dt className="text-ink-soft">Expired on</dt><dd className="font-medium text-danger">{fmtDate(access.endDate)}</dd></div>}
            {access.paidUntil && access.state === 'Active' && access.hasPendingPayment && <p className="text-ink-soft">A renewal payment is awaiting approval.</p>}
          </dl>
          {access.message && <p className="mt-3 rounded-lg bg-paper p-3 text-sm text-ink-soft">{access.message}</p>}
          {!isMember && <button className="btn-primary mt-4 w-full sm:w-auto" disabled={!access.canRenew} onClick={() => setOpen(true)}>{access.hasPendingPayment ? 'Payment awaiting approval' : !access.canRenew ? `Renewal opens ${fmtDate(access.renewOpensAt)}` : renewing ? 'Renew Subscription' : 'Submit Payment'}</button>}
          {!isMember && access.state === 'Active' && !access.canRenew && !access.hasPendingPayment && <p className="mt-2 text-xs text-ink-mute">You are paid up. Renewal opens 7 days before expiry so you never pay twice by mistake.</p>}
          {isMember && <p className="mt-3 text-sm text-ink-soft">Only the organization owner can renew. Ask them to submit the payment.</p>}
        </section>

        {!isMember && (
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-semibold"><Landmark className="h-5 w-5 text-brand" />How to pay</h2>
            <p className="mt-2 text-sm text-ink-soft">{access.state === 'Active' && !access.canRenew && !access.hasPendingPayment ? <>Nothing to pay right now. You can renew from <strong className="text-ink">{fmtDate(access.renewOpensAt)}</strong>. The details below are for then.</> : <>Pay <strong className="text-ink">{naira(access.price)}</strong> to the account below, then click {renewing ? '"Renew Subscription"' : '"Submit Payment"'} and enter the transfer details.</>}</p>
            {info.loading && <SkeletonRows rows={3} />}
            {info.data ? (
              <div className="mt-4 space-y-2 rounded-lg bg-paper p-4 text-sm">
                <div className="flex justify-between gap-3"><span className="text-ink-soft">Bank</span><span className="font-medium">{info.data.bankName}</span></div>
                <div className="flex justify-between gap-3"><span className="text-ink-soft">Account name</span><span className="font-medium">{info.data.accountName}</span></div>
                <div className="flex justify-between gap-3"><span className="text-ink-soft">Account number</span><span className="flex items-center gap-2 font-display text-lg font-bold tracking-wide">{info.data.accountNumber}<button onClick={copyNum} className="rounded p-1 text-ink-soft hover:bg-line-soft" aria-label="Copy account number"><Copy className="h-4 w-4" /></button></span></div>
                {info.data.instructions && <p className="border-t border-line pt-2 text-xs text-ink-soft">{info.data.instructions}</p>}
              </div>) : !info.loading && <p className="mt-4 rounded-lg bg-amber-light p-3 text-sm text-amber-900">Payment details have not been added yet. Please contact support.</p>}
          </section>)}
      </div>

      {!isMember && (
        <section className="card mt-6">
          <div className="border-b border-line px-4 py-3"><h2 className="font-semibold">Payment history</h2></div>
          {pays.loading && <SkeletonRows rows={3} />}{pays.error && <ErrorState message={pays.error} onRetry={pays.reload} />}
          {pays.data && !pays.data.length && <EmptyState icon={FileText} title="No payments yet" text="Your submitted payments will appear here." />}
          {pays.data?.length > 0 && <TableWrap><thead><tr><Th>Submitted</Th><Th>Amount</Th><Th>Payment date</Th><Th>Reference</Th><Th>Status</Th><Th>Proof</Th></tr></thead>
            <tbody>{pays.data.map((p) => (
              <tr key={p._id}><Td>{fmtDate(p.createdAt)}</Td><Td className="font-medium">{naira(p.amount)}</Td><Td>{fmtDate(p.paymentDate)}</Td><Td className="text-ink-soft">{p.reference || '—'}</Td>
                <Td><Badge value={p.status} />{p.rejectionReason && <p className="mt-1 text-xs text-danger">{p.rejectionReason}</p>}</Td>
                <Td>{p.hasProof ? <button className="text-sm font-medium text-brand" onClick={() => openProof(p._id)}>View</button> : '—'}</Td></tr>))}</tbody></TableWrap>}
        </section>)}

      <section className="card mt-6">
        <div className="border-b border-line px-4 py-3"><h2 className="font-semibold">Subscription periods</h2></div>
        {subs.data && !subs.data.filter((s) => s.effectiveStatus !== 'Pending' || true).length && <EmptyState title="No subscription periods yet" />}
        {subs.data?.length > 0 && <TableWrap><thead><tr><Th>Plan</Th><Th>Amount</Th><Th>Start</Th><Th>End</Th><Th>Status</Th></tr></thead>
          <tbody>{subs.data.map((s) => <tr key={s._id}><Td>{s.plan === 'BUSINESS' ? 'Business' : 'Personal'}</Td><Td>{naira(s.amount)}</Td><Td>{fmtDate(s.startDate)}</Td><Td>{fmtDate(s.endDate)}</Td><Td><Badge value={s.effectiveStatus} /></Td></tr>)}</tbody></TableWrap>}
      </section>

      {open && (
        <Modal title={renewing ? 'Renew subscription' : 'Submit payment'} onClose={() => setOpen(false)} footer={<><button className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button form="pay" className="btn-primary" disabled={busy}>{busy && <Spinner />}Submit Payment</button></>}>
          <form id="pay" onSubmit={submit} className="space-y-4">
            <p className="rounded-lg bg-brand-light p-3 text-sm text-brand-dark">Pay {naira(access.price)} to the account shown on this page, then enter the transfer details below.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount paid (₦)"><input className="input" type="number" required min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
              <Field label="Payment date"><input className="input" type="date" required max={toInputDate(new Date())} value={f.paymentDate} onChange={(e) => setF({ ...f, paymentDate: e.target.value })} /></Field>
            </div>
            <Field label="Transaction reference (optional)"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
            <Field label="Description (optional)"><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Proof of payment (optional)" hint="JPG, PNG, WEBP or PDF, up to 3MB.">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line px-3 py-3 text-sm text-ink-soft hover:border-brand"><Upload className="h-4 w-4" />{file ? file.name : 'Choose a file'}<input type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,.pdf" onChange={pickFile} /></label>
            </Field>
          </form>
        </Modal>)}
    </>
  );
}
