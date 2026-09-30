// Adds calendar months in UTC, clamping to the end of shorter months (31 Jan + 1 month = 28/29 Feb).
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}
const escapeRegex = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const daysBetween = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86400000);
const pageParams = (q, defLimit = 20, max = 1000) => {
  const page = Math.max(parseInt(q.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(q.limit) || defLimit, 1), max);
  return { page, limit, skip: (page - 1) * limit };
};
module.exports = { addMonths, escapeRegex, daysBetween, pageParams };
