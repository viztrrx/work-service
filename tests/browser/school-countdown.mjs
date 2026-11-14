// The subscription meter counting SCHOOL DAYS, end to end: worker.js in
// workerd and the real console (script.js) injected into a website in Chromium.
//   1. the owner adds a 1-month plan and a weather day (Thu Dec 3); the end
//      date = a month's worth of days spent on school days only, checked
//      against an independent minute-by-minute count with its own calendar
//   2. the subscriber's meter, with the browser clock moved through a weekend,
//      Thanksgiving week, the weather day, winter break, a staff PD day, MLK
//      day and the last day: the big number, "Paused · <why>" and "back <day>"
//   3. the meter fits, nothing cut off, at every panel size
//   4. the owner's card: "N school days left", the calendar, the weather day
// Screenshots go to the folder given as the first argument.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'school-countdown-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const OWNER_CODE = 'owner-code-test-0123456789';
const verifier = (user, pin) => crypto.pbkdf2Sync(`gpa-server|${user.toLowerCase()}|${pin}`, 'gpa-server-salt|' + user.toLowerCase(), 210000, 32, 'sha256').toString('hex');
const TZ = 'America/New_York';
const H = 3600e3, DAY = 24 * H;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---- Independent reference (no code from web/school-days.js) ----
const CLOSED = new Set(('2026-08-04 2026-08-05 2026-08-06 2026-08-07 2026-08-10 2026-09-07 2026-09-21 2026-10-19 2026-11-11 '
  + '2026-11-23 2026-11-24 2026-11-25 2026-11-26 2026-11-27 2026-12-21 2026-12-22 2026-12-23 2026-12-24 2026-12-25 2026-12-28 '
  + '2026-12-29 2026-12-30 2026-12-31 2027-01-01 2027-01-04 2027-01-18 2027-02-15 2027-03-22 2027-03-23 2027-03-24 2027-03-25 '
  + '2027-03-26 2027-03-29 2027-05-28 2027-05-31').split(' '));
const WEATHER = '2026-12-03';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
const parts = (t) => { const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return { key: `${p.year}-${p.month}-${p.day}`, wd: p.weekday, h: +p.hour % 24 }; };
const memo = new Map();
const counts = (t, weather) => {
  const b = Math.floor(t / 900e3) + (weather ? 'w' : '');
  if (memo.has(b)) return memo.get(b);
  const { key, wd } = parts(t);
  let r = wd !== 'Sat' && wd !== 'Sun' && !(weather && key === WEATHER);
  if (r && key >= '2026-08-01' && key <= '2027-07-31') r = key >= '2026-08-11' && key <= '2027-05-27' && !CLOSED.has(key);
  memo.set(b, r); return r;
};
const refLeft = (a, b, weather = true) => { let n = 0; for (let t = a; t < b; t += 60e3) if (counts(t, weather)) n += 60e3; return n; };
const refEnd = (from, ms, weather) => { let t = from, left = ms; while (left > 0) { if (counts(t, weather)) left -= 60e3; t += 60e3; } return t + left; };
const calendarMonth = (from) => { const d = new Date(from); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d.getUTCDate(), last)); return t.getTime(); };
// New York local time → UTC instant (search by the hour; DST-safe).
const ny = (key, hour) => { let t = Date.parse(key + 'T00:00:00Z') - 6 * H; for (let i = 0; i < 30; i++, t += H) { const p = parts(t); if (p.key === key && p.h === hour) return t; } throw new Error('no ' + key + ' ' + hour); };
const shortDay = (t) => new Date(t).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const bigFor = (ms) => ms >= DAY ? String(Math.ceil(ms / DAY)) : (Math.max(1, Math.ceil(ms / 60e3)) >= 60 ? Math.floor(Math.ceil(ms / 60e3) / 60) + 'h' : Math.ceil(ms / 60e3) + 'm');

const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, OWNER_CODE } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const SUB = 'kid' + run;

