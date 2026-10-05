# Task-Store
A cloudflare worker with simple storage for a claude code mod.

JSON documents are stored in Workers KV under a key, and every request is protected by a single bearer token.

## Setup

```sh
npm install
npx wrangler login
npx wrangler kv namespace create STORE   # paste the printed id into wrangler.toml
npx wrangler secret put API_TOKEN        # pick a long random string, e.g. `openssl rand -hex 32`
npm run deploy
```

Local dev: `cp .dev.vars.example .dev.vars` and run `npm run dev` (uses a local KV simulation).

## API

All `/items` routes need `Authorization: Bearer <API_TOKEN>`.

| Method | Path          | Description                                                  |
| ------ | ------------- | ------------------------------------------------------------ |
| GET    | `/`           | Health check (no auth)                                       |
| GET    | `/items`      | List keys. Query: `prefix`, `cursor`, `limit` (max 1000)     |
| GET    | `/items/:key` | Get a JSON document (404 if missing)                         |
| PUT    | `/items/:key` | Create or replace a document. Body must be valid JSON ≤512KB |
| DELETE | `/items/:key` | Delete a document                                            |

```sh
URL=https://task-store.<your-subdomain>.workers.dev
T="Authorization: Bearer $API_TOKEN"

curl -X PUT -H "$T" -d '{"title":"buy milk","done":false}' $URL/items/task:1
curl -H "$T" $URL/items/task:1
curl -H "$T" "$URL/items?prefix=task:"
curl -X DELETE -H "$T" $URL/items/task:1
```

## Notes

- KV is eventually consistent: a write can take up to ~60s to be visible from other locations. Fine for a personal mod; if you need strict read-after-write across regions, swap KV for a Durable Object or D1.
- There's one shared token, so anyone with it has full read/write access. Rotate it with `wrangler secret put API_TOKEN`.
