// Ask AI as an agent, end to end in Chromium: the real console (script.js)
// against worker.js in workerd (sign-in), and a local stand-in for OpenAI
// that streams the Responses API's events (gated, so "while it runs" is
// checked for certain). Covers:
//   1. smart paste: copying a quiz question on the page (KaTeX equation, a
//      Canvas equation image, pictures from this site, another site with
//      CORS, and one without) pastes the text with LaTeX + "[Image N]" and
//      attaches the pictures; the clipboard's HTML from elsewhere too
//   2. files: Word (text pulled out), PDF (sent as a file), text; drag and
//      drop; a binary and an old .doc refused with a reason
//   3. one question that uses the tools on its own: a web search, a picture
//      (partial → final), then an answer with math (MathML), a link, sources,
//      and two files it made (.docx + .csv) that download and open
//   4. the files stay in the chat (sent again), and can be removed
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';
import { officeText, crc32 } from '../../web/ai-files.js';

const OUT = process.argv[2] || 'ai-tools-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A real PNG: a graph of y = x² (what the AI "draws").
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const graph = (blur) => png(240, 240, (x, y) => {
  const X = (x - 120) / 30, Y = (120 - y) / 30, curve = Math.abs(Y - X * X / 2) < 0.06 * (1 + Math.abs(X)), axis = Math.abs(x - 120) < 1 || Math.abs(y - 120) < 1, grid = x % 30 === 0 || y % 30 === 0;
  if (blur) return curve ? [140, 160, 230] : [235, 238, 245];
  return curve ? [40, 90, 220] : axis ? [60, 60, 60] : grid ? [225, 228, 236] : [255, 255, 255];
});
const GRAPH = graph(false).toString('base64'), GRAPH_PARTIAL = graph(true).toString('base64');
const DOT = png(60, 40, (x, y) => (Math.hypot(x - 30, y - 20) < 14 ? [220, 60, 60] : [250, 250, 250]));

