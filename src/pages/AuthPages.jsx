import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ListChecks, User, Building2, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api, { errMsg } from '../services/api';
import { Field, Spinner, cx } from '../components/ui';
import { APP_NAME } from '../layouts/AppLayout';

function Shell({ title, subtitle, children, wide }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-paper px-4 py-10">
      <div className={cx('w-full', wide ? 'max-w-lg' : 'max-w-md')}>
        <Link to="/" className="mb-6 flex items-center justify-center gap-2"><div className="rounded-lg bg-brand p-1.5 text-white"><ListChecks className="h-5 w-5" /></div><span className="font-display text-xl font-bold">{APP_NAME}</span></Link>
        <div className="card p-6 sm:p-8">
          <h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(f.email, f.password); nav('/'); } catch (err) { setError(errMsg(err)); } finally { setBusy(false); }
  };
  return (
    <Shell title="Welcome back" subtitle="Log in to manage your tasks.">
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{error}</p>}
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Log in</button>
      </form>
      <p className="mt-5 text-center text-sm text-ink-soft">New here? <Link to="/register" className="font-medium text-brand">Create an account</Link></p>
    </Shell>
  );
}

export function Register() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const preset = params.get('type');
  const [type, setType] = useState(preset === 'business' ? 'BUSINESS' : preset === 'personal' ? 'PERSONAL' : null);
  const [step, setStep] = useState(1);
  const [acc, setAcc] = useState({ name: '', email: '', password: '', confirm: '' });
  const [org, setOrg] = useState({ name: '', type: '', phone: '', address: '', website: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const validateAccount = () => {
    const e = {};
    if (acc.name.trim().length < 2) e.name = 'Enter your full name';
    if (!/^\S+@\S+\.\S+$/.test(acc.email)) e.email = 'Enter a valid email address';
    if (acc.password.length < 8 || !/[A-Za-z]/.test(acc.password) || !/\d/.test(acc.password)) e.password = 'Use at least 8 characters with a letter and a number';
    if (acc.confirm !== acc.password) e.confirm = 'Passwords do not match';
    setErrors(e); return !Object.keys(e).length;
  };
  const submit = async (payload) => {
    setBusy(true);
    try { await register(payload); toast.success('Account created. Welcome!'); nav('/'); }
    catch (err) { toast.error(errMsg(err)); const f = err.response?.data?.details?.fields; if (f) setErrors(f); setStep(1); }
    finally { setBusy(false); }
  };
  const next = (e) => {
    e.preventDefault();
    if (!validateAccount()) return;
    if (type === 'PERSONAL') return submit({ accountType: 'PERSONAL', name: acc.name, email: acc.email, password: acc.password });
    setStep(2);
  };
  const finish = (e) => {
    e.preventDefault();
    if (org.name.trim().length < 2) return setErrors({ 'organization.name': 'Enter your organization name' });
    setErrors({});
    submit({ accountType: 'BUSINESS', name: acc.name, email: acc.email, password: acc.password, organization: org });
  };

  if (!type) return (
    <Shell title="Create your account" subtitle="What will you use this for?" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        {[['PERSONAL', User, 'Personal', '₦2,000 / month', 'Manage your own tasks.'], ['BUSINESS', Building2, 'Business / Organization', '₦5,000 / month', 'Teams, members and shared tasks.']].map(([v, I, t, p, d]) => (
          <button key={v} onClick={() => setType(v)} className="rounded-xl border border-line p-4 text-left transition hover:border-brand hover:bg-brand-light/40"><I className="mb-2 h-6 w-6 text-brand" /><p className="font-semibold">{t}</p><p className="text-sm font-medium text-brand">{p}</p><p className="mt-1 text-sm text-ink-soft">{d}</p></button>))}
      </div>
      <p className="mt-5 text-center text-sm text-ink-soft">Already have an account? <Link to="/login" className="font-medium text-brand">Log in</Link></p>
    </Shell>
  );

  const biz = type === 'BUSINESS';
  return (
    <Shell title={step === 1 ? 'Create your account' : 'Tell us about your organization'} subtitle={biz ? `Step ${step} of 2` : 'Personal account'} wide>
      {step === 1 ? (
        <form onSubmit={next} className="space-y-4" noValidate>
          <Field label="Full name" error={errors.name}><input className="input" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} autoComplete="name" /></Field>
          <Field label="Email" error={errors.email}><input className="input" type="email" value={acc.email} onChange={(e) => setAcc({ ...acc, email: e.target.value })} autoComplete="email" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" error={errors.password}><input className="input" type="password" value={acc.password} onChange={(e) => setAcc({ ...acc, password: e.target.value })} autoComplete="new-password" /></Field>
            <Field label="Confirm password" error={errors.confirm}><input className="input" type="password" value={acc.confirm} onChange={(e) => setAcc({ ...acc, confirm: e.target.value })} autoComplete="new-password" /></Field>
          </div>
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}{biz ? 'Continue' : 'Create account'}</button>
          <button type="button" className="btn-ghost w-full" onClick={() => setType(null)}><ArrowLeft className="h-4 w-4" />Change account type</button>
        </form>
      ) : (
        <form onSubmit={finish} className="space-y-4" noValidate>
          <Field label="Organization name" error={errors['organization.name']}><input className="input" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organization type"><select className="input" value={org.type} onChange={(e) => setOrg({ ...org, type: e.target.value })}><option value="">Select…</option>{['Company', 'Church', 'School', 'Agency', 'Startup', 'NGO', 'Other'].map((o) => <option key={o}>{o}</option>)}</select></Field>
            <Field label="Phone number"><input className="input" type="tel" value={org.phone} onChange={(e) => setOrg({ ...org, phone: e.target.value })} /></Field>
          </div>
          <Field label="Address"><input className="input" value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} /></Field>
          <Field label="Website (optional)" error={errors['organization.website']}><input className="input" placeholder="https://" value={org.website} onChange={(e) => setOrg({ ...org, website: e.target.value })} /></Field>
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Create organization</button>
          <button type="button" className="btn-ghost w-full" onClick={() => setStep(1)}><ArrowLeft className="h-4 w-4" />Back</button>
        </form>
      )}
    </Shell>
  );
}

