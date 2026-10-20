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
   - `https://<your-subdomain>.workers.dev/health` — JSON status
   - `https://<your-subdomain>.workers.dev/preview` — a simple page suitable for iframe testing
   - `https://<your-subdomain>.workers.dev/site/` — a limited demo request to `https://example.com/`

The repository's root `wrangler.jsonc`, `worker.js`, and `script.js` have **not** been changed. The existing Worker can continue deploying from the same GitHub repository with its original deploy command `npx wrangler deploy`.

## Limits and configuration

- This Worker permits only **GET/HEAD** requests to the single HTTPS origin configured in `TARGET_ORIGIN`. It does not accept arbitrary destination URLs. Only change this value to a destination you own or are authorized to proxy.
- It rewrites some ordinary same-origin HTML links and assets, but does not rewrite JavaScript, CSS, WebSocket, or third-party site resources. Complex sites and interactive sign-ins are not supported.
- It retains upstream security restrictions, including CSP / framing policies. It may not embed in every webpage where Saints Service's `script.js` is injected.
- `/preview` is for connection testing. The Saints Service tab still expects a Scramjet server at `https://localhost:4141`; changing the tab to load `/preview` is a **separate integration step**.
- Keep any future authenticated proxy private, and implement access controls, rate limiting and destination restrictions before making it available.

## Local checks

From the repository root:

```sh
node --check proxy-worker/index.js
npx wrangler deploy --dry-run --config proxy-worker/wrangler.jsonc
```

The dry run only validates the bundle; it does not publish it.
