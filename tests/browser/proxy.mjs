// The Proxy tab against the REAL saints-proxy-test Worker (proxy-worker/,
// run locally in workerd by wrangler), next to the main Worker, in the
// console injected on a website:
//   1. the tab is where it was (Proxy → Eaglercraft → Games) and opens the
//      Worker's connection test in its frame
//   2. the address bar maps the approved site to /site/… (this container has
//      no internet, so the Worker answers its own "couldn't reach" page)
//   3. other sites get an explanation, the frame keeps its page
//   4. a Worker that's down, or answering errors, shows a clear error + Retry
//   5. a website whose CSP forbids framing it: "Blocked" + Open in a new tab
//   6. switching tabs keeps the same frame and page; reload/home work
//   7. the default address is the deployed Worker; old localhost:4141 moves
//   8. themes and phone width
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'proxy-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const req = createRequire(path.join(ROOT, 'package.json'));
const { devices } = req('playwright');
const DEPLOYED = 'https://saints-proxy-test.viztrrx.workers.dev';

// The real proxy Worker. Its wrangler.jsonc date (2026-10-19) is newer than
// this repo's local workerd supports, so only the local run uses an older one.
const { unstable_dev } = await import(pathToFileURL(req.resolve('wrangler')).href);
const pw = await unstable_dev(path.join(ROOT, 'proxy-worker/index.js'), { config: path.join(ROOT, 'proxy-worker/wrangler.jsonc'), ip: '127.0.0.1', port: 0, local: true, compatibilityDate: '2026-10-01', logLevel: 'none', experimental: { disableExperimentalWarning: true } });
const PROXY = `http://${pw.address}:${pw.port}`;
// A Worker that answers but is broken (health 500), and an address nothing listens on.
const broken = await serve((rq, rs) => {
  if (rq.url.startsWith('/health')) { rs.setHeader('Content-Type', 'application/json'); rs.setHeader('Access-Control-Allow-Origin', '*'); rs.statusCode = 500; rs.end('{"status":"misconfigured"}'); return; }
  rs.setHeader('Content-Type', 'text/html'); rs.end('<p>broken worker</p>');
});
const deadPort = await (async () => { const s = await serve((q, r) => r.end('')); const p = s.port; await s.close(); return p; })();

const env = await startEnv({});
const site = await serve((rq, rs) => {
  rs.setHeader('Content-Type', 'text/html');
  // /strict: a website whose CSP forbids framing other sites (but allows connections).
  if (rq.url.startsWith('/strict')) rs.setHeader('Content-Security-Policy', "frame-src 'self'");
  rs.end(HOST_PAGE.replace('Some ordinary page', rq.url.startsWith('/strict') ? 'A strict website' : 'A school website'));
});
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);

async function computer({ server, pathName = '/', phone = false } = {}) {
  const ctx = await browser.newContext(phone ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1200, height: 860 } });
  await ctx.addInitScript(([u, s]) => {
    try {
      localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1');
      if (s === null) localStorage.removeItem('gpa_proxy_server_url'); else localStorage.setItem('gpa_proxy_server_url', s);
    } catch (e) { /* ignore */ }
  }, [env.workerUrl, server === undefined ? null : server]);
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}${pathName}`);
  await page.evaluate((c) => { (0, eval)(c); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx, page };
}
async function signIn(page, user) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForTimeout(2500);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const tab = (page, t) => R(page, (r, x) => { const n = r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`); n.style.display = ''; n.click(); }, t);
const state = (page) => R(page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), status: r.querySelector('#gpa-proxy-status').textContent, error: r.querySelector('#gpa-proxy-error').style.display === 'none' ? '' : r.querySelector('#gpa-proxy-error').textContent, proxy: r.querySelector('.gpa-pane[data-pane="browser"] .gpx-room').dataset.proxy || '', addr: r.querySelector('#gpa-proxy-url').value }));
const frameText = async (page, prefix) => { const f = page.frames().find((x) => x.url().startsWith(prefix)); return f ? (await f.textContent('body').catch(() => '')).replace(/\s+/g, ' ').trim() : ''; };

