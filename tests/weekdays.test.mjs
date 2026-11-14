// The weekday-only subscription clock (web/weekdays.js and its copy in script.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { weekdayMs, addWeekdayMs, isWeekend, localDay } from '../web/weekdays.js';

const NY = 'America/New_York';
const H = 3600e3, DAY = 24 * H;
const at = (s) => Date.parse(s);

// Independent reference: walk minute by minute and ask Intl what weekday it is.
const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, weekday: 'short' });
function bruteWeekdayMs(a, b) {
  let n = 0;
  for (let t = a; t < b; t += 60e3) { const w = wdFmt.format(new Date(t)); if (w !== 'Sat' && w !== 'Sun') n += 60e3; }
  return n;
}

test('weekdays: a full week is five days; Saturday and Sunday count for nothing', () => {
  // Mon Nov 16 2026 00:00 EST → Mon Nov 23 00:00 EST
  assert.equal(weekdayMs(at('2026-11-16T05:00:00Z'), at('2026-11-23T05:00:00Z'), NY), 5 * DAY);
  // Sat 00:00 → Mon 00:00: zero
  assert.equal(weekdayMs(at('2026-11-14T05:00:00Z'), at('2026-11-16T05:00:00Z'), NY), 0);
  // Fri 6 PM → Mon 6 AM: 6 h Friday + 6 h Monday
  assert.equal(weekdayMs(at('2026-11-13T23:00:00Z'), at('2026-11-16T11:00:00Z'), NY), 12 * H);
  assert.equal(isWeekend(at('2026-11-14T17:00:00Z'), NY), true, 'Sat noon');
  assert.equal(isWeekend(at('2026-11-16T17:00:00Z'), NY), false, 'Mon noon');
  // Saturday midnight in New York is still Friday evening there even though it's Saturday in UTC.
  assert.equal(isWeekend(at('2026-11-14T03:00:00Z'), NY), false, 'Fri 10 PM New York = Sat 3 AM UTC');
});

test('weekdays: the countdown is frozen all weekend and resumes Monday', () => {
  const end = at('2026-11-27T19:30:00Z');
  const fri = weekdayMs(at('2026-11-14T04:59:00Z'), end, NY);   // Fri 11:59 PM
  for (const t of ['2026-11-14T05:00:00Z', '2026-11-14T17:00:00Z', '2026-11-15T12:00:00Z', '2026-11-16T04:59:59Z']) {
    assert.equal(weekdayMs(at(t), end, NY), fri - 60e3, 'no time used on ' + t);
  }
  assert.equal(weekdayMs(at('2026-11-16T06:00:00Z'), end, NY), fri - 60e3 - H, 'Monday 1 AM: one hour used');
});

test('weekdays: starting on a weekend, the clock starts Monday at midnight', () => {
  // Sat Nov 14 noon + 1 h → Mon Nov 16 1 AM EST
  assert.equal(addWeekdayMs(at('2026-11-14T17:00:00Z'), H, NY), at('2026-11-16T06:00:00Z'));
  // Fri 11 PM + 2 h → Mon 1 AM (one hour Friday, one hour Monday)
  assert.equal(addWeekdayMs(at('2026-11-14T04:00:00Z'), 2 * H, NY), at('2026-11-16T06:00:00Z'));
});

test('weekdays: daylight-saving weeks (Mar 8 and Nov 1 2026) are still five 24-hour weekdays', () => {
  assert.equal(weekdayMs(at('2026-03-06T05:00:00Z'), at('2026-03-13T04:00:00Z'), NY), 5 * DAY, 'clocks forward on Sunday Mar 8');
  assert.equal(weekdayMs(at('2026-10-30T04:00:00Z'), at('2026-11-06T05:00:00Z'), NY), 5 * DAY, 'clocks back on Sunday Nov 1');
  const { next } = localDay(at('2026-11-01T12:00:00Z'), NY);   // the 25-hour Sunday
  assert.equal(next, at('2026-11-02T05:00:00Z'));
  assert.equal(localDay(at('2026-03-08T12:00:00Z'), NY).next, at('2026-03-09T04:00:00Z'), 'the 23-hour Sunday');
});

test('weekdays: matches a minute-by-minute count over random spans (incl. both DST changes)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spans = [[at('2026-03-05T00:00:00Z'), 9], [at('2026-10-29T00:00:00Z'), 9]];
  for (let i = 0; i < 14; i++) spans.push([at('2026-01-01T00:00:00Z') + Math.floor(rnd() * 360) * DAY + Math.floor(rnd() * 1440) * 60e3, 1 + Math.floor(rnd() * 8)]);
  for (const [a, days] of spans) {
    const b = a + days * DAY + Math.floor(rnd() * 1440) * 60e3;
    assert.equal(weekdayMs(a, b, NY), bruteWeekdayMs(a, b), new Date(a).toISOString() + ' + ' + days + 'd');
  }
});

test('weekdays: addWeekdayMs is the exact inverse of weekdayMs (2,000 random cases, three time zones)', () => {
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const tz of [NY, 'America/Los_Angeles', 'Asia/Tokyo']) {
    for (let i = 0; i < 700; i++) {
      const from = at('2026-01-01T00:00:00Z') + Math.floor(rnd() * 700 * DAY);
      const ms = Math.floor(rnd() * 400 * DAY);
      const end = addWeekdayMs(from, ms, tz);
      assert.equal(weekdayMs(from, end, tz), ms, `${tz} ${new Date(from).toISOString()} + ${ms}`);
      assert.ok(end >= from + ms, 'never shorter than the calendar');
      assert.equal(isWeekend(end - 1, tz), false, 'the last moment of access is on a weekday');
    }
  }
});

test('weekdays: a month plan is never worse than the calendar, and about 6 weeks long', () => {
  for (let d = 0; d < 7; d++) {
    const from = at('2026-11-16T15:00:00Z') + d * DAY;   // every weekday start
    const end = addWeekdayMs(from, 31 * DAY, NY);
    const weeks = (end - from) / (7 * DAY);
    assert.ok(weeks > 6 && weeks < 6.5, `start +${d}d: ${weeks.toFixed(2)} weeks`);
  }
});

test('weekdays: script.js carries an identical copy of web/weekdays.js (the countdown matches the Worker)', async () => {
  const mod = fs.readFileSync(new URL('../web/weekdays.js', import.meta.url), 'utf8');
  const lib = mod.slice(mod.indexOf('const fmtCache')).replace(/export /g, '').trim();
  const script = fs.readFileSync(new URL('../script.js', import.meta.url), 'utf8');
  const a = script.indexOf('// ---- weekday clock'), b = script.indexOf('// ---- end weekday clock ----');
  assert.ok(a > 0 && b > a, 'markers found in script.js');
  const copy = script.slice(script.indexOf('\n', a) + 1, b).split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n').trim();
  assert.equal(copy, lib);
  // …and it runs the same.
  const client = new Function(copy + '\nreturn { weekdayMs, isWeekend };')();
  for (const [x, y] of [['2026-11-13T23:00:00Z', '2026-11-16T11:00:00Z'], ['2026-10-01T13:30:00Z', '2026-11-13T14:30:00Z']]) {
    assert.equal(client.weekdayMs(at(x), at(y), NY), weekdayMs(at(x), at(y), NY));
  }
});
