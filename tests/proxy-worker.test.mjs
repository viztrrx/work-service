// The separate saints-proxy-test Worker (proxy-worker/index.js), run in Node
// with a stubbed upstream. Workers' HTMLRewriter isn't in Node, so the link
// rewriting is exercised through a minimal stand-in that calls the Worker's
// own element handlers on each matching tag (the real one runs in
// tests/browser/proxy.mjs, in workerd).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../proxy-worker/index.js';

const W = 'https://saints-proxy-test.viztrrx.workers.dev';
const env = { TARGET_ORIGIN: 'https://example.com' };
const call = (p, init = {}, e = env) => worker.fetch(new Request(W + p, init), e);

function stubUpstream(handler) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init = {}) => { seen.push({ url: String(url), init }); return handler(String(url), init); };
  return { seen, restore: () => { globalThis.fetch = real; } };
}

// Minimal HTMLRewriter stand-in: for each `tag[attr]` selector, finds those
// tags and runs the handler with getAttribute/setAttribute on that attribute.
class FakeRewriter {
  constructor() { this.rules = []; }
  on(selector, handler) { const m = /^(\w+)\[(\w+)\]$/.exec(selector); this.rules.push({ tag: m[1], attr: m[2], handler }); return this; }
  transform(res) {
    const rules = this.rules;
    const body = res.text().then((html) => html.replace(/<(\w+)\b([^>]*)>/g, (all, tag, attrs) => {
      let out = attrs;
      for (const r of rules) {
        if (r.tag !== tag.toLowerCase()) continue;
        const re = new RegExp('(\\s' + r.attr + '=")([^"]*)(")', 'i');
        const m = re.exec(out);
        if (!m) continue;
        let val = m[2];
        r.handler.element({ getAttribute: () => m[2], setAttribute: (_n, v) => { val = v; } });
        out = out.replace(re, (_a, p1, _p2, p3) => p1 + val + p3);
      }
      return '<' + tag + out + '>';
    }));
    return body.then((b) => new Response(b, { status: res.status, headers: res.headers }));
  }
}

test('proxy worker: health (CORS, which destination), preview, unknown paths', async () => {
  const h = await call('/health');
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('access-control-allow-origin'), '*', 'readable from Saints Service on any site');
  assert.deepEqual(await h.json(), { status: 'ok', service: 'saints-proxy-test', target: 'https://example.com' });
  const bad = await call('/health', {}, { TARGET_ORIGIN: 'http://example.com' });
  assert.equal(bad.status, 500);
  assert.equal((await bad.json()).status, 'misconfigured');
  for (const p of ['/preview', '/']) {
    const r = await call(p);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/, 'no scripts on its own pages');
    assert.equal(r.headers.get('x-frame-options'), null, 'the Proxy tab may frame it');
    assert.match(await r.text(), /Cloudflare Worker connected/);
  }
  const nf = await call('/anything');
  assert.equal(nf.status, 404);
  assert.match(await nf.text(), /only has a connection test/);
  const site = await call('/site?x=1');
  assert.equal(site.status, 302);
  assert.equal(site.headers.get('location'), W + '/site/?x=1');
});

test('proxy worker: only the configured origin, GET/HEAD only, safe headers', async () => {
  const up = stubUpstream(async () => new Response('plain', { headers: { 'content-type': 'text/plain', 'set-cookie': 'a=1', 'content-security-policy': "frame-ancestors 'self'" } }));
  try {
    const ok = await call('/site/path?q=1', { headers: { cookie: 'saints=secret', authorization: 'Bearer x', 'accept-language': 'en' } });
    assert.equal(ok.status, 200);
    assert.equal(up.seen[0].url, 'https://example.com/path?q=1');
    assert.equal(up.seen[0].init.redirect, 'manual');
    const sent = up.seen[0].init.headers;
    assert.equal(sent.get('cookie'), null, 'cookies never forwarded');
    assert.equal(sent.get('authorization'), null, 'credentials never forwarded');
    assert.equal(sent.get('accept-language'), 'en');
    assert.equal(ok.headers.get('set-cookie'), null, 'upstream cookies dropped');
    assert.equal(ok.headers.get('content-security-policy'), "frame-ancestors 'self'", 'upstream framing rules are kept, not bypassed');
    // Attempts to reach another host are refused before any request.
    const before = up.seen.length;
    for (const p of ['/site//evil.example/x', '/site/%2F%2Fevil.example', '/site/..//evil.example', '/site/\\\\evil.example/']) {
      const r = await call(p);
      // 403 refused, 404 (URL normalising took it outside /site/), or 200 still on example.com.
      assert.ok([403, 404, 200].includes(r.status), p + ' → ' + r.status);
      if (r.status === 200) assert.ok(up.seen.slice(before).every((s) => s.url.startsWith('https://example.com/')), 'stayed on example.com: ' + p);
    }
    assert.ok(up.seen.slice(before).every((s) => s.url.startsWith('https://example.com/')), 'never fetched another host');
    const forbidden = await call('/site//evil.example/x');
    assert.equal(forbidden.status, 403);
    assert.match(await forbidden.text(), /only opens https:\/\/example\.com/);
    // Writes are refused.
    const post = await call('/site/', { method: 'POST', body: 'x' });
    assert.equal(post.status, 405);
    const head = await call('/site/', { method: 'HEAD' });
    assert.equal(head.status, 200);
  } finally { up.restore(); }
});

test('proxy worker: redirects stay on the origin; odd 3xx pass through; upstream down is a readable page', async () => {
  let next = null;
  const up = stubUpstream(async () => next());
  try {
    next = () => new Response(null, { status: 301, headers: { location: '/moved?a=1' } });
    let r = await call('/site/old');
    assert.equal(r.status, 301);
    assert.equal(r.headers.get('location'), W + '/site/moved?a=1');
    next = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } });
    r = await call('/site/old');
    assert.equal(r.status, 403);
    assert.match(await r.text(), /redirects to a different website/);
    next = () => new Response(null, { status: 304 });
    r = await call('/site/', { headers: { 'if-none-match': '"x"' } });
    assert.equal(r.status, 304, '304 passes through (used to throw → 502)');
    next = () => new Response('choose', { status: 300 });
    r = await call('/site/');
    assert.equal(r.status, 300);
    next = () => { throw new Error('down'); };
    r = await call('/site/');
    assert.equal(r.status, 502);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /didn&#39;t answer/, 'text is HTML-escaped');
  } finally { up.restore(); }
});

test('proxy worker: same-origin links and assets are rewritten through /site/, others left alone', async () => {
  globalThis.HTMLRewriter = FakeRewriter;
  const up = stubUpstream(async () => new Response('<a href="https://example.com/more?x=1#top">more</a><a href="/rel">rel</a><a href="https://www.iana.org/x">iana</a><img src="/logo.png"><a href="#frag">f</a>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  try {
    const r = await call('/site/');
    const html = await r.text();
    assert.match(html, new RegExp('href="' + W + '/site/more\\?x=1#top"'));
    assert.match(html, new RegExp('href="' + W + '/site/rel"'));
    assert.match(html, new RegExp('src="' + W + '/site/logo.png"'));
    assert.match(html, /href="https:\/\/www\.iana\.org\/x"/, 'other sites are not proxied');
    assert.match(html, /href="#frag"/);
  } finally { up.restore(); delete globalThis.HTMLRewriter; }
});
