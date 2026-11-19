// Opening the Worker's address downloads the offline console (web/offline.js),
// end to end against worker.js in workerd:
//   1. "/" answers with a small page; other methods keep their old answers
//   2. /download/saints-service.html is the file: an attachment, built from
//      the current script.js and pointed at this Worker
//   3. in Chromium, just opening the Worker's address starts the download
//   4. the downloaded file opens from disk and you can sign up in it
//   node tests/browser/offline-download.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = path.resolve(process.argv[2] || 'offline-download-out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// The Worker fetches script.js from here (CONSOLE_SCRIPT_URL), like it does
// from GitHub in production.
const scriptHost = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/plain'); rs.end(fs.readFileSync(path.join(ROOT, 'script.js'))); });
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef', CONSOLE_SCRIPT_URL: `http://127.0.0.1:${scriptHost.port}/script.js` } });
const browser = await launch();
const sr = (sel) => `#gpa-root-host >> ${sel}`;

try {
  await fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef', 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });

  // ---- 1: the address itself ----
  const root = await fetch(env.workerUrl + '/');
  const rootText = await root.text();
  check('"/" is a small page that links the download', root.status === 200 && /text\/html/.test(root.headers.get('content-type')) && rootText.includes('/download/saints-service.html') && rootText.length < 5000, root.status + ' ' + rootText.length + ' bytes');
  const opt = await fetch(env.workerUrl + '/', { method: 'OPTIONS' });
  const post = await fetch(env.workerUrl + '/', { method: 'POST', body: '{}' });
  check('…its tab is blank too (about:blank, transparent icon)', rootText.includes('<title>about:blank</title>') && rootText.includes('href="data:image/gif;base64,'));
  check('…other methods on "/" keep their old answers (preflight 204, POST not found)', opt.status === 204 && post.status === 404, opt.status + ' / ' + post.status);

  // ---- 2: the file ----
  const file = await fetch(env.workerUrl + '/download/saints-service.html');
  const html = await file.text();
  const b64 = (html.match(/<script id="saints-service-code" type="application\/octet-stream">([^<]+)<\/script>/) || [])[1] || '';
  const code = Buffer.from(b64, 'base64').toString('utf8');
  check('The file is an attachment named saints-service.html', file.status === 200 && /attachment; filename="saints-service\.html"/.test(file.headers.get('content-disposition') || ''), file.headers.get('content-disposition'));
  check('…holding the current script.js, pointed at this Worker', code.includes(`const OPENAI_PROXY = "${env.workerUrl}";`) && code.length > fs.statSync(path.join(ROOT, 'script.js')).size * 0.9 && html.includes('window.__agentConsoleFile = true'), `${(html.length / 1048576).toFixed(1)} MB`);
  const head = await fetch(env.workerUrl + '/download/saints-service.html', { method: 'HEAD' });
  check('…and HEAD answers without a body', head.status === 200 && (await head.text()) === '');

  // ---- 3: opening the address downloads it ----
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1000, height: 700 } });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 15000 }), pg.goto(env.workerUrl + '/')]);
  const ms = Date.now() - t0;
  const saved = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(saved);
  check('Opening the Worker\'s address starts the download by itself', dl.suggestedFilename() === 'saints-service.html' && fs.statSync(saved).size > 1e6, `${ms} ms, ${(fs.statSync(saved).size / 1048576).toFixed(1)} MB`);
  await pg.screenshot({ path: path.join(OUT, '01-download-page.png') });

  // ---- 4: the downloaded file works ----
  const fp = await ctx.newPage();
  fp.on('pageerror', (e) => errors.push(String(e)));
  await fp.goto(pathToFileURL(saved).href);
  await fp.waitForFunction(() => !!document.getElementById('gpa-root-host') && !document.getElementById('boot'), null, { timeout: 20000 });
  await fp.fill(sr('#gpa-login-user'), 'dl' + Date.now().toString(36).slice(-5));
  await fp.fill(sr('#gpa-login-pin'), '246810');
  await fp.click(sr('#gpa-signup-btn'));
  const ok = await fp.waitForFunction(() => document.getElementById('gpa-root-host').shadowRoot.querySelector('#gpa-login').style.display === 'none', null, { timeout: 15000 }).then(() => true, () => false);
  check('The downloaded file opens from disk and signs up against the Worker', ok);
  await fp.screenshot({ path: path.join(OUT, '02-downloaded-file.png') });
  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await scriptHost.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
