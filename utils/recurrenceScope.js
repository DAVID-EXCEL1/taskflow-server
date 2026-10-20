/**
 * Editing a repeating task: "only this one" or "this and all future ones".
 * Future occurrences are copied from `task.seriesTemplate` (when there is one) instead of from the occurrence just completed,
 * so an edit made to a single day never leaks into the days after it.
 */
const TEMPLATE_FIELDS = ['title', 'description', 'category', 'priority', 'assignedTo', 'assignedTeam', 'reminder'];
const isSeries = (t) => !!(t && t.recurrence && t.recurrence.frequency && t.recurrence.frequency !== 'none');
const touchesTemplate = (changes) => Object.keys(changes).some((k) => TEMPLATE_FIELDS.includes(k));
const one = (task, k) => (k === 'reminder' ? (task.reminder && task.reminder.minutesBefore != null ? { minutesBefore: task.reminder.minutesBefore } : null) : task[k]);

function pickTemplate(task) { const out = {}; for (const k of TEMPLATE_FIELDS) { const v = one(task, k); if (v !== undefined) out[k] = v; } return out; }
// Call BEFORE the changes are applied: remembers the values future occurrences should keep.
function captureTemplate(task, changes) {
  if (!isSeries(task) || !touchesTemplate(changes) || task.seriesTemplate) return false;
  task.seriesTemplate = pickTemplate(task); return true;
}
// Call AFTER the changes are applied: "all future" copies the new values into the template.
function applyFuture(task, changes, scope) {
  if (!isSeries(task) || scope === 'this' || !touchesTemplate(changes)) return false;
  const tpl = { ...(task.seriesTemplate || {}) };
  for (const k of TEMPLATE_FIELDS) if (k in changes) tpl[k] = one(task, k);
  task.seriesTemplate = tpl; return true;
}
// The values the next occurrence should start with.
function fieldsForNext(task) {
  const t = task.seriesTemplate || {}; const val = (k) => (k in t ? t[k] : one(task, k));
  return { title: val('title'), description: val('description'), category: val('category'), priority: val('priority'), assignedTo: val('assignedTo'), assignedTeam: val('assignedTeam'), reminder: val('reminder') };
}
module.exports = { TEMPLATE_FIELDS, isSeries, touchesTemplate, pickTemplate, captureTemplate, applyFuture, fieldsForNext };
