// The Scramjet proxy served by this Worker at /px/ (web/proxy/, proxy-dist/),
// end to end against worker.js in workerd:
//   1. /px/ is the proxy page (its files, isolation headers, service worker)
//   2. embedded (?embed=1) in a file:// page, like the console and its
//      offline file, the console's commands open a website through Scramjet
//      and a Wisp server; Back returns to the start page
//   3. saved sessions: a Saints proxy sign-in is accepted by /px/sessions,
//      checked by the Worker's own handler (no request back to itself), and
//      its cookie stays under /px/sessions
//
// Needs the proxy built: npm run build:proxy (or, from a frontend checkout at
// the pinned commit: node scripts/proxy-frontend.mjs build --from ../frontend).
// The Wisp server is local, over TLS with a throwaway certificate (the
// proxy only accepts wss://); its address replaces the proxy's config.js.
//   node tests/browser/proxy-px.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = path.resolve(process.argv[2] || 'proxy-px-out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

if (!fs.existsSync(path.join(ROOT, 'proxy-dist/px/index.html'))) {
  console.error('The proxy is not built: run npm run build:proxy first.');
  process.exit(2);
}
// wisp-js (the Wisp server the proxy's backend runs): from WISP_MODULES, a
// folder whose node_modules has @mercuryworkshop/wisp-js, or from this repo.
const wispEntry = createRequire(path.join(process.env.WISP_MODULES || ROOT, 'noop.js')).resolve('@mercuryworkshop/wisp-js/server');
const wispSrc = path.join(path.dirname(path.dirname(wispEntry)), 'src/entrypoints/server.mjs');
const { server: wisp } = await import(pathToFileURL(fs.existsSync(wispSrc) ? wispSrc : wispEntry).href);

// The website to open through the proxy.
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end('<!doctype html><title>Target</title><h1 id="t">Hello through /px</h1>'); });
// Wisp over TLS with a throwaway certificate.
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
Object.assign(wisp.options, { allow_loopback_ips: true, allow_private_ips: true, allow_udp_streams: false });
const wss = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (rq, rs) => rs.end('ok'));
wss.on('upgrade', (req, socket, head) => wisp.routeRequest(req, socket, head));
await new Promise((r) => wss.listen(0, '127.0.0.1', r));
const wispUrl = `wss://127.0.0.1:${wss.address().port}/wisp/`;

const ADMIN = 'test-admin-token-0123456789abcdef';
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: ADMIN } });
const W = env.workerUrl;
const browser = await launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-certificate-errors'] });

try {
  await fetch(W + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer ' + ADMIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });

  // ---- 1: the page ----
  const page1 = await fetch(W + '/px/');
  const sw = await fetch(W + '/px/sw.js');
  const swText = await sw.text();
  check('/px/ is the proxy page, with its isolation headers', page1.status === 200 && /Saints Search/.test(await page1.text()) && page1.headers.get('cross-origin-embedder-policy') === 'require-corp');
  check('…its service worker loads its files from /px/ and is never cached', sw.status === 200 && swText.includes('importScripts("/px/scram/scramjet.all.js"') && sw.headers.get('cache-control') === 'no-store');

  // ---- 2: browsing, embedded in a file:// page ----
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 750 } });
  await ctx.route(W + '/px/config.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'Cache-Control': 'no-store' }, body: `let _CONFIG = { wispUrl: "${wispUrl}", authUrl: "${W}" };\n` }));
  // Not counted: /px/icon (404 when a site has no icon, so the page shows a
  // letter instead), proxied pages and the sessions API (answers by design).
  const misses = [];
  ctx.on('response', (r) => { if (r.url().startsWith(W) && r.status() >= 400 && !r.url().includes('/px/scramjet/') && !r.url().includes('/px/sessions') && !r.url().includes('/px/icon?')) misses.push(r.status() + ' ' + r.url().slice(W.length)); });
  const host = path.join(OUT, 'host.html');
  fs.writeFileSync(host, `<!doctype html><title>about:blank</title><iframe id="f" style="width:1000px;height:650px;border:0" src="${W}/px/?embed=1"></iframe>
<script>window.msgs=[];addEventListener('message',e=>{if(e.data&&e.data.saintsProxy)msgs.push(e.data)});
window.send=(d)=>document.getElementById('f').contentWindow.postMessage(Object.assign({saintsProxy:1},d),'*');</script>`);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(host).href);
  const last = (type) => page.evaluate((t) => [...msgs].reverse().find((m) => m.type === t) || null, type);
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await page.waitForTimeout(150); } return null; };
  await page.waitForTimeout(800);
  await page.evaluate(() => send({ type: 'command', command: 'state' }));
  check('Embedded from a file:// page, it reports its state to the console', !!(await until(async () => (await last('state'))?.url === 'saints://home')));
  const target = `http://127.0.0.1:${site.port}/`;
  await page.evaluate((u) => send({ type: 'navigate', query: u }), target);
  const nav = await until(async () => (await last('nav'))?.url === target, 45000);
  const shown = await until(async () => { for (const f of page.frames()) { try { const t = await f.evaluate(() => document.getElementById('t')?.textContent); if (t) return { t, url: f.url() }; } catch {} } return null; }, 20000);
  check('The console opens a website through Scramjet and Wisp, at /px/scramjet/', nav && shown && shown.t === 'Hello through /px' && shown.url.startsWith(W + '/px/scramjet/'), JSON.stringify(shown));
  const fr = page.frames().find((f) => f.url().startsWith(W + '/px/?embed=1'));
  const scopes = fr && await fr.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname));
  check('Its service worker is scoped to /px/ only', JSON.stringify(scopes) === '["/px/"]', JSON.stringify(scopes));
  await page.screenshot({ path: path.join(OUT, '01-browsing.png') });
  await page.evaluate(() => send({ type: 'command', command: 'back' }));
  check('The console\'s Back returns to the start page', !!(await until(async () => (await last('state'))?.url === 'saints://home')));
  check('Every proxy file was found (no 404s)', misses.length === 0, misses.slice(0, 5).join(', '));
  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---- 3: saved sessions through the Worker's own sign-in check ----
  const user = 'px' + Date.now().toString(36).slice(-5);
  const verifier = 'a'.repeat(64);
  const dev = 'b'.repeat(32);
  const reg = await (await fetch(W + '/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, verifier, site: 'test', device: dev }) })).json();
  const pl = await (await fetch(W + '/auth/proxy-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, verifier, device: dev }) })).json();
  const auth = await fetch(W + '/px/sessions/auth', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: W }, body: JSON.stringify({ token: pl.token || '' }) });
  const authBody = await auth.json().catch(() => ({}));
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  check('A Saints proxy sign-in is accepted by /px/sessions (checked by the Worker itself)', reg.ok && pl.ok && auth.status === 200 && authBody.user === user, JSON.stringify({ reg: reg.ok || reg.error, pl: pl.ok || pl.error, status: auth.status, body: authBody }));
  check('…its cookie stays under /px/sessions', /; Path=\/px\/sessions;/.test(auth.headers.get('set-cookie') || ''), auth.headers.get('set-cookie'));
  const who = await (await fetch(W + '/px/sessions/whoami', { headers: { Cookie: cookie } })).json().catch(() => ({}));
  check('…and the cookie signs later requests in', who.user === user, JSON.stringify(who));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  wss.close();
  fs.rmSync(certDir, { recursive: true, force: true });
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
