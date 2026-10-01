const DEFAULT_TZ = 'Africa/Lagos';
const isValidTimezone = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

// Offset (ms) of a timezone from UTC at a given instant.
function offsetMs(ts, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(ts / 1000) * 1000;
}
// "2026-10-01" + "08:00" in Africa/Lagos  ->  the matching UTC instant.
function zonedTimeToUtc(dateStr, timeStr, tz = DEFAULT_TZ) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - offsetMs(guess, tz);
  ts = guess - offsetMs(ts, tz);
  return new Date(ts);
}
module.exports = { DEFAULT_TZ, isValidTimezone, zonedTimeToUtc };
