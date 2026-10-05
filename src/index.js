// Task-Store: a tiny JSON key/value store on Cloudflare Workers + KV.
//
// Auth: every /items request needs `Authorization: Bearer <API_TOKEN>`.
// The token is a Worker secret (`wrangler secret put API_TOKEN`).
//
// Routes:
//   GET    /                 health check (no auth)
//   GET    /items            list keys   (?prefix=&cursor=&limit=)
//   GET    /items/:key       read a JSON document
//   PUT    /items/:key       create/replace a JSON document (body = JSON)
//   DELETE /items/:key       delete a document

const MAX_BODY_BYTES = 512 * 1024; // KV allows 25 MiB, keep it small on purpose
const MAX_KEY_LENGTH = 256;

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/") {
    return json({ ok: true, service: "task-store" });
  }

  if (path !== "/items" && !path.startsWith("/items/")) {
    return json({ error: "not_found" }, 404);
  }

  if (!env.API_TOKEN) {
    return json({ error: "server_misconfigured", detail: "API_TOKEN secret is not set" }, 500);
  }
  if (!(await isAuthorized(request, env.API_TOKEN))) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  if (path === "/items") {
    if (request.method !== "GET") return methodNotAllowed("GET");
    return listItems(url, env);
  }

  const key = decodeURIComponent(path.slice("/items/".length));
  if (!key || key.length > MAX_KEY_LENGTH) {
    return json({ error: "invalid_key" }, 400);
  }

  switch (request.method) {
    case "GET":
      return getItem(key, env);
    case "PUT":
      return putItem(key, request, env);
    case "DELETE":
      await env.STORE.delete(key);
      return json({ ok: true, key });
    default:
      return methodNotAllowed("GET, PUT, DELETE");
  }
}

async function listItems(url, env) {
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "100", 10) || 100, 1), 1000);
  const res = await env.STORE.list({
    prefix: url.searchParams.get("prefix") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit,
  });
  return json({
    keys: res.keys.map((k) => k.name),
    cursor: res.list_complete ? null : res.cursor,
  });
}

async function getItem(key, env) {
  const value = await env.STORE.get(key, "text");
  if (value === null) return json({ error: "not_found", key }, 404);
  return new Response(value, { headers: { "Content-Type": "application/json" } });
}

async function putItem(key, request, env) {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  await env.STORE.put(key, JSON.stringify(parsed));
  return json({ ok: true, key });
}

// Compare SHA-256 digests so the comparison is constant-time and length-independent.
async function isAuthorized(request, token) {
  const header = request.headers.get("Authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(match[1].trim())),
    crypto.subtle.digest("SHA-256", enc.encode(token)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function methodNotAllowed(allow) {
  return json({ error: "method_not_allowed" }, 405, { Allow: allow });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