// ---- The OpenAI stand-in ----
const seen = [];
const gates = {};
let gated = true;
const gate = (name) => (gated ? new Promise((r) => { gates[name] = r; }) : Promise.resolve());
const release = async (name) => { for (let i = 0; i < 300 && !gates[name]; i++) await sleep(25); if (gates[name]) gates[name](); };
const ANSWER = [
  'The parabola \\(y = \\frac{1}{2}x^2\\) opens upward with its vertex at \\((0, 0)\\).',
  '',
  'For the worksheet’s triangle, \\[A = \\frac{1}{2}bh = \\frac{1}{2}(8)(5) = 20\\ \\text{cm}^2\\]',
  'I checked the formula at [Khan Academy](https://www.khanacademy.org/math/geometry) and your PDF chapter.',
  '```file name="study-guide.docx"',
  '# Study guide: Unit 4',
  '- Area of a triangle: \\(A = \\frac{1}{2}bh\\)',
  '- **Vertex** of \\(y = ax^2\\) is the origin',
  '```',
  '```file name="scores.csv"',
  'Question,Answer,Points',
  '3,20 cm²,4',
  '```',
  'CONFIDENCE: 93'
].join('\n');
const openai = await serve((rq, rs) => {
  rs.setHeader('Access-Control-Allow-Origin', '*');
  rs.setHeader('Access-Control-Allow-Headers', '*');
  rs.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (rq.method === 'OPTIONS') { rs.statusCode = 204; rs.end(); return; }
  let b = '';
  rq.on('data', (c) => { b += c; });
  rq.on('end', async () => {
    let body = {};
    try { body = JSON.parse(b || '{}'); } catch (e) { /* ignore */ }
    seen.push({ path: rq.url, body });
    if (rq.url !== '/v1/responses') { rs.statusCode = 404; rs.end('{}'); return; }
    rs.setHeader('Content-Type', 'text/event-stream');
    rs.flushHeaders();
    const send = (type, data) => rs.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('response.created', { response: { id: 'r1', model: body.model } });
    const text = JSON.stringify(body.input);
    const wantTools = /study guide/i.test(text);
    if (wantTools) {
      send('response.output_item.added', { output_index: 0, item: { id: 'ws_1', type: 'web_search_call', status: 'in_progress' } });
      await gate('search');
      send('response.output_item.done', { output_index: 0, item: { id: 'ws_1', type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'area of a triangle formula' } } });
      send('response.output_item.added', { output_index: 1, item: { id: 'ig_1', type: 'image_generation_call', status: 'in_progress' } });
      send('response.image_generation_call.partial_image', { item_id: 'ig_1', partial_image_index: 0, partial_image_b64: GRAPH_PARTIAL });
      await gate('image');
      send('response.output_item.done', { output_index: 1, item: { id: 'ig_1', type: 'image_generation_call', status: 'completed', result: GRAPH } });
    }
    const answer = wantTools ? ANSWER : 'Got it: your files are still here.\n\nThe worksheet asks for the triangle’s area.\nCONFIDENCE: 90';
    const pieces = answer.match(/[\s\S]{1,24}/g);
    for (let i = 0; i < pieces.length; i++) { if (wantTools && i === 6) await gate('mid'); send('response.output_text.delta', { delta: pieces[i] }); await sleep(15); }
    if (wantTools) send('response.output_text.annotation.added', { annotation: { type: 'url_citation', url: 'https://www.khanacademy.org/math/geometry', title: 'Geometry | Khan Academy', start_index: 0, end_index: 10 } });
    send('response.completed', { response: { id: 'r1', model: body.model, output: [{ type: 'message', content: [{ type: 'output_text', text: answer, annotations: wantTools ? [{ type: 'url_citation', url: 'https://www.mathsisfun.com/algebra/parabola.html', title: 'Parabola' }] : [] }] }] } });
    rs.end();
    if (wantTools) gated = false;
  });
});
// Pictures on other sites: one allows any site (CORS), one doesn't.
const cors = await serve((rq, rs) => { rs.setHeader('Access-Control-Allow-Origin', '*'); rs.setHeader('Content-Type', 'image/png'); rs.end(DOT); });
const nocors = await serve((rq, rs) => { rs.setHeader('Content-Type', 'image/png'); rs.end(DOT); });
const PROXY = `http://127.0.0.1:${openai.port}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace("const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';", `const OPENAI_PROXY = '${PROXY}';`);
if (!code.includes(PROXY)) throw new Error('could not point the console at the stand-in');

const TRIANGLE = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110"><rect width="160" height="110" fill="#fff"/><polygon points="10,100 150,100 60,15" fill="#dbe7ff" stroke="#2a4fb0" stroke-width="3"/><text x="70" y="96" font-size="13" font-family="sans-serif">b = 8 cm</text><line x1="60" y1="15" x2="60" y2="100" stroke="#b03030" stroke-dasharray="4 3"/><text x="64" y="60" font-size="13" font-family="sans-serif" fill="#b03030">h = 5</text></svg>';
const QUIZ = `<!doctype html><html><head><meta charset="utf-8"><title>Unit 4 Quiz</title></head><body style="font-family:sans-serif;padding:24px;max-width:640px">
<h1>Unit 4 Quiz</h1>
<div id="q3"><p>3. Find the area of the triangle below, where <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>b</mi><mo>=</mo><mn>8</mn></mrow><annotation encoding="application/x-tex">b = 8</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">b=8</span></span> cm.</p>
<img id="tri" src="/triangle.svg" width="160" height="110" alt="triangle">
<p>Use <img class="equation_image" data-equation-content="A = \\frac{1}{2}bh" alt="LaTeX: A = \\frac{1}{2}bh" src="/eq.svg" width="90" height="22"> and give units.</p>
<p>Reference pictures: <img id="far" src="http://127.0.0.1:${cors.port}/dot.png" width="60" height="40"> <img id="locked" src="http://127.0.0.1:${nocors.port}/dot.png" width="60" height="40"></p>
<p style="display:none">hidden answer key: 42</p></div>
</body></html>`;
const site = await serve((rq, rs) => {
  if (rq.url === '/triangle.svg') { rs.setHeader('Content-Type', 'image/svg+xml'); rs.end(TRIANGLE); return; }
  if (rq.url === '/eq.svg') { rs.setHeader('Content-Type', 'image/svg+xml'); rs.end('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="22"><text y="16" font-size="14">A=½bh</text></svg>'); return; }
  rs.setHeader('Content-Type', 'text/html'); rs.end(QUIZ);
});
const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef' } });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms, polling: 50 }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
async function shot(page, file, caption, clip) {
  const b = clip || await R(page, (r) => { const x = r.querySelector('.gpa-panel').getBoundingClientRect(); return { x: x.left, y: x.top, width: x.width, height: x.height }; });
  const CAP = 40;
  await page.evaluate(([c, x, y, w]) => {
    let el = document.getElementById('shot-caption');
    if (!el) { el = document.createElement('div'); el.id = 'shot-caption'; document.documentElement.appendChild(el); }
    Object.assign(el.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: w + 'px', height: '40px', zIndex: 2147483647, background: '#f5a524', color: '#111', font: '600 15px/40px system-ui, sans-serif', textAlign: 'center' });
    el.textContent = c;
  }, [caption, b.x, b.y - CAP, b.width]);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: b.x, y: Math.max(0, b.y - CAP), width: b.width, height: b.height + CAP } });
  await page.evaluate(() => document.getElementById('shot-caption')?.remove());
}
const responses = () => seen.filter((x) => x.path === '/v1/responses');

let pg;
try {
  await fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef', 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 940 }, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${site.port}` });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); } catch (e) { /* ignore */ } }, env.workerUrl);
  pg = await ctx.newPage();
  pg._errors = [];
  pg.on('pageerror', (e) => pg._errors.push(String(e)));
  await pg.goto(`http://127.0.0.1:${site.port}/`);
  await pg.waitForFunction(() => [...document.images].every((i) => i.complete));
  await pg.evaluate((c) => { (0, eval)(c); }, code);
  await pg.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await pg.fill(sr('#gpa-login-user'), 'agent' + run);
  await pg.fill(sr('#gpa-login-pin'), '246810');
  await pg.click(sr('#gpa-signup-btn'));
  await pg.waitForTimeout(2500);
  await R(pg, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  check('Signed in', await R(pg, (r) => r.querySelector('#gpa-login').style.display === 'none'));
  await R(pg, (r) => { r.querySelector('.size-btn[data-size="full"]')?.click(); r.querySelector('.gpa-dropdown-item[data-tab="ask"]').click(); });
  await pg.waitForTimeout(700);

  // ---- 1: smart paste ----
  await R(pg, () => { const s = document.getSelection(); s.removeAllRanges(); const r = document.createRange(); r.selectNodeContents(document.getElementById('q3')); s.addRange(r); });
  await pg.keyboard.press('Control+C');
  await pg.waitForTimeout(300);
  await pg.click(sr('#gpa-ask-input'));
  await pg.keyboard.press('Control+V');
  const pasted = await waitFor(pg, (r) => r.querySelectorAll('#gpa-ask-images img').length >= 3, null, 15000);
  const p1 = await R(pg, (r) => ({ text: r.querySelector('#gpa-ask-input').value, imgs: [...r.querySelectorAll('#gpa-ask-images img')].map((i) => i.src.slice(0, 40)) }));
  check('Paste: equations come as LaTeX (KaTeX and Canvas’s equation image), pictures as “[Image N]” where they were, hidden text left out',
    pasted && p1.text.includes('where \\(b = 8\\) cm.') && p1.text.includes('Use \\(A = \\frac{1}{2}bh\\) and give units.') && /\[Image 1\][\s\S]*Use[\s\S]*\[Image 2\][\s\S]*\[Image 3\]$/.test(p1.text) && !/42/.test(p1.text) && !/b=8/.test(p1.text.replace('b = 8', '')),
    JSON.stringify(p1.text));
  check('…and the pictures are attached: this site’s (drawn), another site’s that allows it (fetched), and one that doesn’t (sent as its link for OpenAI)',
    p1.imgs.length === 3 && p1.imgs[0].startsWith('data:image/png') && p1.imgs[1].startsWith('data:image/png') && p1.imgs[2].startsWith('http://127.0.0.1:' + nocors.port), JSON.stringify(p1.imgs));
  await shot(pg, '01-smart-paste.png', 'Copied the quiz question on the page → pasted into Ask AI');
  // From somewhere else: the clipboard's HTML.
  await R(pg, (r) => { const ta = r.querySelector('#gpa-ask-input'); ta.value = ''; for (let k = 0; k < 20 && r.querySelector('#gpa-ask-images button'); k++) r.querySelector('#gpa-ask-images button').click(); });
  await R(pg, (r, port) => {
    const ta = r.querySelector('#gpa-ask-input'); ta.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', 'Graph y = x^2 like this');
    dt.setData('text/html', `<p>Graph <span class="katex"><math><semantics><mi>y</mi><annotation encoding="application/x-tex">y = x^2</annotation></semantics></math></span> like this:</p><img src="http://127.0.0.1:${port}/dot.png" width="60" height="40">`);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, cors.port);
  const fromHtml = await waitFor(pg, (r) => r.querySelectorAll('#gpa-ask-images img').length === 1, null, 10000);
  const p2 = await R(pg, (r) => ({ text: r.querySelector('#gpa-ask-input').value, img: r.querySelector('#gpa-ask-images img').src.slice(0, 22) }));
  check('Paste from another tab/app: the clipboard’s HTML gives the same (LaTeX + the picture)', fromHtml && p2.text === 'Graph \\(y = x^2\\) like this: [Image 1]' && p2.img === 'data:image/png;base64,', JSON.stringify(p2));
  await R(pg, (r) => { r.querySelector('#gpa-ask-input').value = ''; for (let k = 0; k < 20 && r.querySelector('#gpa-ask-images button'); k++) r.querySelector('#gpa-ask-images button').click(); });

  // ---- 2: files ----
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]/Contents 4 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>>>endobj 4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 50 Td (Chapter 5: Parabolas) Tj ET\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  await pg.setInputFiles(sr('#gpa-ask-file'), [
    { name: 'worksheet.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(path.join(ROOT, 'tests/fixtures/office/worksheet.docx')) },
    { name: 'chapter-5.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'program.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 3, 0, 255, 0]) },
    { name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('xx') }
  ]);
  const chips = await waitFor(pg, (r) => r.querySelectorAll('.gpx-filechip').length === 2, null, 8000);
  const toast = await R(pg, (r) => [...r.querySelectorAll('.gpa-toast, [class*="toast"]')].map((t) => t.textContent).join(' | '));
  check('Attach: Word and PDF are added; a binary and an old .doc are refused with the reason', chips && /program\.bin isn’t something the AI can read/.test(toast) && /old\.doc: save it as \.docx/.test(toast), toast.slice(0, 300));
  // Drag and drop a text file onto the tab.
  await R(pg, (r) => {
    const pane = r.querySelector('.gpa-pane[data-pane="ask"]');
    const dt = new DataTransfer(); dt.items.add(new File(['Vocabulary: vertex, axis of symmetry, parabola\n'], 'notes.txt', { type: 'text/plain' }));
    pane.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
    pane.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  const dropShown = await R(pg, (r) => !r.querySelector('#gpa-ask-drop').hidden);
  await shot(pg, '02-drop-zone.png', 'Dragging a file over Ask AI');
  await R(pg, (r) => {
    const pane = r.querySelector('.gpa-pane[data-pane="ask"]');
    const dt = new DataTransfer(); dt.items.add(new File(['Vocabulary: vertex, axis of symmetry, parabola\n'], 'notes.txt', { type: 'text/plain' }));
    pane.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  const dropped = await waitFor(pg, (r) => r.querySelectorAll('.gpx-filechip').length === 3, null, 8000);
  const names = await R(pg, (r) => [...r.querySelectorAll('.gpx-filechip')].map((c) => c.querySelector('.gpx-filechip-ext').textContent + ':' + c.querySelector('.gpx-filechip-name').textContent));
  check('Drag and drop: “Drop files…” shows, and the dropped file joins them', dropShown && dropped && names.join(',') === 'DOCX:worksheet.docx,PDF:chapter-5.pdf,TXT:notes.txt', names.join(','));
  // Pictures pasted again for the question (the quiz copy is still the last copy).
  await pg.click(sr('#gpa-ask-input'));
  await pg.keyboard.press('Control+V');
  await waitFor(pg, (r) => r.querySelectorAll('#gpa-ask-images img').length >= 3, null, 15000);
  await R(pg, (r) => { const ta = r.querySelector('#gpa-ask-input'); ta.value = 'Make me a study guide from my worksheet and chapter, answer question 3, and draw y = ½x².\n' + ta.value; ta.dispatchEvent(new Event('input', { bubbles: true })); });
  const multi = await R(pg, (r) => { const ta = r.querySelector('#gpa-ask-input'); return { lines: ta.value.split('\n').length, h: ta.getBoundingClientRect().height }; });
  check('The message box takes several lines and grows', multi.lines >= 3 && multi.h > 50, JSON.stringify(multi));
  await shot(pg, '03-files-and-pictures.png', 'Files + pasted pictures, ready to send');

  // ---- 3: one question, the AI uses its tools ----
  await pg.press(sr('#gpa-ask-input'), 'Enter');
  const searching = await waitFor(pg, (r) => /Searching the web…/.test(r.querySelector('.gpx-think')?.textContent || ''), null, 10000);
  check('While it runs: “Searching the web…” in the thinking panel', searching);
  await release('search');
  const imaging = await waitFor(pg, (r) => /Searched the web for “area of a triangle formula”/.test(r.querySelector('.gpx-think').textContent) && /Creating an image…/.test(r.querySelector('.gpx-think').textContent) && !!r.querySelector('.gpx-gen.is-partial img[src^="data:image/png"]'), null, 10000);
  check('…then “Searched the web for …”, “Creating an image…”, and the picture appears blurry while it’s made', imaging);
  const userMath = await R(pg, (r) => { const u = [...r.querySelectorAll('.gpa-msg.user')].pop(); return { math: u.querySelectorAll('math').length, raw: /\\\(|\\frac/.test(u.textContent), dots: !![...r.querySelectorAll('.gpa-msg.ai')].pop().querySelector(':scope > .gpx-typing-dots') }; });
  check('The question shows its equations as math (not \\( … \\)), and no typing dots over the picture being made', userMath.math === 2 && !userMath.raw && !userMath.dots, JSON.stringify(userMath));
  await shot(pg, '04-agent-working.png', 'The AI searches the web and draws, on its own');
  await release('image');
  await release('mid');
  const done = await waitFor(pg, (r) => { const a = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return a && a.querySelectorAll('.gpx-file:not(.is-writing)').length === 2 && !!a.querySelector('.gpx-sources'); }, null, 15000);
  const ans = await R(pg, (r) => {
    const a = [...r.querySelectorAll('.gpa-msg.ai')].pop(), t = r.querySelector('.gpx-think');
    return {
      label: t.querySelector('.gpx-think-label').textContent,
      math: [...a.querySelectorAll('.gpx-math')].map((m) => (m.classList.contains('gpx-math-block') ? 'D:' : 'M:') + m.dataset.tex),
      mfrac: a.querySelectorAll('math mfrac').length, mathRendered: [...a.querySelectorAll('math')].every((m) => m.getBoundingClientRect().width > 4),
      files: [...a.querySelectorAll('.gpx-file')].map((f) => f.dataset.name + ' — ' + f.querySelector('small').textContent),
      link: (a.querySelector('.gpx-rich a') || {}).href, sources: [...a.querySelectorAll('.gpx-sources a')].map((x) => x.href),
      img: !!a.querySelector('.gpx-gen:not(.is-partial) img[src^="data:image/png"]') && !!a.querySelector('.gpx-gen a[download="ai-picture-1.png"]'),
      raw: /```|CONFIDENCE|\\frac/.test(a.querySelector('.gpx-rich').innerText), chip: a.querySelector('.gpx-answer-chip')?.textContent
    };
  });
  // (An attached PDF makes it a hard question, so a reasoning model answers: "Thought for…".)
  check('Done: it folds to what it did: “Thought for Ns · searched the web, made an image”', done && /^Thought for \d+s · searched the web, made an image$/.test(ans.label), ans.label);
  check('Math shows as real math (MathML, drawn by the browser): inline and a displayed formula with fractions', ans.math.join('|') === 'M:y = \\frac{1}{2}x^2|M:(0, 0)|D:A = \\frac{1}{2}bh = \\frac{1}{2}(8)(5) = 20\\ \\text{cm}^2' && ans.mfrac === 3 && ans.mathRendered && !ans.raw, JSON.stringify({ math: ans.math, mfrac: ans.mfrac, drawn: ans.mathRendered, rawLeft: ans.raw }));
  check('The two files it made show as cards (Word document, CSV)', ans.files.join(' | ') === 'study-guide.docx — Word document · ' + ans.files[0].split(' · ')[1] + ' | scores.csv — Spreadsheet (CSV) · ' + Buffer.byteLength('Question,Answer,Points\n3,20 cm²,4\n') + ' B', ans.files.join(' | '));
  check('Its link and its sources (from the web search) are clickable', ans.link === 'https://www.khanacademy.org/math/geometry' && ans.sources.join(',') === 'https://www.khanacademy.org/math/geometry,https://www.mathsisfun.com/algebra/parabola.html', JSON.stringify([ans.link, ans.sources]));
  check('The picture it made, with Download', ans.img);
  await R(pg, (r) => { const a = [...r.querySelectorAll('.gpa-msg.ai')].pop(); a.scrollIntoView({ block: 'start' }); });
  await shot(pg, '05-answer-math-files-picture.png', 'The answer: math, a picture, sources, and files it made');
  // Download the Word file and open it.
  const [dl] = await Promise.all([pg.waitForEvent('download'), R(pg, (r) => [...r.querySelectorAll('.gpx-file')].find((f) => f.dataset.name === 'study-guide.docx').querySelector('[data-act="download"]').click())]);
  const docPath = path.join(OUT, 'downloaded-study-guide.docx');
  await dl.saveAs(docPath);
  const docText = await officeText(new Uint8Array(fs.readFileSync(docPath)), 'study-guide.docx');
  check('Download: study-guide.docx is a real Word file with the guide in it (math as symbols)', dl.suggestedFilename() === 'study-guide.docx' && docText === 'Study guide: Unit 4\n•\tArea of a triangle: A = (1/2)bh\n•\tVertex of y = ax² is the origin', JSON.stringify(docText));
  const [dl2] = await Promise.all([pg.waitForEvent('download'), R(pg, (r) => [...r.querySelectorAll('.gpx-file')].find((f) => f.dataset.name === 'scores.csv').querySelector('[data-act="download"]').click())]);
  const csvPath = path.join(OUT, 'downloaded-scores.csv'); await dl2.saveAs(csvPath);
  check('Download: scores.csv', fs.readFileSync(csvPath, 'utf8') === 'Question,Answer,Points\n3,20 cm²,4\n');
  // What went to OpenAI.
  const req = responses().pop().body;
  const parts = req.input[0].content;
  check('Sent: the tools (web search, pictures), the PDF as a file, Word as its text, the dropped notes, and the 3 pictures',
    JSON.stringify(req.tools) === JSON.stringify([{ type: 'web_search' }, { type: 'image_generation', partial_images: 2, size: 'auto', quality: 'auto' }])
    && parts.some((p) => p.type === 'input_file' && p.filename === 'chapter-5.pdf' && p.file_data.startsWith('data:application/pdf;base64,'))
    && parts.some((p) => p.type === 'input_text' && p.text.startsWith('ATTACHED FILE "worksheet.docx":\nUnit 4 Quiz\n1. Solve 2x + 3 = 11'))
    && parts.some((p) => p.type === 'input_text' && p.text.includes('Vocabulary: vertex'))
    && parts.filter((p) => p.type === 'input_image').length === 3
    && /MATH — write every formula in LaTeX/.test(req.instructions) && /FILES — /.test(req.instructions),
    JSON.stringify(parts.map((p) => p.type + (p.filename ? ':' + p.filename : ''))));

  // ---- 4: the files stay in the chat ----
  const inChat = await R(pg, (r) => ({ label: r.querySelector('.gpx-files-label')?.textContent, n: r.querySelectorAll('.gpx-filechip').length }));
  check('After sending, the files stay as “In this chat”', inChat.label === 'In this chat' && inChat.n === 3, JSON.stringify(inChat));
  await pg.fill(sr('#gpa-ask-input'), 'Thanks! What does the worksheet ask?');
  await pg.press(sr('#gpa-ask-input'), 'Enter');
  await waitFor(pg, (r) => /your files are still here/.test([...r.querySelectorAll('.gpa-msg.ai')].pop().textContent), null, 10000);
  const again = responses().pop().body.input[0].content;
  check('…and are sent again with the next question', again.some((p) => p.type === 'input_file') && again.some((p) => p.type === 'input_text' && p.text.startsWith('ATTACHED FILE "worksheet.docx"')));
  await R(pg, (r) => [...r.querySelectorAll('.gpx-filechip')].find((c) => /chapter-5/.test(c.textContent)).querySelector('button').click());
  await pg.fill(sr('#gpa-ask-input'), 'And now?');
  await pg.press(sr('#gpa-ask-input'), 'Enter');
  await waitFor(pg, (r) => [...r.querySelectorAll('.gpa-msg.ai')].length >= 3 && /your files are still here/.test([...r.querySelectorAll('.gpa-msg.ai')].pop().textContent), null, 10000);
  const after = responses().pop().body.input[0].content;
  check('A removed file isn’t sent any more', !after.some((p) => p.type === 'input_file') && after.some((p) => p.type === 'input_text' && p.text.startsWith('ATTACHED FILE "worksheet.docx"')));
  check('No page errors', pg._errors.length === 0, pg._errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await env.close();
  for (const s of [site, openai, cors, nocors]) await s.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
