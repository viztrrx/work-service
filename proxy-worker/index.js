/**
 * Saints Service — restricted Cloudflare Workers integration test.
 *
 * This is deliberately NOT an unrestricted Scramjet replacement.
 * Only an explicitly configured HTTPS origin can be fetched.
 * The /preview endpoint can be framed by the existing Proxy tab for testing.
 */
const DEFAULT_ORIGIN = "https://example.com";

function upstreamOrigin(env) {
  const raw = (env && env.TARGET_ORIGIN) || DEFAULT_ORIGIN;
  let origin;
  try {
    origin = new URL(raw);
  } catch {
    throw new Error("TARGET_ORIGIN must be a valid HTTPS origin");
  }
  if (origin.protocol !== "https:" || origin.username || origin.password ||
      origin.pathname !== "/" || origin.search || origin.hash ||
      !origin.hostname || origin.port) {
    throw new Error("TARGET_ORIGIN must be an HTTPS origin without a path, credentials or custom port");
  }
  return origin;
}

function page(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function preview() {
  return page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Saints Proxy — connection test</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui,-apple-system,sans-serif; }
    body { margin:0; min-height:100vh; display:grid; place-items:center;
           background:#10131b; color:#f4f6ff; }
    main { box-sizing:border-box; width:min(90vw,480px); border:1px solid #343b50;
           border-radius:18px; padding:28px; background:#181e2b; }
    .ok { color:#93e6b1; font-weight:700; }
    p { color:#bdc9dc; line-height:1.6; }
    a { color:#a9c4ff; }
  </style>
</head>
<body>
  <main>
    <div class="ok">● Cloudflare Worker connected</div>
    <h1>Saints Proxy Test</h1>
    <p>This page can be used to verify your Saints Service Proxy tab's iframe
       connection before integrating a browser-like proxy.</p>
    <p><a href="/site/">Open the permitted demo destination</a></p>
  </main>
</body>
</html>`);
}

const ATTRS = [["a[href]", "href"], ["img[src]", "src"],
  ["script[src]", "src"], ["link[href]", "href"], ["form[action]", "action"]];

function rewriteDocument(response, requestUrl, target, origin) {
  if (typeof HTMLRewriter !== "function") return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  const rewriter = new HTMLRewriter();
  for (const [selector, attr] of ATTRS) {
    rewriter.on(selector, {
      element(el) {
        const input = el.getAttribute(attr);
        if (!input || input.startsWith("#")) return;
        try {
          const resolved = new URL(input, target);
          if (resolved.origin !== origin.origin) return;
          el.setAttribute(attr, requestUrl.origin + "/site" +
            resolved.pathname + resolved.search + resolved.hash);
        } catch {
          // Leave invalid or special URLs unchanged.
        }
      }
    });
  }
  return rewriter.transform(new Response(response.body, {
    status: response.status, headers,
  }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return Response.json({ status: "ok", service: "saints-proxy-test" }, {
        headers: { "cache-control": "no-store" },
      });
    }
    if (path === "/" || path === "/preview") return preview();
    if (!path.startsWith("/site/")) {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Only GET and HEAD are supported", { status: 405 });
    }

    let origin;
    try {
      origin = upstreamOrigin(env);
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }

    const requestedPath = path.slice("/site".length) + url.search;
    const target = new URL(requestedPath, origin);
    if (target.origin !== origin.origin) {
      return new Response("Destination not permitted", { status: 403 });
    }

    try {
      const headers = new Headers();
      for (const name of ["accept", "accept-language", "if-none-match",
                            "if-modified-since", "range"]) {
        const value = request.headers.get(name);
        if (value) headers.set(name, value);
      }
      const response = await fetch(target.href, {
        method: request.method, headers, redirect: "manual",
      });
      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get("location");
        if (!location) return new Response(null, { status });
        const destination = new URL(location, target);
        if (destination.origin !== origin.origin) {
          return new Response("External redirect not permitted", { status: 403 });
        }
        return Response.redirect(
          url.origin + "/site" + destination.pathname + destination.search + destination.hash,
          status
        );
      }
      const replyHeaders = new Headers(response.headers);
      for (const name of ["set-cookie", "content-length", "content-encoding",
                            "transfer-encoding", "connection"]) {
        replyHeaders.delete(name);
      }
      const reply = new Response(request.method === "HEAD" ? null : response.body, {
        status, headers: replyHeaders,
      });
      const contentType = replyHeaders.get("content-type") || "";
      if (request.method === "GET" && contentType.includes("text/html")) {
        return rewriteDocument(reply, url, target, origin);
      }
      return reply;
    } catch {
      return new Response("Upstream request failed", { status: 502 });
    }
  },
};
