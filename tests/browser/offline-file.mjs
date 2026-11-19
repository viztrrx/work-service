// The offline console (npm run build:offline): one .html opened from disk.
// Builds it pointed at worker.js in workerd, opens it as a file:// page in
// Chromium, and checks that the whole console works from there:
//   1. it starts full screen (no website underneath) with no errors
//   2. sign-up and sign-in go to the Worker from the file (Origin "null")
//   3. Ask AI streams an answer; slash commands work
//   4. chat: a message is sent and comes back from the room
//   5. a WebSocket opens from the file page
//   6. after a reload of the file, you're still signed in
//   node tests/browser/offline-file.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = path.resolve(process.argv[2] || 'offline-file-out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// A bare WebSocket endpoint: completes the handshake and remembers the Origin.
const wsSeen = [];
const wsServer = http.createServer((rq, rs) => { rs.statusCode = 426; rs.end(); });
wsServer.on('upgrade', (rq, socket) => {
  wsSeen.push(rq.headers.origin || '');
  const accept = crypto.createHash('sha1').update(rq.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.on('error', () => {});
});
await new Promise((r) => wsServer.listen(0, '127.0.0.1', r));

const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef' } });
const file = path.join(OUT, 'saints-service.html');
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-offline.mjs'), '--out', file, '--worker', env.workerUrl], { stdio: 'inherit' });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms, polling: 50 }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);

try {
  await fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef', 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
  // The AI itself is answered here (the test Worker has no OpenAI key); every
  // other request goes to the real worker.js.
  const origins = [];
  await ctx.route(env.workerUrl + '/v1/**', async (route) => {
    const rq = route.request();
    origins.push(rq.headers().origin || '');
    if (rq.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' } }); return; }
    if (/\/v1\/responses/.test(rq.url())) {
      const text = 'Hello from the offline file.\nCONFIDENCE: 90';
      const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' },
        body: ev('response.created', { response: { id: 'r' } }) + ev('response.output_text.delta', { delta: text }) + ev('response.completed', { response: { id: 'r', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 5, output_tokens: 5 } } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ choices: [{ message: { content: 'Plain answer.\nCONFIDENCE: 80' } }] }) });
  });
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  const authOrigins = [];
  pg.on('request', (rq) => { if (/\/auth\/(register|login)/.test(rq.url())) authOrigins.push(rq.headers().origin || ''); });

  // ---- 1: open the file ----
  const url = pathToFileURL(file).href;
  await pg.goto(url);
  const mounted = await pg.waitForFunction(() => !!document.getElementById('gpa-root-host') && !document.getElementById('boot'), null, { timeout: 20000 }).then(() => true, () => false);
  const shell = mounted && await R(pg, (r) => { const p = r.querySelector('.gpa-panel'); const b = p.getBoundingClientRect(); return { cls: p.className, w: Math.round(b.width), h: Math.round(b.height), vw: innerWidth, vh: innerHeight }; });
  check('Opened from disk (file://) the console starts, full screen, as the offline file', url.startsWith('file://') && mounted && /gpa-app/.test(shell.cls) && /gpa-file/.test(shell.cls) && shell.w >= shell.vw * 0.95 && shell.h >= shell.vh * 0.95, JSON.stringify(shell));
  await pg.screenshot({ path: path.join(OUT, '01-sign-in.png') });

  // ---- 2: sign up from the file ----
  await pg.evaluate((u) => { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); }, env.workerUrl);
  await pg.fill(sr('#gpa-login-user'), 'file' + run);
  await pg.fill(sr('#gpa-login-pin'), '246810');
  await pg.click(sr('#gpa-signup-btn'));
  const signedIn = await waitFor(pg, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 15000);
  await R(pg, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  await pg.waitForTimeout(1500);
  const still = await R(pg, (r) => r.querySelector('#gpa-login').style.display === 'none');
  check('Sign-up goes to the Worker from the file (Origin "null") and stays signed in', signedIn && still && authOrigins.length > 0 && authOrigins.every((o) => o === 'null'), JSON.stringify(authOrigins));
  const acct = await (await fetch(env.workerUrl + '/admin/users', { headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef' } }).catch(() => null))?.json().catch(() => null);
  if (acct) check('…and the Worker has the account', JSON.stringify(acct).includes('file' + run));

  const tab = await pg.evaluate(() => ({ title: document.title, icons: [...document.querySelectorAll('link[rel~="icon"]')].map((l) => l.href.slice(0, 22)) }));
  check('The tab looks blank: title "about:blank" and a transparent icon, also after sign-in', tab.title === 'about:blank' && tab.icons.length === 1 && tab.icons[0] === 'data:image/gif;base64,', JSON.stringify(tab));

  // ---- 3: Ask AI and slash commands ----
  await R(pg, (r) => r.querySelector('.gpa-dropdown-item[data-tab="ask"]').click());
  await pg.waitForTimeout(400);
  await pg.fill(sr('#gpa-ask-input'), 'hello?');
  await pg.press(sr('#gpa-ask-input'), 'Enter');
  const answered = await waitFor(pg, (r) => /Hello from the offline file/.test([...r.querySelectorAll('.gpa-msg.ai')].pop()?.innerText || ''), null, 15000);
  check('Ask AI answers (streamed) from the file, request sent with Origin "null"', answered && origins.includes('null'), JSON.stringify([...new Set(origins)]));
  await pg.fill(sr('#gpa-ask-input'), '/help');
  await pg.press(sr('#gpa-ask-input'), 'Escape');
  await R(pg, (r) => r.querySelector('#gpa-ask-btn').click());
  check('Slash commands work (/help)', await waitFor(pg, (r) => /\/solve/.test([...r.querySelectorAll('.gpa-msg.ai')].pop()?.innerText || ''), null, 5000));
  await pg.screenshot({ path: path.join(OUT, '02-ask.png') });

  // ---- 4: chat ----
  await R(pg, (r) => r.querySelector('.gpa-dropdown-item[data-tab="chat"]').click());
  await pg.waitForTimeout(1200);
  const line = 'hi from a file ' + run;
  await pg.fill(sr('#gpa-chat-input'), line);
  await pg.click(sr('#gpa-chat-send'));
  const posted = await waitFor(pg, (r, l) => (r.querySelector('#gpa-chat-log')?.innerText || '').includes(l), line, 15000);
  const poll = await (await fetch(env.workerUrl + '/chat/poll?room=public&since=0')).json().catch(() => ({}));
  check('Chat: a message sent from the file reaches the room', posted && JSON.stringify(poll.messages || []).includes(line));
  await pg.screenshot({ path: path.join(OUT, '03-chat.png') });

  // ---- 5: WebSocket ----
  const ws = await pg.evaluate((u) => new Promise((res) => { const s = new WebSocket(u); const t = setTimeout(() => res('timeout'), 5000); s.onopen = () => { clearTimeout(t); res('open'); s.close(); }; s.onerror = () => { clearTimeout(t); res('error'); }; }), `ws://127.0.0.1:${wsServer.address().port}/`);
  check('A WebSocket opens from the file page', ws === 'open' && wsSeen[0] === 'null', ws + ' origin=' + wsSeen[0]);

  // ---- 6: reload the file ----
  await pg.reload();
  await pg.waitForFunction(() => !!document.getElementById('gpa-root-host'), null, { timeout: 20000 });
  const back = await waitFor(pg, (r) => r.querySelector('#gpa-login').style.display === 'none', null, 15000);
  check('Reloading the file keeps you signed in (storage persists for file pages)', back);

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await env.close();
  wsServer.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
