// Sign-in help, end to end in the console on a website (computers) against
// worker.js in workerd, with the required student number switched on
// (STUDENT_ID_OPTIONAL=0, as in production):
//   1  kim signs in without a student number on file: a screen she can't
//      close; the notice must stay up 8 s and be ticked; digits only, twice
//   2  kim forgot her PIN: a wrong student number is refused; the right one
//      sets the new PIN at once and signs her in
//   3  lou (no number on file) asks for a new PIN: "check back every 10
//      minutes"; the owner approves in Admin → Security → Sign-in help and
//      lou's waiting screen signs in by itself
//   4  someone tries names that aren't allowed: after 3, the device locks
//      (nothing usable); the owner sees it and unlocks it
//   node tests/browser/signin-help.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'signin-help-out';
fs.mkdirSync(OUT, { recursive: true });
const ADMIN = 'test-admin-token-0123456789abcdef';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, STUDENT_ID_OPTIONAL: '0' } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE); });
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const admin = (p, body) => fetch(env.workerUrl + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const run = Date.now().toString(36).slice(-3);
const KIM = 'kim' + run, LOU = 'lou' + run;
// Student numbers unique to this run (one account per number, and other suites share the local data).
const SID_KIM = String(100000 + Math.floor(Math.random() * 800000)), SID_LOU = String(Number(SID_KIM) + 1);
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);

