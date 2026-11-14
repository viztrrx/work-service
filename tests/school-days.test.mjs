// The school-day subscription clock (web/school-days.js and its copy in script.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCHOOL_CALENDARS, dayOff, offReason, schoolMs, addSchoolMs, nextSchoolDay, localDay } from '../web/school-days.js';

const NY = 'America/New_York';
const H = 3600e3, DAY = 24 * H;
const at = (s) => Date.parse(s);

// ---- An independent reference, written separately from the module ----
// The closed days, typed again from the calendar picture (holidays + staff PD).
const CLOSED = new Set(('2026-08-04 2026-08-05 2026-08-06 2026-08-07 2026-08-10 2026-09-07 2026-09-21 2026-10-19 2026-11-11 '
  + '2026-11-23 2026-11-24 2026-11-25 2026-11-26 2026-11-27 2026-12-21 2026-12-22 2026-12-23 2026-12-24 2026-12-25 2026-12-28 '
  + '2026-12-29 2026-12-30 2026-12-31 2027-01-01 2027-01-04 2027-01-18 2027-02-15 2027-03-22 2027-03-23 2027-03-24 2027-03-25 '
  + '2027-03-26 2027-03-29 2027-05-28 2027-05-31').split(' '));
const refFmt = new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
function refCounts(t, extra = []) {
  const p = Object.fromEntries(refFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const key = `${p.year}-${p.month}-${p.day}`;
  if (p.weekday === 'Sat' || p.weekday === 'Sun' || extra.includes(key)) return false;
  if (key >= '2026-08-01' && key <= '2027-07-31') return key >= '2026-08-11' && key <= '2027-05-27' && !CLOSED.has(key);
  return true;   // no calendar: weekdays
}
const refMs = (a, b, extra) => { let n = 0; for (let t = a; t < b; t += 60e3) if (refCounts(t, extra)) n += 60e3; return n; };
const keyDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

test('school days: the 2026–27 calendar has exactly 180 school days (Aug 11 → May 27)', () => {
  let n = 0, first = null, last = null;
  for (let t = Date.UTC(2026, 7, 1); t <= Date.UTC(2027, 6, 31); t += DAY) {
    const k = new Date(t).toISOString().slice(0, 10);
    if (!dayOff(k, keyDay(k))) { n++; first = first || k; last = k; }
  }
  assert.equal(n, 180);
  assert.deepEqual([first, last], ['2026-08-11', '2027-05-27']);
  // The calendar in the module is the one typed again above.
  assert.deepEqual(Object.keys(SCHOOL_CALENDARS[0].closed).sort(), [...CLOSED].sort());
  for (const k of CLOSED) assert.ok(keyDay(k) >= 1 && keyDay(k) <= 5, k + ' is a weekday');
});

test('school days: why a day doesn’t count', () => {
  const why = (k, extra) => dayOff(k, keyDay(k), extra);
  assert.equal(why('2026-11-14'), 'weekend');
  assert.equal(why('2026-11-16'), '', 'an ordinary Monday');
  assert.equal(why('2026-11-25'), 'holiday', 'Thanksgiving week');
  assert.equal(why('2026-10-19'), 'pd', 'staff PD');
  assert.equal(why('2026-08-10'), 'pd');
  assert.equal(why('2026-08-03'), 'summer', 'before the first day');
  assert.equal(why('2026-08-11'), '', 'the first day counts');
  assert.equal(why('2027-05-27'), '', 'the last day counts');
  assert.equal(why('2027-06-15'), 'summer');
  assert.equal(why('2027-08-02'), '', 'no calendar for 2027–28 yet: weekdays');
  assert.equal(why('2026-12-03', ['2026-12-03']), 'weather', 'an owner-added weather day');
  assert.equal(why('2026-12-03', new Set(['2026-12-03'])), 'weather');
  // offReason works in New York time: Friday 10 PM there is Saturday in UTC.
  assert.equal(offReason(at('2026-11-14T03:00:00Z'), NY), '', 'Fri Nov 13, 10 PM New York');
  assert.equal(offReason(at('2026-11-14T05:00:00Z'), NY), 'weekend');
});

test('school days: Thanksgiving week, winter break and spring break stand still', () => {
  // Fri Nov 20 midnight → Tue Dec 1 midnight: only Mon Nov 30 counts.
  assert.equal(schoolMs(at('2026-11-21T05:00:00Z'), at('2026-12-01T05:00:00Z'), NY), DAY);
  // Winter break: Sat Dec 19 → Tue Jan 5 (Jan 1 holiday, Jan 4 PD): nothing.
  assert.equal(schoolMs(at('2026-12-19T05:00:00Z'), at('2027-01-05T05:00:00Z'), NY), 0);
  assert.equal(nextSchoolDay(at('2026-12-21T17:00:00Z'), NY), at('2027-01-05T05:00:00Z'), 'back Tue Jan 5');
  // Spring break Mar 22–26 + PD Mar 29: Sat Mar 20 → Tue Mar 30 is nothing.
  assert.equal(schoolMs(at('2027-03-20T04:00:00Z'), at('2027-03-30T04:00:00Z'), NY), 0);
  assert.equal(nextSchoolDay(at('2027-03-24T16:00:00Z'), NY), at('2027-03-30T04:00:00Z'));
});

test('school days: a week bought at the end of May waits out the summer', () => {
  // Mon May 24 2027 10 AM: May 24–27 use 3d 14h, then summer, then (no
  // 2027–28 calendar yet) weekdays from Mon Aug 2: 3 days + 10 h → Thu Aug 5 10 AM.
  const from = at('2027-05-24T14:00:00Z');
  const end = addSchoolMs(from, 7 * DAY, NY);
  assert.equal(new Date(end).toISOString(), '2027-08-05T14:00:00.000Z');
  assert.equal(refMs(from, end), 7 * DAY, 'the reference agrees');
});

test('school days: starting on a day off, the clock starts the next school day at midnight', () => {
  assert.equal(addSchoolMs(at('2026-11-25T17:00:00Z'), H, NY), at('2026-11-30T06:00:00Z'), 'Wed of Thanksgiving week + 1 h = Mon Nov 30, 1 AM');
  assert.equal(addSchoolMs(at('2026-11-14T17:00:00Z'), H, NY), at('2026-11-16T06:00:00Z'), 'Saturday + 1 h = Monday 1 AM');
});

test('school days: matches the independent minute-by-minute count over random spans (both DST changes, breaks, weather days)', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const extra = ['2026-12-03', '2027-02-10'];
  const spans = [[at('2026-11-19T15:07:00Z'), 12], [at('2026-12-17T09:00:00Z'), 20], [at('2027-03-05T00:00:00Z'), 9], [at('2026-10-29T00:00:00Z'), 9],
    [at('2027-05-20T13:00:00Z'), 16], [at('2026-08-06T10:00:00Z'), 9], [at('2026-12-01T12:00:00Z'), 4], [at('2027-02-08T12:00:00Z'), 4]];
  for (let i = 0; i < 12; i++) spans.push([at('2026-07-15T00:00:00Z') + Math.floor(rnd() * 400) * DAY + Math.floor(rnd() * 1440) * 60e3, 1 + Math.floor(rnd() * 8)]);
  for (const [a, days] of spans) {
    const b = a + days * DAY + Math.floor(rnd() * 1440) * 60e3;
    assert.equal(schoolMs(a, b, NY, extra), refMs(a, b, extra), new Date(a).toISOString() + ' + ' + days + 'd');
  }
});

