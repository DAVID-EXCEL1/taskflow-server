export const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const toInputDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const isOverdue = (t) => t.dueDate && new Date(t.dueDate) < new Date(new Date().toDateString()) && ['Pending', 'In Progress'].includes(t.status);
export const isSoon = (t) => {
  if (!t.dueDate || !['Pending', 'In Progress'].includes(t.status)) return false;
  const diff = (new Date(t.dueDate) - new Date(new Date().toDateString())) / 86400000;
  return diff >= 0 && diff <= 1;
};
export const timeAgo = (d) => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
export const ROLE_LABEL = { SUPER_ADMIN: 'Super Admin', INDIVIDUAL: 'Personal', ORGANIZATION_OWNER: 'Org owner', ORGANIZATION_MEMBER: 'Member' };
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled'];
