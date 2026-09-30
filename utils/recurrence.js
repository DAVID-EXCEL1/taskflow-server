const { addMonths } = require('./helpers');
const DAY = 86400000;

// nth occurrence counted from the series anchor. Using the anchor (not the previous date) prevents month-end drift:
// 31 Jan -> 28 Feb -> 31 Mar, instead of 31 Jan -> 28 Feb -> 28 Mar.
function nth(anchor, freq, interval, n) {
  const a = new Date(anchor);
  if (freq === 'daily') return new Date(a.getTime() + n * interval * DAY);
  if (freq === 'weekly') return new Date(a.getTime() + n * interval * 7 * DAY);
  if (freq === 'monthly') return addMonths(a, n * interval);
  if (freq === 'yearly') return addMonths(a, n * interval * 12);
  return null;
}

/**
 * Next due date after this task's current due date that is still in the future.
 * Missed occurrences are skipped (no pile of overdue clones). Returns null when the series has ended.
 * Date-only tasks may land on today; timed tasks must be later than "now".
 */
function nextOccurrence(task, now = new Date()) {
  const r = task.recurrence;
  if (!r || !r.frequency || r.frequency === 'none' || !task.dueDate) return null;
  const interval = Math.max(parseInt(r.interval) || 1, 1);
  const anchor = r.anchor || task.dueDate;
  const current = new Date(task.dueDate).getTime();
  const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endLimit = r.endDate ? new Date(r.endDate).getTime() + DAY - 1 : null; // end date is inclusive
  for (let n = 1; n <= 5000; n++) {
    const occ = nth(anchor, r.frequency, interval, n);
    if (occ.getTime() <= current) continue;
    const future = task.dueHasTime ? occ.getTime() > now.getTime() : occ.getTime() >= startOfToday;
    if (!future) continue;
    if (endLimit && occ.getTime() > endLimit) return null;
    return occ;
  }
  return null;
}
module.exports = { nextOccurrence };
