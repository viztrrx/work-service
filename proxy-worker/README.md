# Saints Proxy Test Worker

A deliberately restricted Cloudflare Workers test deployment for [Saints Service](https://github.com/viztrrx/donnajbesaints). This is **not** a full Scramjet or unrestricted web proxy. It is designed to verify that a second `workers.dev` Worker can be deployed and its preview embedded in the existing Saints Service Proxy tab.

## Deploy via Cloudflare Builds (from an iPhone)

1. In Cloudflare, open **Workers & Pages** and create/connect a **new Worker** to the GitHub repository `viztrrx/donnajbesaints`, production branch `main`. Do **not** replace or reconnect the existing `donnajbe` Worker.
2. Use repository root `./` and deploy command:
   ```sh
   npx wrangler deploy --config proxy-worker/wrangler.jsonc
   ```
3. The new Worker is named `saints-proxy-test`. Its final `workers.dev` URL will be shown in the Cloudflare dashboard.
4. Once deployed, visit:
   - `https://<your-subdomain>.workers.dev/health` — JSON `{status, service, target}` (readable from any page: `Access-Control-Allow-Origin: *`; no credentials, nothing private). `target` is the one allowed origin.
   - `https://<your-subdomain>.workers.dev/preview` — a simple page suitable for iframe testing
   - `https://<your-subdomain>.workers.dev/site/` — a limited demo request to `https://example.com/`

The root `wrangler.jsonc` and `worker.js` (the `donnajbe` Worker) are separate and unchanged by this Worker; it keeps deploying with `npx wrangler deploy`.

## Used by the Saints Service Proxy tab

`script.js`'s Proxy tab uses this Worker by default (`https://saints-proxy-test.viztrrx.workers.dev`):

- On open it frames `/preview` and checks `/health` (to tell "Worker down" or "HTTP 500" apart from a loaded page, and to learn `target`).
- Addresses on `target` (e.g. `example.com/page`) become `/site/page` in the frame; every other site is refused in the tab with an explanation.
- If the website the console is on forbids framing the Worker (its CSP), the tab says so and offers **Open in a new tab**.
- The frame is sandboxed without top-navigation and gets no referrer; no Saints Service tokens or session ever go to this Worker.

## Limits and configuration

- This Worker permits only **GET/HEAD** requests to the single HTTPS origin configured in `TARGET_ORIGIN`. It does not accept arbitrary destination URLs. Only change this value to a destination you own or are authorized to proxy.
- It rewrites some ordinary same-origin HTML links and assets, but does not rewrite JavaScript, CSS, WebSocket, or third-party site resources. Complex sites and interactive sign-ins are not supported.
- It retains upstream security restrictions, including CSP / framing policies. It may not embed in every webpage where Saints Service's `script.js` is injected.
- `/preview`, `/health` and the error pages (404, 403 destination/redirect not permitted, 405, 500 misconfigured, 502 destination unreachable) are written by this Worker: readable HTML with a no-scripts CSP, safe to show in the tab's frame.
- Real redirects (301/302/303/307/308) are followed only within `TARGET_ORIGIN`; other 3xx (e.g. 304 from a conditional request) pass through unchanged.
- Keep any future authenticated proxy private, and implement access controls, rate limiting and destination restrictions before making it available.

## Local checks

From the repository root:

```sh
node --check proxy-worker/index.js
npx wrangler deploy --dry-run --config proxy-worker/wrangler.jsonc
node --test tests/proxy-worker.test.mjs      # routing, validation, redirects, headers
node tests/browser/proxy.mjs out/            # the Proxy tab against this Worker run locally
```

The dry run only validates the bundle; it does not publish it. The browser test runs this Worker locally with `compatibilityDate: 2026-10-01`, because `wrangler.jsonc`'s `2026-10-19` is newer than the repo's local workerd supports (Cloudflare itself accepts it).
