// The Proxy tab against a FAKE Scramjet frontend, with the console injected on
// a website and the real main Worker for logging/monitor. The real Scramjet
// frontend (viztrrx/frontend, or this Worker's /px/) needs a browser service
// worker, WASM and the Wisp backend; proxy-px.mjs covers that end to end. This
// stands in for it with a page that speaks the same embedded protocol: loaded
// as <server>/?embed=1, it takes {type:'navigate', query} and
// {type:'command', command} from the console's bar and reports
// {type:'nav', url, query?} and {type:'state', url, canBack, canForward,
// loading, busy} back.
//   1. launcher (In this tab needs fullscreen; about:blank launches now)
//   2. launch here (fullscreen) frames the frontend embedded; status Connected
//   3. the console's own bar drives it: an address -> Browsing, words ->
//      Searching, Back/Forward/Home; every site is logged
//   4. Admin: /admin/proxy + Proxy monitor show the user live on that site
//   5. about:blank launches without fullscreen, frames the frontend, the bar
//      moves into the window (with Fullscreen)
//   6. a host page that forbids framing -> "Blocked by this website"
//
// The fake frontend is served at an https address on a reserved .test name,
// answered by Playwright's routing (no DNS, no certificate). The console
// ignores a saved localhost/127.0.0.1 proxy address on purpose (old dev
// servers), so a real-looking https address is what the test saves.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'proxy-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const req = createRequire(path.join(ROOT, 'package.json'));
const { devices } = req('playwright');

