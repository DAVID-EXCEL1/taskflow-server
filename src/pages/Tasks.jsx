import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Plus, Search, Download, ArrowUp, ArrowDown, Maximize2, Trash2, Filter, ListChecks, Check, X } from 'lucide-react';
import api, { errMsg, isReadOnlyError } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useFetch, useDebounced } from '../components/hooks';
import { PageHeader, Pagination, Modal, Drawer, ConfirmDialog, EmptyState, ErrorState, SkeletonRows, Field, Spinner, Tabs, PriorityBadge, StatusBadge, cx, PRIORITY_CLS, STATUS_CLS } from '../components/ui';
import { PRIORITIES, STATUSES, toInputDate, isOverdue, isSoon, fmtDate, fmtDateTime } from '../utils/format';

/* ---------- cell editors ---------- */
function moveFocus(e, col, row) {
  const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  if (!d) return;
  const next = document.querySelector(`[data-col="${col}"][data-row="${row + d}"]`);
  if (next) { e.preventDefault(); next.focus(); next.select?.(); }
}
function TextCell({ value, onSave, disabled, col, row, placeholder, className }) {
  const [v, setV] = useState(value ?? '');
  const cancelled = useRef(false);
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <input className={cx('cell', className)} data-col={col} data-row={row} value={v} disabled={disabled} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (cancelled.current) { cancelled.current = false; setV(value ?? ''); return; } if (v !== (value ?? '')) onSave(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } moveFocus(e, col, row); }} />
  );
}
function SelectCell({ value, options, onSave, disabled, className, blank }) {
  return (
    <select className={cx('cell cursor-pointer', className)} value={value ?? ''} disabled={disabled} onChange={(e) => onSave(e.target.value)}>
      {blank !== undefined && <option value="">{blank}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
function DateCell({ value, onSave, disabled, col, row, danger }) {
  return <input type="date" className={cx('cell', danger && 'font-medium text-danger')} data-col={col} data-row={row} value={toInputDate(value)} disabled={disabled} onChange={(e) => onSave(e.target.value)} onKeyDown={(e) => moveFocus(e, col, row)} />;
}

/* ---------- main page ---------- */
const COLS = [
  { key: 'date', label: 'Date', w: 'w-36', sort: true },
  { key: 'title', label: 'Task', w: 'min-w-[260px]', sort: true, sticky: true },
  { key: 'category', label: 'Category', w: 'w-40' },
  { key: 'priority', label: 'Priority', w: 'w-32', sort: true },
  { key: 'status', label: 'Status', w: 'w-36', sort: true },
  { key: 'dueDate', label: 'Due Date', w: 'w-40', sort: true },
  { key: 'note', label: 'Note', w: 'min-w-[200px]' },
];
const ORG_COLS = [{ key: 'assignedTo', label: 'Assigned To', w: 'w-44' }, { key: 'assignedTeam', label: 'Team', w: 'w-40' }];

export default function Tasks() {
  const { isOrg, isOwner, canWrite, refresh } = useAuth();
  const [f, setF] = useState({ search: '', status: '', priority: '', category: '', assignedTo: '', team: '', view: 'all', overdue: false });
  const [sort, setSort] = useState({ sort: 'date', order: 'desc' });
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState(false);
  const [drawerId, setDrawerId] = useState(null);
  const [quick, setQuick] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [saving, setSaving] = useState(0);
  const [savedAt, setSavedAt] = useState(null);
  const search = useDebounced(f.search);

  const params = useMemo(() => {
    const p = { ...sort, page, limit: 50 };
    if (search) p.search = search;
    ['status', 'priority', 'category', 'assignedTo', 'team'].forEach((k) => f[k] && (p[k] = f[k]));
    if (f.view !== 'all') p.view = f.view;
    if (f.overdue) p.overdue = 'true';
    return p;
  }, [f, search, sort, page]);
  useEffect(() => setPage(1), [search, f.status, f.priority, f.category, f.assignedTo, f.team, f.view, f.overdue]);

  const tasks = useFetch('/tasks', params);
  const cats = useFetch('/categories');
  const members = useFetch(isOrg ? '/members' : null);
  const teams = useFetch(isOrg ? '/teams' : null);
  const categories = cats.data || [];
  const memberList = isOrg ? members.data || [] : [];
  const teamList = isOrg ? teams.data || [] : [];
  const catOpts = categories.map((c) => ({ value: c._id, label: c.name }));
  const cols = isOrg ? [...COLS, ...ORG_COLS] : COLS;

  const lookup = { category: (id) => categories.find((c) => c._id === id), assignedTo: (id) => memberList.find((m) => m._id === id), assignedTeam: (id) => teamList.find((t) => t._id === id) };
  const rows = tasks.data || [];

  const save = useCallback(async (task, field, value) => {
    const before = task[field];
    const isRef = ['category', 'assignedTo', 'assignedTeam'].includes(field);
    const optimistic = isRef ? (value ? lookup[field](value) : null) : value === '' && field !== 'title' ? undefined : value;
    tasks.setData((d) => d.map((t) => (t._id === task._id ? { ...t, [field]: optimistic } : t)));
    setSaving((n) => n + 1);
    try {
      const { data } = await api.patch(`/tasks/${task._id}`, { [field]: value === '' ? null : value });
      tasks.setData((d) => d.map((t) => (t._id === task._id ? data.data : t)));
      setSavedAt(Date.now());
    } catch (e) {
      tasks.setData((d) => d.map((t) => (t._id === task._id ? { ...t, [field]: before } : t)));
      toast.error(errMsg(e));
      if (isReadOnlyError(e)) refresh();
    } finally { setSaving((n) => n - 1); }
  }, [tasks, categories, memberList, teamList]); // eslint-disable-line

  const addQuick = async () => {
    const title = quick.trim();
    if (!title) return;
    setQuickBusy(true);
    try {
      await api.post('/tasks', { title, priority: 'Medium', status: 'Pending', date: toInputDate(new Date()) });
      setQuick(''); tasks.reload(); setSavedAt(Date.now());
    } catch (e) { toast.error(errMsg(e)); if (isReadOnlyError(e)) refresh(); } finally { setQuickBusy(false); }
  };

  const sortBy = (key) => setSort((s) => (s.sort === key ? { sort: key, order: s.order === 'asc' ? 'desc' : 'asc' } : { sort: key, order: 'asc' }));
  const exportRows = async (kind) => {
    try {
      const { data } = await api.get('/tasks', { params: { ...params, page: 1, limit: 1000 } });
      const XLSX = await import('xlsx');
      const out = data.data.map((t) => ({ Date: fmtDate(t.date), Task: t.title, Category: t.category?.name || '', Priority: t.priority, Status: t.status, 'Due Date': fmtDate(t.dueDate), Note: t.note || '', ...(isOrg ? { 'Assigned To': t.assignedTo?.name || '', Team: t.assignedTeam?.name || '' } : {}) }));
      if (!out.length) return toast('Nothing to export for this view.');
      const ws = XLSX.utils.json_to_sheet(out);
      ws['!cols'] = Object.keys(out[0]).map((k) => ({ wch: k === 'Task' || k === 'Note' ? 36 : 16 }));
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
      XLSX.writeFile(wb, `tasks-${toInputDate(new Date())}.${kind}`, { bookType: kind });
    } catch (e) { toast.error(errMsg(e)); }
  };

  const activeFilters = ['status', 'priority', 'category', 'assignedTo', 'team'].filter((k) => f[k]).length + (f.overdue ? 1 : 0);
  const clear = () => setF({ ...f, search: '', status: '', priority: '', category: '', assignedTo: '', team: '', overdue: false });
  const sel = (k, opts, label) => <select className="input !w-auto" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}><option value="">{label}</option>{opts.map((o) => (typeof o === 'string' ? <option key={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}</select>;
  const ro = !canWrite;

  return (
    <>
      <PageHeader title="Tasks" subtitle={isOwner ? 'Everything across your organization.' : isOrg ? 'Tasks assigned to you, your teams, or created by you.' : 'Your personal task list.'}>
        <span className="hidden items-center gap-1.5 text-xs text-ink-mute sm:flex" aria-live="polite">{saving > 0 ? <><Spinner className="h-3 w-3" />Saving…</> : savedAt ? <><Check className="h-3.5 w-3.5 text-brand" />Saved</> : null}</span>
        <div className="relative group">
          <button className="btn-secondary"><Download className="h-4 w-4" />Export</button>
          <div className="absolute right-0 z-20 hidden w-40 rounded-lg border border-line bg-white py-1 shadow-pop group-focus-within:block group-hover:block">
            <button className="block w-full px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => exportRows('xlsx')}>Excel (.xlsx)</button>
            <button className="block w-full px-3 py-2 text-left text-sm hover:bg-paper" onClick={() => exportRows('csv')}>CSV (.csv)</button>
          </div>
        </div>
        <button className="btn-primary" disabled={ro} onClick={() => setModal(true)}><Plus className="h-4 w-4" />New task</button>
      </PageHeader>

      {isOrg && <div className="mb-3"><Tabs value={f.view} onChange={(view) => setF({ ...f, view })} tabs={[{ value: 'all', label: isOwner ? 'All tasks' : 'All visible' }, { value: 'mine', label: 'My tasks' }, { value: 'team', label: 'Team tasks' }]} /></div>}

      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-mute" /><input className="input !pl-9" placeholder="Search tasks…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search tasks" /></div>
          <button className="btn-secondary lg:hidden" onClick={() => setShowFilters(!showFilters)}><Filter className="h-4 w-4" />Filters{activeFilters > 0 && ` (${activeFilters})`}</button>
          <div className={cx('w-full flex-wrap items-center gap-2 lg:flex lg:w-auto', showFilters ? 'flex' : 'hidden')}>
            {sel('status', STATUSES, 'All statuses')}{sel('priority', PRIORITIES, 'All priorities')}{sel('category', catOpts, 'All categories')}
            {isOwner && sel('assignedTo', memberList.map((m) => ({ value: m._id, label: m.name })), 'Anyone')}
            {isOrg && sel('team', teamList.map((t) => ({ value: t._id, label: t.name })), 'All teams')}
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} />Overdue</label>
            {(activeFilters > 0 || f.search) && <button className="btn-ghost !px-2" onClick={clear}><X className="h-4 w-4" />Clear</button>}
          </div>
        </div>
      </div>

      {tasks.error && <ErrorState message={tasks.error} onRetry={tasks.reload} />}
      <div className="card overflow-hidden">
        {/* Desktop / tablet: spreadsheet grid */}
        <div className="hidden max-h-[68vh] overflow-auto md:block">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 z-20 w-9 border-b border-r border-line bg-paper" />
                {cols.map((c) => (
                  <th key={c.key} className={cx('sticky top-0 border-b border-r border-line bg-paper px-2 py-2 text-left text-xs font-semibold text-ink-soft', c.w, c.sticky ? 'left-9 z-30' : 'z-10')}>
                    {c.sort ? <button className="flex items-center gap-1 hover:text-ink" onClick={() => sortBy(c.key)}>{c.label}{sort.sort === c.key && (sort.order === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button> : c.label}
                  </th>))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-brand-light/30">
                <td className="border-b border-r border-line-soft text-center text-ink-mute"><Plus className="mx-auto h-3.5 w-3.5" /></td>
                <td className="border-b border-r border-line-soft px-2 text-xs text-ink-mute">{toInputDate(new Date())}</td>
                <td className="sticky left-9 z-10 border-b border-r border-line-soft bg-brand-light/30">
                  <input className="cell" disabled={ro || quickBusy} placeholder={ro ? 'Read-only account' : 'Type a task and press Enter…'} value={quick} onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addQuick()} aria-label="Quick add task" />
                </td>
                <td colSpan={cols.length - 2} className="border-b border-line-soft px-2 text-xs text-ink-mute">Medium priority · Pending · you can edit any cell after adding</td>
              </tr>
              {tasks.loading && !rows.length && <tr><td colSpan={cols.length + 1}><SkeletonRows /></td></tr>}
              {rows.map((t, i) => {
                const ed = t.permissions?.editableFields || [];
                const can = (f2) => !ro && ed.includes(f2);
                const od = isOverdue(t);
                const bd = 'border-b border-r border-line-soft';
                return (
                  <tr key={t._id} className="group hover:bg-paper/70">
                    <td className={cx(bd, 'text-center')}><button className="rounded p-1 text-ink-mute hover:bg-line-soft hover:text-ink" onClick={() => setDrawerId(t._id)} aria-label={`Open details for ${t.title}`}><Maximize2 className="h-3.5 w-3.5" /></button></td>
                    <td className={bd}><DateCell value={t.date} disabled={!can('date')} onSave={(v) => save(t, 'date', v)} col="date" row={i} /></td>
                    <td className={cx(bd, 'sticky left-9 z-10 bg-white group-hover:bg-paper')}><TextCell value={t.title} disabled={!can('title')} onSave={(v) => v.trim() ? save(t, 'title', v) : toast.error('A task needs a title.')} col="title" row={i} className={t.status === 'Completed' || t.status === 'Cancelled' ? 'text-ink-mute line-through' : 'font-medium'} /></td>
                    <td className={bd}><SelectCell value={t.category?._id} options={catOpts} blank="—" disabled={!can('category')} onSave={(v) => save(t, 'category', v)} /></td>
                    <td className={bd}><SelectCell value={t.priority} options={PRIORITIES} disabled={!can('priority')} onSave={(v) => save(t, 'priority', v)} className={cx('font-medium', PRIORITY_CLS[t.priority])} /></td>
                    <td className={bd}><SelectCell value={t.status} options={STATUSES} disabled={!can('status')} onSave={(v) => save(t, 'status', v)} className={cx('font-medium', STATUS_CLS[t.status])} /></td>
                    <td className={bd}><div className="flex items-center"><DateCell value={t.dueDate} disabled={!can('dueDate')} onSave={(v) => save(t, 'dueDate', v)} col="dueDate" row={i} danger={od} />{od && <span className="mr-1 rounded bg-danger-light px-1.5 text-[10px] font-semibold text-danger">Overdue</span>}{!od && isSoon(t) && <span className="mr-1 rounded bg-amber-light px-1.5 text-[10px] font-semibold text-amber-800">Soon</span>}</div></td>
                    <td className={bd}><TextCell value={t.note} disabled={!can('note')} onSave={(v) => save(t, 'note', v)} col="note" row={i} placeholder="Add a note" /></td>
                    {isOrg && <td className={bd}><SelectCell value={t.assignedTo?._id} options={memberList.map((m) => ({ value: m._id, label: m.name }))} blank="Unassigned" disabled={!can('assignedTo')} onSave={(v) => save(t, 'assignedTo', v)} /></td>}
                    {isOrg && <td className={bd}><SelectCell value={t.assignedTeam?._id} options={teamList.map((x) => ({ value: x._id, label: x.name }))} blank="No team" disabled={!can('assignedTeam')} onSave={(v) => save(t, 'assignedTeam', v)} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!tasks.loading && !rows.length && !tasks.error && <EmptyState icon={ListChecks} title={activeFilters || search ? 'No tasks match your filters' : 'No tasks yet'} text={activeFilters || search ? 'Try clearing a filter.' : 'Type in the row above and press Enter to add your first task.'} />}
        </div>

        {/* Mobile: cards */}
        <div className="divide-y divide-line-soft md:hidden">
          {tasks.loading && !rows.length && <SkeletonRows />}
          {rows.map((t) => (
            <button key={t._id} onClick={() => setDrawerId(t._id)} className="block w-full px-4 py-3 text-left active:bg-paper">
              <p className={cx('font-medium', (t.status === 'Completed' || t.status === 'Cancelled') && 'text-ink-mute line-through')}>{t.title}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><PriorityBadge value={t.priority} /><StatusBadge value={t.status} />{t.category && <span className="text-xs text-ink-soft">{t.category.name}</span>}</div>
              <p className={cx('mt-1.5 text-xs', isOverdue(t) ? 'font-medium text-danger' : 'text-ink-mute')}>{t.dueDate ? `${isOverdue(t) ? 'Overdue · ' : 'Due '}${fmtDate(t.dueDate)}` : 'No due date'}{t.assignedTo ? ` · ${t.assignedTo.name}` : ''}</p>
            </button>))}
          {!tasks.loading && !rows.length && !tasks.error && <EmptyState icon={ListChecks} title="No tasks found" text="Tap New task to add one." />}
        </div>
        <Pagination pagination={tasks.pagination} onPage={setPage} />
      </div>
      <p className="mt-2 hidden text-xs text-ink-mute md:block">Tip: click any cell to edit it. Press Enter to save, Esc to cancel, and use the up and down arrow keys to move between rows.</p>

      {modal && <NewTaskModal onClose={() => setModal(false)} onCreated={() => { setModal(false); tasks.reload(); }} catOpts={catOpts} members={memberList} teams={teamList} />}
      {drawerId && <TaskDrawer id={drawerId} onClose={() => setDrawerId(null)} onChanged={tasks.reload} save={save} catOpts={catOpts} members={memberList} teams={teamList} />}
    </>
  );
}

/* ---------- new task modal ---------- */
function NewTaskModal({ onClose, onCreated, catOpts, members, teams }) {
  const { isOrg, isOwner, refresh } = useAuth();
  const [f, setF] = useState({ title: '', description: '', category: '', priority: 'Medium', status: 'Pending', date: toInputDate(new Date()), dueDate: '', note: '', assignedTo: '', assignedTeam: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.post('/tasks', f); toast.success('Task created'); onCreated(); }
    catch (er) { setErr(errMsg(er)); if (isReadOnlyError(er)) refresh(); } finally { setBusy(false); }
  };
  return (
    <Modal title="New task" onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button form="new-task" className="btn-primary" disabled={busy}>{busy && <Spinner />}Create task</button></>}>
      <form id="new-task" onSubmit={submit} className="space-y-4">
        {err && <p role="alert" className="rounded-lg bg-danger-light px-3 py-2 text-sm text-danger">{err}</p>}
        <Field label="Title"><input className="input" required autoFocus value={f.title} onChange={set('title')} /></Field>
        <Field label="Description"><textarea className="input min-h-[80px]" value={f.description} onChange={set('description')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category"><select className="input" value={f.category} onChange={set('category')}><option value="">None</option>{catOpts.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label="Priority"><select className="input" value={f.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={f.status} onChange={set('status')}>{STATUSES.map((p) => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Date"><input type="date" className="input" value={f.date} onChange={set('date')} /></Field>
          <Field label="Due date"><input type="date" className="input" value={f.dueDate} onChange={set('dueDate')} /></Field>
          {isOrg && <Field label="Assign to person"><select className="input" value={f.assignedTo} onChange={set('assignedTo')}><option value="">Unassigned</option>{members.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></Field>}
          {isOrg && <Field label="Assign to team"><select className="input" value={f.assignedTeam} onChange={set('assignedTeam')}><option value="">No team</option>{teams.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select></Field>}
        </div>
        <Field label="Note"><input className="input" value={f.note} onChange={set('note')} /></Field>
        {isOrg && !isOwner && <p className="text-xs text-ink-mute">Members can assign tasks to themselves or to people in their own teams.</p>}
      </form>
    </Modal>
  );
}

/* ---------- details drawer ---------- */
const FIELD_LABEL = { title: 'Title', status: 'Status', priority: 'Priority', dueDate: 'Due date', category: 'Category', assignedTo: 'Assignee', assignedTeam: 'Team' };
function TaskDrawer({ id, onClose, onChanged, save, catOpts, members, teams }) {
  const { isOrg, canWrite } = useAuth();
  const [task, setTask] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/tasks/${id}`).then((r) => setTask(r.data.data)).catch((e) => setError(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);

  const edit = async (field, value) => { await save(task, field, value); await load(); onChanged(); };
  const del = async () => {
    setBusy(true);
    try { await api.delete(`/tasks/${id}`); toast.success('Task deleted'); onChanged(); onClose(); } catch (e) { toast.error(errMsg(e)); setBusy(false); setConfirm(false); }
  };
  const ed = task?.permissions?.editableFields || [];
  const can = (k) => canWrite && ed.includes(k);

  return (
    <Drawer title={task ? task.title : 'Task details'} onClose={onClose} footer={task?.permissions?.canDelete && canWrite ? <button className="btn-secondary !text-danger" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete task</button> : null}>
      {error && <ErrorState message={error} />}
      {!task && !error && <SkeletonRows rows={6} />}
      {task && (
        <div className="space-y-4">
          <Field label="Title"><TextCell value={task.title} disabled={!can('title')} onSave={(v) => v.trim() && edit('title', v)} className="input" col="d-title" row={0} /></Field>
          <Field label="Description"><DescEditor value={task.description} disabled={!can('description')} onSave={(v) => edit('description', v)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status"><SelectCell className="input" value={task.status} options={STATUSES} disabled={!can('status')} onSave={(v) => edit('status', v)} /></Field>
            <Field label="Priority"><SelectCell className="input" value={task.priority} options={PRIORITIES} disabled={!can('priority')} onSave={(v) => edit('priority', v)} /></Field>
            <Field label="Category"><SelectCell className="input" value={task.category?._id} options={catOpts} blank="None" disabled={!can('category')} onSave={(v) => edit('category', v)} /></Field>
            <Field label="Due date"><DateCell value={task.dueDate} disabled={!can('dueDate')} onSave={(v) => edit('dueDate', v)} col="d-due" row={0} /></Field>
            {isOrg && <Field label="Assigned to"><SelectCell className="input" value={task.assignedTo?._id} options={members.map((m) => ({ value: m._id, label: m.name }))} blank="Unassigned" disabled={!can('assignedTo')} onSave={(v) => edit('assignedTo', v)} /></Field>}
            {isOrg && <Field label="Team"><SelectCell className="input" value={task.assignedTeam?._id} options={teams.map((t) => ({ value: t._id, label: t.name }))} blank="No team" disabled={!can('assignedTeam')} onSave={(v) => edit('assignedTeam', v)} /></Field>}
          </div>
          <Field label="Note"><TextCell value={task.note} disabled={!can('note')} onSave={(v) => edit('note', v)} className="input" col="d-note" row={0} placeholder="Add a note" /></Field>
          <div className="rounded-lg bg-paper p-3 text-xs text-ink-soft">
            <p>Created by {task.createdBy?.name} on {fmtDate(task.createdAt)}</p>
            {task.completedAt && <p>Completed {fmtDateTime(task.completedAt)}</p>}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">History</h3>
            {task.history?.length ? <ul className="space-y-2 border-l-2 border-line pl-3">{[...task.history].reverse().map((h, i) => (
              <li key={i} className="text-xs"><span className="font-medium">{h.byName}</span> changed {FIELD_LABEL[h.field] || h.field}{h.to ? <> from <span className="text-ink-soft">{h.from || 'empty'}</span> to <span className="font-medium">{h.to}</span></> : ''}<span className="block text-ink-mute">{fmtDateTime(h.at)}</span></li>))}</ul>
              : <p className="text-xs text-ink-mute">No changes recorded yet.</p>}
          </div>
        </div>)}
      {confirm && <ConfirmDialog danger title="Delete this task?" message="This permanently deletes the task and its history." confirmText="Delete" busy={busy} onConfirm={del} onClose={() => setConfirm(false)} />}
    </Drawer>
  );
}
function DescEditor({ value, onSave, disabled }) {
  const [v, setV] = useState(value || '');
  return <textarea className="input min-h-[96px]" value={v} disabled={disabled} placeholder="Add more detail" onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value || '') && onSave(v)} />;
}