export function AcceptInvite() {
  const { token } = useParams();
  const { user, register, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [f, setF] = useState({ name: '', password: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get(`/invitations/token/${token}`).then((r) => setInv(r.data.data)).catch((e) => setError(errMsg(e))); }, [token]);

  const act = async (kind) => {
    setBusy(true);
    try { const { data } = await api.post(`/invitations/token/${token}/${kind}`); toast.success(data.message); await refresh(); nav('/'); }
    catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const join = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await register({ accountType: 'PERSONAL', name: f.name, email: inv.email, password: f.password, inviteToken: token }); toast.success(`Welcome to ${inv.organizationName}!`); nav('/'); }
    catch (err) { toast.error(errMsg(err)); } finally { setBusy(false); }
  };

  if (error) return <Shell title="Invitation unavailable"><p className="text-sm text-danger">{error}</p><Link to="/" className="btn-secondary mt-4">Go home</Link></Shell>;
  if (!inv) return <Shell title="Loading invitation…"><Spinner className="h-5 w-5 text-brand" /></Shell>;
  if (inv.status !== 'Pending') return <Shell title="Invitation unavailable"><p className="text-sm text-ink-soft">This invitation is {inv.status.toLowerCase()}. Ask the organization owner to send a new one.</p></Shell>;

  return (
    <Shell title={`Join ${inv.organizationName}`} subtitle={`Invitation for ${inv.email}${inv.teamName ? ` · Team: ${inv.teamName}` : ''}`}>
      {user ? (
        user.email === inv.email ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">You are logged in as {user.email}. Joining moves your account into this organization; your personal tasks will no longer be visible.</p>
            <button className="btn-primary w-full" disabled={busy} onClick={() => act('accept')}>{busy && <Spinner />}Accept invitation</button>
            <button className="btn-secondary w-full" disabled={busy} onClick={() => act('reject')}>Decline</button>
          </div>
        ) : (<div><p className="text-sm text-ink-soft">You are logged in as a different account ({user.email}). Log out and use {inv.email}.</p><button className="btn-secondary mt-3" onClick={logout}>Log out</button></div>)
      ) : inv.userExists ? (
        <div className="space-y-3"><p className="text-sm text-ink-soft">An account already exists for {inv.email}. Log in to accept this invitation.</p><Link to="/login" className="btn-primary w-full">Log in</Link></div>
      ) : (
        <form onSubmit={join} className="space-y-4">
          <Field label="Email"><input className="input" value={inv.email} disabled /></Field>
          <Field label="Full name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Password" hint="At least 8 characters, with a letter and a number."><input className="input" type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Create account and join</button>
        </form>
      )}
    </Shell>
  );
}