let a, b, c, d, e;
try {
  // 1: the tab, in its place, opens the Worker's connection test.
  a = await computer({ server: PROXY });
  check('signs in', await signIn(a.page, 'px' + run));
  const order = await R(a.page, (r) => [...r.querySelectorAll('.gpa-dropdown-item[data-tab]')].map((x) => x.dataset.tab));
  const i = order.indexOf('browser');
  check('One Proxy tab, still followed by Eaglercraft then Games', order.filter((x) => x === 'browser').length === 1 && order[i + 1] === 'eaglercraft' && order[i + 2] === 'games', order.join(','));
  await tab(a.page, 'browser');
  await waitFor(a.page, (r) => /Connected/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  let st = await state(a.page);
  check('Opening Proxy loads the Worker’s /preview in the frame: “Connected · connection test”', st.src === PROXY + '/preview' && /Connected · connection test/.test(st.status) && st.proxy === 'connected' && !st.error, JSON.stringify(st));
  check('…and the frame really shows the Worker’s page (“Cloudflare Worker connected”)', /Cloudflare Worker connected/.test(await frameText(a.page, PROXY + '/preview')));
  check('The address bar suggests the approved site', /Try example\.com/.test(await R(a.page, (r) => r.querySelector('#gpa-proxy-url').placeholder)));
  const attrs = await R(a.page, (r) => { const f = r.querySelector('#gpa-proxy-frame'); return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), ref: f.getAttribute('referrerpolicy') }; });
  check('The frame is sandboxed without top-navigation, no camera/mic/location, no referrer', !/allow-top-navigation/.test(attrs.sandbox) && /allow-scripts/.test(attrs.sandbox) && !/camera|microphone|geolocation/.test(attrs.allow) && attrs.ref === 'no-referrer', JSON.stringify(attrs));
  await a.page.screenshot({ path: path.join(OUT, '01-proxy-connected.png') });

  // 2: the approved site, through /site/.
  await a.page.fill(sr('#gpa-proxy-url'), 'example.com/hello?x=1');
  await a.page.click(sr('#gpa-proxy-go'));
  await waitFor(a.page, (r) => /Loaded|failed/i.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(a.page);
  check('Go with “example.com/hello?x=1”: the frame goes to the Worker’s /site/hello?x=1, the bar shows the real address', st.src === PROXY + '/site/hello?x=1' && st.addr === 'https://example.com/hello?x=1' && /Loaded · https:\/\/example\.com\/hello\?x=1/.test(st.status), JSON.stringify(st));
  check('…the Worker answers (here, with no internet, its own readable “Couldn’t reach the destination” page)', /Couldn.t reach the destination/.test(await frameText(a.page, PROXY + '/site/')));
  await a.page.screenshot({ path: path.join(OUT, '02-approved-site.png') });

  // 3: anything else is explained, and the frame keeps its page.
  await a.page.fill(sr('#gpa-proxy-url'), 'google.com');
  await a.page.click(sr('#gpa-proxy-go'));
  await a.page.waitForTimeout(400);
  st = await state(a.page);
  check('“google.com”: explained (“only opens example.com … isn’t supported”), frame unchanged', /only opens example\.com/.test(st.error) && /google\.com.*isn’t supported/.test(st.error) && st.src === PROXY + '/site/hello?x=1', JSON.stringify(st));
  await a.page.screenshot({ path: path.join(OUT, '03-unsupported.png') });
  await R(a.page, (r) => [...r.querySelectorAll('#gpa-proxy-error button')].find((x) => /approved site/.test(x.textContent)).click());
  await waitFor(a.page, (r) => r.querySelector('#gpa-proxy-frame').getAttribute('src').endsWith('/site/'), null, 8000);
  check('…its “Open the approved site” button goes to example.com', (await state(a.page)).src === PROXY + '/site/');
  for (const [inp, want] of [['http://example.com/a', '/site/a'], ['/b?c=1', '/site/b?c=1'], [PROXY + '/preview', '/preview']]) {
    await a.page.fill(sr('#gpa-proxy-url'), inp);
    await a.page.click(sr('#gpa-proxy-go'));
    await a.page.waitForTimeout(300);
    const s2 = await state(a.page);
    check(`“${inp}” → ${want}`, s2.src === PROXY + want && !s2.error, JSON.stringify(s2));
  }
  for (const inp of ['https://www.example.com/', 'javascript:alert(1)', 'https://example.com.evil.test/']) {
    const before = (await state(a.page)).src;
    await a.page.fill(sr('#gpa-proxy-url'), inp);
    await a.page.click(sr('#gpa-proxy-go'));
    await a.page.waitForTimeout(300);
    const s2 = await state(a.page);
    check(`“${inp}” is refused with an explanation (frame unchanged)`, s2.src === before && /isn’t supported|isn’t a web address|Only web addresses/.test(s2.error), JSON.stringify(s2));
  }

  // 6: switching tabs keeps the same frame and page (no reload); Reload and Home work.
  await a.page.fill(sr('#gpa-proxy-url'), 'example.com');
  await a.page.click(sr('#gpa-proxy-go'));
  await waitFor(a.page, (r) => /Loaded/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  await R(a.page, (r) => { r.querySelector('#gpa-proxy-frame').__mark = 'same'; });
  let navs = 0;
  const onNav = (f) => { if (f.url().startsWith(PROXY)) navs++; };
  a.page.on('framenavigated', onNav);
  await tab(a.page, 'chat'); await a.page.waitForTimeout(600);
  await tab(a.page, 'music'); await a.page.waitForTimeout(400);
  await tab(a.page, 'browser'); await a.page.waitForTimeout(800);
  st = await state(a.page);
  check('Away to Chat and Music and back: the same frame, same page, not reloaded', (await R(a.page, (r) => r.querySelector('#gpa-proxy-frame').__mark)) === 'same' && st.src === PROXY + '/site/' && navs === 0 && /Loaded/.test(st.status), JSON.stringify({ navs, ...st }));
  await R(a.page, (r) => r.querySelector('#gpa-proxy-reload').click());
  await waitFor(a.page, (r) => /Loaded/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  check('Reload loads the same page again', navs >= 1 && (await state(a.page)).src === PROXY + '/site/', String(navs));
  await R(a.page, (r) => r.querySelector('#gpa-proxy-home').click());
  await waitFor(a.page, (r) => /Connected/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(a.page);
  check('Home goes back to the connection test and clears the bar', st.src === PROXY + '/preview' && st.addr === '', JSON.stringify(st));
  a.page.off('framenavigated', onNav);
  // The last page is remembered for next time.
  await a.page.fill(sr('#gpa-proxy-url'), 'example.com/remember');
  await a.page.click(sr('#gpa-proxy-go'));
  await a.page.waitForTimeout(500);
  check('The last page is saved for next time', await a.page.evaluate(() => localStorage.getItem('gpa_proxy_last_destination')) === 'https://example.com/remember');

  // 8: themes and phone width.
  for (const th of ['white', 'dark']) {
    await tab(a.page, 'theme');
    await R(a.page, (r, t) => { const x = r.querySelector(`.gps-tile[data-theme="${t}"]`); if (x) x.click(); }, th);
    await a.page.waitForTimeout(900);
    await tab(a.page, 'browser');
    await a.page.waitForTimeout(500);
    const look = await R(a.page, (r) => { const s = getComputedStyle(r.querySelector('.gpx-browser-bar')); const g = getComputedStyle(r.querySelector('#gpa-proxy-go')); return { bar: s.backgroundColor, go: g.backgroundColor + ' ' + g.backgroundImage.slice(0, 30), shown: !!r.querySelector('#gpa-proxy-frame').offsetParent }; });
    check(`Theme “${th}”: the Proxy tab uses the theme (bar ${look.bar})`, look.shown && !!look.bar, JSON.stringify(look));
    await a.page.screenshot({ path: path.join(OUT, `08-theme-${th}.png`) });
  }
  check('No page errors (computer)', a.page._errors.length === 0, a.page._errors.slice(0, 2).join(' | '));

  // 4: a Worker that's down, and one answering errors.
  b = await computer({ server: `http://127.0.0.1:${deadPort}` });
  await signIn(b.page, 'pd' + run);
  await tab(b.page, 'browser');
  await waitFor(b.page, (r) => r.querySelector('#gpa-proxy-error').style.display !== 'none', null, 20000);
  st = await state(b.page);
  check('Worker down: “Can’t reach the proxy Worker”, Load failed, Retry + Open in a new tab', /Can’t reach the proxy Worker/.test(st.error) && /Load failed/.test(st.status) && st.proxy === 'error' && /Retry/.test(st.error) && /Open in a new tab/.test(st.error), JSON.stringify(st));
  await b.page.screenshot({ path: path.join(OUT, '04-worker-down.png') });
  // Fix the address in Connection settings: it reconnects.
  await R(b.page, (r) => { r.querySelector('.gpx-browser .gpx-details').open = true; });
  await b.page.fill(sr('#gpa-proxy-server'), 'not a url');
  await b.page.dispatchEvent(sr('#gpa-proxy-server'), 'change');
  check('Settings: a bad address is refused with a hint', /Use the Worker’s address only/.test(await R(b.page, (r) => r.querySelector('#gpa-proxy-server-hint').textContent)));
  await b.page.fill(sr('#gpa-proxy-server'), PROXY);
  await b.page.dispatchEvent(sr('#gpa-proxy-server'), 'change');
  await waitFor(b.page, (r) => /Connected/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(b.page);
  check('…a good address reconnects (connection test, error gone)', st.src === PROXY + '/preview' && !st.error, JSON.stringify(st));
  c = await computer({ server: `http://127.0.0.1:${broken.port}` });
  await signIn(c.page, 'pb' + run);
  await tab(c.page, 'browser');
  await waitFor(c.page, (r) => r.querySelector('#gpa-proxy-error').style.display !== 'none', null, 20000);
  st = await state(c.page);
  check('Worker answering errors: “answered with an error (HTTP 500)” + Retry', /answered with an error \(HTTP 500\)/.test(st.error) && /Proxy error/.test(st.status) && /Retry/.test(st.error), JSON.stringify(st));

  // 5: a website whose CSP forbids framing other sites.
  d = await computer({ server: PROXY, pathName: '/strict' });
  await signIn(d.page, 'ps' + run);
  await tab(d.page, 'browser');
  await waitFor(d.page, (r) => /Blocked/.test(r.querySelector('#gpa-proxy-status').textContent), null, 20000);
  st = await state(d.page);
  check('A website that forbids framing: “Blocked by this website” + Open in a new tab', /Blocked by this website/.test(st.status) && /security settings/.test(st.error) && /Open in a new tab/.test(st.error) && st.proxy === 'error', JSON.stringify(st));
  const [popup] = await Promise.all([d.ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null), R(d.page, (r) => [...r.querySelectorAll('#gpa-proxy-error button')].find((x) => /new tab/.test(x.textContent)).click())]);
  if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => {});
  check('…“Open in a new tab” opens the Worker’s page in a new tab', !!popup && popup.url() === PROXY + '/preview', popup ? popup.url() : 'no popup');
  await d.page.screenshot({ path: path.join(OUT, '05-blocked-by-website.png') });

  // 7: the default address is the deployed Worker; the old localhost:4141 moves to it.
  e = await computer({ server: 'https://localhost:4141', phone: true });
  await signIn(e.page, 'pl' + run);
  await tab(e.page, 'browser');
  await e.page.waitForTimeout(800);
  const def = await R(e.page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), setting: r.querySelector('#gpa-proxy-server').value }));
  check('Default: the deployed Worker (' + DEPLOYED + '/preview); an old saved localhost:4141 moves to it', def.src === DEPLOYED + '/preview' && def.setting === DEPLOYED, JSON.stringify(def));
  const fit = await R(e.page, (r) => { const bar = r.querySelector('.gpx-browser-bar'), p = r.querySelector('.gpa-panel'); return { fits: bar.scrollWidth <= bar.clientWidth + 1, inside: bar.getBoundingClientRect().right <= p.getBoundingClientRect().right + 1, go: !!r.querySelector('#gpa-proxy-go').offsetParent }; });
  check('Phone width: the bar fits (nothing off the side), Go still there', fit.fits && fit.inside && fit.go, JSON.stringify(fit));
  await e.page.waitForTimeout(9000);   // no internet here: the deployed Worker can't be reached from this container
  await e.page.screenshot({ path: path.join(OUT, '07-phone-default-worker.png') });
  for (const [n, p] of [['worker down', b], ['worker error', c], ['strict website', d], ['phone', e]]) check(`No page errors (${n})`, p.page._errors.length === 0, p.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await broken.close();
  await pw.stop();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
