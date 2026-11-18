// Terminal layout and slash commands, end to end in Chromium with the real
// console (script.js) against worker.js in workerd for sign-in, and a local
// stand-in for OpenAI:
//   1. "/" in the Ask AI box opens the command menu; typing filters it,
//      ↓ moves the pick, Tab completes, Esc closes
//   2. /help lists commands; an unknown command in the classic panel goes to
//      the AI as plain text (nothing breaks for people who never use /)
//   3. /solve runs the real quiz solver into the transcript (answer grid)
//   4. /theme, /model, /effort change real settings
//   5. /terminal on: no sidebar, banner, status line; /music opens Music
//      with a "Back to terminal" button; ↑ recalls earlier commands
//   6. Settings → Panel → Layout switches back to the classic panel
import fs from 'node:fs';
import path from 'node:path';
import { serve, launch, ROOT } from './harness.mjs';
import { startEnv } from './env.mjs';

const OUT = process.argv[2] || 'terminal-out';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const QUIZ_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Quiz</title></head><body style="font:16px serif;margin:40px">'
  + '<h1>Unit 3 check</h1><p>1. What is 2 + 2?</p>'
  + '<label><input type="radio" name="q1"> A. 3</label><label><input type="radio" name="q1"> B. 4</label>'
  + '<p>2. What is the capital of France?</p><select><option>Pick one</option><option>Paris</option><option>Rome</option></select>'
  + '</body></html>';

