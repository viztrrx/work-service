// The offline console: ONE .html file with script.js inside it, opened straight
// from disk (double-click, or drag it into Chrome) the way an offline
// Eaglercraft file is. It runs the full console full screen (FILE_MODE in
// script.js) and talks to the Worker with fetch, like the injected console.
//
// Shared by scripts/build-offline.mjs (npm run build:offline) and the Worker,
// which builds it on request: opening the Worker's address downloads it (see
// offlineRoute below). Runs in Node and in Workers: no Buffer, no fs.
//
// script.js goes in as base64 so nothing inside it (a "</script>" in a string,
// an HTML comment) can end the page's <script> early; the page decodes it and
// runs it with the same global eval the bookmarklet uses.

export const OFFLINE_FILENAME = 'saints-service.html';
// The browser tab shows a blank page: the title "about:blank" and a
// transparent 1×1 icon (an empty icon would let Chrome show its default).
export const TAB_TITLE = 'about:blank';
export const BLANK_ICON = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const OFFLINE_PATH = '/download/' + OFFLINE_FILENAME;
// The line in script.js that names the Worker; a build for another Worker
// (a test one, a fork) swaps it.
export const LIVE_PROXY_LINE = "const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';";

export function pointAtWorker(code, workerUrl) {
  if (!code.includes(LIVE_PROXY_LINE)) throw new Error('script.js no longer sets OPENAI_PROXY the expected way; update web/offline.js');
  return workerUrl ? code.replace(LIVE_PROXY_LINE, 'const OPENAI_PROXY = ' + JSON.stringify(String(workerUrl).replace(/\/+$/, '')) + ';') : code;
}

// UTF-8 text → base64, in chunks (String.fromCharCode can't take 2 MB at once).
export function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// code: script.js's text (already pointed at its Worker). iconBase64: the
// app icon PNG as base64. built: a label for when it was made.
export function offlineHtml(code, { iconBase64 = '', built = '' } = {}) {
  const b64 = textToBase64(code + '\n//# sourceURL=saints-service.js\n');
  const icon = iconBase64 ? 'data:image/png;base64,' + iconBase64 : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="generator" content="saints-service offline file${built ? ' (' + built + ')' : ''}">
<title>${TAB_TITLE}</title>
<link rel="icon" type="image/gif" href="${BLANK_ICON}">
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
  ${icon ? `<img src="${icon}" alt="">` : ''}
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
}

// The page at the Worker's own address: it starts the download the moment it
// opens, and keeps a link in case the browser held the automatic one back.
export function downloadPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${TAB_TITLE}</title>
<link rel="icon" type="image/gif" href="${BLANK_ICON}">
<style>
  html, body { margin: 0; height: 100%; background: #0b0c0f; color: #e8eaed;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { min-height: 100%; box-sizing: border-box; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; padding: 24px; text-align: center; }
  h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }
  p { margin: 0; color: #9aa3ad; max-width: 48ch; }
  a { color: #2dd4bf; }
  .btn { display: inline-block; margin-top: 8px; padding: 10px 18px; border-radius: 12px; border: 1px solid #2b313a;
    background: #171a20; color: #e8eaed; text-decoration: none; font-weight: 600; }
  .btn:focus-visible { outline: 2px solid #2dd4bf; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>Saints Service</h1>
  <p id="msg">Downloading <b>${OFFLINE_FILENAME}</b>…</p>
  <p>When it's done, open the file (double-click it, or drag it into Chrome).</p>
  <a class="btn" id="dl" href="${OFFLINE_PATH}" download="${OFFLINE_FILENAME}">Didn't start? Download it</a>
</main>
<script>document.getElementById('dl').click();</script>
</body>
</html>
`;
}
