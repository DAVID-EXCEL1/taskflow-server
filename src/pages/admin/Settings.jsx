import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { BellRing } from 'lucide-react';
import api, { errMsg } from '../../services/api';
import { useFetch } from '../../components/hooks';
import { PageHeader, Field, Spinner, SkeletonRows } from '../../components/ui';

export default function AdminSettings() {
  const { data, loading, reload } = useFetch('/settings/payment');
  const [f, setF] = useState({ bankName: '', accountName: '', accountNumber: '', instructions: '' });
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  useEffect(() => { if (data) setF({ bankName: data.bankName || '', accountName: data.accountName || '', accountNumber: data.accountNumber || '', instructions: data.instructions || '' }); }, [data]);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const { data: r } = await api.put('/settings/payment', f); toast.success(r.message); reload(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const run = async () => { setRunning(true); try { const { data: r } = await api.post('/subscriptions/run-checks'); toast.success(r.message); } catch (er) { toast.error(errMsg(er)); } finally { setRunning(false); } };
  return (
    <>
      <PageHeader title="Payment details" subtitle="Customers see these details when they subscribe or renew." />
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="card space-y-4 p-5">
          {loading ? <SkeletonRows rows={4} /> : <>
            <Field label="Bank name"><input className="input" required value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} /></Field>
            <Field label="Account name"><input className="input" required value={f.accountName} onChange={(e) => setF({ ...f, accountName: e.target.value })} /></Field>
            <Field label="Account number" hint="10 digits"><input className="input" required inputMode="numeric" maxLength={10} value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Extra instructions (optional)"><textarea className="input" maxLength={500} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="e.g. Use your email as the transfer narration" /></Field>
            <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save payment details</button></>}
        </form>
        <section className="card h-fit space-y-3 p-5">
          <h2 className="flex items-center gap-2 font-semibold"><BellRing className="h-5 w-5 text-brand" />Subscription reminders</h2>
          <p className="text-sm text-ink-soft">A background job runs every hour. It sends reminders 7, 3 and 1 day before expiry and a notice when a subscription expires. Each reminder is sent once. You can run the check now to test it.</p>
          <button className="btn-secondary" onClick={run} disabled={running}>{running && <Spinner />}Run reminder check now</button>
        </section>
      </div>
    </>
  );
}
