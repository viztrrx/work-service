// The owner's own OpenAI key kept on the worker (/auth/my-key): locked to
// the owner's account and used on every device they sign in on.
// Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import worker, { ChatRoom } from '../worker.js';

function makeKV() {
  const store = new Map();
  return {
    store,
    async get(k, type) { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }; }
  };
}
const ADMIN = 'admin-token-very-secret-1234';
const GOOD = 'sk-good' + 'x'.repeat(40);
const BAD = 'sk-bad' + 'y'.repeat(40);
const upstream = [];   // Authorization headers that reached OpenAI
let realFetch;
before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('https://api.openai.com/')) return realFetch(input, init);
    const auth = (init && init.headers && (init.headers.Authorization || init.headers.authorization)) || '';
    upstream.push({ path: new URL(url).pathname, auth });
    if (auth === 'Bearer ' + BAD) return new Response('{"error":{"message":"bad key"}}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/v1/models')) return new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('{"id":"x","choices":[{"message":{"role":"assistant","content":"hi"}}]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
});
after(() => { globalThis.fetch = realFetch; });

function setup() {
  const env = { TELEMETRY: makeKV(), ADMIN_TOKEN: ADMIN, OWNER: 'boss', OWNER_CODE: 'owner-code-9', STUDENT_ID_OPTIONAL: '1' };
  env.CHAT_ROOMS = { idFromName: (n) => n, get() { return { fetch: async () => new Response('{"ok":true}') }; } };
  void ChatRoom;
  const ctx = { waitUntil() {} };
  const call = async (path, { method = 'POST', headers = {}, body } = {}) => {
    const res = await worker.fetch(new Request('https://w.test' + path, { method, headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json', ...headers }, body: body == null ? undefined : JSON.stringify(body) }), env, ctx);
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { env, call };
}
const V1 = 'a'.repeat(64), V2 = 'b'.repeat(64);

async function ownerSession(t) {
  const r = await t.call('/auth/register', { headers: { 'X-GPA-Owner': 'owner-code-9' }, body: { user: 'boss', verifier: V1 } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  return r.data.token;
}

test('owner key: saved on the worker, locked, never sent back; a new device uses it', async () => {
  const t = setup();
  const tokA = await ownerSession(t);
  const s = (tok) => ({ 'X-GPA-Session': tok });

  let st = await t.call('/auth/my-key', { method: 'GET', headers: s(tokA) });
  assert.equal(st.data.ok, true);
  assert.equal(st.data.hasKey, false);

  // A key OpenAI turns down is not saved; junk is refused before any call.
  assert.equal((await t.call('/auth/my-key', { headers: s(tokA), body: { key: BAD } })).status, 400);
  assert.equal((await t.call('/auth/my-key', { headers: s(tokA), body: { key: 'nope' } })).status, 400);
  assert.equal(t.env.TELEMETRY.store.has('key:openai:boss'), false);

  const saved = await t.call('/auth/my-key', { headers: s(tokA), body: { key: GOOD } });
  assert.equal(saved.data.ok, true, JSON.stringify(saved.data));
  assert.equal(saved.data.hint, GOOD.slice(-4));
  const rec = JSON.parse(t.env.TELEMETRY.store.get('key:openai:boss'));
  assert.equal(rec.locked, true);
  assert.equal(rec.key, GOOD);

  st = await t.call('/auth/my-key', { method: 'GET', headers: s(tokA) });
  assert.equal(st.data.hasKey, true);
  assert.ok(!JSON.stringify(st.data).includes(GOOD), 'the key itself never comes back');

  // Another device: sign in again. /status says a key is assigned (so no
  // prompt), and an AI call with no key of its own goes out with the owner's.
  const login = await t.call('/auth/login', { body: { user: 'boss', verifier: V1 } });
  assert.equal(login.data.ok, true, JSON.stringify(login.data));
  const tokB = login.data.token;
  const status = await t.call('/status?user=boss', { method: 'GET', headers: s(tokB) });
  assert.equal(status.data.assignedKeys.openai, true);
  upstream.length = 0;
  const ai = await t.call('/v1/chat/completions', { headers: { ...s(tokB), 'X-GPA-User': 'boss' }, body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] } });
  assert.equal(ai.status, 200, JSON.stringify(ai.data));
  assert.equal(upstream.find((u) => u.path === '/v1/chat/completions').auth, 'Bearer ' + GOOD);

  // Removing it.
  assert.equal((await t.call('/auth/my-key', { headers: s(tokB), body: { remove: true } })).data.ok, true);
  assert.equal(t.env.TELEMETRY.store.has('key:openai:boss'), false);
  const audit = [...t.env.TELEMETRY.store.entries()].filter(([k]) => k.startsWith('audit')).map(([, v]) => v).join(' ');
  assert.match(audit, /my-key/);
});

test('owner key: only the owner; signed-out and other accounts are refused', async () => {
  const t = setup();
  assert.equal((await t.call('/auth/my-key', { method: 'GET' })).status, 401);
  const u = await t.call('/auth/register', { body: { user: 'kid', verifier: V2 } });
  assert.equal(u.data.ok, true, JSON.stringify(u.data));
  const r = await t.call('/auth/my-key', { headers: { 'X-GPA-Session': u.data.token }, body: { key: GOOD } });
  assert.equal(r.status, 403);
  assert.equal(t.env.TELEMETRY.store.has('key:openai:boss'), false);
  assert.equal(t.env.TELEMETRY.store.has('key:openai:kid'), false);
});

test('owner key: an unverified claim of the owner name never gets it', async () => {
  const t = setup();
  const tok = await ownerSession(t);
  await t.call('/auth/my-key', { headers: { 'X-GPA-Session': tok }, body: { key: GOOD } });
  // Just the name, no session: refused outright, and /status reports no key.
  upstream.length = 0;
  const ai = await t.call('/v1/chat/completions', { headers: { 'X-GPA-User': 'boss' }, body: { model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] } });
  assert.notEqual(ai.status, 200);
  assert.ok(!upstream.some((u) => u.auth === 'Bearer ' + GOOD));
  const status = await t.call('/status?user=boss', { method: 'GET' });
  assert.notEqual(status.data.assignedKeys && status.data.assignedKeys.openai, true);
});

test('owner key: locked even where name-only identity is still allowed', async () => {
  // No ADMIN_TOKEN: no server accounts, so a bare name is accepted as-is.
  const env = { TELEMETRY: makeKV(), OWNER: 'boss' };
  env.CHAT_ROOMS = { idFromName: (n) => n, get() { return { fetch: async () => new Response('{"ok":true}') }; } };
  await env.TELEMETRY.put('key:openai:boss', JSON.stringify({ key: GOOD, locked: true }));
  await env.TELEMETRY.put('key:openai:kid', JSON.stringify({ key: 'sk-kid' + 'z'.repeat(40) }));
  const go = (user, own) => worker.fetch(new Request('https://w.test/v1/chat/completions', { method: 'POST',
    headers: { 'CF-Connecting-IP': '1.2.3.4', 'Content-Type': 'application/json', 'X-GPA-User': user, ...(own ? { Authorization: 'Bearer ' + own } : {}) },
    body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] }) }), env, { waitUntil() {} });
  upstream.length = 0;
  const own = 'sk-mine' + 'q'.repeat(40);
  await go('boss', own);
  assert.equal(upstream.at(-1).auth, 'Bearer ' + own, 'the locked owner key is not handed to a name-only caller');
  assert.ok(!upstream.some((u) => u.auth === 'Bearer ' + GOOD));
  // Ordinary (unlocked) assignments behave as before.
  await go('kid');
  assert.equal(upstream.at(-1).auth, 'Bearer sk-kid' + 'z'.repeat(40));
});