test('school days: addSchoolMs is the exact inverse of schoolMs (2,100 random cases, three time zones, weather days)', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const extra = new Set(['2026-12-03', '2027-02-10', '2027-04-14']);
  for (const tz of [NY, 'America/Los_Angeles', 'Asia/Tokyo']) {
    for (let i = 0; i < 700; i++) {
      const from = at('2026-06-01T00:00:00Z') + Math.floor(rnd() * 600 * DAY);
      const ms = Math.floor(rnd() * 120 * DAY);
      const end = addSchoolMs(from, ms, tz, extra);
      assert.equal(schoolMs(from, end, tz, extra), ms, `${tz} ${new Date(from).toISOString()} + ${ms}`);
      assert.ok(end >= from + ms, 'never shorter than the calendar');
      if (ms > 0) assert.equal(offReason(end - 1, tz, extra), '', 'the last moment of access is on a school day');
    }
  }
});

test('school days: a weather day moves a plan’s end by exactly one school day', () => {
  const from = at('2026-11-30T14:00:00Z'), ms = 10 * DAY;
  const a = addSchoolMs(from, ms, NY), b = addSchoolMs(from, ms, NY, ['2026-12-03']);
  assert.equal(schoolMs(a, b, NY), DAY, 'one more school day');
  assert.equal(localDay(b, NY).key > localDay(a, NY).key, true);
});

test('school days: script.js carries an identical copy of web/school-days.js (the countdown matches the Worker)', () => {
  const mod = fs.readFileSync(new URL('../web/school-days.js', import.meta.url), 'utf8');
  const lib = mod.slice(mod.indexOf('// 2026–27 school calendar'), mod.indexOf('// ---- end of the copied block ----')).trim();
  const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  const a = script.indexOf('// ---- school-day clock'), b = script.indexOf('// ---- end school-day clock ----');
  assert.ok(a > 0 && b > a, 'markers found in script.js');
  const copy = script.slice(script.indexOf('\n', a) + 1, b).split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n').trim();
  assert.equal(copy, lib);
  const client = new Function(copy + '\nreturn { schoolMs, offReason };')();
  for (const [x, y] of [['2026-11-19T15:07:00Z', '2026-12-02T11:00:00Z'], ['2026-12-17T09:00:00Z', '2027-01-08T14:30:00Z']]) {
    assert.equal(client.schoolMs(at(x), at(y), NY, ['2026-12-03']), schoolMs(at(x), at(y), NY, ['2026-12-03']));
  }
});
