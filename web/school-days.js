// School-day subscription clock.
//
// A paid plan's time only runs on SCHOOL DAYS: its length is still measured in
// calendar days (1 month = Oct 15 → Nov 15 = 31 days, 1 week = 7 days), but
// each of those days is used up only on a day the school is open, in the
// owner's time zone (OWNER_TZ). Weekends, holidays, staff training days,
// weather days and the summer break don't count, so the countdown stands
// still on them.
//
//   * Inside a school calendar's range (SCHOOL_CALENDARS below): a day counts
//     when it is a weekday from the first to the last day of school and isn't
//     marked closed.
//   * Outside every calendar (no calendar entered yet): weekdays count.
//   * Extra closed days the owner adds (weather days) never count.
//
// The functions and the calendar are copied verbatim into script.js (the
// subscriber's countdown) so the console shows what the Worker enforces;
// tests/school-days.test.mjs checks the copy is identical.

// 2026–27 school calendar (180 days: Aug 11, 2026 → May 27, 2027).
// pd = staff PD / training (no students), holiday = closed.
const SCHOOL_CALENDARS = [{
  name: '2026–27',
  from: '2026-08-01', to: '2027-07-31',
  first: '2026-08-11', last: '2027-05-27',
  closed: {
    '2026-08-04': 'pd', '2026-08-05': 'pd', '2026-08-06': 'pd', '2026-08-07': 'pd', '2026-08-10': 'pd',
    '2026-09-07': 'holiday', '2026-09-21': 'holiday',
    '2026-10-19': 'pd',
    '2026-11-11': 'holiday', '2026-11-23': 'holiday', '2026-11-24': 'holiday', '2026-11-25': 'holiday', '2026-11-26': 'holiday', '2026-11-27': 'holiday',
    '2026-12-21': 'holiday', '2026-12-22': 'holiday', '2026-12-23': 'holiday', '2026-12-24': 'holiday', '2026-12-25': 'holiday',
    '2026-12-28': 'holiday', '2026-12-29': 'holiday', '2026-12-30': 'holiday', '2026-12-31': 'holiday',
    '2027-01-01': 'holiday', '2027-01-04': 'pd', '2027-01-18': 'holiday',
    '2027-02-15': 'holiday',
    '2027-03-22': 'holiday', '2027-03-23': 'holiday', '2027-03-24': 'holiday', '2027-03-25': 'holiday', '2027-03-26': 'holiday', '2027-03-29': 'pd',
    '2027-05-28': 'pd', '2027-05-31': 'holiday'
  }
}];

const fmtCache = new Map();
function partsIn(ts, tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ts))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
// ms east of UTC for tz at instant ts.
function offsetAt(ts, tz) {
  const p = partsIn(ts, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - (Math.floor(ts / 1000) * 1000);
}
// The local day ts falls in: its date ("2026-11-16"), weekday (0 = Sunday)
// and the instant the next local day starts (DST-safe).
function localDay(ts, tz) {
  const p = partsIn(ts, tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const key = p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  const nextLocal = Date.UTC(p.y, p.m - 1, p.d + 1);
  let next = nextLocal - offsetAt(nextLocal, tz);
  next = nextLocal - offsetAt(next, tz);
  if (next <= ts) next = ts + 1;   // never stall
  return { key, dow, next };
}
// Why a day doesn't count ('' when it does): weekend, holiday, pd, weather,
// summer (outside the school year inside a calendar's range).
// extra: the owner's added closed days, { 'YYYY-MM-DD': 'weather' } or a Set/array of dates.
function dayOff(key, dow, extra) {
  if (dow === 0 || dow === 6) return 'weekend';
  if (extra && (extra instanceof Set ? extra.has(key) : Array.isArray(extra) ? extra.includes(key) : extra[key])) return 'weather';
  for (const c of SCHOOL_CALENDARS) {
    if (key < c.from || key > c.to) continue;
    if (c.closed[key]) return c.closed[key];
    if (key < c.first || key > c.last) return 'summer';
    return '';
  }
  return '';
}
function offReason(ts, tz, extra) { const d = localDay(ts, tz); return dayOff(d.key, d.dow, extra); }

// School time (ms) between a and b.
function schoolMs(a, b, tz, extra) {
  let t = a, sum = 0;
  for (let i = 0; t < b && i < 5000; i++) {
    const { key, dow, next } = localDay(t, tz);
    const end = Math.min(next, b);
    if (!dayOff(key, dow, extra)) sum += end - t;
    t = end;
  }
  return sum;
}
// The instant `ms` of school time after `from` has been used up. Starting on
// a day off, the clock starts at midnight of the next school day.
function addSchoolMs(from, ms, tz, extra) {
  let t = from, left = Math.max(0, ms);
  for (let i = 0; i < 5000; i++) {
    const { key, dow, next } = localDay(t, tz);
    if (!dayOff(key, dow, extra)) {
      if (next - t >= left) return t + left;
      left -= next - t;
    }
    t = next;
  }
  return t + left;
}
// The next day that counts, as a timestamp of its local midnight (for "resumes Mon").
function nextSchoolDay(ts, tz, extra) {
  let t = ts;
  for (let i = 0; i < 400; i++) {
    const { key, dow, next } = localDay(t, tz);
    if (!dayOff(key, dow, extra) && t !== ts) return t;
    t = next;
  }
  return t;
}
// ---- end of the copied block ----

export { SCHOOL_CALENDARS, localDay, dayOff, offReason, schoolMs, addSchoolMs, nextSchoolDay };
