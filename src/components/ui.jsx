import { useEffect } from 'react';
import { X, Loader2, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Spinner({ className }) { return <Loader2 className={cx('animate-spin', className || 'h-4 w-4')} aria-hidden />; }

export function Skeleton({ className }) { return <div className={cx('animate-pulse rounded-md bg-line-soft', className || 'h-4 w-full')} />; }
export function SkeletonRows({ rows = 5 }) {
  return <div className="space-y-3 p-4">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>;
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, text, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-brand-light p-3 text-brand"><Icon className="h-6 w-6" /></div>
      <p className="font-display text-lg font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-ink-soft">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="m-4 rounded-lg border border-danger/30 bg-danger-light p-4 text-sm text-danger">
      {message || 'Could not load this data.'} {onRetry && <button onClick={onRetry} className="ml-2 font-medium underline">Try again</button>}
    </div>
  );
}

export const PRIORITY_CLS = { Low: 'bg-line-soft text-ink-soft', Medium: 'bg-blue-50 text-blue-700', High: 'bg-orange-50 text-orange-700', Urgent: 'bg-danger-light text-danger' };
export const STATUS_CLS = { Pending: 'bg-line-soft text-ink-soft', 'In Progress': 'bg-blue-50 text-blue-700', Completed: 'bg-brand-light text-brand-dark', Cancelled: 'bg-neutral-100 text-ink-mute line-through' };
const GENERIC = { Active: 'bg-brand-light text-brand-dark', Approved: 'bg-brand-light text-brand-dark', Accepted: 'bg-brand-light text-brand-dark', Pending: 'bg-amber-light text-amber-800', Scheduled: 'bg-blue-50 text-blue-700', Expired: 'bg-danger-light text-danger', Rejected: 'bg-danger-light text-danger', Inactive: 'bg-line-soft text-ink-soft', None: 'bg-line-soft text-ink-soft' };
const pill = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap';
export const PriorityBadge = ({ value }) => <span className={cx(pill, PRIORITY_CLS[value])}>{value}</span>;
export const StatusBadge = ({ value }) => <span className={cx(pill, STATUS_CLS[value])}>{value}</span>;
export const Badge = ({ value, label }) => <span className={cx(pill, GENERIC[value] || 'bg-line-soft text-ink-soft')}>{label || value}</span>;

export function StatCard({ label, value, icon: Icon, tone = 'brand', hint }) {
  const tones = { brand: 'bg-brand-light text-brand', amber: 'bg-amber-light text-amber-800', danger: 'bg-danger-light text-danger', blue: 'bg-blue-50 text-blue-700', neutral: 'bg-line-soft text-ink-soft' };
  return (
    <div className="card flex items-center gap-4 p-4">
      {Icon && <div className={cx('rounded-lg p-2.5', tones[tone])}><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0">
        <p className="text-sm text-ink-soft">{label}</p>
        <p className="font-display text-2xl font-bold leading-tight">{value}</p>
        {hint && <p className="text-xs text-ink-mute">{hint}</p>}
      </div>
    </div>
  );
}

function useEscape(onClose) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [onClose]);
}

export function Modal({ title, onClose, children, footer, size = 'md' }) {
  useEscape(onClose);
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className={cx('rise relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop sm:rounded-2xl', w)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-soft hover:bg-line-soft" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ title, onClose, children, footer }) {
  useEscape(onClose);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-pop sm:rounded-l-2xl" style={{ animation: 'rise .2s ease-out' }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-ink-soft hover:bg-line-soft" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmText = 'Confirm', danger, busy, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} size="sm" footer={<>
      <button className="btn-secondary" onClick={onClose}>Cancel</button>
      <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>{busy && <Spinner />}{confirmText}</button>
    </>}>
      <p className="text-sm text-ink-soft">{message}</p>
    </Modal>
  );
}

export function Field({ label, error, hint, children }) {
  return (
    <div>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-mute">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.pages <= 1) return null;
  const { page, pages, total } = pagination;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-ink-soft">
      <span>{total} results</span>
      <div className="flex items-center gap-2">
        <button className="btn-secondary !px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span>Page {page} of {pages}</span>
        <button className="btn-secondary !px-2" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg bg-line-soft p-1">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)} className={cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors', value === t.value ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink')}>{t.label}</button>
      ))}
    </div>
  );
}

// Table that scrolls sideways on small screens (used for admin tables). Task grid has its own mobile cards.
export function TableWrap({ children }) { return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">{children}</table></div>; }
export const Th = ({ children, className }) => <th className={cx('whitespace-nowrap border-b border-line bg-paper px-4 py-2.5 text-xs font-semibold text-ink-soft', className)}>{children}</th>;
export const Td = ({ children, className }) => <td className={cx('border-b border-line-soft px-4 py-3 align-middle', className)}>{children}</td>;
