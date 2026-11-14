// Live thinking in Ask AI, end to end in Chromium with the real console
// (script.js) against worker.js in workerd for sign-in, and a local stand-in
// for OpenAI that streams the Responses API's server-sent events with real
// pauses between them (so "live" is tested, not just the final picture):
//   1. a hard question: "Thinking" + timer while the reasoning streams in,
//      step headings, the answer streaming under it, then "Thought for Ns"
//      folded (tap to open), the answer formatted with no CONFIDENCE line
//   2. an easy question (a model that doesn't reason): the shimmer while
//      waiting, then no empty panel
//   3. an OpenAI org that can't get reasoning summaries (400): one retry
//      without them, "Thought for Ns" without a body, and no more asking
//   4. a proxy without /v1/responses (404): the plain request still answers
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT, HOST_PAGE } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'ai-thinking-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- The OpenAI stand-in ----
let mode = 'normal';   // normal | no-summary | no-responses
const seen = [];
// Gates: the first hard answer pauses before step 2, before the answer, and
// halfway through the answer until the test lets it go, so "while it's still
// running" is checked for certain, not by racing a timer.
let gated = true;
const gates = {};
const gate = (name) => (gated ? new Promise((r) => { gates[name] = r; }) : Promise.resolve());
const release = async (name) => { for (let i = 0; i < 200 && !gates[name]; i++) await sleep(25); if (gates[name]) gates[name](); };
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
    seen.push({ path: rq.url, body, at: Date.now() });
    if (rq.url === '/v1/chat/completions') {
      rs.setHeader('Content-Type', 'application/json');
      rs.end(JSON.stringify({ choices: [{ message: { content: 'Plain answer.\n\nFrom the non-streaming route.\nCONFIDENCE: 80' } }] }));
      return;
    }
    if (rq.url !== '/v1/responses' || mode === 'no-responses') { rs.statusCode = 404; rs.setHeader('Content-Type', 'application/json'); rs.end(JSON.stringify({ error: { message: 'not here' } })); return; }
    if (mode === 'no-summary' && body.reasoning && body.reasoning.summary) {
      rs.statusCode = 400; rs.setHeader('Content-Type', 'application/json');
      rs.end(JSON.stringify({ error: { message: 'Your organization must be verified to generate reasoning summaries.', type: 'invalid_request_error', param: 'reasoning.summary' } }));
      return;
    }
    rs.setHeader('Content-Type', 'text/event-stream');
    rs.setHeader('Cache-Control', 'no-cache');
    rs.flushHeaders();
    const send = (type, data) => rs.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    send('response.created', { response: { id: 'resp_t', model: body.model } });
    if (body.reasoning) {
      await sleep(400);
      if (body.reasoning.summary) {
        send('response.reasoning_summary_part.added', { summary_index: 0 });
        for (const d of ['**Reading the question**\n\n', 'The student wants the roots of ', 'x² − 5x + 6 = 0, with the steps shown.']) { send('response.reasoning_summary_text.delta', { summary_index: 0, delta: d }); await sleep(450); }
        await gate('step2');
        send('response.reasoning_summary_part.added', { summary_index: 1 });
        for (const d of ['**Working it out**\n\n', 'It factors: (x − 2)(x − 3) = 0. ', 'So x = 2 or x = 3. Check: 4 − 10 + 6 = 0.']) { send('response.reasoning_summary_text.delta', { summary_index: 1, delta: d }); await sleep(450); }
      } else await sleep(1600);
    }
    const answer = body.reasoning ? 'x = 2 or x = 3\n\nFactor the quadratic: x² − 5x + 6 = (x − 2)(x − 3). Set each factor to zero. Check: 2² − 5·2 + 6 = 0.\nCONFIDENCE: 96' : 'Hi! How can I help?\nCONFIDENCE: 99';
    await gate('answer');
    const pieces = answer.match(/[\s\S]{1,14}/g);
    for (let i = 0; i < pieces.length; i++) { if (i === 3) await gate('finish'); send('response.output_text.delta', { delta: pieces[i] }); await sleep(60); }
    gated = false;
    send('response.completed', { response: { id: 'resp_t', model: body.model, output: [{ type: 'message', content: [{ type: 'output_text', text: answer }] }], usage: { input_tokens: 40, output_tokens: 30 } } });
    rs.end();
  });
});
const PROXY = `http://127.0.0.1:${openai.port}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace("const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';", `const OPENAI_PROXY = '${PROXY}';`);
if (!code.includes(PROXY)) throw new Error('could not point the console at the stand-in');

const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef' } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(HOST_PAGE.replace('Some ordinary page', 'A school website')); });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms, polling: 50 }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);

async function panelShot(page, file, caption) {
  const b = await R(page, (r) => { const x = r.querySelector('.gpa-panel').getBoundingClientRect(); return { x: x.left, y: x.top, width: x.width, height: x.height }; });
  const CAP = 40;
  await page.evaluate(([c, x, y, w, h]) => {
    let el = document.getElementById('shot-caption');
    if (!el) { el = document.createElement('div'); el.id = 'shot-caption'; document.documentElement.appendChild(el); }
    Object.assign(el.style, { position: 'fixed', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', zIndex: 2147483647, background: '#f5a524', color: '#111', font: '600 15px/40px system-ui, sans-serif', textAlign: 'center' });
    el.textContent = c;
  }, [caption, b.x, b.y - CAP, b.width, CAP]);
  await page.screenshot({ path: path.join(OUT, file), clip: { x: b.x, y: Math.max(0, b.y - CAP), width: b.width, height: b.height + CAP } });
}

let pg;
try {
  await fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef', 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_openai_key', 'sk-test-stand-in-0123456789'); } catch (e) { /* ignore */ } }, env.workerUrl);
  pg = await ctx.newPage();
  pg._errors = [];
  pg.on('pageerror', (e) => pg._errors.push(String(e)));
  await pg.goto(`http://127.0.0.1:${site.port}/`);
  await pg.evaluate((c) => { (0, eval)(c); }, code);
  await pg.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await pg.fill(sr('#gpa-login-user'), 'think' + run);
  await pg.fill(sr('#gpa-login-pin'), '246810');
  await pg.click(sr('#gpa-signup-btn'));
  await pg.waitForTimeout(2500);
  await R(pg, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  check('Signed in', await R(pg, (r) => r.querySelector('#gpa-login').style.display === 'none'));
  // Ask AI tab, and the "large" size so the conversation has room.
  await R(pg, (r) => { r.querySelector('.size-btn[data-size="large"]')?.click(); r.querySelector('.gpa-dropdown-item[data-tab="ask"]').click(); });
  await pg.waitForTimeout(600);
  const ask = async (q) => { await pg.fill(sr('#gpa-ask-input'), q); await pg.press(sr('#gpa-ask-input'), 'Enter'); };

  // ---- 1: a hard question: live thinking ----
  const t0 = Date.now();
  await ask('Solve the quadratic x^2 - 5x + 6 = 0 and show the steps.');
  const live1 = await waitFor(pg, (r) => { const t = r.querySelector('.gpx-think'); return t && t.classList.contains('is-live') && /Reading the question/.test(t.textContent); }, null, 8000);
  if (!live1) { console.log('DEBUG seen', JSON.stringify(seen.map((x) => [x.path, x.body.model, x.body.reasoning]))); console.log('DEBUG chat', await R(pg, (r) => (r.querySelector('#gpa-chat').innerText || '').slice(0, 600))); console.log('DEBUG errors', pg._errors.join(' | ')); }
  const snap1 = await R(pg, (r) => { const t = r.querySelector('.gpx-think'); const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return { label: t.querySelector('.gpx-think-label').textContent, steps: [...t.querySelectorAll('.gpx-think-step')].map((x) => x.textContent), body: t.querySelector('.gpx-think-body').textContent, answerHidden: !ai || ai.hidden }; });
  const doneYet1 = seen.filter((x) => x.path === '/v1/responses').length === 1 && Date.now() - t0 < 4000;
  check('While the stream is still running: “Thinking” and the first reasoning step are already on screen, the answer isn’t yet', live1 && snap1.label === 'Thinking' && snap1.steps[0] === 'Reading the question' && snap1.answerHidden && doneYet1, JSON.stringify(snap1) + ` after ${Date.now() - t0}ms`);
  await pg.waitForTimeout(700);
  const tm = await R(pg, (r) => r.querySelector('.gpx-think-time').textContent);
  check('…with a running timer', /^\d+s$/.test(tm), tm);
  await panelShot(pg, '01-thinking-live.png', 'Ask AI · thinking, streaming in live');
  await release('step2');
  const live2 = await waitFor(pg, (r) => { const t = r.querySelector('.gpx-think'); return t && t.classList.contains('is-live') && [...t.querySelectorAll('.gpx-think-step')].length === 2; }, null, 8000);
  check('The second step (“Working it out”) arrives later, still live', live2 && await R(pg, (r) => [...r.querySelectorAll('.gpx-think-step')].map((x) => x.textContent).join('|') === 'Reading the question|Working it out'));
  await panelShot(pg, '02-thinking-two-steps.png', 'Ask AI · the second step arrives');
  await release('answer');
  // The answer starts streaming: the panel folds, the text grows.
  const ansStart = await waitFor(pg, (r) => { const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return ai && !ai.hidden && ai.textContent.length > 0; }, null, 8000);
  const partial = await R(pg, (r) => ({ text: [...r.querySelectorAll('.gpa-msg.ai')].pop().textContent, label: r.querySelector('.gpx-think-label').textContent }));
  check('The answer streams in under it (partial text on screen) and the panel folds to “Thought for Ns”', ansStart && partial.text.length > 0 && partial.text.length <= 42 && !/Check:/.test(partial.text) && /^Thought for \d+s$/.test(partial.label), JSON.stringify(partial));
  await panelShot(pg, '03-answer-streaming.png', 'Ask AI · the answer streams in, thinking folded');
  await release('finish');
  const done1 = await waitFor(pg, (r) => { const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return ai && /Check: 2² − 5·2 \+ 6 = 0\./.test(ai.textContent) && !!ai.querySelector('div'); }, null, 10000);
  const fin = await R(pg, (r) => { const t = r.querySelector('.gpx-think'); const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return { label: t.querySelector('.gpx-think-label').textContent, collapsed: t.classList.contains('is-collapsed'), bodyShown: !!t.querySelector('.gpx-think-body').offsetParent, chip: ai.querySelector('div').textContent, text: ai.textContent, expanded: t.querySelector('.gpx-think-h').getAttribute('aria-expanded') }; });
  check('Done: “Thought for Ns”, folded; the answer’s first line is the highlighted chip (“x = 2 or x = 3”); no CONFIDENCE line in the text', done1 && /^Thought for \d+s$/.test(fin.label) && fin.collapsed && !fin.bodyShown && fin.expanded === 'false' && fin.chip === 'x = 2 or x = 3' && !/CONFIDENCE/.test(fin.text), JSON.stringify(fin));
  await panelShot(pg, '04-done-folded.png', 'Ask AI · done: “Thought for Ns”');
  await R(pg, (r) => r.querySelector('.gpx-think-h').click());
  const opened = await R(pg, (r) => { const t = r.querySelector('.gpx-think'); return { shown: !!t.querySelector('.gpx-think-body').offsetParent, text: t.querySelector('.gpx-think-body').textContent, expanded: t.querySelector('.gpx-think-h').getAttribute('aria-expanded') }; });
  check('Tapping it opens the thinking again (both steps, without ** marks)', opened.shown && opened.expanded === 'true' && /Reading the question/.test(opened.text) && /x = 3\. Check/.test(opened.text) && !/\*\*/.test(opened.text), JSON.stringify(opened));
  await panelShot(pg, '05-thinking-opened.png', 'Ask AI · tap “Thought for Ns” to read it');
  await R(pg, (r) => r.querySelector('.gpx-think-h').click());
  check('…and tapping again folds it', await R(pg, (r) => r.querySelector('.gpx-think').classList.contains('is-collapsed')));
  const req1 = seen.filter((x) => x.path === '/v1/responses').pop().body;
  check('The request: Responses API, streamed, reasoning summary asked for, the question in input, the instructions separate', req1.stream === true && req1.reasoning && req1.reasoning.summary === 'auto' && /quadratic x\^2 - 5x \+ 6 = 0/.test(JSON.stringify(req1.input)) && /study assistant/.test(req1.instructions || '') && req1.input[0].content[0].type === 'input_text', JSON.stringify({ model: req1.model, reasoning: req1.reasoning, stream: req1.stream }));

  // ---- 2: an easy question, a model that doesn't reason ----
  await ask('hi');
  const shimmer = await waitFor(pg, (r) => { const ts = r.querySelectorAll('.gpx-think'); const t = ts[ts.length - 1]; return t && t.classList.contains('is-live'); }, null, 3000);
  const done2 = await waitFor(pg, (r) => { const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return ai && /How can I help\?/.test(ai.textContent); }, null, 10000);
  await pg.waitForTimeout(300);
  const after2 = await R(pg, (r) => r.querySelectorAll('.gpx-think').length);
  const req2 = seen.filter((x) => x.path === '/v1/responses').pop().body;
  check('Easy question (no reasoning model): “Thinking” while waiting, then no empty panel left behind', shimmer && done2 && after2 === 1 && !req2.reasoning, `panels: ${after2}, model ${req2.model}`);

  // ---- 3: no reasoning summaries for this OpenAI org ----
  mode = 'no-summary';
  const before3 = seen.length;
  await ask('Solve the quadratic x^2 + 2x - 8 = 0, explain each step.');
  const done3 = await waitFor(pg, (r) => { const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return ai && /Check: 2² − 5·2/.test(ai.textContent) && r.querySelectorAll('.gpx-think').length === 2; }, null, 15000);
  const tries = seen.slice(before3).filter((x) => x.path === '/v1/responses').map((x) => !!(x.body.reasoning && x.body.reasoning.summary));
  const p3 = await R(pg, (r) => { const ts = r.querySelectorAll('.gpx-think'); const t = ts[ts.length - 1]; return { label: t.querySelector('.gpx-think-label').textContent, empty: t.classList.contains('is-empty'), err: !!r.querySelector('.gpa-msg.ai .gpa-error, .gpa-err') }; });
  check('Org without reasoning summaries: refused once, retried without them, answered; “Thought for Ns” with nothing to open', done3 && tries.join(',') === 'true,false' && /^Thought for \d+s$/.test(p3.label) && p3.empty, JSON.stringify({ tries, ...p3 }));
  const before3b = seen.length;
  await ask('Which quadratic has roots 1 and 4? Show working.');
  await waitFor(pg, (r) => r.querySelectorAll('.gpx-think').length === 3 && !r.querySelectorAll('.gpx-think')[2].classList.contains('is-live'), null, 15000);
  const tries3b = seen.slice(before3b).filter((x) => x.path === '/v1/responses').map((x) => !!(x.body.reasoning && x.body.reasoning.summary));
  check('…and it doesn’t ask for summaries again (remembered)', tries3b.join(',') === 'false', tries3b.join(','));

  // ---- 4: a proxy without /v1/responses ----
  mode = 'no-responses';
  const before4 = seen.length;
  await ask('What is the capital of France?');
  const done4 = await waitFor(pg, (r) => { const ai = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return ai && /Plain answer\./.test(ai.textContent); }, null, 15000);
  const paths4 = seen.slice(before4).map((x) => x.path);
  check('A proxy without /v1/responses: falls back to the plain request and still answers', done4 && paths4.includes('/v1/responses') && paths4.includes('/v1/chat/completions'), paths4.join(', '));

  check('No page errors', pg._errors.length === 0, pg._errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await openai.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
