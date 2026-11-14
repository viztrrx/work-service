// Weekday-only subscription clock.
//
// A paid plan's time only runs Monday to Friday: on Saturdays and Sundays
// (in the owner's time zone, OWNER_TZ) the countdown is paused, so a
// "1 month" plan gives 31 (or 28/30) full weekdays of access instead of
// 31 calendar days. The plan's length is still measured as before (calendar
// months, or 7/14 days), but each of those days is spent only on a weekday.
//
// The same three functions are copied into script.js (renderSubStrip) so the
// countdown the subscriber sees matches the end date the Worker enforces;
// tests/weekdays.test.mjs checks the two copies agree.

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
// The local day ts falls in: its weekday (0 = Sunday) and the instant the
// next local day starts (DST-safe: a 23- or 25-hour day is handled).
export function localDay(ts, tz) {
  const p = partsIn(ts, tz);
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const nextLocal = Date.UTC(p.y, p.m - 1, p.d + 1);
  let next = nextLocal - offsetAt(nextLocal, tz);
  next = nextLocal - offsetAt(next, tz);
  if (next <= ts) next = ts + 1;   // never stall
  return { dow, next };
}
export const isWeekend = (ts, tz) => { const d = localDay(ts, tz).dow; return d === 0 || d === 6; };

// Weekday time (ms) between a and b.
export function weekdayMs(a, b, tz) {
  let t = a, sum = 0;
  for (let i = 0; t < b && i < 5000; i++) {
    const { dow, next } = localDay(t, tz);
    const end = Math.min(next, b);
    if (dow !== 0 && dow !== 6) sum += end - t;
    t = end;
  }
  return sum;
}
// The instant `ms` of weekday time after `from` has been used up. Starting
// on a weekend, the clock starts Monday at midnight.
export function addWeekdayMs(from, ms, tz) {
  let t = from, left = Math.max(0, ms);
  for (let i = 0; i < 5000; i++) {
    const { dow, next } = localDay(t, tz);
    if (dow !== 0 && dow !== 6) {
      if (next - t >= left) return t + left;
      left -= next - t;
    }
    t = next;
  }
  return t + left;
}