async function computer() {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}/`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function signIn(page, user, pin, button = '#gpa-login-btn') {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), pin);
  await page.click(sr(button));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
}
const gate = (page) => R(page, (r) => { const g = r.querySelector('.gpa-student-gate'); return { shown: !!g && !g.hidden, text: g ? g.textContent : '' }; });
async function signedOut(page, user) {
  await admin('/admin/user/action', { u: user.toLowerCase(), action: 'revokesessions' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display !== 'none', null, { timeout: 25000 }).catch(() => {});
}
async function forgot(page, user, sid, pin, note) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.click(sr('#gpa-login-forgot'));
  await page.fill(sr('#gpa-forgot-sid'), sid);
  await page.fill(sr('#gpa-forgot-pin'), pin); await page.fill(sr('#gpa-forgot-pin2'), pin);
  if (note) await page.fill(sr('#gpa-forgot-note'), note);
  await page.click(sr('#gpa-forgot-send'));
  await page.waitForTimeout(1500);
}

let kim, lou, owner, stranger;
try {
  await admin('/admin/config', { allowlist: { on: true, users: [KIM, LOU] } });

  // 1: kim's first sign-in: the student-number screen.
  kim = await computer();
  // Injected and signed out: only the sign-in card, centered; the page around it stays usable.
  await kim.page.waitForTimeout(800);
  const look = await kim.page.evaluate(() => {
    const host = document.getElementById('gpa-root-host');
    const r = host.shadowRoot;
    const card = r.querySelector('.gpa-login-card').getBoundingClientRect();
    const panel = r.querySelector('.gpa-panel');
    const hit = document.elementFromPoint(Math.max(5, card.left - 60), card.top + card.height / 2);
    return { cardW: Math.round(card.width), cardCx: Math.round(card.left + card.width / 2), cardCy: Math.round(card.top + card.height / 2), vw: innerWidth, vh: innerHeight,
      panelBg: getComputedStyle(panel).backgroundColor, hitIsPage: !!hit && hit !== host && !host.contains(hit) };
  });
  check('Injected, signed out: only the sign-in card shows, centered on the page; the page around it can still be clicked', look.cardW < 420 && Math.abs(look.cardCx - look.vw / 2) < 4 && Math.abs(look.cardCy - look.vh / 2) < 60 && /rgba\(0, 0, 0, 0\)|transparent/.test(look.panelBg) && look.hitIsPage, JSON.stringify(look));
  await kim.page.screenshot({ path: path.join(OUT, '00-signin-card-only.png') });
  let s = await signIn(kim.page, KIM, '246810', '#gpa-signup-btn');
  check('kim creates her account and gets in', s.inside, JSON.stringify(s));
  const gateUp = await waitFor(kim.page, (r) => { const g = r.querySelector('.gpa-student-gate'); return !!g && !g.hidden; }, null, 20000);
  check('No student number on file: “Add your school student number” covers the console', gateUp && /Add your school student number/.test((await gate(kim.page)).text) && /how you reset your PIN/.test((await gate(kim.page)).text));
  const locked = await R(kim.page, (r) => ({ ok: r.querySelector('#gpa-sg-ok').disabled, a: r.querySelector('#gpa-sg-1').disabled, save: r.querySelector('#gpa-sg-save').disabled, timer: r.querySelector('#gpa-sg-timer').textContent, close: !!r.querySelector('.gpa-student-gate [aria-label="Close"], .gpa-student-gate .gpa-gate-close') }));
  check('It must be read first: the tick box and number boxes stay off for 8 s; no close button', locked.ok && locked.a && locked.save && /you can continue in \d+ s/.test(locked.timer) && !locked.close, JSON.stringify(locked));
  await kim.page.screenshot({ path: path.join(OUT, '01-student-number-gate.png') });
  await kim.page.keyboard.press('Escape');
  check('Escape doesn’t close it, and the console under it can’t be used', (await gate(kim.page)).shown && await R(kim.page, (r) => { const g = r.querySelector('.gpa-student-gate'); const sib = [...g.parentElement.children].filter((c) => c !== g); return sib.length > 0 && sib.every((c) => c.inert || c.classList.contains('gpa-gate')); }));
  await kim.page.waitForFunction(() => !document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-sg-ok').disabled, null, { timeout: 12000 }).catch(() => {});
  await kim.page.check(sr('#gpa-sg-ok'));
  await kim.page.locator(sr('#gpa-sg-1')).pressSequentially('12ab34x567');
  check('Only digits, at most 6', (await kim.page.inputValue(sr('#gpa-sg-1'))) === '123456', await kim.page.inputValue(sr('#gpa-sg-1')));
  await kim.page.fill(sr('#gpa-sg-1'), '');
  await kim.page.locator(sr('#gpa-sg-1')).pressSequentially(SID_KIM);
  await kim.page.locator(sr('#gpa-sg-2')).pressSequentially(SID_KIM.slice(0, 5) + (SID_KIM[5] === '9' ? '8' : '9'));
  check('The two boxes must match', await kim.page.isDisabled(sr('#gpa-sg-save')) && /don’t match/.test(await kim.page.textContent(sr('#gpa-sg-msg'))));
  await kim.page.fill(sr('#gpa-sg-2'), ''); await kim.page.locator(sr('#gpa-sg-2')).pressSequentially(SID_KIM);
  check('…then it shows the full email and Save turns on', !(await kim.page.isDisabled(sr('#gpa-sg-save'))) && (await kim.page.textContent(sr('#gpa-sg-msg'))).includes(SID_KIM + '@alseducation.onmicrosoft.com'));
  await kim.page.screenshot({ path: path.join(OUT, '02-student-number-filled.png') });
  await kim.page.click(sr('#gpa-sg-save'));
  const gateGone = await waitFor(kim.page, (r) => { const g = r.querySelector('.gpa-student-gate'); return !g || g.hidden; }, null, 10000);
  const inside = await kim.page.evaluate(() => { const p = document.getElementById('gpa-root-host').shadowRoot.querySelector('.gpa-panel').getBoundingClientRect(); return { w: Math.round(p.width), h: Math.round(p.height), cx: Math.round(p.left + p.width / 2), cy: Math.round(p.top + p.height / 2), vw: innerWidth, vh: innerHeight }; });
  check('Signed in: a centered window, not the whole screen', inside.w < inside.vw * 0.7 && inside.h < inside.vh * 0.8 && Math.abs(inside.cx - inside.vw / 2) < 4 && Math.abs(inside.cy - inside.vh / 2) < 4, JSON.stringify(inside));
  check('Saved: the screen goes away and the console works again', gateGone, await R(kim.page, (r) => (r.querySelector('#gpa-sg-msg') || {}).textContent || ''));
  check('…and the rest of the console is usable', gateGone && await R(kim.page, (r) => ![...r.children].some((c) => c.inert)));
  const kimAcct = await admin('/admin/signin-help', { action: 'list' });
  check('Saved on her account (shown next to her name for the owner and admins)', (kimAcct.people || []).some((x) => x.user === KIM && x.email === SID_KIM + '@alseducation.onmicrosoft.com'), JSON.stringify(kimAcct.people));

  // 2: kim forgot her PIN.
  await signedOut(kim.page, KIM);
  await forgot(kim.page, KIM, SID_KIM === '000001' ? '000002' : '000001', '864213');
  check('Forgot PIN with the wrong student number: refused', /doesn’t match/.test(await R(kim.page, (r) => r.querySelector('#gpa-login-msg').textContent)), await R(kim.page, (r) => r.querySelector('#gpa-login-msg').textContent));
  await kim.page.fill(sr('#gpa-forgot-sid'), SID_KIM);
  await kim.page.fill(sr('#gpa-forgot-pin'), '864213'); await kim.page.fill(sr('#gpa-forgot-pin2'), '864213');
  await kim.page.screenshot({ path: path.join(OUT, '03-forgot-pin-student-number.png') });
  await kim.page.click(sr('#gpa-forgot-send'));
  const kimIn = await waitFor(kim.page, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 20000);
  check('The right student number: the new PIN works at once and she’s signed in (no approval needed)', kimIn);

  // 3: lou has no number on file (the screen is there; he leaves it), then forgets his PIN.
  lou = await computer();
  s = await signIn(lou.page, LOU, '135790', '#gpa-signup-btn');
  check('lou gets in (and is asked for his student number)', s.inside && await waitFor(lou.page, (r) => { const g = r.querySelector('.gpa-student-gate'); return !!g && !g.hidden; }, null, 20000));
  await signedOut(lou.page, LOU);
  check('Signed out, the student-number screen goes away with the session', !(await gate(lou.page)).shown);
  await forgot(lou.page, LOU, SID_LOU, '112358', 'It’s Lou, 3rd period');
  const waitMsg = await R(lou.page, (r) => ({ wait: !r.querySelector('#gpa-forgot-wait').hidden, text: r.querySelector('#gpa-forgot-status').textContent }));
  check('No number on file: sent to the owner and admins; “Check back every 10 minutes”', waitMsg.wait && /Check back every 10 minutes/.test(waitMsg.text), JSON.stringify(waitMsg));
  await lou.page.screenshot({ path: path.join(OUT, '04-forgot-pin-waiting.png') });

  // The owner: Admin → Security → Sign-in help.
  owner = await computer();
  for (const btn of ['#gpa-signup-btn', '#gpa-login-btn']) {
    if (await R(owner.page, (r) => r.querySelector('#gpa-login').style.display === 'none')) break;
    await signIn(owner.page, 'viztrrx', '246810', btn);
  }
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
  const openHelp = async () => {
    await R(owner.page, (r) => r.querySelector('.gps-tab[data-asec="overview"]').click());
    await owner.page.waitForTimeout(700);
    await R(owner.page, (r) => r.querySelector('.gps-tab[data-asec="security"]').click());
    await waitFor(owner.page, (r) => { const b = r.querySelector('#gac-help'); return b && !/Loading/.test(b.textContent); });
    await R(owner.page, (r) => r.querySelector('#gac-help-card').scrollIntoView({ block: 'start' }));
    await owner.page.waitForTimeout(300);
  };
  await openHelp();
  const reqText = await R(owner.page, (r, u) => { const el = r.querySelector(`.gac-help-req[data-user="${u}"]`); return el ? el.textContent.replace(/\s+/g, ' ') : ''; }, LOU);
  check('Owner: Sign-in help shows lou’s request with the student number he gave and his message; Approve / Deny', reqText.includes(SID_LOU + '@alseducation.onmicrosoft.com') && /It’s Lou, 3rd period/.test(reqText) && /Approve new PIN/.test(reqText), reqText.slice(0, 220));
  await owner.page.locator(sr('#gac-help-card')).screenshot({ path: path.join(OUT, '05-owner-signin-help-request.png') });
  await R(owner.page, (r, u) => { window.confirm = () => true; r.querySelector(`.gac-help-req[data-user="${u}"] [data-help="pinapprove"]`).click(); }, LOU);
  const louIn = await waitFor(lou.page, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 30000);
  check('Approved: lou’s waiting screen signs in by itself', louIn);
  await lou.page.waitForTimeout(2500);
  check('…and the number he gave is saved, so he isn’t asked again', !(await gate(lou.page)).shown);

  // 4: someone without access.
  stranger = await computer();
  for (const n of ['bob' + run, 'rob' + run, 'tim' + run]) {
    await stranger.page.fill(sr('#gpa-login-user'), n);
    await stranger.page.fill(sr('#gpa-login-pin'), '1111');
    await stranger.page.click(sr('#gpa-login-btn'), { timeout: 5000 }).catch(() => {});
    await stranger.page.waitForTimeout(1500);
  }
  const lockUp = await waitFor(stranger.page, (r) => { const l = r.querySelector('.gpa-device-lock'); return !!l && !l.hidden; }, null, 10000);
  check('Three names that aren’t allowed: “This device is locked” covers everything', lockUp && /This device is locked/.test(await R(stranger.page, (r) => r.querySelector('.gpa-device-lock').textContent)) && /until .+ \(the end of the school day session\)/.test(await R(stranger.page, (r) => r.querySelector('.gpa-device-lock').textContent)));
  const typed = await stranger.page.fill(sr('#gpa-login-user'), 'again', { timeout: 2000 }).then(() => 'typed', () => 'blocked');
  check('…nothing under it can be used (fields off, the console under it inert)', typed === 'blocked' && await R(stranger.page, (r) => !!r.querySelector('#gpa-login-user').closest('[inert]') && r.querySelector('#gpa-login-user').disabled && r.querySelector('#gpa-login-btn').disabled), typed);
  await stranger.page.screenshot({ path: path.join(OUT, '06-device-locked.png') });
  await stranger.page.reload();
  await stranger.page.evaluate((c) => { (0, eval)(c); }, code);
  await stranger.page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  check('Reloading doesn’t get around it', await waitFor(stranger.page, (r) => { const l = r.querySelector('.gpa-device-lock'); return !!l && !l.hidden; }, null, 10000));
  await openHelp();
  const lockText = await R(owner.page, (r) => { const el = r.querySelector('.gac-help-lock'); return el ? el.textContent.replace(/\s+/g, ' ') : ''; });
  check('Owner: Sign-in help lists the locked device, the names tried, until 12:00 PM; Approve (unlock) / Keep locked', /bob/.test(lockText) && /tim/.test(lockText) && /Approve \(unlock\)/.test(lockText) && /Keep locked until the session ends/.test(lockText), lockText.slice(0, 240));
  await owner.page.locator(sr('#gac-help-card')).screenshot({ path: path.join(OUT, '07-owner-locked-device.png') });
  await R(owner.page, (r) => { window.confirm = () => true; r.querySelector('.gac-help-lock [data-help="unlock"]').click(); });
  const unlocked = await waitFor(stranger.page, (r) => { const l = r.querySelector('.gpa-device-lock'); return !l || l.hidden; }, null, 40000);
  check('Unlocked by the owner: the lock lifts on that device within 30 s', unlocked && await R(stranger.page, (r) => !r.querySelector('#gpa-login-user').closest('[inert]') && !r.querySelector('#gpa-login-user').disabled));
  const logText = await R(owner.page, (r) => r.querySelector('.gac-help-log') ? r.querySelector('.gac-help-log').textContent : '');
  check('The log has it all (student number saved, new PIN by student number, request, approval, lock, unlock)', ['Student number saved', 'New PIN (student number matched)', 'Forgot PIN (waiting)', 'New PIN approved', 'Device locked', 'Device unlocked'].every((t) => logText.includes(t)), logText.slice(0, 300));
  await R(owner.page, (r) => { const d = r.querySelectorAll('.gac-help-fold'); d.forEach((x) => { x.open = true; }); });
  await owner.page.waitForTimeout(300);
  await owner.page.locator(sr('#gac-help-card')).screenshot({ path: path.join(OUT, '08-owner-people-and-log.png') });
  // 5: no way around the approved list through the planet icon (create account).
  const sneak = await computer();
  await sneak.page.fill(sr('#gpa-login-user'), 'sneaky' + run);
  await sneak.page.fill(sr('#gpa-login-pin'), '9753');
  await sneak.page.click(sr('#gpa-signup-btn'));
  await sneak.page.waitForTimeout(2000);
  let st = await R(sneak.page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
  check('The planet icon (create account) with a name that isn’t approved: refused', !st.inside && /Unable to create account/.test(st.msg), JSON.stringify(st));
  // Blocking the server doesn't help: no answer is never a "yes".
  await sneak.page.route(env.workerUrl + '/**', (route) => route.abort());
  await sneak.page.fill(sr('#gpa-login-user'), KIM);
  await sneak.page.fill(sr('#gpa-login-pin'), '1111');
  await sneak.page.click(sr('#gpa-signup-btn'));
  await sneak.page.waitForTimeout(7500);
  st = await R(sneak.page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
  check('With the server blocked, creating an account (even with an approved name) is refused: “Can’t reach the server”', !st.inside && /Can’t reach the Saints Service server/.test(st.msg), JSON.stringify(st));
  await sneak.page.click(sr('#gpa-login-btn'));
  await sneak.page.waitForTimeout(7500);
  st = await R(sneak.page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
  check('…and so is signing in', !st.inside && /Can’t reach the Saints Service server/.test(st.msg), JSON.stringify(st));
  await sneak.page.unroute(env.workerUrl + '/**');
  // A faked saved sign-in (browser storage) doesn't open the console on reload.
  await sneak.page.evaluate((u) => { localStorage.setItem('gpa_profile_' + u, JSON.stringify({ user: u, pinHash: 'x', data: {}, updatedAt: Date.now() })); localStorage.setItem('gpa_session_user', u); }, 'faker' + run);
  await sneak.page.reload();
  await sneak.page.evaluate((c) => { (0, eval)(c); }, code);
  await sneak.page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await sneak.page.waitForTimeout(3500);
  st = await R(sneak.page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
  check('A faked saved sign-in for a name that isn’t approved: stays on the sign-in screen', !st.inside, JSON.stringify(st));
  // …nor does a real approved name's saved sign-in without its server session.
  await sneak.page.evaluate((u) => { localStorage.setItem('gpa_profile_' + u.toLowerCase(), JSON.stringify({ user: u, pinHash: 'x', data: {}, updatedAt: Date.now() })); localStorage.setItem('gpa_session_user', u); localStorage.removeItem('gpa_session_token'); }, KIM);
  await sneak.page.reload();
  await sneak.page.evaluate((c) => { (0, eval)(c); }, code);
  await sneak.page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await sneak.page.waitForTimeout(3500);
  st = await R(sneak.page, (r) => ({ inside: r.querySelector('#gpa-login').style.display === 'none', msg: r.querySelector('#gpa-login-msg').textContent }));
  check('A faked saved sign-in for an approved name (no valid session): “Sign in again with your PIN”', !st.inside && /Sign in again with your PIN/.test(st.msg), JSON.stringify(st));
  await sneak.page.screenshot({ path: path.join(OUT, '09-no-way-around.png') });
  // A real saved sign-in still comes back on reload.
  await kim.page.reload();
  await kim.page.evaluate((c) => { (0, eval)(c); }, code);
  await kim.page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  const kimBack = await waitFor(kim.page, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 15000);
  check('A real signed-in person reloading the page is still signed in (after the server check)', kimBack);
  check('No page errors (sneaky)', sneak.page._errors.length === 0, sneak.page._errors.slice(0, 2).join(' | '));
  for (const [n, p] of [['kim', kim], ['lou', lou], ['owner', owner], ['stranger', stranger]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
} finally {
  await admin('/admin/config', { allowlist: { on: false, users: [] } }).catch(() => {});
  await browser.close();
  await env.close();
  await site.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
