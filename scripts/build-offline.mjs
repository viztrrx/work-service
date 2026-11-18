// Builds the offline console: ONE .html file with script.js inside it, opened
// straight from disk (double-click, or drag it into Chrome) the way an
// offline Eaglercraft file is. It runs the full console as a full-screen page
// and talks to the live Worker with fetch, exactly like the injected console.
//
//   npm run build:offline                      → build/saints-service.html
//   node scripts/build-offline.mjs --out x.html
//   node scripts/build-offline.mjs --worker http://127.0.0.1:8787   (tests)
//
// script.js goes in as base64 so nothing inside it (a "</script>" in a string,
// an HTML comment) can end the page's <script> early; the page decodes it and
// runs it with the same global eval the bookmarklet uses.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const out = path.resolve(arg('out') || path.join(ROOT, 'build', 'saints-service.html'));
const worker = arg('worker');

const LIVE = "const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';";
let code = await readFile(path.join(ROOT, 'script.js'), 'utf8');
if (!code.includes(LIVE)) throw new Error('script.js no longer sets OPENAI_PROXY the expected way; update scripts/build-offline.mjs');
if (worker) code = code.replace(LIVE, `const OPENAI_PROXY = ${JSON.stringify(worker.replace(/\/+$/, ''))};`);
const b64 = Buffer.from(code + '\n//# sourceURL=saints-service.js\n', 'utf8').toString('base64');
const icon = 'data:image/png;base64,' + (await readFile(path.join(ROOT, 'web/console/public/icon-192.png'))).toString('base64');
const built = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="generator" content="saints-service build-offline (${built})">
<title>Saints Service</title>
<link rel="icon" type="image/png" href="${icon}">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; background: #0b0c0f; color: #e8eaed; overflow: hidden;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .boot { min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; padding: 24px; text-align: center; }
  .boot img { width: 72px; height: 72px; border-radius: 18px; }
  .boot h1 { margin: 6px 0 0; font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }
  .boot p { margin: 0; color: #9aa3ad; max-width: 46ch; }
  .boot pre { margin: 6px 0 0; max-width: 90vw; white-space: pre-wrap; color: #f2a39b; font-size: 12px; }
</style>
</head>
<body>
<main class="boot" id="boot" aria-live="polite">
  <img src="${icon}" alt="">
  <h1>Saints Service</h1>
  <p id="boot-msg">Loading…</p>
</main>
<noscript><p class="boot">Saints Service needs JavaScript.</p></noscript>
<script id="saints-service-code" type="application/octet-stream">${b64}</script>
<script>
(function () {
  'use strict';
  // Full-screen console, no page underneath (see FILE_MODE in script.js).
  window.__agentConsoleFile = true;
  var boot = document.getElementById('boot');
  var msg = document.getElementById('boot-msg');
  function fail(e) {
    msg.textContent = 'The console didn\\u2019t start.';
    var pre = document.createElement('pre');
    pre.textContent = String(e && (e.stack || e.message) || e);
    boot.appendChild(pre);
  }
  try {
    var b64 = document.getElementById('saints-service-code').textContent.trim();
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var code = new TextDecoder('utf-8').decode(bytes);
    (0, eval)(code);
    if (document.getElementById('gpa-root-host')) boot.remove();
    else fail('script.js ran but did not mount the console.');
  } catch (e) { fail(e); }
})();
</script>
</body>
</html>
`;
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`Wrote ${path.relative(process.cwd(), out) || out} (${(html.length / 1048576).toFixed(1)} MB${worker ? ', Worker ' + worker : ', live Worker'})`);
console.log('Open it from disk: double-click it, or drag it into a Chrome window.');