// ---- A stand-in for Saints Search (the Scramjet frontend) in embedded mode.
// It keeps a history of the "sites" its frame is on, follows the console's
// navigate/command messages, and reports nav + state like public/index.js.
// #link-wiki stands for a link clicked inside a proxied page. ----
const FE_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Saints Search (fake)</title></head>
<body><h1>Saints Search</h1><p id="where"></p>
<button id="link-wiki">a link to Wikipedia</button>
<script>
var HOME = "saints://home";
var hist = [{ url: HOME, query: "" }], at = 0;
window.__chrome = []; window.__commands = [];
function post(msg){ try { if (parent && parent !== window) parent.postMessage(Object.assign({ saintsProxy: 1 }, msg), "*"); } catch (e) {} }
function cur(){ return hist[at]; }
function report(){
  var h = cur();
  document.getElementById("where").textContent = h.url;
  var nav = { type: "nav", url: h.url === HOME ? "" : h.url };
  if (h.query) nav.query = h.query;
  post(nav);
  state();
}
function state(extra){ post(Object.assign({ type: "state", url: cur().url, canBack: at > 0, canForward: at < hist.length - 1, loading: false, busy: false }, extra || {})); }
function go(url, query){ hist = hist.slice(0, at + 1); hist.push({ url: url, query: query || "" }); at = hist.length - 1; report(); }
document.getElementById("link-wiki").onclick = function(){ go("https://en.wikipedia.org/wiki/Proxy"); };
window.addEventListener("message", function(e){
  var d = e.data;
  if (!d || d.saintsProxy !== 1) return;
  if (d.type === "chrome") { window.__chrome.push(d); return; }
  if (d.type === "navigate" && typeof d.query === "string") {
    // A web address opens that site; plain words become a search.
    var q = d.query.trim(), looksUrl = false;
    try { new URL(q); looksUrl = true; } catch (x) {}
    if (!looksUrl) { try { looksUrl = q.indexOf(" ") < 0 && new URL("http://" + q).hostname.indexOf(".") >= 0; } catch (x) {} }
    if (looksUrl) go(q.indexOf("://") >= 0 ? q : "https://" + q);
    else go("https://www.google.com/search?q=" + encodeURIComponent(q), q);
    return;
  }
  if (d.type !== "command") return;
  window.__commands.push(d.command);
  if (d.command === "state") state();
  else if (d.command === "back" && at > 0) { at--; report(); }
  else if (d.command === "forward" && at < hist.length - 1) { at++; report(); }
  else if (d.command === "home") go(HOME);
  else if (d.command === "reload") { state({ loading: true }); setTimeout(state, 50); }
});
report();
</script></body></html>`;
const FE = 'https://scramjet-fake.saints.test';
const feHits = [];

const ADMIN = 'proxy-test-admin-token-0123456789';
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
// The host page the console is injected on; /strict forbids framing anything.
const site = await serve((rq, rs) => {
  rs.setHeader('Content-Type', 'text/html');
  if (rq.url.startsWith('/strict')) rs.setHeader('Content-Security-Policy', "frame-src 'self'");
  rs.end(HOST_PAGE.replace('Some ordinary page', rq.url.startsWith('/strict') ? 'A strict website' : 'A school website'));
});
// The console talks to this run's Worker, not the live one: the live Worker
// doesn't know these test accounts and its 401 would sign the user out.
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace("const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';", `const OPENAI_PROXY = '${env.workerUrl}';`);
if (!code.includes(`const OPENAI_PROXY = '${env.workerUrl}';`)) throw new Error('could not point the console at the test Worker');
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const adminProxy = async () => (await (await fetch(`${env.workerUrl}/admin/proxy`, { headers: { Authorization: 'Bearer ' + ADMIN } })).json());

async function computer({ pathName = '/', phone = false } = {}) {
  const c = await browser.newContext(phone ? { ...(devices['iPhone 15'] || devices['iPhone 14']) } : { viewport: { width: 1200, height: 860 } });
  await c.route(FE + '/**', (route) => {
    feHits.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: FE_PAGE });
  });
  await c.addInitScript(([u, s]) => {
    try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_proxy_server_url', s); } catch (e) { /* ignore */ }
  }, [env.workerUrl, FE]);
  const page = await c.newPage();
  page._errors = [];
  page.on('pageerror', (e) => page._errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${site.port}${pathName}`);
  await page.evaluate((cd) => { (0, eval)(cd); }, code);
  await page.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  return { ctx: c, page };
}
async function signIn(page, user) {
  await page.fill(sr('#gpa-login-user'), user);
  await page.fill(sr('#gpa-login-pin'), '246810');
  await page.click(sr('#gpa-signup-btn'));
  await page.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none', null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  await R(page, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  return R(page, (r) => r.querySelector('#gpa-login').style.display === 'none');
}
const tab = (page, t) => R(page, (r, x) => { const n = r.querySelector(`.gpa-dropdown-item[data-tab="${x}"]`); n.style.display = ''; n.click(); }, t);
const stat = (page) => R(page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), status: r.querySelector('#gpa-proxy-status').textContent, error: r.querySelector('#gpa-proxy-error').style.display === 'none' ? '' : r.querySelector('#gpa-proxy-error').textContent, stage: r.querySelector('#gpa-proxy-stage').style.display }));
const statusIs = (page, re, ms = 8000) => waitFor(page, (r, src) => new RegExp(src).test(r.querySelector('#gpa-proxy-status').textContent), re.source, ms);
// The console's bar, read from wherever the stage is (this tab, or the
// about:blank window's shadow root).
const BAR = (root) => {
  const q = (s) => root.querySelector(s);
  const btn = (c) => q(`.gpx-pxbar [data-pxc="${c}"]`);
  return { addr: q('#gpa-proxy-addr').value, back: !btn('back').disabled, forward: !btn('forward').disabled, fullscreen: !btn('fullscreen').hidden };
};
const bar = (page) => R(page, BAR);
const feFrame = (page) => page.frames().find((x) => x.url().startsWith(FE));
// Types in the console's address bar and presses Enter.
async function typeAddr(page, text, sel = sr('#gpa-proxy-addr')) {
  await page.fill(sel, text);
  await page.press(sel, 'Enter');
}
async function launchHere(page) {
  // The launcher shows Enter Fullscreen (or Launch, if it already is) once the pane is in.
  await waitFor(page, (r) => { const f = r.querySelector('#gpa-proxy-fs'), h = r.querySelector('#gpa-proxy-launch-here'); return (f && f.offsetParent) || (h && h.offsetParent && !h.disabled); }, null, 8000);
  if (await R(page, (r) => !!r.querySelector('#gpa-proxy-fs').offsetParent)) await page.click(sr('#gpa-proxy-fs'));
  await waitFor(page, (r) => { const b = r.querySelector('#gpa-proxy-launch-here'); return b && b.offsetParent && !b.disabled; }, null, 6000);
  await page.click(sr('#gpa-proxy-launch-here'));
  await waitFor(page, (r) => /Connected|Browsing/.test(r.querySelector('#gpa-proxy-status').textContent), null, 15000);
}
async function connectAdmin(page) {
  await tab(page, 'admin');
  await page.waitForTimeout(500);
  await R(page, (r, x) => {
    const f = r.querySelector('#gac-auth-fields');
    const inputs = [...f.querySelectorAll('input')];
    const tok = inputs.find((i) => i.type === 'password') || inputs[0];
    tok.value = x.token; tok.dispatchEvent(new Event('input', { bubbles: true }));
    const urlIn = inputs.find((i) => i !== tok);
    if (urlIn) { urlIn.value = x.url; urlIn.dispatchEvent(new Event('input', { bubbles: true })); }
    r.querySelector('#gac-connect').click();
  }, { token: ADMIN, url: env.workerUrl });
  await page.waitForTimeout(2500);
}

