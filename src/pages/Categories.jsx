import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Tags } from 'lucide-react';
import api, { errMsg } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFetch } from '../components/hooks';
import { PageHeader, Modal, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, Field, Spinner } from '../components/ui';

const COLORS = ['#0F6B4F', '#2563EB', '#6C5CE7', '#E8A317', '#D64545', '#0E7490', '#9333EA', '#64748B'];

export default function Categories() {
  const { canWrite } = useAuth();
  const { data, loading, error, reload } = useFetch('/categories');
  const [edit, setEdit] = useState(null); // {} for new
  const [del, setDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const open = (c) => { setEdit(c || {}); setName(c?.name || ''); setColor(c?.color || COLORS[0]); };
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try { edit._id ? await api.put(`/categories/${edit._id}`, { name, color }) : await api.post('/categories', { name, color }); toast.success('Category saved'); setEdit(null); reload(); }
    catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { const { data: r } = await api.delete(`/categories/${del._id}`); toast.success(r.message); setDel(null); reload(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Categories" subtitle="Group your tasks your way."><button className="btn-primary" disabled={!canWrite} onClick={() => open()}><Plus className="h-4 w-4" />New category</button></PageHeader>
      <div className="card">
        {loading && <SkeletonRows rows={4} />}{error && <ErrorState message={error} onRetry={reload} />}
        {data && !data.length && <EmptyState icon={Tags} title="No categories yet" text="Create one to organise your tasks." />}
        <ul className="divide-y divide-line-soft">{data?.map((c) => (
          <li key={c._id} className="flex items-center justify-between px-4 py-3"><span className="flex items-center gap-3"><span className="h-3.5 w-3.5 rounded-full" style={{ background: c.color }} />{c.name}</span>
            <span className="flex gap-1"><button className="btn-ghost !px-2" disabled={!canWrite} onClick={() => open(c)} aria-label={`Edit ${c.name}`}><Pencil className="h-4 w-4" /></button><button className="btn-ghost !px-2 hover:!text-danger" disabled={!canWrite} onClick={() => setDel(c)} aria-label={`Delete ${c.name}`}><Trash2 className="h-4 w-4" /></button></span></li>))}</ul>
      </div>
      {edit && (
        <Modal title={edit._id ? 'Edit category' : 'New category'} onClose={() => setEdit(null)} size="sm" footer={<><button className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button form="cat" className="btn-primary" disabled={busy}>{busy && <Spinner />}Save category</button></>}>
          <form id="cat" onSubmit={save} className="space-y-4">
            <Field label="Name"><input className="input" required autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Colour"><div className="flex flex-wrap gap-2">{COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} aria-label={c} className="h-8 w-8 rounded-full ring-offset-2" style={{ background: c, boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : 'none' }} />)}</div></Field>
          </form>
        </Modal>)}
      {del && <ConfirmDialog danger title={`Delete "${del.name}"?`} message="Tasks in this category are kept, but they will have no category." confirmText="Delete" busy={busy} onConfirm={remove} onClose={() => setDel(null)} />}
    </>
  );
}
