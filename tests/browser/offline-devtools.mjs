// The offline file's built-in dev tools: Eruda behind the ⋮ in the console's
// header. The file is downloaded from worker.js (in workerd) exactly as a
// user gets it, built from this working copy's script.js, and opened from disk:
//   1. the download carries Eruda; the ⋮ is the header's right-most button
//      and Eruda's own floating gear is hidden
//   2. ⋮ opens it; its Console already has what was logged before
//   3. JavaScript typed in its Console runs on the page (Execute)
//   4. ⋮ closes it again
//   5. with the console fullscreen, the dev tools still show (they live in
//      the panel, which is what goes fullscreen)
//   6. phone width: the ⋮ still fits in the header
//   node tests/browser/offline-devtools.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = path.resolve(process.argv[2] || 'offline-devtools-out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const ADMIN = 'test-admin-token-0123456789abcdef';
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN, CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const W = env.workerUrl;
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 10000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
// Eruda's shadow root (it attaches to the host element the console gives it).
const DEV = (r) => r.querySelector('.gpa-devtools-host').shadowRoot;
const devState = (page) => R(page, (r, dev) => {
  const d = (0, eval)(dev)(r);
  const tools = d.querySelector('.eruda-dev-tools');
  const gear = d.querySelector('.eruda-entry-btn');
  const box = tools.getBoundingClientRect();
  const shown = getComputedStyle(tools).display !== 'none' && box.height > 50;
  // What's really on screen in the middle of the dev tools (fullscreen included).
  const hit = shown ? r.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
  return { shown, onTop: !!hit && hit.classList.contains('gpa-devtools-host'), gear: !!gear && getComputedStyle(gear).display !== 'none', pressed: r.querySelector('#gpa-devtools').getAttribute('aria-pressed'), logs: (d.querySelector('.eruda-console .eruda-logs-container') || {}).innerText || '' };
}, String(DEV));
const run = Date.now().toString(36).slice(-4);

try {
  await fetch(W + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });
  const html = await (await fetch(W + '/download/saints-service.html')).text();
  const file = path.join(OUT, 'saints-service.html');
  fs.writeFileSync(file, html);
  check('The file downloaded from the Worker carries Eruda, loaded before the console', html.indexOf('id="saints-devtools-code"') > 0 && html.indexOf('id="saints-devtools-code"') < html.indexOf('id="saints-service-code"'), (html.length / 1048576).toFixed(1) + ' MB');

  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  await pg.goto(pathToFileURL(file).href);
  await pg.waitForFunction(() => !!document.getElementById('gpa-root-host') && !document.getElementById('boot'), null, { timeout: 20000 });
  await pg.fill(sr('#gpa-login-user'), 'dev' + run);
  await pg.fill(sr('#gpa-login-pin'), '246810');
  await pg.click(sr('#gpa-signup-btn'));
  await waitFor(pg, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 15000);
  await R(pg, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await pg.waitForTimeout(800);

  // ---- 1 ----
  const hdr = await R(pg, (r) => {
    const btns = [...r.querySelectorAll('.gpa-header button')].filter((b) => b.offsetParent);
    const last = btns.sort((a, b) => a.getBoundingClientRect().right - b.getBoundingClientRect().right).pop();
    const box = r.querySelector('#gpa-devtools').getBoundingClientRect();
    return { last: last && last.id, right: Math.round(innerWidth - box.right), top: Math.round(box.top), label: r.querySelector('#gpa-devtools').getAttribute('aria-label') };
  });
  check('The ⋮ (Developer tools) is the right-most button in the header, top right', hdr.last === 'gpa-devtools' && hdr.right < 30 && hdr.top < 20 && hdr.label === 'Developer tools', JSON.stringify(hdr));
  let st = await devState(pg);
  check('…Eruda starts closed, without its floating gear', !st.shown && !st.gear && st.pressed === 'false', JSON.stringify({ ...st, logs: undefined }));

  // ---- 2 ----
  await pg.evaluate((m) => console.log(m), 'logged before opening ' + run);
  await pg.click(sr('#gpa-devtools'));
  await pg.waitForTimeout(600);
  st = await devState(pg);
  check('Pressing ⋮ opens the dev tools over the console', st.shown && st.onTop && st.pressed === 'true', JSON.stringify({ ...st, logs: undefined }));
  check('…its Console has what was logged before it opened', st.logs.includes('logged before opening ' + run), st.logs.slice(0, 200));
  await pg.screenshot({ path: path.join(OUT, '01-devtools.png') });

  // ---- 3 ----
  await pg.click(sr('.gpa-devtools-host >> .eruda-js-input'));
  await pg.waitForTimeout(200);
  await pg.keyboard.type('document.title + " " + (6 * 7)');
  // Eruda's input is multi-line (Enter is a new line); Execute runs it.
  await pg.click(sr('.gpa-devtools-host >> .eruda-execute'));
  const ran = await waitFor(pg, (r, dev) => /about:blank 42/.test(((0, eval)(dev)(r).querySelector('.eruda-logs-container') || {}).innerText || ''), String(DEV), 5000);
  check('JavaScript typed in its Console runs on the page', ran, (await devState(pg)).logs.slice(-200));
  check('…typing there didn\'t leak into the console underneath (still on the same tab, nothing collapsed)', await R(pg, (r) => r.querySelector('.gpa-pane.active') && r.querySelector('#gpa-body') && getComputedStyle(r.querySelector('#gpa-body')).display !== 'none'));

  // ---- 4 ----
  await pg.click(sr('#gpa-devtools'));
  await pg.waitForTimeout(600);
  st = await devState(pg);
  check('Pressing ⋮ again closes them', !st.shown && st.pressed === 'false' && !st.gear, JSON.stringify({ ...st, logs: undefined }));

  // ---- 5 ----
  await pg.click(sr('#gpa-console-fullscreen'));
  const fsOn = await waitFor(pg, (r) => !!r.fullscreenElement, null, 5000);
  await pg.click(sr('#gpa-devtools'));
  await pg.waitForTimeout(600);
  st = await devState(pg);
  check('With the console fullscreen, ⋮ still opens the dev tools on top', fsOn && st.shown && st.onTop, JSON.stringify({ fsOn, ...st, logs: undefined }));
  await pg.screenshot({ path: path.join(OUT, '02-fullscreen.png') });
  await pg.click(sr('#gpa-devtools'));
  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---- 6 ----
  const phone = await browser.newContext({ viewport: { width: 375, height: 760 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(pathToFileURL(file).href);
  await pp.waitForFunction(() => !!document.getElementById('gpa-root-host') && !document.getElementById('boot'), null, { timeout: 20000 });
  await pp.fill(sr('#gpa-login-user'), 'dvp' + run);
  await pp.fill(sr('#gpa-login-pin'), '246810');
  await pp.click(sr('#gpa-signup-btn'));
  await waitFor(pp, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 15000);
  await R(pp, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await pp.waitForTimeout(600);
  const pbox = await R(pp, (r) => { const b = r.querySelector('#gpa-devtools').getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), vw: innerWidth, shown: !!r.querySelector('#gpa-devtools').offsetParent }; });
  check('Phone width: the ⋮ is in the header, inside the screen', pbox.shown && pbox.right <= pbox.vw && pbox.w >= 26, JSON.stringify(pbox));
  await pp.tap(sr('#gpa-devtools'));
  await pp.waitForTimeout(600);
  st = await devState(pp);
  check('…and tapping it opens the dev tools', st.shown && st.onTop, JSON.stringify({ ...st, logs: undefined }));
  await pp.screenshot({ path: path.join(OUT, '03-phone.png') });
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
