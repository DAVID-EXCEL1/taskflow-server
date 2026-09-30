import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, UsersRound, UserPlus, Copy, X, Users as UsersIcon } from 'lucide-react';
import api, { errMsg } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../components/hooks';
import { PageHeader, Modal, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, Field, Spinner, Badge, TableWrap, Th, Td } from '../components/ui';
import { fmtDate } from '../utils/format';

/* ---------------- Teams ---------------- */
export function Teams() {
  const { isOwner, canWrite } = useAuth();
  const { data, loading, error, reload } = useFetch('/teams');
  const members = useFetch(isOwner ? '/members' : null);
  const [edit, setEdit] = useState(null);
  const [f, setF] = useState({ name: '', description: '', leader: '' });
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = (t) => { setEdit(t || {}); setF({ name: t?.name || '', description: t?.description || '', leader: t?.leader?._id || '' }); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { edit._id ? await api.put(`/teams/${edit._id}`, f) : await api.post('/teams', f); toast.success('Team saved'); setEdit(null); reload(); }
    catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { const { data: r } = await api.delete(`/teams/${del._id}`); toast.success(r.message); setDel(null); reload(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title={isOwner ? 'Teams' : 'My teams'} subtitle={isOwner ? 'Organise your members into teams.' : 'Teams you belong to.'}>
        {isOwner && <button className="btn-primary" disabled={!canWrite} onClick={() => open()}><Plus className="h-4 w-4" />New team</button>}
      </PageHeader>
      {loading && <SkeletonRows rows={3} />}{error && <ErrorState message={error} onRetry={reload} />}
      {data && !data.length && <div className="card"><EmptyState icon={UsersRound} title={isOwner ? 'No teams yet' : 'You are not in a team yet'} text={isOwner ? 'Create your first team, for example "Software Development" or "Marketing".' : 'Your organization owner can add you to a team.'} /></div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data?.map((t) => (
        <div key={t._id} className="card p-4">
          <div className="flex items-start justify-between gap-2"><h3 className="font-display text-lg font-semibold">{t.name}</h3>
            {isOwner && <div className="flex"><button className="btn-ghost !px-2" disabled={!canWrite} onClick={() => open(t)} aria-label={`Edit ${t.name}`}><Pencil className="h-4 w-4" /></button><button className="btn-ghost !px-2 hover:!text-danger" disabled={!canWrite} onClick={() => setDel(t)} aria-label={`Delete ${t.name}`}><Trash2 className="h-4 w-4" /></button></div>}</div>
          <p className="mt-1 min-h-[2.5rem] text-sm text-ink-soft">{t.description || 'No description'}</p>
          <div className="mt-3 flex items-center justify-between text-xs text-ink-mute"><span className="flex items-center gap-1"><UsersIcon className="h-3.5 w-3.5" />{t.memberCount} member{t.memberCount === 1 ? '' : 's'}</span><span>{t.leader ? `Lead: ${t.leader.name}` : `Created ${fmtDate(t.createdAt)}`}</span></div>
        </div>))}</div>
      {edit && (
        <Modal title={edit._id ? 'Edit team' : 'New team'} onClose={() => setEdit(null)} footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button form="team" className="btn-primary" disabled={busy}>{busy && <Spinner />}Save team</button></>}>
          <form id="team" onSubmit={save} className="space-y-4">
            <Field label="Team name"><input className="input" required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Description"><textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Team leader (optional)"><select className="input" value={f.leader} onChange={(e) => setF({ ...f, leader: e.target.value })}><option value="">No leader</option>{members.data?.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></Field>
          </form>
        </Modal>)}
      {del && <ConfirmDialog danger title={`Delete "${del.name}"?`} message="Members and tasks are kept. The team is removed from them." confirmText="Delete team" busy={busy} onConfirm={remove} onClose={() => setDel(null)} />}
    </>
  );
}

/* ---------------- Members + invitations ---------------- */
export function Members() {
  const { isOwner, canWrite, user } = useAuth();
  const members = useFetch('/members');
  const teams = useFetch(isOwner ? '/teams' : null);
  const invites = useFetch(isOwner ? '/invitations' : null);
  const [invite, setInvite] = useState(false);
  const [assign, setAssign] = useState(null);
  const [remove, setRemove] = useState(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ email: '', team: '' });
  const [teamIds, setTeamIds] = useState([]);
  const linkFor = (t) => `${window.location.origin}/invite/${t}`;
  const copy = async (t) => { await navigator.clipboard.writeText(linkFor(t)); toast.success('Invite link copied'); };

  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const { data } = await api.post('/invitations', f); await navigator.clipboard.writeText(linkFor(data.data.token)).catch(() => {}); toast.success('Invitation created. The link was copied. Send it to the invitee.'); setInvite(false); setF({ email: '', team: '' }); invites.reload(); }
    catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const saveTeams = async () => {
    setBusy(true);
    try { await api.put(`/members/${assign._id}/teams`, { teamIds }); toast.success('Teams updated'); setAssign(null); members.reload(); teams.reload(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const doRemove = async () => {
    setBusy(true);
    try { await api.delete(`/members/${remove._id}`); toast.success('Member removed'); setRemove(null); members.reload(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const cancelInvite = async (id) => { try { await api.delete(`/invitations/${id}`); invites.reload(); } catch (er) { toast.error(errMsg(er)); } };
  const pending = invites.data?.filter((i) => i.status === 'Pending') || [];

  return (
    <>
      <PageHeader title="Members" subtitle="People in your organization.">{isOwner && <button className="btn-primary" disabled={!canWrite} onClick={() => setInvite(true)}><UserPlus className="h-4 w-4" />Invite member</button>}</PageHeader>
      <div className="card mb-6">
        {members.loading && <SkeletonRows rows={4} />}{members.error && <ErrorState message={members.error} onRetry={members.reload} />}
        {members.data && (
          <TableWrap><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Teams</Th>{isOwner && <Th className="text-right">Actions</Th>}</tr></thead>
            <tbody>{members.data.map((m) => (
              <tr key={m._id}><Td><span className="font-medium">{m.name}</span>{m._id === user.id && <span className="ml-2 text-xs text-ink-mute">(you)</span>}</Td><Td className="text-ink-soft">{m.email}</Td>
                <Td>{m.role === 'ORGANIZATION_OWNER' ? <Badge value="Active" label="Owner" /> : 'Member'}</Td>
                <Td>{m.teams?.length ? <span className="flex flex-wrap gap-1">{m.teams.map((t) => <span key={t._id} className="rounded-full bg-line-soft px-2 py-0.5 text-xs">{t.name}</span>)}</span> : <span className="text-ink-mute">—</span>}</Td>
                {isOwner && <Td className="text-right">{m.role !== 'ORGANIZATION_OWNER' && <span className="inline-flex gap-1"><button className="btn-secondary !px-2.5 !py-1" disabled={!canWrite} onClick={() => { setAssign(m); setTeamIds(m.teams.map((t) => t._id)); }}>Teams</button><button className="btn-ghost !px-2 hover:!text-danger" disabled={!canWrite} onClick={() => setRemove(m)} aria-label={`Remove ${m.name}`}><Trash2 className="h-4 w-4" /></button></span>}</Td>}
              </tr>))}</tbody></TableWrap>)}
      </div>

      {isOwner && (
        <div className="card">
          <div className="border-b border-line px-4 py-3"><h2 className="font-semibold">Invitations</h2></div>
          {invites.data && !invites.data.length && <EmptyState title="No invitations yet" text="Invite people by email. They join after accepting." />}
          {invites.data?.length > 0 && (
            <TableWrap><thead><tr><Th>Email</Th><Th>Team</Th><Th>Status</Th><Th>Expires</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>{invites.data.map((i) => (
                <tr key={i._id}><Td>{i.email}</Td><Td>{i.team?.name || '—'}</Td><Td><Badge value={i.status} /></Td><Td>{fmtDate(i.expiresAt)}</Td>
                  <Td className="text-right">{i.status === 'Pending' && <span className="inline-flex gap-1"><button className="btn-secondary !px-2.5 !py-1" onClick={() => copy(i.token)}><Copy className="h-3.5 w-3.5" />Copy link</button><button className="btn-ghost !px-2" onClick={() => cancelInvite(i._id)} aria-label="Cancel invitation"><X className="h-4 w-4" /></button></span>}</Td></tr>))}</tbody></TableWrap>)}
        </div>)}

      {invite && (
        <Modal title="Invite a member" onClose={() => setInvite(false)} footer={<><button className="btn-secondary" onClick={() => setInvite(false)}>Cancel</button><button form="inv" className="btn-primary" disabled={busy}>{busy && <Spinner />}Create invitation</button></>}>
          <form id="inv" onSubmit={send} className="space-y-4">
            <Field label="Email address" hint="An invite link is created and copied. Share it with the person. They can also see it in their notifications if they already have an account."><input className="input" type="email" required autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Add to team (optional)"><select className="input" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })}><option value="">No team yet</option>{teams.data?.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select></Field>
          </form>
        </Modal>)}
      {assign && (
        <Modal title={`Teams for ${assign.name}`} onClose={() => setAssign(null)} size="sm" footer={<><button className="btn-secondary" onClick={() => setAssign(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={saveTeams}>{busy && <Spinner />}Save</button></>}>
          {!teams.data?.length ? <p className="text-sm text-ink-soft">Create a team first.</p> : <div className="space-y-2">{teams.data.map((t) => (
            <label key={t._id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 text-sm"><input type="checkbox" checked={teamIds.includes(t._id)} onChange={(e) => setTeamIds(e.target.checked ? [...teamIds, t._id] : teamIds.filter((x) => x !== t._id))} />{t.name}</label>))}
            <p className="text-xs text-ink-mute">Tick several teams, or move someone by unticking one and ticking another.</p></div>}
        </Modal>)}
      {remove && <ConfirmDialog danger title={`Remove ${remove.name}?`} message="They lose access to the organization. Their account is kept and tasks stay with the organization." confirmText="Remove member" busy={busy} onConfirm={doRemove} onClose={() => setRemove(null)} />}
    </>
  );
}

/* ---------------- Organization settings ---------------- */
export function Organization() {
  const { canWrite, refresh } = useAuth();
  const { data, loading, error, reload } = useFetch('/organizations/me');
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const form = f || (data && { name: data.name, type: data.type || '', phone: data.phone || '', address: data.address || '', website: data.website || '' });
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await api.put('/organizations/me', form); toast.success('Organization updated'); setF(null); reload(); refresh(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Organization" subtitle="Your organization's information." />
      {loading && <SkeletonRows rows={4} />}{error && <ErrorState message={error} onRetry={reload} />}
      {form && (
        <form onSubmit={save} className="card max-w-2xl space-y-4 p-5">
          <Field label="Organization name"><input className="input" required disabled={!canWrite} value={form.name} onChange={(e) => setF({ ...form, name: e.target.value })} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type"><input className="input" disabled={!canWrite} value={form.type} onChange={(e) => setF({ ...form, type: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" disabled={!canWrite} value={form.phone} onChange={(e) => setF({ ...form, phone: e.target.value })} /></Field>
          </div>
          <Field label="Address"><input className="input" disabled={!canWrite} value={form.address} onChange={(e) => setF({ ...form, address: e.target.value })} /></Field>
          <Field label="Website"><input className="input" placeholder="https://" disabled={!canWrite} value={form.website} onChange={(e) => setF({ ...form, website: e.target.value })} /></Field>
          <p className="text-xs text-ink-mute">Owner: {data?.owner?.name} ({data?.owner?.email})</p>
          <button className="btn-primary" disabled={!canWrite || busy}>{busy && <Spinner />}Save changes</button>
          {!canWrite && <p className="text-xs text-danger">Renew your subscription to edit organization information.</p>}
        </form>)}
    </>
  );
}