async function computer({ clockAt, width = 1200 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 2, timezoneId: TZ, locale: 'en-US' });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  if (clockAt) await page.clock.install({ time: clockAt });
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function signIn(page, user, button = '#gpa-signup-btn') {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr(button));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
// Header + meter only, with a caption saying what the browser clock is set to.
async function meterShot(page, file, caption) {
  const b = await R(page, (r) => { const p = r.querySelector('.gpa-panel').getBoundingClientRect(), s = r.querySelector('#gpa-substrip').getBoundingClientRect(); return { x: p.left, y: p.top, width: p.width, bottom: s.bottom }; });
  const CAP = 40;
  await page.evaluate(([c, x, y, w, h]) => {
    let el = document.getElementById('shot-caption');
    if (!el) { el = document.createElement('div'); el.id = 'shot-caption'; document.documentElement.appendChild(el); }
    Object.assign(el.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', zIndex: 2147483647, background: '#f5a524', color: '#111', font: '600 15px/40px system-ui, sans-serif', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' });
    el.textContent = c;
  }, [caption, b.x, b.y - CAP, b.width, CAP]);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: b.x, y: Math.max(0, b.y - CAP), width: b.width, height: b.bottom - b.y + CAP + 10 } });
}
const meter = (page) => R(page, (r) => {
  const s = r.querySelector('#gpa-substrip');
  return { shown: !!s && !s.hidden && !!s.offsetParent, num: r.querySelector('#gpa-substrip-num').textContent, left: r.querySelector('#gpa-substrip-left').textContent, note: r.querySelector('#gpa-substrip-note').textContent,
    pause: r.querySelector('#gpa-substrip-pause').hidden ? '' : r.querySelector('#gpa-substrip-pause').textContent, low: s.classList.contains('is-low'), renew: !r.querySelector('#gpa-substrip-renew').hidden, title: s.title };
});