const seen = [];
const openai = await serve((rq, rs) => {
  rs.setHeader('Access-Control-Allow-Origin', '*');
  rs.setHeader('Access-Control-Allow-Headers', '*');
  rs.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (rq.method === 'OPTIONS') { rs.statusCode = 204; rs.end(); return; }
  let b = '';
  rq.on('data', (c) => { b += c; });
  rq.on('end', () => {
    let body = {};
    try { body = JSON.parse(b || '{}'); } catch (e) { /* ignore */ }
    seen.push({ path: rq.url, body });
    const all = JSON.stringify(body);
    if (rq.url === '/v1/chat/completions') {
      const grid = /JSON array/.test(all)
        ? '[{"q":"1","a":"B. 4","c":95,"h":"What is 2 + 2?"},{"q":"2","a":"Paris","c":97,"h":"What is the capital of France?"}]'
        : 'Plain answer.\nCONFIDENCE: 80';
      rs.setHeader('Content-Type', 'application/json');
      rs.end(JSON.stringify({ model: body.model, choices: [{ message: { content: grid } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
      return;
    }
    if (rq.url !== '/v1/responses') { rs.statusCode = 404; rs.end('{}'); return; }
    rs.setHeader('Content-Type', 'text/event-stream');
    rs.flushHeaders();
    const send = (type, data) => rs.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const text = 'Sure, here you go.\nCONFIDENCE: 90';
    send('response.created', { response: { id: 'r', model: body.model } });
    send('response.output_text.delta', { delta: text });
    send('response.completed', { response: { id: 'r', model: body.model, output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 5, output_tokens: 5 } } });
    rs.end();
  });
});
const PROXY = `http://127.0.0.1:${openai.port}`;
const code = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace("const OPENAI_PROXY = 'https://donnajbe.viztrrx.workers.dev';", `const OPENAI_PROXY = '${PROXY}';`);
if (!code.includes(PROXY)) throw new Error('could not point the console at the stand-in');

const env = await startEnv({ extraEnv: { ADMIN_TOKEN: 'test-admin-token-0123456789abcdef' } });
const site = await serve((rq, rs) => { rs.setHeader('Content-Type', 'text/html'); rs.end(QUIZ_PAGE); });
const browser = await launch();
const R = (page, fn, arg) => page.evaluate(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg]);
const sr = (sel) => `#gpa-root-host >> ${sel}`;
const waitFor = (page, fn, arg, ms = 15000) => page.waitForFunction(([f, a]) => (0, eval)(f)(document.getElementById('gpa-root-host').shadowRoot, a), [String(fn), arg], { timeout: ms, polling: 50 }).then(() => true, () => false);
const run = Date.now().toString(36).slice(-4);
const shot = async (page, file) => {
  const b = await R(page, (r) => { const x = r.querySelector('.gpa-panel').getBoundingClientRect(); return { x: x.left, y: x.top, width: x.width, height: x.height }; });
  await page.screenshot({ path: path.join(OUT, file), clip: b });
};

try {
  await fetch(env.workerUrl + '/admin/config', { method: 'POST', headers: { Authorization: 'Bearer test-admin-token-0123456789abcdef', 'Content-Type': 'application/json' }, body: JSON.stringify({ allowlist: { on: false, users: [] } }) });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((u) => { try { localStorage.setItem('gpa_admin_tele_endpoint', u); localStorage.setItem('gpa_openai_key_skip', '1'); localStorage.setItem('gpa_openai_key', 'sk-test-stand-in-0123456789'); } catch (e) { /* ignore */ } }, env.workerUrl);
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', (e) => errors.push(String(e)));
  await pg.goto(`http://127.0.0.1:${site.port}/`);
  await pg.evaluate((c) => { (0, eval)(c); }, code);
  await pg.waitForFunction(() => !!document.getElementById('gpa-root-host'));
  await pg.fill(sr('#gpa-login-user'), 'term' + run);
  await pg.fill(sr('#gpa-login-pin'), '246810');
  await pg.click(sr('#gpa-signup-btn'));
  await pg.waitForTimeout(2500);
  await R(pg, (r) => { const b = r.querySelector('#gpa-langpick .gpa-langpick-opt[data-lang="en"]'); if (b && b.offsetParent) b.click(); });
  check('Signed in', await R(pg, (r) => r.querySelector('#gpa-login').style.display === 'none'));
  await R(pg, (r) => { r.querySelector('.size-btn[data-size="large"]')?.click(); r.querySelector('.gpa-dropdown-item[data-tab="ask"]').click(); });
  await pg.waitForTimeout(500);
  const input = sr('#gpa-ask-input');
  const lastOut = () => R(pg, (r) => { const o = [...r.querySelectorAll('.gpa-msg.ai')].pop(); return o ? o.innerText : ''; });
  const cmd = async (line) => { await pg.fill(input, line); await pg.press(input, 'Escape'); await pg.fill(input, line); await pg.evaluate(() => {}); await R(pg, (r) => r.querySelector('#gpa-ask-btn').click()); };

  // ---- 1: the menu ----
  await pg.click(input);
  await pg.keyboard.type('/');
  const menu = await R(pg, (r) => { const m = r.querySelector('#gpa-term-menu'); return { open: !m.hidden, n: m.querySelectorAll('.gpa-term-opt').length }; });
  check('"/" opens the command menu', menu.open && menu.n > 5, JSON.stringify(menu));
  await pg.keyboard.type('so');
  const filtered = await R(pg, (r) => [...r.querySelectorAll('.gpa-term-opt code')].map((c) => c.textContent));
  check('Typing filters it (/so → /solve first)', filtered[0] === '/solve', filtered.join(', '));
  await shot(pg, '01-menu.png');
  await pg.fill(input, '/th');
  await pg.keyboard.press('Tab');
  check('Tab completes the picked command with a space for its argument', await R(pg, (r) => r.querySelector('#gpa-ask-input').value) === '/theme ');
  await pg.fill(input, '/');
  await pg.keyboard.press('Escape');
  check('Esc closes the menu', await R(pg, (r) => r.querySelector('#gpa-term-menu').hidden));
  await pg.fill(input, '');

  // ---- 2: /help, and unknown commands in classic mode ----
  await pg.fill(input, '/help');
  await pg.keyboard.press('Escape');
  await pg.keyboard.press('Enter');
  const help = await lastOut();
  check('/help lists commands by group', /Commands/.test(help) && /\/solve/.test(help) && /\/theme \[name\]/.test(help) && /PAGE|Page/.test(help), help.slice(0, 160));
  check('…and the command itself was not sent to the AI', !seen.some((x) => /\/help/.test(JSON.stringify(x.body))));
  const before = seen.length;
  await pg.fill(input, '/usr/bin is a folder?');
  await pg.keyboard.press('Enter');
  await waitFor(pg, (r) => /Sure, here you go/.test([...r.querySelectorAll('.gpa-msg.ai')].pop()?.innerText || ''), null, 8000);
  check('Classic panel: an unknown "/word" is just a question for the AI', seen.length > before);

  // ---- 3: /solve ----
  await pg.fill(input, '/solve');
  await pg.keyboard.press('Escape');
  await pg.keyboard.press('Enter');
  const solved = await waitFor(pg, (r) => { const o = [...r.querySelectorAll('.gpa-msg.ai.gpa-term-out')].pop(); return o && /Paris/.test(o.innerText) && !o.querySelector('[data-status]'); }, null, 15000);
  const solveReq = seen.find((x) => x.path === '/v1/chat/completions' && /quiz, exam, or worksheet/.test(JSON.stringify(x.body)));
  check('/solve runs the quiz solver on the page and shows the answers in the transcript', solved && !!solveReq && /capital of France/.test(JSON.stringify(solveReq.body)), (await lastOut()).slice(0, 200));
  await shot(pg, '02-solve.png');

  // ---- 4: settings commands ----
  await cmd('/theme red');
  check('/theme red switches the theme', await pg.evaluate(() => localStorage.getItem('gpa_theme')) === 'red');
  await cmd('/theme nope');
  check('/theme with a bad name says so', /No theme called/.test(await lastOut()));
  await cmd('/model gpt-4o');
  check('/model gpt-4o sets the base model', /Model set to gpt-4o/.test(await lastOut()));
  await cmd('/model');
  check('/model lists models with the current one marked', /● gpt-4o/.test(await lastOut()));
  await cmd('/model made-up-model');
  check('/model refuses an unknown model', /Unknown model/.test(await lastOut()));
  await cmd('/model gpt-5');
  await cmd('/effort high');
  check('/effort high sets reasoning effort', /Effort set to high/.test(await lastOut()) && await pg.evaluate(() => localStorage.getItem('gpa_reason')) === 'high', await lastOut());
  await cmd('/theme matte');

  // ---- 5: terminal layout ----
  await cmd('/terminal on');
  const term = await R(pg, (r) => {
    const p = r.querySelector('.gpa-panel');
    const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    return { cls: p.classList.contains('gpa-term'), sidebar: vis(r.querySelector('.gpa-sidebar')), status: vis(r.querySelector('.gpa-term-status')), statusText: r.querySelector('.gpa-term-status').textContent };
  });
  check('/terminal on: terminal layout, no sidebar, a status line with the user and model', term.cls && !term.sidebar && term.status && term.statusText.includes('term' + run) && term.statusText.includes('gpt-5'), JSON.stringify(term));
  check('…saved for this account', await pg.evaluate(() => localStorage.getItem('gpa_terminal_mode')) === 'on');
  await cmd('/clear');
  check('/clear empties the transcript and shows the banner', await R(pg, (r) => r.querySelector('#gpa-chat').children.length === 0 && getComputedStyle(r.querySelector('.gpa-term-banner')).display !== 'none'));
  await shot(pg, '03-terminal.png');
  await cmd('/help');
  await pg.fill(input, '/t');
  await shot(pg, '03b-terminal-help-menu.png');
  await pg.keyboard.press('Escape');
  await pg.fill(input, '');
  await cmd('/nonsense');
  check('Terminal layout: an unknown command says so instead of asking the AI', /no \/nonsense command/.test(await lastOut()));
  await cmd('/music');
  const away = await R(pg, (r) => ({ music: r.querySelector('.gpa-pane[data-pane="music"]').classList.contains('active'), back: getComputedStyle(r.querySelector('.gpa-term-back')).display !== 'none' }));
  check('/music opens Music with a "Back to terminal" button', away.music && away.back, JSON.stringify(away));
  await shot(pg, '04-away.png');
  await R(pg, (r) => r.querySelector('.gpa-term-back').click());
  check('…which returns to the prompt', await R(pg, (r) => r.querySelector('.gpa-pane[data-pane="ask"]').classList.contains('active') && getComputedStyle(r.querySelector('.gpa-term-back')).display === 'none'));
  await pg.fill(input, '');
  await pg.click(input);
  await pg.keyboard.press('ArrowUp');
  const h1 = await R(pg, (r) => r.querySelector('#gpa-ask-input').value);
  await pg.keyboard.press('ArrowUp');
  const h2 = await R(pg, (r) => r.querySelector('#gpa-ask-input').value);
  await pg.keyboard.press('ArrowDown');
  await pg.keyboard.press('ArrowDown');
  const h0 = await R(pg, (r) => r.querySelector('#gpa-ask-input').value);
  check('↑ recalls earlier commands, ↓ goes back to the empty draft', h1 === '/music' && h2 === '/nonsense' && h0 === '', [h1, h2, h0].join(' | '));

  // ---- 6: back to classic from Settings ----
  await cmd('/config panel');
  const inPanel = await R(pg, (r) => r.querySelector('.gps-sec[data-sec="panel"]').classList.contains('active'));
  check('/config panel opens Settings at Panel', inPanel);
  await R(pg, (r) => r.querySelector('.gps-seg-btn[data-layout="classic"]').click());
  const classic = await R(pg, (r) => ({ term: r.querySelector('.gpa-panel').classList.contains('gpa-term'), pressed: r.querySelector('.gps-seg-btn[data-layout="classic"]').classList.contains('primary') }));
  check('Settings → Panel → Layout → Classic panel turns the terminal off', !classic.term && classic.pressed && await pg.evaluate(() => localStorage.getItem('gpa_terminal_mode')) === 'off', JSON.stringify(classic));

  check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  await env.close();
  await site.close();
  await openai.close();
}
const passed = results.filter((x) => x.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