let a, b, d;
try {
  // Sign-ups are open for this run (a fresh Worker may start with the allowlist on).
  await fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });

  // 1: launcher.
  a = await computer();
  check('signs in', await signIn(a.page, 'px' + run));
  await tab(a.page, 'browser');
  await a.page.waitForTimeout(600);
  const pre = await R(a.page, (r) => ({ src: r.querySelector('#gpa-proxy-frame').getAttribute('src'), stage: r.querySelector('#gpa-proxy-stage').style.display, fs: !!r.querySelector('#gpa-proxy-fs').offsetParent, here: !r.querySelector('#gpa-proxy-launch-here').offsetParent, blank: r.querySelector('#gpa-proxy-launch-blank').disabled, lede: r.querySelector('.gpx-pl-lede').textContent }));
  check('Opening Proxy loads nothing; In this tab offers Enter Fullscreen, about:blank can launch; the lede names Scramjet', !pre.src && pre.stage === 'none' && pre.fs && pre.here && !pre.blank && /Scramjet/.test(pre.lede) && feHits.length === 0, JSON.stringify(pre));

  // 2: launch here (fullscreen) frames the frontend, embedded.
  await launchHere(a.page);
  let st = await stat(a.page);
  check('Launch Here (fullscreen): the console frames the Scramjet frontend embedded and shows Connected', st.src === FE + '/?embed=1' && st.stage === '' && /Connected/.test(st.status) && !st.error && !!feFrame(a.page), JSON.stringify(st));
  check('…the frame is not sandboxed to an opaque origin (Scramjet needs its own origin + service worker)', await R(a.page, (r) => { const f = r.querySelector('#gpa-proxy-frame'); return !f.getAttribute('sandbox') && /cross-origin-isolated/.test(f.getAttribute('allow') || ''); }));
  // The console draws the bar; the frame fills the stage under it.
  const layout = await R(a.page, (r) => {
    const stage = r.querySelector('#gpa-proxy-stage').getBoundingClientRect();
    const barEl = r.querySelector('#gpa-proxy-stage .gpx-pxbar').getBoundingClientRect();
    const frame = r.querySelector('#gpa-proxy-frame').getBoundingClientRect();
    return { bars: r.querySelectorAll('#gpa-proxy-stage .gpx-pxbar').length, barTop: Math.round(barEl.top - stage.top), barH: Math.round(barEl.height), below: Math.round(frame.top - barEl.bottom), bottom: Math.round(stage.bottom - frame.bottom) };
  });
  check('The console draws one bar at the top of the stage; the frame fills the rest under it', layout.bars === 1 && layout.barTop <= 1 && layout.barH > 20 && layout.below >= 0 && layout.below <= 6 && layout.bottom <= 1, JSON.stringify(layout));
  const bar0 = await bar(a.page);
  check('…on the start page: address empty, Back/Forward off, no Fullscreen button (this tab already is)', bar0.addr === '' && !bar0.back && !bar0.forward && !bar0.fullscreen, JSON.stringify(bar0));
  const chrome1 = await feFrame(a.page).evaluate(() => window.__chrome.slice(-1)[0] || null);
  check('…Saints Search is told: Close, no Fullscreen', !!chrome1 && chrome1.close === true && chrome1.fullscreen === false, JSON.stringify(chrome1));

  // 3: browsing with the console's bar.
  await typeAddr(a.page, 'www.tiktok.com/@someone?x=1');
  check('An address typed in the console\'s bar opens it: status Browsing', await statusIs(a.page, /Browsing/), (await stat(a.page)).status);
  const bar1 = await bar(a.page);
  check('…the bar shows the site and Back is on', bar1.addr === 'https://www.tiktok.com/@someone?x=1' && bar1.back && !bar1.forward, JSON.stringify(bar1));
  await typeAddr(a.page, 'funny cats');
  check('Words typed in the bar are a search: status Searching', await statusIs(a.page, /Searching/), (await stat(a.page)).status);
  await feFrame(a.page).click('#link-wiki');
  check('A link followed inside the page: status Browsing, the bar shows it', await statusIs(a.page, /Browsing/) && (await bar(a.page)).addr === 'https://en.wikipedia.org/wiki/Proxy', JSON.stringify(await bar(a.page)));
  await a.page.click(sr('.gpx-pxbar [data-pxc="back"]'));
  const backOk = await statusIs(a.page, /Searching/) && await waitFor(a.page, (r) => /google\.com\/search/.test(r.querySelector('#gpa-proxy-addr').value), null, 4000);
  const bar2 = await bar(a.page);
  check('The bar\'s Back goes back (to the search); Forward turns on', backOk && bar2.forward, JSON.stringify(bar2));
  await a.page.click(sr('.gpx-pxbar [data-pxc="forward"]'));
  check('…Forward goes forward again', await statusIs(a.page, /Browsing/) && (await bar(a.page)).addr === 'https://en.wikipedia.org/wiki/Proxy');
  await a.page.click(sr('.gpx-pxbar [data-pxc="home"]'));
  check('Home: back to the start page, status Connected, address empty', await statusIs(a.page, /Connected/) && (await bar(a.page)).addr === '', JSON.stringify(await bar(a.page)));
  await a.page.click(sr('.gpx-pxbar [data-pxc="reload"]'));
  await a.page.waitForTimeout(300);
  check('…Reload is passed to the proxy as a command', (await feFrame(a.page).evaluate(() => window.__commands)).includes('reload'));
  await typeAddr(a.page, 'https://www.tiktok.com/@someone?x=1');
  await statusIs(a.page, /Browsing/);
  await a.page.waitForTimeout(800);
  await a.page.screenshot({ path: path.join(OUT, '00-proxy-here.png') });

  // 4: Admin sees it live and logged.
  const prof = await adminProxy();
  const me = (prof.users || []).find((u) => u.user.toLowerCase() === 'px' + run);
  check('Admin /admin/proxy: the user is live on the Proxy, on the reported site, in the tab', !!me && !!me.live && me.live.mode === 'here' && me.live.site === 'https://www.tiktok.com/@someone' && me.visits >= 2, JSON.stringify(me && { live: me.live, visits: me.visits }));
  const urls = me ? me.entries.filter((x) => x.ev === 'visit').map((x) => x.url) : [];
  check('…the sites visited are logged without query strings', urls.includes('https://www.tiktok.com/@someone') && urls.includes('https://en.wikipedia.org/wiki/Proxy') && urls.every((x) => !x.includes('?')), urls.join(' '));
  const searched = me ? me.entries.filter((x) => x.ev === 'visit' && x.q).map((x) => x.q) : [];
  check('…a search typed in the bar is logged by the words (not the search URL)', searched.includes('funny cats'), searched.join(' '));
  await connectAdmin(a.page);
  await R(a.page, (r) => { const t = r.querySelector('.gps-tab[data-asec="proxy"]'); if (t) t.click(); });
  const U = 'px' + run;
  await waitFor(a.page, (r, u) => !!r.querySelector(`#gac-pm-live [data-pm-user="${u}"]`), U, 15000);
  const liveRow = await R(a.page, (r, u) => { const n = r.querySelector(`#gac-pm-live [data-pm-user="${u}"]`); return n ? n.textContent.replace(/\s+/g, ' ') : ''; }, U);
  check('Admin → Proxy monitor → Live now: the user, the site they proxied and are on now', liveRow.includes(U) && /Proxied tiktok\.com\/@someone · on it now/.test(liveRow), liveRow);
  await R(a.page, (r, u) => { const n = r.querySelector(`#gac-pm-users [data-pm-user="${u}"]`); if (n) n.click(); }, U);
  await a.page.waitForTimeout(300);
  const hist = await R(a.page, (r) => r.querySelector('#gac-pm-detail').textContent.replace(/\s+/g, ' '));
  check('…pressing their name shows today’s history (launches, the sites proxied and the search)', hist.includes(U) && /Proxied tiktok\.com\/@someone/.test(hist) && /Searched .funny cats./.test(hist) && /Launched/.test(hist), hist.slice(0, 200));
  await a.page.screenshot({ path: path.join(OUT, '01-proxy-monitor.png') });
  // The bar's Close closes the proxy.
  await tab(a.page, 'browser');
  await a.page.waitForTimeout(400);
  await a.page.click(sr('.gpx-pxbar [data-pxc="close"]'));
  await a.page.waitForTimeout(500);
  const closed = await stat(a.page);
  check('Close in the console\'s bar closes the proxy and shows the launcher', closed.stage === 'none' && closed.src === 'about:blank' && /Not connected/.test(closed.status), JSON.stringify(closed));
  check('No page errors (main computer)', a.page._errors.length === 0, a.page._errors.slice(0, 2).join(' | '));

  // 5: about:blank launches without fullscreen and frames the frontend.
  b = await computer();
  await signIn(b.page, 'pb' + run);
  await tab(b.page, 'browser');
  await b.page.waitForTimeout(400);
  check('Not fullscreen: about:blank can still launch', await R(b.page, (r) => !r.fullscreenElement && !r.querySelector('#gpa-proxy-launch-blank').disabled));
  const [pop] = await Promise.all([b.ctx.waitForEvent('page', { timeout: 8000 }), b.page.click(sr('#gpa-proxy-launch-blank'))]);
  await pop.waitForLoadState('domcontentloaded').catch(() => {});
  const popRoot = () => document.body.firstElementChild && document.body.firstElementChild.shadowRoot;
  await pop.waitForFunction((f) => { const r = (0, eval)(f)(); return !!r && /Connected|Browsing/.test(r.querySelector('#gpa-proxy-status').textContent); }, String(popRoot), { timeout: 15000 }).catch(() => {});
  const inWin = pop.frames().find((x) => x.url().startsWith(FE));
  check('Launch in about:blank (not fullscreen): the window opens and frames the Scramjet frontend embedded', pop.url() === 'about:blank' && !!inWin && inWin.url() === FE + '/?embed=1', pop.url() + ' frames ' + pop.frames().map((x) => x.url()).join(','));
  const mainNow = await R(b.page, (r) => ({ gate: r.querySelector('#gpa-proxy-gate').textContent, btn: r.querySelector('#gpa-proxy-launch-blank').textContent }));
  check('…the console says it’s in the about:blank window', /about:blank window/.test(mainNow.gate) && /Show window/.test(mainNow.btn), JSON.stringify(mainNow));
  const winBar = await pop.evaluate(([f, g]) => { const r = (0, eval)(f)(); return r ? { bars: r.querySelectorAll('.gpx-pxbar').length, ...(0, eval)(g)(r) } : null; }, [String(popRoot), String(BAR)]);
  check('The about:blank window has the console\'s one bar, with Fullscreen', !!winBar && winBar.bars === 1 && winBar.fullscreen, JSON.stringify(winBar));
  await pop.waitForTimeout(300);
  const chrome2 = inWin ? await inWin.evaluate(() => window.__chrome.slice(-1)[0] || null) : null;
  check('…Saints Search is told: Close and Fullscreen there', !!chrome2 && chrome2.close === true && chrome2.fullscreen === true, JSON.stringify(chrome2));
  await typeAddr(pop, 'en.wikipedia.org/wiki/Proxy', '#gpa-proxy-addr');
  await pop.waitForFunction((f) => /Browsing/.test((0, eval)(f)().querySelector('#gpa-proxy-status').textContent), String(popRoot), { timeout: 8000 }).catch(() => {});
  await pop.waitForTimeout(800);
  await pop.screenshot({ path: path.join(OUT, '03-about-blank.png') });
  const bme = ((await adminProxy()).users || []).find((u) => u.user.toLowerCase() === 'pb' + run);
  check('…a site opened from the window\'s bar is logged as an about:blank launch', !!bme && bme.live && bme.live.mode === 'blank' && bme.live.site === 'https://en.wikipedia.org/wiki/Proxy' && bme.entries.some((x) => x.ev === 'launch' && x.mode === 'blank'), JSON.stringify(bme && { live: bme.live }));
  await pop.close();
  await b.page.waitForTimeout(1200);
  check('Closing the window returns the tab to the launcher', await R(b.page, (r) => r.querySelector('#gpa-proxy-stage').style.display === 'none' && /was closed/.test(r.querySelector('#gpa-proxy-gate').textContent)));
  check('No page errors (about:blank computer)', b.page._errors.length === 0, b.page._errors.slice(0, 2).join(' | '));

  // 6: a host page that forbids framing.
  d = await computer({ pathName: '/strict' });
  await signIn(d.page, 'pd' + run);
  await tab(d.page, 'browser');
  await d.page.waitForTimeout(400);
  if (!(await R(d.page, (r) => !!r.fullscreenElement))) await d.page.click(sr('#gpa-proxy-fs'));
  await waitFor(d.page, (r) => { const bb = r.querySelector('#gpa-proxy-launch-here'); return bb && bb.offsetParent && !bb.disabled; }, null, 6000);
  await d.page.click(sr('#gpa-proxy-launch-here'));
  await waitFor(d.page, (r) => r.querySelector('#gpa-proxy-error').style.display !== 'none', null, 10000);
  st = await stat(d.page);
  check('A website that forbids framing: “Blocked by this website” + Open in a new tab', /Blocked by this website/.test(st.status) && /security settings/.test(st.error) && /Open in a new tab/.test(st.error), JSON.stringify(st));
  await d.page.screenshot({ path: path.join(OUT, '02-blocked.png') });
  check('No page errors (strict computer)', d.page._errors.length === 0, d.page._errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
