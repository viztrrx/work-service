// Weekday-only subscription countdown, end to end: worker.js in workerd and the
// real console (script.js) injected into a website in Chromium.
//   1. the owner adds a 1-month plan: its end date is 31 *weekdays* away,
//      checked against an independent minute-by-minute count
//   2. the subscriber's countdown, with the browser clock moved through a
//      weekend → a working week → the next weekend:
//        - Saturday and Sunday: the same time left, "· paused", a note saying so
//        - Monday 9 AM: exactly 9 hours used; Friday 5 PM: 4 days 8 hours more
//        - the next weekend: frozen again at Friday midnight's value
//   3. the owner's Subscribers card: "N weekdays left"
// Screenshots of each step go to the folder given as the first argument.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'weekday-countdown-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const OWNER_CODE = 'owner-code-test-0123456789';
// The console's server verifier for a name + PIN (script.js serverVerifier).
const verifier = (user, pin) => crypto.pbkdf2Sync(`gpa-server|${user.toLowerCase()}|${pin}`, 'gpa-server-salt|' + user.toLowerCase(), 210000, 32, 'sha256').toString('hex');
const TZ = 'America/New_York';
const H = 3600e3, DAY = 24 * H;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// Independent reference (no code from web/weekdays.js): what weekday is it in New York?
const wdFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
const nyParts = (t) => { const p = Object.fromEntries(wdFmt.formatToParts(new Date(t)).map((x) => [x.type, x.value])); return { wd: p.weekday, h: +p.hour % 24 }; };
const isWkd = (t) => !['Sat', 'Sun'].includes(nyParts(t).wd);
// Weekday minutes from a to b, minute by minute.
const bruteLeft = (a, b) => { let n = 0; for (let t = a; t < b; t += 60e3) if (isWkd(t)) n += 60e3; return n; };
// The instant `ms` of weekday time after `from`, minute by minute.
const bruteEnd = (from, ms) => { let t = from; let left = ms; while (left > 0) { if (isWkd(t)) left -= 60e3; t += 60e3; } return t + left; };
const parseLeft = (s) => { const m = /^(\d+)d (\d+)h left/.exec(s); return m ? (+m[1] * 24 + +m[2]) : NaN; };   // hours
const calendarMonth = (from) => { const d = new Date(from); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(d.getUTCDate(), last)); return t.getTime(); };