let sub, owner;
try {
  await admin('/admin/config', { allowlist: { on: true, users: [] } });

  // 1: a 1-month plan from now, then a snow day on Thu Dec 3.
  const added = await admin('/admin/subscriptions', { action: 'add', user: SUB, period: '1m', note: 'Cash' });
  let rec = (added.subscriptions || []).find((x) => x.user === SUB);
  check('The owner adds a 1-month plan (a school-day plan)', !!rec && rec.school === true);
  const budget = calendarMonth(rec.startedAt) - rec.startedAt;
  const noSnow = refEnd(rec.startedAt, budget, false);
  check('Its end = a month’s worth of days (' + budget / DAY + ') spent on school days only (independent count)', Math.abs(rec.expiresAt - noSnow) < 60e3, `ends ${new Date(rec.expiresAt).toLocaleString('en-US', { timeZone: TZ })}; a calendar month would end ${new Date(calendarMonth(rec.startedAt)).toLocaleString('en-US', { timeZone: TZ })}`);
  const snowed = await admin('/admin/subscriptions', { action: 'closed', add: WEATHER });
  rec = snowed.subscriptions.find((x) => x.user === SUB);
  const want = refEnd(rec.startedAt, budget, true);
  check('A weather day (Thu Dec 3) moves the end one school day later', Math.abs(rec.expiresAt - want) < 60e3 && Math.abs(refLeft(noSnow, rec.expiresAt) - DAY) < 2 * 60e3 && snowed.school.closedDays.includes(WEATHER), `now ends ${new Date(rec.expiresAt).toLocaleString('en-US', { timeZone: TZ })}`);

  // The browser-clock timeline (New York time), checked against the reference.
  const steps = [
    ['Sat Nov 14, 12 PM', ny('2026-11-14', 12), 'weekend', '01-weekend.png'],
    ['Mon Nov 16, 9 AM', ny('2026-11-16', 9), '', '02-school-day.png'],
    ['Wed Nov 25 (Thanksgiving week)', ny('2026-11-25', 10), 'holiday', '03-thanksgiving.png'],
    ['Thu Dec 3 (weather day)', ny('2026-12-03', 10), 'weather day', '04-weather-day.png'],
    ['Tue Dec 22 (winter break)', ny('2026-12-22', 13), 'holiday', '05-winter-break.png'],
    ['Mon Jan 4 (staff PD)', ny('2027-01-04', 9), 'no school', '06-staff-pd.png'],
    ['Mon Jan 18 (MLK day)', ny('2027-01-18', 11), 'holiday', '07-mlk-low.png'],
    ['Last day, 3 PM', 0, '', '08-last-day.png']
  ];
  const lastDayKey = parts(rec.expiresAt - 1).key;
  steps[7][1] = ny(lastDayKey, 15);
  if (Date.now() > steps[0][1]) steps.shift();   // run later than Sat noon: start at Monday

  // 2: the subscriber signs in (browser clock: now, running), then the clock moves.
  sub = await computer({ clockAt: Date.now() });
  check('The subscriber signs in', await signIn(sub.page, SUB));
  check('The meter shows under the header', await waitFor(sub.page, (r) => { const s = r.querySelector('#gpa-substrip'); return s && !s.hidden && /left/.test(r.querySelector('#gpa-substrip-left').textContent); }, null, 20000));
  let seenRemind = false;
  for (const [label, t, why, file] of steps) {
    await sub.page.clock.pauseAt(t);
    await sub.page.clock.runFor(61e3);   // the meter refreshes every minute
    const now = t + 61e3;
    const m = await meter(sub.page);
    // The meter refreshes once a minute: it shows the time left at some moment in [t, t + 61 s].
    const leftMs = refLeft(now, rec.expiresAt);
    const big = [bigFor(refLeft(t, rec.expiresAt)), bigFor(leftMs)].includes(m.num) ? m.num : bigFor(leftMs);
    const unitOk = leftMs >= DAY ? m.left === (big === '1' ? 'school day left' : 'school days left') : /left$/.test(m.left);
    check(`${label}: big number ${m.num} “${m.left}” = the reference (${big})`, m.shown && m.num === big && unitOk, JSON.stringify(m));
    if (why) {
      let back = now; do { back += DAY; } while (!counts(ny(parts(back).key, 12), true));
      const backDay = shortDay(ny(parts(back).key, 12));
      check(`${label}: “Paused · ${why}”, back ${backDay}`, m.pause === 'Paused · ' + why && m.note.includes('· back ' + backDay), `${m.pause} | ${m.note}`);
    } else check(`${label}: counting (no pause pill)`, m.pause === '', m.pause);
    const lastDay = shortDay(rec.expiresAt - 1);
    check(`${label}: says when it ends (“Through ${lastDay}” / “Last day today”)`, m.note.startsWith('Through ' + lastDay) || (label.startsWith('Last day') && m.note === 'Last day today'), m.note);
    check(`${label}: ${leftMs <= 3 * DAY ? 'amber (3 school days or less)' : 'not amber'}`, m.low === (leftMs <= 3 * DAY));
    check(`${label}: a Renew button, and the full sentence on hover`, m.renew && /only counts on school days/.test(m.title), m.title);
    // In the last 3 school days the console also asks them (once a day) to renew: tap it away for the picture.
    const remind = await R(sub.page, (r) => { const x = r.querySelector('.gpa-sub-remind'); if (!x) return null; const t = x.textContent.replace(/\s+/g, ' ').trim(); x.querySelector('.gpa-ann-ok').click(); return t; });
    if (leftMs <= 3 * DAY && !seenRemind) { seenRemind = true; check(`${label}: the “Your subscription is ending” reminder pops up once (low on school days)`, !!remind && /Your subscription is ending/.test(remind) && remind.includes('Your access ends after ' + new Date(rec.expiresAt - 1).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' }) + ' (' + bigFor(leftMs) + ' school days left)'), remind || 'none'); }
    else if (leftMs > 3 * DAY) check(`${label}: no reminder yet`, !remind, remind || '');
    await meterShot(sub.page, file, 'Browser clock: ' + label);
  }

  // 3: every panel size: the meter fits and nothing is cut off (last-day state, the longest text).
  for (const size of ['compact', 'normal', 'large', 'xl', 'full', 'center']) {
    await R(sub.page, (r, s) => r.querySelector(`.size-btn[data-size="${s}"]`).click(), size);
    await sub.page.clock.runFor(1500);   // the resize animation runs on (paused) page timers
    await sub.page.waitForTimeout(400);
    const g = await R(sub.page, (r) => {
      const p = r.querySelector('.gpa-panel').getBoundingClientRect(), el = r.querySelector('#gpa-substrip'), b = el.getBoundingClientRect();
      const fit = (q) => { const x = r.querySelector(q); return !x || x.hidden || x.scrollWidth <= x.clientWidth + 1; };
      return { inside: b.left >= p.left - 1 && b.right <= p.right + 1, h: Math.round(b.height), row: fit('.gpa-sub-row'), left: fit('#gpa-substrip-left'), note: fit('#gpa-substrip-note'), num: r.querySelector('#gpa-substrip-num').textContent };
    });
    check(`${size}: the meter fits inside the panel, nothing cut off, one compact line (${g.h}px tall)`, g.inside && g.row && g.left && g.note && g.h <= 64, JSON.stringify(g));
    if (size === 'compact') await meterShot(sub.page, '09-compact-size.png', 'Compact panel size');
  }

  // 4: the owner's Subscribers card.
  owner = await computer();
  const reg = await fetch(env.workerUrl + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-GPA-Owner': OWNER_CODE }, body: JSON.stringify({ user: 'ivan', verifier: verifier('ivan', '246810') }) });
  if (reg.status !== 200 && reg.status !== 409) throw new Error('owner register ' + reg.status);
  check('The owner signs in', await signIn(owner.page, 'ivan', '#gpa-login-btn'));
  await R(owner.page, (r, a) => {
    const n = r.querySelector('.gpa-dropdown-item[data-tab="admin"]'); n.style.display = ''; n.click();
    const f = r.querySelector('#gac-auth-fields');
    if (f && f.offsetParent) {
      const inputs = [...f.querySelectorAll('input')];
      const tok = inputs.find((i) => i.type === 'password') || inputs[0];
      tok.value = a.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
      const urlIn = inputs.find((i) => i !== tok);
      if (urlIn) { urlIn.value = a.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
      r.querySelector('#gac-connect').click();
    }
  }, { token: ADMIN, url: env.workerUrl });
  await owner.page.waitForTimeout(2500);
  await R(owner.page, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
  await waitFor(owner.page, (r) => { const b = r.querySelector('#gac-subs'); return b && !/Loading/.test(b.textContent); });
  const row = await R(owner.page, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u); return el ? el.textContent.replace(/\s+/g, ' ').trim() : null; }, SUB);
  const sdLeft = Math.ceil(refLeft(Date.now(), rec.expiresAt) / DAY);
  check(`Owner: the row says “${sdLeft} school days left”, through ${shortDay(rec.expiresAt - 1).replace(/^\w+, /, '')}`, !!row && row.includes(sdLeft + ' school days left') && row.includes('through ' + shortDay(rec.expiresAt - 1).replace(/^\w+, /, '')), row);
  const school = await R(owner.page, (r) => { const el = r.querySelector('#gac-school'); return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; });
  check('Owner: “School days only” with the calendar and the weather day', /School days only/.test(school) && /2026–27 calendar: Tue, Aug 11 – Thu, May 27/.test(school) && /Weather · Thu, Dec 3/.test(school), school);
  // Remove the weather day from the card: the plan gives the day back.
  await R(owner.page, (r) => r.querySelector('[data-closed-rm="2026-12-03"]').click());
  await waitFor(owner.page, (r) => !r.querySelector('[data-closed-rm="2026-12-03"]'));
  const after = (await admin('/admin/subscriptions', { action: 'list' })).subscriptions.find((x) => x.user === SUB);
  check('Owner: removing the weather day on the card moves the end back', Math.abs(after.expiresAt - noSnow) < 60e3, new Date(after.expiresAt).toLocaleString('en-US', { timeZone: TZ }));
  // …and adding it again with the date box.
  await owner.page.fill(sr('#gac-school-date'), WEATHER);
  await R(owner.page, (r) => r.querySelector('#gac-school-add button[type="submit"]').click());
  await waitFor(owner.page, (r) => !!r.querySelector('[data-closed-rm="2026-12-03"]'));
  const again = (await admin('/admin/subscriptions', { action: 'list' })).subscriptions.find((x) => x.user === SUB);
  check('Owner: adding it on the card moves the end forward again', Math.abs(again.expiresAt - want) < 60e3);
  await R(owner.page, (r) => { r.querySelectorAll('.gpa-spop').forEach((x) => { x.style.display = 'none'; }); r.querySelector('#gac-school').scrollIntoView({ block: 'start' }); });
  await owner.page.waitForTimeout(300);
  const box = await R(owner.page, (r, u) => {
    const card = r.querySelector('#gac-subs-card').getBoundingClientRect(), sc = r.querySelector('#gac-school').getBoundingClientRect();
    return { x: card.left, y: Math.max(0, sc.top - 12), width: card.width, height: Math.min(sc.height + 24, 700) };
  }, SUB);
  await owner.page.screenshot({ path: path.join(OUT, '10-owner-school-days.png'), clip: box });
  await R(owner.page, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u); el.scrollIntoView({ block: 'center' }); }, SUB);
  await owner.page.waitForTimeout(300);
  const box2 = await R(owner.page, (r, u) => { const card = r.querySelector('#gac-subs-card').getBoundingClientRect(), el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).getBoundingClientRect(); return { x: card.left, y: el.top - 8, width: card.width, height: el.height + 16 }; }, SUB);
  await owner.page.screenshot({ path: path.join(OUT, '11-owner-row.png'), clip: box2 });

  for (const [n, p] of [['subscriber', sub], ['owner', owner]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