const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, OWNER_CODE } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const admin = (p, body) => fetch(env.workerUrl + p, { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const SUB = 'wk' + run;

async function computer({ clockAt } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 }, deviceScaleFactor: 2, timezoneId: TZ, locale: 'en-US' });
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
// The panel lives in a fixed-position shadow root (the host itself is 0×0): clip to it.
// Header + subscription bar only, with the simulated time in a caption above.
async function panelShot(page, file, caption) {
  const b = await R(page, (r) => { const p = r.querySelector('.gpa-panel').getBoundingClientRect(), s = r.querySelector('#gpa-substrip').getBoundingClientRect(); return { x: p.left, y: p.top, width: p.width, bottom: s.bottom }; });
  const CAP = 40;
  await page.evaluate(([c, x, y, w, h]) => {
    let el = document.getElementById('wk-caption');
    if (!el) { el = document.createElement('div'); el.id = 'wk-caption'; document.documentElement.appendChild(el); }
    Object.assign(el.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', zIndex: 2147483647, background: '#f5a524', color: '#111', font: '600 15px/40px system-ui, sans-serif', textAlign: 'center' });
    el.textContent = c;
  }, [caption, b.x, b.y - CAP, b.width, CAP]);
  await page.screenshot({ path: file, clip: { x: b.x, y: Math.max(0, b.y - CAP), width: b.width, height: b.bottom - b.y + CAP + 8 } });
}
const strip = (page) => R(page, (r) => { const s = r.querySelector('#gpa-substrip'); return { shown: !!s && !s.hidden && !!s.offsetParent, left: r.querySelector('#gpa-substrip-left').textContent, note: r.querySelector('#gpa-substrip-note').textContent, pct: r.querySelector('#gpa-substrip-bar').getAttribute('aria-valuenow'), paused: s.classList.contains('is-paused') }; });

let sub, owner;
try {
  await admin('/admin/config', { allowlist: { on: true, users: [] } });

  // 1: the owner adds a 1-month plan, starting now.
  const startedAt = Date.now();
  const added = await admin('/admin/subscriptions', { action: 'add', user: SUB, period: '1m', note: 'Cash' });
  const rec = (added.subscriptions || []).find((x) => x.user === SUB);
  check('The owner adds a 1-month plan', !!rec && rec.weekdays === true, JSON.stringify(rec && { startedAt: rec.startedAt, expiresAt: rec.expiresAt, weekdays: rec.weekdays }));
  const budget = calendarMonth(rec.startedAt) - rec.startedAt;   // a month's worth of days
  const want = bruteEnd(rec.startedAt, budget);
  check('Its end = start + a month’s worth of days counted on weekdays only (minute-by-minute check)', Math.abs(rec.expiresAt - want) < 60e3,
    `${budget / DAY} weekdays; ends ${new Date(rec.expiresAt).toLocaleString('en-US', { timeZone: TZ })} (a calendar month would end ${new Date(calendarMonth(rec.startedAt)).toLocaleString('en-US', { timeZone: TZ })})`);
  check('…which is later than a calendar month (≈ 6 weeks)', rec.expiresAt > calendarMonth(rec.startedAt) && (rec.expiresAt - startedAt) / (7 * DAY) > 5.9, ((rec.expiresAt - startedAt) / (7 * DAY)).toFixed(2) + ' weeks');

  // The timeline: the next Saturday at noon (New York), then on through the week.
  let p1 = Math.ceil((Date.now() + 10 * 60e3) / H) * H;
  while (!(nyParts(p1).wd === 'Sat' && nyParts(p1).h === 12)) p1 += H;
  const steps = [
    ['Sat 12 PM', p1, '01-saturday-paused.png'],
    ['Sun 8 PM', p1 + 32 * H, '02-sunday-still-paused.png'],
    ['Mon 9 AM', p1 + 45 * H, '03-monday-counting.png'],
    ['Fri 5 PM', p1 + 45 * H + 4 * DAY + 8 * H, '04-friday-counting.png'],
    ['Sat 10 AM', p1 + 45 * H + 4 * DAY + 25 * H, '05-next-saturday-paused.png'],
    ['Mon 8 AM', p1 + 45 * H + 4 * DAY + 71 * H, '06-next-monday-resumes.png']
  ];
  for (const [label, t] of steps) {
    const p = nyParts(t);
    if (`${p.wd} ${p.h % 12 || 12} ${p.h < 12 ? 'AM' : 'PM'}` !== label) throw new Error('timeline is off: ' + label + ' ≠ ' + JSON.stringify(p));
  }

  // 2: the subscriber signs in (browser clock: now, running), then the clock moves.
  sub = await computer({ clockAt: Date.now() });
  check('The subscriber signs in', await signIn(sub.page, SUB));
  check('The countdown shows under the header', await waitFor(sub.page, (r) => { const s = r.querySelector('#gpa-substrip'); return s && !s.hidden && /left/.test(r.querySelector('#gpa-substrip-left').textContent); }, null, 20000));
  const seen = {};
  for (const [label, t, file] of steps) {
    await sub.page.clock.pauseAt(t);
    await sub.page.clock.runFor(61e3);   // the strip refreshes every minute
    const s = await strip(sub.page);
    const shownH = parseLeft(s.left);
    const refH = Math.floor(bruteLeft(t + 61e3, rec.expiresAt) / H);
    seen[label] = { ...s, h: shownH };
    const weekend = !isWkd(t);
    check(`${label}: shows ${s.left} — matches an independent weekday count (${refH}h)`, s.shown && shownH === refH, JSON.stringify(s));
    check(`${label}: ${weekend ? 'paused, and says so' : 'counting, not paused'}`, weekend
      ? s.paused && /· paused$/.test(s.left) && /Paused for the weekend: your time only counts down Monday to Friday\./.test(s.note)
      : !s.paused && !/paused/.test(s.left) && /Weekends don’t count\./.test(s.note), s.note);
    await panelShot(sub.page, path.join(OUT, file), 'Browser clock: ' + new Date(t).toLocaleString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' (New York)');
  }
  // Time used between steps, read off the countdown. It shows whole hours
  // (rounded down), so a step can read an hour more or less than it was; the
  // exact values were checked against the reference at every step above.
  const d = (a, b) => seen[a].h - seen[b].h;
  const near = (x, want) => Math.abs(x - want) <= 1;
  check('Saturday noon → Sunday 8 PM (32 hours later): no time used at all', d('Sat 12 PM', 'Sun 8 PM') === 0 && seen['Sat 12 PM'].pct === seen['Sun 8 PM'].pct, `${seen['Sat 12 PM'].left} → ${seen['Sun 8 PM'].left}`);
  check('Sunday 8 PM → Monday 9 AM: 9 hours used (Monday midnight to 9 AM)', near(d('Sun 8 PM', 'Mon 9 AM'), 9), d('Sun 8 PM', 'Mon 9 AM') + 'h');
  check('Monday 9 AM → Friday 5 PM: 4 days 8 hours used', near(d('Mon 9 AM', 'Fri 5 PM'), 4 * 24 + 8), d('Mon 9 AM', 'Fri 5 PM') + 'h');
  check('Friday 5 PM → Saturday 10 AM: only Friday’s last 7 hours used', near(d('Fri 5 PM', 'Sat 10 AM'), 7), d('Fri 5 PM', 'Sat 10 AM') + 'h');
  check('Saturday 10 AM → Monday 8 AM (46 hours later): only 8 hours used', near(d('Sat 10 AM', 'Mon 8 AM'), 8), d('Sat 10 AM', 'Mon 8 AM') + 'h');
  check('A whole weekend frozen: Friday midnight’s value = Saturday’s = 25d 0h', seen['Sat 10 AM'].left === '25d 0h left · paused', seen['Sat 10 AM'].left);
  const calLeftSat = Math.floor((rec.expiresAt - steps[4][1]) / H);
  check('The weekend countdown never shows less than the real time to the end (nobody is cut off early)', seen['Sat 10 AM'].h <= calLeftSat, `${seen['Sat 10 AM'].h}h shown, ${calLeftSat}h of real time`);
  check('The end date shown is the server’s end date', new RegExp(new Date(rec.expiresAt).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })).test(seen['Mon 8 AM'].note), seen['Mon 8 AM'].note);

  // 3: the owner's Subscribers card.
  owner = await computer();
  // The owner's account, registered with the owner code (as the real owner does once).
  const reg = await fetch(env.workerUrl + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-GPA-Owner': OWNER_CODE }, body: JSON.stringify({ user: 'ivan', verifier: verifier('ivan', '246810') }) });
  if (reg.status !== 200 && reg.status !== 409) throw new Error('owner register ' + reg.status + ' ' + await reg.text());
  check('The owner signs in', await signIn(owner.page, 'ivan', '#gpa-login-btn'), await R(owner.page, (r) => r.querySelector('#gpa-login-msg').textContent));
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
  const row = await R(owner.page, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u); if (!el) return null; el.scrollIntoView({ block: 'center' }); return el.textContent.replace(/\s+/g, ' ').trim(); }, SUB);
  const wdLeft = Math.ceil(bruteLeft(Date.now(), rec.expiresAt) / DAY);
  check(`Owner: Admin → Security → Subscribers shows “${wdLeft} weekdays left”`, !!row && row.includes(wdLeft + ' weekdays left'), row);
  await owner.page.waitForTimeout(300);
  // Staff pop-ups (new account / first sign-in) would cover the row: hide them for the picture.
  await R(owner.page, (r) => r.querySelectorAll('.gpa-spop').forEach((x) => { x.style.display = 'none'; }));
  await R(owner.page, (r, u) => { const el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u); el.style.outline = '2px solid #f5a524'; el.style.outlineOffset = '2px'; }, SUB);
  const box = await R(owner.page, (r, u) => {
    const card = r.querySelector('#gac-subs-card').getBoundingClientRect(), el = [...r.querySelectorAll('.gac-subscr')].find((x) => x.dataset.user === u).getBoundingClientRect();
    const top = Math.max(card.top, el.top - 160);
    return { x: card.left, y: top, width: card.width, height: Math.min(card.bottom, el.bottom + 120) - top };
  }, SUB);
  await owner.page.screenshot({ path: path.join(OUT, '07-owner-subscribers-card.png'), clip: box });

  for (const [n, p] of [['subscriber', sub], ['owner', owner]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
